import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPaths = [
  resolve(__dirname, "../../../.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    break;
  }
}

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  });

  const db = drizzle(client, { schema });

  return { client, db };
}
