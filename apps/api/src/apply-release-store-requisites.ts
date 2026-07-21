import { resolve } from "node:path";
import { config } from "dotenv";
import { createDb } from "@viberimenya/db";

config({ path: resolve(process.cwd(), "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
const shopSlug = process.env.DEFAULT_SHOP_SLUG || "viberimenya";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const legalName =
  "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ САРДАРЗАДЕ САРВАР ХАНБАЛА ОГЛЫ";
const siteSettings = {
  legalName,
  inn: "081701823774",
  ogrn: "324080000002712",
  settlementAccount: "40802810828000052349",
  bankName: "КОМИ ОТДЕЛЕНИЕ N8617 ПАО СБЕРБАНК",
  bik: "048702640",
  correspondentAccount: "30101810400000000640",
};

const { client: sql } = createDb(databaseUrl);

try {
  const result = await sql.begin(async (transaction) => {
    const shopRows = await transaction<{ id: string }[]>`
      UPDATE shops
      SET
        legal_name = ${legalName},
        updated_at = NOW()
      WHERE slug = ${shopSlug}
      RETURNING id
    `;
    const shop = shopRows[0];

    if (!shop) {
      throw new Error(`Shop not found: ${shopSlug}`);
    }

    await transaction`
      INSERT INTO shop_settings (
        shop_id,
        is_online_payment_enabled,
        is_cash_payment_enabled,
        is_transfer_payment_enabled,
        settings,
        created_at,
        updated_at
      )
      VALUES (
        ${shop.id},
        false,
        true,
        true,
        ${JSON.stringify({ site: siteSettings })}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id)
      DO UPDATE SET
        is_transfer_payment_enabled = true,
        settings = jsonb_set(
          COALESCE(shop_settings.settings, '{}'::jsonb),
          '{site}',
          COALESCE(shop_settings.settings -> 'site', '{}'::jsonb)
            || ${JSON.stringify(siteSettings)}::jsonb,
          true
        ),
        updated_at = NOW()
    `;

    return { shopId: shop.id, legalName, inn: siteSettings.inn };
  });

  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await sql.end();
}
