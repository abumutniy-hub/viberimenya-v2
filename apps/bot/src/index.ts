import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });

type NotificationEvent = {
  id: string;
  shop_id: string;
  order_id: string | null;
  type: string;
  channel: string;
  recipient_type: string;
  recipient_telegram_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
  updated_at: string;
};

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  from?: TelegramUser;
  chat: TelegramChat;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

const DATABASE_URL = process.env.DATABASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DRY_RUN = process.env.BOT_DRY_RUN !== "false";
const RUN_ONCE = process.env.BOT_RUN_ONCE === "true";
const POLL_INTERVAL_MS = envNumber("BOT_POLL_INTERVAL_MS", 1000, 300, 2000);
const TELEGRAM_UPDATES_TIMEOUT_SECONDS = envNumber("BOT_GET_UPDATES_TIMEOUT_SECONDS", 5, 1, 25);
const SITE_URL = process.env.APP_URL || process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://viberimenya.ru";
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://127.0.0.1:4001";
const INTERNAL_ORDER_TOKEN = TELEGRAM_BOT_TOKEN
  ? createHash("sha256")
      .update(`viberimenya:telegram-order-create:v1:${TELEGRAM_BOT_TOKEN}`)
      .digest("hex")
  : "";
const DEFAULT_SHOP_SLUG = process.env.DEFAULT_SHOP_SLUG || "viberimenya";
const UPLOADS_DIR = process.env.UPLOADS_DIR || resolve(process.cwd(), "../../storage/uploads");

const pendingBouquetPhotoRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  userId: string;
  createdAt: number;
}>();

const pendingFloristProblemRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  userId: string;
  createdAt: number;
}>();

const pendingCourierDeliveryPhotoRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  userId: string;
  createdAt: number;
}>();

const pendingCourierProblemRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  userId: string;
  createdAt: number;
}>();

const pendingCustomerBouquetRevisionRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  customerId: string;
  createdAt: number;
}>();

const pendingTelegramCheckoutConfirmations = new Set<number>();

const TELEGRAM_LINK_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const TELEGRAM_LINK_BLOCK_MS = 15 * 60 * 1000;
const TELEGRAM_LINK_MAX_FAILURES = 5;

const telegramLinkAttempts = new Map<number, {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}>();

function telegramLinkBlockSeconds(chatId: number) {
  const now = Date.now();
  const attempt = telegramLinkAttempts.get(chatId);

  if (!attempt) return 0;

  if (attempt.blockedUntil > now) {
    return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
  }

  if (now - attempt.windowStartedAt > TELEGRAM_LINK_ATTEMPT_WINDOW_MS) {
    telegramLinkAttempts.delete(chatId);
  }

  return 0;
}

function registerTelegramLinkFailure(chatId: number) {
  const now = Date.now();
  const previous = telegramLinkAttempts.get(chatId);
  const withinWindow = previous && now - previous.windowStartedAt <= TELEGRAM_LINK_ATTEMPT_WINDOW_MS;
  const failures = withinWindow ? previous.failures + 1 : 1;

  telegramLinkAttempts.set(chatId, {
    failures,
    windowStartedAt: withinWindow ? previous.windowStartedAt : now,
    blockedUntil: failures >= TELEGRAM_LINK_MAX_FAILURES
      ? now + TELEGRAM_LINK_BLOCK_MS
      : 0,
  });
}

const MAX_DELIVERY_PHOTO_BYTES = 12 * 1024 * 1024;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

if (!TELEGRAM_BOT_TOKEN && !DRY_RUN) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 20
});

let isStopping = false;
let telegramOffset = 0;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function valueToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function absoluteUrl(value: unknown): string {
  const url = valueToText(value);
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function chunkRows<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }

  return rows;
}

function inlineKeyboard(rows: TelegramInlineKeyboardButton[][]) {
  return {
    inline_keyboard: rows
  };
}


function buildCatalogUrl(path = "") {
  return absoluteUrl(`/catalog${path}`);
}

function buildProductUrl(slug: string) {
  return absoluteUrl(`/product/${slug}`);
}

async function getDefaultShopId() {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM shops
    WHERE slug = ${DEFAULT_SHOP_SLUG}
      AND status = 'active'
    LIMIT 1
  `;

  return rows[0]?.id || "";
}

async function queueCustomerOrderNotification(params: {
  shopId: string;
  orderId: string;
  type:
    | "order_ready"
    | "order_courier_assigned"
    | "order_delivering"
    | "order_delivered"
    | "order_problem"
    | "order_cancelled";
  status:
    | "ready"
    | "assigned_courier"
    | "delivering"
    | "delivered"
    | "problem"
    | "cancelled";
}) {
  await sql`
    INSERT INTO notification_events (
      shop_id,
      order_id,
      type,
      channel,
      recipient_type,
      status,
      payload,
      created_at,
      updated_at
    )
    SELECT
      o.shop_id,
      o.id,
      ${params.type}::text,
      'telegram',
      'customer',
      'pending',
      jsonb_build_object(
        'orderId', o.id,
        'orderNumber', o.order_number,
        'status', ${params.status}::text,
        'customerName', c.name,
        'customerPhone', c.phone,
        'recipientName', o.recipient_name,
        'recipientPhone', o.recipient_phone,
        'deliveryAddressText', o.delivery_address_text,
        'deliveryComment', o.delivery_comment,
        'bouquetPhotoUrl', o.bouquet_photo_url,
        'deliveryProofPhotoUrl', o.metadata #>> '{delivery,proofPhotoUrl}',
        'deliveredAt', o.delivered_at,
        'trackingToken', o.tracking_token,
        'trackingUrl', CASE
          WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
          ELSE '/order/track/' || o.tracking_token
        END
      ),
      NOW(),
      NOW()
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${params.orderId}
      AND o.shop_id = ${params.shopId}
      AND o.customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM notification_events existing
        WHERE existing.shop_id = o.shop_id
          AND existing.order_id = o.id
          AND existing.type = ${params.type}
          AND existing.channel = 'telegram'
          AND existing.recipient_type = 'customer'
          AND existing.status IN ('pending', 'processing', 'sent')
      )
  `;
}

async function queueBouquetApprovalRequest(params: {
  shopId: string;
  orderId: string;
}) {
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO notification_events (
      shop_id,
      order_id,
      type,
      channel,
      recipient_type,
      recipient_telegram_id,
      status,
      payload,
      created_at,
      updated_at
    )
    SELECT
      o.shop_id,
      o.id,
      'bouquet_approval_requested',
      'telegram',
      'customer',
      ta.telegram_id,
      'pending',
      jsonb_build_object(
        'orderId', o.id,
        'orderNumber', o.order_number,
        'bouquetPhotoUrl', o.bouquet_photo_url,
        'photoVersion', COALESCE(
          NULLIF(o.metadata #>> '{bouquetApproval,photoVersion}', '')::int,
          1
        ),
        'trackingToken', o.tracking_token,
        'trackingUrl', CASE
          WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
          ELSE '/order/track/' || o.tracking_token
        END
      ),
      NOW(),
      NOW()
    FROM orders o
    JOIN telegram_accounts ta
      ON ta.shop_id = o.shop_id
     AND ta.customer_id = o.customer_id
     AND ta.is_active = true
     AND ta.notifications_enabled = true
    WHERE o.id = ${params.orderId}
      AND o.shop_id = ${params.shopId}
      AND o.customer_id IS NOT NULL
    ORDER BY ta.linked_at DESC NULLS LAST
    LIMIT 1
    RETURNING id
  `;

  return inserted.length > 0;
}

async function queueBouquetApprovalStaffNotification(params: {
  shopId: string;
  orderId: string;
  type: "bouquet_approved" | "bouquet_revision_requested";
  note?: string;
}) {
  const note = String(params.note || "").trim().slice(0, 500);

  await sql`
    INSERT INTO notification_events (
      shop_id,
      order_id,
      type,
      channel,
      recipient_type,
      recipient_telegram_id,
      status,
      payload,
      created_at,
      updated_at
    )
    SELECT DISTINCT
      o.shop_id,
      o.id,
      ${params.type}::text,
      'telegram',
      'staff',
      ta.telegram_id,
      'pending',
      jsonb_build_object(
        'orderId', o.id,
        'orderNumber', o.order_number,
        'note', ${note || null},
        'bouquetPhotoUrl', o.bouquet_photo_url,
        'crmUrl', '/admin/orders/' || o.id::text
      ),
      NOW(),
      NOW()
    FROM orders o
    JOIN telegram_accounts ta
      ON ta.shop_id = o.shop_id
     AND ta.is_active = true
     AND ta.user_id IS NOT NULL
    JOIN shop_users su
      ON su.shop_id = ta.shop_id
     AND su.user_id = ta.user_id
     AND su.is_active = true
    WHERE o.id = ${params.orderId}
      AND o.shop_id = ${params.shopId}
      AND (
        ta.user_id = o.florist_id
        OR (
          ${params.type}::text = 'bouquet_revision_requested'
          AND su.role IN ('owner', 'admin', 'manager')
        )
      )
  `;
}

const TELEGRAM_RETRY_ATTEMPTS = envNumber("BOT_TELEGRAM_RETRY_ATTEMPTS", 3, 1, 5);

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
};

function sleep(ms: number) {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

function isRetryableTelegramFailure(status: number | undefined, description: string) {
  if (status === 429) return true;
  if (status && status >= 500) return true;

  return /too many requests|bad gateway|gateway timeout|etimedout|econnreset|network|timeout/i.test(description);
}

function telegramRetryDelayMs(attempt: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(30000, retryAfterSeconds * 1000 + 250);
  }

  return Math.min(8000, 500 * 2 ** attempt + Math.floor(Math.random() * 300));
}

async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const requestInit: RequestInit = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    : {
        method: "GET"
      };

  for (let attempt = 0; attempt < TELEGRAM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, requestInit);
      const data = await response.json().catch(() => ({
        ok: false,
        description: response.statusText
      })) as TelegramApiResponse<T>;

      if (response.ok && data.ok) {
        return data.result as T;
      }

      const description = data.description || response.statusText || "unknown error";
      const retryAfter = data.parameters?.retry_after;

      if (attempt < TELEGRAM_RETRY_ATTEMPTS - 1 && isRetryableTelegramFailure(response.status, description)) {
        await sleep(telegramRetryDelayMs(attempt, retryAfter));
        continue;
      }

      throw new Error(`Telegram ${method} failed: ${description}`);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);

      if (attempt < TELEGRAM_RETRY_ATTEMPTS - 1 && isRetryableTelegramFailure(undefined, description)) {
        await sleep(telegramRetryDelayMs(attempt));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Telegram ${method} failed after retries`);
}

async function sendTelegramMessage(chatId: string | number, message: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run send chat=${chatId}`);
    console.log(message);
    return;
  }

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
    ...(extra || {})
  });
}

async function sendTelegramPhoto(chatId: string | number, photoUrl: string, caption: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run send photo chat=${chatId} photo=${photoUrl}`);
    console.log(caption);
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl,
    caption
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  await telegramApi("sendPhoto", payload);
}

async function editTelegramMessageText(chatId: string | number, messageId: number, message: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run edit chat=${chatId} message=${messageId}`);
    console.log(message);
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: message,
    disable_web_page_preview: true
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  await telegramApi("editMessageText", payload);
}

async function deleteTelegramMessage(chatId: string | number, messageId: number) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run delete chat=${chatId} message=${messageId}`);
    return;
  }

  await telegramApi("deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  });
}

async function sendOrEditTelegramMessage(
  chatId: string | number,
  message: string,
  extra: Record<string, unknown>,
  messageId?: number
) {
  if (messageId) {
    try {
      await editTelegramMessageText(chatId, messageId, message, extra);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("message is not modified")) {
        return;
      }

      console.warn(`[bot-worker] edit failed, sending new message instead: ${errorMessage}`);
    }
  }

  await sendTelegramMessage(chatId, message, extra);
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (DRY_RUN) {
    return;
  }

  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    body.text = text;
  }

  await telegramApi("answerCallbackQuery", body);
}

function clientMainKeyboard() {
  return {
    keyboard: [
      [{ text: "🛍 Каталог" }, { text: "🧺 Корзина" }],
      [{ text: "📦 Мои заказы" }, { text: "🎁 Бонусы" }],
      [{ text: "👤 Профиль" }, { text: "☎️ Связь" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function unlinkedMainKeyboard() {
  return {
    keyboard: [
      [{ text: "🛍 Каталог" }, { text: "🧺 Корзина" }],
      [{ text: "📦 Мои заказы" }, { text: "🎁 Бонусы" }],
      [{ text: "👤 Профиль" }, { text: "☎️ Связь" }],
      [{ text: "🔗 Привязать аккаунт" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function staffMainKeyboard(role: string) {
  const rows: { text: string }[][] = [
    [{ text: "👤 Профиль" }, { text: "🔔 Уведомления" }]
  ];

  if (["owner", "admin", "manager"].includes(role)) {
    rows.push([{ text: "🧾 CRM" }, { text: "📦 Заказы" }]);
  }

  if (["owner", "admin"].includes(role)) {
    rows.push([{ text: "💐 Сборка заказов" }, { text: "🚚 Доставка" }]);
    rows.push([{ text: "⚙️ Настройки" }]);
  } else if (role === "florist") {
    rows.push([{ text: "💐 Сборка заказов" }]);
  } else if (role === "courier") {
    rows.push([{ text: "🚚 Доставка" }]);
  }

  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true
  };
}

async function mainKeyboardForChat(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id) {
    return staffMainKeyboard(profile.role || "staff");
  }

  if (profile?.customer_id) {
    return clientMainKeyboard();
  }

  return unlinkedMainKeyboard();
}

async function getTelegramProfile(telegramId: string) {
  const rows = await sql<{
    telegram_id: string;
    shop_id: string;
    username: string | null;
    first_name: string | null;
    user_id: string | null;
    customer_id: string | null;
    role: string | null;
  }[]>`
    SELECT
      ta.telegram_id,
      ta.shop_id,
      ta.username,
      ta.first_name,
      CASE WHEN su.user_id IS NOT NULL THEN ta.user_id ELSE NULL END AS user_id,
      ta.customer_id,
      su.role
    FROM telegram_accounts ta
    LEFT JOIN shop_users su
      ON su.shop_id = ta.shop_id
     AND su.user_id = ta.user_id
     AND su.is_active = true
    WHERE ta.telegram_id = ${telegramId}
      AND ta.is_active = true
      AND (
        ta.customer_id IS NOT NULL
        OR su.user_id IS NOT NULL
      )
    ORDER BY ta.linked_at DESC NULLS LAST, ta.updated_at DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

async function ensureTelegramAccount(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.from || message.chat.type !== "private") return;

  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  const telegramId = String(message.from.id);

  await sql`
    INSERT INTO telegram_accounts (
      shop_id,
      telegram_id,
      username,
      first_name,
      last_name,
      is_active,
      linked_at,
      created_at,
      updated_at
    )
    VALUES (
      ${shopId},
      ${telegramId},
      ${message.from.username || null},
      ${message.from.first_name || null},
      ${message.from.last_name || null},
      true,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      is_active = true,
      updated_at = NOW()
  `;
}

function createCustomerMagicToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

async function createCustomerMagicLoginUrl(params: {
  shopId: string;
  customerId: string;
  orderId: string | null;
}) {
  const token = createCustomerMagicToken();

  await sql`
    INSERT INTO customer_link_tokens (
      shop_id, customer_id, order_id, provider, purpose,
      token, status, expires_at, metadata, created_at, updated_at
    )
    VALUES (
      ${params.shopId}, ${params.customerId}, ${params.orderId},
      'site', 'magic_login',
      ${token}, 'pending', NOW() + INTERVAL '15 minutes',
      ${JSON.stringify({ source: "telegram_magic_login" })},
      NOW(), NOW()
    )
  `;

  return absoluteUrl(`/api/public/auth/magic/${token}`);
}

function normalizeTelegramLinkCode(value: string) {
  return value.trim().replace(/[^0-9]/g, "");
}

async function handleCustomerLinkToken(message: TelegramMessage, payload: string) {
  const token = payload.replace(/^link_/, "").trim();
  const telegramId = String(message.chat.id);
  const shopId = await getDefaultShopId();

  if (!shopId || !token) {
    await sendTelegramMessage(message.chat.id, "Ссылка подключения недействительна.");
    return true;
  }

  const tokenRows = await sql<{ id: string; customer_id: string; order_id: string | null }[]>`
    SELECT id, customer_id, order_id
    FROM customer_link_tokens
    WHERE shop_id = ${shopId}
      AND provider = 'telegram'
      AND purpose = 'connect_channel'
      AND token = ${token}
      AND status = 'pending'
      AND consumed_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;

  const linkToken = tokenRows[0];

  if (!linkToken) {
    await sendTelegramMessage(message.chat.id, "Ссылка подключения недействительна или срок её действия истёк.");
    return true;
  }

  const existingRows = await sql<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${shopId}
      AND telegram_id = ${telegramId}
      AND is_active = true
    LIMIT 1
  `;

  const existing = existingRows[0];

  if (existing?.customer_id && existing.customer_id !== linkToken.customer_id) {
    await sendTelegramMessage(message.chat.id, "Этот Telegram уже связан с другим профилем. Для смены привязки обратитесь к менеджеру.");
    return true;
  }

  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;

  await sql`
    INSERT INTO telegram_accounts (
      shop_id, customer_id, telegram_id, username, first_name, last_name,
      is_active, linked_at, created_at, updated_at
    )
    VALUES (
      ${shopId}, ${linkToken.customer_id}, ${telegramId},
      ${message.from?.username || null}, ${message.from?.first_name || null}, ${message.from?.last_name || null},
      true, NOW(), NOW(), NOW()
    )
    ON CONFLICT (shop_id, telegram_id)
    DO UPDATE SET
      customer_id = ${linkToken.customer_id},
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      is_active = true,
      updated_at = NOW()
  `;

  await sql`
    INSERT INTO customer_channel_links (
      shop_id, customer_id, provider, provider_user_id,
      provider_username, provider_display_name,
      is_active, linked_at, created_at, updated_at
    )
    VALUES (
      ${shopId}, ${linkToken.customer_id}, 'telegram', ${telegramId},
      ${message.from?.username || null}, ${displayName},
      true, NOW(), NOW(), NOW()
    )
    ON CONFLICT (shop_id, provider, provider_user_id)
    DO UPDATE SET
      customer_id = ${linkToken.customer_id},
      provider_username = EXCLUDED.provider_username,
      provider_display_name = EXCLUDED.provider_display_name,
      is_active = true,
      updated_at = NOW()
  `;

  await sql`
    UPDATE customer_link_tokens
    SET status = 'consumed',
        consumed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${linkToken.id}
  `;

  const magicLoginUrl = await createCustomerMagicLoginUrl({
    shopId,
    customerId: linkToken.customer_id,
    orderId: linkToken.order_id
  });

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ Telegram подключён",
      "",
      "Теперь здесь будут приходить уведомления по заказам, оплате, сборке и доставке.",
      "Ваши заказы доступны в разделе «📦 Мои заказы»."
    ].join("\n"),
    { reply_markup: await mainKeyboardForChat(message.chat.id) }
  );

  await sendTelegramMessage(
    message.chat.id,
    "Откройте сайт — вход выполнится автоматически.",
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "Открыть личный кабинет",
            url: magicLoginUrl
          }
        ]
      ])
    }
  );

  return true;
}

async function handleEmployeeLinkToken(message: TelegramMessage, payload: string) {
  const token = payload.replace(/^staff_/, "").trim();
  const telegramId = String(message.chat.id);
  const shopId = await getDefaultShopId();

  if (!shopId || !token) {
    await sendTelegramMessage(message.chat.id, "Ссылка подключения сотрудника недействительна.");
    return true;
  }

  const tokenRows = await sql<{
    id: string;
    user_id: string;
    role: string | null;
    name: string | null;
  }[]>`
    SELECT
      elt.id,
      elt.user_id,
      su.role,
      u.name
    FROM employee_link_tokens elt
    JOIN users u ON u.id = elt.user_id
    JOIN shop_users su
      ON su.shop_id = elt.shop_id
     AND su.user_id = elt.user_id
     AND su.is_active = true
    WHERE elt.shop_id = ${shopId}
      AND elt.provider = 'telegram'
      AND elt.purpose = 'connect_staff'
      AND elt.token = ${token}
      AND elt.status = 'pending'
      AND elt.consumed_at IS NULL
      AND elt.expires_at > NOW()
    LIMIT 1
  `;

  const linkToken = tokenRows[0];

  if (!linkToken) {
    await sendTelegramMessage(message.chat.id, "Ссылка подключения сотрудника недействительна или срок её действия истёк.");
    return true;
  }

  const existingRows = await sql<{ user_id: string | null }[]>`
    SELECT ta.user_id
    FROM telegram_accounts ta
    JOIN shop_users su
      ON su.shop_id = ta.shop_id
     AND su.user_id = ta.user_id
     AND su.is_active = true
    WHERE ta.shop_id = ${shopId}
      AND ta.telegram_id = ${telegramId}
      AND ta.is_active = true
    LIMIT 1
  `;

  const existing = existingRows[0];

  if (existing?.user_id && existing.user_id !== linkToken.user_id) {
    await sendTelegramMessage(message.chat.id, "Этот Telegram уже связан с другим сотрудником. Для смены привязки обратитесь к владельцу.");
    return true;
  }

  await sql`
    INSERT INTO telegram_accounts (
      shop_id,
      user_id,
      telegram_id,
      username,
      first_name,
      last_name,
      is_active,
      linked_at,
      created_at,
      updated_at
    )
    VALUES (
      ${shopId},
      ${linkToken.user_id},
      ${telegramId},
      ${message.from?.username || null},
      ${message.from?.first_name || null},
      ${message.from?.last_name || null},
      true,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, telegram_id)
    DO UPDATE SET
      user_id = ${linkToken.user_id},
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      is_active = true,
      updated_at = NOW()
  `;

  await sql`
    UPDATE employee_link_tokens
    SET status = 'consumed',
        consumed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${linkToken.id}
  `;

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ Telegram сотрудника подключён",
      "",
      linkToken.name ? `Сотрудник: ${linkToken.name}` : "",
      `Роль: ${linkToken.role || "staff"}`,
      "",
      "Теперь бот будет показывать рабочее меню и сможет присылать задачи по заказам."
    ].filter(Boolean).join("\n"),
    {
      reply_markup: await mainKeyboardForChat(message.chat.id)
    }
  );

  return true;
}

