#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot =
  process.env.VIBERIMENYA_PROJECT_ROOT ||
  "/var/www/viberimenya-v2";

function loadEnv(path) {
  const result = {};
  const source = readFileSync(path, "utf8");

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function parseDeclaredSchema(source) {
  const tables = new Map();
  let offset = 0;

  while (offset < source.length) {
    const tail = source.slice(offset);
    const match = tail.match(
      /export const\s+\w+\s*=\s*pgTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/
    );

    if (!match || match.index === undefined) {
      break;
    }

    const tableName = match[1];
    const objectStart =
      offset + match.index + match[0].length - 1;

    let depth = 0;
    let quote = null;
    let escaped = false;
    let cursor = objectStart;

    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];

      if (quote !== null) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (
        character === "'" ||
        character === '"' ||
        character === "`"
      ) {
        quote = character;
        continue;
      }

      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;

        if (depth === 0) {
          break;
        }
      }
    }

    const body = source.slice(objectStart + 1, cursor);
    const columns = new Set();

    for (const columnMatch of body.matchAll(
      /\b\w+\s*:\s*\w+\s*\(\s*["']([^"']+)["']/g
    )) {
      columns.add(columnMatch[1]);
    }

    if (body.includes("...timestamps")) {
      columns.add("created_at");
      columns.add("updated_at");
    }

    tables.set(tableName, columns);
    offset = cursor + 1;
  }

  return tables;
}

const env = {
  ...loadEnv(resolve(projectRoot, ".env")),
  ...process.env,
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL не найден");
}

const schemaSource = readFileSync(
  resolve(projectRoot, "packages/db/src/schema.ts"),
  "utf8"
);
const declared = parseDeclaredSchema(schemaSource);

const sql = `
SELECT
  table_name,
  column_name
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
`;

const output = execFileSync(
  "psql",
  [
    `--dbname=${env.DATABASE_URL}`,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-A",
    "-t",
    "-F",
    "\t",
    "-c",
    sql,
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: "10",
    },
    maxBuffer: 16 * 1024 * 1024,
  }
);

const live = new Map();

for (const line of output.split(/\r?\n/)) {
  if (!line.trim()) {
    continue;
  }

  const [tableName, columnName] = line.split("\t");

  if (!live.has(tableName)) {
    live.set(tableName, new Set());
  }

  live.get(tableName).add(columnName);
}

const allTables = new Set([
  ...declared.keys(),
  ...live.keys(),
]);

const problems = [];

for (const tableName of [...allTables].sort()) {
  const declaredColumns = declared.get(tableName);
  const liveColumns = live.get(tableName);

  if (!declaredColumns) {
    problems.push(
      `Таблица есть в БД, но отсутствует в schema.ts: ${tableName}`
    );
    continue;
  }

  if (!liveColumns) {
    problems.push(
      `Таблица есть в schema.ts, но отсутствует в БД: ${tableName}`
    );
    continue;
  }

  for (const columnName of [...liveColumns].sort()) {
    if (!declaredColumns.has(columnName)) {
      problems.push(
        `Колонка есть в БД, но отсутствует в schema.ts: ${tableName}.${columnName}`
      );
    }
  }

  for (const columnName of [...declaredColumns].sort()) {
    if (!liveColumns.has(columnName)) {
      problems.push(
        `Колонка есть в schema.ts, но отсутствует в БД: ${tableName}.${columnName}`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Обнаружен schema drift:");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

const columnCount = [...live.values()].reduce(
  (sum, columns) => sum + columns.size,
  0
);

console.log(
  `Schema parity confirmed: ${live.size} tables, ${columnCount} columns.`
);
