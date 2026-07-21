import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";
import {
  CUSTOMER_MENU_TEXT,
  clientMainKeyboard,
  customerLinkInstructions,
  isCustomerMenuCommand,
  unlinkedMainKeyboard,
} from "./customer-telegram-ux";
import {
  hashBrowserPairingCode,
  hashBrowserPairingToken,
  isPairingManualCode,
  pairingApproveCallback,
  pairingCancelCallback,
  pairingPhoneMatches,
  parsePairingStartPayload,
} from "./customer-browser-pairing";
import {
  normalizeTelegramCheckoutDraftData,
  prepareTelegramCheckoutDraftData,
  telegramCheckoutDraftExpired,
  type TelegramCheckoutDraftData,
  type TelegramCheckoutDraftPaymentMethod,
  type TelegramCheckoutDraftStep,
} from "./customer-checkout-draft-core";
import {
  buildTelegramOrderCreateBody,
  readTelegramFinalizedOrder,
  readTelegramOrderError,
  type TelegramFinalizedOrder,
} from "./customer-order-finalization";
import {
  TELEGRAM_CHECKOUT_FLOW_CREATES_ORDER,
  TELEGRAM_CHECKOUT_FLOW_VERSION,
  normalizeTelegramBonus,
  normalizeTelegramPromoCode,
  telegramCheckoutDateChoices,
  telegramCheckoutEditStep,
  telegramCheckoutPreviousStep,
  telegramCheckoutProgress,
} from "./customer-checkout-flow";

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


type NotificationOutboxEvent = NotificationEvent & {
  source_notification_event_id: string | null;
  recipient_user_id: string | null;
  recipient_customer_id: string | null;
  recipient_role: string | null;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
};

type NotificationDelivery = {
  id: string;
  outbox_id: string;
  recipient_address: string;
  recipient_user_id: string | null;
  recipient_customer_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
};

type ResolvedNotificationRecipient = {
  address: string;
  userId: string | null;
  customerId: string | null;
  role: string | null;
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

type TelegramContact = {
  phone_number: string;
  first_name?: string;
  last_name?: string;
  user_id?: number;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  contact?: TelegramContact;
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
const NOTIFICATION_SOURCE = (process.env.BOT_NOTIFICATION_SOURCE || "outbox").trim().toLowerCase();
const NOTIFICATION_SELF_TEST = process.env.BOT_NOTIFICATION_SELF_TEST === "true";
const NOTIFICATION_WORKER_ID = `telegram-outbox:${process.pid}:${randomUUID().slice(0, 8)}`;

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

type CustomerTelegramUnlinkResult = {
  unlinked: boolean;
  customerId: string | null;
  staffLinkPreserved: boolean;
  remainingCustomerLinks: number;
};

async function unlinkCustomerTelegramFromBot(
  chatId: number,
): Promise<CustomerTelegramUnlinkResult> {
  const telegramId = String(chatId);
  const shopId = await getDefaultShopId();

  if (!shopId) {
    return {
      unlinked: false,
      customerId: null,
      staffLinkPreserved: false,
      remainingCustomerLinks: 0,
    };
  }

  return sql.begin(async (transaction) => {
    const accountRows = await transaction<
      {
        id: string;
        customer_id: string | null;
        user_id: string | null;
      }[]
    >`
      SELECT id, customer_id, user_id
      FROM telegram_accounts
      WHERE shop_id = ${shopId}
        AND telegram_id = ${telegramId}
        AND is_active = true
      LIMIT 1
      FOR UPDATE
    `;

    const account = accountRows[0];

    if (!account?.customer_id) {
      return {
        unlinked: false,
        customerId: null,
        staffLinkPreserved: Boolean(account?.user_id),
        remainingCustomerLinks: 0,
      };
    }

    const customerId = account.customer_id;
    const staffLinkPreserved = Boolean(account.user_id);

    await transaction`
      UPDATE telegram_accounts
      SET
        customer_id = NULL,
        is_active = CASE
          WHEN user_id IS NOT NULL THEN true
          ELSE false
        END,
        notifications_enabled = CASE
          WHEN user_id IS NOT NULL THEN notifications_enabled
          ELSE false
        END,
        updated_at = NOW()
      WHERE id = ${account.id}
    `;

    await transaction`
      UPDATE customer_channel_links
      SET
        is_active = false,
        updated_at = NOW()
      WHERE shop_id = ${shopId}
        AND customer_id = ${customerId}
        AND provider = 'telegram'
        AND provider_user_id = ${telegramId}
        AND is_active = true
    `;

    await transaction`
      UPDATE customer_link_tokens
      SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE shop_id = ${shopId}
        AND customer_id = ${customerId}
        AND (
          (provider = 'telegram' AND purpose IN (
            'connect_channel',
            'browser_pairing_login'
          ))
          OR (provider = 'site' AND purpose = 'magic_login')
        )
        AND status = 'pending'
        AND consumed_at IS NULL
    `;

    await transaction`
      UPDATE notification_deliveries
      SET
        status = 'skipped',
        locked_at = NULL,
        locked_by = NULL,
        last_error = 'Telegram отвязан покупателем в боте',
        failed_at = COALESCE(failed_at, NOW()),
        updated_at = NOW()
      WHERE shop_id = ${shopId}
        AND channel = 'telegram'
        AND recipient_customer_id = ${customerId}
        AND recipient_address = ${telegramId}
        AND status IN ('pending', 'processing')
    `;

    const remainingRows = await transaction<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM telegram_accounts
      WHERE shop_id = ${shopId}
        AND customer_id = ${customerId}
        AND is_active = true
    `;

    const remainingCustomerLinks = Number(remainingRows[0]?.count ?? 0);

    if (remainingCustomerLinks === 0) {
      await transaction`
        UPDATE notification_outbox
        SET
          status = 'skipped',
          locked_at = NULL,
          locked_by = NULL,
          last_error = 'Telegram отвязан от профиля покупателя',
          updated_at = NOW()
        WHERE shop_id = ${shopId}
          AND channel = 'telegram'
          AND recipient_customer_id = ${customerId}
          AND status IN ('pending', 'processing')
      `;
    }

    await transaction`
      INSERT INTO admin_audit_log (
        shop_id,
        actor_role,
        event_type,
        entity_type,
        entity_id,
        severity,
        summary,
        metadata,
        created_at
      )
      VALUES (
        ${shopId},
        'customer',
        'customer.telegram_unlinked',
        'customer',
        ${customerId},
        'warning',
        'Telegram отвязан покупателем в боте',
        ${JSON.stringify({
          source: 'telegram_bot',
          staffLinkPreserved,
          remainingCustomerLinks,
        })}::jsonb,
        NOW()
      )
    `;

    return {
      unlinked: true,
      customerId,
      staffLinkPreserved,
      remainingCustomerLinks,
    };
  });
}

function createCustomerMagicToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function hashCustomerMagicToken(token: string) {
  return `sha256:${createHash("sha256")
    .update(`viberimenya:customer-magic-login:v1:${token}`)
    .digest("hex")}`;
}

async function createCustomerMagicLoginUrl(params: {
  shopId: string;
  customerId: string;
  orderId: string | null;
  redirectPath?: string;
}) {
  const token = createCustomerMagicToken();
  const storedToken = hashCustomerMagicToken(token);
  const redirectPath = params.redirectPath || "/account";

  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE customer_link_tokens
      SET status = 'expired',
          updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND customer_id = ${params.customerId}
        AND provider = 'site'
        AND purpose = 'magic_login'
        AND status = 'pending'
        AND consumed_at IS NULL
        AND expires_at <= NOW()
    `;

    await transaction`
      INSERT INTO customer_link_tokens (
        shop_id, customer_id, order_id, provider, purpose,
        token, status, expires_at, metadata, created_at, updated_at
      )
      VALUES (
        ${params.shopId}, ${params.customerId}, ${params.orderId},
        'site', 'magic_login',
        ${storedToken}, 'pending', NOW() + INTERVAL '10 minutes',
        ${JSON.stringify({
          source: "telegram_magic_login",
          redirectPath,
          tokenStorage: "sha256-v1",
        })},
        NOW(), NOW()
      )
    `;

    await transaction`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            ORDER BY created_at DESC, id DESC
          ) AS position
        FROM customer_link_tokens
        WHERE shop_id = ${params.shopId}
          AND customer_id = ${params.customerId}
          AND provider = 'site'
          AND purpose = 'magic_login'
          AND status = 'pending'
          AND consumed_at IS NULL
          AND expires_at > NOW()
      )
      UPDATE customer_link_tokens tokens
      SET status = 'cancelled',
          updated_at = NOW()
      WHERE tokens.id IN (
        SELECT id FROM ranked WHERE position > 5
      )
    `;
  });

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
      AND status IN ('pending', 'opened', 'confirmed')
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

  await sql`
    INSERT INTO admin_audit_log (
      shop_id,
      actor_role,
      event_type,
      entity_type,
      entity_id,
      severity,
      summary,
      metadata,
      created_at
    )
    VALUES (
      ${shopId},
      'customer',
      'customer.telegram_linked',
      'customer',
      ${linkToken.customer_id},
      'info',
      'Telegram подключён к профилю покупателя',
      ${JSON.stringify({ source: 'telegram_bot', mode: 'one_time_code' })}::jsonb,
      NOW()
    )
  `;

  const magicLoginUrl = await createCustomerMagicLoginUrl({
    shopId,
    customerId: linkToken.customer_id,
    orderId: linkToken.order_id,
    redirectPath: "/account",
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


type BrowserPairingRecord = {
  id: string;
  shop_id: string;
  customer_id: string;
  status: string;
  expires_at: string;
  metadata: Record<string, unknown>;
  phone: string;
};

function pairingMetadataText(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

async function loadBrowserPairingByToken(
  shopId: string,
  rawToken: string,
) {
  const storedToken = hashBrowserPairingToken(rawToken);
  const rows = await sql<BrowserPairingRecord[]>`
    SELECT
      tokens.id,
      tokens.shop_id,
      tokens.customer_id,
      tokens.status,
      tokens.expires_at::text,
      tokens.metadata,
      customers.phone
    FROM customer_link_tokens tokens
    JOIN customers
      ON customers.id = tokens.customer_id
     AND customers.shop_id = tokens.shop_id
    WHERE tokens.shop_id = ${shopId}
      AND tokens.provider = 'telegram'
      AND tokens.purpose = 'browser_pairing_login'
      AND tokens.token = ${storedToken}
      AND tokens.status IN ('pending', 'opened')
      AND tokens.consumed_at IS NULL
      AND tokens.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function loadBrowserPairingByCode(
  shopId: string,
  rawCode: string,
) {
  const codeHash = hashBrowserPairingCode(rawCode);
  const rows = await sql<BrowserPairingRecord[]>`
    SELECT
      tokens.id,
      tokens.shop_id,
      tokens.customer_id,
      tokens.status,
      tokens.expires_at::text,
      tokens.metadata,
      customers.phone
    FROM customer_link_tokens tokens
    JOIN customers
      ON customers.id = tokens.customer_id
     AND customers.shop_id = tokens.shop_id
    WHERE tokens.shop_id = ${shopId}
      AND tokens.provider = 'telegram'
      AND tokens.purpose = 'browser_pairing_login'
      AND tokens.metadata ->> 'codeHash' = ${codeHash}
      AND tokens.status IN ('pending', 'opened')
      AND tokens.consumed_at IS NULL
      AND tokens.expires_at > NOW()
    ORDER BY tokens.created_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function openBrowserPairing(
  message: TelegramMessage,
  pairing: BrowserPairingRecord,
) {
  const telegramId = String(message.chat.id);
  const existingRows = await sql<
    {
      customer_id: string | null;
      user_id: string | null;
    }[]
  >`
    SELECT customer_id, user_id
    FROM telegram_accounts
    WHERE shop_id = ${pairing.shop_id}
      AND telegram_id = ${telegramId}
      AND is_active = true
    LIMIT 1
  `;
  const existing = existingRows[0];

  if (
    existing?.customer_id
    && existing.customer_id !== pairing.customer_id
  ) {
    await sql`
      UPDATE customer_link_tokens
      SET
        status = 'rejected',
        metadata = metadata || ${JSON.stringify({
          rejectionReason: "telegram_linked_to_other_customer",
          rejectedTelegramId: telegramId,
          rejectedAt: new Date().toISOString(),
        })}::jsonb,
        updated_at = NOW()
      WHERE id = ${pairing.id}
        AND status IN ('pending', 'opened')
    `;

    await sendTelegramMessage(
      message.chat.id,
      [
        "Этот Telegram уже связан с другим профилем.",
        "",
        "Сначала отключите прежнюю привязку в профиле покупателя или обратитесь в поддержку.",
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(message.chat.id),
      },
    );

    return true;
  }

  await sql`
    UPDATE customer_link_tokens
    SET
      status = 'opened',
      metadata = metadata || ${JSON.stringify({
        candidateTelegramId: telegramId,
        candidateUsername: message.from?.username || null,
        candidateFirstName: message.from?.first_name || null,
        candidateLastName: message.from?.last_name || null,
        openedAt: new Date().toISOString(),
      })}::jsonb,
      updated_at = NOW()
    WHERE id = ${pairing.id}
      AND status IN ('pending', 'opened')
      AND consumed_at IS NULL
      AND expires_at > NOW()
  `;

  if (existing?.customer_id === pairing.customer_id) {
    await sendTelegramMessage(
      message.chat.id,
      [
        "🔐 Подтверждение входа на сайт",
        "",
        "Этот Telegram уже подключён к вашему профилю.",
        "Подтвердите вход в браузере, где вы ввели номер телефона.",
        "",
        "Запрос действует 10 минут.",
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "✅ Подтвердить вход",
              callback_data: pairingApproveCallback(pairing.id),
            },
          ],
          [
            {
              text: "Отменить",
              callback_data: pairingCancelCallback(pairing.id),
            },
          ],
        ]),
      },
    );

    return true;
  }

  await sendTelegramMessage(
    message.chat.id,
    [
      "🔐 Подключение Telegram и вход на сайт",
      "",
      "Чтобы подтвердить номер, нажмите кнопку ниже.",
      "Telegram передаст только ваш номер телефона.",
      "",
      "Номер должен совпадать с введённым на сайте.",
    ].join("\n"),
    {
      reply_markup: {
        keyboard: [
          [
            {
              text: "📱 Поделиться моим номером",
              request_contact: true,
            },
          ],
          [
            {
              text: "Отменить вход",
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
        is_persistent: false,
        input_field_placeholder: "Подтвердите свой номер",
      },
    },
  );

  return true;
}

async function confirmBrowserPairing(
  pairingId: string,
  message: TelegramMessage,
  source: "linked_telegram" | "telegram_contact",
) {
  const telegramId = String(message.chat.id);

  return sql.begin(async (transaction) => {
    const rows = await transaction<BrowserPairingRecord[]>`
      SELECT
        tokens.id,
        tokens.shop_id,
        tokens.customer_id,
        tokens.status,
        tokens.expires_at::text,
        tokens.metadata,
        customers.phone
      FROM customer_link_tokens tokens
      JOIN customers
        ON customers.id = tokens.customer_id
       AND customers.shop_id = tokens.shop_id
      WHERE tokens.id = ${pairingId}
        AND tokens.provider = 'telegram'
        AND tokens.purpose = 'browser_pairing_login'
        AND tokens.status IN ('pending', 'opened')
        AND tokens.consumed_at IS NULL
        AND tokens.expires_at > NOW()
      LIMIT 1
      FOR UPDATE
    `;
    const pairing = rows[0];

    if (!pairing) {
      return {
        ok: false as const,
        reason: "expired" as const,
      };
    }

    if (
      pairingMetadataText(
        pairing.metadata,
        "candidateTelegramId",
      ) !== telegramId
    ) {
      return {
        ok: false as const,
        reason: "different_telegram" as const,
      };
    }

    const existingRows = await transaction<
      {
        customer_id: string | null;
        user_id: string | null;
      }[]
    >`
      SELECT customer_id, user_id
      FROM telegram_accounts
      WHERE shop_id = ${pairing.shop_id}
        AND telegram_id = ${telegramId}
        AND is_active = true
      LIMIT 1
      FOR UPDATE
    `;
    const existing = existingRows[0];

    if (
      existing?.customer_id
      && existing.customer_id !== pairing.customer_id
    ) {
      await transaction`
        UPDATE customer_link_tokens
        SET
          status = 'rejected',
          metadata = metadata || ${JSON.stringify({
            rejectionReason: "telegram_linked_to_other_customer",
            rejectedTelegramId: telegramId,
            rejectedAt: new Date().toISOString(),
          })}::jsonb,
          updated_at = NOW()
        WHERE id = ${pairing.id}
      `;

      return {
        ok: false as const,
        reason: "already_linked" as const,
      };
    }

    const displayName = [
      message.from?.first_name,
      message.from?.last_name,
    ]
      .filter(Boolean)
      .join(" ") || null;

    await transaction`
      INSERT INTO telegram_accounts (
        shop_id,
        customer_id,
        telegram_id,
        username,
        first_name,
        last_name,
        is_active,
        notifications_enabled,
        linked_at,
        created_at,
        updated_at
      )
      VALUES (
        ${pairing.shop_id},
        ${pairing.customer_id},
        ${telegramId},
        ${message.from?.username || null},
        ${message.from?.first_name || null},
        ${message.from?.last_name || null},
        true,
        true,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, telegram_id)
      DO UPDATE SET
        customer_id = ${pairing.customer_id},
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = true,
        notifications_enabled = true,
        linked_at = NOW(),
        updated_at = NOW()
    `;

    await transaction`
      INSERT INTO customer_channel_links (
        shop_id,
        customer_id,
        provider,
        provider_user_id,
        provider_username,
        provider_display_name,
        is_active,
        linked_at,
        created_at,
        updated_at
      )
      VALUES (
        ${pairing.shop_id},
        ${pairing.customer_id},
        'telegram',
        ${telegramId},
        ${message.from?.username || null},
        ${displayName},
        true,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, provider, provider_user_id)
      DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        provider_username = EXCLUDED.provider_username,
        provider_display_name = EXCLUDED.provider_display_name,
        is_active = true,
        linked_at = NOW(),
        updated_at = NOW()
    `;

    await transaction`
      UPDATE customers
      SET
        telegram_username = COALESCE(
          ${message.from?.username || null},
          telegram_username
        ),
        updated_at = NOW()
      WHERE id = ${pairing.customer_id}
        AND shop_id = ${pairing.shop_id}
    `;

    await transaction`
      UPDATE customer_link_tokens
      SET
        status = 'confirmed',
        metadata = metadata || ${JSON.stringify({
          confirmedTelegramId: telegramId,
          confirmedUsername: message.from?.username || null,
          confirmedAt: new Date().toISOString(),
          confirmationSource: source,
        })}::jsonb,
        updated_at = NOW()
      WHERE id = ${pairing.id}
        AND status IN ('pending', 'opened')
    `;

    await transaction`
      INSERT INTO admin_audit_log (
        shop_id,
        actor_role,
        event_type,
        entity_type,
        entity_id,
        severity,
        summary,
        metadata,
        created_at
      )
      VALUES (
        ${pairing.shop_id},
        'customer',
        'customer.pairing_confirmed',
        'customer',
        ${pairing.customer_id},
        'info',
        'Telegram подтвердил вход в браузере',
        ${JSON.stringify({
          pairingId: pairing.id,
          telegramId,
          source,
        })}::jsonb,
        NOW()
      )
    `;

    return {
      ok: true as const,
      customerId: pairing.customer_id,
      shopId: pairing.shop_id,
    };
  });
}

async function handleBrowserPairingToken(
  message: TelegramMessage,
  payload: string,
) {
  const rawToken = parsePairingStartPayload(payload);

  if (!rawToken) return false;

  const shopId = await getDefaultShopId();

  if (!shopId) {
    await sendTelegramMessage(
      message.chat.id,
      "Магазин временно недоступен. Попробуйте позже.",
    );
    return true;
  }

  const pairing = await loadBrowserPairingByToken(
    shopId,
    rawToken,
  );

  if (!pairing) {
    await sendTelegramMessage(
      message.chat.id,
      "Запрос входа уже использован, отменён или срок его действия истёк.",
      {
        reply_markup: await mainKeyboardForChat(message.chat.id),
      },
    );
    return true;
  }

  return openBrowserPairing(message, pairing);
}

async function handleBrowserPairingCode(
  message: TelegramMessage,
  rawCode: string,
) {
  if (!isPairingManualCode(rawCode)) return false;

  const shopId = await getDefaultShopId();
  if (!shopId) return false;

  const pairing = await loadBrowserPairingByCode(
    shopId,
    rawCode,
  );

  if (!pairing) return false;

  telegramLinkAttempts.delete(message.chat.id);
  return openBrowserPairing(message, pairing);
}

async function handleBrowserPairingContact(
  message: TelegramMessage,
) {
  if (!message.contact) return false;

  const telegramId = String(message.chat.id);
  const shopId = await getDefaultShopId();

  if (!shopId) return false;

  const rows = await sql<BrowserPairingRecord[]>`
    SELECT
      tokens.id,
      tokens.shop_id,
      tokens.customer_id,
      tokens.status,
      tokens.expires_at::text,
      tokens.metadata,
      customers.phone
    FROM customer_link_tokens tokens
    JOIN customers
      ON customers.id = tokens.customer_id
     AND customers.shop_id = tokens.shop_id
    WHERE tokens.shop_id = ${shopId}
      AND tokens.provider = 'telegram'
      AND tokens.purpose = 'browser_pairing_login'
      AND tokens.status = 'opened'
      AND tokens.consumed_at IS NULL
      AND tokens.expires_at > NOW()
      AND tokens.metadata ->> 'candidateTelegramId' = ${telegramId}
    ORDER BY tokens.created_at DESC
    LIMIT 1
  `;
  const pairing = rows[0];

  if (!pairing) return false;

  if (
    !message.contact.user_id
    || !message.from?.id
    || message.contact.user_id !== message.from.id
  ) {
    await sendTelegramMessage(
      message.chat.id,
      "Нужно отправить именно свой номер кнопкой «Поделиться моим номером». Пересланные контакты не принимаются.",
    );
    return true;
  }

  if (
    !pairingPhoneMatches(
      pairing.phone,
      message.contact.phone_number,
    )
  ) {
    const attempts = Number(
      pairing.metadata.attempts || 0,
    ) + 1;
    const status = attempts >= 5 ? "rejected" : "opened";

    await sql`
      UPDATE customer_link_tokens
      SET
        status = ${status},
        metadata = metadata || ${JSON.stringify({
          attempts,
          lastMismatchAt: new Date().toISOString(),
          mismatchReason: "phone_mismatch",
        })}::jsonb,
        updated_at = NOW()
      WHERE id = ${pairing.id}
        AND status = 'opened'
    `;

    await sendTelegramMessage(
      message.chat.id,
      attempts >= 5
        ? "Номера не совпали. Запрос входа отменён. Создайте новый запрос на сайте."
        : "Номер Telegram не совпадает с номером, введённым на сайте. Проверьте номер и создайте новый запрос при необходимости.",
      {
        reply_markup: {
          remove_keyboard: true,
        },
      },
    );

    return true;
  }

  const result = await confirmBrowserPairing(
    pairing.id,
    message,
    "telegram_contact",
  );

  if (!result.ok) {
    await sendTelegramMessage(
      message.chat.id,
      "Не удалось подтвердить вход. Создайте новый запрос на сайте.",
      {
        reply_markup: await mainKeyboardForChat(message.chat.id),
      },
    );
    return true;
  }

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ Telegram подключён",
      "",
      "Номер подтверждён.",
      "Вернитесь на сайт — вход завершится автоматически.",
    ].join("\n"),
    {
      reply_markup: {
        remove_keyboard: true,
      },
    },
  );

  await sendTelegramMessage(
    message.chat.id,
    "Главное меню:",
    {
      reply_markup: await mainKeyboardForChat(message.chat.id),
    },
  );

  return true;
}

async function handleBrowserPairingApprove(
  callbackQuery: TelegramCallbackQuery,
  pairingId: string,
) {
  const message = callbackQuery.message;

  if (!message) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const result = await confirmBrowserPairing(
    pairingId,
    message,
    "linked_telegram",
  );

  if (!result.ok) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Запрос больше не действует",
    );
    await sendTelegramMessage(
      message.chat.id,
      "Запрос входа уже использован, отменён или истёк.",
      {
        reply_markup: await mainKeyboardForChat(message.chat.id),
      },
    );
    return;
  }

  await answerCallbackQuery(
    callbackQuery.id,
    "Вход подтверждён",
  );
  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ Вход подтверждён",
      "",
      "Вернитесь в браузер — личный кабинет откроется автоматически.",
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(message.chat.id),
    },
  );
}