async function handleTelegramLinkCode(message: TelegramMessage, rawCode: string) {
  const code = normalizeTelegramLinkCode(rawCode);
  const telegramId = String(message.chat.id);
  const shopId = await getDefaultShopId();

  if (!shopId || !code || code.length < 4) {
    return false;
  }

  const blockedSeconds = telegramLinkBlockSeconds(message.chat.id);

  if (blockedSeconds > 0) {
    await sendTelegramMessage(
      message.chat.id,
      "Слишком много неверных кодов. Повторите попытку через 15 минут.",
    );
    return true;
  }

  const employeeRows = await sql<{
    id: string;
    user_id: string;
    role: string | null;
    name: string | null;
  }[]>`
    SELECT
      elt.id,
      elt.user_id,
      su.role,
      u.name
    FROM employee_link_tokens elt
    JOIN users u ON u.id = elt.user_id
    JOIN shop_users su
      ON su.shop_id = elt.shop_id
     AND su.user_id = elt.user_id
     AND su.is_active = true
    WHERE elt.shop_id = ${shopId}
      AND elt.provider = 'telegram'
      AND elt.purpose = 'connect_staff'
      AND elt.token = ${code}
      AND elt.status = 'pending'
      AND elt.consumed_at IS NULL
      AND elt.expires_at > NOW()
    LIMIT 1
  `;

  if (employeeRows[0]) {
    const linkToken = employeeRows[0];

    const existingRows = await sql<{ user_id: string | null }[]>`
      SELECT user_id
      FROM telegram_accounts
      WHERE shop_id = ${shopId}
        AND telegram_id = ${telegramId}
        AND is_active = true
      LIMIT 1
    `;

    const existing = existingRows[0];

    if (existing?.user_id && existing.user_id !== linkToken.user_id) {
      await sendTelegramMessage(message.chat.id, "Этот Telegram уже связан с другим сотрудником. Для смены привязки обратитесь к владельцу.");
      return true;
    }

    await sql`
      INSERT INTO telegram_accounts (
        shop_id,
        user_id,
        telegram_id,
        username,
        first_name,
        last_name,
        is_active,
        linked_at,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        ${linkToken.user_id},
        ${telegramId},
        ${message.from?.username || null},
        ${message.from?.first_name || null},
        ${message.from?.last_name || null},
        true,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, telegram_id)
      DO UPDATE SET
        user_id = ${linkToken.user_id},
        customer_id = NULL,
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = true,
        updated_at = NOW()
    `;

    await sql`
      UPDATE employee_link_tokens
      SET status = 'consumed',
          consumed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${linkToken.id}
    `;

    telegramLinkAttempts.delete(message.chat.id);

    await sendTelegramMessage(
      message.chat.id,
      [
        "✅ Telegram сотрудника подключён",
        "",
        linkToken.name ? `Сотрудник: ${linkToken.name}` : "",
        `Роль: ${linkToken.role || "staff"}`,
        "",
        "Теперь бот будет показывать рабочее меню и сможет присылать задачи по заказам."
      ].filter(Boolean).join("\n"),
      {
        reply_markup: await mainKeyboardForChat(message.chat.id)
      }
    );

    return true;
  }

  const customerRows = await sql<{ id: string; customer_id: string; order_id: string | null }[]>`
    SELECT id, customer_id, order_id
    FROM customer_link_tokens
    WHERE shop_id = ${shopId}
      AND provider = 'telegram'
      AND purpose = 'connect_channel'
      AND token = ${code}
      AND status = 'pending'
      AND consumed_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;

  const linkToken = customerRows[0];

  if (!linkToken) {
    registerTelegramLinkFailure(message.chat.id);
    const retryAfter = telegramLinkBlockSeconds(message.chat.id);

    await sendTelegramMessage(
      message.chat.id,
      retryAfter > 0
        ? "Слишком много неверных кодов. Повторите попытку через 15 минут."
        : "Код не найден или срок действия истёк. Сгенерируйте новый код на сайте или в CRM.",
    );
    return true;
  }

  const existingRows = await sql<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${shopId}
      AND telegram_id = ${telegramId}
      AND is_active = true
    LIMIT 1
  `;

  const existing = existingRows[0];

  if (existing?.customer_id && existing.customer_id !== linkToken.customer_id) {
    await sendTelegramMessage(message.chat.id, "Этот Telegram уже связан с другим профилем. Для смены привязки обратитесь к менеджеру.");
    return true;
  }

  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;

  await sql`
    INSERT INTO telegram_accounts (
      shop_id, customer_id, telegram_id, username, first_name, last_name,
      is_active, linked_at, created_at, updated_at
    )
    VALUES (
      ${shopId}, ${linkToken.customer_id}, ${telegramId},
      ${message.from?.username || null}, ${message.from?.first_name || null}, ${message.from?.last_name || null},
      true, NOW(), NOW(), NOW()
    )
    ON CONFLICT (shop_id, telegram_id)
    DO UPDATE SET
      customer_id = ${linkToken.customer_id},
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      is_active = true,
      updated_at = NOW()
  `;

  await sql`
    INSERT INTO customer_channel_links (
      shop_id, customer_id, provider, provider_user_id,
      provider_username, provider_display_name,
      is_active, linked_at, created_at, updated_at
    )
    VALUES (
      ${shopId}, ${linkToken.customer_id}, 'telegram', ${telegramId},
      ${message.from?.username || null}, ${displayName},
      true, NOW(), NOW(), NOW()
    )
    ON CONFLICT (shop_id, provider, provider_user_id)
    DO UPDATE SET
      customer_id = ${linkToken.customer_id},
      provider_username = EXCLUDED.provider_username,
      provider_display_name = EXCLUDED.provider_display_name,
      is_active = true,
      updated_at = NOW()
  `;

  await sql`
    UPDATE customer_link_tokens
    SET status = 'consumed',
        consumed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${linkToken.id}
  `;

  const magicLoginUrl = await createCustomerMagicLoginUrl({
    shopId,
    customerId: linkToken.customer_id,
    orderId: linkToken.order_id
  });

  telegramLinkAttempts.delete(message.chat.id);

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ Telegram подключён",
      "",
      "Теперь здесь будут приходить уведомления по заказам, оплате, сборке и доставке.",
      "Ваши заказы доступны в разделе «📦 Мои заказы»."
    ].join("\n"),
    { reply_markup: await mainKeyboardForChat(message.chat.id) }
  );

  await sendTelegramMessage(
    message.chat.id,
    "Откройте сайт — вход выполнится автоматически.",
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "Открыть личный кабинет",
            url: magicLoginUrl
          }
        ]
      ])
    }
  );

  return true;
}

async function handleStart(update: TelegramUpdate) {
  const message = update.message;
  if (!message) return;

  const payload = (message.text || "").split(/\s+/).slice(1).join(" ").trim();

  if (payload.startsWith("link_")) {
    const handled = await handleCustomerLinkToken(message, payload);
    if (handled) return;
  }

  if (payload.startsWith("staff_")) {
    const handled = await handleEmployeeLinkToken(message, payload);
    if (handled) return;
  }

  await handleOpenMenu(message.chat.id, true);
}

async function handleOpenMenu(chatId: number, isStart = false) {
  const telegramId = String(chatId);
  const profile = await getTelegramProfile(telegramId);

  const customerLoginUrl = profile?.customer_id
    ? await createCustomerMagicLoginUrl({
        shopId: profile.shop_id,
        customerId: profile.customer_id,
        orderId: null
      })
    : null;

  if (profile?.user_id) {
    const role = profile.role || "staff";

    await sendTelegramMessage(
      chatId,
      [
        "🌸 ВЫБЕРИ МЕНЯ",
        "",
        "Вы вошли как сотрудник магазина.",
        `Роль: ${role}`,
        "",
        isStart ? "Выберите нужный раздел:" : "Меню открыто. Выберите нужный раздел:"
      ].join("\n"),
      {
        reply_markup: staffMainKeyboard(role)
      }
    );

    if (customerLoginUrl) {
      await sendTelegramMessage(
        chatId,
        "Личный кабинет покупателя тоже доступен на сайте. Вход выполнится автоматически.",
        {
          reply_markup: inlineKeyboard([
            [{ text: "Открыть личный кабинет", url: customerLoginUrl }]
          ])
        }
      );
    }

    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "🌸 ВЫБЕРИ МЕНЯ",
      "",
      isStart ? "Добро пожаловать в магазин цветов." : "Меню открыто.",
      isStart ? "Здесь можно выбрать букет, оформить заказ, отслеживать доставку и пользоваться бонусами." : "Выберите нужный раздел ниже.",
      "",
      "Выберите раздел:"
    ].join("\n"),
    {
      reply_markup: clientMainKeyboard()
    }
  );

  if (customerLoginUrl) {
    await sendTelegramMessage(
      chatId,
      "Откройте личный кабинет на сайте — вход выполнится автоматически.",
      {
        reply_markup: inlineKeyboard([
          [{ text: "Открыть личный кабинет", url: customerLoginUrl }]
        ])
      }
    );
  }
}

async function handleCatalog(chatId: number, messageId?: number) {
  const shopId = await getDefaultShopId();
  const replyMarkup = await mainKeyboardForChat(chatId);

  if (!shopId) {
    await sendTelegramMessage(chatId, "Каталог временно недоступен. Попробуйте позже.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const categories = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug
    FROM categories
    WHERE shop_id = ${shopId}
      AND is_active = true
    ORDER BY sort_order ASC, name ASC
    LIMIT 24
  `;

  if (categories.length === 0) {
    await sendTelegramMessage(chatId, "Каталог пока наполняется.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const categoryButtons = categories.map((category) => ({
    text: category.name,
    callback_data: `cat:${category.id}`
  }));

  const rows: TelegramInlineKeyboardButton[][] = [
    ...chunkRows(categoryButtons, 2),
    [{ text: "🌐 Открыть каталог на сайте", url: buildCatalogUrl() }],
    [{ text: "❌ Скрыть", callback_data: "msg:delete" }]
  ];

  await sendOrEditTelegramMessage(
    chatId,
    [
      "🛍 Каталог",
      "",
      "Выберите раздел, а я покажу товары прямо здесь."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard(rows)
    },
    messageId
  );
}

async function handleCatalogCategory(chatId: number, categoryId: string, messageId?: number) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    await sendTelegramMessage(chatId, "Каталог временно недоступен. Попробуйте позже.");
    return;
  }

  const categoryRows = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug
    FROM categories
    WHERE shop_id = ${shopId}
      AND id = ${categoryId}
      AND is_active = true
    LIMIT 1
  `;

  const category = categoryRows[0];

  if (!category) {
    await sendTelegramMessage(chatId, "Раздел каталога не найден или временно скрыт.");
    return;
  }

  const productRows = await sql<{
    id: string;
    name: string;
    slug: string;
    price: number;
    short_description: string | null;
  }[]>`
    SELECT id, name, slug, price, short_description
    FROM products
    WHERE shop_id = ${shopId}
      AND category_id = ${category.id}
      AND status = 'active'
    ORDER BY sort_order ASC, created_at DESC
    LIMIT 20
  `;

  if (productRows.length === 0) {
    await sendTelegramMessage(
      chatId,
      [
        `🛍 ${category.name}`,
        "",
        "В этом разделе пока нет доступных товаров.",
        "Можно вернуться в каталог или открыть сайт."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "⬅️ К разделам", callback_data: "catalog" }],
          [{ text: "🌐 Каталог на сайте", url: buildCatalogUrl() }],
          [{ text: "❌ Скрыть", callback_data: "msg:delete" }]
        ])
      }
    );
    return;
  }

  const productButtons = productRows.map((product) => ({
    text: `${product.name} · ${money(product.price)}`,
    callback_data: `prod:${product.id}`
  }));

  const rows: TelegramInlineKeyboardButton[][] = [
    ...chunkRows(productButtons, 1),
    [
      { text: "⬅️ К разделам", callback_data: "catalog" },
      { text: "🌐 На сайте", url: buildCatalogUrl(`?category=${category.slug}`) }
    ],
    [{ text: "❌ Скрыть", callback_data: "msg:delete" }]
  ];

  await sendOrEditTelegramMessage(
    chatId,
    [
      `🛍 ${category.name}`,
      "",
      "Выберите букет, чтобы открыть карточку:"
    ].join("\n"),
    {
      reply_markup: inlineKeyboard(rows)
    },
    messageId
  );
}

async function handleProductCard(chatId: number, productId: string) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    await sendTelegramMessage(chatId, "Каталог временно недоступен. Попробуйте позже.");
    return;
  }

  const productRows = await sql<{
    id: string;
    category_id: string | null;
    category_name: string | null;
    name: string;
    slug: string;
    price: number;
    short_description: string | null;
    description: string | null;
    composition: string | null;
    stock_quantity: number | null;
    is_stock_visible: boolean;
    image_url: string | null;
  }[]>`
    SELECT
      p.id,
      p.category_id,
      c.name AS category_name,
      p.name,
      p.slug,
      p.price,
      p.short_description,
      p.description,
      p.composition,
      p.stock_quantity,
      p.is_stock_visible,
      pi.url AS image_url
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT url
      FROM product_images
      WHERE product_id = p.id
      ORDER BY is_main DESC, sort_order ASC, created_at ASC
      LIMIT 1
    ) pi ON true
    WHERE p.shop_id = ${shopId}
      AND p.id = ${productId}
      AND p.status = 'active'
    LIMIT 1
  `;

  const product = productRows[0];

  if (!product) {
    await sendTelegramMessage(chatId, "Товар не найден или временно скрыт.");
    return;
  }

  const description = product.short_description || product.description || product.composition || "Стильный букет от магазина «ВЫБЕРИ МЕНЯ».";
  const stockText = product.is_stock_visible && product.stock_quantity !== null
    ? product.stock_quantity > 0 ? `В наличии: ${product.stock_quantity}` : "Наличие уточняется"
    : "В наличии";

  const lines = [
    `🌸 ${product.name}`,
    `Цена: ${money(product.price)}`,
    product.category_name ? `Раздел: ${product.category_name}` : "",
    `Наличие: ${stockText}`,
    "",
    description
  ].filter(Boolean);

  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "🧺 Добавить в корзину", callback_data: `cart:add:${product.id}` }],
    [{ text: "🌐 Открыть на сайте", url: buildProductUrl(product.slug) }],
    [
      product.category_id ? { text: "⬅️ Назад к товарам", callback_data: `cat:${product.category_id}` } : { text: "⬅️ К разделам", callback_data: "catalog" },
      { text: "🛍 Каталог", callback_data: "catalog" }
    ],
    [{ text: "❌ Скрыть карточку", callback_data: "msg:delete" }]
  ];

  const replyMarkup = inlineKeyboard(rows);
  const imageUrl = absoluteUrl(product.image_url);

  if (imageUrl) {
    await sendTelegramPhoto(chatId, imageUrl, lines.join("\n"), {
      reply_markup: replyMarkup
    });
    return;
  }

  await sendTelegramMessage(chatId, lines.join("\n"), {
    reply_markup: replyMarkup
  });
}


type TelegramCartRow = {
  product_id: string;
  quantity: number;
  name: string;
  slug: string;
  price: number;
};

async function addProductToTelegramCart(chatId: number, productId: string) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return null;
  }

  const productRows = await sql<{ id: string; name: string }[]>`
    SELECT id, name
    FROM products
    WHERE shop_id = ${shopId}
      AND id = ${productId}
      AND status = 'active'
    LIMIT 1
  `;

  const product = productRows[0];

  if (!product) {
    return null;
  }

  const rows = await sql<{ quantity: number }[]>`
    INSERT INTO telegram_cart_items (shop_id, telegram_chat_id, product_id, quantity)
    VALUES (${shopId}, ${chatId}, ${product.id}, 1)
    ON CONFLICT (shop_id, telegram_chat_id, product_id)
    DO UPDATE SET quantity = telegram_cart_items.quantity + 1,
                  updated_at = NOW()
    RETURNING quantity
  `;

  return {
    name: product.name,
    quantity: rows[0]?.quantity || 1
  };
}

async function decreaseProductInTelegramCart(chatId: number, productId: string) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  await sql`
    DELETE FROM telegram_cart_items
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
      AND product_id = ${productId}
      AND quantity <= 1
  `;

  await sql`
    UPDATE telegram_cart_items
    SET quantity = quantity - 1,
        updated_at = NOW()
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
      AND product_id = ${productId}
      AND quantity > 1
  `;
}

async function removeProductFromTelegramCart(chatId: number, productId: string) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  await sql`
    DELETE FROM telegram_cart_items
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
      AND product_id = ${productId}
  `;
}

async function clearTelegramCart(chatId: number) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  await sql`
    DELETE FROM telegram_cart_items
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
  `;
}

async function getTelegramCartRows(chatId: number): Promise<TelegramCartRow[]> {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return [];
  }

  const rows = await sql<TelegramCartRow[]>`
    SELECT
      tci.product_id,
      tci.quantity,
      p.name,
      p.slug,
      p.price
    FROM telegram_cart_items tci
    INNER JOIN products p ON p.id = tci.product_id
    WHERE tci.shop_id = ${shopId}
      AND tci.telegram_chat_id = ${chatId}
      AND p.status = 'active'
    ORDER BY tci.created_at ASC
  `;

  return rows;
}

async function handleCart(chatId: number, messageId?: number) {
  const rows = await getTelegramCartRows(chatId);

  if (rows.length === 0) {
    await sendOrEditTelegramMessage(
      chatId,
      [
        "🧺 Корзина",
        "",
        "Корзина пока пустая.",
        "Откройте каталог и добавьте букет прямо в боте."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "🛍 Перейти в каталог", callback_data: "catalog" }],
          [{ text: "❌ Скрыть", callback_data: "msg:delete" }]
        ])
      },
      messageId
    );
    return;
  }

  let total = 0;
  const lines = ["🧺 Корзина", ""];
  const buttons: TelegramInlineKeyboardButton[][] = [];

  rows.forEach((item, index) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    total += itemTotal;

    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`   ${item.quantity} × ${money(item.price)} = ${money(itemTotal)}`);
    lines.push("");

    buttons.push([
      { text: "➖", callback_data: `cart:dec:${item.product_id}` },
      { text: `${item.quantity} шт.`, callback_data: "cart:noop" },
      { text: "➕", callback_data: `cart:inc:${item.product_id}` },
      { text: "❌", callback_data: `cart:remove:${item.product_id}` }
    ]);
  });

  lines.push(`Итого: ${money(total)}`);
  lines.push("");
  lines.push("Следующий шаг — оформление заказа с адресом и телефоном прямо в боте.");

  buttons.push([
    { text: "🛍 Продолжить покупки", callback_data: "catalog" },
    { text: "🧹 Очистить", callback_data: "cart:clear" }
  ]);
  buttons.push([{ text: "✅ Оформить заказ", callback_data: "checkout:start" }]);
  buttons.push([{ text: "❌ Скрыть", callback_data: "msg:delete" }]);

  await sendOrEditTelegramMessage(
    chatId,
    lines.join("\n"),
    {
      reply_markup: inlineKeyboard(buttons)
    },
    messageId
  );
}


type TelegramCheckoutStep =
  | "customer_name"
  | "customer_phone"
  | "recipient_name"
  | "recipient_phone"
  | "delivery_type"
  | "delivery_zone"
  | "delivery_date"
  | "delivery_interval"
  | "delivery_address"
  | "payment_method"
  | "comment"
  | "privacy"
  | "confirm";

type TelegramPaymentMethod =
  | "cash_on_delivery"
  | "transfer_after_confirm"
  | "online_card"
  | "sbp";

type TelegramCheckoutData = {
  clientRequestId?: string;
  customerName?: string;
  customerPhone?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientSameAsCustomer?: boolean;
  deliveryType?: "delivery" | "pickup";
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  deliveryDateText?: string;
  deliveryIntervalId?: string;
  deliveryInterval?: string;
  deliveryAddress?: string;
  paymentMethod?: TelegramPaymentMethod;
  comment?: string;
  privacyAccepted?: boolean;
};

type TelegramCheckoutSession = {
  step: TelegramCheckoutStep;
  data: TelegramCheckoutData;
};

type CreatedTelegramOrder = {
  id: string;
  orderNumber: string;
  trackingToken: string;
  total: number;
  deliveryPrice: number;
  deliveryTariffName: string;
  paymentUrl: string;
  reused: boolean;
};

type TelegramDeliveryZone = {
  id: string;
  name: string;
  price: number;
  free_from_amount: number | null;
};

type TelegramDeliveryInterval = {
  id: string;
  name: string;
};

type TelegramCheckoutConfiguration = {
  pickupEnabled: boolean;
  pickupAddress: string;
  policyUrl: string;
  paymentMethods: {
    cash: boolean;
    transfer: boolean;
    online: boolean;
  };
};


function safeCheckoutData(value: unknown): TelegramCheckoutData {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      return safeCheckoutData(JSON.parse(value));
    } catch {
      return {};
    }
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const data: TelegramCheckoutData = {};
  const stringKeys: Array<keyof TelegramCheckoutData> = [
    "clientRequestId",
    "customerName",
    "customerPhone",
    "recipientName",
    "recipientPhone",
    "deliveryZoneId",
    "deliveryZoneName",
    "deliveryDateText",
    "deliveryIntervalId",
    "deliveryInterval",
    "deliveryAddress",
    "paymentMethod",
    "comment",
  ];

  for (const key of stringKeys) {
    if (typeof raw[key] === "string") {
      (data as Record<string, unknown>)[key] = raw[key];
    }
  }

  if (raw.deliveryType === "delivery" || raw.deliveryType === "pickup") {
    data.deliveryType = raw.deliveryType;
  }

  if (typeof raw.recipientSameAsCustomer === "boolean") {
    data.recipientSameAsCustomer = raw.recipientSameAsCustomer;
  }

  if (typeof raw.privacyAccepted === "boolean") {
    data.privacyAccepted = raw.privacyAccepted;
  }

  return data;
}


function normalizeInput(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePhone(value: string) {
  return value.trim().replace(/[^\d+]/g, "");
}

function phoneDigitsOnly(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  return digits;
}

function createTelegramOrderNumber() {
  return `VM-${Date.now()}`;
}

function createTelegramTrackingToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function parseDeliveryDateInput(value: string): Date | null {
  const text = value.trim();

  const ruMatch = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
  if (ruMatch) {
    const day = Number(ruMatch[1]);
    const month = Number(ruMatch[2]);
    const rawYear = Number(ruMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));

    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date;
    }
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));

    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date;
    }
  }

  return null;
}

function deliveryDateIso(value: string): string | null {
  const parsed = parseDeliveryDateInput(value);

  if (!parsed) return null;

  return parsed.toISOString().slice(0, 10);
}

function moscowTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function checkoutRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getTelegramCheckoutConfiguration(): Promise<TelegramCheckoutConfiguration> {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return {
      pickupEnabled: false,
      pickupAddress: "",
      policyUrl: "",
      paymentMethods: {
        cash: true,
        transfer: true,
        online: false,
      },
    };
  }

  const rows = await sql<{
    settings: unknown;
    is_online_payment_enabled: boolean;
    is_cash_payment_enabled: boolean;
    is_transfer_payment_enabled: boolean;
  }[]>`
    SELECT
      settings,
      is_online_payment_enabled,
      is_cash_payment_enabled,
      is_transfer_payment_enabled
    FROM shop_settings
    WHERE shop_id = ${shopId}
    LIMIT 1
  `;

  const row = rows[0];
  const settings = checkoutRecord(row?.settings);
  const delivery = checkoutRecord(settings.delivery);
  const site = checkoutRecord(settings.site);

  return {
    pickupEnabled: delivery.pickupEnabled !== false,
    pickupAddress: valueToText(delivery.pickupAddress),
    policyUrl: valueToText(site.policyUrl),
    paymentMethods: {
      cash: row?.is_cash_payment_enabled !== false,
      transfer: row?.is_transfer_payment_enabled !== false,
      online: row?.is_online_payment_enabled === true,
    },
  };
}

async function getTelegramDeliveryZones(): Promise<TelegramDeliveryZone[]> {
  const shopId = await getDefaultShopId();

  if (!shopId) return [];

  return sql<TelegramDeliveryZone[]>`
    SELECT id, name, price, free_from_amount
    FROM delivery_zones
    WHERE shop_id = ${shopId}
      AND is_active = true
      AND LOWER(BTRIM(name)) <> 'самовывоз'
    ORDER BY sort_order ASC, name ASC
  `;
}

