#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  RESTORE_STATUS_PATH,
  acquireLock,
  appendEvent,
  findExecutable,
  listAutomaticBackups,
  loadEnvFile,
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

try {
  releaseLock = await acquireLock("restore-check");
  const startedAt = new Date().toISOString();
  await writeJsonAtomic(RESTORE_STATUS_PATH, {
    ok: false,
    status: "running",
    mode: manual ? "manual" : "automatic",
    startedAt,
  });
  const backups = await listAutomaticBackups(1);
  const latest = backups[0];
  if (!latest || latest.status !== "completed") throw new Error("Нет завершённой резервной копии для проверки");
  const dumpPath = join(latest.path, latest.databaseFile || "database.dump");
  const checksumPath = join(latest.path, "SHA256SUMS");
  const expectedLine = (await readFile(checksumPath, "utf8")).split(/\r?\n/).find((line) => line.endsWith(`  ${dumpPath.split("/").pop()}`));
  if (!expectedLine) throw new Error("В SHA256SUMS отсутствует база данных");
  const expected = expectedLine.split(/\s+/)[0];
  const actual = await sha256File(dumpPath);
  if (expected !== actual) throw new Error("Контрольная сумма database.dump не совпала");

  const pgRestore = await findExecutable("pg_restore", "pgRestorePath");
  await run(pgRestore, ["--list", dumpPath], { timeout: 120_000 });

  sudo = await findExecutable("sudo", "sudoPath");
  const createdb = await findExecutable("createdb", "createdbPath");
  dropdb = await findExecutable("dropdb", "dropdbPath");
  const psql = await findExecutable("psql", "psqlPath");
  temporaryDatabase = `viberimenya_restore_check_${Date.now()}_${randomBytes(3).toString("hex")}`;
  readableDumpPath = `/var/tmp/${temporaryDatabase}.dump`;
  await copyFile(dumpPath, readableDumpPath);
  await chmod(readableDumpPath, 0o644);

  await run(sudo, ["-u", "postgres", createdb, temporaryDatabase], { timeout: 60_000 });
  await run(sudo, ["-u", "postgres", pgRestore, "--no-owner", "--no-privileges", "--dbname", temporaryDatabase, readableDumpPath], {
    timeout: 15 * 60 * 1000,
  });
  const verification = await run(sudo, ["-u", "postgres", psql, "-X", "-A", "-t", "-d", temporaryDatabase, "-c", "SELECT COUNT(*) FROM shops;"], {
    timeout: 60_000,
  });
  const shopCount = Number(verification.stdout.trim());
  if (!Number.isFinite(shopCount) || shopCount < 1) throw new Error("В восстановленной базе не найден магазин");

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
    shopCount,
    message: "Резервная копия успешно восстановлена во временную базу и проверена",
  };
  await writeJsonAtomic(RESTORE_STATUS_PATH, result);
  await appendEvent({ type: "restore-check.completed", severity: "info", message: result.message });
  console.log(JSON.stringify(result));
} catch (error) {
  if (temporaryDatabase && sudo && dropdb) {
    await run(sudo, ["-u", "postgres", dropdb, "--if-exists", temporaryDatabase], { timeout: 60_000 }).catch(() => undefined);
  }
  if (readableDumpPath) {
    await rm(readableDumpPath, { force: true }).catch(() => undefined);
  }
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