async function handleBrowserPairingCancel(
  callbackQuery: TelegramCallbackQuery,
  pairingId: string,
) {
  const message = callbackQuery.message;

  if (!message) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const telegramId = String(message.chat.id);
  const updated = await sql<{ id: string }[]>`
    UPDATE customer_link_tokens
    SET
      status = 'cancelled',
      metadata = metadata || ${JSON.stringify({
        cancelledAt: new Date().toISOString(),
        cancelledTelegramId: telegramId,
        cancelledBy: "telegram",
      })}::jsonb,
      updated_at = NOW()
    WHERE id = ${pairingId}
      AND provider = 'telegram'
      AND purpose = 'browser_pairing_login'
      AND status IN ('pending', 'opened')
      AND consumed_at IS NULL
      AND expires_at > NOW()
      AND metadata ->> 'candidateTelegramId' = ${telegramId}
    RETURNING id
  `;

  await answerCallbackQuery(
    callbackQuery.id,
    updated[0] ? "Запрос отменён" : "Запрос уже закрыт",
  );
  await sendTelegramMessage(
    message.chat.id,
    updated[0]
      ? "Вход на сайте отменён."
      : "Запрос уже использован, отменён или истёк.",
    {
      reply_markup: await mainKeyboardForChat(message.chat.id),
    },
  );
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

  const browserPairingHandled =
    await handleBrowserPairingCode(message, code);

  if (browserPairingHandled) {
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
        : "Код не найден или срок действия истёк. Получите новый код на сайте.",
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
    orderId: linkToken.order_id,
    redirectPath: "/account",
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

  if (payload.startsWith("pair_")) {
    const handled = await handleBrowserPairingToken(
      message,
      payload,
    );
    if (handled) return;
  }

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
        orderId: null,
        redirectPath: "/account",
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

type PublicCatalogCategory = {
  id: string;
  slug: string;
  name: string;
  publicCount: number;
  isActive: boolean;
};

async function fetchPublicCatalogCategories(): Promise<PublicCatalogCategory[]> {
  const response = await fetch(`${INTERNAL_API_URL}/api/public/categories`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`public categories returned HTTP ${response.status}`);
  }

  const payload = await response.json() as unknown;
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const items = Array.isArray(record.items) ? record.items : [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const row = item as Record<string, unknown>;
    const id = valueToText(row.id);
    const slug = valueToText(row.slug);
    const name = valueToText(row.name);
    const publicCount = Number(row.publicCount || 0);
    const isActive = row.isActive === true;

    if (!id || !slug || !name || !isActive || publicCount < 1) {
      return [];
    }

    return [{ id, slug, name, publicCount, isActive }];
  }).slice(0, 24);
}

async function handleCatalog(chatId: number, messageId?: number) {
  let categories: PublicCatalogCategory[] = [];

  try {
    categories = await fetchPublicCatalogCategories();
  } catch (error) {
    console.error("[bot-worker] public categories fetch failed", error);
    await sendTelegramMessage(
      chatId,
      "Каталог временно недоступен. Попробуйте позже.",
    );
    return;
  }

  if (categories.length === 0) {
    await sendTelegramMessage(chatId, "Каталог пока наполняется.");
    return;
  }

  const categoryButtons = categories.map((category) => ({
    text: category.name,
    callback_data: `cat:${category.id}`,
  }));

  const rows: TelegramInlineKeyboardButton[][] = [
    ...chunkRows(categoryButtons, 2),
    [{ text: "🌐 Открыть каталог на сайте", url: buildCatalogUrl() }],
    [{ text: "❌ Скрыть", callback_data: "msg:delete" }],
  ];

  await sendOrEditTelegramMessage(
    chatId,
    [
      "🛍 Каталог",
      "",
      "Показаны только актуальные разделы с доступными товарами.",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard(rows),
    },
    messageId,
  );
}

async function handleCatalogCategory(
  chatId: number,
  categoryId: string,
  messageId?: number,
  callbackQueryId?: string,
) {
  let categories: PublicCatalogCategory[] = [];

  try {
    categories = await fetchPublicCatalogCategories();
  } catch (error) {
    console.error("[bot-worker] category validation failed", error);
    if (callbackQueryId) {
      await answerCallbackQuery(callbackQueryId, "Каталог временно недоступен");
    }
    await sendTelegramMessage(
      chatId,
      "Каталог временно недоступен. Попробуйте позже.",
    );
    return;
  }

  const category = categories.find((item) => item.id === categoryId);

  if (!category) {
    if (callbackQueryId) {
      await answerCallbackQuery(
        callbackQueryId,
        "Раздел больше недоступен. Каталог обновлён.",
      );
    }
    await handleCatalog(chatId, messageId);
    return;
  }

  if (callbackQueryId) {
    await answerCallbackQuery(callbackQueryId);
  }

  const shopId = await getDefaultShopId();

  if (!shopId) {
    await sendTelegramMessage(chatId, "Каталог временно недоступен. Попробуйте позже.");
    return;
  }

  const productRows = await sql<{
    id: string;
    name: string;
    slug: string;
    price: number;
    short_description: string | null;
  }[]>`
    SELECT p.id, p.name, p.slug, p.price, p.short_description
    FROM products p
    INNER JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
      AND c.is_active = true
    WHERE p.shop_id = ${shopId}
      AND p.category_id = ${category.id}
      AND p.status = 'active'
      AND COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
          THEN 'available'
          ELSE 'unavailable'
        END
      ) = 'available'
    ORDER BY p.sort_order ASC, p.created_at DESC
    LIMIT 20
  `;

  if (productRows.length === 0) {
    await sendTelegramMessage(
      chatId,
      "Раздел больше не содержит доступных товаров. Каталог обновлён.",
    );
    await handleCatalog(chatId, messageId);
    return;
  }

  const productButtons = productRows.map((product) => ({
    text: `${product.name} · ${money(product.price)}`,
    callback_data: `prod:${product.id}`,
  }));

  const rows: TelegramInlineKeyboardButton[][] = [
    ...chunkRows(productButtons, 1),
    [
      { text: "⬅️ К разделам", callback_data: "catalog" },
      { text: "🌐 На сайте", url: buildCatalogUrl(`?category=${category.slug}`) },
    ],
    [{ text: "❌ Скрыть", callback_data: "msg:delete" }],
  ];

  await sendOrEditTelegramMessage(
    chatId,
    [
      `🛍 ${category.name}`,
      "",
      "Выберите товар, чтобы открыть карточку:",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard(rows),
    },
    messageId,
  );
}


async function handleProductCard(
  chatId: number,
  productId: string,
  callbackQueryId?: string,
) {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    if (callbackQueryId) {
      await answerCallbackQuery(callbackQueryId, "Каталог временно недоступен");
    }
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
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
      AND c.is_active = true
      AND LOWER(c.slug) NOT IN (
        'podpiska-na-cvety',
        'podpiska-na-tsvety',
        'subscription'
      )
      AND LOWER(BTRIM(c.name)) <> LOWER('Подписка на цветы')
    LEFT JOIN LATERAL (
      SELECT url
      FROM product_images
      WHERE product_id = p.id
        AND shop_id = p.shop_id
      ORDER BY is_main DESC, sort_order ASC, created_at ASC
      LIMIT 1
    ) pi ON true
    WHERE p.shop_id = ${shopId}
      AND p.id = ${productId}
      AND p.status = 'active'
      AND (
        p.category_id IS NULL
        OR c.id IS NOT NULL
      )
      AND COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
          THEN 'available'
          ELSE 'unavailable'
        END
      ) = 'available'
    LIMIT 1
  `;

  const product = productRows[0];

  if (!product) {
    if (callbackQueryId) {
      await answerCallbackQuery(
        callbackQueryId,
        "Товар больше недоступен. Каталог обновлён.",
      );
    }
    await handleCatalog(chatId);
    return;
  }

  if (callbackQueryId) {
    await answerCallbackQuery(callbackQueryId);
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
    description,
  ].filter(Boolean);

  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "🧺 Добавить в корзину", callback_data: `cart:add:${product.id}` }],
    [{ text: "🌐 Открыть на сайте", url: buildProductUrl(product.slug) }],
    [
      product.category_id
        ? { text: "⬅️ Назад к товарам", callback_data: `cat:${product.category_id}` }
        : { text: "⬅️ К разделам", callback_data: "catalog" },
      { text: "🛍 Каталог", callback_data: "catalog" },
    ],
    [{ text: "❌ Скрыть карточку", callback_data: "msg:delete" }],
  ];

  const replyMarkup = inlineKeyboard(rows);
  const imageUrl = absoluteUrl(product.image_url);

  if (imageUrl) {
    await sendTelegramPhoto(chatId, imageUrl, lines.join("\n"), {
      reply_markup: replyMarkup,
    });
    return;
  }

  await sendTelegramMessage(chatId, lines.join("\n"), {
    reply_markup: replyMarkup,
  });
}


type TelegramCartRow = {
  product_id: string;
  quantity: number;
  name: string;
  slug: string;
  price: number;
  availability: "available" | "preorder";
};

const MAX_TELEGRAM_CART_QUANTITY = 99;

type BotCartSqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[],
  >(
    strings: TemplateStringsArray,
    ...parameters: any[]
  ): PromiseLike<T>;
};

function telegramCartOperationKey(
  chatId: number,
  operationId: string,
) {
  const digest = createHash("sha256")
    .update(`${chatId}:${operationId}`)
    .digest("hex");

  return `telegram-cart:${chatId}:${digest}`;
}

async function claimTelegramCartMutation(
  transaction: BotCartSqlExecutor,
  params: {
    shopId: string;
    chatId: number;
    operationId: string;
    action: string;
    productId?: string;
  },
) {
  const customers = await transaction<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${params.shopId}
      AND telegram_id = ${String(params.chatId)}
      AND is_active = true
    ORDER BY linked_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `;
  const customerId = customers[0]?.customer_id ?? null;
  const rows = await transaction<{ id: string }[]>`
    INSERT INTO domain_events (
      shop_id,
      aggregate_type,
      aggregate_id,
      event_type,
      event_version,
      actor_type,
      actor_customer_id,
      idempotency_key,
      payload,
      occurred_at,
      created_at,
      updated_at
    )
    VALUES (
      ${params.shopId},
      'commerce_cart',
      ${customerId},
      'customer.cart.mutated',
      1,
      ${customerId ? "customer" : "telegram"},
      ${customerId},
      ${telegramCartOperationKey(params.chatId, params.operationId)},
      ${JSON.stringify({
        source: "telegram",
        action: params.action,
        telegramChatId: String(params.chatId),
        productId: params.productId ?? null,
      })}::jsonb,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, idempotency_key)
    DO NOTHING
    RETURNING id
  `;

  return rows.length === 1;
}

async function loadEligibleTelegramProduct(
  transaction: BotCartSqlExecutor,
  shopId: string,
  productId: string,
) {
  const rows = await transaction<{
    id: string;
    name: string;
    availability: "available" | "preorder";
  }[]>`
    SELECT
      p.id,
      p.name,
      COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) AS availability
    FROM products p
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
    WHERE p.shop_id = ${shopId}
      AND p.id = ${productId}
      AND p.status = 'active'
      AND (
        p.category_id IS NULL
        OR c.is_active = true
      )
      AND COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) IN ('available', 'preorder')
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function sanitizeTelegramCart(chatId: number) {
  const shopId = await getDefaultShopId();

  if (!shopId) return [] as string[];

  const invalid = await sql<{ product_id: string; name: string }[]>`
    SELECT tci.product_id, p.name
    FROM telegram_cart_items tci
    INNER JOIN products p
      ON p.id = tci.product_id
      AND p.shop_id = tci.shop_id
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
    WHERE tci.shop_id = ${shopId}
      AND tci.telegram_chat_id = ${chatId}
      AND (
        p.status <> 'active'
        OR (
          p.category_id IS NOT NULL
          AND COALESCE(c.is_active, false) = false
        )
        OR COALESCE(
          NULLIF(p.metadata #>> '{catalog,availability}', ''),
          CASE
            WHEN COALESCE(p.stock_quantity, 0) > 0
              THEN 'available'
            ELSE 'unavailable'
          END
        ) NOT IN ('available', 'preorder')
      )
  `;

  if (invalid.length > 0) {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
        AND product_id = ANY(${invalid.map((row) => row.product_id)}::uuid[])
    `;
  }

  await sql`
    UPDATE telegram_cart_items
    SET quantity = ${MAX_TELEGRAM_CART_QUANTITY},
        updated_at = NOW()
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
      AND quantity > ${MAX_TELEGRAM_CART_QUANTITY}
  `;

  return invalid.map((row) => row.name);
}

