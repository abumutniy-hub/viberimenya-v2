#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  BACKUP_STATUS_PATH,
  EVENTS_PATH,
  PROJECT_ROOT,
  RESTORE_STATUS_PATH,
  STATUS_PATH,
  listAutomaticBackups,
  loadRuntime,
  readJson,
} from "./lib.mjs";

function redact(value) {
  return String(value || "")
    .replace(/(password|secret|token|key)(["'\s:=]+)[^\s,"'}]+/gi, "$1$2[СКРЫТО]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[СКРЫТО]");
}

const status = await readJson(STATUS_PATH, {});
const backup = await readJson(BACKUP_STATUS_PATH, {});
const restore = await readJson(RESTORE_STATUS_PATH, {});
const runtime = await loadRuntime();
const backups = await listAutomaticBackups(10);
let events = [];
try {
  events = (await readFile(EVENTS_PATH, "utf8")).trim().split(/\r?\n/).slice(-50).map((line) => {
    try { return JSON.parse(line); } catch { return { raw: line }; }
  });
} catch {
  events = [];
}

const report = [
  "ДИАГНОСТИЧЕСКИЙ ОТЧЁТ — ВЫБЕРИ МЕНЯ v2",
  `Сформирован: ${new Date().toISOString()}`,
  `Проект: ${PROJECT_ROOT}`,
  "",
  "=== ТЕКУЩИЙ СТАТУС ===",
  JSON.stringify(status, null, 2),
  "",
  "=== ПОСЛЕДНЯЯ РЕЗЕРВНАЯ КОПИЯ ===",
  JSON.stringify(backup, null, 2),
  "",
  "=== ПОСЛЕДНЯЯ ПРОВЕРКА ВОССТАНОВЛЕНИЯ ===",
  JSON.stringify(restore, null, 2),
  "",
  "=== ПОСЛЕДНИЕ АРХИВЫ ===",
  JSON.stringify(backups, null, 2),
  "",
  "=== СИСТЕМНЫЕ ПУТИ (БЕЗ СЕКРЕТОВ) ===",
  JSON.stringify(runtime, null, 2),
  "",
  "=== ПОСЛЕДНИЕ СОБЫТИЯ ===",
  JSON.stringify(events, null, 2),
].join("\n");

process.stdout.write(redact(report));
