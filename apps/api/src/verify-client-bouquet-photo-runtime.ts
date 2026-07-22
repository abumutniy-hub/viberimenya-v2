import { createDb } from "@viberimenya/db";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const { client } = createDb();

function expectedMime(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/";
}

try {
  const rows = await client<{
    order_number: string;
    tracking_token: string;
    bouquet_photo_url: string;
  }[]>`
    SELECT order_number, tracking_token, bouquet_photo_url
    FROM orders
    WHERE bouquet_photo_url IS NOT NULL
      AND bouquet_photo_url <> ''
      AND tracking_token IS NOT NULL
      AND tracking_token <> ''
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  const order = rows[0];
  if (!order) {
    throw new Error("Нет заказа с фото букета для runtime-проверки");
  }

  if (
    !/^\/uploads\/bouquets\/[a-zA-Z0-9._/-]+$/.test(order.bouquet_photo_url)
    || order.bouquet_photo_url.includes("..")
  ) {
    throw new Error(`Небезопасный URL фото: ${order.bouquet_photo_url}`);
  }

  const localPath = resolve(
    process.env.UPLOADS_DIR || resolve(process.cwd(), "../../storage/uploads"),
    order.bouquet_photo_url.slice("/uploads/".length),
  );
  const info = await stat(localPath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`Локальный файл недоступен: ${localPath}`);
  }

  const localHead = (await readFile(localPath)).subarray(0, 16);
  const publicResponse = await fetch(
    new URL(order.bouquet_photo_url, "https://viberimenya.ru"),
    { cache: "no-store", redirect: "manual" },
  );
  const publicBody = Buffer.from(await publicResponse.arrayBuffer());
  const contentTypeHeader = String(
    publicResponse.headers.get("content-type") || "",
  );
  const contentType = (contentTypeHeader.split(";", 1)[0] ?? "")
    .trim()
    .toLowerCase();

  if (publicResponse.status !== 200) {
    throw new Error(`Публичное фото вернуло HTTP ${publicResponse.status}`);
  }
  if (!contentType.startsWith("image/")) {
    throw new Error(`Публичное фото имеет MIME ${contentType || "пусто"}`);
  }
  if (publicBody.length !== info.size) {
    throw new Error(
      `Размер публичного фото ${publicBody.length} не совпадает с локальным ${info.size}`,
    );
  }
  if (!publicBody.subarray(0, 16).equals(localHead)) {
    throw new Error("Публичный файл отличается от локального");
  }

  const trackingResponse = await fetch(
    `http://127.0.0.1:4001/api/public/orders/track/${encodeURIComponent(order.tracking_token)}`,
    { cache: "no-store" },
  );
  const trackingPayload = await trackingResponse.json() as {
    order?: {
      bouquetPhotoUrl?: string | null;
      bouquetApproval?: { status?: string; canRespond?: boolean };
    };
  };

  if (
    trackingResponse.status !== 200
    || trackingPayload.order?.bouquetPhotoUrl !== order.bouquet_photo_url
  ) {
    throw new Error("Tracking API не возвращает то же фото букета");
  }

  console.log(JSON.stringify({
    ok: true,
    orderNumber: order.order_number,
    photoUrl: order.bouquet_photo_url,
    localBytes: info.size,
    httpStatus: publicResponse.status,
    contentType,
    expectedMime: expectedMime(localPath),
    approvalStatus: trackingPayload.order?.bouquetApproval?.status ?? null,
    canRespond: trackingPayload.order?.bouquetApproval?.canRespond ?? null,
  }));
  console.log("CLIENT BOUQUET PHOTO RUNTIME: OK");
} finally {
  await client.end();
}