async function addProductToTelegramCart(
  chatId: number,
  productId: string,
  operationId: string = randomUUID(),
) {
  const shopId = await getDefaultShopId();

  if (!shopId) return null;

  return sql.begin(async (transaction) => {
    const claimed = await claimTelegramCartMutation(transaction, {
      shopId,
      chatId,
      operationId,
      action: "increment",
      productId,
    });

    if (!claimed) {
      const existing = await transaction<{
        quantity: number;
        name: string;
      }[]>`
        SELECT tci.quantity, p.name
        FROM telegram_cart_items tci
        INNER JOIN products p ON p.id = tci.product_id
        WHERE tci.shop_id = ${shopId}
          AND tci.telegram_chat_id = ${chatId}
          AND tci.product_id = ${productId}
        LIMIT 1
      `;

      return existing[0]
        ? {
            name: existing[0].name,
            quantity: existing[0].quantity,
            reused: true,
          }
        : null;
    }

    const product = await loadEligibleTelegramProduct(
      transaction,
      shopId,
      productId,
    );

    if (!product) {
      await transaction`
        DELETE FROM telegram_cart_items
        WHERE shop_id = ${shopId}
          AND telegram_chat_id = ${chatId}
          AND product_id = ${productId}
      `;
      return null;
    }

    const rows = await transaction<{ quantity: number }[]>`
      INSERT INTO telegram_cart_items (
        shop_id,
        telegram_chat_id,
        product_id,
        quantity,
        created_at,
        updated_at
      )
      VALUES (${shopId}, ${chatId}, ${product.id}, 1, NOW(), NOW())
      ON CONFLICT (shop_id, telegram_chat_id, product_id)
      DO UPDATE SET
        quantity = LEAST(
          ${MAX_TELEGRAM_CART_QUANTITY},
          telegram_cart_items.quantity + 1
        ),
        updated_at = NOW()
      RETURNING quantity
    `;

    return {
      name: product.name,
      quantity: rows[0]?.quantity || 1,
      reused: false,
    };
  });
}

async function decreaseProductInTelegramCart(
  chatId: number,
  productId: string,
  operationId: string = randomUUID(),
) {
  const shopId = await getDefaultShopId();

  if (!shopId) return;

  await sql.begin(async (transaction) => {
    const claimed = await claimTelegramCartMutation(transaction, {
      shopId,
      chatId,
      operationId,
      action: "decrement",
      productId,
    });

    if (!claimed) return;

    const updated = await transaction<{ quantity: number }[]>`
      UPDATE telegram_cart_items
      SET quantity = quantity - 1,
          updated_at = NOW()
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
        AND product_id = ${productId}
        AND quantity > 1
      RETURNING quantity
    `;

    if (updated.length === 0) {
      await transaction`
        DELETE FROM telegram_cart_items
        WHERE shop_id = ${shopId}
          AND telegram_chat_id = ${chatId}
          AND product_id = ${productId}
      `;
    }
  });
}

async function removeProductFromTelegramCart(
  chatId: number,
  productId: string,
  operationId: string = randomUUID(),
) {
  const shopId = await getDefaultShopId();

  if (!shopId) return;

  await sql.begin(async (transaction) => {
    const claimed = await claimTelegramCartMutation(transaction, {
      shopId,
      chatId,
      operationId,
      action: "remove",
      productId,
    });

    if (!claimed) return;

    await transaction`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
        AND product_id = ${productId}
    `;
  });
}

async function clearTelegramCart(
  chatId: number,
  operationId: string = randomUUID(),
) {
  const shopId = await getDefaultShopId();

  if (!shopId) return;

  await sql.begin(async (transaction) => {
    const claimed = await claimTelegramCartMutation(transaction, {
      shopId,
      chatId,
      operationId,
      action: "clear",
    });

    if (!claimed) return;

    await transaction`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
    `;
  });
}

async function getTelegramCartRows(chatId: number): Promise<TelegramCartRow[]> {
  const shopId = await getDefaultShopId();

  if (!shopId) return [];

  const rows = await sql<TelegramCartRow[]>`
    SELECT
      tci.product_id,
      LEAST(${MAX_TELEGRAM_CART_QUANTITY}, tci.quantity)::int AS quantity,
      p.name,
      p.slug,
      p.price,
      COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) AS availability
    FROM telegram_cart_items tci
    INNER JOIN products p
      ON p.id = tci.product_id
      AND p.shop_id = tci.shop_id
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
    WHERE tci.shop_id = ${shopId}
      AND tci.telegram_chat_id = ${chatId}
      AND p.status = 'active'
      AND (
        p.category_id IS NULL
        OR c.is_active = true
      )
      AND COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) IN ('available', 'preorder')
    ORDER BY tci.created_at ASC, tci.id ASC
  `;

  return rows;
}

async function handleCart(chatId: number, messageId?: number) {
  const removedNames = await sanitizeTelegramCart(chatId);
  const rows = await getTelegramCartRows(chatId);

  if (rows.length === 0) {
    const removedText = removedNames.length > 0
      ? `\n\nНедоступные позиции удалены: ${removedNames.join(", ")}.`
      : "";

    await sendOrEditTelegramMessage(
      chatId,
      [
        "🧺 Корзина",
        "",
        `Корзина пока пустая.${removedText}`,
        "Откройте каталог и добавьте букет прямо в боте.",
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "🛍 Перейти в каталог", callback_data: "catalog" }],
          [{ text: "❌ Скрыть", callback_data: "msg:delete" }],
        ]),
      },
      messageId,
    );
    return;
  }

  let total = 0;
  const lines = ["🧺 Корзина", ""];
  const buttons: TelegramInlineKeyboardButton[][] = [];

  if (removedNames.length > 0) {
    lines.push(`Удалены недоступные позиции: ${removedNames.join(", ")}.`);
    lines.push("");
  }

  rows.forEach((item, index) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    total += itemTotal;

    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`   ${item.quantity} × ${money(item.price)} = ${money(itemTotal)}`);
    if (item.availability === "preorder") {
      lines.push("   Доступно по предварительному заказу");
    }
    lines.push("");

    buttons.push([
      { text: "➖", callback_data: `cart:dec:${item.product_id}` },
      { text: `${item.quantity} шт.`, callback_data: "cart:noop" },
      { text: "➕", callback_data: `cart:inc:${item.product_id}` },
      { text: "❌", callback_data: `cart:remove:${item.product_id}` },
    ]);
  });

  lines.push(`Итого: ${money(total)}`);
  lines.push("");
  lines.push("Корзина сохраняется и синхронизируется с сайтом после входа через Telegram.");

  buttons.push([
    { text: "🛍 Продолжить покупки", callback_data: "catalog" },
    { text: "🧹 Очистить", callback_data: "cart:clear" },
  ]);
  buttons.push([{ text: "✅ Оформить заказ", callback_data: "checkout:start" }]);
  buttons.push([{ text: "🌐 Открыть корзину на сайте", callback_data: "cart:site" }]);
  buttons.push([{ text: "❌ Скрыть", callback_data: "msg:delete" }]);

  await sendOrEditTelegramMessage(
    chatId,
    lines.join("\n"),
    {
      reply_markup: inlineKeyboard(buttons),
    },
    messageId,
  );
}


type TelegramCheckoutStep = TelegramCheckoutDraftStep;
type TelegramPaymentMethod = TelegramCheckoutDraftPaymentMethod;
type TelegramCheckoutData = TelegramCheckoutDraftData;

type TelegramCheckoutSession = {
  step: TelegramCheckoutStep;
  data: TelegramCheckoutData;
};

type TelegramDeliveryZone = {
  id: string;
  name: string;
  price: number;
  free_from_amount: number | null;
  is_express_available: boolean;
  express_price: number | null;
};

type TelegramDeliveryInterval = {
  id: string;
  name: string;
};

type TelegramSavedAddress = {
  id: string;
  city: string | null;
  street: string | null;
  house: string | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  comment: string | null;
  is_default: boolean;
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

type TelegramCheckoutQuoteResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  currentRevision?: number;
  draft?: {
    step?: TelegramCheckoutStep;
    data?: TelegramCheckoutData;
    revision?: number;
  };
};

function safeCheckoutData(value: unknown): TelegramCheckoutData {
  return normalizeTelegramCheckoutDraftData(value);
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

function parseDeliveryDateInput(value: string): Date | null {
  const text = value.trim();
  const ruMatch = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);

  if (ruMatch) {
    const day = Number(ruMatch[1]);
    const month = Number(ruMatch[2]);
    const rawYear = Number(ruMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));

    if (
      date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
    ) {
      return date;
    }
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));

    if (
      date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
    ) {
      return date;
    }
  }

  return null;
}

function deliveryDateIso(value: string): string | null {
  return parseDeliveryDateInput(value)?.toISOString().slice(0, 10) || null;
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

function compactCheckoutLines(
  values: Array<string | null | undefined | false>,
) {
  return values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function telegramPaymentLabel(value: TelegramPaymentMethod | undefined) {
  if (value === "cash_on_delivery") return "При получении";
  if (value === "online_card") return "Онлайн картой";
  if (value === "sbp") return "СБП";
  return "Перевод после подтверждения";
}

function telegramContactPreferenceLabel(value: TelegramCheckoutData["contactPreference"]) {
  if (value === "phone_call") return "Позвонить покупателю";
  if (value === "messenger_only") return "Только сообщение";
  return "Звонок или сообщение";
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
    SELECT
      id,
      name,
      price,
      free_from_amount,
      is_express_available,
      express_price
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

async function getTelegramSavedAddresses(chatId: number): Promise<TelegramSavedAddress[]> {
  const shopId = await getDefaultShopId();
  if (!shopId) return [];

  return sql<TelegramSavedAddress[]>`
    SELECT
      address.id,
      address.city,
      address.street,
      address.house,
      address.apartment,
      address.entrance,
      address.floor,
      address.comment,
      address.is_default
    FROM telegram_accounts account
    JOIN customer_addresses address
      ON address.shop_id = account.shop_id
     AND address.customer_id = account.customer_id
    WHERE account.shop_id = ${shopId}
      AND account.telegram_id = ${String(chatId)}
      AND account.customer_id IS NOT NULL
      AND account.is_active = true
    ORDER BY address.is_default DESC, address.updated_at DESC, address.id DESC
    LIMIT 12
  `;
}

async function getTelegramBonusBalance(chatId: number) {
  const shopId = await getDefaultShopId();
  if (!shopId) return 0;

  const rows = await sql<{ bonus_balance: number }[]>`
    SELECT customer.bonus_balance
    FROM telegram_accounts account
    JOIN customers customer
      ON customer.shop_id = account.shop_id
     AND customer.id = account.customer_id
    WHERE account.shop_id = ${shopId}
      AND account.telegram_id = ${String(chatId)}
      AND account.customer_id IS NOT NULL
      AND account.is_active = true
    ORDER BY account.linked_at DESC, account.updated_at DESC
    LIMIT 1
  `;

  return Math.max(0, Math.floor(Number(rows[0]?.bonus_balance || 0)));
}

async function getTelegramCustomerDefaults(chatId: number) {
  const shopId = await getDefaultShopId();
  if (!shopId) return null;

  const rows = await sql<{
    name: string | null;
    phone: string | null;
    email: string | null;
  }[]>`
    SELECT customer.name, customer.phone, customer.email
    FROM telegram_accounts account
    JOIN customers customer
      ON customer.shop_id = account.shop_id
     AND customer.id = account.customer_id
    WHERE account.shop_id = ${shopId}
      AND account.telegram_id = ${String(chatId)}
      AND account.customer_id IS NOT NULL
      AND account.is_active = true
    ORDER BY account.linked_at DESC, account.updated_at DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

function formatSavedAddress(address: TelegramSavedAddress) {
  const first = [address.city, address.street, address.house]
    .filter(Boolean)
    .join(", ");
  const details = [
    address.apartment ? `кв. ${address.apartment}` : "",
    address.entrance ? `подъезд ${address.entrance}` : "",
    address.floor ? `этаж ${address.floor}` : "",
  ].filter(Boolean).join(", ");

  return [first, details].filter(Boolean).join(", ").slice(0, 1000);
}

function shortSavedAddress(address: TelegramSavedAddress) {
  const value = formatSavedAddress(address) || "Сохранённый адрес";
  return `${address.is_default ? "⭐ " : "📍 "}${value}`.slice(0, 54);
}

function checkoutNavigationRows(step: TelegramCheckoutStep) {
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (step !== "customer_name") {
    rows.push([{ text: "⬅️ Назад", callback_data: "checkout:back" }]);
  }

  rows.push([{ text: "⏸ Продолжить позже", callback_data: "checkout:later" }]);
  rows.push([{ text: "❌ Отменить оформление", callback_data: "checkout:cancel" }]);
  return rows;
}

async function sendCheckoutStepMessage(
  chatId: number,
  step: TelegramCheckoutStep,
  lines: string[],
  rows: TelegramInlineKeyboardButton[][] = [],
) {
  const progress = telegramCheckoutProgress(step);

  await sendTelegramMessage(
    chatId,
    [progress.text, "", ...lines].join("\n"),
    {
      reply_markup: inlineKeyboard([
        ...rows,
        ...checkoutNavigationRows(step),
      ]),
    },
  );
}

function checkoutPhoneKeyboard() {
  return {
    keyboard: [
      [{ text: "📱 Поделиться номером", request_contact: true }],
      [{ text: "⬅️ Назад" }, { text: "⏸ Продолжить позже" }],
      [{ text: "❌ Отменить заказ" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    is_persistent: false,
    input_field_placeholder: "+7 999 123-45-67",
  };
}

async function restoreCheckoutMainKeyboard(chatId: number) {
  await sendTelegramMessage(chatId, "Основное меню снова закреплено внизу.", {
    reply_markup: await mainKeyboardForChat(chatId),
  });
}

async function getCheckoutSession(chatId: number): Promise<TelegramCheckoutSession | null> {
  const shopId = await getDefaultShopId();
  if (!shopId) return null;

  const rows = await sql<{
    step: TelegramCheckoutStep;
    data: unknown;
    created_at: string;
    updated_at: string;
  }[]>`
    SELECT
      step,
      data,
      created_at::text,
      updated_at::text
    FROM telegram_checkout_sessions
    WHERE shop_id = ${shopId}
      AND telegram_chat_id = ${chatId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const data = normalizeTelegramCheckoutDraftData(row.data, {
    telegramChatId: String(chatId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  if (telegramCheckoutDraftExpired(data)) {
    await sql`
      DELETE FROM telegram_checkout_sessions
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
    `;
    return null;
  }

  return { step: row.step, data };
}

async function setCheckoutSession(
  chatId: number,
  step: TelegramCheckoutStep,
  data: TelegramCheckoutData,
  operationId: string = randomUUID(),
) {
  const shopId = await getDefaultShopId();
  if (!shopId) return;

  await sql.begin(async (transaction) => {
    const existingRows = await transaction<{ data: unknown }[]>`
      SELECT data
      FROM telegram_checkout_sessions
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
      LIMIT 1
      FOR UPDATE
    `;
    const customerRows = await transaction<{ customer_id: string | null }[]>`
      SELECT customer_id
      FROM telegram_accounts
      WHERE shop_id = ${shopId}
        AND telegram_id = ${String(chatId)}
        AND is_active = true
      ORDER BY linked_at DESC, updated_at DESC, id DESC
      LIMIT 1
    `;
    const customerId = customerRows[0]?.customer_id ?? null;
    const prepared = prepareTelegramCheckoutDraftData({
      previous: existingRows[0]?.data,
      next: data,
      customerId,
      telegramChatId: String(chatId),
      operationId,
    });

    await transaction`
      INSERT INTO telegram_checkout_sessions (
        shop_id,
        telegram_chat_id,
        step,
        data,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        ${chatId},
        ${step},
        ${JSON.stringify(prepared)}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, telegram_chat_id)
      DO UPDATE SET
        step = EXCLUDED.step,
        data = EXCLUDED.data,
        updated_at = NOW()
    `;

    await transaction`
      INSERT INTO domain_events (
        shop_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_version,
        actor_type,
        actor_customer_id,
        idempotency_key,
        payload,
        occurred_at,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        'checkout_draft',
        ${customerId},
        'customer.checkout_draft.changed',
        1,
        ${customerId ? "customer" : "telegram"},
        ${customerId},
        ${`checkout-draft:${chatId}:${operationId}`},
        ${JSON.stringify({
          source: "telegram",
          action: "save",
          step,
          flowVersion: TELEGRAM_CHECKOUT_FLOW_VERSION,
          telegramChatId: String(chatId),
          revision: prepared._core?.revision || 0,
        })}::jsonb,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, idempotency_key)
      DO NOTHING
    `;
  });
}

async function clearCheckoutSession(
  chatId: number,
  operationId: string = randomUUID(),
  action: "cancel" | "converted" = "cancel",
) {
  const shopId = await getDefaultShopId();
  if (!shopId) return;

  await sql.begin(async (transaction) => {
    const customerRows = await transaction<{ customer_id: string | null }[]>`
      SELECT customer_id
      FROM telegram_accounts
      WHERE shop_id = ${shopId}
        AND telegram_id = ${String(chatId)}
        AND is_active = true
      ORDER BY linked_at DESC, updated_at DESC, id DESC
      LIMIT 1
    `;
    const customerId = customerRows[0]?.customer_id ?? null;

    await transaction`
      DELETE FROM telegram_checkout_sessions
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
    `;

    await transaction`
      INSERT INTO domain_events (
        shop_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_version,
        actor_type,
        actor_customer_id,
        idempotency_key,
        payload,
        occurred_at,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        'checkout_draft',
        ${customerId},
        'customer.checkout_draft.changed',
        1,
        ${customerId ? "customer" : "telegram"},
        ${customerId},
        ${`checkout-draft:${chatId}:${operationId}`},
        ${JSON.stringify({
          source: "telegram",
          action,
          telegramChatId: String(chatId),
        })}::jsonb,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, idempotency_key)
      DO NOTHING
    `;
  });
}

async function quoteTelegramCheckoutDraft(chatId: number) {
  const session = await getCheckoutSession(chatId);
  if (!session) throw new Error("Черновик оформления не найден");

  const response = await fetch(
    `${INTERNAL_API_URL}/api/public/internal/telegram/checkout-draft/quote`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vm-order-source": "telegram-bot",
        "x-vm-telegram-chat-id": String(chatId),
        "x-vm-internal-token": INTERNAL_ORDER_TOKEN,
        "user-agent": "viberimenya-telegram-bot/1.0",
      },
      body: JSON.stringify({
        operationId: `checkout-quote:${randomUUID()}`,
        ...(session.data._core?.revision === undefined
          ? {}
          : { expectedRevision: session.data._core.revision }),
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const payload = await response.json().catch(() => null) as TelegramCheckoutQuoteResponse | null;

  if (!response.ok || !payload?.ok || !payload.draft?.data) {
    if (payload?.code === "checkout_draft_conflict") {
      throw new Error("Черновик изменился на другом устройстве. Откройте итог ещё раз.");
    }

    throw new Error(payload?.message || `Не удалось рассчитать заказ: HTTP ${response.status}`);
  }

  return safeCheckoutData(payload.draft.data);
}

async function showCheckoutCustomerName(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "customer_name", data);
  await sendCheckoutStepMessage(
    chatId,
    "customer_name",
    compactCheckoutLines([
      "Введите имя покупателя.",
      data.customerName ? `Сейчас указано: ${data.customerName}` : "",
    ]),
  );
}

async function showCheckoutCustomerPhone(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "customer_phone", data);
  const progress = telegramCheckoutProgress("customer_phone");

  await sendTelegramMessage(
    chatId,
    [
      progress.text,
      "",
      "Введите ваш телефон или нажмите «📱 Поделиться номером».",
      data.customerPhone ? `Сейчас указано: ${data.customerPhone}` : "Например: +7 999 123-45-67",
    ].filter(Boolean).join("\n"),
    { reply_markup: checkoutPhoneKeyboard() },
  );
}

async function showCheckoutRecipientMode(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "recipient_mode", data);
  await sendCheckoutStepMessage(
    chatId,
    "recipient_mode",
    ["Кому доставить заказ?"],
    [
      [{ text: "🙋 Получатель — я", callback_data: "checkout:recipient:self" }],
      [{ text: "🎁 Другому человеку", callback_data: "checkout:recipient:other" }],
    ],
  );
}

async function showCheckoutRecipientName(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "recipient_name", data);
  await sendCheckoutStepMessage(chatId, "recipient_name", ["Введите имя получателя."]);
}

async function showCheckoutRecipientPhone(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "recipient_phone", data);
  await sendCheckoutStepMessage(
    chatId,
    "recipient_phone",
    ["Введите телефон получателя.", "Номер покупателя автоматически не подставляется для другого человека."],
  );
}

async function showCheckoutDeliveryType(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "🚚 Доставка", callback_data: "checkout:delivery:delivery" }],
  ];

  if (configuration.pickupEnabled) {
    rows.push([{ text: "🏬 Самовывоз", callback_data: "checkout:delivery:pickup" }]);
  }

  await setCheckoutSession(chatId, "delivery_type", data);
  await sendCheckoutStepMessage(chatId, "delivery_type", ["Выберите способ получения заказа."], rows);
}

async function showCheckoutDeliveryZones(chatId: number, data: TelegramCheckoutData) {
  const zones = await getTelegramDeliveryZones();

  if (zones.length === 0) {
    await sendCheckoutStepMessage(
      chatId,
      "delivery_zone",
      ["Сейчас нет доступных зон доставки. Выберите самовывоз или свяжитесь с менеджером."],
    );
    return;
  }

  const rows = zones.map((zone) => [{
    text: `${zone.name} · ${money(zone.price)}`,
    callback_data: `checkout:zone:${zone.id}`,
  }]);

  await setCheckoutSession(chatId, "delivery_zone", data);
  await sendCheckoutStepMessage(
    chatId,
    "delivery_zone",
    ["Выберите зону. Цена и бесплатный порог будут перепроверены сервером."],
    rows,
  );
}

async function showCheckoutDeliveryService(
  chatId: number,
  data: TelegramCheckoutData,
  zone?: TelegramDeliveryZone,
) {
  const selectedZone = zone || (await getTelegramDeliveryZones())
    .find((item) => item.id === data.deliveryZoneId);
  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "🚚 Стандартная доставка", callback_data: "checkout:delivery_service:standard" }],
  ];

  if (selectedZone?.is_express_available) {
    rows.push([{
      text: `⚡ Срочная доставка${selectedZone.express_price === null ? "" : ` · ${money(selectedZone.express_price)}`}`,
      callback_data: "checkout:delivery_service:express",
    }]);
  }

  await setCheckoutSession(chatId, "delivery_service", data);
  await sendCheckoutStepMessage(
    chatId,
    "delivery_service",
    ["Выберите скорость доставки."],
    rows,
  );
}

