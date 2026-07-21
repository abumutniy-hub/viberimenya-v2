import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

const primaryEnvPath = resolve(__dirname, "../../../../.env");

const envPaths = [
  primaryEnvPath,
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

let loadedEnvPath = primaryEnvPath;

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    loadedEnvPath = envPath;
    break;
  }
}

export const ENV_FILE_PATH = loadedEnvPath;

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  APP_NAME: process.env.APP_NAME ?? "ВЫБЕРИ МЕНЯ",
  APP_URL: process.env.APP_URL ?? "http://45.88.172.241",
  API_URL: process.env.API_URL ?? "http://45.88.172.241/api",
  API_HOST: process.env.API_HOST ?? "127.0.0.1",
  API_PORT: Number(process.env.API_PORT ?? 4001),
  DEFAULT_SHOP_SLUG: process.env.DEFAULT_SHOP_SLUG ?? "viberimenya",
  DATABASE_URL: process.env.DATABASE_URL,
  YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID ?? "",
  YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY ?? "",
  YOOKASSA_RECEIPTS_ENABLED:
    String(process.env.YOOKASSA_RECEIPTS_ENABLED ?? "false").toLowerCase() === "true",
  YOOKASSA_TEST_MODE:
    String(process.env.YOOKASSA_TEST_MODE ?? "true").toLowerCase() !== "false",
  YOOKASSA_VAT_CODE: Math.min(
    6,
    Math.max(1, Number(process.env.YOOKASSA_VAT_CODE ?? 1) || 1),
  ),
  YOOKASSA_TAX_SYSTEM_CODE: Math.min(
    6,
    Math.max(0, Number(process.env.YOOKASSA_TAX_SYSTEM_CODE ?? 0) || 0),
  ),
  YOOKASSA_PAYMENT_MODE:
    process.env.YOOKASSA_PAYMENT_MODE ?? "full_payment",
  YOOKASSA_PAYMENT_SUBJECT:
    process.env.YOOKASSA_PAYMENT_SUBJECT ?? "commodity",
  PAYMENT_PENDING_TTL_MINUTES: Math.min(
    24 * 60,
    Math.max(10, Number(process.env.PAYMENT_PENDING_TTL_MINUTES ?? 180) || 180),
  ),
  PAYMENT_EXPIRY_SWEEP_INTERVAL_MS: Math.min(
    15 * 60_000,
    Math.max(30_000, Number(process.env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS ?? 60_000) || 60_000),
  )
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
