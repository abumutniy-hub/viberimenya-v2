import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPaths = [
  resolve(__dirname, "../../../../.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    break;
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  APP_NAME: process.env.APP_NAME ?? "ВЫБЕРИ МЕНЯ",
  APP_URL: process.env.APP_URL ?? "http://45.88.172.241",
  API_URL: process.env.API_URL ?? "http://45.88.172.241/api",
  API_HOST: process.env.API_HOST ?? "127.0.0.1",
  API_PORT: Number(process.env.API_PORT ?? 4001),
  DEFAULT_SHOP_SLUG: process.env.DEFAULT_SHOP_SLUG ?? "viberimenya",
  DATABASE_URL: process.env.DATABASE_URL
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
