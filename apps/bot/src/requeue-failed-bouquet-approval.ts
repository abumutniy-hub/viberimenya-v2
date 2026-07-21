import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const result = await sql.begin(async (transaction) => {
    const deliveryRows = await transaction<{ id: string }[]>`
      UPDATE notification_deliveries delivery
      SET
        status = 'pending',
        attempts = 0,
        next_attempt_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        failed_at = NULL,
        updated_at = NOW()
      FROM notification_outbox outbox
      WHERE outbox.id = delivery.outbox_id
        AND outbox.template_key = 'bouquet_approval_requested'
        AND outbox.created_at > NOW() - INTERVAL '14 days'
        AND delivery.status = 'failed'
      RETURNING delivery.id
    `;

    const outboxRows = await transaction<{ id: string }[]>`
      UPDATE notification_outbox outbox
      SET
        status = 'pending',
        attempts = 0,
        next_attempt_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        dead_at = NULL,
        updated_at = NOW()
      WHERE outbox.template_key = 'bouquet_approval_requested'
        AND outbox.created_at > NOW() - INTERVAL '14 days'
        AND outbox.status IN ('dead', 'partial', 'pending')
        AND EXISTS (
          SELECT 1
          FROM notification_deliveries delivery
          WHERE delivery.outbox_id = outbox.id
            AND delivery.status = 'pending'
        )
      RETURNING outbox.id
    `;

    const legacyRows = await transaction<{ id: string }[]>`
      UPDATE notification_events event
      SET
        status = 'pending',
        attempts = 0,
        error = NULL,
        sent_at = NULL,
        updated_at = NOW()
      WHERE event.type = 'bouquet_approval_requested'
        AND event.created_at > NOW() - INTERVAL '14 days'
        AND event.status = 'failed'
        AND EXISTS (
          SELECT 1
          FROM notification_outbox outbox
          WHERE outbox.source_notification_event_id = event.id
            AND outbox.status = 'pending'
        )
      RETURNING event.id
    `;

    return {
      deliveries: deliveryRows.length,
      outbox: outboxRows.length,
      legacy: legacyRows.length,
    };
  });

  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await sql.end();
}
