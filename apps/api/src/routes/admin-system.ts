import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { writeAdminAudit } from "../modules/admin/admin-security.service";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();
const PRIVATE_ROOT = resolve(PROJECT_ROOT, "storage/private/system");
const BACKUP_ROOT = "/root/viberimenya-backups/automatic";
const RECOVERY_KEY_PATH = "/root/viberimenya-backups/recovery/backup-encryption.key";

const statusPath = join(PRIVATE_ROOT, "status.json");
const backupStatusPath = join(PRIVATE_ROOT, "last-backup.json");
const restoreStatusPath = join(PRIVATE_ROOT, "last-restore-check.json");
const eventsPath = join(PRIVATE_ROOT, "events.ndjson");

type AdminRole = "owner" | "admin" | "manager" | "florist" | "courier";

type SystemRequest = FastifyRequest & {
  adminContext?: {
    userId: string;
    shopId: string;
    role: AdminRole;
  };
};

const monitoringSettingsSchema = z.object({
  alertsEnabled: z.boolean(),
  operationalAlertsEnabled: z.boolean(),
  alertRepeatHours: z.number().int().min(6).max(72),
  dailySummaryEnabled: z.boolean(),
  autoRestartEnabled: z.boolean(),
  backupRetentionDays: z.number().int().min(7).max(90),
  diskWarningPercent: z.number().int().min(60).max(90),
  diskCriticalPercent: z.number().int().min(75).max(99),
  staleOrderMinutes: z.number().int().min(30).max(720),
}).superRefine((value, context) => {
  if (value.diskCriticalPercent <= value.diskWarningPercent) {
    context.addIssue({
      code: "custom",
      path: ["diskCriticalPercent"],
      message: "Критический порог должен быть выше предупредительного",
    });
  }
});

async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function directorySize(path: string) {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(path, entry.name);

    if (entry.isDirectory()) {
      total += await directorySize(fullPath);
    } else if (entry.isFile()) {
      total += (await stat(fullPath)).size;
    }
  }

  return total;
}

async function automaticBackups(limit = 12) {
  if (!existsSync(BACKUP_ROOT)) return [];
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const backups: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const path = join(BACKUP_ROOT, entry.name);
    const info = await stat(path);
    const manifest = await readJson(join(path, "manifest.json"));

    backups.push({
      name: entry.name,
      createdAt: String(manifest?.completedAt ?? info.mtime.toISOString()),
      status: String(manifest?.status ?? "incomplete"),
      mode: String(manifest?.mode ?? "unknown"),
      sizeBytes: await directorySize(path).catch(() => 0),
      uploadsIncluded: Boolean(manifest?.uploadsIncluded),
      envEncrypted: Boolean(manifest?.envEncrypted),
    });
  }

  return backups
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

async function timerState(unit: string) {
  try {
    const result = await execFileAsync("systemctl", ["is-active", unit], {
      timeout: 10_000,
      encoding: "utf8",
    });

    return String(result.stdout || "").trim() || "unknown";
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error
      ? String(error.stdout || "").trim()
      : "";

    return stdout || "inactive";
  }
}

async function recentEvents(limit = 30) {
  try {
    const lines = (await readFile(eventsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .reverse();

    return lines.map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

async function runOperation(scriptName: string, args: string[], timeout: number) {
  const scriptPath = resolve(PROJECT_ROOT, "scripts/ops", scriptName);

  if (!existsSync(scriptPath)) {
    throw new Error(`Системный скрипт не найден: ${scriptName}`);
  }

  const result = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });

  const output = String(result.stdout || "").trim();
  const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1) || "{}";

  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return { ok: true, message: output.slice(-2000) };
  }
}

async function startSystemOperation(unit: string) {
  await execFileAsync("systemctl", ["start", "--no-block", unit], {
    timeout: 10_000,
    encoding: "utf8",
  });
}

async function monitoringSettings(client: ReturnType<typeof createDb>["client"], shopId: string) {
  const rows = await client<{
    settings: Record<string, unknown> | null;
  }[]>`
    SELECT settings
    FROM shop_settings
    WHERE shop_id = ${shopId}
    LIMIT 1
  `;
  const root = rows[0]?.settings && typeof rows[0].settings === "object"
    ? rows[0].settings
    : {};
  const raw = root.systemMonitoring && typeof root.systemMonitoring === "object"
    ? root.systemMonitoring as Record<string, unknown>
    : {};

  return {
    alertsEnabled: raw.alertsEnabled !== false,
    operationalAlertsEnabled: raw.operationalAlertsEnabled === true,
    alertRepeatHours: Math.min(72, Math.max(6, Number(raw.alertRepeatHours ?? 24) || 24)),
    dailySummaryEnabled: raw.dailySummaryEnabled === true,
    autoRestartEnabled: raw.autoRestartEnabled !== false,
    backupRetentionDays: Math.min(90, Math.max(7, Number(raw.backupRetentionDays ?? 30) || 30)),
    diskWarningPercent: Math.min(90, Math.max(60, Number(raw.diskWarningPercent ?? 75) || 75)),
    diskCriticalPercent: Math.min(99, Math.max(75, Number(raw.diskCriticalPercent ?? 90) || 90)),
    staleOrderMinutes: Math.min(720, Math.max(30, Number(raw.staleOrderMinutes ?? 120) || 120)),
  };
}

