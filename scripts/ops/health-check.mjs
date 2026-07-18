#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  BACKUP_STATUS_PATH,
  PROJECT_ROOT,
  STATUS_PATH,
  acquireLock,
  appendEvent,
  findExecutable,
  loadEnvFile,
  monitoringSettings,
  queryJson,
  readJson,
  run,
  sendOwnerTelegram,
  writeJsonAtomic,
} from "./lib.mjs";

const manual = process.argv.includes("--manual");
const noRestart = process.argv.includes("--no-restart");
let releaseLock = async () => undefined;

function check(key, label, status, message, value = null) {
  return { key, label, status, message, value };
}

function worstStatus(checks) {
  if (checks.some((item) => item.status === "critical")) return "critical";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "ok";
}

async function httpCheck(url, timeoutMs = 12_000) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Viberimenya-Monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    return {
      ok: response.status >= 200 && response.status < 500,
      status: response.status,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pm2State(pm2Path) {
  const result = await run(pm2Path, ["jlist"], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  const processes = JSON.parse(result.stdout || "[]");
  const names = ["viberimenya-api-v2", "viberimenya-web-v2", "viberimenya-bot-v2"];
  return names.map((name) => {
    const process = processes.find((item) => item.name === name);
    return {
      name,
      status: String(process?.pm2_env?.status || "missing"),
      restarts: Number(process?.pm2_env?.restart_time || 0),
      memoryBytes: Number(process?.monit?.memory || 0),
      cpu: Number(process?.monit?.cpu || 0),
    };
  });
}

async function sslInfo(appUrl, opensslPath) {
  let host = "";
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "https:") return { applicable: false, host: parsed.hostname };
    host = parsed.hostname;
  } catch {
    return { applicable: false, error: "APP_URL имеет неверный формат" };
  }

  const command = `echo | ${JSON.stringify(opensslPath)} s_client -servername ${JSON.stringify(host)} -connect ${JSON.stringify(`${host}:443`)} 2>/dev/null | ${JSON.stringify(opensslPath)} x509 -noout -enddate`;
  const result = await run("/usr/bin/env", ["bash", "-lc", command], { timeout: 20_000 });
  const raw = result.stdout.replace(/^notAfter=/, "").trim();
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("Не удалось прочитать срок SSL-сертификата");
  const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return { applicable: true, host, expiresAt: expiresAt.toISOString(), daysRemaining };
}

async function diskInfo(dfPath) {
  const result = await run(dfPath, ["-Pk", PROJECT_ROOT], { timeout: 10_000 });
  const line = result.stdout.split(/\r?\n/).filter(Boolean).at(-1) || "";
  const parts = line.trim().split(/\s+/);
  const totalKb = Number(parts[1] || 0);
  const usedKb = Number(parts[2] || 0);
  const availableKb = Number(parts[3] || 0);
  const usagePercent = Number(String(parts[4] || "0").replace("%", ""));
  return { totalKb, usedKb, availableKb, usagePercent, mount: parts[5] || "" };
}

