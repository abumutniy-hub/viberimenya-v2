import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });

type NotificationEvent = {
  id: string;
  type: string;
  channel: string;
  recipient_type: string;
  recipient_telegram_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
};

const DATABASE_URL = process.env.DATABASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DRY_RUN = process.env.BOT_DRY_RUN !== "false";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 20
});

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function formatEvent(event: NotificationEvent): string {
  const p = event.payload || {};
  const orderNumber = text(p.orderNumber) || "без номера";
  const trackingUrl = text(p.trackingUrl);
  const paymentUrl = text(p.paymentUrl);

  if (event.type === "order_created") {
    return [
      `🆕 Новый заказ ${orderNumber}`,
      `Клиент: ${text(p.customerName)}`,
      `Телефон: ${text(p.customerPhone)}`,
      `Сумма: ${money(p.totalAmount)}`,
      trackingUrl ? `Заказ: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_confirmed") {
    return [
      `✅ Заказ подтверждён ${orderNumber}`,
      `Статус оплаты: ${text(p.paymentStatus)}`,
      `Сумма: ${money(p.totalAmount)}`,
      trackingUrl ? `Заказ: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "payment_link_added") {
    return [
      `💳 Добавлена ссылка оплаты ${orderNumber}`,
      `Сумма: ${money(p.amount)}`,
      paymentUrl ? `Оплата: ${paymentUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_paid") {
    return [
      `💚 Заказ оплачен ${orderNumber}`,
      `Сумма: ${money(p.totalAmount)}`,
      `Бонус начислен: ${money(p.bonusEarned)}`
    ].filter(Boolean).join("\n");
  }

  return [
    `🔔 Событие ${event.type}`,
    `Заказ: ${orderNumber}`
  ].join("\n");
}

async function sendTelegramMessage(chatId: string, message: string) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is empty");
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }
}

async function getRecipients(event: NotificationEvent): Promise<string[]> {
  if (event.recipient_telegram_id) {
    return [event.recipient_telegram_id];
  }

  const rows = await sql<{ telegram_id: string }[]>`
    SELECT telegram_id
    FROM telegram_accounts
    WHERE is_active = true
      AND user_id IS NOT NULL
    ORDER BY created_at ASC
  `;

  return rows.map((row) => row.telegram_id);
}

async function processOnce() {
  const events = await sql<NotificationEvent[]>`
    SELECT id, type, channel, recipient_type, recipient_telegram_id, payload, attempts, created_at
    FROM notification_events
    WHERE status = 'pending'
      AND channel = 'telegram'
    ORDER BY created_at ASC
    LIMIT 10
  `;

  if (events.length === 0) {
    console.log("[bot-worker] no pending events");
    return;
  }

  for (const event of events) {
    const message = formatEvent(event);
    const recipients = await getRecipients(event);

    if (DRY_RUN) {
      console.log(`[bot-worker] dry-run event=${event.id} type=${event.type}`);
      console.log(message);
      continue;
    }

    if (recipients.length === 0) {
      await sql`
        UPDATE notification_events
        SET status = 'failed',
            attempts = attempts + 1,
            error = 'No active Telegram staff recipients',
            updated_at = NOW()
        WHERE id = ${event.id}
      `;
      continue;
    }

    try {
      for (const chatId of recipients) {
        await sendTelegramMessage(chatId, message);
      }

      await sql`
        UPDATE notification_events
        SET status = 'sent',
            attempts = attempts + 1,
            sent_at = NOW(),
            updated_at = NOW()
        WHERE id = ${event.id}
      `;
    } catch (error) {
      await sql`
        UPDATE notification_events
        SET attempts = attempts + 1,
            error = ${error instanceof Error ? error.message : String(error)},
            updated_at = NOW()
        WHERE id = ${event.id}
      `;
    }
  }
}

async function main() {
  console.log(`[bot-worker] started dryRun=${DRY_RUN} tokenSet=${Boolean(TELEGRAM_BOT_TOKEN)}`);

  await processOnce();

  await sql.end();
}

main().catch(async (error) => {
  console.error("[bot-worker] failed", error);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