async function getTelegramDeliveryIntervals(): Promise<TelegramDeliveryInterval[]> {
  const shopId = await getDefaultShopId();

  if (!shopId) return [];

  return sql<TelegramDeliveryInterval[]>`
    SELECT id, name
    FROM delivery_intervals
    WHERE shop_id = ${shopId}
      AND is_active = true
    ORDER BY sort_order ASC, name ASC
  `;
}

function telegramPaymentLabel(value: TelegramPaymentMethod | undefined) {
  if (value === "cash_on_delivery") return "При получении";
  if (value === "online_card") return "Онлайн картой";
  if (value === "sbp") return "СБП";
  return "Перевод после подтверждения";
}

async function showCheckoutDeliveryType(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "🚚 Доставка", callback_data: "checkout:delivery:delivery" }],
  ];

  if (configuration.pickupEnabled) {
    rows.push([{ text: "🏬 Самовывоз", callback_data: "checkout:delivery:pickup" }]);
  }

  rows.push([{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]);

  await setCheckoutSession(chatId, "delivery_type", data);
  await sendTelegramMessage(
    chatId,
    [
      "Шаг 5.",
      "Выберите способ получения заказа:",
    ].join("\n"),
    { reply_markup: inlineKeyboard(rows) },
  );
}

async function showCheckoutDeliveryZones(chatId: number, data: TelegramCheckoutData) {
  const zones = await getTelegramDeliveryZones();

  if (zones.length === 0) {
    await sendTelegramMessage(
      chatId,
      "Сейчас нет доступных зон доставки. Выберите самовывоз или свяжитесь с менеджером.",
      { reply_markup: checkoutCancelKeyboard() },
    );
    return;
  }

  const rows = zones.map((zone) => [{
    text: `${zone.name} · ${money(zone.price)}`,
    callback_data: `checkout:zone:${zone.id}`,
  }]);

  rows.push([{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]);

  await setCheckoutSession(chatId, "delivery_zone", data);
  await sendTelegramMessage(
    chatId,
    "Шаг 6. Выберите зону доставки. Итоговая стоимость будет рассчитана сервером по актуальному тарифу:",
    { reply_markup: inlineKeyboard(rows) },
  );
}

async function showCheckoutIntervals(chatId: number, data: TelegramCheckoutData) {
  const intervals = await getTelegramDeliveryIntervals();

  if (intervals.length === 0) {
    await sendTelegramMessage(
      chatId,
      "Сейчас нет доступных интервалов доставки. Свяжитесь с менеджером.",
      { reply_markup: checkoutCancelKeyboard() },
    );
    return;
  }

  const rows = intervals.map((interval) => [{
    text: `🕐 ${interval.name}`,
    callback_data: `checkout:interval:${interval.id}`,
  }]);

  rows.push([{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]);

  await setCheckoutSession(chatId, "delivery_interval", data);
  await sendTelegramMessage(
    chatId,
    "Шаг 8. Выберите удобный интервал доставки:",
    { reply_markup: inlineKeyboard(rows) },
  );
}

async function showCheckoutPaymentMethods(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (configuration.paymentMethods.transfer) {
    rows.push([{
      text: "💳 Перевод после подтверждения",
      callback_data: "checkout:payment:transfer_after_confirm",
    }]);
  }

  if (configuration.paymentMethods.cash) {
    rows.push([{
      text: "💵 При получении",
      callback_data: "checkout:payment:cash_on_delivery",
    }]);
  }

  if (configuration.paymentMethods.online) {
    rows.push([{
      text: "🌐 Онлайн картой",
      callback_data: "checkout:payment:online_card",
    }]);
    rows.push([{
      text: "⚡ СБП",
      callback_data: "checkout:payment:sbp",
    }]);
  }

  rows.push([{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]);

  if (rows.length === 1) {
    await sendTelegramMessage(
      chatId,
      "Временно нет доступных способов оплаты. Свяжитесь с менеджером.",
      { reply_markup: inlineKeyboard(rows) },
    );
    return;
  }

  await setCheckoutSession(chatId, "payment_method", data);
  await sendTelegramMessage(
    chatId,
    "Выберите способ оплаты:",
    { reply_markup: inlineKeyboard(rows) },
  );
}

async function showCheckoutPrivacy(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (configuration.policyUrl) {
    rows.push([{
      text: "📄 Политика конфиденциальности",
      url: absoluteUrl(configuration.policyUrl),
    }]);
  }

  rows.push([{
    text: "✅ Принимаю условия",
    callback_data: "checkout:privacy:accept",
  }]);
  rows.push([{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]);

  await setCheckoutSession(chatId, "privacy", data);
  await sendTelegramMessage(
    chatId,
    [
      "Перед подтверждением заказа необходимо согласие на обработку данных.",
      "Нажимая «Принимаю условия», вы подтверждаете согласие с правилами магазина и политикой конфиденциальности.",
    ].join("\n\n"),
    { reply_markup: inlineKeyboard(rows) },
  );
}

function checkoutCancelKeyboard() {
  return inlineKeyboard([
    [{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]
  ]);
}

async function getCheckoutSession(chatId: number): Promise<TelegramCheckoutSession | null> {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return null;
  }

  const rows = await sql<{ step: TelegramCheckoutStep; data: unknown }[]>`
    SELECT step, data
    FROM telegram_checkout_sessions
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
    LIMIT 1
  `;

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    step: row.step,
    data: safeCheckoutData(row.data)
  };
}

async function setCheckoutSession(chatId: number, step: TelegramCheckoutStep, data: TelegramCheckoutData) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  await sql`
    INSERT INTO telegram_checkout_sessions (shop_id, telegram_chat_id, step, data)
    VALUES (${shopId}, ${chatId}, ${step}, CAST(${JSON.stringify(data)} AS jsonb))
    ON CONFLICT (shop_id, telegram_chat_id)
    DO UPDATE SET step = EXCLUDED.step,
                  data = EXCLUDED.data,
                  updated_at = NOW()
  `;
}

async function clearCheckoutSession(chatId: number) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return;
  }

  await sql`
    DELETE FROM telegram_checkout_sessions
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
  `;
}

async function askCheckoutQuestion(chatId: number, text: string) {
  await sendTelegramMessage(chatId, text, {
    reply_markup: checkoutCancelKeyboard()
  });
}

async function handleCheckoutStart(chatId: number) {
  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    await handleCart(chatId);
    return;
  }

  const data: TelegramCheckoutData = {
    clientRequestId: randomUUID(),
    privacyAccepted: false,
  };

  await setCheckoutSession(chatId, "customer_name", data);

  await askCheckoutQuestion(
    chatId,
    [
      "✅ Оформление заказа",
      "",
      "Шаг 1.",
      "Введите ваше имя:",
    ].join("\n"),
  );
}

async function showCheckoutConfirm(chatId: number, data: TelegramCheckoutData) {
  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    await clearCheckoutSession(chatId);
    await handleCart(chatId);
    return;
  }

  let subtotal = 0;
  const productLines = cartRows.map((item, index) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    subtotal += itemTotal;
    return `${index + 1}. ${item.name} — ${item.quantity} шт. × ${money(item.price)} = ${money(itemTotal)}`;
  });

  await setCheckoutSession(chatId, "confirm", data);

  const deliveryLines = data.deliveryType === "pickup"
    ? ["Получение: самовывоз"]
    : [
        "Получение: доставка",
        `Зона: ${data.deliveryZoneName || "—"}`,
        `Дата: ${data.deliveryDateText || "—"}`,
        `Интервал: ${data.deliveryInterval || "—"}`,
        `Адрес: ${data.deliveryAddress || "—"}`,
      ];

  await sendTelegramMessage(
    chatId,
    [
      "📋 Проверьте заказ",
      "",
      ...productLines,
      "",
      `Предварительная сумма товаров: ${money(subtotal)}`,
      "Стоимость доставки и окончательный итог будут проверены сервером при подтверждении.",
      "",
      `Покупатель: ${data.customerName || ""}`,
      `Телефон: ${data.customerPhone || ""}`,
      `Получатель: ${data.recipientName || data.customerName || ""}`,
      `Телефон получателя: ${data.recipientPhone || data.customerPhone || ""}`,
      ...deliveryLines,
      `Оплата: ${telegramPaymentLabel(data.paymentMethod)}`,
      data.comment ? `Комментарий: ${data.comment}` : "Комментарий: нет",
      "",
      "После подтверждения цены, наличие, тариф доставки и правила магазина будут проверены повторно.",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [{ text: "✅ Подтвердить заказ", callback_data: "checkout:confirm" }],
        [{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }],
      ]),
    },
  );
}


async function handleCheckoutMessage(message: TelegramMessage, text: string): Promise<boolean> {
  const session = await getCheckoutSession(message.chat.id);

  if (!session) {
    return false;
  }

  const value = normalizeInput(text);

  if (value === "/cancel" || value === "❌ Отменить заказ") {
    await clearCheckoutSession(message.chat.id);
    await sendTelegramMessage(message.chat.id, "Оформление заказа отменено.");
    return true;
  }

  const data = safeCheckoutData(session.data);

  if (session.step === "customer_name") {
    if (value.length < 2) {
      await askCheckoutQuestion(message.chat.id, "Введите имя покупателя:");
      return true;
    }

    data.customerName = value;
    await setCheckoutSession(message.chat.id, "customer_phone", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 2.",
        "Введите ваш телефон:",
        "",
        "Например: +7 999 123-45-67",
      ].join("\n"),
    );
    return true;
  }

  if (session.step === "customer_phone") {
    const phone = normalizePhone(value);

    if (phoneDigitsOnly(phone).length < 10) {
      await askCheckoutQuestion(message.chat.id, "Введите корректный номер телефона:");
      return true;
    }

    data.customerPhone = phone;
    await setCheckoutSession(message.chat.id, "recipient_name", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 3.",
        "Введите имя получателя.",
        "Если получатель тот же, отправьте знак минус: -",
      ].join("\n"),
    );
    return true;
  }

  if (session.step === "recipient_name") {
    const sameName = value === "-";
    data.recipientName = sameName
      ? data.customerName || "Клиент Telegram"
      : value;

    if (!sameName && value.length < 2) {
      await askCheckoutQuestion(message.chat.id, "Введите имя получателя или знак минус:");
      return true;
    }

    await setCheckoutSession(message.chat.id, "recipient_phone", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 4.",
        "Введите телефон получателя.",
        "Если телефон тот же, отправьте знак минус: -",
      ].join("\n"),
    );
    return true;
  }

  if (session.step === "recipient_phone") {
    if (value === "-") {
      data.recipientPhone = data.customerPhone || "";
    } else {
      const phone = normalizePhone(value);

      if (phoneDigitsOnly(phone).length < 10) {
        await askCheckoutQuestion(message.chat.id, "Введите корректный телефон получателя:");
        return true;
      }

      data.recipientPhone = phone;
    }

    data.recipientSameAsCustomer =
      data.recipientName === data.customerName
      && phoneDigitsOnly(data.recipientPhone || "") === phoneDigitsOnly(data.customerPhone || "");

    await showCheckoutDeliveryType(message.chat.id, data);
    return true;
  }

  if (session.step === "delivery_date") {
    const isoDate = deliveryDateIso(value);

    if (!isoDate) {
      await askCheckoutQuestion(
        message.chat.id,
        "Введите дату в формате ДД.ММ.ГГГГ, например 25.07.2026:",
      );
      return true;
    }

    const today = moscowTodayIso();
    const latest = addDaysIso(today, 180);

    if (isoDate < today) {
      await askCheckoutQuestion(message.chat.id, "Дата доставки не может быть в прошлом. Введите другую дату:");
      return true;
    }

    if (isoDate > latest) {
      await askCheckoutQuestion(message.chat.id, "Дату можно выбрать не более чем на 180 дней вперёд:");
      return true;
    }

    data.deliveryDateText = isoDate;
    await showCheckoutIntervals(message.chat.id, data);
    return true;
  }

  if (session.step === "delivery_address") {
    if (value.length < 5) {
      await askCheckoutQuestion(message.chat.id, "Введите адрес доставки подробнее:");
      return true;
    }

    data.deliveryAddress = value;
    await showCheckoutPaymentMethods(message.chat.id, data);
    return true;
  }

  if (session.step === "comment") {
    if (value !== "-") {
      data.comment = value.slice(0, 1000);
    } else {
      data.comment = "";
    }

    await showCheckoutPrivacy(message.chat.id, data);
    return true;
  }

  if (session.step === "confirm") {
    await sendTelegramMessage(
      message.chat.id,
      "Нажмите «✅ Подтвердить заказ» или «❌ Отменить заказ» под сообщением с заказом.",
    );
    return true;
  }

  if (
    session.step === "delivery_type"
    || session.step === "delivery_zone"
    || session.step === "delivery_interval"
    || session.step === "payment_method"
    || session.step === "privacy"
  ) {
    await sendTelegramMessage(
      message.chat.id,
      "На этом шаге выберите один из вариантов кнопкой под предыдущим сообщением.",
      { reply_markup: checkoutCancelKeyboard() },
    );
    return true;
  }

  return false;
}


