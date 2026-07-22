import { createDb } from "@viberimenya/db";

type ProbeResult = {
  status: string | null;
  note: string | null;
  revision_count: number | null;
  event_type: string | null;
  payload_note: string | null;
  metadata_type: string | null;
};

const { client } = createDb();

async function runProbe(
  action: "approve" | "revision",
  note: string | null,
): Promise<ProbeResult> {
  return client.begin(async (sql) => {
    await sql`
      CREATE TEMP TABLE vm_bouquet_approval_probe (
        id integer PRIMARY KEY,
        metadata jsonb NOT NULL,
        event_type text,
        payload jsonb
      ) ON COMMIT DROP
    `;

    await sql`
      INSERT INTO vm_bouquet_approval_probe (id, metadata)
      VALUES (
        1,
        '{"bouquetApproval":{"status":"pending","revisionCount":0}}'::jsonb
      )
    `;

    const nextStatus = action === "approve" ? "approved" : "revision_requested";
    const eventType = action === "approve"
      ? "bouquet_approved"
      : "bouquet_revision_requested";

    await sql`
      UPDATE vm_bouquet_approval_probe
      SET metadata = jsonb_set(
            metadata,
            '{bouquetApproval}',
            COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
              || jsonb_build_object(
                'status', ${nextStatus}::text,
                'decidedAt', NOW(),
                'note', ${note}::text,
                'source', 'tracking_page',
                'revisionCount', CASE
                  WHEN ${action}::text = 'revision'
                  THEN COALESCE(
                    NULLIF(
                      metadata #>> '{bouquetApproval,revisionCount}',
                      ''
                    )::int,
                    0
                  ) + 1
                  ELSE COALESCE(
                    NULLIF(
                      metadata #>> '{bouquetApproval,revisionCount}',
                      ''
                    )::int,
                    0
                  )
                END
              ),
            true
          ),
          event_type = ${eventType}::text,
          payload = jsonb_build_object(
            'note', ${note}::text,
            'source', 'tracking_page'
          )
      WHERE id = 1
    `;

    const rows = await sql<ProbeResult[]>`
      SELECT
        metadata #>> '{bouquetApproval,status}' AS status,
        metadata #>> '{bouquetApproval,note}' AS note,
        COALESCE(
          NULLIF(metadata #>> '{bouquetApproval,revisionCount}', '')::int,
          0
        ) AS revision_count,
        event_type,
        payload ->> 'note' AS payload_note,
        jsonb_typeof(metadata) AS metadata_type
      FROM vm_bouquet_approval_probe
      WHERE id = 1
    `;

    const result = rows[0];
    if (!result) throw new Error("TEMP TABLE не вернула результат");
    return result;
  });
}

try {
  const approved = await runProbe("approve", null);
  if (
    approved.status !== "approved"
    || approved.note !== null
    || approved.revision_count !== 0
    || approved.event_type !== "bouquet_approved"
    || approved.payload_note !== null
    || approved.metadata_type !== "object"
  ) {
    throw new Error(`Неверный approve result: ${JSON.stringify(approved)}`);
  }

  const revision = await runProbe("revision", "Сделать упаковку светлее");
  if (
    revision.status !== "revision_requested"
    || revision.note !== "Сделать упаковку светлее"
    || revision.revision_count !== 1
    || revision.event_type !== "bouquet_revision_requested"
    || revision.payload_note !== "Сделать упаковку светлее"
    || revision.metadata_type !== "object"
  ) {
    throw new Error(`Неверный revision result: ${JSON.stringify(revision)}`);
  }

  console.log(JSON.stringify({ ok: true, approved, revision }));
  console.log("BOUQUET_APPROVAL_ENDPOINT_SQL_PREFLIGHT: OK");
} finally {
  await client.end();
}
