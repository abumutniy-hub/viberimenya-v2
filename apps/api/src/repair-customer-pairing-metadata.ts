import { createDb } from "@viberimenya/db";
import {
  normalizeCustomerPairingMetadata,
} from "./modules/customers/customer-pairing.service";
import type {
  CustomerSqlExecutor,
} from "./modules/customers/customer-session-security.service";

type PairingRow = {
  id: string;
  status: string;
  metadata: unknown;
};

function requiredHash(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /^sha256:[a-f0-9]{64}$/i.test(text) ? text : "";
}

const { client } = createDb();

try {
  const result = await client.begin(
    async (transaction: CustomerSqlExecutor) => {
      const rows = await transaction<PairingRow[]>`
        SELECT id, status, metadata
        FROM customer_link_tokens
        WHERE provider = 'telegram'
          AND purpose = 'browser_pairing_login'
          AND jsonb_typeof(metadata) IS DISTINCT FROM 'object'
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at ASC
        FOR UPDATE
      `;

      let repaired = 0;
      let expired = 0;

      for (const row of rows) {
        const metadata = normalizeCustomerPairingMetadata(row.metadata);
        const browserNonceHash = requiredHash(
          metadata.browserNonceHash,
        );
        const codeHash = requiredHash(metadata.codeHash);

        if (browserNonceHash && codeHash) {
          await transaction`
            UPDATE customer_link_tokens
            SET
              metadata = ${JSON.stringify(metadata)}::text::jsonb,
              updated_at = NOW()
            WHERE id = ${row.id}
          `;
          repaired += 1;
          continue;
        }

        await transaction`
          UPDATE customer_link_tokens
          SET
            status = CASE
              WHEN status IN ('pending', 'opened', 'confirmed')
                THEN 'expired'
              ELSE status
            END,
            metadata = ${JSON.stringify({
              repairReason: "malformed_pairing_metadata",
              repairedAt: new Date().toISOString(),
            })}::text::jsonb,
            updated_at = NOW()
          WHERE id = ${row.id}
        `;
        expired += 1;
      }

      return {
        scanned: rows.length,
        repaired,
        expired,
      };
    },
  );

  const remainingRows = await client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM customer_link_tokens
    WHERE provider = 'telegram'
      AND purpose = 'browser_pairing_login'
      AND status IN ('pending', 'opened', 'confirmed')
      AND consumed_at IS NULL
      AND expires_at > NOW()
      AND jsonb_typeof(metadata) IS DISTINCT FROM 'object'
  `;
  const remaining = Number(remainingRows[0]?.count ?? 0);

  if (remaining !== 0) {
    throw new Error(
      `После ремонта осталось повреждённых активных pairing: ${remaining}`,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    ...result,
    remainingActiveMalformed: remaining,
  }));
} finally {
  await client.end();
}
