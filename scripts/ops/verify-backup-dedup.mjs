#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { listAutomaticBackups, sha256File } from "./lib.mjs";

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const backups = (await listAutomaticBackups(20))
  .filter((backup) => backup.status === "completed");

assertCondition(backups.length >= 2, "Для проверки нужны минимум две завершённые копии");

const latest = backups[0];
const previous = backups[1];
const latestManifest = JSON.parse(await readFile(join(latest.path, "manifest.json"), "utf8"));
const previousManifest = JSON.parse(await readFile(join(previous.path, "manifest.json"), "utf8"));

assertCondition(latestManifest.version === 2, "Последняя копия создана не новым backup engine");
assertCondition(previousManifest.version === 2, "Предыдущая копия создана не новым backup engine");
assertCondition(latestManifest.uploadsIncluded === true, "В последней копии нет uploads");
assertCondition(previousManifest.uploadsIncluded === true, "В предыдущей копии нет uploads");
assertCondition(
  latestManifest.uploadsFingerprint === previousManifest.uploadsFingerprint,
  "Uploads изменились между двумя контрольными backup",
);
assertCondition(
  latestManifest.uploadsStorageMode === "reused_hardlink",
  `Ожидался reused_hardlink, получено ${latestManifest.uploadsStorageMode}`,
);
assertCondition(
  Number(latestManifest.additionalStorageBytes) === 0,
  "Переиспользованная копия ошибочно сообщает дополнительный расход диска",
);

const latestUploads = join(latest.path, latestManifest.uploadsFile || "uploads.tar.gz");
const previousUploads = join(previous.path, previousManifest.uploadsFile || "uploads.tar.gz");
assertCondition(existsSync(latestUploads), "Не найден uploads последней копии");
assertCondition(existsSync(previousUploads), "Не найден uploads предыдущей копии");

const latestInfo = await stat(latestUploads);
const previousInfo = await stat(previousUploads);
assertCondition(latestInfo.dev === previousInfo.dev, "Архивы находятся на разных файловых системах");
assertCondition(latestInfo.ino === previousInfo.ino, "Uploads не являются hardlink одного inode");
assertCondition(latestInfo.nlink >= 2, "У uploads недостаточное число hardlink");

const actualSha = await sha256File(latestUploads);
assertCondition(
  actualSha === latestManifest.uploadsArchiveSha256,
  "SHA-256 переиспользованного uploads не совпал",
);

const latestDb = await stat(join(latest.path, latestManifest.databaseFile || "database.dump"));
const previousDb = await stat(join(previous.path, previousManifest.databaseFile || "database.dump"));
assertCondition(
  latestDb.ino !== previousDb.ino || latestDb.dev !== previousDb.dev,
  "database.dump не должен переиспользоваться hardlink",
);

console.log("✓ два завершённых backup созданы новым engine");
console.log("✓ fingerprints uploads совпадают");
console.log("✓ uploads.tar.gz переиспользован hardlink без новых 966 МБ");
console.log("✓ SHA-256 переиспользованного архива подтверждён");
console.log("✓ database.dump создаётся отдельно для каждого backup");
console.log("BACKUP DEDUP E2E: OK");
