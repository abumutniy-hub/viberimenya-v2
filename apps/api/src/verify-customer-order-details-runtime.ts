import { resolve } from "node:path";
import { config } from "dotenv";
import { createDb } from "@viberimenya/db";

config({ path: resolve(process.cwd(), "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const { client: sql } = createDb(databaseUrl);

async function readTracking(token: string) {
  const response = await fetch(
    `http://127.0.0.1:4001/api/public/orders/track/${encodeURIComponent(token)}`,
    { headers: { accept: "application/json" } },
  );

  if (!response.ok) {
    throw new Error(`Tracking API returned ${response.status}`);
  }

  return response.json() as Promise<{
    ok?: boolean;
    order?: {
      deliveryInterval?: string | null;
      bouquetPhotoUrl?: string | null;
      bouquetApproval?: unknown;
    };
  }>;
}

try {
  const intervalRows = await sql<{
    tracking_token: string;
    interval_name: string;
  }[]>`
    SELECT o.tracking_token, di.name AS interval_name
    FROM orders o
    JOIN delivery_intervals di
      ON di.id = o.delivery_interval_id
     AND di.shop_id = o.shop_id
    WHERE o.tracking_token IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT 1
  `;
  const intervalOrder = intervalRows[0];

  if (intervalOrder) {
    const payload = await readTracking(intervalOrder.tracking_token);
    if (
      !payload.ok
      || payload.order?.deliveryInterval !== intervalOrder.interval_name
    ) {
      throw new Error("Tracking API не вернул фактический интервал заказа");
    }
    console.log("✓ Tracking API возвращает выбранный интервал доставки");
  } else {
    console.log("✓ Нет заказа с интервалом для runtime-проверки");
  }

  const photoRows = await sql<{
    tracking_token: string;
    bouquet_photo_url: string;
  }[]>`
    SELECT tracking_token, bouquet_photo_url
    FROM orders
    WHERE tracking_token IS NOT NULL
      AND bouquet_photo_url IS NOT NULL
      AND bouquet_photo_url <> ''
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const photoOrder = photoRows[0];

  if (photoOrder) {
    const payload = await readTracking(photoOrder.tracking_token);
    if (
      !payload.ok
      || payload.order?.bouquetPhotoUrl !== photoOrder.bouquet_photo_url
      || !payload.order?.bouquetApproval
    ) {
      throw new Error("Tracking API не вернул фото или статус согласования");
    }
    console.log("✓ Tracking API возвращает фото и статус согласования букета");
  } else {
    console.log("✓ Нет заказа с фото для runtime-проверки");
  }

  console.log("CUSTOMER ORDER DETAILS RUNTIME: OK");
} finally {
  await sql.end();
}
