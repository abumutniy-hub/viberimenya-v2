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
  journal.entries.length !== 3
) {
  throw new Error(
    "Drizzle journal должен содержать baseline, Event Core и Payment Core migration"
  );
}

for (let index = 0; index < journal.entries.length; index += 1) {
  const entry = journal.entries[index];

  if (
    entry.idx !== index ||
    !Number.isSafeInteger(entry.when) ||
    typeof entry.tag !== "string" ||
    !entry.tag
  ) {
    throw new Error(
      `Некорректная запись journal с индексом ${index}`
    );
  }
}

const baselineEntry = journal.entries[0];
const eventCoreEntry = journal.entries[1];
const paymentCoreEntry = journal.entries[2];

if (!baselineEntry.tag.includes("canonical_production_baseline")) {
  throw new Error("Первая migration не является canonical baseline");
}

if (!eventCoreEntry.tag.includes("event_core_outbox")) {
  throw new Error("Вторая migration не является Event Core migration");
}

if (!paymentCoreEntry.tag.includes("payment_core_yookassa")) {
  throw new Error("Третья migration не является Payment Core migration");
}

const sqlFiles = readdirSync(drizzleDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const snapshotFiles = readdirSync(metaDir)
  .filter((name) => name.endsWith("_snapshot.json"))
  .sort();

if (
  sqlFiles.length !== journal.entries.length ||
  snapshotFiles.length !== journal.entries.length
) {
  throw new Error(
    "Количество SQL/snapshot не совпадает с Drizzle journal"
  );
}

const migrationHashes = [];

for (const entry of journal.entries) {
  const sqlName = `${entry.tag}.sql`;

  if (!sqlFiles.includes(sqlName)) {
    throw new Error(`SQL-файл journal не найден: ${sqlName}`);
  }

  const source = readFileSync(
    resolve(drizzleDir, sqlName),
    "utf8",
  );

  if (
    source.includes("__drizzle_migrations") ||
    /(^|\n)\s*\\/.test(source)
  ) {
    throw new Error(
      `Migration ${sqlName} содержит служебную таблицу или psql meta-command`
    );
  }

  migrationHashes.push({
    hash: createHash("sha256")
      .update(source)
      .digest("hex"),
    when: entry.when,
    tag: entry.tag,
    source,
  });
}

const baseline = migrationHashes[0].source;
const baselineTableCount = (
  baseline.match(/^CREATE TABLE\s+"public"\./gm) || []
).length;

if (
  baselineTableCount !== 32 ||
  !baseline.includes("notification_events_customer_copy_trg")
) {
  throw new Error("Canonical baseline повреждён");
}

const eventCore = migrationHashes[1].source;
const requiredEventCoreFragments = [
  'CREATE TABLE "domain_events"',
  'CREATE TABLE "notification_outbox"',
  'CREATE TABLE "notification_deliveries"',
  'enqueue_notification_event_outbox',
  'notification_events_outbox_enqueue_trg',
  'notification_events_outbox_sync_trg',
];

for (const fragment of requiredEventCoreFragments) {
  if (!eventCore.includes(fragment)) {
    throw new Error(
      `Event Core migration не содержит: ${fragment}`
    );
  }
}

if (
  /DROP\s+TABLE/i.test(eventCore) ||
  /DROP\s+COLUMN/i.test(eventCore) ||
  /ALTER\s+TYPE[^;]+DROP/i.test(eventCore)
) {
  throw new Error("Event Core migration содержит destructive DDL");
}

const paymentCore = migrationHashes[2].source;
const requiredPaymentCoreFragments = [
  'ADD VALUE \'created\'',
  'ADD VALUE \'waiting_for_capture\'',
  'ADD VALUE \'partially_refunded\'',
  'ADD VALUE \'expired\'',
  'CREATE TABLE "payment_events"',
  '"idempotency_key" varchar(64)',
  'payments_order_attempt_uidx',
];

for (const fragment of requiredPaymentCoreFragments) {
  if (!paymentCore.includes(fragment)) {
    throw new Error(
      `Payment Core migration не содержит: ${fragment}`
    );
  }
}

if (
  /DROP\s+TABLE/i.test(paymentCore) ||
  /DROP\s+COLUMN/i.test(paymentCore) ||
  /ALTER\s+TYPE[^;]+DROP/i.test(paymentCore)
) {
  throw new Error("Payment Core migration содержит destructive DDL");
}

const latestSnapshotPath = resolve(
  metaDir,
  snapshotFiles[snapshotFiles.length - 1],
);
const latestSnapshot = JSON.parse(
  readFileSync(latestSnapshotPath, "utf8"),
);
const snapshotTables = Object.values(
  latestSnapshot.tables || {},
);
const snapshotTableCount = snapshotTables.length;
const snapshotColumnCount = snapshotTables.reduce(
  (sum, table) =>
    sum + Object.keys(table.columns || {}).length,
  0,
);

if (
  snapshotTableCount !== 36 ||
  snapshotColumnCount !== 460
) {
  throw new Error(
    `Payment Core snapshot: ${snapshotTableCount} tables / ${snapshotColumnCount} columns`
  );
}

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

if (rows.length !== migrationHashes.length) {
  throw new Error(
    `В production migration journal найдено строк: ${rows.length}`
  );
}

for (let index = 0; index < rows.length; index += 1) {
  const [databaseHash, createdAtRaw] = rows[index].split("\t");
  const expected = migrationHashes[index];

  if (
    databaseHash !== expected.hash ||
    Number(createdAtRaw) !== expected.when
  ) {
    throw new Error(
      `Migration metadata не совпадает: ${expected.tag}`
    );
  }
}

const legacyReadme = resolve(
  projectRoot,
  "packages/db/migrations/README.md",
);

if (!existsSync(legacyReadme)) {
  throw new Error("Не найдено описание legacy migrations");
}

console.log(
  "Migration integrity confirmed: " +
  `${paymentCoreEntry.tag}, 36 tables, 460 columns, ` +
  "production metadata aligned."
);
