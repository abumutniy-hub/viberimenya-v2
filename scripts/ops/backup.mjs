#!/usr/bin/env node
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BACKUP_ROOT,
  ENV_PATH,
  PROJECT_ROOT,
  acquireLock,
  appendEvent,
  ensureEncryptionKey,
  ensureRuntimeDirectories,
  findExecutable,
  loadEnvFile,
  monitoringSettings,
  run,
  sha256File,
  writeJsonAtomic,
  BACKUP_STATUS_PATH,
} from "./lib.mjs";

const manual = process.argv.includes("--manual");
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupDir = join(BACKUP_ROOT, `backup-${stamp}`);
let releaseLock = async () => undefined;

async function cleanupRetention(days) {
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const fullPath = join(BACKUP_ROOT, entry.name);
    const info = await stat(fullPath);
    candidates.push({ fullPath, mtimeMs: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const [index, item] of candidates.entries()) {
    if (index >= 3 && item.mtimeMs < cutoff) {
      await rm(item.fullPath, { recursive: true, force: true });
    }
  }
}

try {
  await ensureRuntimeDirectories();
  releaseLock = await acquireLock("backup");
  await writeJsonAtomic(BACKUP_STATUS_PATH, {
    ok: false,
    status: "running",
    mode: manual ? "manual" : "automatic",
    startedAt: startedAt.toISOString(),
    path: backupDir,
  });
  const envValues = await loadEnvFile();
  const databaseUrl = String(envValues.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL не найден в .env");
  const settings = await monitoringSettings(databaseUrl);
  const pgDump = await findExecutable("pg_dump", "pgDumpPath");
  const pgRestore = await findExecutable("pg_restore", "pgRestorePath");
  const tar = await findExecutable("tar", "tarPath");
  const openssl = await findExecutable("openssl", "opensslPath");
  const git = await findExecutable("git", "gitPath").catch(() => "");

  await mkdir(backupDir, { recursive: false, mode: 0o700 });
  const databaseFile = join(backupDir, "database.dump");
  const uploadsFile = join(backupDir, "uploads.tar.gz");
  const encryptedEnvFile = join(backupDir, "env.enc");

  await run(pgDump, [
    `--dbname=${databaseUrl}`,
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-privileges",
    `--file=${databaseFile}`,
  ], {
    timeout: 10 * 60 * 1000,
    env: {
      PGCONNECT_TIMEOUT: "10",
    },
  });

  await run(pgRestore, ["--list", databaseFile], { timeout: 120_000 });

  const uploadsPath = join(PROJECT_ROOT, "storage", "uploads");
  let uploadsIncluded = false;
  if (existsSync(uploadsPath)) {
    await run(tar, ["-czf", uploadsFile, "-C", join(PROJECT_ROOT, "storage"), "uploads"], {
      timeout: 20 * 60 * 1000,
    });
    uploadsIncluded = true;
  }

  let envEncrypted = false;
  if (existsSync(ENV_PATH)) {
    const keyPath = await ensureEncryptionKey();
    await run(openssl, [
      "enc",
      "-aes-256-cbc",
      "-salt",
      "-pbkdf2",
      "-iter", "200000",
      "-in", ENV_PATH,
      "-out", encryptedEnvFile,
      "-pass", `file:${keyPath}`,
    ], { timeout: 120_000 });
    envEncrypted = true;
  }

  let gitState = "Git недоступен";
  if (git) {
    const commit = await run(git, ["rev-parse", "HEAD"], { timeout: 15_000 }).catch(() => ({ stdout: "" }));
    const status = await run(git, ["status", "--short", "--branch"], { timeout: 15_000 }).catch(() => ({ stdout: "" }));
    gitState = `commit=${commit.stdout || "unknown"}\n${status.stdout || ""}`.trim();
  }
  await writeFile(join(backupDir, "source-state.txt"), `${gitState}\n`, { mode: 0o600 });

  const checksumFiles = [databaseFile, join(backupDir, "source-state.txt")];
  if (uploadsIncluded) checksumFiles.push(uploadsFile);
  if (envEncrypted) checksumFiles.push(encryptedEnvFile);
  const checksums = [];
  for (const file of checksumFiles) {
    checksums.push(`${await sha256File(file)}  ${file.split("/").pop()}`);
  }
  await writeFile(join(backupDir, "SHA256SUMS"), `${checksums.join("\n")}\n`, { mode: 0o600 });

  const completedAt = new Date().toISOString();
  const manifest = {
    version: 1,
    status: "completed",
    mode: manual ? "manual" : "automatic",
    startedAt: startedAt.toISOString(),
    completedAt,
    projectRoot: PROJECT_ROOT,
    databaseFile: "database.dump",
    uploadsIncluded,
    envEncrypted,
    recoveryKeyPath: "/root/viberimenya-backups/recovery/backup-encryption.key",
    retentionDays: settings.backupRetentionDays,
  };
  await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(backupDir, 0o700);
  await cleanupRetention(settings.backupRetentionDays);

  const result = {
    ok: true,
    ...manifest,
    path: backupDir,
  };
  await writeJsonAtomic(BACKUP_STATUS_PATH, result);
  await appendEvent({ type: "backup.completed", severity: "info", message: `Резервная копия создана: ${backupDir}` });
  console.log(JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const result = {
    ok: false,
    status: "failed",
    mode: manual ? "manual" : "automatic",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    path: backupDir,
    error: message,
  };
  await writeJsonAtomic(BACKUP_STATUS_PATH, result).catch(() => undefined);
  await appendEvent({ type: "backup.failed", severity: "critical", message }).catch(() => undefined);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await releaseLock().catch(() => undefined);
}