export function registerAdminSystemRoutes(app: FastifyInstance) {
  app.get("/api/admin/system", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });
    }

    const { client } = createDb();

    try {
      const settings = await monitoringSettings(client, adminContext.shopId);
      const [
        status,
        lastBackup,
        lastRestoreCheck,
        backups,
        events,
        backupTimer,
        healthTimer,
        restoreTimer,
        summaryTimer,
      ] = await Promise.all([
        readJson(statusPath),
        readJson(backupStatusPath),
        readJson(restoreStatusPath),
        automaticBackups(),
        recentEvents(),
        timerState("viberimenya-backup.timer"),
        timerState("viberimenya-health.timer"),
        timerState("viberimenya-restore-check.timer"),
        timerState("viberimenya-daily-report.timer"),
      ]);

      const generatedAt = status?.generatedAt ? new Date(String(status.generatedAt)) : null;
      const statusAgeMinutes = generatedAt && !Number.isNaN(generatedAt.getTime())
        ? Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60_000))
        : null;

      return {
        ok: true,
        status,
        statusAgeMinutes,
        statusStale: statusAgeMinutes === null || statusAgeMinutes > 15,
        lastBackup,
        lastRestoreCheck,
        backups,
        events,
        settings,
        recovery: {
          keyExists: existsSync(RECOVERY_KEY_PATH),
          keyPath: RECOVERY_KEY_PATH,
          backupRoot: BACKUP_ROOT,
        },
        timers: [
          { key: "health", label: "Проверка системы каждые 5 минут", unit: "viberimenya-health.timer", state: healthTimer },
          { key: "backup", label: "Ежедневная резервная копия", unit: "viberimenya-backup.timer", state: backupTimer },
          { key: "restore", label: "Еженедельная проверка восстановления", unit: "viberimenya-restore-check.timer", state: restoreTimer },
          { key: "summary", label: "Ежедневный отчёт владельцу", unit: "viberimenya-daily-report.timer", state: summaryTimer },
        ],
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/system/settings", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });
    }

    const body = monitoringSettingsSchema.parse(request.body ?? {});
    const payload = JSON.stringify(body);
    const { client } = createDb();

    try {
      await client`
        UPDATE shop_settings
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{systemMonitoring}',
              CAST(${payload} AS jsonb),
              true
            ),
            updated_at = NOW()
        WHERE shop_id = ${adminContext.shopId}
      `;

      await writeAdminAudit(client, {
        shopId: adminContext.shopId,
        actorUserId: adminContext.userId,
        actorRole: adminContext.role,
        eventType: "system.settings_changed",
        entityType: "system",
        entityId: adminContext.shopId,
        severity: "warning",
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
        summary: "Изменены настройки резервного копирования и мониторинга",
        metadata: body,
      });

      return { ok: true, settings: body };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/system/diagnostics", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;
    if (!adminContext) return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });

    const result = await runOperation("health-check.mjs", ["--manual", "--no-restart"], 120_000);
    return { ok: true, result };
  });

  app.post("/api/admin/system/backup", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;
    if (!adminContext) return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });

    await startSystemOperation("viberimenya-backup.service");
    return { ok: true, message: "Резервное копирование запущено. Результат появится в журнале и списке копий." };
  });

  app.post("/api/admin/system/restore-check", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;
    if (!adminContext) return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });

    await startSystemOperation("viberimenya-restore-check.service");
    return { ok: true, message: "Проверка восстановления запущена во временной базе. Работающий магазин не изменяется." };
  });

  app.get("/api/admin/system/report", async (request, reply) => {
    const adminContext = (request as SystemRequest).adminContext;
    if (!adminContext) return reply.status(401).send({ ok: false, message: "Требуется вход в CRM" });

    const scriptPath = resolve(PROJECT_ROOT, "scripts/ops/diagnostic-report.mjs");
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8",
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="viberimenya-diagnostics-${stamp}.txt"`);
    return reply.send(String(result.stdout || "Диагностический отчёт пуст"));
  });
}
