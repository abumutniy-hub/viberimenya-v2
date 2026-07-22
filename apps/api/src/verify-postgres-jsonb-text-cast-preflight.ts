import { createDb } from "@viberimenya/db";

const { client } = createDb();

try {
  const result = await client.begin(async (transaction) => {
    await transaction`
      CREATE TEMP TABLE vm_jsonb_text_cast_preflight (
        id integer PRIMARY KEY,
        metadata jsonb NOT NULL
      ) ON COMMIT DROP
    `;

    const browserNonceHash = "sha256:" + "a".repeat(64);
    const codeHash = "sha256:" + "b".repeat(64);

    await transaction`
      INSERT INTO vm_jsonb_text_cast_preflight (id, metadata)
      VALUES (
        1,
        ${JSON.stringify({
          browserNonceHash,
          codeHash,
          attempts: 0,
        })}::text::jsonb
      )
    `;

    await transaction`
      UPDATE vm_jsonb_text_cast_preflight
      SET metadata = metadata || ${JSON.stringify({
        candidateTelegramId: "123456789",
        openedAt: new Date().toISOString(),
      })}::text::jsonb
      WHERE id = 1
    `;

    await transaction`
      UPDATE vm_jsonb_text_cast_preflight
      SET metadata = metadata || ${JSON.stringify({
        confirmedTelegramId: "123456789",
        confirmedAt: new Date().toISOString(),
      })}::text::jsonb
      WHERE id = 1
    `;

    const rows = await transaction<{
      metadata_type: string;
      browser_nonce_hash: string | null;
      code_hash: string | null;
      candidate_telegram_id: string | null;
      confirmed_telegram_id: string | null;
    }[]>`
      SELECT
        jsonb_typeof(metadata) AS metadata_type,
        metadata ->> 'browserNonceHash' AS browser_nonce_hash,
        metadata ->> 'codeHash' AS code_hash,
        metadata ->> 'candidateTelegramId' AS candidate_telegram_id,
        metadata ->> 'confirmedTelegramId' AS confirmed_telegram_id
      FROM vm_jsonb_text_cast_preflight
      WHERE id = 1
    `;

    return {
      row: rows[0],
      browserNonceHash,
      codeHash,
    };
  });

  if (
    result.row?.metadata_type !== "object"
    || result.row.browser_nonce_hash !== result.browserNonceHash
    || result.row.code_hash !== result.codeHash
    || result.row.candidate_telegram_id !== "123456789"
    || result.row.confirmed_telegram_id !== "123456789"
  ) {
    throw new Error(
      "JSONB text-cast preflight failed: object or pairing hashes were not preserved",
    );
  }

  console.log(JSON.stringify({
    ok: true,
    metadataType: result.row.metadata_type,
    browserNoncePreserved: true,
    codeHashPreserved: true,
    telegramPatchPreserved: true,
  }));
} finally {
  await client.end();
}