async function createOrderFromTelegramCheckout(
  chatId: number,
  data: TelegramCheckoutData,
): Promise<CreatedTelegramOrder | null> {
  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    return null;
  }

  const clientRequestId = data.clientRequestId || randomUUID();
  data.clientRequestId = clientRequestId;

  await setCheckoutSession(chatId, "confirm", data);

  const payload = {
    clientRequestId,
    customerName: data.customerName || "Клиент Telegram",
    customerPhone: data.customerPhone || "",
    customerEmail: "",
    recipientSameAsCustomer: data.recipientSameAsCustomer === true,
    recipientName: data.recipientName || data.customerName || "Клиент Telegram",
    recipientPhone: data.recipientPhone || data.customerPhone || "",
    isSurprise: false,
    doNotCallRecipient: false,
    cardText: "",
    contactPreference: "call_or_message",
    deliveryType: data.deliveryType || "delivery",
    deliveryService: "standard",
    deliveryAddress: data.deliveryType === "pickup" ? "" : data.deliveryAddress || "",
    deliveryComment: data.comment || "",
    deliveryDate: data.deliveryType === "pickup" ? "" : data.deliveryDateText || "",
    deliveryIntervalId: data.deliveryType === "pickup" ? "" : data.deliveryIntervalId || "",
    deliveryIntervalText: data.deliveryType === "pickup" ? "" : data.deliveryInterval || "",
    deliveryZoneId: data.deliveryType === "pickup" ? "" : data.deliveryZoneId || "",
    paymentMethod: data.paymentMethod || "transfer_after_confirm",
    customerComment: data.comment || "",
    promoCode: "",
    bonusToSpend: 0,
    privacyAccepted: data.privacyAccepted === true,
    items: cartRows.map((item) => ({
      productId: item.product_id,
      quantity: Number(item.quantity || 0),
    })),
  };

  const response = await fetch(`${INTERNAL_API_URL}/api/public/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vm-order-source": "telegram-bot",
      "x-vm-telegram-chat-id": String(chatId),
      "x-vm-internal-token": INTERNAL_ORDER_TOKEN,
      "user-agent": "viberimenya-telegram-bot/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  const responseData = await response.json().catch(() => null) as {
    ok?: boolean;
    message?: string;
    error?: string;
    order?: {
      id?: string;
      orderNumber?: string;
      trackingToken?: string;
      totalAmount?: number;
      deliveryPrice?: number;
      deliveryTariffName?: string;
      reused?: boolean;
    };
  } | null;

  if (!response.ok || !responseData?.ok || !responseData.order?.id) {
    throw new Error(
      responseData?.message
      || responseData?.error
      || `API вернул HTTP ${response.status}`,
    );
  }

  const order = responseData.order;

  await clearTelegramCart(chatId);
  await clearCheckoutSession(chatId);

  return {
    id: order.id || "",
    orderNumber: order.orderNumber || "",
    trackingToken: order.trackingToken || "",
    total: Number(order.totalAmount || 0),
    deliveryPrice: Number(order.deliveryPrice || 0),
    deliveryTariffName: order.deliveryTariffName || "Доставка",
    paymentUrl: "",
    reused: order.reused === true,
  };
}


async function handleCheckoutConfirm(chatId: number) {
  if (pendingTelegramCheckoutConfirmations.has(chatId)) {
    await sendTelegramMessage(chatId, "Заказ уже создаётся. Подождите несколько секунд.");
    return;
  }

  const session = await getCheckoutSession(chatId);

  if (!session) {
    await sendTelegramMessage(chatId, "Оформление заказа не найдено. Откройте корзину и начните заново.");
    return;
  }

  if (session.step !== "confirm" || session.data.privacyAccepted !== true) {
    await sendTelegramMessage(chatId, "Сначала заполните данные и подтвердите согласие с условиями.");
    return;
  }

  pendingTelegramCheckoutConfirmations.add(chatId);

  try {
    const order = await createOrderFromTelegramCheckout(chatId, session.data || {});

    if (!order) {
      await sendTelegramMessage(chatId, "Корзина пустая. Добавьте товар и попробуйте снова.");
      return;
    }

    const paymentMessage = session.data.paymentMethod === "cash_on_delivery"
      ? "Оплата будет принята при получении."
      : session.data.paymentMethod === "online_card" || session.data.paymentMethod === "sbp"
        ? "После подтверждения заказа менеджером ссылка на безопасную оплату появится на странице отслеживания и придёт в Telegram."
        : "Менеджер проверит заказ и отправит реквизиты или ссылку на оплату.";

    await sendTelegramMessage(
      chatId,
      [
        order.reused ? "✅ Заказ уже был создан" : "✅ Заказ создан",
        "",
        `Номер заказа: ${order.orderNumber}`,
        `Товары и доставка: ${money(order.total)}`,
        order.deliveryPrice > 0
          ? `${order.deliveryTariffName}: ${money(order.deliveryPrice)}`
          : `${order.deliveryTariffName}: бесплатно`,
        "",
        paymentMessage,
        "",
        `Отследить заказ: ${absoluteUrl(`/order/track/${order.trackingToken}`)}`,
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId),
      },
    );
  } catch (error) {
    console.error("[bot-worker] telegram checkout failed", error);

    const message = error instanceof Error
      ? error.message.slice(0, 500)
      : "Неизвестная ошибка";

    await sendTelegramMessage(
      chatId,
      [
        "Не удалось создать заказ.",
        message,
        "",
        "Корзина и заполненные данные сохранены. Исправьте причину и нажмите подтверждение ещё раз или напишите менеджеру.",
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "🔄 Повторить подтверждение", callback_data: "checkout:confirm" }],
          [{ text: "📝 Заполнить заново", callback_data: "checkout:restart" }],
          [{ text: "🧺 Вернуться в корзину", callback_data: "checkout:cart" }],
          [{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }],
        ]),
      },
    );
  } finally {
    pendingTelegramCheckoutConfirmations.delete(chatId);
  }
}


async function handleCheckoutDeliveryType(
  callbackQuery: TelegramCallbackQuery,
  deliveryType: "delivery" | "pickup",
) {
  const chatId = callbackQuery.message?.chat.id;

  if (!chatId) return;

  const session = await getCheckoutSession(chatId);

  if (!session || session.step !== "delivery_type") {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже завершён");
    return;
  }

  const data = safeCheckoutData(session.data);
  const configuration = await getTelegramCheckoutConfiguration();

  if (deliveryType === "pickup") {
    if (!configuration.pickupEnabled) {
      await answerCallbackQuery(callbackQuery.id, "Самовывоз временно недоступен");
      await showCheckoutDeliveryType(chatId, data);
      return;
    }

    data.deliveryType = "pickup";
    data.deliveryZoneId = "";
    data.deliveryZoneName = "";
    data.deliveryDateText = "";
    data.deliveryIntervalId = "";
    data.deliveryInterval = "";
    data.deliveryAddress = configuration.pickupAddress;

    await answerCallbackQuery(callbackQuery.id, "Выбран самовывоз");
    await showCheckoutPaymentMethods(chatId, data);
    return;
  }

  data.deliveryType = "delivery";
  await answerCallbackQuery(callbackQuery.id, "Выбрана доставка");
  await showCheckoutDeliveryZones(chatId, data);
}

async function handleCheckoutZone(
  callbackQuery: TelegramCallbackQuery,
  zoneId: string,
) {
  const chatId = callbackQuery.message?.chat.id;

  if (!chatId) return;

  const session = await getCheckoutSession(chatId);

  if (!session || session.step !== "delivery_zone") {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже завершён");
    return;
  }

  const shopId = await getDefaultShopId();

  if (!shopId) {
    await answerCallbackQuery(callbackQuery.id, "Магазин временно недоступен");
    return;
  }

  const rows = await sql<TelegramDeliveryZone[]>`
    SELECT id, name, price, free_from_amount
    FROM delivery_zones
    WHERE shop_id = ${shopId}
      AND id = ${zoneId}
      AND is_active = true
      AND LOWER(BTRIM(name)) <> 'самовывоз'
    LIMIT 1
  `;

  const zone = rows[0];

  if (!zone) {
    await answerCallbackQuery(callbackQuery.id, "Зона больше недоступна");
    await showCheckoutDeliveryZones(chatId, safeCheckoutData(session.data));
    return;
  }

  const data = safeCheckoutData(session.data);
  data.deliveryZoneId = zone.id;
  data.deliveryZoneName = zone.name;

  await answerCallbackQuery(callbackQuery.id, zone.name);
  await setCheckoutSession(chatId, "delivery_date", data);
  await askCheckoutQuestion(
    chatId,
    [
      "Шаг 7.",
      "Введите дату доставки в формате ДД.ММ.ГГГГ:",
      "",
      "Например: 25.07.2026",
    ].join("\n"),
  );
}

async function handleCheckoutInterval(
  callbackQuery: TelegramCallbackQuery,
  intervalId: string,
) {
  const chatId = callbackQuery.message?.chat.id;

  if (!chatId) return;

  const session = await getCheckoutSession(chatId);

  if (!session || session.step !== "delivery_interval") {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже завершён");
    return;
  }

  const shopId = await getDefaultShopId();

  if (!shopId) {
    await answerCallbackQuery(callbackQuery.id, "Магазин временно недоступен");
    return;
  }

  const rows = await sql<TelegramDeliveryInterval[]>`
    SELECT id, name
    FROM delivery_intervals
    WHERE shop_id = ${shopId}
      AND id = ${intervalId}
      AND is_active = true
    LIMIT 1
  `;

  const interval = rows[0];

  if (!interval) {
    await answerCallbackQuery(callbackQuery.id, "Интервал больше недоступен");
    await showCheckoutIntervals(chatId, safeCheckoutData(session.data));
    return;
  }

  const data = safeCheckoutData(session.data);
  data.deliveryIntervalId = interval.id;
  data.deliveryInterval = interval.name;

  await answerCallbackQuery(callbackQuery.id, interval.name);
  await setCheckoutSession(chatId, "delivery_address", data);
  await askCheckoutQuestion(
    chatId,
    [
      "Шаг 9.",
      "Введите полный адрес доставки:",
      "",
      "Город, улица, дом, квартира или офис.",
    ].join("\n"),
  );
}

async function handleCheckoutPayment(
  callbackQuery: TelegramCallbackQuery,
  paymentMethod: TelegramPaymentMethod,
) {
  const chatId = callbackQuery.message?.chat.id;

  if (!chatId) return;

  const session = await getCheckoutSession(chatId);

  if (!session || session.step !== "payment_method") {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже завершён");
    return;
  }

  const configuration = await getTelegramCheckoutConfiguration();
  const isAllowed =
    (paymentMethod === "cash_on_delivery" && configuration.paymentMethods.cash)
    || (paymentMethod === "transfer_after_confirm" && configuration.paymentMethods.transfer)
    || (
      (paymentMethod === "online_card" || paymentMethod === "sbp")
      && configuration.paymentMethods.online
    );

  if (!isAllowed) {
    await answerCallbackQuery(callbackQuery.id, "Способ оплаты больше недоступен");
    await showCheckoutPaymentMethods(chatId, safeCheckoutData(session.data));
    return;
  }

  const data = safeCheckoutData(session.data);
  data.paymentMethod = paymentMethod;

  await answerCallbackQuery(callbackQuery.id, telegramPaymentLabel(paymentMethod));
  await setCheckoutSession(chatId, "comment", data);
  await askCheckoutQuestion(
    chatId,
    [
      "Последний вопрос.",
      "Добавьте комментарий к заказу.",
      "Если комментария нет, отправьте знак минус: -",
    ].join("\n"),
  );
}

async function handleCheckoutPrivacyAccept(callbackQuery: TelegramCallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;

  if (!chatId) return;

  const session = await getCheckoutSession(chatId);

  if (!session || session.step !== "privacy") {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже завершён");
    return;
  }

  const data = safeCheckoutData(session.data);
  data.privacyAccepted = true;

  await answerCallbackQuery(callbackQuery.id, "Согласие принято");
  await showCheckoutConfirm(chatId, data);
}

async function handleCheckoutCancel(chatId: number) {
  await clearCheckoutSession(chatId);
  await sendTelegramMessage(chatId, "Оформление заказа отменено.", {
    reply_markup: await mainKeyboardForChat(chatId)
  });
}


function orderStatusText(status: string) {
  const map: Record<string, string> = {
    new: "Принят",
    confirmed: "Подтверждён",
    assembling: "Собирается",
    ready: "Готовится к доставке",
    assigned_courier: "Передан курьеру",
    delivering: "В доставке",
    delivered: "Доставлен",
    cancelled: "Отменён",
    problem: "Нужно уточнение"
  };

  return map[status] || status;
}

function orderPaymentText(status: string) {
  const map: Record<string, string> = {
    not_required: "Оплата не требуется",
    pending: "Ожидает оплаты",
    paid: "Оплачен",
    failed: "Ошибка оплаты",
    refunded: "Возврат",
    cancelled: "Оплата отменена"
  };

  return map[status] || status;
}

function shortDateText(value: unknown) {
  const text = valueToText(value);

  if (!text) {
    return "";
  }

  try {
    return new Date(text).toLocaleDateString("ru-RU");
  } catch {
    return "";
  }
}

function staffRoleText(role: string | null | undefined) {
  const map: Record<string, string> = {
    owner: "Владелец",
    admin: "Администратор",
    manager: "Менеджер",
    florist: "Флорист",
    courier: "Курьер",
    staff: "Сотрудник"
  };

  return map[String(role || "staff")] || String(role || "staff");
}

async function handleCustomerProfile(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id) {
    const staffRows = await sql<{
      name: string | null;
      phone: string | null;
      email: string | null;
      role: string;
      last_login_at: string | null;
    }[]>`
      SELECT
        u.name,
        u.phone,
        u.email,
        su.role,
        u.last_login_at
      FROM shop_users su
      JOIN users u ON u.id = su.user_id
      WHERE su.shop_id = ${profile.shop_id}
        AND su.user_id = ${profile.user_id}
        AND su.is_active = true
      LIMIT 1
    `;

    const staff = staffRows[0];

    if (!staff) {
      await sendTelegramMessage(
        chatId,
        [
          "👤 Профиль",
          "",
          "Эта Telegram-привязка больше не активна.",
          "Получите новый код в CRM и нажмите «🔗 Привязать аккаунт»."
        ].join("\n"),
        {
          reply_markup: await mainKeyboardForChat(chatId)
        }
      );
      return;
    }

    await sendTelegramMessage(
      chatId,
      [
        "👤 Профиль сотрудника",
        "",
        staff.name ? `Имя: ${staff.name}` : "",
        `Роль: ${staffRoleText(staff.role)}`,
        staff.phone ? `Телефон: ${staff.phone}` : "",
        staff.email ? `Email: ${staff.email}` : "",
        profile.username ? `Telegram: @${profile.username}` : "",
        "",
        "🔔 Уведомления: включены",
        "Задачи по заказам будут приходить сюда автоматически.",
        "",
        `CRM: ${SITE_URL}/admin`
      ].filter(Boolean).join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "👤 Профиль",
        "",
        "Личный кабинет пока не подключён.",
        "Получите код привязки на сайте или в CRM, затем нажмите «🔗 Привязать аккаунт» и введите код."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  const customerRows = await sql<{
    phone: string;
    name: string | null;
    email: string | null;
    bonus_balance: number;
    total_orders: number;
    total_spent: number;
    last_order_at: string | null;
  }[]>`
    SELECT phone, name, email, bonus_balance, total_orders, total_spent, last_order_at
    FROM customers
    WHERE id = ${profile.customer_id}
    LIMIT 1
  `;

  const customer = customerRows[0];

  if (!customer) {
    await sendTelegramMessage(chatId, "Профиль покупателя не найден. Попробуйте позже.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const loginUrl = await createCustomerMagicLoginUrl({
    shopId: profile.shop_id,
    customerId: profile.customer_id,
    orderId: null
  });

  await sendTelegramMessage(
    chatId,
    [
      "👤 Профиль покупателя",
      "",
      customer.name ? `Имя: ${customer.name}` : "",
      `Телефон: ${customer.phone}`,
      customer.email ? `Email: ${customer.email}` : "",
      `Бонусы: ${money(customer.bonus_balance)}`,
      `Заказов: ${Number(customer.total_orders || 0)}`,
      `Покупки: ${money(customer.total_spent)}`,
      customer.last_order_at ? `Последний заказ: ${shortDateText(customer.last_order_at)}` : "",
      "",
      "На сайте доступна полная история заказов и бонусов."
    ].filter(Boolean).join("\n"),
    {
      reply_markup: replyMarkup
    }
  );

  await sendTelegramMessage(chatId, "Открыть личный кабинет:", {
    reply_markup: inlineKeyboard([
      [
        {
          text: "Личный кабинет",
          url: loginUrl
        }
      ]
    ])
  });
}

async function handleContact(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);

  await sendTelegramMessage(
    chatId,
    [
      "☎️ Связь",
      "",
      "Мы на связи в Telegram и WhatsApp.",
      `Сайт: ${SITE_URL}`
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );
}

async function handleOrders(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id) {
    await sendTelegramMessage(
      chatId,
      [
        "📦 Заказы",
        "",
        "Рабочие заказы доступны в CRM.",
        `CRM: ${SITE_URL}/admin`
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "📦 Мои заказы",
        "",
        "У вас пока нет заказов.",
        "Откройте каталог, выберите букет и оформите доставку прямо в боте."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  const shopId = await getDefaultShopId();

  if (!shopId) {
    await sendTelegramMessage(chatId, "Не удалось загрузить заказы. Попробуйте позже.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const orders = await sql<{
    order_number: string;
    status: string;
    payment_status: string;
    total: number;
    tracking_token: string | null;
    created_at: string;
    delivery_date: string | null;
  }[]>`
    SELECT order_number, status, payment_status, total, tracking_token, created_at, delivery_date
    FROM orders
    WHERE shop_id = ${shopId}
      AND customer_id = ${profile.customer_id}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  if (orders.length === 0) {
    await sendTelegramMessage(
      chatId,
      [
        "📦 Мои заказы",
        "",
        "У вас пока нет заказов.",
        "Откройте каталог, выберите букет и оформите доставку прямо в боте."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "📦 Мои заказы",
      "",
      `Показываю последние ${orders.length} заказ(а).`
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );

  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    if (!order) continue;

    const createdText = shortDateText(order.created_at);
    const deliveryText = shortDateText(order.delivery_date);

    const message = [
      `📦 Заказ ${index + 1}`,
      "",
      `Номер: ${order.order_number}`,
      `Статус: ${orderStatusText(order.status)}`,
      `Оплата: ${orderPaymentText(order.payment_status)}`,
      `Сумма: ${money(order.total)}`,
      deliveryText ? `Доставка: ${deliveryText}` : "",
      createdText ? `Создан: ${createdText}` : ""
    ].filter(Boolean).join("\n");

    await sendTelegramMessage(
      chatId,
      message,
      {
        reply_markup: order.tracking_token
          ? inlineKeyboard([
              [
                {
                  text: "Открыть заказ",
                  url: absoluteUrl(`/order/track/${order.tracking_token}`)
                }
              ]
            ])
          : replyMarkup
      }
    );
  }
}

async function handleBonuses(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🎁 Бонусы",
        "",
        "Бонусы клиентов отображаются в карточке клиента и заказах в CRM.",
        `CRM: ${SITE_URL}/admin`
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🎁 Бонусы",
        "",
        "Бонусный счёт появится после первого заказа.",
        "После оплаты заказа бонусы будут отображаться здесь и в личном кабинете.",
        "",
        `Личный кабинет: ${SITE_URL}/account`
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  const customerRows = await sql<{
    bonus_balance: number;
    total_orders: number;
    total_spent: number;
  }[]>`
    SELECT bonus_balance, total_orders, total_spent
    FROM customers
    WHERE id = ${profile.customer_id}
    LIMIT 1
  `;

  const customer = customerRows[0];

  if (!customer) {
    await sendTelegramMessage(
      chatId,
      [
        "🎁 Бонусы",
        "",
        "Бонусный счёт появится после первого заказа.",
        "",
        `Личный кабинет: ${SITE_URL}/account`
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "🎁 Бонусы",
      "",
      `Баланс: ${money(customer.bonus_balance)}`,
      `Заказов: ${Number(customer.total_orders || 0)}`,
      `Покупки: ${money(customer.total_spent)}`,
      "",
      "Бонусы можно использовать при следующих заказах.",
      "",
      `Личный кабинет: ${SITE_URL}/account`
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );
}

async function handleFloristAssemblyOrders(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await sendTelegramMessage(chatId, "💐 Раздел сборки доступен только сотруднику.", {
      reply_markup: replyMarkup
    });
    return;
  }

  if (!["owner", "admin", "florist"].includes(profile.role || "")) {
    await sendTelegramMessage(chatId, "💐 Раздел сборки доступен только флористу.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const orders = await sql<{
    id: string;
    order_number: string;
    status: string;
    delivery_date: string | null;
    delivery_address_text: string | null;
    recipient_name: string | null;
    product_name: string | null;
    bouquet_photo_url: string | null;
    bouquet_approval_status: string | null;
    bouquet_approval_note: string | null;
    created_at: string;
  }[]>`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.delivery_date,
      o.delivery_address_text,
      o.recipient_name,
      o.bouquet_photo_url,
      o.metadata #>> '{bouquetApproval,status}' AS bouquet_approval_status,
      o.metadata #>> '{bouquetApproval,note}' AS bouquet_approval_note,
      o.created_at,
      COALESCE((
        SELECT string_agg(
          oi.product_name || CASE WHEN oi.quantity > 1 THEN ' ×' || oi.quantity::text ELSE '' END,
          ', '
          ORDER BY oi.created_at
        )
        FROM order_items oi
        WHERE oi.order_id = o.id
      ), '') AS product_name
    FROM orders o
    WHERE o.shop_id = ${profile.shop_id}
      AND o.florist_id = ${profile.user_id}
      AND o.status IN ('new', 'confirmed', 'assembling', 'ready')
    ORDER BY
      CASE o.status
        WHEN 'assembling' THEN 1
        WHEN 'confirmed' THEN 2
        WHEN 'new' THEN 3
        WHEN 'ready' THEN 4
        ELSE 5
      END,
      o.delivery_date NULLS LAST,
      o.created_at DESC
    LIMIT 10
  `;

  if (!orders.length) {
    await sendTelegramMessage(
      chatId,
      [
        "💐 Сборка заказов",
        "",
        "У вас пока нет активных заказов на сборку."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "💐 Сборка заказов",
      "",
      `Активных заказов: ${orders.length}`,
      "Ниже отправляю карточки заказов с действиями."
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );

  for (const order of orders) {
    const rows: TelegramInlineKeyboardButton[][] = [];

    if (order.status === "new" || order.status === "confirmed") {
      rows.push([
        {
          text: "💐 Взять в работу",
          callback_data: `florist:take:${order.id}`
        }
      ]);
    }

    if (order.status === "assembling") {
      const approvalStatus = order.bouquet_approval_status || "";

      rows.push([
        {
          text: order.bouquet_photo_url ? "📸 Заменить фото" : "📸 Загрузить фото",
          callback_data: `florist:photo:${order.id}`
        }
      ]);

      if (approvalStatus === "approved" || approvalStatus === "waived" || !approvalStatus) {
        rows.push([
          {
            text: "✅ Готово",
            callback_data: `florist:ready:${order.id}`
          }
        ]);
      }
    }

    rows.push([
      {
        text: "⚠️ Проблема",
        callback_data: `florist:problem:${order.id}`
      }
    ]);

    rows.push([
      {
        text: "🔄 Обновить список",
        callback_data: "florist:list"
      }
    ]);

    await sendTelegramMessage(
      chatId,
      [
        `Заказ ${order.order_number}`,
        `Статус: ${orderStatusText(order.status)}`,
        order.product_name ? `Товар: ${order.product_name}` : "",
        order.delivery_date ? `Дата доставки: ${shortDateText(order.delivery_date)}` : "",
        order.recipient_name ? `Получатель: ${order.recipient_name}` : "",
        order.delivery_address_text ? `Адрес: ${order.delivery_address_text}` : "",
        order.bouquet_photo_url
          ? order.bouquet_approval_status === "pending"
            ? "Согласование: ⏳ ждём ответ клиента"
            : order.bouquet_approval_status === "revision_requested"
              ? "Согласование: 🔄 клиент попросил правку"
              : order.bouquet_approval_status === "approved"
                ? "Согласование: ✅ одобрено клиентом"
                : order.bouquet_approval_status === "waived"
                  ? "Согласование: ✅ разрешено менеджером"
                  : "Согласование: не требуется для старого заказа"
          : "",
        order.bouquet_approval_note ? `Комментарий: ${order.bouquet_approval_note}` : ""
      ].filter(Boolean).join("\n"),
      {
        reply_markup: inlineKeyboard(rows)
      }
    );
  }
}

async function handleFloristTakeOrder(callbackQuery: TelegramCallbackQuery, orderId: string) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Доступно только сотруднику");
    return;
  }

  const orderRows = await sql<{
    id: string;
    order_number: string;
    status: string;
    florist_id: string | null;
  }[]>`
    SELECT id, order_number, status, florist_id
    FROM orders
    WHERE id = ${orderId}
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const order = orderRows[0];

  if (!order) {
    await answerCallbackQuery(callbackQuery.id, "Заказ не найден");
    return;
  }

  if (order.florist_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому флористу");
    return;
  }

  if (order.status === "cancelled" || order.status === "delivered") {
    await answerCallbackQuery(callbackQuery.id, "Заказ уже закрыт");
    return;
  }

  if (order.status === "assembling") {
    await answerCallbackQuery(callbackQuery.id, "Заказ уже в работе");

    await sendTelegramMessage(
      chatId,
      [
        `💐 Заказ ${order.order_number} уже в работе`,
        "",
        "Когда букет будет собран, нажмите «Готово»."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "✅ Готово",
              callback_data: `florist:ready:${order.id}`
            }
          ]
        ])
      }
    );

    return;
  }

  await sql`
    UPDATE orders
    SET status = 'assembling',
        updated_at = NOW()
    WHERE id = ${order.id}
      AND shop_id = ${profile.shop_id}
  `;

  await sql`
    INSERT INTO order_status_history (
      shop_id,
      order_id,
      from_status,
      to_status,
      comment,
      created_at
    )
    VALUES (
      ${profile.shop_id},
      ${order.id},
      ${order.status}::order_status,
      'assembling',
      'Флорист взял заказ в работу через Telegram',
      NOW()
    )
  `;

  await answerCallbackQuery(callbackQuery.id, "Заказ взят в работу");

  await sendTelegramMessage(
    chatId,
    [
      `✅ Заказ ${order.order_number} взят в работу`,
      "",
      "Статус в CRM изменён на «Собирается».",
      "Когда букет будет собран, нажмите «Готово»."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "📸 Загрузить фото",
            callback_data: `florist:photo:${order.id}`
          }
        ],
        [
          {
            text: "✅ Готово",
            callback_data: `florist:ready:${order.id}`
          }
        ]
      ])
    }
  );
}

async function handleFloristProblemOrder(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доступно только сотруднику"
    );
    return;
  }

  const orderRows = await sql<{
    id: string;
    order_number: string;
    status: string;
    florist_id: string | null;
  }[]>`
    SELECT
      id,
      order_number,
      status,
      florist_id
    FROM orders
    WHERE id = ${orderId}
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const order = orderRows[0];

  if (!order) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ не найден"
    );
    return;
  }

  if (order.florist_id !== profile.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ назначен другому флористу"
    );
    return;
  }

  if (
    order.status === "delivered" ||
    order.status === "cancelled"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ уже закрыт"
    );
    return;
  }

  if (order.status === "problem") {
    await answerCallbackQuery(
      callbackQuery.id,
      "Проблема уже отмечена"
    );
    return;
  }

  pendingBouquetPhotoRequests.delete(chatId);

  pendingFloristProblemRequests.set(chatId, {
    orderId: order.id,
    orderNumber: order.order_number,
    shopId: profile.shop_id,
    userId: profile.user_id,
    createdAt: Date.now()
  });

  await answerCallbackQuery(
    callbackQuery.id,
    "Опишите проблему"
  );

  await sendTelegramMessage(
    chatId,
    [
      `⚠️ Опишите проблему по заказу ${order.order_number}`,
      "",
      "Напишите одним сообщением, что произошло и что требуется от менеджера.",
      "",
      "Например:",
      "«Нет нужного сорта роз, требуется согласовать замену с клиентом».",
      "",
      "Для отмены отправьте /cancel.",
      "Запрос действует 15 минут."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleFloristProblemReasonMessage(
  message: TelegramMessage,
  text: string
): Promise<boolean> {
  const chatId = message.chat.id;
  const request = pendingFloristProblemRequests.get(chatId);

  if (!request) {
    return false;
  }

  const navigationTexts = new Set([
    "👤 Профиль",
    "🛍 Каталог",
    "📦 Мои заказы",
    "📦 Заказы",
    "🎁 Бонусы",
    "☎️ Связь",
    "🧺 Корзина",
    "🧾 CRM",
    "⚙️ Настройки",
    "💐 Сборка заказов",
    "🚚 Доставка",
    "🔔 Уведомления"
  ]);

  if (
    text.startsWith("/start") ||
    text === "/menu" ||
    navigationTexts.has(text)
  ) {
    pendingFloristProblemRequests.delete(chatId);
    return false;
  }

  if (text === "/cancel") {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `Отметка проблемы по заказу ${request.orderNumber} отменена.`,
        "",
        "Статус заказа не изменялся."
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  if (Date.now() - request.createdAt > 15 * 60 * 1000) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `Время ввода причины по заказу ${request.orderNumber} истекло.`,
        "",
        "Нажмите «⚠️ Проблема» ещё раз."
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  const reason = text.trim();

  if (reason.length < 3) {
    await sendTelegramMessage(
      chatId,
      "Опишите проблему подробнее — минимум 3 символа."
    );
    return true;
  }

  if (reason.length > 1000) {
    await sendTelegramMessage(
      chatId,
      "Описание слишком длинное. Сократите его до 1000 символов."
    );
    return true;
  }

  const profile = await getTelegramProfile(String(chatId));

  if (
    !profile?.user_id ||
    profile.shop_id !== request.shopId ||
    profile.user_id !== request.userId
  ) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Не удалось подтвердить профиль флориста. Откройте раздел сборки заказов повторно."
    );

    return true;
  }

  const orderRows = await sql<{
    id: string;
    order_number: string;
    status: string;
    florist_id: string | null;
    manager_id: string | null;
  }[]>`
    SELECT
      id,
      order_number,
      status,
      florist_id,
      manager_id
    FROM orders
    WHERE id = ${request.orderId}
      AND shop_id = ${request.shopId}
    LIMIT 1
  `;

  const order = orderRows[0];

  if (!order) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Заказ больше не найден."
    );

    return true;
  }

  if (order.florist_id !== profile.user_id) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Заказ больше не назначен вам."
    );

    return true;
  }

  if (
    order.status === "delivered" ||
    order.status === "cancelled"
  ) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Заказ уже закрыт. Отметить проблему нельзя."
    );

    return true;
  }

  if (order.status === "problem") {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "По этому заказу проблема уже отмечена."
    );

    return true;
  }

  const updatedRows = await sql<{ id: string }[]>`
    UPDATE orders
    SET
      status = 'problem',
      updated_at = NOW()
    WHERE id = ${order.id}
      AND shop_id = ${request.shopId}
      AND florist_id = ${profile.user_id}
      AND status = ${order.status}::order_status
    RETURNING id
  `;

  if (updatedRows.length === 0) {
    pendingFloristProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Статус заказа уже изменился. Обновите список заказов."
    );

    return true;
  }

  const historyComment =
    `Проблема от флориста через Telegram: ${reason}`;

  await sql`
    INSERT INTO order_status_history (
      shop_id,
      order_id,
      from_status,
      to_status,
      changed_by_user_id,
      comment,
      created_at
    )
    VALUES (
      ${request.shopId},
      ${order.id},
      ${order.status}::order_status,
      'problem',
      ${profile.user_id},
      ${historyComment},
      NOW()
    )
  `;

  pendingFloristProblemRequests.delete(chatId);

  try {
    await queueCustomerOrderNotification({
      shopId: request.shopId,
      orderId: order.id,
      type: "order_problem",
      status: "problem"
    });
  } catch (error) {
    console.error(
      `[bot-worker] customer problem notification failed order=${order.id}`,
      error instanceof Error ? error.message : error
    );
  }

  type StaffRecipient = {
    telegram_id: string;
  };

  let recipients: StaffRecipient[] = [];
  let recipientLabel = "менеджеру";

  if (order.manager_id) {
    recipients = await sql<StaffRecipient[]>`
      SELECT DISTINCT
        ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${request.shopId}
        AND ta.user_id = ${order.manager_id}
        AND ta.is_active = true
        AND ta.notifications_enabled = true
    `;
  }

  if (recipients.length === 0) {
    recipientLabel = "владельцу магазина";

    recipients = await sql<StaffRecipient[]>`
      SELECT DISTINCT
        ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${request.shopId}
        AND su.role IN ('owner', 'admin')
        AND ta.is_active = true
        AND ta.notifications_enabled = true
      ORDER BY ta.telegram_id
    `;
  }

  const crmUrl = `${SITE_URL}/admin/orders/${order.id}`;

  let notifiedCount = 0;

  for (const recipient of recipients) {
    try {
      await sendTelegramMessage(
        recipient.telegram_id,
        [
          `⚠️ Проблема по заказу ${order.order_number}`,
          "",
          "Флорист сообщил о проблеме:",
          reason,
          "",
          "Статус заказа изменён на «Проблема».",
          "Проверьте заказ в CRM."
        ].join("\n"),
        {
          reply_markup: inlineKeyboard([
            [
              {
                text: "Открыть заказ в CRM",
                url: crmUrl
              }
            ]
          ])
        }
      );

      notifiedCount += 1;
    } catch (error) {
      console.error(
        `[bot-worker] florist problem notification failed order=${order.id} recipient=${recipient.telegram_id}`,
        error instanceof Error ? error.message : error
      );
    }
  }

  await sendTelegramMessage(
    chatId,
    [
      `✅ Проблема по заказу ${order.order_number} сохранена`,
      "",
      `Причина: ${reason}`,
      "",
      "Статус в CRM изменён на «Проблема».",
      notifiedCount > 0
        ? `Уведомление отправлено ${recipientLabel}.`
        : "Активный получатель Telegram не найден. Причина сохранена в истории заказа."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "🔄 Сборка заказов",
            callback_data: "florist:list"
          }
        ]
      ])
    }
  );

  return true;
}