async function showCheckoutDate(chatId: number, data: TelegramCheckoutData) {
  const dates = telegramCheckoutDateChoices(moscowTodayIso(), 7);
  const rows = chunkRows(
    dates.map((item) => ({
      text: item.label,
      callback_data: `checkout:date:${item.iso}`,
    })),
    2,
  );
  rows.push([{ text: "📅 Ввести другую дату", callback_data: "checkout:date:manual" }]);

  await setCheckoutSession(chatId, "delivery_date", data);
  await sendCheckoutStepMessage(
    chatId,
    "delivery_date",
    ["Выберите ближайшую дату или введите другую вручную."],
    rows,
  );
}

async function showCheckoutIntervals(chatId: number, data: TelegramCheckoutData) {
  const intervals = await getTelegramDeliveryIntervals();

  if (intervals.length === 0) {
    await sendCheckoutStepMessage(
      chatId,
      "delivery_interval",
      ["Сейчас нет доступных интервалов доставки. Свяжитесь с менеджером."],
    );
    return;
  }

  const rows = intervals.map((interval) => [{
    text: `🕐 ${interval.name}`,
    callback_data: `checkout:interval:${interval.id}`,
  }]);

  await setCheckoutSession(chatId, "delivery_interval", data);
  await sendCheckoutStepMessage(chatId, "delivery_interval", ["Выберите доступный интервал."], rows);
}

async function showCheckoutAddress(chatId: number, data: TelegramCheckoutData) {
  const addresses = await getTelegramSavedAddresses(chatId);
  const rows: TelegramInlineKeyboardButton[][] = addresses.map((address) => [{
    text: shortSavedAddress(address),
    callback_data: `checkout:address:${address.id}`,
  }]);
  rows.push([{ text: "➕ Ввести новый адрес", callback_data: "checkout:address:new" }]);

  await setCheckoutSession(chatId, "delivery_address", data);
  await sendCheckoutStepMessage(
    chatId,
    "delivery_address",
    [addresses.length ? "Выберите сохранённый адрес или добавьте новый." : "Введите новый адрес доставки."],
    rows,
  );
}

async function showCheckoutCardText(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "card_text", data);
  await sendCheckoutStepMessage(
    chatId,
    "card_text",
    ["Введите текст открытки.", "Отправьте знак минус, если открытка не нужна."],
  );
}

async function showCheckoutSurprise(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "surprise", data);
  await sendCheckoutStepMessage(
    chatId,
    "surprise",
    ["Нужно ли сохранить доставку в секрете от получателя?"],
    [
      [{ text: "🎁 Сюрприз — не звонить", callback_data: "checkout:surprise:no_call" }],
      [{ text: "💬 Сюрприз — можно написать", callback_data: "checkout:surprise:message" }],
      [{ text: "🙂 Не сюрприз", callback_data: "checkout:surprise:no" }],
    ],
  );
}

async function showCheckoutContactPreference(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "contact_preference", data);
  await sendCheckoutStepMessage(
    chatId,
    "contact_preference",
    ["Как менеджеру лучше связаться с покупателем при уточнении?"],
    [
      [{ text: "☎️ Позвонить", callback_data: "checkout:contact:phone_call" }],
      [{ text: "💬 Только сообщение", callback_data: "checkout:contact:messenger_only" }],
      [{ text: "📲 Звонок или сообщение", callback_data: "checkout:contact:call_or_message" }],
    ],
  );
}

async function showCheckoutPaymentMethods(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (configuration.paymentMethods.transfer) {
    rows.push([{ text: "💳 Перевод после подтверждения", callback_data: "checkout:payment:transfer_after_confirm" }]);
  }
  if (configuration.paymentMethods.cash) {
    rows.push([{ text: "💵 При получении", callback_data: "checkout:payment:cash_on_delivery" }]);
  }
  if (configuration.paymentMethods.online) {
    rows.push([{ text: "🌐 Онлайн картой", callback_data: "checkout:payment:online_card" }]);
    rows.push([{ text: "⚡ СБП", callback_data: "checkout:payment:sbp" }]);
  }

  await setCheckoutSession(chatId, "payment_method", data);

  if (rows.length === 0) {
    await sendCheckoutStepMessage(chatId, "payment_method", ["Временно нет доступных способов оплаты."]);
    return;
  }

  await sendCheckoutStepMessage(chatId, "payment_method", ["Выберите способ оплаты."], rows);
}

async function showCheckoutPromoCode(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "promo_code", data);
  await sendCheckoutStepMessage(
    chatId,
    "promo_code",
    ["Введите промокод или отправьте знак минус."],
    [[{ text: "Пропустить промокод", callback_data: "checkout:promo:skip" }]],
  );
}

async function showCheckoutBonus(chatId: number, data: TelegramCheckoutData) {
  const balance = await getTelegramBonusBalance(chatId);
  await setCheckoutSession(chatId, "bonus", data);
  const rows: TelegramInlineKeyboardButton[][] = [
    [{ text: "Не списывать бонусы", callback_data: "checkout:bonus:0" }],
  ];

  if (balance > 0) {
    rows.push([{ text: `Списать все · ${balance}`, callback_data: "checkout:bonus:all" }]);
    rows.push([{ text: "Ввести другую сумму", callback_data: "checkout:bonus:manual" }]);
  }

  await sendCheckoutStepMessage(
    chatId,
    "bonus",
    [balance > 0 ? `Доступно бонусов: ${balance}.` : "На балансе пока нет бонусов."],
    rows,
  );
}

async function showCheckoutComment(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "comment", data);
  await sendCheckoutStepMessage(
    chatId,
    "comment",
    [
      "Добавьте комментарий: домофон, ориентир, пожелания к замене цветов.",
      "Отправьте знак минус, если комментария нет.",
    ],
  );
}

async function showCheckoutPrivacy(chatId: number, data: TelegramCheckoutData) {
  const configuration = await getTelegramCheckoutConfiguration();
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (configuration.policyUrl) {
    rows.push([{ text: "📄 Политика конфиденциальности", url: absoluteUrl(configuration.policyUrl) }]);
  }
  rows.push([{ text: "✅ Принимаю условия", callback_data: "checkout:privacy:accept" }]);

  await setCheckoutSession(chatId, "privacy", data);
  await sendCheckoutStepMessage(
    chatId,
    "privacy",
    ["Подтвердите согласие с правилами магазина и обработкой персональных данных."],
    rows,
  );
}

function checkoutEditRows() {
  return [
    [
      { text: "👤 Покупатель", callback_data: "checkout:edit:customer" },
      { text: "🎁 Получатель", callback_data: "checkout:edit:recipient" },
    ],
    [
      { text: "🚚 Доставка", callback_data: "checkout:edit:delivery" },
      { text: "💌 Пожелания", callback_data: "checkout:edit:wishes" },
    ],
    [
      { text: "💳 Оплата", callback_data: "checkout:edit:payment" },
      { text: "🏷 Скидка", callback_data: "checkout:edit:discount" },
    ],
    [{ text: "📝 Комментарий", callback_data: "checkout:edit:comment" }],
  ] satisfies TelegramInlineKeyboardButton[][];
}

async function showCheckoutConfirm(chatId: number, data: TelegramCheckoutData) {
  await setCheckoutSession(chatId, "confirm", data);

  let quoted: TelegramCheckoutData;
  try {
    quoted = await quoteTelegramCheckoutDraft(chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось рассчитать черновик";
    await sendCheckoutStepMessage(
      chatId,
      "confirm",
      [message, "Данные сохранены. Повторите расчёт или измените нужный раздел."],
      [
        [{ text: "🔄 Повторить расчёт", callback_data: "checkout:review" }],
        ...checkoutEditRows(),
      ],
    );
    return;
  }

  const quote = quoted._core?.quote;
  const issueLines = quote?.issues.map((issue) => (
    `${issue.severity === "error" ? "❌" : "⚠️"} ${issue.message}`
  )) || [];
  const deliveryLines = quoted.deliveryType === "pickup"
    ? [`Получение: самовывоз`, `Адрес: ${quoted.deliveryAddress || "уточняется"}`]
    : [
        `Получение: ${quoted.deliveryService === "express" ? "срочная доставка" : "доставка"}`,
        `Зона: ${quoted.deliveryZoneName || "—"}`,
        `Дата: ${quoted.deliveryDateText || "—"}`,
        `Интервал: ${quoted.deliveryInterval || "—"}`,
        `Адрес: ${quoted.deliveryAddress || "—"}`,
      ];
  const rows: TelegramInlineKeyboardButton[][] = [
    ...checkoutEditRows(),
    [{ text: "🌐 Продолжить на сайте", callback_data: "checkout:continue_site" }],
    [{ text: "✅ Данные верны", callback_data: "checkout:ready" }],
  ];

  await sendCheckoutStepMessage(
    chatId,
    "confirm",
    compactCheckoutLines([
      "📋 Итоговая проверка",
      "",
      `Покупатель: ${quoted.customerName || "—"}`,
      `Телефон: ${quoted.customerPhone || "—"}`,
      `Получатель: ${quoted.recipientName || quoted.customerName || "—"}`,
      `Телефон получателя: ${quoted.recipientPhone || quoted.customerPhone || "—"}`,
      ...deliveryLines,
      `Открытка: ${quoted.cardText || "нет"}`,
      `Сюрприз: ${quoted.isSurprise ? "да" : "нет"}`,
      `Связь: ${telegramContactPreferenceLabel(quoted.contactPreference)}`,
      `Оплата: ${telegramPaymentLabel(quoted.paymentMethod)}`,
      `Промокод: ${quoted.promoCode || "нет"}`,
      `Бонусы: ${quote?.bonusApplied || 0}`,
      quoted.comment ? `Комментарий: ${quoted.comment}` : "Комментарий: нет",
      "",
      quote ? `Товары: ${money(quote.subtotal)}` : "",
      quote ? `${quote.deliveryTariffName}: ${quote.deliveryPrice > 0 ? money(quote.deliveryPrice) : "бесплатно"}` : "",
      quote && quote.discountTotal > 0 ? `Скидка: −${money(quote.discountTotal)}` : "",
      quote && quote.bonusApplied > 0 ? `Бонусы: −${money(quote.bonusApplied)}` : "",
      quote ? `Итого: ${money(quote.total)}` : "",
      ...issueLines,
      "",
      quote?.readyForConfirmation
        ? "Все данные готовы. На этапе 17B-2C.1C эта кнопка создаст и зарезервирует заказ атомарно."
        : "Исправьте отмеченные пункты и повторите расчёт.",
    ]),
    rows,
  );
}

async function renderCheckoutStep(
  chatId: number,
  step: TelegramCheckoutStep,
  data: TelegramCheckoutData,
) {
  if (step === "customer_name") return showCheckoutCustomerName(chatId, data);
  if (step === "customer_phone") return showCheckoutCustomerPhone(chatId, data);
  if (step === "recipient_mode") return showCheckoutRecipientMode(chatId, data);
  if (step === "recipient_name") return showCheckoutRecipientName(chatId, data);
  if (step === "recipient_phone") return showCheckoutRecipientPhone(chatId, data);
  if (step === "delivery_type") return showCheckoutDeliveryType(chatId, data);
  if (step === "delivery_zone") return showCheckoutDeliveryZones(chatId, data);
  if (step === "delivery_service") return showCheckoutDeliveryService(chatId, data);
  if (step === "delivery_date") return showCheckoutDate(chatId, data);
  if (step === "delivery_interval") return showCheckoutIntervals(chatId, data);
  if (step === "delivery_address") return showCheckoutAddress(chatId, data);
  if (step === "card_text") return showCheckoutCardText(chatId, data);
  if (step === "surprise") return showCheckoutSurprise(chatId, data);
  if (step === "contact_preference") return showCheckoutContactPreference(chatId, data);
  if (step === "payment_method") return showCheckoutPaymentMethods(chatId, data);
  if (step === "promo_code") return showCheckoutPromoCode(chatId, data);
  if (step === "bonus") return showCheckoutBonus(chatId, data);
  if (step === "comment") return showCheckoutComment(chatId, data);
  if (step === "privacy") return showCheckoutPrivacy(chatId, data);
  return showCheckoutConfirm(chatId, data);
}

async function handleCheckoutStart(chatId: number) {
  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    await handleCart(chatId);
    return;
  }

  const existing = await getCheckoutSession(chatId);
  if (existing) {
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  const defaults = await getTelegramCustomerDefaults(chatId);
  const data: TelegramCheckoutData = {
    clientRequestId: randomUUID(),
    ...(defaults?.name ? { customerName: defaults.name } : {}),
    ...(defaults?.phone ? { customerPhone: defaults.phone } : {}),
    ...(defaults?.email ? { customerEmail: defaults.email } : {}),
    privacyAccepted: false,
    deliveryService: "standard",
    contactPreference: "call_or_message",
    bonusToSpend: 0,
  };

  await showCheckoutCustomerName(chatId, safeCheckoutData(data));
}

async function resumeCheckout(chatId: number) {
  const session = await getCheckoutSession(chatId);

  if (!session) {
    await sendTelegramMessage(chatId, "Незавершённое оформление не найдено. Откройте корзину и начните заново.");
    return;
  }

  await renderCheckoutStep(chatId, session.step, safeCheckoutData(session.data));
}

async function sendCheckoutResumePrompt(chatId: number) {
  const session = await getCheckoutSession(chatId);
  if (!session) return;
  const progress = telegramCheckoutProgress(session.step);

  await sendTelegramMessage(
    chatId,
    [
      "Черновик оформления сохранён.",
      "Срок хранения — 24 часа.",
      `Остановились: ${progress.text}.`,
      "Можно продолжить в Telegram или открыть общую корзину на сайте.",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [{ text: "▶️ Продолжить оформление", callback_data: "checkout:resume" }],
        [{ text: "🌐 Продолжить на сайте", callback_data: "checkout:continue_site" }],
        [{ text: "🔄 Заполнить заново", callback_data: "checkout:restart" }],
        [{ text: "❌ Отменить оформление", callback_data: "checkout:cancel" }],
      ]),
    },
  );
}

async function handleCustomerLinkEntry(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      "Telegram уже привязан к вашему профилю покупателя.",
      {
        reply_markup: inlineKeyboard([
          [{ text: "👤 Открыть профиль", callback_data: "menu:profile" }],
        ]),
      },
    );
    return;
  }

  await sendTelegramMessage(chatId, customerLinkInstructions());
}

async function showCustomerMoreMenu(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));
  const rows: TelegramInlineKeyboardButton[][] = [
    [
      { text: CUSTOMER_MENU_TEXT.addresses, callback_data: "menu:addresses" },
      { text: CUSTOMER_MENU_TEXT.favorites, callback_data: "menu:favorites" },
    ],
    [{ text: CUSTOMER_MENU_TEXT.support, callback_data: "menu:support" }],
  ];

  if (!profile?.customer_id) {
    rows.push([{
      text: CUSTOMER_MENU_TEXT.link,
      callback_data: "menu:link",
    }]);
  } else {
    rows.push([{
      text: "👤 Управление профилем",
      callback_data: "menu:profile",
    }]);
  }

  rows.push([{ text: "❌ Скрыть", callback_data: "msg:delete" }]);

  await sendTelegramMessage(
    chatId,
    "Дополнительные разделы:",
    { reply_markup: inlineKeyboard(rows) },
  );
}

