#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import {
  BACKUP_ROOT,
  ENV_PATH,
  PROJECT_ROOT,
  acquireLock,
  appendEvent,
  ensureEncryptionKey,
  ensureRuntimeDirectories,
  findExecutable,
  listAutomaticBackups,
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
const backupName = `backup-${stamp}`;
const backupDir = join(BACKUP_ROOT, backupName);
const stagingDir = join(BACKUP_ROOT, `.${backupName}.partial-${process.pid}`);
const minimumBackupCount = 5;
let releaseLock = async () => undefined;
let completedBackup = false;

function hashUpdate(hash, value) {
  const data = Buffer.from(String(value), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length, 0);
  hash.update(length);
  hash.update(data);
}

async function hashFileInto(hash, path) {
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
}

async function uploadsTreeFingerprint(root) {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relativePath = relative(root, fullPath).split("\\").join("/");
      const info = await lstat(fullPath, { bigint: true });

      if (entry.isDirectory()) {
        hashUpdate(hash, "directory");
        hashUpdate(hash, relativePath);
        await walk(fullPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        hashUpdate(hash, "symlink");
        hashUpdate(hash, relativePath);
        hashUpdate(hash, await readlink(fullPath));
        continue;
      }

      if (!entry.isFile()) {
        throw new Error(`Неподдерживаемый объект в uploads: ${relativePath}`);
      }

      hashUpdate(hash, "file");
      hashUpdate(hash, relativePath);
      hashUpdate(hash, info.size.toString());
      await hashFileInto(hash, fullPath);
      fileCount += 1;
      totalBytes += Number(info.size);
    }
  }

  await walk(root);

  return {
    algorithm: "sha256-tree-content-v1",
    fingerprint: hash.digest("hex"),
    fileCount,
    totalBytes,
  };
}

async function readChecksum(backupPath, filename) {
  try {
    const source = await readFile(join(backupPath, "SHA256SUMS"), "utf8");
    const line = source
      .split(/\r?\n/)
      .find((item) => item.endsWith(`  ${filename}`));
    return line ? String(line.trim().split(/\s+/)[0] || "") : "";
  } catch {
    return "";
  }
}

async function reusableUploadsArchive(fingerprint) {
  const backups = await listAutomaticBackups(100);

  for (const backup of backups) {
    if (
      backup.status !== "completed"
      || backup.uploadsFingerprint !== fingerprint
      || !backup.uploadsIncluded
    ) {
      continue;
    }

    const archivePath = join(backup.path, backup.uploadsFile || "uploads.tar.gz");
    if (!existsSync(archivePath)) continue;

    const expected = backup.uploadsArchiveSha256
      || await readChecksum(backup.path, backup.uploadsFile || "uploads.tar.gz");
    if (!expected) continue;

    const actual = await sha256File(archivePath);
    if (actual !== expected) {
      await appendEvent({
        type: "backup.uploads_reuse_rejected",
        severity: "warning",
        message: `Архив фотографий ${backup.name} не переиспользован: SHA-256 не совпал`,
      });
      continue;
    }

    return {
      backupName: backup.name,
      archivePath,
      sha256: actual,
      sizeBytes: (await stat(archivePath)).size,
    };
  }

  return null;
}

async function cleanupRetention(days, maximumCount) {
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const now = Date.now();
  const partialCutoff = now - 6 * 60 * 60 * 1000;
  const ageCutoff = now - days * 24 * 60 * 60 * 1000;
  const completed = [];

  for (const entry of entries) {
    const fullPath = join(BACKUP_ROOT, entry.name);

    if (entry.isDirectory() && entry.name.includes(".partial-")) {
      const info = await stat(fullPath);
      if (info.mtimeMs < partialCutoff) {
        await rm(fullPath, { recursive: true, force: true });
      }
      continue;
    }

    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;

    const info = await stat(fullPath);
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(join(fullPath, "manifest.json"), "utf8"));
    } catch {
      // Incomplete backup is handled below.
    }

    if (manifest?.status !== "completed") {
      if (info.mtimeMs < partialCutoff) {
        await rm(fullPath, { recursive: true, force: true });
      }
      continue;
    }

    completed.push({
      fullPath,
      createdAt: String(manifest.completedAt || info.mtime.toISOString()),
      mtimeMs: info.mtimeMs,
    });
  }

  completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const countLimit = Math.max(minimumBackupCount, maximumCount);

  for (const [index, item] of completed.entries()) {
    const exceedsCount = index >= countLimit;
    const exceedsAge = index >= minimumBackupCount && item.mtimeMs < ageCutoff;
    if (exceedsCount || exceedsAge) {
      await rm(item.fullPath, { recursive: true, force: true });
    }
  }
}

