#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const projectRoot =
  process.env.VIBERIMENYA_PROJECT_ROOT ||
  "/var/www/viberimenya-v2";

function loadEnv(path) {
  const values = {};

  if (!existsSync(path)) {
    return values;
  }

  const source = readFileSync(path, "utf8");

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("=")
    ) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      value.length >= 2 &&
      (
        (
          value.startsWith('"') &&
          value.endsWith('"')
        ) ||
        (
          value.startsWith("'") &&
          value.endsWith("'")
        )
      )
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

const env = {
  ...loadEnv(resolve(projectRoot, ".env")),
  ...process.env,
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL не найден");
}

const drizzleDir = resolve(
  projectRoot,
  "packages/db/drizzle",
);
const metaDir = resolve(drizzleDir, "meta");
const journalPath = resolve(metaDir, "_journal.json");

const journal = JSON.parse(
  readFileSync(journalPath, "utf8"),
);

if (
  journal.version !== "7" ||
  journal.dialect !== "postgresql" ||
  !Array.isArray(journal.entries) ||
  journal.entries.length !== 1
) {
  throw new Error(
    "Drizzle journal должен содержать ровно один baseline"
  );
}

const entry = journal.entries[0];

if (
  entry.idx !== 0 ||
  !Number.isSafeInteger(entry.when) ||
  !entry.tag.includes("canonical_production_baseline")
) {
  throw new Error(
    "Некорректная запись canonical baseline в journal"
  );
}

const sqlFiles = readdirSync(drizzleDir)
  .filter((name) => name.endsWith(".sql"));

const snapshotFiles = readdirSync(metaDir)
  .filter(
    (name) =>
      name.endsWith("_snapshot.json")
  );

if (
  sqlFiles.length !== 1 ||
  snapshotFiles.length !== 1
) {
  throw new Error(
    "В активном Drizzle baseline должен быть один SQL и один snapshot"
  );
}

const expectedSqlName = `${entry.tag}.sql`;

if (!sqlFiles.includes(expectedSqlName)) {
  throw new Error(
    `SQL-файл journal не найден: ${expectedSqlName}`
  );
}

const sqlPath = resolve(
  drizzleDir,
  expectedSqlName,
);
const sqlSource = readFileSync(sqlPath, "utf8");

if (
  sqlSource.includes("__drizzle_migrations") ||
  /(^|\n)\s*\\/.test(sqlSource)
) {
  throw new Error(
    "Baseline содержит служебную Drizzle-таблицу или psql meta-command"
  );
}

const tableCount = (
  sqlSource.match(
    /^CREATE TABLE\s+"public"\./gm,
  ) || []
).length;

if (tableCount !== 32) {
  throw new Error(
    `Baseline содержит ${tableCount} public tables вместо 32`
  );
}

if (
  !sqlSource.includes(
    "notification_events_customer_copy_trg"
  )
) {
  throw new Error(
    "В baseline отсутствует production trigger"
  );
}

const snapshot = JSON.parse(
  readFileSync(
    resolve(metaDir, snapshotFiles[0]),
    "utf8",
  ),
);

const snapshotTables = Object.values(
  snapshot.tables || {},
);
const snapshotTableCount = snapshotTables.length;
const snapshotColumnCount = snapshotTables.reduce(
  (sum, table) =>
    sum + Object.keys(table.columns || {}).length,
  0,
);

if (
  snapshotTableCount !== 32 ||
  snapshotColumnCount !== 374
) {
  throw new Error(
    "Snapshot не соответствует 32 таблицам и 374 колонкам"
  );
}

const hash = createHash("sha256")
  .update(sqlSource)
  .digest("hex");

const query = `
SELECT
  hash,
  created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;
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
    query,
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: "10",
    },
  },
);

const rows = output
  .split(/\r?\n/)
  .filter((line) => line.trim());

if (rows.length !== 1) {
  throw new Error(
    `В production migration journal найдено строк: ${rows.length}`
  );
}

const [databaseHash, createdAtRaw] =
  rows[0].split("\t");
const createdAt = Number(createdAtRaw);

if (
  databaseHash !== hash ||
  createdAt !== entry.when
) {
  throw new Error(
    "Production migration metadata не совпадает с baseline"
  );
}

const legacyReadme = resolve(
  projectRoot,
  "packages/db/migrations/README.md",
);

if (!existsSync(legacyReadme)) {
  throw new Error(
    "Не найдено описание legacy migrations"
  );
}

console.log(
  "Migration integrity confirmed: " +
  `${entry.tag}, 32 tables, 374 columns, ` +
  "production metadata aligned."
);
