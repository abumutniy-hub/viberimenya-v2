#!/usr/bin/env node
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  console.log(`✓ ${message}`);
}

const [
  schema,
  migration,
  journal,
  snapshot,
  config,
  dbService,
  dbIndex,
  apiE2e,
  migrationCheck
] = await Promise.all([
  text("packages/db/src/schema.ts"),
  text("packages/db/drizzle/0003_multi_channel_foundation.sql"),
  text("packages/db/drizzle/meta/_journal.json"),
  text("packages/db/drizzle/meta/0003_snapshot.json"),
  text("packages/config/src/multi-channel.ts"),
  text("packages/db/src/multi-channel.ts"),
  text("packages/db/src/index.ts"),
  text("apps/api/src/verify-multi-channel-foundation-e2e.ts"),
  text("scripts/db/check-migration-integrity.mjs")
]);

assertCondition(
  schema.includes('export const channelUpdates = pgTable('),
  "channel_updates описана в Drizzle schema"
);
assertCondition(
  schema.includes('providerChatId: varchar("provider_chat_id"')
    && schema.includes('notificationsEnabled: boolean("notifications_enabled"')
    && schema.includes('metadata: jsonb("metadata")'),
  "customer_channel_links расширена универсальными полями"
);
assertCondition(
  migration.includes('CREATE TABLE "channel_updates"')
    && migration.includes('legacyTelegramAccountId')
    && migration.includes('telegram_account."notifications_enabled"')
    && migration.includes('channel_updates_provider_uidx')
    && migration.includes('channel_updates_status_check'),
  "versioned migration содержит ingestion table, idempotency и guards"
);
assertCondition(
  !/DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TYPE[^;]+DROP/i.test(migration),
  "migration не содержит destructive DDL"
);
assertCondition(
  journal.includes('0003_multi_channel_foundation'),
  "Drizzle journal содержит migration 0003"
);

const snapshotJson = JSON.parse(snapshot);
const snapshotTables = Object.values(snapshotJson.tables ?? {});
const snapshotColumns = snapshotTables.reduce(
  (sum, table) => sum + Object.keys(table.columns ?? {}).length,
  0
);
assertCondition(
  snapshotTables.length === 37 && snapshotColumns === 482,
  "snapshot содержит 37 таблиц / 482 колонки"
);
assertCondition(
  config.includes('"site",\n  "telegram",\n  "max"')
    && config.includes("maxEnabled: false")
    && config.includes("maxMiniAppEnabled: false")
    && config.includes("referralsEnabled: false")
    && config.includes("export interface ChannelProviderAdapter"),
  "provider registry и feature flags безопасно выключены по умолчанию"
);
assertCondition(
  dbService.includes("WHERE customer_channel_links.customer_id = EXCLUDED.customer_id")
    && dbService.includes("ChannelIdentityConflictError"),
  "CustomerChannelService запрещает перехват внешней identity"
);
assertCondition(
  dbService.includes("ON CONFLICT (shop_id, provider, external_update_id)")
    && dbService.includes("NOT EXISTS (SELECT 1 FROM inserted)"),
  "channel update ingestion идемпотентен"
);
assertCondition(
  dbService.includes("::text::jsonb"),
  "JSONB записывается через проверенный text cast"
);
assertCondition(
  dbService.includes(
    "const verifiedAt = input.verifiedAt?.toISOString() ?? null;"
  )
    && dbService.includes("${verifiedAt}::timestamptz")
    && !dbService.includes("${input.verifiedAt ?? null}::timestamptz"),
  "Date нормализуется в ISO string до передачи postgres.js"
);
assertCondition(
  dbIndex.includes('export * from "./multi-channel";'),
  "multi-channel DB service экспортирован"
);
assertCondition(
  apiE2e.includes("ChannelIdentityConflictError")
    && apiE2e.includes("duplicateUpdate.created")
    && apiE2e.includes("RollbackProbe"),
  "E2E проверяет конфликт identity, duplicate update и rollback"
);
assertCondition(
  apiE2e.includes("const resultRef: { current: Record<string, unknown> | null }")
    && apiE2e.includes("resultRef.current = {")
    && apiE2e.includes("const result = resultRef.current;")
    && !apiE2e.includes("let result: Record<string, unknown> | null = null;"),
  "E2E result сохраняет тип после async callback без TS2698"
);
assertCondition(
  migrationCheck.includes("37 tables, 482 columns")
    && migrationCheck.includes("Multi-channel Foundation migration"),
  "migration integrity обновлён под новый canonical state"
);
assertCondition(
  migrationCheck.includes(
    "`ADD COLUMN \"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL`"
  )
    && !migrationCheck.includes(
      "'ADD COLUMN \"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL'"
    ),
  "migration integrity JSONB fragment использует валидный JavaScript literal"
);

console.log("MULTI-CHANNEL FOUNDATION SOURCE CONTRACT: OK");