async function downloadTelegramFile(
  fileId: string,
  fileNamePrefix: string,
  uploadFolder = "bouquets"
) {
  const file = await telegramApi<{
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  }>(`getFile?file_id=${encodeURIComponent(fileId)}`);

  if (!file.file_path) {
    throw new Error("Telegram не вернул путь к файлу");
  }

  const extension = extname(file.file_path) || ".jpg";
  const safePrefix = fileNamePrefix.replace(/[^a-z0-9_-]/gi, "-");
  const fileName = `${safePrefix}-${Date.now()}-${randomUUID()}${extension}`;
  const safeFolder =
    uploadFolder === "deliveries"
      ? "deliveries"
      : "bouquets";
  const uploadDir = join(UPLOADS_DIR, safeFolder);
  const fullPath = join(uploadDir, fileName);
  const publicUrl = `/uploads/${safeFolder}/${fileName}`;

  await mkdir(uploadDir, { recursive: true });

  const response = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`);

  if (!response.ok) {
    throw new Error(`Не удалось скачать файл Telegram: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(fullPath, Buffer.from(arrayBuffer));

  return publicUrl;
}

function pickLargestTelegramPhoto(photos: TelegramPhotoSize[]) {
  let best: TelegramPhotoSize | null = null;

  for (const current of photos) {
    if (!best) {
      best = current;
      continue;
    }

    const bestScore = Number(best.file_size || best.width * best.height || 0);
    const currentScore = Number(current.file_size || current.width * current.height || 0);

    if (currentScore > bestScore) {
      best = current;
    }
  }

  return best;
}

async function handleFloristBouquetPhotoMessage(message: TelegramMessage) {
  const chatId = message.chat.id;
  const request = pendingBouquetPhotoRequests.get(chatId);

  if (!request) {
    return false;
  }

  if (Date.now() - request.createdAt > 15 * 60 * 1000) {
    pendingBouquetPhotoRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Время ожидания фото истекло. Нажмите «📸 Загрузить фото» ещё раз.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  const photos = message.photo || [];

  if (!photos.length) {
    return false;
  }

  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id || profile.user_id !== request.userId || profile.shop_id !== request.shopId) {
    pendingBouquetPhotoRequests.delete(chatId);
    await sendTelegramMessage(chatId, "Не удалось подтвердить сотрудника для загрузки фото.");
    return true;
  }

  let uploadedPublicUrl = "";
  let photoPersisted = false;

  try {
    const photo = pickLargestTelegramPhoto(photos);

    if (!photo) {
      await sendTelegramMessage(
        chatId,
        "Не удалось получить фото. Отправьте изображение ещё раз.",
        {
          reply_markup: await mainKeyboardForChat(chatId)
        }
      );

      return true;
    }

    const publicUrl = await downloadTelegramFile(
      photo.file_id,
      `bouquet-${request.orderId}`
    );
    uploadedPublicUrl = publicUrl;

    const updatedOrder = await sql.begin(async (transaction) => {
      const currentRows = await transaction<{
        id: string;
        order_number: string;
        status: string;
        florist_id: string | null;
      }[]>`
        SELECT
          id,
          order_number,
          status::text AS status,
          florist_id
        FROM orders
        WHERE id = ${request.orderId}
          AND shop_id = ${request.shopId}
        FOR UPDATE
      `;

      const current = currentRows[0];

      if (
        !current
        || current.florist_id !== request.userId
        || current.status !== "assembling"
      ) {
        return null;
      }

      const updatedRows = await transaction<{
        id: string;
        order_number: string;
        status: string;
        bouquet_photo_url: string | null;
      }[]>`
        UPDATE orders
        SET bouquet_photo_url = ${publicUrl},
            metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{bouquetApproval}',
              jsonb_build_object(
                'status', 'pending',
                'requestedAt', NOW(),
                'decidedAt', NULL,
                'note', NULL,
                'source', 'florist_telegram',
                'photoVersion', COALESCE(
                  NULLIF(metadata #>> '{bouquetApproval,photoVersion}', '')::int,
                  0
                ) + 1,
                'revisionCount', COALESCE(
                  NULLIF(metadata #>> '{bouquetApproval,revisionCount}', '')::int,
                  0
                )
              ),
              true
            ),
            updated_at = NOW()
        WHERE id = ${request.orderId}
          AND shop_id = ${request.shopId}
          AND florist_id = ${request.userId}
          AND status = 'assembling'
        RETURNING
          id,
          order_number,
          status::text AS status,
          bouquet_photo_url
      `;

      const updated = updatedRows[0];

      if (!updated) {
        return null;
      }

      await transaction`
        INSERT INTO order_status_history (
          shop_id,
          order_id,
          from_status,
          to_status,
          changed_by_user_id,
          comment,
          created_at
        )
        VALUES (
          ${request.shopId},
          ${updated.id},
          'assembling',
          'assembling',
          ${request.userId},
          'Флорист загрузил фото букета и отправил его клиенту на согласование',
          NOW()
        )
      `;

      return updated;
    });

    if (!updatedOrder) {
      await removeUploadedFile(publicUrl);
      pendingBouquetPhotoRequests.delete(chatId);

      await sendTelegramMessage(
        chatId,
        "Фото получено, но заказ уже недоступен для загрузки. Статус не изменён.",
        {
          reply_markup: await mainKeyboardForChat(chatId)
        }
      );

      return true;
    }

    photoPersisted = true;

    let approvalNotificationQueued = false;

    try {
      approvalNotificationQueued =
        await queueBouquetApprovalRequest({
          shopId: request.shopId,
          orderId: updatedOrder.id
        });
    } catch (notificationError) {
      console.error(
        `[bot-worker] bouquet approval notification failed order=${updatedOrder.id}`,
        notificationError
      );
    }

    pendingBouquetPhotoRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `✅ Фото по заказу ${updatedOrder.order_number} сохранено`,
        "",
        approvalNotificationQueued
          ? "Фото отправлено покупателю в Telegram на согласование."
          : "Telegram покупателя не подключён. Фото уже доступно по ссылке отслеживания — менеджер сможет отправить её вручную.",
        "После одобрения станет доступна кнопка «Готово».",
        `Фото: ${absoluteUrl(publicUrl)}`
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "🔄 Сборка заказов",
              callback_data: "florist:list"
            }
          ]
        ])
      }
    );

    return true;
  } catch (error) {
    if (uploadedPublicUrl && !photoPersisted) {
      await removeUploadedFile(uploadedPublicUrl);
    }

    await sendTelegramMessage(
      chatId,
      error instanceof Error ? error.message : "Не удалось сохранить фото. Попробуйте ещё раз.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }
}

async function handleFloristPhotoRequest(callbackQuery: TelegramCallbackQuery, orderId: string) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Доступно только сотруднику");
    return;
  }

  const orderRows = await sql<{
    id: string;
    order_number: string;
    status: string;
    florist_id: string | null;
  }[]>`
    SELECT id, order_number, status, florist_id
    FROM orders
    WHERE id = ${orderId}
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const order = orderRows[0];

  if (!order) {
    await answerCallbackQuery(callbackQuery.id, "Заказ не найден");
    return;
  }

  if (order.florist_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому флористу");
    return;
  }

  if (order.status !== "assembling") {
    await answerCallbackQuery(
      callbackQuery.id,
      "Фото можно менять только пока заказ находится в сборке"
    );
    return;
  }

  pendingBouquetPhotoRequests.set(chatId, {
    orderId: order.id,
    orderNumber: order.order_number,
    shopId: profile.shop_id,
    userId: profile.user_id,
    createdAt: Date.now()
  });

  await answerCallbackQuery(callbackQuery.id, "Отправьте фото букета");

  await sendTelegramMessage(
    chatId,
    [
      `📸 Фото для заказа ${order.order_number}`,
      "",
      "Отправьте фото готового букета следующим сообщением.",
      "Фото появится в CRM и будет отправлено покупателю на согласование.",
      "Не фотографируйте людей без их согласия."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleFloristReadyOrder(callbackQuery: TelegramCallbackQuery, orderId: string) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Доступно только сотруднику");
    return;
  }

  const orderRows = await sql<{
    id: string;
    order_number: string;
    status: string;
    florist_id: string | null;
    bouquet_photo_url: string | null;
    bouquet_approval_status: string | null;
  }[]>`
    SELECT
      id,
      order_number,
      status,
      florist_id,
      bouquet_photo_url,
      metadata #>> '{bouquetApproval,status}' AS bouquet_approval_status
    FROM orders
    WHERE id = ${orderId}
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const order = orderRows[0];

  if (!order) {
    await answerCallbackQuery(callbackQuery.id, "Заказ не найден");
    return;
  }

  if (order.florist_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому флористу");
    return;
  }

  if (order.status === "ready") {
    await answerCallbackQuery(callbackQuery.id, "Заказ уже отмечен готовым");
    return;
  }

  if (order.status !== "assembling") {
    await answerCallbackQuery(callbackQuery.id, "Сначала возьмите заказ в работу");
    return;
  }

  if (!order.bouquet_photo_url) {
    await answerCallbackQuery(callbackQuery.id, "Сначала загрузите фото букета");

    await sendTelegramMessage(
      chatId,
      [
        `📸 По заказу ${order.order_number} сначала нужно загрузить фото букета`,
        "",
        "Нажмите «📸 Загрузить фото» и отправьте фото готовой композиции."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "📸 Загрузить фото",
              callback_data: `florist:photo:${order.id}`
            }
          ],
          [
            {
              text: "🔄 Сборка заказов",
              callback_data: "florist:list"
            }
          ]
        ])
      }
    );

    return;
  }

  if (
    order.bouquet_approval_status === "pending"
    || order.bouquet_approval_status === "revision_requested"
  ) {
    const waitingForCustomer =
      order.bouquet_approval_status === "pending";

    await answerCallbackQuery(
      callbackQuery.id,
      waitingForCustomer
        ? "Сначала дождитесь согласования клиента"
        : "Клиент попросил внести правки"
    );

    await sendTelegramMessage(
      chatId,
      [
        waitingForCustomer
          ? `⏳ Фото по заказу ${order.order_number} ожидает согласования`
          : `🔄 По заказу ${order.order_number} нужна правка`,
        "",
        waitingForCustomer
          ? "После ответа клиента кнопка «Готово» станет доступна."
          : "Внесите изменения и загрузите новое фото букета."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: waitingForCustomer ? "🔄 Обновить" : "📸 Загрузить новое фото",
              callback_data: waitingForCustomer
                ? "florist:list"
                : `florist:photo:${order.id}`
            }
          ]
        ])
      }
    );

    return;
  }

  const readyResult = await sql.begin(async (transaction) => {
    const updatedRows = await transaction<{
      id: string;
      order_number: string;
    }[]>`
      UPDATE orders
      SET status = 'ready',
          updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id = ${profile.shop_id}
        AND florist_id = ${profile.user_id}
        AND status = 'assembling'
        AND bouquet_photo_url IS NOT NULL
        AND COALESCE(
          metadata #>> '{bouquetApproval,status}',
          'not_required'
        ) IN ('approved', 'waived', 'not_required')
      RETURNING id, order_number
    `;

    const updated = updatedRows[0];

    if (!updated) {
      return null;
    }

    await transaction`
      INSERT INTO order_status_history (
        shop_id,
        order_id,
        from_status,
        to_status,
        changed_by_user_id,
        comment,
        created_at
      )
      VALUES (
        ${profile.shop_id},
        ${updated.id},
        'assembling',
        'ready',
        ${profile.user_id},
        'Флорист завершил сборку после согласования фото',
        NOW()
      )
    `;

    await transaction`
      INSERT INTO notification_events (
        shop_id,
        order_id,
        type,
        channel,
        recipient_type,
        recipient_telegram_id,
        status,
        payload,
        created_at,
        updated_at
      )
      SELECT
        o.shop_id,
        o.id,
        'courier_order_assigned',
        'telegram',
        'staff',
        courier_ta.telegram_id,
        'pending',
        jsonb_build_object(
          'orderId', o.id,
          'orderNumber', o.order_number,
          'courierId', o.courier_id,
          'courierName', cu.name,
          'deliveryDate', o.delivery_date,
          'deliveryIntervalName', di.name,
          'deliveryAddressText', o.delivery_address_text,
          'deliveryComment', o.delivery_comment,
          'recipientName', o.recipient_name,
          'recipientPhone', o.recipient_phone,
          'trackingUrl', CASE
            WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
            ELSE '/order/track/' || o.tracking_token
          END,
          'crmUrl', '/admin/orders/' || o.id::text
        ),
        NOW(),
        NOW()
      FROM orders o
      JOIN users cu ON cu.id = o.courier_id
      JOIN LATERAL (
        SELECT ta.telegram_id
        FROM telegram_accounts ta
        JOIN shop_users su
          ON su.shop_id = ta.shop_id
         AND su.user_id = ta.user_id
         AND su.role = 'courier'
         AND su.is_active = true
        WHERE ta.shop_id = o.shop_id
          AND ta.user_id = o.courier_id
          AND ta.is_active = true
        ORDER BY ta.linked_at DESC
        LIMIT 1
      ) courier_ta ON true
      LEFT JOIN delivery_intervals di
        ON di.id = o.delivery_interval_id
       AND di.shop_id = o.shop_id
      WHERE o.id = ${updated.id}
        AND o.shop_id = ${profile.shop_id}
        AND o.courier_id IS NOT NULL
    `;

    await transaction`
      INSERT INTO notification_events (
        shop_id,
        order_id,
        type,
        channel,
        recipient_type,
        status,
        payload,
        created_at,
        updated_at
      )
      SELECT
        o.shop_id,
        o.id,
        'order_ready',
        'telegram',
        'customer',
        'pending',
        jsonb_build_object(
          'orderId', o.id,
          'orderNumber', o.order_number,
          'status', 'ready',
          'customerName', c.name,
          'customerPhone', c.phone,
          'recipientName', o.recipient_name,
          'recipientPhone', o.recipient_phone,
          'deliveryAddressText', o.delivery_address_text,
          'deliveryComment', o.delivery_comment,
          'bouquetPhotoUrl', o.bouquet_photo_url,
          'trackingToken', o.tracking_token,
          'trackingUrl', CASE
            WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
            ELSE '/order/track/' || o.tracking_token
          END
        ),
        NOW(),
        NOW()
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${updated.id}
        AND o.shop_id = ${profile.shop_id}
        AND o.customer_id IS NOT NULL
    `;

    return updated;
  });

  if (!readyResult) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ уже изменён. Обновите список."
    );
    return;
  }

  await answerCallbackQuery(callbackQuery.id, "Заказ готов");

  await sendTelegramMessage(
    chatId,
    [
      `✅ Заказ ${order.order_number} готов`,
      "",
      "Статус в CRM изменён на «Готов».",
      "Следующий шаг — передача курьеру."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleCustomerBouquetApprove(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.customer_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Сначала привяжите Telegram к личному кабинету"
    );
    return;
  }

  const result = await sql.begin(async (transaction) => {
    const rows = await transaction<{
      id: string;
      order_number: string;
      status: string;
      customer_id: string | null;
      bouquet_photo_url: string | null;
      approval_status: string | null;
    }[]>`
      SELECT
        id,
        order_number,
        status::text AS status,
        customer_id,
        bouquet_photo_url,
        metadata #>> '{bouquetApproval,status}' AS approval_status
      FROM orders
      WHERE id = ${orderId}
        AND shop_id = ${profile.shop_id}
      FOR UPDATE
    `;

    const order = rows[0];

    if (!order || order.customer_id !== profile.customer_id) {
      return { kind: "not_found" as const, orderNumber: "" };
    }

    if (order.approval_status === "approved") {
      return { kind: "already" as const, orderNumber: order.order_number };
    }

    if (
      order.status !== "assembling"
      || !order.bouquet_photo_url
      || order.approval_status === "revision_requested"
    ) {
      return { kind: "unavailable" as const, orderNumber: order.order_number };
    }

    await transaction`
      UPDATE orders
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{bouquetApproval}',
            COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
              || jsonb_build_object(
                'status', 'approved',
                'decidedAt', NOW(),
                'note', NULL,
                'source', 'customer_telegram'
              ),
            true
          ),
          updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id = ${profile.shop_id}
    `;

    await transaction`
      INSERT INTO order_status_history (
        shop_id,
        order_id,
        from_status,
        to_status,
        comment,
        created_at
      )
      VALUES (
        ${profile.shop_id},
        ${order.id},
        'assembling',
        'assembling',
        'Покупатель одобрил фото готового букета в Telegram',
        NOW()
      )
    `;

    return { kind: "approved" as const, orderNumber: order.order_number };
  });

  if (result.kind === "not_found") {
    await answerCallbackQuery(callbackQuery.id, "Заказ не найден");
    return;
  }

  if (result.kind === "unavailable") {
    await answerCallbackQuery(callbackQuery.id, "Согласование уже недоступно");
    return;
  }

  if (result.kind === "approved") {
    await queueBouquetApprovalStaffNotification({
      shopId: profile.shop_id,
      orderId,
      type: "bouquet_approved"
    });
  }

  pendingCustomerBouquetRevisionRequests.delete(chatId);

  await answerCallbackQuery(
    callbackQuery.id,
    result.kind === "already" ? "Фото уже одобрено" : "Спасибо, фото одобрено"
  );

  await sendTelegramMessage(
    chatId,
    [
      `✅ Фото букета по заказу ${result.orderNumber} одобрено`,
      "",
      "Флорист получил подтверждение и завершит подготовку заказа."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleCustomerBouquetRevisionRequest(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.customer_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Сначала привяжите Telegram к личному кабинету"
    );
    return;
  }

  const rows = await sql<{
    id: string;
    order_number: string;
    status: string;
    customer_id: string | null;
    bouquet_photo_url: string | null;
    approval_status: string | null;
  }[]>`
    SELECT
      id,
      order_number,
      status::text AS status,
      customer_id,
      bouquet_photo_url,
      metadata #>> '{bouquetApproval,status}' AS approval_status
    FROM orders
    WHERE id = ${orderId}
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const order = rows[0];

  if (!order || order.customer_id !== profile.customer_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ не найден");
    return;
  }

  if (
    order.status !== "assembling"
    || !order.bouquet_photo_url
    || order.approval_status === "approved"
    || order.approval_status === "waived"
  ) {
    await answerCallbackQuery(callbackQuery.id, "Согласование уже завершено");
    return;
  }

  pendingCustomerBouquetRevisionRequests.set(chatId, {
    orderId: order.id,
    orderNumber: order.order_number,
    shopId: profile.shop_id,
    customerId: profile.customer_id,
    createdAt: Date.now()
  });

  await answerCallbackQuery(callbackQuery.id, "Напишите, что нужно изменить");

  await sendTelegramMessage(
    chatId,
    [
      `🔄 Правка по заказу ${order.order_number}`,
      "",
      "Напишите одним сообщением, что именно нужно изменить в букете.",
      "Например: «Сделать упаковку светлее и добавить больше белых цветов».",
      "",
      "Для отмены отправьте /cancel.",
      "Запрос действует 15 минут."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleCustomerBouquetRevisionReasonMessage(
  message: TelegramMessage,
  text: string
): Promise<boolean> {
  const chatId = message.chat.id;
  const request = pendingCustomerBouquetRevisionRequests.get(chatId);

  if (!request) {
    return false;
  }

  if (Date.now() - request.createdAt > 15 * 60 * 1000) {
    pendingCustomerBouquetRevisionRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Время ожидания ответа истекло. Откройте заказ и нажмите «Нужна правка» ещё раз.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  if (text === "/cancel") {
    pendingCustomerBouquetRevisionRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      "Запрос на правку отменён. Фото по-прежнему ожидает вашего решения.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  const navigationTexts = new Set([
    "👤 Профиль",
    "🛍 Каталог",
    "📦 Мои заказы",
    "🎁 Бонусы",
    "☎️ Связь",
    "🧺 Корзина",
    "🔔 Уведомления"
  ]);

  if (
    text.startsWith("/start")
    || text === "/menu"
    || navigationTexts.has(text)
  ) {
    pendingCustomerBouquetRevisionRequests.delete(chatId);
    return false;
  }

  const note = text.trim();

  if (note.length < 3 || note.length > 500) {
    await sendTelegramMessage(
      chatId,
      "Опишите правку текстом от 3 до 500 символов.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  const profile = await getTelegramProfile(String(chatId));

  if (
    !profile?.customer_id
    || profile.customer_id !== request.customerId
    || profile.shop_id !== request.shopId
  ) {
    pendingCustomerBouquetRevisionRequests.delete(chatId);
    await sendTelegramMessage(chatId, "Не удалось подтвердить покупателя.");
    return true;
  }

  const result = await sql.begin(async (transaction) => {
    const rows = await transaction<{
      id: string;
      order_number: string;
      status: string;
      customer_id: string | null;
      bouquet_photo_url: string | null;
      approval_status: string | null;
    }[]>`
      SELECT
        id,
        order_number,
        status::text AS status,
        customer_id,
        bouquet_photo_url,
        metadata #>> '{bouquetApproval,status}' AS approval_status
      FROM orders
      WHERE id = ${request.orderId}
        AND shop_id = ${request.shopId}
      FOR UPDATE
    `;

    const order = rows[0];

    if (
      !order
      || order.customer_id !== request.customerId
      || order.status !== "assembling"
      || !order.bouquet_photo_url
      || order.approval_status === "approved"
      || order.approval_status === "waived"
    ) {
      return null;
    }

    await transaction`
      UPDATE orders
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{bouquetApproval}',
            COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
              || jsonb_build_object(
                'status', 'revision_requested',
                'decidedAt', NOW(),
                'note', ${note},
                'source', 'customer_telegram',
                'revisionCount', COALESCE(
                  NULLIF(metadata #>> '{bouquetApproval,revisionCount}', '')::int,
                  0
                ) + 1
              ),
            true
          ),
          updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id = ${request.shopId}
    `;

    await transaction`
      INSERT INTO order_status_history (
        shop_id,
        order_id,
        from_status,
        to_status,
        comment,
        created_at
      )
      VALUES (
        ${request.shopId},
        ${order.id},
        'assembling',
        'assembling',
        ${`Покупатель запросил правку букета: ${note}`},
        NOW()
      )
    `;

    return order;
  });

  pendingCustomerBouquetRevisionRequests.delete(chatId);

  if (!result) {
    await sendTelegramMessage(
      chatId,
      "Не удалось сохранить правку: согласование уже завершено или заказ изменился.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  await queueBouquetApprovalStaffNotification({
    shopId: request.shopId,
    orderId: request.orderId,
    type: "bouquet_revision_requested",
    note
  });

  await sendTelegramMessage(
    chatId,
    [
      `🔄 Правка по заказу ${request.orderNumber} отправлена`,
      "",
      `Ваш комментарий: ${note}`,
      "",
      "Флорист подготовит обновлённый вариант и пришлёт новое фото."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );

  return true;
}

/* ЕДИНАЯ КАРТОЧКА КУРЬЕРА 6.6.2 */
type CourierOrderCard = {
  id: string;
  order_number: string;
  status: string;
  courier_id: string | null;
  delivery_date: string | null;
  delivery_interval_name: string | null;
  delivery_address_text: string | null;
  delivery_comment: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  delivery_price: number;
  delivery_is_express: boolean;
  delivery_tariff_name: string | null;
  delivery_zone_name: string | null;
  courier_name: string | null;
  delivery_proof_photo_url: string | null;
  delivery_proof_uploaded_at: string | null;
  created_at: string;
};

async function loadCourierOrderCard(
  shopId: string,
  orderId: string
): Promise<CourierOrderCard | null> {
  const rows =
    await sql<CourierOrderCard[]>`
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.courier_id,
        o.delivery_date,
        di.name
          AS delivery_interval_name,
        o.delivery_address_text,
        o.delivery_comment,
        o.recipient_name,
        o.recipient_phone,
        o.delivery_price,

        CASE
          WHEN LOWER(
            COALESCE(
              o.metadata
                -> 'delivery'
                ->> 'isExpress',
              'false'
            )
          ) = 'true'
            THEN true
          ELSE false
        END AS delivery_is_express,

        COALESCE(
          NULLIF(
            o.metadata
              -> 'delivery'
              ->> 'tariffName',
            ''
          ),
          CASE
            WHEN LOWER(
              COALESCE(
                o.metadata
                  -> 'delivery'
                  ->> 'isExpress',
                'false'
              )
            ) = 'true'
              THEN 'Срочная доставка'
            ELSE 'Обычная доставка'
          END
        ) AS delivery_tariff_name,

        COALESCE(
          NULLIF(
            o.metadata
              -> 'delivery'
              ->> 'zoneName',
            ''
          ),
          dz.name
        ) AS delivery_zone_name,

        courier.name
          AS courier_name,

        o.metadata #>>
          '{delivery,proofPhotoUrl}'
          AS delivery_proof_photo_url,

        o.metadata #>>
          '{delivery,proofUploadedAt}'
          AS delivery_proof_uploaded_at,

        o.created_at

      FROM orders o

      LEFT JOIN delivery_intervals di
        ON di.id =
          o.delivery_interval_id
       AND di.shop_id =
          o.shop_id

      LEFT JOIN delivery_zones dz
        ON dz.id =
          o.delivery_zone_id
       AND dz.shop_id =
          o.shop_id

      LEFT JOIN users courier
        ON courier.id =
          o.courier_id

      WHERE o.shop_id = ${shopId}
        AND o.id = ${orderId}
      LIMIT 1
    `;

  return rows[0] ?? null;
}

function courierWhatsappDigits(
  value: string | null
) {
  let digits =
    String(value || "")
      .replace(/\D/g, "");

  if (
    digits.length === 11
    && digits.startsWith("8")
  ) {
    digits =
      "7" + digits.slice(1);
  }

  return digits.length >= 10
    ? digits
    : "";
}

function courierOrderButtonRows(
  order: CourierOrderCard
): TelegramInlineKeyboardButton[][] {
  const rows:
    TelegramInlineKeyboardButton[][] =
    [];

  if (order.status === "ready") {
    rows.push([
      {
        text: "🚚 Принять доставку",
        callback_data:
          `courier:accept:${order.id}`
      }
    ]);
  }

  if (
    order.status
    === "assigned_courier"
  ) {
    rows.push([
      {
        text: "🚗 Выехал",
        callback_data:
          `courier:start:${order.id}`
      }
    ]);
  }

  if (
    order.status
    === "delivering"
  ) {
    rows.push([
      {
        text: "📸 Завершить с фото",
        callback_data:
          `courier:proof:${order.id}`
      }
    ]);
  }

  if (
    order.status === "assigned_courier"
    || order.status === "delivering"
  ) {
    rows.push([
      {
        text: "⚠️ Проблема доставки",
        callback_data:
          `courier:problem:${order.id}`
      }
    ]);
  }

  const address =
    String(
      order.delivery_address_text
      || ""
    ).trim();

  if (address) {
    const encodedAddress =
      encodeURIComponent(address);

    rows.push([
      {
        text: "🗺 Яндекс",
        url:
          `https://yandex.ru/maps/?text=${encodedAddress}`
      },
      {
        text: "📍 Google",
        url:
          "https://www.google.com/maps/"
          + "search/?api=1&query="
          + encodedAddress
      }
    ]);
  }

  const whatsappDigits =
    courierWhatsappDigits(
      order.recipient_phone
    );

  if (whatsappDigits) {
    rows.push([
      {
        text: "💬 WhatsApp",
        url:
          `https://wa.me/${whatsappDigits}`
      }
    ]);
  }

  rows.push([
    {
      text: "🔄 Обновить доставки",
      callback_data: "courier:list"
    }
  ]);

  return rows;
}