try {
  await ensureRuntimeDirectories();
  releaseLock = await acquireLock("backup");
  await rm(stagingDir, { recursive: true, force: true });

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

  await mkdir(stagingDir, { recursive: false, mode: 0o700 });

  const databaseFile = join(stagingDir, "database.dump");
  const uploadsFile = join(stagingDir, "uploads.tar.gz");
  const encryptedEnvFile = join(stagingDir, "env.enc");

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
  let uploadsStorageMode = "not_present";
  let uploadsSourceBackup = null;
  let uploadsFingerprint = null;
  let uploadsFingerprintAlgorithm = null;
  let uploadsFileCount = 0;
  let uploadsSourceBytes = 0;
  let uploadsArchiveBytes = 0;
  let uploadsArchiveSha256 = null;
  let additionalStorageBytes = 0;

  if (existsSync(uploadsPath)) {
    const fingerprint = await uploadsTreeFingerprint(uploadsPath);
    uploadsFingerprint = fingerprint.fingerprint;
    uploadsFingerprintAlgorithm = fingerprint.algorithm;
    uploadsFileCount = fingerprint.fileCount;
    uploadsSourceBytes = fingerprint.totalBytes;

    const reusable = await reusableUploadsArchive(fingerprint.fingerprint);

    if (reusable) {
      try {
        await link(reusable.archivePath, uploadsFile);
        uploadsStorageMode = "reused_hardlink";
        additionalStorageBytes = 0;
      } catch (error) {
        if (!error || typeof error !== "object" || !["EXDEV", "EPERM", "EACCES"].includes(error.code)) {
          throw error;
        }
        await copyFile(reusable.archivePath, uploadsFile);
        uploadsStorageMode = "reused_copy";
        additionalStorageBytes = reusable.sizeBytes;
      }

      uploadsSourceBackup = reusable.backupName;
      uploadsArchiveBytes = reusable.sizeBytes;
      uploadsArchiveSha256 = reusable.sha256;
    } else {
      await run(tar, ["-czf", uploadsFile, "-C", join(PROJECT_ROOT, "storage"), "uploads"], {
        timeout: 20 * 60 * 1000,
      });
      uploadsStorageMode = "created";
      uploadsArchiveBytes = (await stat(uploadsFile)).size;
      additionalStorageBytes = uploadsArchiveBytes;
      uploadsArchiveSha256 = await sha256File(uploadsFile);
    }

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
    const gitArgs = ["-c", `safe.directory=${PROJECT_ROOT}`];
    const commit = await run(git, [...gitArgs, "rev-parse", "HEAD"], { timeout: 15_000 })
      .catch(() => ({ stdout: "" }));
    const status = await run(git, [...gitArgs, "status", "--short", "--branch"], { timeout: 15_000 })
      .catch(() => ({ stdout: "" }));
    gitState = `commit=${commit.stdout || "unknown"}\n${status.stdout || ""}`.trim();
  }

  await writeFile(join(stagingDir, "source-state.txt"), `${gitState}\n`, { mode: 0o600 });

  const checksumFiles = [databaseFile, join(stagingDir, "source-state.txt")];
  if (uploadsIncluded) checksumFiles.push(uploadsFile);
  if (envEncrypted) checksumFiles.push(encryptedEnvFile);

  const checksums = [];
  for (const file of checksumFiles) {
    const filename = file.split("/").pop();
    const checksum = filename === "uploads.tar.gz" && uploadsArchiveSha256
      ? uploadsArchiveSha256
      : await sha256File(file);
    checksums.push(`${checksum}  ${filename}`);
  }

  await writeFile(join(stagingDir, "SHA256SUMS"), `${checksums.join("\n")}\n`, { mode: 0o600 });

  const completedAt = new Date().toISOString();
  const manifest = {
    version: 2,
    status: "completed",
    mode: manual ? "manual" : "automatic",
    startedAt: startedAt.toISOString(),
    completedAt,
    projectRoot: PROJECT_ROOT,
    databaseFile: "database.dump",
    uploadsFile: uploadsIncluded ? "uploads.tar.gz" : null,
    uploadsIncluded,
    uploadsStorageMode,
    uploadsSourceBackup,
    uploadsFingerprint,
    uploadsFingerprintAlgorithm,
    uploadsFileCount,
    uploadsSourceBytes,
    uploadsArchiveBytes,
    uploadsArchiveSha256,
    additionalStorageBytes,
    envEncrypted,
    recoveryKeyPath: "/root/viberimenya-backups/recovery/backup-encryption.key",
    retentionDays: settings.backupRetentionDays,
    maximumBackupCount: settings.backupMaxCount,
    minimumBackupCount,
  };

  await writeFile(join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(stagingDir, 0o700);
  await rename(stagingDir, backupDir);
  completedBackup = true;

  await cleanupRetention(settings.backupRetentionDays, settings.backupMaxCount)
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await appendEvent({
        type: "backup.retention_failed",
        severity: "warning",
        message,
      }).catch(() => undefined);
    });

  const result = {
    ok: true,
    ...manifest,
    path: backupDir,
  };

  await writeJsonAtomic(BACKUP_STATUS_PATH, result);
  await appendEvent({
    type: "backup.completed",
    severity: "info",
    message: uploadsStorageMode === "reused_hardlink"
      ? `Резервная копия создана: ${backupDir}. Архив фотографий переиспользован без дополнительного места.`
      : `Резервная копия создана: ${backupDir}`,
  });

  console.log(JSON.stringify(result));
} catch (error) {
  if (!completedBackup) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }

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
