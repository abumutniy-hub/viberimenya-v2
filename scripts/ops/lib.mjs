import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);
export const PROJECT_ROOT = process.env.VIBERIMENYA_PROJECT_ROOT || "/var/www/viberimenya-v2";
export const PRIVATE_ROOT = join(PROJECT_ROOT, "storage", "private", "system");
export const BACKUP_ROOT = process.env.VIBERIMENYA_BACKUP_ROOT || "/root/viberimenya-backups/automatic";
export const KEY_PATH = process.env.VIBERIMENYA_BACKUP_KEY || "/root/viberimenya-backups/recovery/backup-encryption.key";
export const ENV_PATH = join(PROJECT_ROOT, ".env");
export const STATUS_PATH = join(PRIVATE_ROOT, "status.json");
export const BACKUP_STATUS_PATH = join(PRIVATE_ROOT, "last-backup.json");
export const RESTORE_STATUS_PATH = join(PRIVATE_ROOT, "last-restore-check.json");
export const EVENTS_PATH = join(PRIVATE_ROOT, "events.ndjson");
export const RUNTIME_PATH = join(PRIVATE_ROOT, "runtime.json");

export async function ensureRuntimeDirectories() {
  await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  await mkdir(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  await mkdir(dirname(KEY_PATH), { recursive: true, mode: 0o700 });
}

export async function loadEnvFile(path = ENV_PATH) {
  const values = {};
  const source = await readFile(path, "utf8");

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\n/g, "\n");
  }

  return values;
}