function courierOrderCardText(
  order: CourierOrderCard,
  showCourierName = false
) {
  const statusLabels:
    Record<string, string> = {
      ready:
        "Ожидает принятия",
      assigned_courier:
        "Принят курьером",
      delivering:
        "Курьер в пути",
      delivered:
        "Доставлен"
    };

  const isExpress =
    order.delivery_is_express;

  const interval =
    String(
      order.delivery_interval_name
      || ""
    ).trim();

  const comment =
    String(
      order.delivery_comment
      || ""
    ).trim();

  const visibleComment =
    comment
    && comment !== interval
      ? comment
      : "";

  return [
    isExpress
      ? `🔴 СРОЧНО · ${order.order_number}`
      : `📦 ${order.order_number}`,

    "",

    `Статус: ${
      statusLabels[order.status]
      || order.status
    }`,

    `Тариф: ${
      order.delivery_tariff_name
      || (
        isExpress
          ? "Срочная доставка"
          : "Обычная доставка"
      )
    }`,

    `Стоимость доставки: ${
      Number(
        order.delivery_price || 0
      ) > 0
        ? money(
            order.delivery_price
          )
        : "Бесплатно"
    }`,

    order.delivery_zone_name
      ? `Зона: ${
          order.delivery_zone_name
        }`
      : "",

    `Дата: ${
      order.delivery_date
        ? shortDateText(
            order.delivery_date
          )
        : "не указана"
    }`,

    interval
      ? `Интервал: ${interval}`
      : "",

    order.recipient_name
      ? `Получатель: ${
          order.recipient_name
        }`
      : "",

    order.recipient_phone
      ? `Телефон: ${
          order.recipient_phone
        }`
      : "",

    order.delivery_address_text
      ? `Адрес: ${
          order.delivery_address_text
        }`
      : "Адрес: не указан",

    visibleComment
      ? `Комментарий: ${
          visibleComment
        }`
      : "",

    order.delivery_proof_photo_url
      ? "Фото вручения: загружено"
      : "",

    showCourierName
    && order.courier_name
      ? `Курьер: ${
          order.courier_name
        }`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendCourierOrderCard(
  chatId: number,
  order: CourierOrderCard,
  showCourierName = false
) {
  await sendTelegramMessage(
    chatId,
    courierOrderCardText(
      order,
      showCourierName
    ),
    {
      reply_markup:
        inlineKeyboard(
          courierOrderButtonRows(order)
        )
    }
  );
}

/* КУРЬЕРСКИЙ РАБОЧИЙ ЭКРАН 6.6.1 */
async function handleCourierDeliveryOrders(
  chatId: number
) {
  const replyMarkup =
    await mainKeyboardForChat(chatId);

  const profile =
    await getTelegramProfile(
      String(chatId)
    );

  if (!profile?.user_id) {
    await sendTelegramMessage(
      chatId,
      "🚚 Раздел доставки доступен только сотруднику.",
      {
        reply_markup: replyMarkup
      }
    );

    return;
  }

  if (
    ![
      "owner",
      "admin",
      "courier"
    ].includes(
      profile.role || ""
    )
  ) {
    await sendTelegramMessage(
      chatId,
      "🚚 Раздел доставки доступен только курьеру.",
      {
        reply_markup: replyMarkup
      }
    );

    return;
  }

  const canSeeAllDeliveries =
    [
      "owner",
      "admin"
    ].includes(
      profile.role || ""
    );

  const rows = await sql<{
    id: string;
    status: string;
    delivery_is_express: boolean;
  }[]>`
    SELECT
      o.id,
      o.status,

      CASE
        WHEN LOWER(
          COALESCE(
            o.metadata
              -> 'delivery'
              ->> 'isExpress',
            'false'
          )
        ) = 'true'
          THEN true
        ELSE false
      END AS delivery_is_express

    FROM orders o

    WHERE o.shop_id =
        ${profile.shop_id}

      AND o.delivery_type =
        'delivery'

      AND o.courier_id
        IS NOT NULL

      AND (
        ${canSeeAllDeliveries}::boolean
        = true

        OR o.courier_id =
          ${profile.user_id}
      )

      AND o.status IN (
        'ready',
        'assigned_courier',
        'delivering'
      )

    ORDER BY
      CASE
        WHEN LOWER(
          COALESCE(
            o.metadata
              -> 'delivery'
              ->> 'isExpress',
            'false'
          )
        ) = 'true'
          THEN 0
        ELSE 1
      END,

      CASE o.status
        WHEN 'delivering'
          THEN 0
        WHEN 'assigned_courier'
          THEN 1
        WHEN 'ready'
          THEN 2
        ELSE 10
      END,

      COALESCE(
        o.delivery_date,
        o.created_at
      ),

      o.created_at

    LIMIT 20
  `;

  if (rows.length === 0) {
    await sendTelegramMessage(
      chatId,
      [
        "🚚 Активные доставки",
        "",
        "Назначенных доставок сейчас нет.",
        "",
        "Новые заказы появятся здесь после назначения курьера."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );

    return;
  }

  const expressCount =
    rows.filter(
      row =>
        row.delivery_is_express
    ).length;

  const deliveringCount =
    rows.filter(
      row =>
        row.status === "delivering"
    ).length;

  await sendTelegramMessage(
    chatId,
    [
      "🚚 Активные доставки",
      "",
      `Всего: ${rows.length}`,
      `🔴 Срочных: ${expressCount}`,
      `🚗 В пути: ${deliveringCount}`,
      "",
      canSeeAllDeliveries
        ? "Показаны доставки всех курьеров."
        : "Сначала показаны срочные и текущие доставки."
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );

  for (const row of rows) {
    const order =
      await loadCourierOrderCard(
        profile.shop_id,
        row.id
      );

    if (!order) {
      continue;
    }

    await sendCourierOrderCard(
      chatId,
      order,
      canSeeAllDeliveries
    );
  }
}

async function handleCourierStartDelivery(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message =
    callbackQuery.message;

  if (
    !message
    || message.chat.type !== "private"
  ) {
    await answerCallbackQuery(
      callbackQuery.id
    );

    return;
  }

  const chatId =
    message.chat.id;

  const profile =
    await getTelegramProfile(
      String(chatId)
    );

  if (!profile?.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доступно только сотруднику"
    );

    return;
  }

  const order =
    await loadCourierOrderCard(
      profile.shop_id,
      orderId
    );

  if (!order) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ не найден"
    );

    return;
  }

  if (
    order.courier_id
    !== profile.user_id
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ назначен другому курьеру"
    );

    return;
  }

  if (
    order.status === "delivering"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Вы уже в пути"
    );

    await sendCourierOrderCard(
      chatId,
      order
    );

    return;
  }

  if (
    order.status
    !== "assigned_courier"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Сначала примите доставку"
    );

    return;
  }

  const updated =
    await sql<{ id: string }[]>`
      UPDATE orders
      SET
        status = 'delivering',
        updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id =
          ${profile.shop_id}
        AND courier_id =
          ${profile.user_id}
        AND status =
          'assigned_courier'
      RETURNING id
    `;

  if (!updated[0]) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Статус уже изменился"
    );

    return;
  }

  await sql`
    INSERT INTO order_status_history (
      shop_id,
      order_id,
      from_status,
      to_status,
      changed_by_user_id,
      comment,
      created_at
    )
    VALUES (
      ${profile.shop_id},
      ${order.id},
      'assigned_courier',
      'delivering',
      ${profile.user_id},
      'Курьер выехал на доставку через Telegram',
      NOW()
    )
  `;

  await queueCustomerOrderNotification({
    shopId:
      profile.shop_id,
    orderId:
      order.id,
    type:
      "order_delivering",
    status:
      "delivering"
  });

  await answerCallbackQuery(
    callbackQuery.id,
    "Статус: в доставке"
  );

  const nextOrder =
    await loadCourierOrderCard(
      profile.shop_id,
      order.id
    );

  if (nextOrder) {
    await sendCourierOrderCard(
      chatId,
      nextOrder
    );
  }
}

async function handleCourierProblemOrder(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доступно только сотруднику"
    );
    return;
  }

  const order = await loadCourierOrderCard(
    profile.shop_id,
    orderId
  );

  if (!order) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ не найден"
    );
    return;
  }

  if (order.courier_id !== profile.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ назначен другому курьеру"
    );
    return;
  }

  if (order.status === "problem") {
    await answerCallbackQuery(
      callbackQuery.id,
      "Проблема уже отмечена"
    );
    return;
  }

  if (
    order.status !== "assigned_courier"
    && order.status !== "delivering"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Проблему можно отметить только по принятой доставке"
    );
    return;
  }

  pendingCourierDeliveryPhotoRequests.delete(chatId);
  pendingCourierProblemRequests.set(chatId, {
    orderId: order.id,
    orderNumber: order.order_number,
    shopId: profile.shop_id,
    userId: profile.user_id,
    createdAt: Date.now()
  });

  await answerCallbackQuery(
    callbackQuery.id,
    "Опишите проблему"
  );

  await sendTelegramMessage(
    chatId,
    [
      `⚠️ Проблема доставки ${order.order_number}`,
      "",
      "Одним сообщением опишите, что произошло и какая помощь нужна от менеджера.",
      "",
      "Например:",
      "• получатель не отвечает;",
      "• неверный адрес;",
      "• получатель отказался принять заказ;",
      "• невозможно попасть в подъезд.",
      "",
      "Для отмены отправьте /cancel.",
      "Запрос действует 15 минут."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleCourierProblemReasonMessage(
  message: TelegramMessage,
  text: string
): Promise<boolean> {
  const chatId = message.chat.id;
  const request = pendingCourierProblemRequests.get(chatId);

  if (!request) {
    return false;
  }

  const navigationTexts = new Set([
    "👤 Профиль",
    "🛍 Каталог",
    "📦 Мои заказы",
    "📦 Заказы",
    "🎁 Бонусы",
    "☎️ Связь",
    "🧺 Корзина",
    "🧾 CRM",
    "⚙️ Настройки",
    "💐 Сборка заказов",
    "🚚 Доставка",
    "🔔 Уведомления"
  ]);

  if (
    text.startsWith("/start")
    || text === "/menu"
    || navigationTexts.has(text)
  ) {
    pendingCourierProblemRequests.delete(chatId);
    return false;
  }

  if (text === "/cancel") {
    pendingCourierProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `Отметка проблемы по заказу ${request.orderNumber} отменена.`,
        "",
        "Статус заказа не изменялся."
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  if (Date.now() - request.createdAt > 15 * 60 * 1000) {
    pendingCourierProblemRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `Время ввода причины по заказу ${request.orderNumber} истекло.`,
        "",
        "Откройте доставку и нажмите «⚠️ Проблема доставки» ещё раз."
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );

    return true;
  }

  const reason = text.trim();

  if (reason.length < 3) {
    await sendTelegramMessage(
      chatId,
      "Опишите проблему подробнее — минимум 3 символа."
    );
    return true;
  }

  if (reason.length > 1000) {
    await sendTelegramMessage(
      chatId,
      "Описание слишком длинное. Сократите его до 1000 символов."
    );
    return true;
  }

  const profile = await getTelegramProfile(String(chatId));

  if (
    !profile?.user_id
    || profile.shop_id !== request.shopId
    || profile.user_id !== request.userId
  ) {
    pendingCourierProblemRequests.delete(chatId);
    await sendTelegramMessage(
      chatId,
      "Не удалось подтвердить профиль курьера. Откройте раздел доставки повторно."
    );
    return true;
  }

  const result = await sql.begin(async (transaction) => {
    const rows = await transaction<{
      id: string;
      order_number: string;
      status: string;
      courier_id: string | null;
      manager_id: string | null;
    }[]>`
      SELECT
        id,
        order_number,
        status::text AS status,
        courier_id,
        manager_id
      FROM orders
      WHERE id = ${request.orderId}
        AND shop_id = ${request.shopId}
      LIMIT 1
      FOR UPDATE
    `;

    const order = rows[0];

    if (!order) {
      return {
        ok: false as const,
        message: "Заказ больше не найден."
      };
    }

    if (order.courier_id !== request.userId) {
      return {
        ok: false as const,
        message: "Заказ больше не назначен вам."
      };
    }

    if (order.status === "problem") {
      return {
        ok: false as const,
        message: "По этому заказу проблема уже отмечена."
      };
    }

    if (
      order.status !== "assigned_courier"
      && order.status !== "delivering"
    ) {
      return {
        ok: false as const,
        message: "Статус заказа уже изменился. Обновите список доставок."
      };
    }

    const updated = await transaction<{ id: string }[]>`
      UPDATE orders
      SET
        status = 'problem',
        updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id = ${request.shopId}
        AND courier_id = ${request.userId}
        AND status = ${order.status}::order_status
      RETURNING id
    `;

    if (!updated[0]) {
      return {
        ok: false as const,
        message: "Статус заказа уже изменился."
      };
    }

    await transaction`
      INSERT INTO order_status_history (
        shop_id,
        order_id,
        from_status,
        to_status,
        changed_by_user_id,
        comment,
        created_at
      )
      VALUES (
        ${request.shopId},
        ${order.id},
        ${order.status}::order_status,
        'problem',
        ${request.userId},
        ${`Проблема доставки от курьера через Telegram: ${reason}`},
        NOW()
      )
    `;

    return {
      ok: true as const,
      orderId: order.id,
      orderNumber: order.order_number,
      managerId: order.manager_id
    };
  });

  pendingCourierProblemRequests.delete(chatId);

  if (!result.ok) {
    await sendTelegramMessage(
      chatId,
      result.message,
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );
    return true;
  }

  try {
    await queueCustomerOrderNotification({
      shopId: request.shopId,
      orderId: result.orderId,
      type: "order_problem",
      status: "problem"
    });
  } catch (error) {
    console.error(
      `[bot-worker] customer courier-problem notification failed order=${result.orderId}`,
      error instanceof Error ? error.message : error
    );
  }

  type StaffRecipient = {
    telegram_id: string;
  };

  let recipients: StaffRecipient[] = [];
  let recipientLabel = "менеджеру";

  if (result.managerId) {
    recipients = await sql<StaffRecipient[]>`
      SELECT DISTINCT ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${request.shopId}
        AND ta.user_id = ${result.managerId}
        AND ta.is_active = true
        AND ta.notifications_enabled = true
    `;
  }

  if (recipients.length === 0) {
    recipientLabel = "владельцу или администратору";

    recipients = await sql<StaffRecipient[]>`
      SELECT DISTINCT ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${request.shopId}
        AND su.role IN ('owner', 'admin')
        AND ta.is_active = true
        AND ta.notifications_enabled = true
      ORDER BY ta.telegram_id
    `;
  }

  const crmUrl = `${SITE_URL}/admin/orders/${result.orderId}`;
  let notifiedCount = 0;

  for (const recipient of recipients) {
    try {
      await sendTelegramMessage(
        recipient.telegram_id,
        [
          `⚠️ Проблема доставки ${result.orderNumber}`,
          "",
          "Курьер сообщил:",
          reason,
          "",
          "Статус заказа изменён на «Проблема»."
        ].join("\n"),
        {
          reply_markup: inlineKeyboard([
            [
              {
                text: "Открыть заказ в CRM",
                url: crmUrl
              }
            ]
          ])
        }
      );
      notifiedCount += 1;
    } catch (error) {
      console.error(
        `[bot-worker] courier problem notification failed order=${result.orderId} recipient=${recipient.telegram_id}`,
        error instanceof Error ? error.message : error
      );
    }
  }

  await sendTelegramMessage(
    chatId,
    [
      `✅ Проблема по заказу ${result.orderNumber} сохранена`,
      "",
      `Причина: ${reason}`,
      "",
      "Статус изменён на «Проблема».",
      notifiedCount > 0
        ? `Уведомление отправлено ${recipientLabel}.`
        : "Получатель уведомления не найден. Причина сохранена в истории заказа."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "🔄 Обновить доставки",
            callback_data: "courier:list"
          }
        ]
      ])
    }
  );

  return true;
}

async function handleCourierDeliveryPhotoRequest(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message =
    callbackQuery.message;

  if (
    !message
    || message.chat.type !== "private"
  ) {
    await answerCallbackQuery(
      callbackQuery.id
    );

    return;
  }

  const chatId =
    message.chat.id;

  const profile =
    await getTelegramProfile(
      String(chatId)
    );

  if (!profile?.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доступно только сотруднику"
    );

    return;
  }

  const order =
    await loadCourierOrderCard(
      profile.shop_id,
      orderId
    );

  if (!order) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ не найден"
    );

    return;
  }

  if (
    order.courier_id
    !== profile.user_id
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ назначен другому курьеру"
    );

    return;
  }

  if (order.status === "delivered") {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ уже доставлен"
    );

    return;
  }

  if (
    order.status !== "delivering"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Сначала отметьте выезд"
    );

    return;
  }

  pendingCourierProblemRequests.delete(
    chatId
  );

  pendingCourierDeliveryPhotoRequests.set(
    chatId,
    {
      orderId: order.id,
      orderNumber:
        order.order_number,
      shopId:
        profile.shop_id,
      userId:
        profile.user_id,
      createdAt:
        Date.now()
    }
  );

  await answerCallbackQuery(
    callbackQuery.id,
    "Отправьте фото вручения"
  );

  await sendTelegramMessage(
    chatId,
    [
      `📸 Подтверждение доставки ${order.order_number}`,
      "",
      "Отправьте одним сообщением фотографию букета после вручения или у двери получателя.",
      "",
      "Важно:",
      "• лицо получателя фотографируйте только с его согласия;",
      "• на снимке должен быть виден доставленный букет;",
      "• после сохранения фото заказ автоматически станет «Доставлен».",
      "",
      "Для отмены отправьте /cancel.",
      "Запрос действует 15 минут."
    ].join("\n"),
    {
      reply_markup:
        await mainKeyboardForChat(
          chatId
        )
    }
  );
}

async function removeUploadedFile(
  publicUrl: string
) {
  const relativePath =
    publicUrl.replace(
      /^\/uploads\//,
      ""
    );

  if (
    !relativePath
    || relativePath.includes("..")
  ) {
    return;
  }

  try {
    await unlink(
      join(
        UPLOADS_DIR,
        relativePath
      )
    );
  } catch {
    // Файл мог уже отсутствовать. Это не должно ломать рабочий сценарий.
  }
}

