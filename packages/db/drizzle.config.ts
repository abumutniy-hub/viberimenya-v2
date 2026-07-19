import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPaths = [
  resolve(__dirname, "../../.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    break;
  }
}


const projectRoot = resolve(__dirname, "../..");
const pushRequested = process.argv.some((argument) => argument === "push");
const productionPath = projectRoot === "/var/www/viberimenya-v2";
const productionEnvironment = process.env.NODE_ENV === "production";

if (pushRequested && (productionPath || productionEnvironment)) {
  throw new Error(
    "db:push заблокирован на production. Используйте только проверенные SQL-миграции."
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL
  },
  verbose: true,
  strict: true
});
