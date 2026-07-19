#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const resolvedRoot = existsSync(projectRoot)
  ? realpathSync(projectRoot)
  : projectRoot;

const isProductionPath =
  resolvedRoot === "/var/www/viberimenya-v2";
const isProductionEnvironment =
  process.env.NODE_ENV === "production";

if (isProductionPath || isProductionEnvironment) {
  console.error("");
  console.error("BLOCKED: db:push запрещён на production.");
  console.error(
    "Причина: push может изменить или удалить живые объекты базы без проверенной миграции."
  );
  console.error(
    "Используйте только versioned SQL migration с backup, restore-check и rollback."
  );
  process.exit(64);
}

console.log("db:push разрешён только вне production.");
