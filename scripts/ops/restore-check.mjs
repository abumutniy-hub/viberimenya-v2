#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  KEY_PATH,
  RESTORE_STATUS_PATH,
  acquireLock,
  appendEvent,
  findExecutable,
  listAutomaticBackups,
  run,
  sha256File,
  writeJsonAtomic,
} from "./lib.mjs";

const manual = process.argv.includes("--manual");
let releaseLock = async () => undefined;
let temporaryDatabase = "";
let sudo = "";
let dropdb = "";
let readableDumpPath = "";
let decryptedEnvPath = "";

async function verifiedChecksumFiles(backupPath) {
  const checksumPath = join(backupPath, "SHA256SUMS");
  const lines = (await readFile(checksumPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error("SHA256SUMS пуст");

  const verified = [];
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s{2}([A-Za-z0-9._-]+)$/i);
    if (!match) throw new Error(`Некорректная строка SHA256SUMS: ${line}`);
    const expected = match[1].toLowerCase();
    const filename = match[2];
    const path = join(backupPath, filename);
    if (!existsSync(path)) throw new Error(`Файл из SHA256SUMS отсутствует: ${filename}`);
    const actual = await sha256File(path);
    if (actual !== expected) throw new Error(`Контрольная сумма ${filename} не совпала`);
    verified.push(filename);
  }

  return verified;
}

try {
  releaseLock = await acquireLock("restore-check");
  const startedAt = new Date().toISOString();

  await writeJsonAtomic(RESTORE_STATUS_PATH, {
    ok: false,
    status: "running",
    mode: manual ? "manual" : "automatic",
    startedAt,
  });

  const backups = await listAutomaticBackups(100);
  const latest = backups.find((backup) => backup.status === "completed");
  if (!latest) throw new Error("Нет завершённой резервной копии для проверки");

  const manifest = JSON.parse(await readFile(join(latest.path, "manifest.json"), "utf8"));
  const verifiedFiles = await verifiedChecksumFiles(latest.path);
  const dumpPath = join(latest.path, latest.databaseFile || "database.dump");

  if (!verifiedFiles.includes(latest.databaseFile || "database.dump")) {
    throw new Error("В SHA256SUMS отсутствует database.dump");
  }

  const pgRestore = await findExecutable("pg_restore", "pgRestorePath");
  await run(pgRestore, ["--list", dumpPath], { timeout: 120_000 });

  let uploadsVerified = false;
  if (manifest.uploadsIncluded) {
    const uploadsFilename = String(manifest.uploadsFile || "uploads.tar.gz");
    if (!verifiedFiles.includes(uploadsFilename)) {
      throw new Error("В SHA256SUMS отсутствует uploads.tar.gz");
    }
    const tar = await findExecutable("tar", "tarPath");
    await run(tar, ["-tzf", join(latest.path, uploadsFilename)], {
      timeout: 20 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    uploadsVerified = true;
  }

  let envVerified = false;
  if (manifest.envEncrypted) {
    if (!verifiedFiles.includes("env.enc")) {
      throw new Error("В SHA256SUMS отсутствует env.enc");
    }
    if (!existsSync(KEY_PATH)) throw new Error("Ключ расшифровки backup не найден");
    const openssl = await findExecutable("openssl", "opensslPath");
    decryptedEnvPath = `/var/tmp/viberimenya_restore_env_${process.pid}_${Date.now()}.env`;
    await run(openssl, [
      "enc",
      "-d",
      "-aes-256-cbc",
      "-pbkdf2",
      "-iter", "200000",
      "-in", join(latest.path, "env.enc"),
      "-out", decryptedEnvPath,
      "-pass", `file:${KEY_PATH}`,
    ], { timeout: 120_000 });
    const envText = await readFile(decryptedEnvPath, "utf8");
    if (!/^DATABASE_URL=/m.test(envText)) {
      throw new Error("Расшифрованный env не содержит DATABASE_URL");
    }
    await rm(decryptedEnvPath, { force: true });
    decryptedEnvPath = "";
    envVerified = true;
  }

  sudo = await findExecutable("sudo", "sudoPath");
  const createdb = await findExecutable("createdb", "createdbPath");
  dropdb = await findExecutable("dropdb", "dropdbPath");
  const psql = await findExecutable("psql", "psqlPath");
  temporaryDatabase = `viberimenya_restore_check_${Date.now()}_${randomBytes(3).toString("hex")}`;
  readableDumpPath = `/var/tmp/${temporaryDatabase}.dump`;
  await copyFile(dumpPath, readableDumpPath);
  await chmod(readableDumpPath, 0o644);

  await run(sudo, ["-u", "postgres", createdb, temporaryDatabase], { timeout: 60_000 });
  await run(sudo, [
    "-u", "postgres", pgRestore,
    "--no-owner",
    "--no-privileges",
    "--dbname", temporaryDatabase,
    readableDumpPath,
  ], { timeout: 15 * 60 * 1000 });

  const verification = await run(sudo, [
    "-u", "postgres", psql,
    "-X", "-A", "-t",
    "-d", temporaryDatabase,
    "-c", "SELECT COUNT(*) FROM shops;",
  ], { timeout: 60_000 });

  const shopCount = Number(verification.stdout.trim());
  if (!Number.isFinite(shopCount) || shopCount < 1) {
    throw new Error("В восстановленной базе не найден магазин");
  }

  await run(sudo, ["-u", "postgres", dropdb, "--if-exists", temporaryDatabase], { timeout: 60_000 });
  temporaryDatabase = "";
  await rm(readableDumpPath, { force: true });
  readableDumpPath = "";

  const result = {
    ok: true,
    status: "completed",
    mode: manual ? "manual" : "automatic",
    startedAt,
    completedAt: new Date().toISOString(),
    backupName: latest.name,
    backupCreatedAt: latest.createdAt,
    checksumsVerified: verifiedFiles.length,
    uploadsVerified,
    envVerified,
    shopCount,
    message: "Резервная копия полностью проверена и успешно восстановлена во временную базу",
  };

  await writeJsonAtomic(RESTORE_STATUS_PATH, result);
  await appendEvent({ type: "restore-check.completed", severity: "info", message: result.message });
  console.log(JSON.stringify(result));
} catch (error) {
  if (temporaryDatabase && sudo && dropdb) {
    await run(sudo, ["-u", "postgres", dropdb, "--if-exists", temporaryDatabase], { timeout: 60_000 })
      .catch(() => undefined);
  }
  if (readableDumpPath) await rm(readableDumpPath, { force: true }).catch(() => undefined);
  if (decryptedEnvPath) await rm(decryptedEnvPath, { force: true }).catch(() => undefined);

  const message = error instanceof Error ? error.message : String(error);
  const result = {
    ok: false,
    status: "failed",
    mode: manual ? "manual" : "automatic",
    completedAt: new Date().toISOString(),
    error: message,
  };

  await writeJsonAtomic(RESTORE_STATUS_PATH, result).catch(() => undefined);
  await appendEvent({ type: "restore-check.failed", severity: "critical", message }).catch(() => undefined);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await releaseLock().catch(() => undefined);
}