async function handleCourierDeliveryPhotoMessage(
  message: TelegramMessage
): Promise<boolean> {
  const chatId = message.chat.id;
  const request =
    pendingCourierDeliveryPhotoRequests.get(
      chatId
    );

  if (!request) {
    return false;
  }

  if (
    Date.now() - request.createdAt
    > 15 * 60 * 1000
  ) {
    pendingCourierDeliveryPhotoRequests.delete(
      chatId
    );

    await sendTelegramMessage(
      chatId,
      [
        `Время ожидания фото по заказу ${request.orderNumber} истекло.`,
        "",
        "Откройте раздел «🚚 Доставка» и нажмите «📸 Завершить с фото» ещё раз."
      ].join("\n"),
      {
        reply_markup:
          await mainKeyboardForChat(
            chatId
          )
      }
    );

    return true;
  }

  const photos = message.photo || [];

  if (!photos.length) {
    return false;
  }

  const profile =
    await getTelegramProfile(
      String(chatId)
    );

  if (
    !profile?.user_id
    || profile.user_id
      !== request.userId
    || profile.shop_id
      !== request.shopId
  ) {
    pendingCourierDeliveryPhotoRequests.delete(
      chatId
    );

    await sendTelegramMessage(
      chatId,
      "Не удалось подтвердить курьера для завершения доставки."
    );

    return true;
  }

  const photo =
    pickLargestTelegramPhoto(
      photos
    );

  if (!photo) {
    await sendTelegramMessage(
      chatId,
      "Не удалось получить фотографию. Отправьте изображение ещё раз."
    );

    return true;
  }

  if (
    photo.file_size
    && photo.file_size
      > MAX_DELIVERY_PHOTO_BYTES
  ) {
    await sendTelegramMessage(
      chatId,
      "Фотография слишком большая. Отправьте обычное фото размером до 12 МБ."
    );

    return true;
  }

  let publicUrl = "";

  try {
    publicUrl =
      await downloadTelegramFile(
        photo.file_id,
        `delivery-${request.orderId}`,
        "deliveries"
      );

    const proofUploadedAt =
      new Date().toISOString();

    const result = await sql.begin(
      async (transaction) => {
        const orderRows =
          await transaction<{
            id: string;
            order_number: string;
            status: string;
            courier_id: string | null;
          }[]>`
            SELECT
              id,
              order_number,
              status::text AS status,
              courier_id
            FROM orders
            WHERE id = ${request.orderId}
              AND shop_id = ${request.shopId}
            LIMIT 1
            FOR UPDATE
          `;

        const order = orderRows[0];

        if (!order) {
          return {
            ok: false as const,
            message:
              "Заказ больше не найден."
          };
        }

        if (
          order.courier_id
          !== request.userId
        ) {
          return {
            ok: false as const,
            message:
              "Заказ больше не назначен вам."
          };
        }

        if (
          order.status === "delivered"
        ) {
          return {
            ok: false as const,
            message:
              "Заказ уже отмечен доставленным."
          };
        }

        if (
          order.status !== "delivering"
        ) {
          return {
            ok: false as const,
            message:
              "Статус заказа изменился. Обновите список доставок."
          };
        }

        const proofPatch = {
          proofPhotoUrl: publicUrl,
          proofUploadedAt,
          proofCourierUserId:
            request.userId,
          proofSource: "telegram",
          proofPrivacyNote:
            "Получатель не должен попадать в кадр без согласия"
        };

        const updatedRows =
          await transaction<{
            id: string;
            order_number: string;
          }[]>`
            UPDATE orders
            SET
              status = 'delivered',
              delivered_at = NOW(),
              metadata =
                jsonb_set(
                  COALESCE(
                    metadata,
                    '{}'::jsonb
                  ),
                  '{delivery}',
                  COALESCE(
                    metadata -> 'delivery',
                    '{}'::jsonb
                  )
                  || CAST(
                    ${JSON.stringify(proofPatch)}
                    AS jsonb
                  ),
                  true
                ),
              updated_at = NOW()
            WHERE id = ${order.id}
              AND shop_id = ${request.shopId}
              AND courier_id = ${request.userId}
              AND status = 'delivering'
            RETURNING
              id,
              order_number
          `;

        const updatedOrder =
          updatedRows[0];

        if (!updatedOrder) {
          return {
            ok: false as const,
            message:
              "Статус заказа уже изменился."
          };
        }

        await transaction`
          INSERT INTO order_status_history (
            shop_id,
            order_id,
            from_status,
            to_status,
            changed_by_user_id,
            comment,
            created_at
          )
          VALUES (
            ${request.shopId},
            ${order.id},
            'delivering',
            'delivered',
            ${request.userId},
            'Курьер загрузил фото вручения и завершил доставку через Telegram',
            NOW()
          )
        `;

        return {
          ok: true as const,
          orderId:
            updatedOrder.id,
          orderNumber:
            updatedOrder.order_number
        };
      }
    );

    if (!result.ok) {
      await removeUploadedFile(
        publicUrl
      );

      pendingCourierDeliveryPhotoRequests.delete(
        chatId
      );

      await sendTelegramMessage(
        chatId,
        result.message,
        {
          reply_markup:
            await mainKeyboardForChat(
              chatId
            )
        }
      );

      return true;
    }

    pendingCourierDeliveryPhotoRequests.delete(
      chatId
    );

    try {
      await queueCustomerOrderNotification({
        shopId:
          request.shopId,
        orderId:
          result.orderId,
        type:
          "order_delivered",
        status:
          "delivered"
      });
    } catch (error) {
      console.error(
        `[bot-worker] customer delivery notification failed order=${result.orderId}`,
        error instanceof Error
          ? error.message
          : error
      );
    }

    await sendTelegramPhoto(
      chatId,
      absoluteUrl(publicUrl),
      [
        `✅ Заказ ${result.orderNumber} доставлен`,
        "",
        "Фото вручения сохранено в CRM и в истории заказа.",
        "Клиенту отправлено уведомление о доставке.",
        "Заказ удалён из активных доставок."
      ].join("\n"),
      {
        reply_markup:
          inlineKeyboard([
            [
              {
                text:
                  "🔄 Обновить доставки",
                callback_data:
                  "courier:list"
              }
            ]
          ])
      }
    );

    return true;
  } catch (error) {
    if (publicUrl) {
      await removeUploadedFile(
        publicUrl
      );
    }

    await sendTelegramMessage(
      chatId,
      error instanceof Error
        ? error.message
        : "Не удалось сохранить фото доставки. Попробуйте ещё раз.",
      {
        reply_markup:
          await mainKeyboardForChat(
            chatId
          )
      }
    );

    return true;
  }
}

async function handleCourierAcceptOrder(
  callbackQuery: TelegramCallbackQuery,
  orderId: string
) {
  const message =
    callbackQuery.message;

  if (
    !message
    || message.chat.type !== "private"
  ) {
    await answerCallbackQuery(
      callbackQuery.id
    );

    return;
  }

  const chatId =
    message.chat.id;

  const profile =
    await getTelegramProfile(
      String(chatId)
    );

  if (!profile?.user_id) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доступно только сотруднику"
    );

    return;
  }

  const order =
    await loadCourierOrderCard(
      profile.shop_id,
      orderId
    );

  if (!order) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ не найден"
    );

    return;
  }

  if (
    order.courier_id
    !== profile.user_id
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ назначен другому курьеру"
    );

    return;
  }

  if (
    order.status
    === "assigned_courier"
  ) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Доставка уже принята"
    );

    await sendCourierOrderCard(
      chatId,
      order
    );

    return;
  }

  if (order.status !== "ready") {
    await answerCallbackQuery(
      callbackQuery.id,
      "Заказ ещё не готов к доставке"
    );

    return;
  }

  const updated =
    await sql<{ id: string }[]>`
      UPDATE orders
      SET
        status =
          'assigned_courier',
        updated_at = NOW()
      WHERE id = ${order.id}
        AND shop_id =
          ${profile.shop_id}
        AND courier_id =
          ${profile.user_id}
        AND status =
          'ready'
      RETURNING id
    `;

  if (!updated[0]) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Статус уже изменился"
    );

    return;
  }

  await sql`
    INSERT INTO order_status_history (
      shop_id,
      order_id,
      from_status,
      to_status,
      changed_by_user_id,
      comment,
      created_at
    )
    VALUES (
      ${profile.shop_id},
      ${order.id},
      'ready',
      'assigned_courier',
      ${profile.user_id},
      'Курьер принял доставку через Telegram',
      NOW()
    )
  `;

  await answerCallbackQuery(
    callbackQuery.id,
    "Доставка принята"
  );

  const nextOrder =
    await loadCourierOrderCard(
      profile.shop_id,
      order.id
    );

  if (nextOrder) {
    await sendCourierOrderCard(
      chatId,
      nextOrder
    );
  }
}

async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery) {
  const data = callbackQuery.data || "";
  const message = callbackQuery.message;

  if (!message || message.chat.type !== "private") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;

  if (data === "msg:delete") {
    await answerCallbackQuery(callbackQuery.id);
    await deleteTelegramMessage(chatId, message.message_id);
    return;
  }

  if (data === "catalog") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCatalog(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cat:")) {
    const categoryId = data.slice("cat:".length);
    await answerCallbackQuery(callbackQuery.id);
    await handleCatalogCategory(chatId, categoryId, message.message_id);
    return;
  }

  if (data.startsWith("prod:")) {
    const productId = data.slice("prod:".length);
    await answerCallbackQuery(callbackQuery.id);
    await handleProductCard(chatId, productId);
    return;
  }

  if (data.startsWith("cart:add:")) {
    const productId = data.slice("cart:add:".length);
    const result = await addProductToTelegramCart(chatId, productId);
    await answerCallbackQuery(callbackQuery.id, result ? "Добавлено в корзину" : "Товар недоступен");
    await handleCart(chatId);
    return;
  }

  if (data.startsWith("cart:inc:")) {
    const productId = data.slice("cart:inc:".length);
    await addProductToTelegramCart(chatId, productId);
    await answerCallbackQuery(callbackQuery.id);
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cart:dec:")) {
    const productId = data.slice("cart:dec:".length);
    await decreaseProductInTelegramCart(chatId, productId);
    await answerCallbackQuery(callbackQuery.id);
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cart:remove:")) {
    const productId = data.slice("cart:remove:".length);
    await removeProductFromTelegramCart(chatId, productId);
    await answerCallbackQuery(callbackQuery.id, "Товар удалён");
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data === "cart:clear") {
    await clearTelegramCart(chatId);
    await answerCallbackQuery(callbackQuery.id, "Корзина очищена");
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data === "cart:noop") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data === "orders:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleOrders(chatId);
    return;
  }

  if (data === "notifications:on" || data === "notifications:off") {
    const enabled = data === "notifications:on";
    const updated = await setTelegramNotifications(chatId, enabled);
    await answerCallbackQuery(
      callbackQuery.id,
      updated ? (enabled ? "Уведомления включены" : "Уведомления выключены") : "Telegram не привязан"
    );
    await handleNotifications(chatId);
    return;
  }

  if (data.startsWith("bouquet:approve:")) {
    const orderId = data.slice("bouquet:approve:".length);
    await handleCustomerBouquetApprove(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("bouquet:revision:")) {
    const orderId = data.slice("bouquet:revision:".length);
    await handleCustomerBouquetRevisionRequest(callbackQuery, orderId);
    return;
  }

  if (
    data.startsWith("florist:") &&
    !data.startsWith("florist:problem:")
  ) {
    pendingFloristProblemRequests.delete(chatId);
  }

  if (data.startsWith("florist:take:")) {
    const orderId = data.slice("florist:take:".length);
    await handleFloristTakeOrder(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("florist:photo:")) {
    const orderId = data.slice("florist:photo:".length);
    await handleFloristPhotoRequest(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("florist:ready:")) {
    const orderId = data.slice("florist:ready:".length);
    await handleFloristReadyOrder(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("florist:problem:")) {
    const orderId = data.slice("florist:problem:".length);
    await handleFloristProblemOrder(callbackQuery, orderId);
    return;
  }

  if (data === "florist:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleFloristAssemblyOrders(chatId);
    return;
  }

  if (data.startsWith("courier:accept:")) {
    const orderId = data.slice("courier:accept:".length);
    await handleCourierAcceptOrder(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("courier:start:")) {
    const orderId = data.slice("courier:start:".length);
    await handleCourierStartDelivery(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("courier:problem:")) {
    const orderId = data.slice("courier:problem:".length);
    await handleCourierProblemOrder(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("courier:proof:")) {
    const orderId = data.slice("courier:proof:".length);
    await handleCourierDeliveryPhotoRequest(callbackQuery, orderId);
    return;
  }

  if (data.startsWith("courier:delivered:")) {
    const orderId = data.slice("courier:delivered:".length);
    await handleCourierDeliveryPhotoRequest(callbackQuery, orderId);
    return;
  }

  if (data === "courier:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCourierDeliveryOrders(chatId);
    return;
  }


  if (data === "checkout:start") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCheckoutStart(chatId);
    return;
  }

  if (data.startsWith("checkout:delivery:")) {
    const deliveryType = data.slice("checkout:delivery:".length);

    if (deliveryType === "delivery" || deliveryType === "pickup") {
      await handleCheckoutDeliveryType(callbackQuery, deliveryType);
      return;
    }
  }

  if (data.startsWith("checkout:zone:")) {
    const zoneId = data.slice("checkout:zone:".length);
    await handleCheckoutZone(callbackQuery, zoneId);
    return;
  }

  if (data.startsWith("checkout:interval:")) {
    const intervalId = data.slice("checkout:interval:".length);
    await handleCheckoutInterval(callbackQuery, intervalId);
    return;
  }

  if (data.startsWith("checkout:payment:")) {
    const paymentMethod = data.slice("checkout:payment:".length);

    if (
      paymentMethod === "cash_on_delivery"
      || paymentMethod === "transfer_after_confirm"
      || paymentMethod === "online_card"
      || paymentMethod === "sbp"
    ) {
      await handleCheckoutPayment(callbackQuery, paymentMethod);
      return;
    }
  }

  if (data === "checkout:privacy:accept") {
    await handleCheckoutPrivacyAccept(callbackQuery);
    return;
  }

  if (data === "checkout:restart") {
    await answerCallbackQuery(callbackQuery.id, "Начинаем заново");
    await clearCheckoutSession(chatId);
    await handleCheckoutStart(chatId);
    return;
  }

  if (data === "checkout:cart") {
    await answerCallbackQuery(callbackQuery.id);
    await clearCheckoutSession(chatId);
    await handleCart(chatId);
    return;
  }

  if (data === "checkout:confirm") {
    await answerCallbackQuery(callbackQuery.id, "Создаю заказ");
    await handleCheckoutConfirm(chatId);
    return;
  }

  if (data === "checkout:cancel") {
    await answerCallbackQuery(callbackQuery.id, "Оформление отменено");
    await handleCheckoutCancel(chatId);
    return;
  }

  await answerCallbackQuery(callbackQuery.id, "Раздел пока недоступен");
}

async function setTelegramNotifications(chatId: number, enabled: boolean) {
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id && !profile?.customer_id) {
    return false;
  }

  const rows = await sql<{ id: string }[]>`
    UPDATE telegram_accounts
    SET notifications_enabled = ${enabled},
        updated_at = NOW()
    WHERE shop_id = ${profile.shop_id}
      AND telegram_id = ${String(chatId)}
      AND is_active = true
      AND (
        (${profile.customer_id || null}::uuid IS NOT NULL AND customer_id = ${profile.customer_id || null})
        OR (${profile.user_id || null}::uuid IS NOT NULL AND user_id = ${profile.user_id || null})
      )
    RETURNING id
  `;

  return rows.length > 0;
}

async function handleNotifications(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id && !profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🔔 Уведомления",
        "",
        "Telegram пока не привязан.",
        "Получите код на сайте или в CRM, нажмите «🔗 Привязать аккаунт» и введите код."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  if (profile?.user_id) {
    const rows = await sql<{
      active_assembly: number;
      active_deliveries: number;
      unread_staff_messages: number;
      pending_events: number;
      last_event_at: string | null;
    }[]>`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM orders
          WHERE shop_id = ${profile.shop_id}
            AND florist_id = ${profile.user_id}
            AND status IN ('new', 'confirmed', 'assembling', 'ready')
        ) AS active_assembly,
        (
          SELECT COUNT(*)::int
          FROM orders
          WHERE shop_id = ${profile.shop_id}
            AND courier_id = ${profile.user_id}
            AND status IN ('ready', 'assigned_courier', 'delivering')
        ) AS active_deliveries,
        (
          SELECT COUNT(*)::int
          FROM chat_messages
          WHERE shop_id = ${profile.shop_id}
            AND is_read_by_staff = false
        ) AS unread_staff_messages,
        (
          SELECT COUNT(*)::int
          FROM notification_events
          WHERE shop_id = ${profile.shop_id}
            AND channel = 'telegram'
            AND status = 'pending'
        ) AS pending_events,
        (
          SELECT MAX(COALESCE(sent_at, updated_at))::text
          FROM notification_events
          WHERE shop_id = ${profile.shop_id}
            AND channel = 'telegram'
            AND status IN ('sent', 'processing')
            AND (
              recipient_telegram_id = ${String(chatId)}
              OR recipient_type = 'staff'
            )
        ) AS last_event_at
    `;

    const item = rows[0];

    await sendTelegramMessage(
      chatId,
      [
        "🔔 Уведомления сотрудника",
        "",
        "Статус: включены",
        `Роль: ${staffRoleText(profile.role)}`,
        "",
        `Активных сборок: ${Number(item?.active_assembly || 0)}`,
        `Активных доставок: ${Number(item?.active_deliveries || 0)}`,
        `Непрочитанных сообщений клиентов: ${Number(item?.unread_staff_messages || 0)}`,
        `Ожидают отправки в Telegram: ${Number(item?.pending_events || 0)}`,
        item?.last_event_at ? `Последнее уведомление: ${shortDateText(item.last_event_at)}` : "Последнее уведомление: пока нет",
        "",
        "Для работы с задачами используйте кнопки «💐 Сборка заказов», «🚚 Доставка» или «📦 Заказы»."
      ].join("\n"),
      {
        reply_markup: replyMarkup
      }
    );
    return;
  }

  const rows = await sql<{
    active_orders: number;
    last_event_at: string | null;
    notifications_enabled: boolean;
  }[]>`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM orders
        WHERE shop_id = ${profile.shop_id}
          AND customer_id = ${profile.customer_id}
          AND status NOT IN ('delivered', 'cancelled')
      ) AS active_orders,
      (
        SELECT MAX(COALESCE(sent_at, updated_at))::text
        FROM notification_events
        WHERE shop_id = ${profile.shop_id}
          AND channel = 'telegram'
          AND recipient_type = 'customer'
          AND status IN ('sent', 'processing')
          AND order_id IN (
            SELECT id
            FROM orders
            WHERE shop_id = ${profile.shop_id}
              AND customer_id = ${profile.customer_id}
          )
      ) AS last_event_at,
      COALESCE((
        SELECT notifications_enabled
        FROM telegram_accounts
        WHERE shop_id = ${profile.shop_id}
          AND customer_id = ${profile.customer_id}
          AND telegram_id = ${String(chatId)}
          AND is_active = true
        ORDER BY linked_at DESC
        LIMIT 1
      ), true) AS notifications_enabled
  `;

  const item = rows[0];
  const isEnabled = item?.notifications_enabled !== false;

  await sendTelegramMessage(
    chatId,
    [
      "🔔 Уведомления покупателя",
      "",
      `Статус: ${isEnabled ? "включены" : "выключены"}`,
      `Активных заказов: ${Number(item?.active_orders || 0)}`,
      item?.last_event_at ? `Последнее уведомление: ${shortDateText(item.last_event_at)}` : "Последнее уведомление: пока нет",
      "",
      isEnabled
        ? "Уведомления по заказам будут приходить сюда автоматически."
        : "Автоматические уведомления по заказам сейчас выключены."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: isEnabled ? "🔕 Выключить уведомления" : "🔔 Включить уведомления",
            callback_data: isEnabled ? "notifications:off" : "notifications:on"
          }
        ],
        [
          {
            text: "📦 Мои заказы",
            callback_data: "orders:list"
          }
        ]
      ])
    }
  );
}

async function handleUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;

  if (!message || message.chat.type !== "private") {
    return;
  }

  await ensureTelegramAccount(update);

  if (message.photo?.length) {
    const courierPhotoHandled =
      await handleCourierDeliveryPhotoMessage(
        message
      );

    if (courierPhotoHandled) {
      return;
    }

    const photoHandled =
      await handleFloristBouquetPhotoMessage(
        message
      );

    if (photoHandled) {
      return;
    }
  }

  const text = message.text?.trim();

  if (!text) {
    return;
  }

  if (
    text === "/cancel"
    && pendingCourierDeliveryPhotoRequests.has(
      message.chat.id
    )
  ) {
    const request =
      pendingCourierDeliveryPhotoRequests.get(
        message.chat.id
      );

    pendingCourierDeliveryPhotoRequests.delete(
      message.chat.id
    );

    await sendTelegramMessage(
      message.chat.id,
      [
        request
          ? `Загрузка фото по заказу ${request.orderNumber} отменена.`
          : "Загрузка фото отменена.",
        "",
        "Статус заказа не изменялся."
      ].join("\n"),
      {
        reply_markup:
          await mainKeyboardForChat(
            message.chat.id
          )
      }
    );

    return;
  }

  const bouquetRevisionHandled =
    await handleCustomerBouquetRevisionReasonMessage(message, text);

  if (bouquetRevisionHandled) {
    return;
  }

  const courierProblemHandled =
    await handleCourierProblemReasonMessage(message, text);

  if (courierProblemHandled) {
    return;
  }

  const floristProblemHandled =
    await handleFloristProblemReasonMessage(message, text);

  if (floristProblemHandled) {
    return;
  }

  if (text.startsWith("/start")) {
    await handleStart(update);
    return;
  }

  if (text === "👤 Профиль") {
    await handleCustomerProfile(message.chat.id);
    return;
  }

  const checkoutHandled = await handleCheckoutMessage(message, text);
  if (checkoutHandled) {
    return;
  }

  if (text === "/menu") {
    await handleOpenMenu(message.chat.id);
    return;
  }

  if (text === "🔗 Привязать аккаунт") {
    await sendTelegramMessage(
      message.chat.id,
      [
        "Введите код привязки.",
        "",
        "Клиент берёт код в личном кабинете на сайте или после оформления заказа.",
        "Сотрудник берёт код в CRM у администратора."
      ].join("\n")
    );
    return;
  }

  if (/^[0-9\s-]{4,12}$/.test(text)) {
    const linked = await handleTelegramLinkCode(message, text);
    if (linked) {
      return;
    }
  }

  if (text === "🛍 Каталог") {
    await handleCatalog(message.chat.id);
    return;
  }

  if (text === "📦 Мои заказы" || text === "📦 Заказы") {
    await handleOrders(message.chat.id);
    return;
  }

  if (text === "🎁 Бонусы") {
    await handleBonuses(message.chat.id);
    return;
  }

  if (text === "☎️ Связь") {
    await handleContact(message.chat.id);
    return;
  }

  if (text === "🧺 Корзина") {
    await handleCart(message.chat.id);
    return;
  }

  if (text === "🧾 CRM") {
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, `🧾 CRM: ${SITE_URL}/admin`, {
      reply_markup: replyMarkup
    });
    return;
  }

  if (text === "⚙️ Настройки") {
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, `⚙️ Настройки магазина доступны в CRM: ${SITE_URL}/admin/settings`, {
      reply_markup: replyMarkup
    });
    return;
  }

  if (text === "💐 Сборка заказов") {
    await handleFloristAssemblyOrders(message.chat.id);
    return;
  }

  if (text === "🚚 Доставка") {
    await handleCourierDeliveryOrders(message.chat.id);
    return;
  }

  if (text === "🔔 Уведомления") {
    await handleNotifications(message.chat.id);
    return;
  }

  const replyMarkup = await mainKeyboardForChat(message.chat.id);

  await sendTelegramMessage(
    message.chat.id,
    "Выберите раздел в меню ниже.",
    {
      reply_markup: replyMarkup
    }
  );
}