async function handleCustomerMenuCommand(
  message: TelegramMessage,
  text: string,
): Promise<boolean> {
  if (!isCustomerMenuCommand(text)) return false;

  const chatId = message.chat.id;
  const hadCheckout = Boolean(await getCheckoutSession(chatId));

  if (text === "/menu") {
    await handleOpenMenu(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.catalog) {
    await handleCatalog(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.cart) {
    await handleCart(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.orders || text === "📦 Заказы") {
    await handleOrders(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.profile) {
    await handleCustomerProfile(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.bonuses) {
    await handleBonuses(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.more) {
    await showCustomerMoreMenu(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.addresses) {
    await handleAddresses(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.favorites) {
    await handleFavorites(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.support || text === "☎️ Связь") {
    await handleContact(chatId);
  } else if (text === CUSTOMER_MENU_TEXT.link) {
    await handleCustomerLinkEntry(chatId);
  }

  if (hadCheckout) {
    await sendCheckoutResumePrompt(chatId);
  }

  return true;
}

async function handleCheckoutBack(chatId: number) {
  const session = await getCheckoutSession(chatId);
  if (!session) {
    await sendTelegramMessage(chatId, "Черновик оформления не найден.");
    return;
  }

  const previous = telegramCheckoutPreviousStep(session.step, session.data);
  if (!previous) {
    await renderCheckoutStep(chatId, session.step, session.data);
    return;
  }

  await renderCheckoutStep(chatId, previous, safeCheckoutData(session.data));
}

async function handleCheckoutContinueSite(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      "Чтобы продолжить этот же черновик на сайте, сначала привяжите Telegram к профилю покупателя.",
      {
        reply_markup: inlineKeyboard([
          [{ text: "🔗 Привязать профиль", callback_data: "menu:link" }],
          [{ text: "▶️ Продолжить в Telegram", callback_data: "checkout:resume" }],
        ]),
      },
    );
    return;
  }

  const url = await createCustomerMagicLoginUrl({
    shopId: profile.shop_id,
    customerId: profile.customer_id,
    orderId: null,
    redirectPath: "/cart?checkout=resume",
  });

  await sendTelegramMessage(
    chatId,
    "Откройте общую корзину на сайте. Вход выполнится автоматически, ссылка действует 10 минут, черновик останется сохранён.",
    {
      reply_markup: inlineKeyboard([
        [{ text: "🌐 Открыть на сайте", url }],
        [{ text: "▶️ Остаться в Telegram", callback_data: "checkout:resume" }],
      ]),
    },
  );
}

async function finalizeTelegramOrder(
  chatId: number,
  session: TelegramCheckoutSession,
): Promise<TelegramFinalizedOrder> {
  const cartRows = await getTelegramCartRows(chatId);
  const body = buildTelegramOrderCreateBody(session.data, cartRows);
  const response = await fetch(`${INTERNAL_API_URL}/api/public/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vm-order-source": "telegram-bot",
      "x-vm-telegram-chat-id": String(chatId),
      "x-vm-internal-token": INTERNAL_ORDER_TOKEN,
      "user-agent": "viberimenya-telegram-bot/1.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    throw readTelegramOrderError(payload, response.status);
  }

  return readTelegramFinalizedOrder(payload);
}

async function completeTelegramCheckout(
  chatId: number,
  session: TelegramCheckoutSession,
  order: TelegramFinalizedOrder,
) {
  const shopId = await getDefaultShopId();
  if (!shopId) throw new Error("Магазин не найден");

  const customerRows = await sql<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${shopId}
      AND telegram_id = ${String(chatId)}
      AND is_active = true
    ORDER BY linked_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `;
  const customerId = customerRows[0]?.customer_id ?? null;
  const clientRequestId = session.data.clientRequestId || order.id;

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO domain_events (
        shop_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_version,
        actor_type,
        actor_customer_id,
        correlation_id,
        idempotency_key,
        payload,
        occurred_at,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        'order',
        ${order.id}::uuid,
        'customer.checkout_draft.converted',
        1,
        ${customerId ? "customer" : "telegram"},
        ${customerId},
        ${order.id}::uuid,
        ${`checkout-finalized:${chatId}:${clientRequestId}`},
        ${JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          clientRequestId,
          telegramChatId: String(chatId),
          reused: order.reused,
          source: "telegram",
        })}::jsonb,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, idempotency_key)
      DO NOTHING
    `;

    await transaction`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
    `;

    await transaction`
      DELETE FROM telegram_checkout_sessions
      WHERE shop_id = ${shopId}
        AND telegram_chat_id = ${chatId}
    `;
  });
}

async function handleCheckoutReady(chatId: number) {
  if (!TELEGRAM_CHECKOUT_FLOW_CREATES_ORDER) {
    throw new Error("Атомарная финализация заказа отключена");
  }

  const session = await getCheckoutSession(chatId);
  const quote = session?.data._core?.quote;

  if (!session || session.step !== "confirm" || !quote?.readyForConfirmation) {
    await sendTelegramMessage(chatId, "Сначала завершите проверку данных и устраните замечания.");
    if (session) await showCheckoutConfirm(chatId, session.data);
    return;
  }

  await sendTelegramMessage(chatId, "⏳ Ещё раз проверяем цены, остатки, доставку, промокод и бонусы…");

  try {
    const order = await finalizeTelegramOrder(chatId, session);
    await completeTelegramCheckout(chatId, session, order);

    await sendTelegramMessage(
      chatId,
      [
        order.reused ? "✅ Заказ уже был создан ранее." : "✅ Заказ успешно создан.",
        "",
        `Номер: ${order.orderNumber}`,
        `Сумма: ${money(order.totalAmount)}`,
        `Доставка: ${order.deliveryTariffName}`,
        order.discountTotal > 0 ? `Скидка: ${money(order.discountTotal)}` : "",
        order.bonusSpent > 0 ? `Списано бонусов: ${order.bonusSpent}` : "",
        "",
        "Менеджер проверит заказ и свяжется с вами при необходимости.",
      ].filter(Boolean).join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "📦 Мои заказы", callback_data: "orders:list" }],
          [{ text: "🔎 Отследить заказ", url: `${SITE_URL}/order/track/${order.trackingToken}` }],
          [{ text: "🛍 Вернуться в каталог", callback_data: "catalog" }],
        ]),
      },
    );

    await restoreCheckoutMainKeyboard(chatId);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Не удалось создать заказ";

    await sendTelegramMessage(
      chatId,
      [
        "Не удалось подтвердить заказ.",
        message,
        "",
        "Корзина и черновик сохранены. Обновите итог и повторите подтверждение.",
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "🔄 Пересчитать заказ", callback_data: "checkout:review" }],
          [{ text: "✏️ Изменить данные", callback_data: "checkout:edit:delivery" }],
          [{ text: "⏸ Продолжить позже", callback_data: "checkout:later" }],
        ]),
      },
    );
  }
}

async function handleCheckoutMessage(message: TelegramMessage, text: string): Promise<boolean> {
  const session = await getCheckoutSession(message.chat.id);
  if (!session) return false;
  const value = normalizeInput(text);

  if (value === "/cancel" || value === "❌ Отменить заказ") {
    await clearCheckoutSession(message.chat.id);
    await sendTelegramMessage(message.chat.id, "Оформление заказа отменено.", {
      reply_markup: await mainKeyboardForChat(message.chat.id),
    });
    return true;
  }

  if (value === "⬅️ Назад") {
    await restoreCheckoutMainKeyboard(message.chat.id);
    await handleCheckoutBack(message.chat.id);
    return true;
  }

  if (value === "⏸ Продолжить позже") {
    await restoreCheckoutMainKeyboard(message.chat.id);
    await sendCheckoutResumePrompt(message.chat.id);
    return true;
  }

  const data = safeCheckoutData(session.data);

  if (session.step === "customer_name") {
    if (value.length < 2) {
      await showCheckoutCustomerName(message.chat.id, data);
      return true;
    }
    data.customerName = value.slice(0, 160);
    await showCheckoutCustomerPhone(message.chat.id, data);
    return true;
  }

  if (session.step === "customer_phone") {
    if (
      message.contact?.user_id
      && message.from?.id
      && message.contact.user_id !== message.from.id
    ) {
      await sendTelegramMessage(
        message.chat.id,
        "Можно отправить только номер владельца этого Telegram-аккаунта.",
        { reply_markup: checkoutPhoneKeyboard() },
      );
      return true;
    }

    const phone = normalizePhone(message.contact?.phone_number || value);
    if (phoneDigitsOnly(phone).length < 10) {
      await showCheckoutCustomerPhone(message.chat.id, data);
      return true;
    }

    data.customerPhone = phone;
    await restoreCheckoutMainKeyboard(message.chat.id);
    await showCheckoutRecipientMode(message.chat.id, data);
    return true;
  }

  if (session.step === "recipient_name") {
    if (value.length < 2) {
      await showCheckoutRecipientName(message.chat.id, data);
      return true;
    }
    data.recipientName = value.slice(0, 160);
    await showCheckoutRecipientPhone(message.chat.id, data);
    return true;
  }

  if (session.step === "recipient_phone") {
    const phone = normalizePhone(value);
    if (phoneDigitsOnly(phone).length < 10) {
      await showCheckoutRecipientPhone(message.chat.id, data);
      return true;
    }
    data.recipientPhone = phone;
    data.recipientSameAsCustomer = false;
    await showCheckoutDeliveryType(message.chat.id, data);
    return true;
  }

  if (session.step === "delivery_date") {
    const isoDate = deliveryDateIso(value);
    const today = moscowTodayIso();
    const latest = addDaysIso(today, 180);

    if (!isoDate || isoDate < today || isoDate > latest) {
      await sendCheckoutStepMessage(
        message.chat.id,
        "delivery_date",
        ["Введите дату от сегодняшнего дня до 180 дней вперёд в формате ДД.ММ.ГГГГ."],
      );
      return true;
    }

    data.deliveryDateText = isoDate;
    await showCheckoutIntervals(message.chat.id, data);
    return true;
  }

  if (session.step === "delivery_address") {
    if (value.length < 5) {
      await showCheckoutAddress(message.chat.id, data);
      return true;
    }
    data.deliveryAddress = value.slice(0, 1000);
    await showCheckoutCardText(message.chat.id, data);
    return true;
  }

  if (session.step === "card_text") {
    data.cardText = value === "-" ? "" : value.slice(0, 500);
    await showCheckoutSurprise(message.chat.id, data);
    return true;
  }

  if (session.step === "promo_code") {
    data.promoCode = normalizeTelegramPromoCode(value);
    await showCheckoutBonus(message.chat.id, data);
    return true;
  }

  if (session.step === "bonus") {
    const available = await getTelegramBonusBalance(message.chat.id);
    const bonus = normalizeTelegramBonus(value, available);
    if (bonus === null) {
      await showCheckoutBonus(message.chat.id, data);
      return true;
    }
    data.bonusToSpend = bonus;
    await showCheckoutComment(message.chat.id, data);
    return true;
  }

  if (session.step === "comment") {
    data.comment = value === "-" ? "" : value.slice(0, 2000);
    data.deliveryComment = data.comment;
    await showCheckoutPrivacy(message.chat.id, data);
    return true;
  }

  if (session.step === "confirm") {
    await sendTelegramMessage(message.chat.id, "Используйте кнопки под итоговым сообщением.");
    return true;
  }

  await sendTelegramMessage(
    message.chat.id,
    "На этом шаге выберите вариант кнопкой под предыдущим сообщением.",
  );
  return true;
}

async function checkoutSessionForCallback(
  callbackQuery: TelegramCallbackQuery,
  expected: TelegramCheckoutStep | TelegramCheckoutStep[],
) {
  const chatId = callbackQuery.message?.chat.id;
  if (!chatId) return null;
  const session = await getCheckoutSession(chatId);
  const accepted = Array.isArray(expected) ? expected : [expected];

  if (!session || !accepted.includes(session.step)) {
    await answerCallbackQuery(callbackQuery.id, "Этот шаг уже изменился");
    if (session) await renderCheckoutStep(chatId, session.step, session.data);
    return null;
  }

  return { chatId, session, data: safeCheckoutData(session.data) };
}

async function handleCheckoutRecipientMode(
  callbackQuery: TelegramCallbackQuery,
  mode: "self" | "other",
) {
  const context = await checkoutSessionForCallback(callbackQuery, "recipient_mode");
  if (!context) return;
  const { chatId, data } = context;

  if (mode === "self") {
    data.recipientSameAsCustomer = true;
    data.recipientName = data.customerName || "Клиент Telegram";
    data.recipientPhone = data.customerPhone || "";
    await answerCallbackQuery(callbackQuery.id, "Получатель — покупатель");
    await showCheckoutDeliveryType(chatId, data);
    return;
  }

  data.recipientSameAsCustomer = false;
  data.recipientName = "";
  data.recipientPhone = "";
  await answerCallbackQuery(callbackQuery.id, "Другой получатель");
  await showCheckoutRecipientName(chatId, data);
}

async function handleCheckoutDeliveryType(
  callbackQuery: TelegramCallbackQuery,
  deliveryType: "delivery" | "pickup",
) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_type");
  if (!context) return;
  const { chatId, data } = context;
  const configuration = await getTelegramCheckoutConfiguration();

  if (deliveryType === "pickup") {
    if (!configuration.pickupEnabled) {
      await answerCallbackQuery(callbackQuery.id, "Самовывоз временно недоступен");
      await showCheckoutDeliveryType(chatId, data);
      return;
    }

    data.deliveryType = "pickup";
    data.deliveryService = "standard";
    data.deliveryZoneId = "";
    data.deliveryZoneName = "";
    data.deliveryDateText = "";
    data.deliveryIntervalId = "";
    data.deliveryInterval = "";
    data.deliveryAddress = configuration.pickupAddress;
    await answerCallbackQuery(callbackQuery.id, "Выбран самовывоз");
    await showCheckoutCardText(chatId, data);
    return;
  }

  data.deliveryType = "delivery";
  await answerCallbackQuery(callbackQuery.id, "Выбрана доставка");
  await showCheckoutDeliveryZones(chatId, data);
}

async function handleCheckoutZone(callbackQuery: TelegramCallbackQuery, zoneId: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_zone");
  if (!context) return;
  const { chatId, data } = context;
  const zone = (await getTelegramDeliveryZones()).find((item) => item.id === zoneId);

  if (!zone) {
    await answerCallbackQuery(callbackQuery.id, "Зона больше недоступна");
    await showCheckoutDeliveryZones(chatId, data);
    return;
  }

  data.deliveryZoneId = zone.id;
  data.deliveryZoneName = zone.name;
  data.deliveryService = "standard";
  await answerCallbackQuery(callbackQuery.id, zone.name);
  await showCheckoutDeliveryService(chatId, data, zone);
}

async function handleCheckoutDeliveryService(
  callbackQuery: TelegramCallbackQuery,
  service: "standard" | "express",
) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_service");
  if (!context) return;
  const { chatId, data } = context;
  const zone = (await getTelegramDeliveryZones()).find((item) => item.id === data.deliveryZoneId);

  if (service === "express" && !zone?.is_express_available) {
    await answerCallbackQuery(callbackQuery.id, "Срочная доставка для этой зоны недоступна");
    await showCheckoutDeliveryService(chatId, data, zone);
    return;
  }

  data.deliveryService = service;
  await answerCallbackQuery(callbackQuery.id, service === "express" ? "Срочная доставка" : "Стандартная доставка");
  await showCheckoutDate(chatId, data);
}

async function handleCheckoutDate(callbackQuery: TelegramCallbackQuery, value: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_date");
  if (!context) return;
  const { chatId, data } = context;

  if (value === "manual") {
    await answerCallbackQuery(callbackQuery.id, "Введите дату сообщением");
    await setCheckoutSession(chatId, "delivery_date", data);
    await sendCheckoutStepMessage(
      chatId,
      "delivery_date",
      ["Введите дату в формате ДД.ММ.ГГГГ, например 25.07.2026."],
    );
    return;
  }

  const today = moscowTodayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today || value > addDaysIso(today, 180)) {
    await answerCallbackQuery(callbackQuery.id, "Дата больше недоступна");
    await showCheckoutDate(chatId, data);
    return;
  }

  data.deliveryDateText = value;
  await answerCallbackQuery(callbackQuery.id, "Дата выбрана");
  await showCheckoutIntervals(chatId, data);
}

async function handleCheckoutInterval(callbackQuery: TelegramCallbackQuery, intervalId: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_interval");
  if (!context) return;
  const { chatId, data } = context;
  const interval = (await getTelegramDeliveryIntervals()).find((item) => item.id === intervalId);

  if (!interval) {
    await answerCallbackQuery(callbackQuery.id, "Интервал больше недоступен");
    await showCheckoutIntervals(chatId, data);
    return;
  }

  data.deliveryIntervalId = interval.id;
  data.deliveryInterval = interval.name;
  await answerCallbackQuery(callbackQuery.id, interval.name);
  await showCheckoutAddress(chatId, data);
}

async function handleCheckoutAddress(callbackQuery: TelegramCallbackQuery, addressId: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "delivery_address");
  if (!context) return;
  const { chatId, data } = context;

  if (addressId === "new") {
    await answerCallbackQuery(callbackQuery.id, "Введите новый адрес");
    await setCheckoutSession(chatId, "delivery_address", data);
    await sendCheckoutStepMessage(
      chatId,
      "delivery_address",
      ["Введите город, улицу, дом, квартиру или офис."],
    );
    return;
  }

  const address = (await getTelegramSavedAddresses(chatId)).find((item) => item.id === addressId);
  if (!address) {
    await answerCallbackQuery(callbackQuery.id, "Адрес больше недоступен");
    await showCheckoutAddress(chatId, data);
    return;
  }

  data.deliveryAddress = formatSavedAddress(address);
  data.deliveryComment = address.comment || data.deliveryComment || "";
  await answerCallbackQuery(callbackQuery.id, "Адрес выбран");
  await showCheckoutCardText(chatId, data);
}

async function handleCheckoutSurprise(callbackQuery: TelegramCallbackQuery, value: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "surprise");
  if (!context) return;
  const { chatId, data } = context;

  data.isSurprise = value !== "no";
  data.doNotCallRecipient = value === "no_call";
  await answerCallbackQuery(callbackQuery.id, data.isSurprise ? "Сюрприз" : "Не сюрприз");
  await showCheckoutContactPreference(chatId, data);
}

async function handleCheckoutContactPreference(
  callbackQuery: TelegramCallbackQuery,
  value: "call_or_message" | "phone_call" | "messenger_only",
) {
  const context = await checkoutSessionForCallback(callbackQuery, "contact_preference");
  if (!context) return;
  const { chatId, data } = context;

  data.contactPreference = value;
  await answerCallbackQuery(callbackQuery.id, telegramContactPreferenceLabel(value));
  await showCheckoutPaymentMethods(chatId, data);
}

async function handleCheckoutPayment(
  callbackQuery: TelegramCallbackQuery,
  paymentMethod: TelegramPaymentMethod,
) {
  const context = await checkoutSessionForCallback(callbackQuery, "payment_method");
  if (!context) return;
  const { chatId, data } = context;
  const configuration = await getTelegramCheckoutConfiguration();
  const allowed =
    (paymentMethod === "cash_on_delivery" && configuration.paymentMethods.cash)
    || (paymentMethod === "transfer_after_confirm" && configuration.paymentMethods.transfer)
    || ((paymentMethod === "online_card" || paymentMethod === "sbp") && configuration.paymentMethods.online);

  if (!allowed) {
    await answerCallbackQuery(callbackQuery.id, "Способ оплаты больше недоступен");
    await showCheckoutPaymentMethods(chatId, data);
    return;
  }

  data.paymentMethod = paymentMethod;
  await answerCallbackQuery(callbackQuery.id, telegramPaymentLabel(paymentMethod));
  await showCheckoutPromoCode(chatId, data);
}

async function handleCheckoutBonus(callbackQuery: TelegramCallbackQuery, value: string) {
  const context = await checkoutSessionForCallback(callbackQuery, "bonus");
  if (!context) return;
  const { chatId, data } = context;
  const balance = await getTelegramBonusBalance(chatId);

  if (value === "manual") {
    await answerCallbackQuery(callbackQuery.id, "Введите сумму сообщением");
    await setCheckoutSession(chatId, "bonus", data);
    await sendCheckoutStepMessage(chatId, "bonus", [`Введите сумму от 0 до ${balance}.`]);
    return;
  }

  data.bonusToSpend = value === "all" ? balance : 0;
  await answerCallbackQuery(callbackQuery.id, data.bonusToSpend > 0 ? "Бонусы применены" : "Без бонусов");
  await showCheckoutComment(chatId, data);
}

async function handleCheckoutPrivacyAccept(callbackQuery: TelegramCallbackQuery) {
  const context = await checkoutSessionForCallback(callbackQuery, "privacy");
  if (!context) return;
  const { chatId, data } = context;
  data.privacyAccepted = true;
  await answerCallbackQuery(callbackQuery.id, "Согласие принято");
  await showCheckoutConfirm(chatId, data);
}

async function handleCheckoutEdit(callbackQuery: TelegramCallbackQuery, section: string) {
  const chatId = callbackQuery.message?.chat.id;
  if (!chatId) return;
  const session = await getCheckoutSession(chatId);
  const step = telegramCheckoutEditStep(section);

  if (!session || !step) {
    await answerCallbackQuery(callbackQuery.id, "Раздел недоступен");
    return;
  }

  await answerCallbackQuery(callbackQuery.id, "Измените данные");
  await renderCheckoutStep(chatId, step, safeCheckoutData(session.data));
}

async function handleCheckoutCancel(chatId: number) {
  await clearCheckoutSession(chatId);
  await sendTelegramMessage(chatId, "Оформление заказа отменено.", {
    reply_markup: await mainKeyboardForChat(chatId),
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
          "Получите новый код на сайте и откройте раздел привязки аккаунта."
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

    if (profile.customer_id) {
      await sendTelegramMessage(
        chatId,
        "Этот Telegram также связан с профилем покупателя.",
        {
          reply_markup: inlineKeyboard([
            [
              {
                text: "🔌 Отвязать профиль покупателя",
                callback_data: "customer:telegram:unlink:confirm"
              }
            ]
          ])
        }
      );
    }

    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "👤 Профиль",
        "",
        "Личный кабинет пока не подключён.",
        "Получите код на сайте, откройте «☰ Ещё» → «🔗 Привязать аккаунт» и введите его."
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
    orderId: null,
    redirectPath: "/account",
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

  await sendTelegramMessage(chatId, "Управление профилем:", {
    reply_markup: inlineKeyboard([
      [
        {
          text: "Личный кабинет",
          url: loginUrl
        }
      ],
      [
        {
          text: "🔌 Отвязать Telegram",
          callback_data: "customer:telegram:unlink:confirm"
        }
      ]
    ])
  });
}

async function handleContact(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const shopId = await getDefaultShopId();

  const settingsRows = shopId
    ? await sql<{
        phone: string | null;
        whatsapp: string | null;
        telegram: string | null;
        instagram: string | null;
        address: string | null;
        work_hours: string | null;
      }[]>`
        SELECT phone, whatsapp, telegram, instagram, address, work_hours
        FROM shop_settings
        WHERE shop_id = ${shopId}
        LIMIT 1
      `
    : [];

  const settings = settingsRows[0];
  const phone = valueToText(settings?.phone).trim();
  const whatsapp = valueToText(settings?.whatsapp).trim();
  const telegram = valueToText(settings?.telegram).trim();
  const instagram = valueToText(settings?.instagram).trim();
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (whatsapp) {
    const whatsappUrl = whatsapp.startsWith("http")
      ? whatsapp
      : `https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}`;

    rows.push([{ text: "Написать в WhatsApp", url: whatsappUrl }]);
  }

  if (telegram) {
    const telegramUrl = telegram.startsWith("http")
      ? telegram
      : `https://t.me/${telegram.replace(/^@/, "")}`;

    rows.push([{ text: "Написать в Telegram", url: telegramUrl }]);
  }

  if (instagram) {
    const instagramUrl = instagram.startsWith("http")
      ? instagram
      : `https://instagram.com/${instagram.replace(/^@/, "")}`;

    rows.push([{ text: "Instagram", url: instagramUrl }]);
  }

  rows.push([{ text: "Открыть сайт", url: SITE_URL }]);
  rows.push([{ text: "❌ Скрыть", callback_data: "msg:delete" }]);

  await sendTelegramMessage(
    chatId,
    [
      "💬 Поддержка",
      "",
      "Мы поможем с выбором букета, заказом, оплатой и доставкой.",
      phone ? `Телефон: ${phone}` : "",
      settings?.work_hours ? `Время работы: ${settings.work_hours}` : "",
      settings?.address ? `Адрес: ${settings.address}` : "",
      "",
      "Выберите удобный способ связи:"
    ].filter(Boolean).join("\n"),
    {
      reply_markup: inlineKeyboard(rows)
    }
  );

  await sendTelegramMessage(chatId, "Главное меню остаётся доступно ниже.", {
    reply_markup: replyMarkup
  });
}

type CustomerOrderScope = "all" | "active" | "history";

function customerOrderScopeText(scope: CustomerOrderScope) {
  if (scope === "active") return "Активные заказы";
  if (scope === "history") return "История заказов";
  return "Последние заказы";
}

function customerOrderScopeKeyboard(
  scope: CustomerOrderScope,
  activeCount: number,
  historyCount: number,
) {
  return inlineKeyboard([
    [
      {
        text: `${scope === "active" ? "✓ " : ""}Активные (${activeCount})`,
        callback_data: "orders:active",
      },
      {
        text: `${scope === "history" ? "✓ " : ""}История (${historyCount})`,
        callback_data: "orders:history",
      },
    ],
    [
      {
        text: `${scope === "all" ? "✓ " : ""}Все последние`,
        callback_data: "orders:list",
      },
      {
        text: "🔄 Обновить",
        callback_data: `orders:${scope}`,
      },
    ],
  ]);
}

async function handleOrders(
  chatId: number,
  scope: CustomerOrderScope = "all",
) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id && !profile.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "📦 Заказы",
        "",
        "Рабочие заказы доступны в CRM.",
        `CRM: ${SITE_URL}/admin`,
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
    );
    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "📦 Мои заказы",
        "",
        "Для истории и статусов подключите профиль покупателя.",
        "Получите одноразовый код на сайте и нажмите «🔗 Привязать аккаунт».",
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
    );
    return;
  }

  const countsRows = await sql<{
    active_count: number;
    history_count: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE status NOT IN ('delivered', 'cancelled')
      )::int AS active_count,
      COUNT(*) FILTER (
        WHERE status IN ('delivered', 'cancelled')
      )::int AS history_count
    FROM orders
    WHERE shop_id = ${profile.shop_id}
      AND customer_id = ${profile.customer_id}
  `;

  const counts = countsRows[0];
  const activeCount = Number(counts?.active_count || 0);
  const historyCount = Number(counts?.history_count || 0);

  const orders = await sql<{
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    total: number;
    tracking_token: string | null;
    created_at: string;
    delivery_date: string | null;
    delivery_type: string;
    recipient_name: string | null;
    item_names: string;
  }[]>`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.total,
      o.tracking_token,
      o.created_at,
      o.delivery_date,
      o.delivery_type,
      o.recipient_name,
      COALESCE((
        SELECT string_agg(
          oi.product_name ||
          CASE
            WHEN oi.quantity > 1 THEN ' ×' || oi.quantity::text
            ELSE ''
          END,
          ', '
          ORDER BY oi.created_at
        )
        FROM order_items oi
        WHERE oi.order_id = o.id
      ), '') AS item_names
    FROM orders o
    WHERE o.shop_id = ${profile.shop_id}
      AND o.customer_id = ${profile.customer_id}
      AND (
        ${scope} = 'all'
        OR (
          ${scope} = 'active'
          AND o.status NOT IN ('delivered', 'cancelled')
        )
        OR (
          ${scope} = 'history'
          AND o.status IN ('delivered', 'cancelled')
        )
      )
    ORDER BY
      CASE
        WHEN o.status NOT IN ('delivered', 'cancelled') THEN 0
        ELSE 1
      END,
      o.created_at DESC
    LIMIT 8
  `;

  await sendTelegramMessage(
    chatId,
    [
      `📦 ${customerOrderScopeText(scope)}`,
      "",
      `Активных: ${activeCount}`,
      `В истории: ${historyCount}`,
      orders.length
        ? `Показываю: ${orders.length}`
        : "В этом разделе заказов пока нет.",
    ].join("\n"),
    {
      reply_markup: customerOrderScopeKeyboard(
        scope,
        activeCount,
        historyCount,
      ),
    },
  );

  if (!orders.length) {
    await sendTelegramMessage(
      chatId,
      "Откройте каталог, чтобы выбрать букет.",
      {
        reply_markup: inlineKeyboard([
          [{ text: "🛍 Открыть каталог", callback_data: "catalog" }],
        ]),
      },
    );
    return;
  }

  for (const order of orders) {
    const deliveryText = shortDateText(order.delivery_date);
    const createdText = shortDateText(order.created_at);
    const buttons: TelegramInlineKeyboardButton[][] = [
      [
        {
          text: "Подробнее",
          callback_data: `customer:order:${order.id}`,
        },
      ],
    ];

    if (order.tracking_token) {
      buttons[0]?.push({
        text: "Отслеживать",
        url: absoluteUrl(`/order/track/${order.tracking_token}`),
      });
    }

    await sendTelegramMessage(
      chatId,
      [
        `Заказ ${order.order_number}`,
        `Статус: ${orderStatusText(order.status)}`,
        `Оплата: ${orderPaymentText(order.payment_status)}`,
        order.item_names ? `Состав: ${order.item_names}` : "",
        `Сумма: ${money(order.total)}`,
        deliveryText
          ? `${order.delivery_type === "pickup" ? "Самовывоз" : "Доставка"}: ${deliveryText}`
          : "",
        order.recipient_name
          ? `Получатель: ${order.recipient_name}`
          : "",
        createdText ? `Создан: ${createdText}` : "",
      ].filter(Boolean).join("\n"),
      {
        reply_markup: inlineKeyboard(buttons),
      },
    );
  }
}

async function handleCustomerOrderDetails(
  chatId: number,
  orderId: string,
) {
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      "Для просмотра заказа подключите профиль покупателя.",
      {
        reply_markup: await mainKeyboardForChat(chatId),
      },
    );
    return;
  }

  const rows = await sql<{
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    payment_method: string;
    total: number;
    subtotal: number;
    discount_total: number;
    delivery_price: number;
    bonus_spent: number;
    bonus_earned: number;
    delivery_type: string;
    delivery_date: string | null;
    delivery_interval_name: string | null;
    delivery_address_text: string | null;
    delivery_comment: string | null;
    recipient_name: string | null;
    recipient_phone: string | null;
    tracking_token: string | null;
    created_at: string;
    item_names: string;
  }[]>`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.payment_method,
      o.total,
      o.subtotal,
      o.discount_total,
      o.delivery_price,
      o.bonus_spent,
      o.bonus_earned,
      o.delivery_type,
      o.delivery_date,
      di.name AS delivery_interval_name,
      o.delivery_address_text,
      o.delivery_comment,
      o.recipient_name,
      o.recipient_phone,
      o.tracking_token,
      o.created_at,
      COALESCE((
        SELECT string_agg(
          oi.product_name ||
          CASE
            WHEN oi.quantity > 1 THEN ' ×' || oi.quantity::text
            ELSE ''
          END,
          ', '
          ORDER BY oi.created_at
        )
        FROM order_items oi
        WHERE oi.order_id = o.id
      ), '') AS item_names
    FROM orders o
    LEFT JOIN delivery_intervals di
      ON di.id = o.delivery_interval_id
    WHERE o.id = ${orderId}
      AND o.shop_id = ${profile.shop_id}
      AND o.customer_id = ${profile.customer_id}
    LIMIT 1
  `;

  const order = rows[0];

  if (!order) {
    await sendTelegramMessage(chatId, "Заказ не найден или недоступен.");
    return;
  }

  const buttons: TelegramInlineKeyboardButton[][] = [];

  if (order.tracking_token) {
    buttons.push([
      {
        text: "Открыть страницу заказа",
        url: absoluteUrl(`/order/track/${order.tracking_token}`),
      },
    ]);
  }

  buttons.push([
    { text: "Активные", callback_data: "orders:active" },
    { text: "История", callback_data: "orders:history" },
  ]);
  buttons.push([{ text: "🔄 Обновить", callback_data: `customer:order:${order.id}` }]);

  await sendTelegramMessage(
    chatId,
    [
      `📦 Заказ ${order.order_number}`,
      "",
      `Статус: ${orderStatusText(order.status)}`,
      `Оплата: ${orderPaymentText(order.payment_status)}`,
      order.item_names ? `Состав: ${order.item_names}` : "",
      `Товары: ${money(order.subtotal)}`,
      Number(order.discount_total || 0) > 0
        ? `Скидка: −${money(order.discount_total)}`
        : "",
      Number(order.bonus_spent || 0) > 0
        ? `Списано бонусов: ${money(order.bonus_spent)}`
        : "",
      Number(order.delivery_price || 0) > 0
        ? `Доставка: ${money(order.delivery_price)}`
        : "",
      `Итого: ${money(order.total)}`,
      Number(order.bonus_earned || 0) > 0
        ? `Начислено бонусов: ${money(order.bonus_earned)}`
        : "",
      "",
      order.delivery_type === "pickup" ? "Получение: самовывоз" : "Получение: доставка",
      order.delivery_date
        ? `Дата: ${shortDateText(order.delivery_date)}`
        : "",
      order.delivery_interval_name
        ? `Интервал: ${order.delivery_interval_name}`
        : "",
      order.delivery_address_text
        ? `Адрес: ${order.delivery_address_text}`
        : "",
      order.recipient_name
        ? `Получатель: ${order.recipient_name}`
        : "",
      order.recipient_phone
        ? `Телефон получателя: ${order.recipient_phone}`
        : "",
      order.delivery_comment
        ? `Комментарий: ${order.delivery_comment}`
        : "",
      `Создан: ${shortDateText(order.created_at)}`,
    ].filter(Boolean).join("\n"),
    {
      reply_markup: inlineKeyboard(buttons),
    },
  );
}

async function handleAddresses(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));
  const replyMarkup = await mainKeyboardForChat(chatId);

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🏠 Адреса",
        "",
        "Для сохранённых адресов подключите профиль покупателя.",
        "После привязки адреса с сайта будут доступны здесь.",
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
    );
    return;
  }

  const addresses = await sql<{
    id: string;
    city: string | null;
    street: string | null;
    house: string | null;
    apartment: string | null;
    entrance: string | null;
    floor: string | null;
    comment: string | null;
    is_default: boolean;
  }[]>`
    SELECT
      id,
      city,
      street,
      house,
      apartment,
      entrance,
      floor,
      comment,
      is_default
    FROM customer_addresses
    WHERE shop_id = ${profile.shop_id}
      AND customer_id = ${profile.customer_id}
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
    LIMIT 10
  `;

  const loginUrl = await createCustomerMagicLoginUrl({
    shopId: profile.shop_id,
    customerId: profile.customer_id,
    orderId: null,
    redirectPath: "/account?section=addresses",
  });

  const lines = ["🏠 Сохранённые адреса", ""];

  if (!addresses.length) {
    lines.push("Сохранённых адресов пока нет.");
    lines.push("Добавьте адрес в личном кабинете — он появится здесь автоматически.");
  } else {
    for (let index = 0; index < addresses.length; index += 1) {
      const address = addresses[index];
      if (!address) continue;

      const main = [
        address.city,
        address.street,
        address.house ? `д. ${address.house}` : "",
        address.apartment ? `кв. ${address.apartment}` : "",
      ].filter(Boolean).join(", ");
      const extra = [
        address.entrance ? `подъезд ${address.entrance}` : "",
        address.floor ? `этаж ${address.floor}` : "",
      ].filter(Boolean).join(", ");

      lines.push(
        `${address.is_default ? "⭐ " : ""}${index + 1}. ${main || "Адрес без названия"}`,
      );
      if (extra) lines.push(`   ${extra}`);
      if (address.comment) lines.push(`   ${address.comment}`);
    }
  }

  await sendTelegramMessage(chatId, lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [{ text: "Управлять адресами", url: loginUrl }],
      [{ text: "🔄 Обновить", callback_data: "addresses:list" }],
    ]),
  });
}

async function handleFavorites(chatId: number) {
  const profile = await getTelegramProfile(String(chatId));
  const replyMarkup = await mainKeyboardForChat(chatId);

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "❤️ Любимые букеты",
        "",
        "Подключите профиль покупателя, и бот соберёт любимые букеты из вашей истории заказов.",
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
    );
    return;
  }

  const products = await sql<{
    id: string;
    name: string;
    slug: string;
    price: number;
    ordered_quantity: number;
  }[]>`
    SELECT
      p.id,
      p.name,
      p.slug,
      p.price,
      SUM(oi.quantity)::int AS ordered_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.shop_id = ${profile.shop_id}
      AND o.customer_id = ${profile.customer_id}
      AND p.status = 'active'
    GROUP BY p.id, p.name, p.slug, p.price
    ORDER BY SUM(oi.quantity) DESC, MAX(o.created_at) DESC
    LIMIT 8
  `;

  if (!products.length) {
    await sendTelegramMessage(
      chatId,
      [
        "❤️ Любимые букеты",
        "",
        "После первых заказов здесь появятся букеты, которые вы выбираете чаще всего.",
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [{ text: "🛍 Открыть каталог", callback_data: "catalog" }],
        ]),
      },
    );
    return;
  }

  const buttons: TelegramInlineKeyboardButton[][] = products.map((product) => [
    {
      text: `${product.name} · ${money(product.price)}`,
      callback_data: `prod:${product.id}`,
    },
  ]);
  buttons.push([{ text: "🛍 Весь каталог", callback_data: "catalog" }]);

  await sendTelegramMessage(
    chatId,
    [
      "❤️ Любимые букеты",
      "",
      "Собрано из вашей истории заказов.",
      "Нажмите на букет, чтобы открыть карточку и добавить его в корзину.",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard(buttons),
    },
  );
}

function bonusTransactionText(type: string, amount: number) {
  const labels: Record<string, string> = {
    earn: "Начисление",
    spend: "Списание",
    manual_add: "Ручное начисление",
    manual_remove: "Корректировка",
    expire: "Сгорание",
  };
  const signed = amount > 0 ? `+${amount}` : String(amount);
  return `${labels[type] || type}: ${signed} ₽`;
}

async function handleBonuses(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id && !profile.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🎁 Бонусы",
        "",
        "Бонусы клиентов отображаются в карточке клиента и заказах в CRM.",
        `CRM: ${SITE_URL}/admin`,
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
    );
    return;
  }

  if (!profile?.customer_id) {
    await sendTelegramMessage(
      chatId,
      [
        "🎁 Бонусы",
        "",
        "Подключите профиль покупателя, чтобы видеть баланс и историю начислений.",
      ].join("\n"),
      {
        reply_markup: replyMarkup,
      },
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
      AND shop_id = ${profile.shop_id}
    LIMIT 1
  `;

  const customer = customerRows[0];

  if (!customer) {
    await sendTelegramMessage(chatId, "Бонусный профиль не найден.", {
      reply_markup: replyMarkup,
    });
    return;
  }

  const transactions = await sql<{
    type: string;
    amount: number;
    balance_after: number;
    comment: string | null;
    created_at: string;
  }[]>`
    SELECT type, amount, balance_after, comment, created_at
    FROM bonus_transactions
    WHERE shop_id = ${profile.shop_id}
      AND customer_id = ${profile.customer_id}
    ORDER BY created_at DESC
    LIMIT 6
  `;

  const lines = [
    "🎁 Бонусный счёт",
    "",
    `Баланс: ${money(customer.bonus_balance)}`,
    `Заказов: ${Number(customer.total_orders || 0)}`,
    `Покупки: ${money(customer.total_spent)}`,
  ];

  if (transactions.length) {
    lines.push("", "Последние операции:");
    for (const transaction of transactions) {
      lines.push(
        `• ${shortDateText(transaction.created_at)} — ${bonusTransactionText(transaction.type, Number(transaction.amount || 0))}`,
      );
      if (transaction.comment) {
        lines.push(`  ${transaction.comment}`);
      }
    }
  } else {
    lines.push("", "Операций по бонусному счёту пока нет.");
  }

  const loginUrl = await createCustomerMagicLoginUrl({
    shopId: profile.shop_id,
    customerId: profile.customer_id,
    orderId: null,
    redirectPath: "/account?section=bonuses",
  });

  await sendTelegramMessage(chatId, lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [{ text: "Полная история в кабинете", url: loginUrl }],
      [{ text: "🔄 Обновить", callback_data: "bonuses:list" }],
    ]),
  });
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

  if (data.startsWith("pair:approve:")) {
    const pairingId = data.slice("pair:approve:".length);
    await handleBrowserPairingApprove(callbackQuery, pairingId);
    return;
  }

  if (data.startsWith("pair:cancel:")) {
    const pairingId = data.slice("pair:cancel:".length);
    await handleBrowserPairingCancel(callbackQuery, pairingId);
    return;
  }

  if (data === "catalog") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCatalog(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cat:")) {
    const categoryId = data.slice("cat:".length);
    await handleCatalogCategory(
      chatId,
      categoryId,
      message.message_id,
      callbackQuery.id,
    );
    return;
  }

  if (data.startsWith("prod:")) {
    const productId = data.slice("prod:".length);
    await handleProductCard(chatId, productId, callbackQuery.id);
    return;
  }

  if (data.startsWith("cart:add:")) {
    const productId = data.slice("cart:add:".length);
    const result = await addProductToTelegramCart(
      chatId,
      productId,
      callbackQuery.id,
    );
    await answerCallbackQuery(callbackQuery.id, result ? "Добавлено в корзину" : "Товар недоступен");
    await handleCart(chatId);
    return;
  }

  if (data.startsWith("cart:inc:")) {
    const productId = data.slice("cart:inc:".length);
    await addProductToTelegramCart(
      chatId,
      productId,
      callbackQuery.id,
    );
    await answerCallbackQuery(callbackQuery.id);
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cart:dec:")) {
    const productId = data.slice("cart:dec:".length);
    await decreaseProductInTelegramCart(
      chatId,
      productId,
      callbackQuery.id,
    );
    await answerCallbackQuery(callbackQuery.id);
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data.startsWith("cart:remove:")) {
    const productId = data.slice("cart:remove:".length);
    await removeProductFromTelegramCart(
      chatId,
      productId,
      callbackQuery.id,
    );
    await answerCallbackQuery(callbackQuery.id, "Товар удалён");
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data === "cart:clear") {
    await clearTelegramCart(chatId, callbackQuery.id);
    await answerCallbackQuery(callbackQuery.id, "Корзина очищена");
    await handleCart(chatId, message.message_id);
    return;
  }

  if (data === "cart:site") {
    const profile = await getTelegramProfile(String(chatId));

    if (!profile?.customer_id) {
      await answerCallbackQuery(
        callbackQuery.id,
        "Сначала привяжите профиль покупателя",
      );
      await sendTelegramMessage(
        chatId,
        "Подключите Telegram к профилю покупателя — после этого корзина будет общей с сайтом.",
      );
      return;
    }

    const cartUrl = await createCustomerMagicLoginUrl({
      shopId: profile.shop_id,
      customerId: profile.customer_id,
      orderId: null,
      redirectPath: "/cart",
    });

    await answerCallbackQuery(callbackQuery.id);
    await sendTelegramMessage(
      chatId,
      "Откройте общую корзину на сайте. Вход выполнится автоматически, ссылка действует 10 минут.",
      {
        reply_markup: inlineKeyboard([
          [{ text: "🌐 Открыть корзину", url: cartUrl }],
        ]),
      },
    );
    return;
  }

  if (data === "cart:noop") {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data === "orders:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleOrders(chatId, "all");
    return;
  }

  if (data === "orders:active") {
    await answerCallbackQuery(callbackQuery.id);
    await handleOrders(chatId, "active");
    return;
  }

  if (data === "orders:history") {
    await answerCallbackQuery(callbackQuery.id);
    await handleOrders(chatId, "history");
    return;
  }

  if (data.startsWith("customer:order:")) {
    const orderId = data.slice("customer:order:".length);
    await answerCallbackQuery(callbackQuery.id);
    await handleCustomerOrderDetails(chatId, orderId);
    return;
  }

  if (data === "addresses:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleAddresses(chatId);
    return;
  }

  if (data === "favorites:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleFavorites(chatId);
    return;
  }

  if (data === "bonuses:list") {
    await answerCallbackQuery(callbackQuery.id);
    await handleBonuses(chatId);
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

  if (data === "customer:telegram:unlink:confirm") {
    const profile = await getTelegramProfile(String(chatId));

    if (!profile?.customer_id) {
      await answerCallbackQuery(callbackQuery.id, "Профиль покупателя не привязан");
      return;
    }

    await answerCallbackQuery(callbackQuery.id);
    await sendTelegramMessage(
      chatId,
      [
        "Отвязать Telegram от профиля покупателя?",
        "",
        "Заказы, бонусы и адреса сохранятся.",
        "Текущая сессия сайта останется активной до выхода или окончания срока.",
        profile.user_id
          ? "Рабочая привязка сотрудника останется активной."
          : "После отвязки можно подключить этот или другой Telegram новым кодом."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "Да, отвязать",
              callback_data: "customer:telegram:unlink"
            }
          ],
          [
            {
              text: "Отмена",
              callback_data: "msg:delete"
            }
          ]
        ])
      }
    );
    return;
  }

  if (data === "customer:telegram:unlink") {
    const result = await unlinkCustomerTelegramFromBot(chatId);

    await answerCallbackQuery(
      callbackQuery.id,
      result.unlinked ? "Telegram отвязан" : "Профиль уже не привязан"
    );

    await sendTelegramMessage(
      chatId,
      result.unlinked
        ? [
            "✅ Telegram отвязан от профиля покупателя.",
            "",
            "Заказы, бонусы, адреса и текущая сессия сайта сохранены.",
            result.staffLinkPreserved
              ? "Рабочая привязка сотрудника продолжает работать."
              : "Подключить Telegram снова можно новым одноразовым кодом."
          ].join("\n")
        : "Telegram уже не связан с профилем покупателя.",
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );
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


  if (data === "menu:addresses") {
    await answerCallbackQuery(callbackQuery.id);
    await handleAddresses(chatId);
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "menu:favorites") {
    await answerCallbackQuery(callbackQuery.id);
    await handleFavorites(chatId);
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "menu:support") {
    await answerCallbackQuery(callbackQuery.id);
    await handleContact(chatId);
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "menu:profile") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCustomerProfile(chatId);
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "menu:link") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCustomerLinkEntry(chatId);
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "checkout:resume") {
    await answerCallbackQuery(callbackQuery.id, "Продолжаем оформление");
    await resumeCheckout(chatId);
    return;
  }

  if (data === "checkout:start") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCheckoutStart(chatId);
    return;
  }

  if (data === "checkout:back") {
    await answerCallbackQuery(callbackQuery.id, "Возвращаемся назад");
    await handleCheckoutBack(chatId);
    return;
  }

  if (data === "checkout:later") {
    await answerCallbackQuery(callbackQuery.id, "Черновик сохранён");
    await sendTelegramMessage(chatId, "Оформление можно продолжить позже из этого чата.", {
      reply_markup: await mainKeyboardForChat(chatId),
    });
    await sendCheckoutResumePrompt(chatId);
    return;
  }

  if (data === "checkout:continue_site") {
    await answerCallbackQuery(callbackQuery.id);
    await handleCheckoutContinueSite(chatId);
    return;
  }

  if (data === "checkout:review" || data === "checkout:confirm") {
    await answerCallbackQuery(callbackQuery.id, "Проверяем черновик");
    const session = await getCheckoutSession(chatId);
    if (session) await showCheckoutConfirm(chatId, session.data);
    return;
  }

  if (data === "checkout:ready") {
    await answerCallbackQuery(callbackQuery.id, "Данные сохранены");
    await handleCheckoutReady(chatId);
    return;
  }

  if (data.startsWith("checkout:edit:")) {
    await handleCheckoutEdit(callbackQuery, data.slice("checkout:edit:".length));
    return;
  }

  if (data.startsWith("checkout:recipient:")) {
    const mode = data.slice("checkout:recipient:".length);
    if (mode === "self" || mode === "other") {
      await handleCheckoutRecipientMode(callbackQuery, mode);
      return;
    }
  }

  if (data.startsWith("checkout:delivery:")) {
    const deliveryType = data.slice("checkout:delivery:".length);
    if (deliveryType === "delivery" || deliveryType === "pickup") {
      await handleCheckoutDeliveryType(callbackQuery, deliveryType);
      return;
    }
  }

  if (data.startsWith("checkout:zone:")) {
    await handleCheckoutZone(callbackQuery, data.slice("checkout:zone:".length));
    return;
  }

  if (data.startsWith("checkout:delivery_service:")) {
    const service = data.slice("checkout:delivery_service:".length);
    if (service === "standard" || service === "express") {
      await handleCheckoutDeliveryService(callbackQuery, service);
      return;
    }
  }

  if (data.startsWith("checkout:date:")) {
    await handleCheckoutDate(callbackQuery, data.slice("checkout:date:".length));
    return;
  }

  if (data.startsWith("checkout:interval:")) {
    await handleCheckoutInterval(callbackQuery, data.slice("checkout:interval:".length));
    return;
  }

  if (data.startsWith("checkout:address:")) {
    await handleCheckoutAddress(callbackQuery, data.slice("checkout:address:".length));
    return;
  }

  if (data.startsWith("checkout:surprise:")) {
    await handleCheckoutSurprise(callbackQuery, data.slice("checkout:surprise:".length));
    return;
  }

  if (data.startsWith("checkout:contact:")) {
    const preference = data.slice("checkout:contact:".length);
    if (
      preference === "call_or_message"
      || preference === "phone_call"
      || preference === "messenger_only"
    ) {
      await handleCheckoutContactPreference(callbackQuery, preference);
      return;
    }
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

  if (data === "checkout:promo:skip") {
    const context = await checkoutSessionForCallback(callbackQuery, "promo_code");
    if (context) {
      context.data.promoCode = "";
      await answerCallbackQuery(callbackQuery.id, "Без промокода");
      await showCheckoutBonus(context.chatId, context.data);
    }
    return;
  }

  if (data.startsWith("checkout:bonus:")) {
    await handleCheckoutBonus(callbackQuery, data.slice("checkout:bonus:".length));
    return;
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
    await handleCart(chatId);
    await sendCheckoutResumePrompt(chatId);
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
        "Получите код на сайте, откройте «☰ Ещё» → «🔗 Привязать аккаунт» и введите его."
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

  const pairingContactHandled =
    await handleBrowserPairingContact(message);

  if (pairingContactHandled) {
    return;
  }

  const text = (
    message.text
    || message.contact?.phone_number
    || ""
  ).trim();

  if (!text) {
    return;
  }

  if (text === "Отменить вход") {
    const cancelled = await sql<{ id: string }[]>`
      UPDATE customer_link_tokens
      SET
        status = 'cancelled',
        metadata = metadata || ${JSON.stringify({
          cancelledAt: new Date().toISOString(),
          cancelledTelegramId: String(message.chat.id),
          cancelledBy: "telegram_keyboard",
        })}::jsonb,
        updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM customer_link_tokens
        WHERE provider = 'telegram'
          AND purpose = 'browser_pairing_login'
          AND status IN ('pending', 'opened')
          AND consumed_at IS NULL
          AND expires_at > NOW()
          AND metadata ->> 'candidateTelegramId'
            = ${String(message.chat.id)}
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING id
    `;

    await sendTelegramMessage(
      message.chat.id,
      cancelled[0]
        ? "Вход на сайте отменён."
        : "Активный запрос входа не найден.",
      {
        reply_markup: await mainKeyboardForChat(message.chat.id),
      },
    );
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

  const customerMenuHandled = await handleCustomerMenuCommand(
    message,
    text,
  );

  if (customerMenuHandled) {
    return;
  }

  const checkoutHandled = await handleCheckoutMessage(message, text);
  if (checkoutHandled) {
    return;
  }

  if (/^[0-9\s-]{4,12}$/.test(text)) {
    const linked = await handleTelegramLinkCode(message, text);
    if (linked) {
      return;
    }
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

async function processLegacyNotificationEvents() {
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


function outboxRetryDelayMs(attempt: number) {
  const delays = [30_000, 120_000, 600_000, 1_800_000, 3_600_000];
  return delays[Math.max(0, Math.min(delays.length - 1, attempt - 1))] || 30_000;
}

function nextOutboxAttemptAt(attempt: number) {
  return new Date(Date.now() + outboxRetryDelayMs(attempt)).toISOString();
}

async function recoverStaleOutboxWork() {
  await sql`
    UPDATE notification_deliveries
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, 'Восстановлено после зависшего Telegram worker'),
        next_attempt_at = NOW(),
        updated_at = NOW()
    WHERE channel = 'telegram'
      AND status = 'processing'
      AND locked_at < NOW() - INTERVAL '10 minutes'
  `;

  await sql`
    UPDATE notification_outbox
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, 'Восстановлено после зависшего Telegram worker'),
        next_attempt_at = NOW(),
        updated_at = NOW()
    WHERE channel = 'telegram'
      AND status = 'processing'
      AND locked_at < NOW() - INTERVAL '10 minutes'
  `;
}

async function claimNextNotificationOutbox() {
  const rows = await sql<NotificationOutboxEvent[]>`
    WITH candidate AS (
      SELECT id
      FROM notification_outbox
      WHERE channel = 'telegram'
        AND status = 'pending'
        AND attempts < max_attempts
        AND next_attempt_at <= NOW()
      ORDER BY priority ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE notification_outbox outbox
    SET status = 'processing',
        attempts = LEAST(outbox.max_attempts, outbox.attempts + 1),
        locked_at = NOW(),
        locked_by = ${NOTIFICATION_WORKER_ID},
        last_error = NULL,
        updated_at = NOW()
    FROM candidate
    WHERE outbox.id = candidate.id
    RETURNING
      outbox.id,
      outbox.shop_id,
      outbox.order_id,
      outbox.template_key AS type,
      outbox.channel,
      outbox.recipient_type,
      outbox.recipient_address AS recipient_telegram_id,
      outbox.payload,
      outbox.attempts,
      outbox.created_at,
      outbox.updated_at,
      outbox.source_notification_event_id,
      outbox.recipient_user_id,
      outbox.recipient_customer_id,
      outbox.recipient_role,
      outbox.max_attempts,
      outbox.next_attempt_at,
      outbox.locked_at,
      outbox.locked_by,
      outbox.last_error
  `;

  return rows[0] || null;
}

async function resolveOutboxRecipients(
  event: NotificationOutboxEvent
): Promise<ResolvedNotificationRecipient[]> {
  const addresses = await getRecipients(event);
  const uniqueAddresses = [...new Set(addresses.map((value) => String(value).trim()).filter(Boolean))];
  const recipients: ResolvedNotificationRecipient[] = [];

  for (const address of uniqueAddresses) {
    const rows = await sql<{
      user_id: string | null;
      customer_id: string | null;
      role: string | null;
    }[]>`
      SELECT
        ta.user_id,
        ta.customer_id,
        su.role::text AS role
      FROM telegram_accounts ta
      LEFT JOIN shop_users su
        ON su.shop_id = ta.shop_id
       AND su.user_id = ta.user_id
       AND su.is_active = true
      WHERE ta.shop_id = ${event.shop_id}
        AND ta.telegram_id = ${address}
        AND ta.is_active = true
      ORDER BY ta.linked_at DESC
      LIMIT 1
    `;

    const resolved = rows[0];
    recipients.push({
      address,
      userId: resolved?.user_id || event.recipient_user_id,
      customerId: resolved?.customer_id || event.recipient_customer_id,
      role: resolved?.role || event.recipient_role
    });
  }

  return recipients;
}

async function ensureOutboxDelivery(
  event: NotificationOutboxEvent,
  recipient: ResolvedNotificationRecipient
) {
  await sql`
    INSERT INTO notification_deliveries (
      shop_id,
      outbox_id,
      channel,
      recipient_type,
      recipient_user_id,
      recipient_customer_id,
      recipient_role,
      recipient_address,
      status,
      attempts,
      max_attempts,
      next_attempt_at,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${event.shop_id},
      ${event.id},
      'telegram',
      ${event.recipient_type},
      ${recipient.userId},
      ${recipient.customerId},
      ${recipient.role},
      ${recipient.address},
      'pending',
      0,
      ${event.max_attempts},
      NOW(),
      ${JSON.stringify({
        source: 'telegram_outbox_worker',
        workerId: NOTIFICATION_WORKER_ID
      })}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (outbox_id, channel, recipient_address)
    DO NOTHING
  `;
}

async function claimOutboxDelivery(deliveryId: string) {
  const rows = await sql<NotificationDelivery[]>`
    UPDATE notification_deliveries
    SET status = 'processing',
        attempts = LEAST(max_attempts, attempts + 1),
        locked_at = NOW(),
        locked_by = ${NOTIFICATION_WORKER_ID},
        last_error = NULL,
        updated_at = NOW()
    WHERE id = ${deliveryId}
      AND channel = 'telegram'
      AND status = 'pending'
      AND attempts < max_attempts
      AND next_attempt_at <= NOW()
    RETURNING
      id,
      outbox_id,
      recipient_address,
      recipient_user_id,
      recipient_customer_id,
      status,
      attempts,
      max_attempts,
      next_attempt_at
  `;

  return rows[0] || null;
}

async function notificationDeliveryRecipientIsActive(
  event: NotificationOutboxEvent,
  delivery: NotificationDelivery,
) {
  const rows = await sql<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM telegram_accounts ta
      WHERE ta.shop_id = ${event.shop_id}
        AND ta.telegram_id = ${delivery.recipient_address}
        AND ta.is_active = true
        AND (
          ${delivery.recipient_user_id}::uuid IS NULL
          OR ta.user_id = ${delivery.recipient_user_id}
        )
        AND (
          ${delivery.recipient_customer_id}::uuid IS NULL
          OR ta.customer_id = ${delivery.recipient_customer_id}
        )
    ) AS active
  `;

  return rows[0]?.active === true;
}

async function sendOutboxEventToRecipient(
  event: NotificationOutboxEvent,
  chatId: string
) {
  const message = formatEvent(event);
  const payload = eventPayload(event);
  const productImageUrl = absoluteUrl(payloadValue(payload, "productImageUrl", "product_image_url"));
  const bouquetPhotoUrl = absoluteUrl(payloadValue(payload, "bouquetPhotoUrl", "bouquet_photo_url"));
  const deliveryProofPhotoUrl = absoluteUrl(
    payloadValue(payload, "deliveryProofPhotoUrl", "delivery_proof_photo_url")
  );
  const orderId = payloadText(payload, "orderId", "order_id");
  const crmUrl = absoluteUrl(payloadValue(payload, "crmUrl", "crm_url"));
  const trackingUrl = absoluteUrl(payloadValue(payload, "trackingUrl", "tracking_url"));
  const deliveryAddressText = payloadText(payload, "deliveryAddressText", "delivery_address_text");
  const actionButtonRows: TelegramInlineKeyboardButton[][] = [];

  if (event.recipient_type === "customer" && event.type === "bouquet_approval_requested" && orderId) {
    actionButtonRows.push([
      { text: "✅ Одобряю", callback_data: `bouquet:approve:${orderId}` },
      { text: "🔄 Нужна правка", callback_data: `bouquet:revision:${orderId}` }
    ]);
  }

  if (event.type === "bouquet_approved" && orderId) {
    actionButtonRows.push([{ text: "✅ Завершить сборку", callback_data: `florist:ready:${orderId}` }]);
  }

  if (event.type === "bouquet_revision_requested" && orderId) {
    actionButtonRows.push([{ text: "📸 Загрузить новое фото", callback_data: `florist:photo:${orderId}` }]);
  }

  if (event.type === "florist_order_assigned" && orderId) {
    actionButtonRows.push([{ text: "💐 Взять в работу", callback_data: `florist:take:${orderId}` }]);
  }

  if (event.type === "courier_order_assigned" && orderId) {
    actionButtonRows.push([{ text: "🚚 Принять доставку", callback_data: `courier:accept:${orderId}` }]);

    if (deliveryAddressText) {
      actionButtonRows.push([{ text: "🗺 Маршрут", url: `https://yandex.ru/maps/?text=${encodeURIComponent(deliveryAddressText)}` }]);
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
    actionButtonRows.push([{ text: "Открыть CRM", url: crmUrl }]);
  }

  if (event.recipient_type === "customer" && trackingUrl) {
    actionButtonRows.push([{ text: "Открыть заказ", url: trackingUrl }]);
  }

  const actionReplyMarkup = actionButtonRows.length ? inlineKeyboard(actionButtonRows) : null;

  if (event.type === "courier_order_assigned" && orderId) {
    const courierOrder = await loadCourierOrderCard(event.shop_id, orderId);

    if (!courierOrder) {
      throw new Error("Courier order not found");
    }

    const courierChatId = Number(chatId);

    if (!Number.isSafeInteger(courierChatId)) {
      throw new Error("Invalid courier Telegram chat ID");
    }

    await sendCourierOrderCard(courierChatId, courierOrder);
  } else if (event.type === "florist_order_assigned" && productImageUrl) {
    await sendTelegramPhoto(chatId, productImageUrl, message);

    if (actionReplyMarkup) {
      await sendTelegramMessage(chatId, "Действие по заказу:", { reply_markup: actionReplyMarkup });
    }
  } else if (event.type === "bouquet_approval_requested" && bouquetPhotoUrl) {
    await sendTelegramPhoto(
      chatId,
      bouquetPhotoUrl,
      message,
      actionReplyMarkup ? { reply_markup: actionReplyMarkup } : undefined
    );
  } else if (event.type === "order_ready" && bouquetPhotoUrl) {
    await sendTelegramPhoto(
      chatId,
      bouquetPhotoUrl,
      message,
      actionReplyMarkup ? { reply_markup: actionReplyMarkup } : undefined
    );
  } else if (event.type === "order_delivered" && deliveryProofPhotoUrl) {
    await sendTelegramPhoto(
      chatId,
      deliveryProofPhotoUrl,
      message,
      actionReplyMarkup ? { reply_markup: actionReplyMarkup } : undefined
    );
  } else if (actionReplyMarkup) {
    await sendTelegramMessage(chatId, message, { reply_markup: actionReplyMarkup });
  } else {
    await sendTelegramMessage(chatId, message);
  }
}

async function markLegacyNotificationFromOutbox(
  event: NotificationOutboxEvent,
  status: 'sent' | 'skipped' | 'failed',
  error: string | null,
  sentAt: string | null
) {
  if (!event.source_notification_event_id) {
    return;
  }

  await sql`
    UPDATE notification_events
    SET status = ${status},
        attempts = LEAST(5, GREATEST(attempts, ${event.attempts})),
        error = ${error},
        sent_at = ${sentAt},
        updated_at = NOW()
    WHERE id = ${event.source_notification_event_id}
  `;
}

async function finalizeNotificationOutbox(event: NotificationOutboxEvent) {
  const rows = await sql<{
    total: number;
    pending: number;
    processing: number;
    sent: number;
    skipped: number;
    failed: number;
    next_attempt_at: string | null;
  }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS next_attempt_at
    FROM notification_deliveries
    WHERE outbox_id = ${event.id}
  `;

  const summary = rows[0];

  if (!summary || summary.total === 0) {
    const reason = event.recipient_type === 'customer'
      ? 'Telegram покупателя не подключён или уведомления выключены'
      : 'Нет активного подходящего сотрудника с включёнными Telegram-уведомлениями';

    await sql`
      UPDATE notification_outbox
      SET status = 'skipped',
          locked_at = NULL,
          locked_by = NULL,
          last_error = ${reason},
          updated_at = NOW()
      WHERE id = ${event.id}
    `;

    await markLegacyNotificationFromOutbox(event, 'skipped', reason, null);
    return;
  }

  if (summary.pending > 0 || summary.processing > 0) {
    await sql`
      UPDATE notification_outbox
      SET status = 'pending',
          locked_at = NULL,
          locked_by = NULL,
          next_attempt_at = COALESCE(${summary.next_attempt_at}, NOW() + INTERVAL '30 seconds'),
          last_error = ${summary.sent > 0 ? 'Часть получателей уже получила уведомление; остальные ожидают повторной попытки' : null},
          updated_at = NOW()
      WHERE id = ${event.id}
    `;
    return;
  }

  if (summary.sent > 0) {
    const partialMessage = summary.skipped > 0 || summary.failed > 0
      ? `Доставлено: ${summary.sent}; пропущено: ${summary.skipped}; ошибок: ${summary.failed}`
      : null;
    const sentAt = new Date().toISOString();

    await sql`
      UPDATE notification_outbox
      SET status = 'sent',
          locked_at = NULL,
          locked_by = NULL,
          last_error = ${partialMessage},
          sent_at = ${sentAt},
          updated_at = NOW()
      WHERE id = ${event.id}
    `;

    await markLegacyNotificationFromOutbox(event, 'sent', partialMessage, sentAt);
    return;
  }

  if (summary.failed > 0) {
    const reason = `Telegram delivery исчерпала попытки: ${summary.failed}`;

    await sql`
      UPDATE notification_outbox
      SET status = 'dead',
          locked_at = NULL,
          locked_by = NULL,
          last_error = ${reason},
          dead_at = NOW(),
          updated_at = NOW()
      WHERE id = ${event.id}
    `;

    await markLegacyNotificationFromOutbox(event, 'failed', reason, null);
    return;
  }

  const reason = 'Все Telegram-получатели пропущены или отключены';

  await sql`
    UPDATE notification_outbox
    SET status = 'skipped',
        locked_at = NULL,
        locked_by = NULL,
        last_error = ${reason},
        updated_at = NOW()
    WHERE id = ${event.id}
  `;

  await markLegacyNotificationFromOutbox(event, 'skipped', reason, null);
}

async function processNotificationOutbox() {
  if (DRY_RUN) {
    const preview = await sql<NotificationOutboxEvent[]>`
      SELECT
        id,
        shop_id,
        order_id,
        template_key AS type,
        channel,
        recipient_type,
        recipient_address AS recipient_telegram_id,
        payload,
        attempts,
        created_at,
        updated_at,
        source_notification_event_id,
        recipient_user_id,
        recipient_customer_id,
        recipient_role,
        max_attempts,
        next_attempt_at,
        locked_at,
        locked_by,
        last_error
      FROM notification_outbox
      WHERE channel = 'telegram'
        AND status = 'pending'
        AND attempts < max_attempts
        AND next_attempt_at <= NOW()
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `;

    if (preview[0]) {
      console.log(`[bot-worker] dry-run outbox=${preview[0].id} type=${preview[0].type}`);
      console.log(formatEvent(preview[0]));
    }

    return;
  }

  await recoverStaleOutboxWork();

  const event = await claimNextNotificationOutbox();

  if (!event) {
    return;
  }

  console.log(`[bot-worker] claimed outbox=${event.id} type=${event.type} attempt=${event.attempts}`);

  try {
    const recipients = await resolveOutboxRecipients(event);

    for (const recipient of recipients) {
      await ensureOutboxDelivery(event, recipient);
    }

    const deliveries = await sql<NotificationDelivery[]>`
      SELECT
        id,
        outbox_id,
        recipient_address,
        recipient_user_id,
        recipient_customer_id,
        status,
        attempts,
        max_attempts,
        next_attempt_at
      FROM notification_deliveries
      WHERE outbox_id = ${event.id}
        AND channel = 'telegram'
        AND status = 'pending'
        AND attempts < max_attempts
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
    `;

    for (const candidate of deliveries) {
      const delivery = await claimOutboxDelivery(candidate.id);

      if (!delivery) {
        continue;
      }

      try {
        const recipientActive = await notificationDeliveryRecipientIsActive(
          event,
          delivery,
        );

        if (!recipientActive) {
          await sql`
            UPDATE notification_deliveries
            SET status = 'skipped',
                locked_at = NULL,
                locked_by = NULL,
                last_error = 'Telegram-привязка получателя больше не активна',
                failed_at = COALESCE(failed_at, NOW()),
                updated_at = NOW()
            WHERE id = ${delivery.id}
          `;
          continue;
        }

        await sendOutboxEventToRecipient(event, delivery.recipient_address);

        await sql`
          UPDATE notification_deliveries
          SET status = 'sent',
              locked_at = NULL,
              locked_by = NULL,
              last_error = NULL,
              sent_at = NOW(),
              updated_at = NOW()
          WHERE id = ${delivery.id}
        `;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isPermanentTelegramRecipientError(message)) {
          await deactivateTelegramRecipient(event.shop_id, delivery.recipient_address, message);

          await sql`
            UPDATE notification_deliveries
            SET status = 'skipped',
                locked_at = NULL,
                locked_by = NULL,
                last_error = ${message},
                failed_at = NOW(),
                updated_at = NOW()
            WHERE id = ${delivery.id}
          `;
          continue;
        }

        if (delivery.attempts >= delivery.max_attempts) {
          await sql`
            UPDATE notification_deliveries
            SET status = 'failed',
                locked_at = NULL,
                locked_by = NULL,
                last_error = ${message},
                failed_at = NOW(),
                updated_at = NOW()
            WHERE id = ${delivery.id}
          `;
        } else {
          await sql`
            UPDATE notification_deliveries
            SET status = 'pending',
                locked_at = NULL,
                locked_by = NULL,
                last_error = ${message},
                next_attempt_at = ${nextOutboxAttemptAt(delivery.attempts)},
                updated_at = NOW()
            WHERE id = ${delivery.id}
          `;
        }

        console.error(`[bot-worker] delivery failed outbox=${event.id} delivery=${delivery.id}`, error);
      }
    }

    await finalizeNotificationOutbox(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const terminal = event.attempts >= event.max_attempts;

    await sql`
      UPDATE notification_outbox
      SET status = ${terminal ? 'dead' : 'pending'},
          locked_at = NULL,
          locked_by = NULL,
          last_error = ${message},
          next_attempt_at = ${nextOutboxAttemptAt(event.attempts)},
          dead_at = ${terminal ? new Date().toISOString() : null},
          updated_at = NOW()
      WHERE id = ${event.id}
    `;

    if (terminal) {
      await markLegacyNotificationFromOutbox(event, 'failed', message, null);
    }

    console.error(`[bot-worker] outbox failed id=${event.id}`, error);
  }
}

class NotificationSelfTestRollback extends Error {}

async function runNotificationOutboxSelfTest() {
  try {
    await sql.begin(async (transaction) => {
      const shops = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        ORDER BY created_at
        LIMIT 1
      `;
      const shop = shops[0];

      if (!shop) {
        throw new Error('Outbox self-test: shop not found');
      }

      const events = await transaction<{ id: string }[]>`
        INSERT INTO notification_events (
          shop_id,
          type,
          channel,
          recipient_type,
          recipient_telegram_id,
          status,
          payload,
          attempts,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          'outbox_worker_self_test',
          'telegram',
          'staff',
          'self-test-recipient',
          'pending',
          ${JSON.stringify({ selfTest: true })}::jsonb,
          0,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const eventId = events[0]?.id;

      if (!eventId) {
        throw new Error('Outbox self-test: notification event was not created');
      }

      const outboxes = await transaction<{ id: string }[]>`
        SELECT id
        FROM notification_outbox
        WHERE source_notification_event_id = ${eventId}
        LIMIT 1
      `;
      const outboxId = outboxes[0]?.id;

      if (!outboxId) {
        throw new Error('Outbox self-test: mirror trigger did not create outbox row');
      }

      await transaction`
        INSERT INTO notification_deliveries (
          shop_id,
          outbox_id,
          channel,
          recipient_type,
          recipient_address,
          status,
          attempts,
          max_attempts,
          next_attempt_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${outboxId},
          'telegram',
          'staff',
          'self-test-recipient',
          'pending',
          0,
          5,
          NOW(),
          '{}'::jsonb,
          NOW(),
          NOW()
        )
      `;

      const claimed = await transaction<{ id: string }[]>`
        UPDATE notification_deliveries
        SET status = 'processing',
            attempts = attempts + 1,
            locked_at = NOW(),
            locked_by = 'self-test',
            updated_at = NOW()
        WHERE outbox_id = ${outboxId}
          AND recipient_address = 'self-test-recipient'
          AND status = 'pending'
        RETURNING id
      `;

      const claimedDelivery = claimed[0];

      if (claimed.length !== 1 || !claimedDelivery) {
        throw new Error('Outbox self-test: delivery claim failed');
      }

      await transaction`
        UPDATE notification_deliveries
        SET status = 'sent',
            locked_at = NULL,
            locked_by = NULL,
            sent_at = NOW(),
            updated_at = NOW()
        WHERE id = ${claimedDelivery.id}
      `;

      const counts = await transaction<{ sent: number }[]>`
        SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent
        FROM notification_deliveries
        WHERE outbox_id = ${outboxId}
      `;

      if (counts[0]?.sent !== 1) {
        throw new Error('Outbox self-test: delivery status aggregation failed');
      }

      throw new NotificationSelfTestRollback('rollback');
    });
  } catch (error) {
    if (!(error instanceof NotificationSelfTestRollback)) {
      throw error;
    }
  }

  console.log('[bot-worker] notification outbox self-test: OK');
}

async function loop() {
  if (!['outbox', 'legacy'].includes(NOTIFICATION_SOURCE)) {
    throw new Error(`Unsupported BOT_NOTIFICATION_SOURCE: ${NOTIFICATION_SOURCE}`);
  }

  console.log(
    `[bot-worker] started dryRun=${DRY_RUN} runOnce=${RUN_ONCE} tokenSet=${Boolean(TELEGRAM_BOT_TOKEN)} poll=${POLL_INTERVAL_MS}ms updatesTimeout=${TELEGRAM_UPDATES_TIMEOUT_SECONDS}s notifications=${NOTIFICATION_SOURCE}`
  );

  if (NOTIFICATION_SELF_TEST) {
    await runNotificationOutboxSelfTest();
    await sql.end();
    return;
  }

  while (!isStopping) {
    await processTelegramUpdates();

    if (NOTIFICATION_SOURCE === 'legacy') {
      await processLegacyNotificationEvents();
    } else {
      await processNotificationOutbox();
    }

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