export async function loadRuntime() {
  try {
    return JSON.parse(await readFile(RUNTIME_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function appendEvent(event) {
  await ensureRuntimeDirectories();
  const record = {
    at: new Date().toISOString(),
    ...event,
  };
  await appendFile(EVENTS_PATH, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await chmod(EVENTS_PATH, 0o600).catch(() => undefined);
}

export async function acquireLock(name, staleMs = 2 * 60 * 60 * 1000) {
  await ensureRuntimeDirectories();
  const path = join(PRIVATE_ROOT, `${name}.lock`);

  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > staleMs) {
      await rm(path, { force: true });
    }
  } catch {
    // Lock does not exist.
  }

  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.close();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(`Операция ${name} уже выполняется`);
    }
    throw error;
  }

  return async () => {
    await rm(path, { force: true });
  };
}

export async function run(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
    encoding: "utf8",
  });
  return {
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

export async function runStreaming(command, args = [], options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.stdio || "inherit",
    });
    let timer = null;
    if (options.timeout) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        rejectPromise(new Error(`Команда превысила лимит ${options.timeout} мс`));
      }, options.timeout);
    }
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Команда завершилась с кодом ${code ?? "unknown"}`));
    });
  });
}

export async function findExecutable(name, runtimeKey) {
  const runtime = await loadRuntime();
  const configured = runtime?.[runtimeKey];
  if (configured && existsSync(configured)) return configured;
  const result = await run("/usr/bin/env", ["bash", "-lc", `command -v ${name}`], { timeout: 10_000 });
  if (!result.stdout) throw new Error(`Не найден исполняемый файл: ${name}`);
  return result.stdout.split(/\r?\n/)[0];
}

export async function ensureEncryptionKey() {
  await ensureRuntimeDirectories();
  if (!existsSync(KEY_PATH)) {
    await writeFile(KEY_PATH, `${randomBytes(48).toString("base64url")}\n`, { mode: 0o600 });
  }
  await chmod(KEY_PATH, 0o600);
  return KEY_PATH;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  const content = await readFile(path);
  hash.update(content);
  return hash.digest("hex");
}

export async function directorySize(path) {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(fullPath);
    else if (entry.isFile()) total += (await stat(fullPath)).size;
  }
  return total;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export async function queryJson(databaseUrl, sql) {
  const psql = await findExecutable("psql", "psqlPath");
  const result = await run(psql, [
    `--dbname=${databaseUrl}`,
    "-v", "ON_ERROR_STOP=1",
    "-X",
    "-A",
    "-t",
    "-c", sql,
  ], {
    timeout: 45_000,
    env: {
      PGCONNECT_TIMEOUT: "10",
    },
  });
  const line = result.stdout.split(/\r?\n/).find((item) => item.trim()) || "{}";
  return JSON.parse(line);
}

export async function monitoringSettings(databaseUrl) {
  const defaults = {
    alertsEnabled: true,
    operationalAlertsEnabled: false,
    alertRepeatHours: 24,
    dailySummaryEnabled: false,
    autoRestartEnabled: true,
    backupRetentionDays: 30,
    diskWarningPercent: 75,
    diskCriticalPercent: 90,
    staleOrderMinutes: 120,
  };

  try {
    const data = await queryJson(databaseUrl, `
      SELECT COALESCE(
        jsonb_build_object(
          'alertsEnabled', COALESCE((ss.settings #>> '{systemMonitoring,alertsEnabled}')::boolean, true),
          'operationalAlertsEnabled', COALESCE((ss.settings #>> '{systemMonitoring,operationalAlertsEnabled}')::boolean, false),
          'alertRepeatHours', COALESCE(NULLIF(ss.settings #>> '{systemMonitoring,alertRepeatHours}', '')::int, 24),
          'dailySummaryEnabled', COALESCE((ss.settings #>> '{systemMonitoring,dailySummaryEnabled}')::boolean, false),
          'autoRestartEnabled', COALESCE((ss.settings #>> '{systemMonitoring,autoRestartEnabled}')::boolean, true),
          'backupRetentionDays', COALESCE(NULLIF(ss.settings #>> '{systemMonitoring,backupRetentionDays}', '')::int, 30),
          'diskWarningPercent', COALESCE(NULLIF(ss.settings #>> '{systemMonitoring,diskWarningPercent}', '')::int, 75),
          'diskCriticalPercent', COALESCE(NULLIF(ss.settings #>> '{systemMonitoring,diskCriticalPercent}', '')::int, 90),
          'staleOrderMinutes', COALESCE(NULLIF(ss.settings #>> '{systemMonitoring,staleOrderMinutes}', '')::int, 120)
        ),
        '{}'::jsonb
      )::text
      FROM shops sh
      LEFT JOIN shop_settings ss ON ss.shop_id = sh.id
      ORDER BY sh.created_at ASC
      LIMIT 1
    `);
    return {
      alertsEnabled: parseBoolean(data.alertsEnabled, defaults.alertsEnabled),
      operationalAlertsEnabled: parseBoolean(data.operationalAlertsEnabled, defaults.operationalAlertsEnabled),
      alertRepeatHours: clampNumber(data.alertRepeatHours, 6, 72, defaults.alertRepeatHours),
      dailySummaryEnabled: parseBoolean(data.dailySummaryEnabled, defaults.dailySummaryEnabled),
      autoRestartEnabled: parseBoolean(data.autoRestartEnabled, defaults.autoRestartEnabled),
      backupRetentionDays: clampNumber(data.backupRetentionDays, 7, 90, defaults.backupRetentionDays),
      diskWarningPercent: clampNumber(data.diskWarningPercent, 60, 90, defaults.diskWarningPercent),
      diskCriticalPercent: clampNumber(data.diskCriticalPercent, 75, 99, defaults.diskCriticalPercent),
      staleOrderMinutes: clampNumber(data.staleOrderMinutes, 30, 720, defaults.staleOrderMinutes),
    };
  } catch {
    return defaults;
  }
}

export async function ownerTelegramId(databaseUrl) {
  try {
    const data = await queryJson(databaseUrl, `
      SELECT COALESCE(
        jsonb_build_object('telegramId', (
          SELECT ta.telegram_id
          FROM shop_users su
          JOIN telegram_accounts ta
            ON ta.shop_id = su.shop_id
           AND ta.user_id = su.user_id
           AND ta.is_active = true
           AND ta.notifications_enabled = true
          WHERE su.role = 'owner'
            AND su.is_active = true
          ORDER BY ta.linked_at DESC
          LIMIT 1
        )),
        '{}'::jsonb
      )::text
    `);
    return String(data.telegramId || "").trim();
  } catch {
    return "";
  }
}

export async function sendOwnerTelegram(envValues, databaseUrl, text) {
  const token = String(envValues.TELEGRAM_BOT_TOKEN || envValues.BOT_TOKEN || "").trim();
  if (!token) return { sent: false, reason: "bot_token_missing" };
  const chatId = await ownerTelegramId(databaseUrl);
  if (!chatId) return { sent: false, reason: "owner_telegram_missing" };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 3900),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, reason: `telegram_${response.status}`, detail: body.slice(0, 300) };
  }
  return { sent: true };
}

export async function listAutomaticBackups(limit = 20) {
  await ensureRuntimeDirectories();
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const fullPath = join(BACKUP_ROOT, entry.name);
    const info = await stat(fullPath);
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(join(fullPath, "manifest.json"), "utf8"));
    } catch {
      // Broken/incomplete backup will be visible as incomplete.
    }
    rows.push({
      name: entry.name,
      path: fullPath,
      createdAt: manifest?.completedAt || info.mtime.toISOString(),
      status: manifest?.status || "incomplete",
      sizeBytes: await directorySize(fullPath).catch(() => 0),
      databaseFile: manifest?.databaseFile || "database.dump",
      uploadsIncluded: Boolean(manifest?.uploadsIncluded),
      envEncrypted: Boolean(manifest?.envEncrypted),
    });
  }
  return rows
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}