async function processTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN || DRY_RUN) return;

  let updates: TelegramUpdate[] = [];

  try {
    updates = await telegramApi<TelegramUpdate[]>(
      `getUpdates?timeout=${TELEGRAM_UPDATES_TIMEOUT_SECONDS}&limit=50${telegramOffset ? `&offset=${telegramOffset}` : ""}`
    );
  } catch (error) {
    console.error("[bot-worker] getUpdates failed", error);
    return;
  }

  for (const update of updates) {
    telegramOffset = update.update_id + 1;

    try {
      await handleUpdate(update);
    } catch (error) {
      console.error("[bot-worker] update failed", error);
    }
  }
}

function eventPayload(event: NotificationEvent): Record<string, unknown> {
  const raw = event.payload as unknown;

  function parsePayloadValue(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsePayloadValue(parsed);
      } catch {
        return {};
      }
    }

    if (Array.isArray(value)) {
      return value.reduce<Record<string, unknown>>((acc, item) => {
        const parsed = parsePayloadValue(item);
        return { ...acc, ...parsed };
      }, {});
    }

    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }

    return {};
  }

  return parsePayloadValue(raw);
}

function payloadValue(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = payload[key];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

function payloadText(payload: Record<string, unknown>, ...keys: string[]): string {
  return valueToText(payloadValue(payload, ...keys));
}

function formatEvent(event: NotificationEvent): string {
  const payload = eventPayload(event);

  const orderNumber = payloadText(payload, "orderNumber", "order_number");
  const orderTitle = orderNumber || "ваш заказ";
  const customerName = payloadText(payload, "customerName", "customer_name") || "Клиент";
  const customerPhone = payloadText(payload, "customerPhone", "customer_phone") || "";
  const totalAmount = payloadValue(payload, "totalAmount", "total_amount", "total", "amount");
  const paymentUrl = absoluteUrl(payloadValue(payload, "paymentUrl", "payment_url"));
  const trackingUrl = absoluteUrl(payloadValue(payload, "trackingUrl", "tracking_url"));
  const totalText = totalAmount === undefined || totalAmount === null || totalAmount === "" ? "" : money(totalAmount);

  if (event.recipient_type === "customer") {
    if (event.type === "customer_login_code") {
      const code = payloadText(payload, "code");
      const phone = payloadText(payload, "phone");

      return [
        "🔐 Код входа в личный кабинет",
        "",
        code ? `Код: ${code}` : "",
        "Код действует 10 минут.",
        phone ? `Телефон: ${phone}` : "",
        "",
        "Если вы не запрашивали вход, просто проигнорируйте это сообщение."
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_confirmed") {
      return [
        `✅ Заказ ${orderTitle} подтверждён`,
        "",
        "Менеджер проверил детали заказа. Следующий шаг — оплата и подготовка букета.",
        trackingUrl ? `Статус заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "payment_link_added") {
      return [
        `💳 Заказ ${orderTitle} готов к оплате`,
        totalText ? `Сумма к оплате: ${totalText}` : "",
        "",
        paymentUrl ? `Оплатить заказ: ${paymentUrl}` : "Ссылка на оплату доступна на странице заказа.",
        trackingUrl ? `Статус заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_paid") {
      return [
        `✅ Оплата по заказу ${orderTitle} получена`,
        "",
        "Мы приступаем к подготовке букета. Статус заказа будет обновляться по мере выполнения.",
        trackingUrl ? `Статус заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_created") {
      return [
        `🌸 Заказ ${orderTitle} принят`,
        totalText ? `Сумма заказа: ${totalText}` : "",
        "",
        "Менеджер проверит детали и подтвердит заказ.",
        trackingUrl ? `Статус заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "bouquet_approval_requested") {
      return [
        `💐 Фото букета по заказу ${orderTitle}`,
        "",
        "Пожалуйста, проверьте готовую композицию.",
        "Нажмите «Одобряю», если всё подходит, или «Нужна правка» и напишите комментарий флористу.",
        trackingUrl ? `Страница заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_ready") {
      return [
        `💐 Букет по заказу ${orderTitle} готов`,
        "",
        "Флорист собрал букет и прикрепил фото. Скоро передадим заказ курьеру.",
        trackingUrl ? `Отследить заказ: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_courier_assigned") {
      return [
        `🚚 Заказ ${orderTitle} передан курьеру`,
        "",
        "Курьер получил данные доставки. Когда он выедет, статус обновится автоматически.",
        trackingUrl ? `Отследить заказ: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_delivering") {
      return [
        `🚗 Курьер выехал по заказу ${orderTitle}`,
        "",
        "Заказ уже в пути к получателю.",
        trackingUrl ? `Отследить доставку: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_delivered") {
      const deliveryProofPhotoUrl = absoluteUrl(
        payloadValue(
          payload,
          "deliveryProofPhotoUrl",
          "delivery_proof_photo_url"
        )
      );

      return [
        `✅ Заказ ${orderTitle} доставлен`,
        "",
        deliveryProofPhotoUrl
          ? "Курьер подтвердил вручение фотографией."
          : "Доставка завершена.",
        "Спасибо, что выбрали ВЫБЕРИ МЕНЯ. Будем рады собрать следующий букет.",
        trackingUrl ? `Страница заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_problem") {
      return [
        `⚠️ По заказу ${orderTitle} требуется уточнение`,
        "",
        "Возник вопрос, который требует участия менеджера. Мы свяжемся с вами по контактам из заказа.",
        trackingUrl ? `Страница заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_cancelled") {
      return [
        `❌ Заказ ${orderTitle} отменён`,
        "",
        "Если заказ был оплачен, менеджер отдельно согласует возврат средств.",
        trackingUrl ? `Страница заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }

    if (event.type === "order_refunded") {
      const refundAmount = payloadValue(
        payload,
        "refundAmount",
        "refund_amount"
      );
      const refundReason = payloadText(
        payload,
        "refundReason",
        "refund_reason"
      );
      const orderCancelled = payloadValue(
        payload,
        "orderCancelled",
        "order_cancelled"
      ) === true;

      return [
        `↩️ По заказу ${orderTitle} зафиксирован возврат`,
        refundAmount !== "" ? `Сумма: ${money(refundAmount)}` : "",
        refundReason ? `Причина: ${refundReason}` : "",
        "",
        "Денежный перевод выполняется тем способом, который согласован с менеджером.",
        orderCancelled ? "Заказ также отменён." : "",
        trackingUrl ? `Страница заказа: ${trackingUrl}` : ""
      ].filter(Boolean).join("\n");
    }
  }

  if (event.type === "internal_chat_message") {
    const messageText = payloadText(payload, "messageText", "message_text");

    return [
      `💬 Новое сообщение в чате команды`,
      orderTitle ? `Заказ: ${orderTitle}` : "",
      "",
      messageText ? `Сообщение: ${messageText}` : "",
      trackingUrl ? `Открыть заказ: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "bouquet_approved") {
    return [
      `✅ Покупатель одобрил букет по заказу ${orderTitle}`,
      "",
      "Можно завершить сборку и передать заказ на следующий этап."
    ].join("\n");
  }

  if (event.type === "bouquet_revision_requested") {
    const note = payloadText(payload, "note");
    const crmUrl = absoluteUrl(payloadValue(payload, "crmUrl", "crm_url"));

    return [
      `🔄 Покупатель попросил изменить букет по заказу ${orderTitle}`,
      note ? `Комментарий: ${note}` : "",
      "",
      "Внесите правки и загрузите новое фото на согласование.",
      crmUrl ? `CRM: ${crmUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "florist_order_assigned") {
    const productName = payloadText(payload, "productName", "product_name");
    const deliveryDate = payloadText(payload, "deliveryDate", "delivery_date");
    const crmUrl = absoluteUrl(payloadValue(payload, "crmUrl", "crm_url"));

    return [
      `💐 Вам назначен заказ ${orderTitle}`,
      productName ? `Товар: ${productName}` : "",
      deliveryDate ? `Дата доставки: ${shortDateText(deliveryDate)}` : "",
      "",
      "Откройте заказ в CRM и возьмите его в работу.",
      crmUrl ? `CRM: ${crmUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "courier_order_assigned") {
    const deliveryDate = payloadText(payload, "deliveryDate", "delivery_date");
    const deliveryIntervalName = payloadText(payload, "deliveryIntervalName", "delivery_interval_name");
    const deliveryAddressText = payloadText(payload, "deliveryAddressText", "delivery_address_text");
    const deliveryComment = payloadText(payload, "deliveryComment", "delivery_comment");
    const recipientName = payloadText(payload, "recipientName", "recipient_name");
    const recipientPhone = payloadText(payload, "recipientPhone", "recipient_phone");

    return [
      `🚚 Вам назначена доставка по заказу ${orderTitle}`,
      deliveryDate ? `Дата: ${shortDateText(deliveryDate)}` : "",
      deliveryIntervalName ? `Интервал: ${deliveryIntervalName}` : "",
      deliveryAddressText ? `Адрес: ${deliveryAddressText}` : "",
      recipientName ? `Получатель: ${recipientName}` : "",
      recipientPhone ? `Телефон: ${recipientPhone}` : "",
      deliveryComment ? `Комментарий: ${deliveryComment}` : "",
      "",
      "Откройте раздел доставки и примите заказ в работу."
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_created") {
    return [
      `🆕 Новый заказ ${orderNumber || "без номера"}`,
      customerName ? `Клиент: ${customerName}` : "",
      customerPhone ? `Телефон: ${customerPhone}` : "",
      totalText ? `Сумма: ${totalText}` : "",
      trackingUrl ? `Ссылка: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_confirmed") {
    return [
      `✅ Заказ ${orderTitle} подтверждён`,
      customerPhone ? `Телефон: ${customerPhone}` : "",
      totalText ? `Сумма: ${totalText}` : "",
      trackingUrl ? `Ссылка: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "payment_link_added") {
    return [
      `💳 Добавлена ссылка оплаты для ${orderTitle}`,
      totalText ? `Сумма: ${totalText}` : "",
      paymentUrl ? `Оплата: ${paymentUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_paid") {
    return [
      `💰 Заказ ${orderTitle} оплачен`,
      totalText ? `Сумма: ${totalText}` : "",
      customerPhone ? `Телефон: ${customerPhone}` : "",
      trackingUrl ? `Ссылка: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  return `Уведомление по заказу ${orderTitle}`;
}

class NotificationSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationSkippedError";
  }
}

function isPermanentTelegramRecipientError(message: string) {
  return /bot was blocked by the user|chat not found|user is deactivated|forbidden|have no rights to send/i.test(message);
}

async function deactivateTelegramRecipient(shopId: string, telegramId: string, reason: string) {
  await sql`
    UPDATE telegram_accounts
    SET is_active = false,
        updated_at = NOW()
    WHERE shop_id = ${shopId}
      AND telegram_id = ${telegramId}
      AND is_active = true
  `;

  console.warn(
    `[bot-worker] telegram recipient deactivated shop=${shopId} chat=${telegramId} reason=${reason}`
  );
}

async function getRecipients(event: NotificationEvent): Promise<string[]> {
  const directRecipient = valueToText(event.recipient_telegram_id).trim();

  if (event.recipient_type === "staff" && event.type === "order_confirmed") {
    return [];
  }

  if (directRecipient && event.recipient_type === "customer") {
    const rows = await sql<{ telegram_id: string }[]>`
      SELECT ta.telegram_id
      FROM telegram_accounts ta
      LEFT JOIN orders o
        ON o.id = ${event.order_id}
       AND o.shop_id = ta.shop_id
      WHERE ta.shop_id = ${event.shop_id}
        AND ta.telegram_id = ${directRecipient}
        AND ta.customer_id IS NOT NULL
        AND ta.is_active = true
        AND (
          ${event.type} = 'customer_login_code'
          OR ta.notifications_enabled = true
        )
        AND (
          ${event.order_id}::uuid IS NULL
          OR o.customer_id = ta.customer_id
        )
      ORDER BY ta.linked_at DESC
      LIMIT 1
    `;

    return rows.map((row) => row.telegram_id).filter(Boolean);
  }

  if (directRecipient && event.recipient_type === "staff") {
    const rows = await sql<{ telegram_id: string }[]>`
      SELECT ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${event.shop_id}
        AND ta.telegram_id = ${directRecipient}
        AND ta.user_id IS NOT NULL
        AND ta.is_active = true
        AND ta.notifications_enabled = true
      LIMIT 1
    `;

    return rows.map((row) => row.telegram_id).filter(Boolean);
  }

  if (event.recipient_type === "customer" && event.order_id) {
    const rows = await sql<{ telegram_id: string }[]>`
      SELECT ta.telegram_id
      FROM orders o
      JOIN telegram_accounts ta
        ON ta.shop_id = o.shop_id
       AND ta.customer_id = o.customer_id
       AND ta.is_active = true
       AND ta.notifications_enabled = true
      WHERE o.id = ${event.order_id}
        AND o.shop_id = ${event.shop_id}
      ORDER BY ta.linked_at DESC
      LIMIT 1
    `;

    return rows.map((row) => row.telegram_id).filter(Boolean);
  }

  if (event.recipient_type === "staff") {
    const rows = await sql<{ telegram_id: string }[]>`
      SELECT DISTINCT ta.telegram_id
      FROM telegram_accounts ta
      JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${event.shop_id}
        AND ta.user_id IS NOT NULL
        AND ta.is_active = true
        AND ta.notifications_enabled = true
        AND su.role IN ('owner', 'admin', 'manager')
      ORDER BY ta.telegram_id
    `;

    return rows.map((row) => row.telegram_id).filter(Boolean);
  }

  return [];
}

async function processNotificationEvents() {
  await sql`
    UPDATE notification_events
    SET status = 'pending',
        error = COALESCE(error, 'Восстановлено после зависшего процесса'),
        updated_at = NOW()
    WHERE channel = 'telegram'
      AND status = 'processing'
      AND updated_at < NOW() - INTERVAL '10 minutes'
  `;

  const events = await sql<NotificationEvent[]>`
    SELECT id, shop_id, order_id, type, channel, recipient_type, recipient_telegram_id, payload, attempts, created_at, updated_at
    FROM notification_events
    WHERE status = 'pending'
      AND channel = 'telegram'
      AND attempts < 5
      AND updated_at <= NOW() - (
        CASE attempts
          WHEN 0 THEN INTERVAL '0 seconds'
          WHEN 1 THEN INTERVAL '30 seconds'
          WHEN 2 THEN INTERVAL '2 minutes'
          WHEN 3 THEN INTERVAL '10 minutes'
          ELSE INTERVAL '30 minutes'
        END
      )
    ORDER BY created_at ASC
    LIMIT 10
  `;

  if (events.length === 0) {
    return;
  }

  console.log(`[bot-worker] pending events=${events.length}`);

  for (const event of events) {
    const message = formatEvent(event);

    if (DRY_RUN) {
      console.log(`[bot-worker] dry-run event=${event.id} type=${event.type}`);
      console.log(message);
      continue;
    }

    const claimed = await sql<{ id: string }[]>`
      UPDATE notification_events
      SET status = 'processing',
          updated_at = NOW()
      WHERE id = ${event.id}
        AND status = 'pending'
      RETURNING id
    `;

    if (claimed.length === 0) {
      continue;
    }

    try {
      const recipients = await getRecipients(event);

      if (recipients.length === 0) {
        throw new NotificationSkippedError(
          event.recipient_type === "customer"
            ? "Telegram покупателя не подключён или уведомления выключены"
            : "Нет активного сотрудника с включёнными Telegram-уведомлениями"
        );
      }

      let deliveredRecipients = 0;

      for (const chatId of recipients) {
        try {
          const payload = eventPayload(event);
        const productImageUrl = absoluteUrl(payloadValue(payload, "productImageUrl", "product_image_url"));
        const bouquetPhotoUrl = absoluteUrl(payloadValue(payload, "bouquetPhotoUrl", "bouquet_photo_url"));
        const deliveryProofPhotoUrl = absoluteUrl(
          payloadValue(
            payload,
            "deliveryProofPhotoUrl",
            "delivery_proof_photo_url"
          )
        );
        const orderId = payloadText(payload, "orderId", "order_id");
        const crmUrl = absoluteUrl(payloadValue(payload, "crmUrl", "crm_url"));
        const trackingUrl = absoluteUrl(payloadValue(payload, "trackingUrl", "tracking_url"));

        const deliveryAddressText = payloadText(payload, "deliveryAddressText", "delivery_address_text");
        const actionButtonRows: TelegramInlineKeyboardButton[][] = [];

        if (
          event.recipient_type === "customer"
          && event.type === "bouquet_approval_requested"
          && orderId
        ) {
          actionButtonRows.push([
            {
              text: "✅ Одобряю",
              callback_data: `bouquet:approve:${orderId}`
            },
            {
              text: "🔄 Нужна правка",
              callback_data: `bouquet:revision:${orderId}`
            }
          ]);
        }

        if (event.type === "bouquet_approved" && orderId) {
          actionButtonRows.push([
            {
              text: "✅ Завершить сборку",
              callback_data: `florist:ready:${orderId}`
            }
          ]);
        }

        if (event.type === "bouquet_revision_requested" && orderId) {
          actionButtonRows.push([
            {
              text: "📸 Загрузить новое фото",
              callback_data: `florist:photo:${orderId}`
            }
          ]);
        }

        if (event.type === "florist_order_assigned" && orderId) {
          actionButtonRows.push([
            {
              text: "💐 Взять в работу",
              callback_data: `florist:take:${orderId}`
            }
          ]);
        }

        if (event.type === "courier_order_assigned" && orderId) {
          actionButtonRows.push([
            {
              text: "🚚 Принять доставку",
              callback_data: `courier:accept:${orderId}`
            }
          ]);

          if (deliveryAddressText) {
            actionButtonRows.push([
              {
                text: "🗺 Маршрут",
                url: `https://yandex.ru/maps/?text=${encodeURIComponent(deliveryAddressText)}`
              }
            ]);
          }
        }

        if (
          (
            event.type === "florist_order_assigned"
            || event.type === "courier_order_assigned"
            || event.type === "bouquet_approved"
            || event.type === "bouquet_revision_requested"
          )
          && crmUrl
        ) {
          actionButtonRows.push([
            {
              text: "Открыть CRM",
              url: crmUrl
            }
          ]);
        }

        if (event.recipient_type === "customer" && trackingUrl) {
          actionButtonRows.push([
            {
              text: "Открыть заказ",
              url: trackingUrl
            }
          ]);
        }

        const actionReplyMarkup = actionButtonRows.length ? inlineKeyboard(actionButtonRows) : null;

        if (
          event.type
          === "courier_order_assigned"
          && orderId
        ) {
          const courierOrder =
            await loadCourierOrderCard(
              event.shop_id,
              orderId
            );

          if (!courierOrder) {
            throw new Error(
              "Courier order not found"
            );
          }

          const courierChatId =
            Number(chatId);

          if (
            !Number.isSafeInteger(
              courierChatId
            )
          ) {
            throw new Error(
              "Invalid courier Telegram chat ID"
            );
          }

          await sendCourierOrderCard(
            courierChatId,
            courierOrder
          );
        } else if (
          event.type
          === "florist_order_assigned"
          && productImageUrl
        ) {
          await sendTelegramPhoto(chatId, productImageUrl, message);

          if (actionReplyMarkup) {
            await sendTelegramMessage(chatId, "Действие по заказу:", {
              reply_markup: actionReplyMarkup
            });
          }
        } else if (
          event.type === "bouquet_approval_requested"
          && bouquetPhotoUrl
        ) {
          await sendTelegramPhoto(
            chatId,
            bouquetPhotoUrl,
            message,
            actionReplyMarkup
              ? { reply_markup: actionReplyMarkup }
              : undefined
          );
        } else if (event.type === "order_ready" && bouquetPhotoUrl) {
          await sendTelegramPhoto(chatId, bouquetPhotoUrl, message, actionReplyMarkup ? {
            reply_markup: actionReplyMarkup
          } : undefined);
        } else if (event.type === "order_delivered" && deliveryProofPhotoUrl) {
          await sendTelegramPhoto(
            chatId,
            deliveryProofPhotoUrl,
            message,
            actionReplyMarkup
              ? {
                  reply_markup:
                    actionReplyMarkup
                }
              : undefined
          );
        } else if (actionReplyMarkup) {
          await sendTelegramMessage(chatId, message, {
            reply_markup: actionReplyMarkup
          });
        } else {
          await sendTelegramMessage(chatId, message);
        }

          deliveredRecipients += 1;
        } catch (recipientError) {
          const recipientErrorMessage =
            recipientError instanceof Error
              ? recipientError.message
              : String(recipientError);

          if (isPermanentTelegramRecipientError(recipientErrorMessage)) {
            await deactivateTelegramRecipient(
              event.shop_id,
              String(chatId),
              recipientErrorMessage
            );

            console.warn(
              `[bot-worker] recipient skipped event=${event.id} chat=${chatId}`
            );
            continue;
          }

          throw recipientError;
        }
      }

      if (deliveredRecipients === 0) {
        throw new NotificationSkippedError(
          "Все получатели Telegram недоступны или отключены"
        );
      }

      await sql`
        UPDATE notification_events
        SET status = 'sent',
            attempts = attempts + 1,
            error = NULL,
            sent_at = NOW(),
            updated_at = NOW()
        WHERE id = ${event.id}
      `;

      console.log(`[bot-worker] sent event=${event.id} type=${event.type}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (error instanceof NotificationSkippedError) {
        await sql`
          UPDATE notification_events
          SET status = 'skipped',
              error = ${errorMessage},
              updated_at = NOW()
          WHERE id = ${event.id}
        `;

        console.warn(`[bot-worker] skipped event=${event.id} reason=${errorMessage}`);
        continue;
      }

      const directRecipient = valueToText(event.recipient_telegram_id).trim();

      if (directRecipient && isPermanentTelegramRecipientError(errorMessage)) {
        await deactivateTelegramRecipient(event.shop_id, directRecipient, errorMessage);

        await sql`
          UPDATE notification_events
          SET status = 'skipped',
              attempts = attempts + 1,
              error = ${`Получатель Telegram отключён автоматически: ${errorMessage}`},
              updated_at = NOW()
          WHERE id = ${event.id}
        `;

        continue;
      }

      const nextAttempts = Number(event.attempts || 0) + 1;
      const nextStatus = nextAttempts >= 5 ? "failed" : "pending";

      await sql`
        UPDATE notification_events
        SET status = ${nextStatus},
            attempts = attempts + 1,
            error = ${errorMessage},
            updated_at = NOW()
        WHERE id = ${event.id}
      `;

      console.error(`[bot-worker] failed event=${event.id}`, error);
    }
  }
}

async function loop() {
  console.log(
    `[bot-worker] started dryRun=${DRY_RUN} runOnce=${RUN_ONCE} tokenSet=${Boolean(TELEGRAM_BOT_TOKEN)} poll=${POLL_INTERVAL_MS}ms updatesTimeout=${TELEGRAM_UPDATES_TIMEOUT_SECONDS}s`
  );

  while (!isStopping) {
    await processTelegramUpdates();
    await processNotificationEvents();

    if (RUN_ONCE) {
      break;
    }

    await new Promise((resolveTimer) => setTimeout(resolveTimer, POLL_INTERVAL_MS));
  }

  await sql.end();
}

process.on("SIGINT", () => {
  isStopping = true;
});

process.on("SIGTERM", () => {
  isStopping = true;
});

loop().catch(async (error) => {
  console.error("[bot-worker] fatal", error);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
