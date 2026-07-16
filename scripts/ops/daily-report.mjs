#!/usr/bin/env node
import {
  STATUS_PATH,
  loadEnvFile,
  monitoringSettings,
  queryJson,
  readJson,
  sendOwnerTelegram,
} from "./lib.mjs";

try {
  const envValues = await loadEnvFile();
  const databaseUrl = String(envValues.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL не найден в .env");
  const settings = await monitoringSettings(databaseUrl);
  if (!settings.dailySummaryEnabled) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "daily_summary_disabled" }));
    process.exit(0);
  }
  const status = await readJson(STATUS_PATH, null);
  const metrics = await queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'ordersYesterday', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE)::int,
      'paidYesterday', COUNT(*) FILTER (WHERE payment_status = 'paid' AND created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE)::int,
      'revenueYesterday', COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE), 0)::bigint,
      'problemOrders', COUNT(*) FILTER (WHERE status = 'problem')::int
    )::text
    FROM orders
  `);
  const systemLabel = status?.overall === "ok" ? "в норме" : status?.overall === "critical" ? "критично" : "есть предупреждения";
  const result = await sendOwnerTelegram(envValues, databaseUrl, [
    "🌷 ВЫБЕРИ МЕНЯ — ежедневный отчёт",
    `Заказов вчера: ${Number(metrics.ordersYesterday || 0)}`,
    `Оплачено: ${Number(metrics.paidYesterday || 0)}`,
    `Выручка: ${Number(metrics.revenueYesterday || 0).toLocaleString("ru-RU")} ₽`,
    `Проблемных заказов сейчас: ${Number(metrics.problemOrders || 0)}`,
    `Система: ${systemLabel}`,
  ].join("\n"));
  console.log(JSON.stringify({ ok: result.sent, result }));
  if (!result.sent) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
