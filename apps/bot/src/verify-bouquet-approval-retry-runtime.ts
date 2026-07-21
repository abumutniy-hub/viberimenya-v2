import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });

type DeliveryState = {
  legacy_id: string;
  legacy_status: string;
  legacy_error: string | null;
  outbox_id: string | null;
  outbox_status: string | null;
  outbox_error: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  updated_at: string;
};

function containsOldPhotoUrlFailure(row: DeliveryState) {
  const text = [
    row.legacy_error,
    row.outbox_error,
    row.delivery_error,
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("failed to get http url content")
    || text.includes("wrong type of the web page content");
}

function delivered(row: DeliveryState) {
  return row.legacy_status === "sent"
    || (
      row.outbox_status === "sent"
      && row.delivery_status === "sent"
    );
}

try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await sql<DeliveryState[]>`
      SELECT
        event.id AS legacy_id,
        event.status AS legacy_status,
        event.error AS legacy_error,
        outbox.id AS outbox_id,
        outbox.status AS outbox_status,
        outbox.last_error AS outbox_error,
        delivery.status AS delivery_status,
        delivery.last_error AS delivery_error,
        GREATEST(
          event.updated_at,
          COALESCE(outbox.updated_at, event.updated_at),
          COALESCE(delivery.updated_at, event.updated_at)
        )::text AS updated_at
      FROM notification_events event
      LEFT JOIN notification_outbox outbox
        ON outbox.source_notification_event_id = event.id
      LEFT JOIN notification_deliveries delivery
        ON delivery.outbox_id = outbox.id
       AND delivery.channel = 'telegram'
      WHERE event.type = 'bouquet_approval_requested'
        AND event.created_at > NOW() - INTERVAL '14 days'
      ORDER BY event.created_at DESC, delivery.created_at DESC NULLS LAST
      LIMIT 1
    `;
    const latest = rows[0] ?? null;

    if (!latest) {
      console.log(JSON.stringify({ ok: true, status: "no_recent_event" }));
      break;
    }

    if (delivered(latest)) {
      console.log(JSON.stringify({
        ok: true,
        status: "sent",
        legacyId: latest.legacy_id,
        outboxId: latest.outbox_id,
        updatedAt: latest.updated_at,
      }));
      break;
    }

    if (
      containsOldPhotoUrlFailure(latest)
      && ["failed", "dead"].includes(latest.legacy_status)
    ) {
      throw new Error(
        `Bouquet approval delivery still uses remote photo URL: ${JSON.stringify(latest)}`,
      );
    }

    if (attempt === 29) {
      throw new Error(
        `Bouquet approval delivery did not complete: ${JSON.stringify(latest)}`,
      );
    }

    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
  }
} finally {
  await sql.end();
}