try {
  releaseLock = await acquireLock("health", 15 * 60 * 1000);
  const generatedAt = new Date().toISOString();
  const previous = await readJson(STATUS_PATH, null);
  const envValues = await loadEnvFile();
  const databaseUrl = String(envValues.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL не найден в .env");
  const settings = await monitoringSettings(databaseUrl);
  const pm2 = await findExecutable("pm2", "pm2Path");
  const openssl = await findExecutable("openssl", "opensslPath");
  const df = await findExecutable("df", "dfPath");
  const checks = [];
  let services = await pm2State(pm2);
  const unhealthyBefore = services.filter((item) => item.status !== "online");
  const restarted = [];

  if (settings.autoRestartEnabled && !manual && !noRestart) {
    if (unhealthyBefore.some((service) => service.status === "missing")) {
      await run(pm2, ["resurrect"], { timeout: 90_000 }).catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 4000));
      services = await pm2State(pm2);
    }

    for (const service of services.filter((item) => item.status !== "online")) {
      await run(pm2, ["restart", service.name], { timeout: 60_000 }).catch(() => undefined);
      restarted.push(service.name);
    }
    if (restarted.length) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 4000));
      services = await pm2State(pm2);
    }
  }

  for (const service of services) {
    const status = service.status === "online" ? (restarted.includes(service.name) ? "warning" : "ok") : "critical";
    checks.push(check(
      `pm2.${service.name}`,
      `Процесс ${service.name}`,
      status,
      status === "ok" ? "Работает" : status === "warning" ? "Автоматически перезапущен" : `Состояние: ${service.status}`,
      service,
    ));
  }

  const api = await httpCheck("http://127.0.0.1:4001/api/health");
  checks.push(check("http.api", "API", api.ok && api.status === 200 ? "ok" : "critical", api.ok ? `HTTP ${api.status}, ${api.durationMs} мс` : api.error || "API недоступен", api));
  const web = await httpCheck("http://127.0.0.1:3000/");
  checks.push(check("http.web", "Сайт", web.ok ? "ok" : "critical", web.ok ? `HTTP ${web.status}, ${web.durationMs} мс` : web.error || "WEB недоступен", web));

  const database = await queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'shopCount', (SELECT COUNT(*)::int FROM shops),
      'orderCount', (SELECT COUNT(*)::int FROM orders),
      'problemOrders', (SELECT COUNT(*)::int FROM orders WHERE status = 'problem'),
      'staleOrders', (
        SELECT COUNT(*)::int
        FROM orders
        WHERE status NOT IN ('delivered', 'cancelled')
          AND updated_at < NOW() - (${settings.staleOrderMinutes}::text || ' minutes')::interval
      ),
      'pendingBouquetApprovals', (
        SELECT COUNT(*)::int
        FROM orders
        WHERE metadata #>> '{bouquetApproval,status}' = 'pending'
          AND updated_at < NOW() - INTERVAL '2 hours'
      ),
      'deliveredWithoutPhoto', (
        SELECT COUNT(*)::int
        FROM orders
        WHERE status = 'delivered'
          AND COALESCE(metadata #>> '{delivery,proofPhotoUrl}', '') = ''
      ),
      'failedNotifications', (
        SELECT COUNT(*)::int FROM notification_events WHERE status = 'failed'
      ),
      'stalePendingPayments', (
        SELECT COUNT(*)::int
        FROM payments
        WHERE status = 'pending'
          AND updated_at < NOW() - INTERVAL '45 minutes'
      )
    )::text
  `);
  checks.push(check("database", "PostgreSQL", "ok", `Доступна, заказов: ${Number(database.orderCount || 0)}`, database));

  const operationsWarnings = Number(database.problemOrders || 0)
    + Number(database.staleOrders || 0)
    + Number(database.pendingBouquetApprovals || 0)
    + Number(database.deliveredWithoutPhoto || 0)
    + Number(database.failedNotifications || 0)
    + Number(database.stalePendingPayments || 0);
  checks.push(check(
    "operations",
    "Операционные предупреждения",
    operationsWarnings > 0 ? "warning" : "ok",
    operationsWarnings > 0 ? `Найдено предупреждений: ${operationsWarnings}` : "Критичных зависаний не найдено",
    database,
  ));

  const disk = await diskInfo(df);
  const diskStatus = disk.usagePercent >= settings.diskCriticalPercent
    ? "critical"
    : disk.usagePercent >= settings.diskWarningPercent
      ? "warning"
      : "ok";
  checks.push(check("disk", "Диск", diskStatus, `Использовано ${disk.usagePercent}%`, disk));

  let ssl = null;
  try {
    ssl = await sslInfo(envValues.APP_URL || "https://viberimenya.ru", openssl);
    if (ssl.applicable) {
      const sslStatus = ssl.daysRemaining < 7 ? "critical" : ssl.daysRemaining < 21 ? "warning" : "ok";
      checks.push(check("ssl", "SSL-сертификат", sslStatus, `Осталось ${ssl.daysRemaining} дней`, ssl));
    } else {
      checks.push(check("ssl", "SSL-сертификат", "warning", "APP_URL не использует HTTPS", ssl));
    }
  } catch (error) {
    checks.push(check("ssl", "SSL-сертификат", "warning", error instanceof Error ? error.message : String(error)));
  }

  const lastBackup = await readJson(BACKUP_STATUS_PATH, null);
  let backupAgeHours = null;
  if (lastBackup?.completedAt) {
    backupAgeHours = (Date.now() - new Date(lastBackup.completedAt).getTime()) / (60 * 60 * 1000);
  }
  const backupStatus = lastBackup?.status === "running"
    ? "warning"
    : !lastBackup?.ok
      ? "critical"
      : backupAgeHours === null || backupAgeHours > 36
        ? "critical"
        : backupAgeHours > 26
          ? "warning"
          : "ok";
  checks.push(check(
    "backup",
    "Резервная копия",
    backupStatus,
    lastBackup?.ok ? `Возраст: ${backupAgeHours?.toFixed(1) || "?"} ч.` : lastBackup?.error || "Резервная копия ещё не создана",
    lastBackup,
  ));

  const overall = worstStatus(checks);
  const problems = checks.filter((item) => item.status !== "ok");
  const notificationProblems = problems.filter((item) => (
    item.key !== "operations" || settings.operationalAlertsEnabled
  ));
  const notificationOverall = notificationProblems.length
    ? worstStatus(notificationProblems)
    : "ok";
  const notificationFingerprint = notificationProblems
    .map((item) => `${item.key}:${item.status}`)
    .sort()
    .join("|");
  const eventFingerprint = problems
    .map((item) => `${item.key}:${item.status}`)
    .sort()
    .join("|");

  const status = {
    version: 2,
    generatedAt,
    overall,
    manual,
    settings,
    services,
    restarted,
    database,
    disk,
    ssl,
    lastBackup,
    lastNotificationAt: previous?.lastNotificationAt || null,
    lastNotificationFingerprint: previous?.lastNotificationFingerprint || "",
    lastNotifiedOverall: previous?.lastNotifiedOverall || "ok",
    lastEventAt: previous?.lastEventAt || null,
    lastEventFingerprint: previous?.lastEventFingerprint || "",
    checks,
  };

  const previousEventAt = previous?.lastEventAt
    ? new Date(previous.lastEventAt).getTime()
    : 0;
  const shouldAppendEvent = problems.length > 0 && (
    previous?.lastEventFingerprint !== eventFingerprint
    || Date.now() - previousEventAt >= 6 * 60 * 60 * 1000
  );

  if (shouldAppendEvent) {
    await appendEvent({
      type: "health.warning",
      severity: overall,
      message: problems.map((item) => `${item.label}: ${item.message}`).join("; "),
    });
    status.lastEventAt = new Date().toISOString();
    status.lastEventFingerprint = eventFingerprint;
  }

  const previousNotificationAt = previous?.lastNotificationAt
    ? new Date(previous.lastNotificationAt).getTime()
    : 0;
  const repeatMilliseconds = settings.alertRepeatHours * 60 * 60 * 1000;
  const notificationChanged = previous?.lastNotificationFingerprint !== notificationFingerprint;
  const severityIncreased = (
    notificationOverall === "critical"
    && previous?.lastNotifiedOverall !== "critical"
  );
  const repeatExpired = Date.now() - previousNotificationAt >= repeatMilliseconds;
  const shouldNotify = settings.alertsEnabled
    && !manual
    && notificationProblems.length > 0
    && (notificationChanged || severityIncreased || repeatExpired);

  if (shouldNotify) {
    const icon = notificationOverall === "critical" ? "🚨" : "⚠️";
    const lines = notificationProblems.slice(0, 8).map((item) => `• ${item.label}: ${item.message}`);
    const sent = await sendOwnerTelegram(envValues, databaseUrl, [
      `${icon} ВЫБЕРИ МЕНЯ — проверка системы`,
      `Статус: ${notificationOverall === "critical" ? "критично" : "требует внимания"}`,
      ...lines,
      `Повтор одинакового сообщения: не чаще одного раза в ${settings.alertRepeatHours} ч.`,
      `Время: ${new Date(generatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`,
    ].join("\n"));

    if (sent.sent) {
      status.lastNotificationAt = new Date().toISOString();
      status.lastNotificationFingerprint = notificationFingerprint;
      status.lastNotifiedOverall = notificationOverall;
    }
  }

  await writeJsonAtomic(STATUS_PATH, status);
  console.log(JSON.stringify(status));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Операция health уже выполняется") {
    // Параллельный запуск timer не является аварией: действующая проверка уже
    // обновит status.json. Завершаемся успешно, чтобы systemd не помечал сервис failed.
    console.log(JSON.stringify({ ok: true, status: "skipped", reason: "already_running" }));
  } else {
    await appendEvent({ type: "health.failed", severity: "critical", message }).catch(() => undefined);
    console.error(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
} finally {
  await releaseLock().catch(() => undefined);
}
