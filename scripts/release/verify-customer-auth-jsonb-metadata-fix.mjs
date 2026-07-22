import { readFile } from "node:fs/promises";

const files = {
  apiPairing: "apps/api/src/modules/customers/customer-pairing.service.ts",
  apiSecurity: "apps/api/src/modules/customers/customer-session-security.service.ts",
  publicRoute: "apps/api/src/routes/public.ts",
  apiE2e: "apps/api/src/verify-browser-telegram-pairing-e2e.ts",
  apiProofE2e: "apps/api/src/verify-customer-pairing-browser-proof-e2e.ts",
  repair: "apps/api/src/repair-customer-pairing-metadata.ts",
  driverPreflight: "apps/api/src/verify-postgres-jsonb-text-cast-preflight.ts",
  botCore: "apps/bot/src/customer-browser-pairing.ts",
  botIndex: "apps/bot/src/index.ts",
  botE2e: "apps/bot/src/verify-browser-telegram-pairing-e2e.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(path, "utf8"),
    ]),
  ),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const combined = Object.values(source).join("\n");

assert(
  !combined.includes("sql.json(")
    && !combined.includes("client.json(")
    && !combined.includes("transaction.json("),
  "API и BOT не используют несовместимый postgres.js json helper",
);
assert(
  source.botIndex.includes("metadata = metadata || ${JSON.stringify({")
    && source.botIndex.includes("})}::text::jsonb")
    && !source.botIndex.includes("metadata = metadata || ${{"),
  "бот передаёт JSONB patch как текст с явным ::text::jsonb",
);
assert(
  source.publicRoute.includes("metadata = metadata || ${JSON.stringify({")
    && source.publicRoute.includes("})}::text::jsonb")
    && source.publicRoute.includes("${JSON.stringify({")
    && !source.publicRoute.includes("metadata = metadata || ${{"),
  "API передаёт pairing metadata как текст с явным ::text::jsonb",
);
assert(
  source.apiPairing.includes("normalizeCustomerPairingMetadata"),
  "API восстанавливает legacy JSONB array/string до объекта",
);
assert(
  source.botCore.includes("normalizeBrowserPairingMetadata"),
  "бот восстанавливает legacy JSONB array/string до объекта",
);
assert(
  source.publicRoute.includes("normalizeCustomerPairingMetadata(\n            pairing.metadata"),
  "status endpoint читает восстановленную metadata",
);
assert(
  source.apiE2e.includes("jsonb_typeof(metadata) AS metadata_type")
    && source.apiE2e.includes("browser_nonce_hash === nonceHash")
    && source.apiE2e.includes("confirmed_telegram_id === telegramId"),
  "DB E2E проверяет object-тип и сохранность browser proof после Telegram",
);
assert(
  source.apiProofE2e.includes("двойное JSON-кодирование"),
  "browser-proof E2E покрывает двойное JSON-кодирование",
);
assert(
  source.botE2e.includes("legacy JSONB array/string"),
  "bot E2E покрывает повреждённую legacy metadata",
);
assert(
  source.repair.includes("JSON.stringify(metadata)}::text::jsonb")
    && source.repair.includes("jsonb_typeof(metadata) IS DISTINCT FROM 'object'")
    && source.repair.includes("remainingActiveMalformed"),
  "добавлен безопасный ремонт уже повреждённых pairing-запросов",
);
assert(
  source.apiSecurity.includes("${JSON.stringify({")
    && source.apiSecurity.includes("})}::text::jsonb")
    && !source.apiSecurity.includes("${{"),
  "customer security audit использует JSON text cast",
);
assert(
  source.driverPreflight.includes("JSON.stringify({")
    && source.driverPreflight.includes("::text::jsonb")
    && source.driverPreflight.includes("jsonb_typeof(metadata)")
    && source.driverPreflight.includes("browser_nonce_hash")
    && !source.driverPreflight.includes(".json("),
  "добавлен реальный JSONB text-cast preflight",
);

console.log("\nCUSTOMER AUTH JSONB TEXT CAST SOURCE CONTRACT: OK");
