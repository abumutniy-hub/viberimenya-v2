import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";
import {
  telegramApi,
  sendTelegramMessage,
  sendTelegramPhoto,
  editTelegramMessageText,
  deleteTelegramMessage,
  sendOrEditTelegramMessage,
  answerCallbackQuery
} from "./telegram-client";

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
const DEFAULT_SHOP_SLUG = process.env.DEFAULT_SHOP_SLUG || "viberimenya";
const UPLOADS_DIR = process.env.UPLOADS_DIR || resolve(process.cwd(), "../../storage/uploads");

const pendingBouquetPhotoRequests = new Map<number, {
  orderId: string;
  orderNumber: string;
  shopId: string;
  userId: string;
  createdAt: number;
}>();

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
  type: "order_ready" | "order_delivering" | "order_delivered";
  status: "ready" | "delivering" | "delivered";
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
  `;
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
    await sendTelegramMessage(message.chat.id, "Код не найден или срок действия истёк. Сгенерируйте новый код на сайте или в CRM.");
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
  | "delivery_date"
  | "delivery_interval"
  | "delivery_address"
  | "comment"
  | "confirm";

type TelegramCheckoutData = {
  customerName?: string;
  customerPhone?: string;
  recipientName?: string;
  recipientPhone?: string;
  deliveryDateText?: string;
  deliveryInterval?: string;
  deliveryAddress?: string;
  comment?: string;
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

  if (typeof raw.customerName === "string") {
    data.customerName = raw.customerName;
  }

  if (typeof raw.customerPhone === "string") {
    data.customerPhone = raw.customerPhone;
  }

  if (typeof raw.recipientName === "string") {
    data.recipientName = raw.recipientName;
  }

  if (typeof raw.recipientPhone === "string") {
    data.recipientPhone = raw.recipientPhone;
  }

  if (typeof raw.deliveryDateText === "string") {
    data.deliveryDateText = raw.deliveryDateText;
  }

  if (typeof raw.deliveryInterval === "string") {
    data.deliveryInterval = raw.deliveryInterval;
  }

  if (typeof raw.deliveryAddress === "string") {
    data.deliveryAddress = raw.deliveryAddress;
  }

  if (typeof raw.comment === "string") {
    data.comment = raw.comment;
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

  await setCheckoutSession(chatId, "customer_name", {});

  await askCheckoutQuestion(
    chatId,
    [
      "✅ Оформление заказа",
      "",
      "Шаг 1 из 8.",
      "Введите ваше имя:"
    ].join("\n")
  );
}

async function showCheckoutConfirm(chatId: number, data: TelegramCheckoutData) {
  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    await clearCheckoutSession(chatId);
    await handleCart(chatId);
    return;
  }

  let total = 0;
  const productLines = cartRows.map((item, index) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    total += itemTotal;
    return `${index + 1}. ${item.name} — ${item.quantity} шт. × ${money(item.price)} = ${money(itemTotal)}`;
  });

  await setCheckoutSession(chatId, "confirm", data);

  await sendTelegramMessage(
    chatId,
    [
      "📋 Проверьте заказ",
      "",
      ...productLines,
      "",
      `Итого: ${money(total)}`,
      "",
      `Имя клиента: ${data.customerName || ""}`,
      `Телефон клиента: ${data.customerPhone || ""}`,
      `Получатель: ${data.recipientName || data.customerName || ""}`,
      `Телефон получателя: ${data.recipientPhone || data.customerPhone || ""}`,
      `Дата доставки: ${data.deliveryDateText || ""}`,
      `Интервал: ${data.deliveryInterval || ""}`,
      `Адрес: ${data.deliveryAddress || ""}`,
      data.comment ? `Комментарий: ${data.comment}` : "Комментарий: нет",
      "",
      "Если всё верно, подтвердите заказ."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [{ text: "✅ Подтвердить заказ", callback_data: "checkout:confirm" }],
        [{ text: "❌ Отменить заказ", callback_data: "checkout:cancel" }]
      ])
    }
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
      await askCheckoutQuestion(message.chat.id, "Введите имя клиента:");
      return true;
    }

    data.customerName = value;
    await setCheckoutSession(message.chat.id, "customer_phone", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 2 из 8.",
        "Введите ваш телефон:",
        "",
        "Например: +7 999 123-45-67"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "customer_phone") {
    const phone = normalizePhone(value);

    if (phone.length < 10) {
      await askCheckoutQuestion(message.chat.id, "Введите корректный номер телефона:");
      return true;
    }

    data.customerPhone = phone;
    await setCheckoutSession(message.chat.id, "recipient_name", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 3 из 8.",
        "Введите имя получателя.",
        "Если получатель тот же, отправьте знак минус: -"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "recipient_name") {
    data.recipientName = value === "-" ? (data.customerName || "Клиент Telegram") : value;
    await setCheckoutSession(message.chat.id, "recipient_phone", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 4 из 8.",
        "Введите телефон получателя.",
        "Если телефон тот же, отправьте знак минус: -"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "recipient_phone") {
    if (value === "-") {
      data.recipientPhone = data.customerPhone || "";
    } else {
      const phone = normalizePhone(value);

      if (phone.length < 10) {
        await askCheckoutQuestion(message.chat.id, "Введите корректный телефон получателя:");
        return true;
      }

      data.recipientPhone = phone;
    }

    await setCheckoutSession(message.chat.id, "delivery_date", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 5 из 8.",
        "Введите дату доставки:",
        "",
        "Например: 04.07.2026"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "delivery_date") {
    data.deliveryDateText = value;
    await setCheckoutSession(message.chat.id, "delivery_interval", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 6 из 8.",
        "Введите удобный интервал доставки:",
        "",
        "Например: 10:00-13:00"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "delivery_interval") {
    data.deliveryInterval = value;
    await setCheckoutSession(message.chat.id, "delivery_address", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 7 из 8.",
        "Введите адрес доставки:",
        "",
        "Город, улица, дом, квартира/офис."
      ].join("\n")
    );
    return true;
  }

  if (session.step === "delivery_address") {
    if (value.length < 5) {
      await askCheckoutQuestion(message.chat.id, "Введите адрес доставки подробнее:");
      return true;
    }

    data.deliveryAddress = value;
    await setCheckoutSession(message.chat.id, "comment", data);
    await askCheckoutQuestion(
      message.chat.id,
      [
        "Шаг 8 из 8.",
        "Добавьте комментарий к заказу.",
        "Если комментария нет, отправьте знак минус: -"
      ].join("\n")
    );
    return true;
  }

  if (session.step === "comment") {
    if (value !== "-") {
      data.comment = value;
    }

    await showCheckoutConfirm(message.chat.id, data);
    return true;
  }

  if (session.step === "confirm") {
    await sendTelegramMessage(
      message.chat.id,
      "Пожалуйста, нажмите кнопку «✅ Подтвердить заказ» или «❌ Отменить заказ» под сообщением с заказом."
    );
    return true;
  }

  return false;
}

async function createOrderFromTelegramCheckout(chatId: number, data: TelegramCheckoutData): Promise<CreatedTelegramOrder | null> {
  const shopId = await getDefaultShopId();

  if (!shopId) {
    throw new Error("Shop not found");
  }

  const cartRows = await getTelegramCartRows(chatId);

  if (cartRows.length === 0) {
    return null;
  }

  const subtotal = cartRows.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);

  const total = subtotal;
  const orderNumber = createTelegramOrderNumber();
  const trackingToken = createTelegramTrackingToken();
  const deliveryDate = data.deliveryDateText ? parseDeliveryDateInput(data.deliveryDateText) : null;
  const customerName = data.customerName || "Клиент Telegram";
  const customerPhone = data.customerPhone || String(chatId);
  const recipientName = data.recipientName || customerName;
  const recipientPhone = data.recipientPhone || customerPhone;
  const deliveryComment = [
    data.deliveryInterval ? `Интервал: ${data.deliveryInterval}` : "",
    data.comment ? `Комментарий: ${data.comment}` : ""
  ].filter(Boolean).join("\n");

  let customerRows = await sql<{ id: string; bonus_balance: number }[]>`
    SELECT id, bonus_balance
    FROM customers
    WHERE shop_id = ${shopId}
      AND phone = ${customerPhone}
    LIMIT 1
  `;

  let customer = customerRows[0];

  if (customer) {
    await sql`
      UPDATE customers
      SET name = COALESCE(NULLIF(${customerName}, ''), name),
          updated_at = NOW()
      WHERE id = ${customer.id}
    `;
  } else {
    customerRows = await sql<{ id: string; bonus_balance: number }[]>`
      INSERT INTO customers (
        shop_id,
        phone,
        name,
        total_orders,
        total_spent,
        last_order_at,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        ${customerPhone},
        ${customerName},
        0,
        0,
        NOW(),
        NOW(),
        NOW()
      )
      RETURNING id, bonus_balance
    `;

    customer = customerRows[0];
  }

  if (!customer?.id) {
    throw new Error("Customer was not created");
  }

  const telegramId = String(chatId);

  await sql`
    INSERT INTO telegram_accounts (
      shop_id,
      telegram_id,
      customer_id,
      is_active,
      linked_at,
      created_at,
      updated_at
    )
    VALUES (
      ${shopId},
      ${telegramId},
      ${customer.id},
      true,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, telegram_id)
    DO UPDATE SET
      customer_id = CASE
        WHEN telegram_accounts.customer_id IS NULL OR telegram_accounts.customer_id = ${customer.id}
        THEN ${customer.id}
        ELSE telegram_accounts.customer_id
      END,
      is_active = true,
      updated_at = NOW()
  `;

  const orderRows = await sql<{ id: string }[]>`
    INSERT INTO orders (
      shop_id,
      customer_id,
      order_number,
      status,
      payment_status,
      payment_method,
      delivery_type,
      delivery_date,
      delivery_address_text,
      delivery_comment,
      recipient_name,
      recipient_phone,
      customer_comment,
      subtotal,
      discount_total,
      delivery_price,
      bonus_spent,
      bonus_earned,
      total,
      tracking_token,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${shopId},
      ${customer.id},
      ${orderNumber},
      'new',
      'pending',
      'transfer_after_confirm',
      'delivery',
      ${deliveryDate},
      ${data.deliveryAddress || ""},
      ${deliveryComment},
      ${recipientName},
      ${recipientPhone},
      ${data.comment || ""},
      ${subtotal},
      0,
      0,
      0,
      0,
      ${total},
      ${trackingToken},
      ${JSON.stringify({
        source: "telegram",
        telegramChatId: chatId,
        requestedDeliveryDate: data.deliveryDateText || null,
        requestedDeliveryInterval: data.deliveryInterval || null
      })},
      NOW(),
      NOW()
    )
    RETURNING id
  `;

  const order = orderRows[0];

  if (!order?.id) {
    throw new Error("Order was not created");
  }

  for (const item of cartRows) {
    const price = Number(item.price || 0);
    const quantity = Number(item.quantity || 0);
    const itemTotal = price * quantity;

    await sql`
      INSERT INTO order_items (
        shop_id,
        order_id,
        product_id,
        product_name,
        product_snapshot,
        quantity,
        price,
        total,
        created_at,
        updated_at
      )
      VALUES (
        ${shopId},
        ${order.id},
        ${item.product_id},
        ${item.name},
        ${JSON.stringify({ id: item.product_id, name: item.name, price })},
        ${quantity},
        ${price},
        ${itemTotal},
        NOW(),
        NOW()
      )
    `;
  }

  await sql`
    UPDATE customers
    SET total_orders = total_orders + 1,
        total_spent = total_spent + ${total},
        last_order_at = NOW(),
        updated_at = NOW()
    WHERE id = ${customer.id}
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
      ${shopId},
      ${order.id},
      NULL,
      'new',
      'Заказ создан через Telegram-бот',
      NOW()
    )
  `;

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
    VALUES (
      ${shopId},
      ${order.id},
      'order_created',
      'telegram',
      'staff',
      'pending',
      CAST(${JSON.stringify({
        orderId: order.id,
        order_id: order.id,

        orderNumber,
        order_number: orderNumber,

        status: "new",

        customerName,
        customer_name: customerName,

        customerPhone,
        customer_phone: customerPhone,

        recipientName,
        recipient_name: recipientName,

        recipientPhone,
        recipient_phone: recipientPhone,

        totalAmount: total,
        total_amount: total,
        total,

        discountTotal: 0,
        discount_total: 0,

        bonusSpent: 0,
        bonus_spent: 0,

        deliveryType: "delivery",
        delivery_type: "delivery",

        deliveryDate: data.deliveryDateText || null,
        delivery_date: data.deliveryDateText || null,

        trackingToken,
        tracking_token: trackingToken,

        trackingUrl: absoluteUrl(`/order/track/${trackingToken}`),
        tracking_url: absoluteUrl(`/order/track/${trackingToken}`),

        source: "telegram",
        telegramChatId: chatId,
        telegram_chat_id: chatId
      })} AS jsonb),
      NOW(),
      NOW()
    )
  `;

  await clearTelegramCart(chatId);
  await clearCheckoutSession(chatId);

  return {
    id: order.id,
    orderNumber,
    trackingToken,
    total
  };
}

async function handleCheckoutConfirm(chatId: number) {
  const session = await getCheckoutSession(chatId);

  if (!session) {
    await sendTelegramMessage(chatId, "Оформление заказа не найдено. Откройте корзину и начните заново.");
    return;
  }

  if (session.step !== "confirm") {
    await sendTelegramMessage(chatId, "Сначала заполните данные для оформления заказа.");
    return;
  }

  try {
    const order = await createOrderFromTelegramCheckout(chatId, session.data || {});

    if (!order) {
      await sendTelegramMessage(chatId, "Корзина пустая. Добавьте товар и попробуйте снова.");
      return;
    }

    await sendTelegramMessage(
      chatId,
      [
        "✅ Заказ создан",
        "",
        `Номер заказа: ${order.orderNumber}`,
        `Сумма: ${money(order.total)}`,
        "",
        "Менеджер проверит заказ и отправит ссылку на оплату после подтверждения.",
        "",
        `Отследить заказ: ${absoluteUrl(`/order/track/${order.trackingToken}`)}`
      ].join("\n"),
      {
        reply_markup: await mainKeyboardForChat(chatId)
      }
    );
  } catch (error) {
    console.error("[bot-worker] telegram checkout failed", error);

    await sendTelegramMessage(
      chatId,
      [
        "Не удалось создать заказ.",
        "Попробуйте ещё раз или напишите менеджеру."
      ].join("\n")
    );
  }
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
    created_at: string;
  }[]>`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.delivery_date,
      o.delivery_address_text,
      o.recipient_name,
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
      rows.push([
        {
          text: "📸 Загрузить фото",
          callback_data: `florist:photo:${order.id}`
        }
      ]);

      rows.push([
        {
          text: "✅ Готово",
          callback_data: `florist:ready:${order.id}`
        }
      ]);
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
        order.delivery_address_text ? `Адрес: ${order.delivery_address_text}` : ""
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

async function handleFloristProblemOrder(callbackQuery: TelegramCallbackQuery, orderId: string) {
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

  if (order.status === "delivered" || order.status === "cancelled") {
    await answerCallbackQuery(callbackQuery.id, "Заказ уже закрыт");
    return;
  }

  if (order.status === "problem") {
    await answerCallbackQuery(callbackQuery.id, "Проблема уже отмечена");
    return;
  }

  await sql`
    UPDATE orders
    SET status = 'problem',
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
      'problem',
      'Флорист отметил проблему через Telegram',
      NOW()
    )
  `;

  await answerCallbackQuery(callbackQuery.id, "Проблема отмечена");

  await sendTelegramMessage(
    chatId,
    [
      `⚠️ По заказу ${order.order_number} отмечена проблема`,
      "",
      "Статус в CRM изменён на «Проблема».",
      "Менеджеру нужно проверить заказ."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function downloadTelegramFile(fileId: string, fileNamePrefix: string) {
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
  const uploadDir = join(UPLOADS_DIR, "bouquets");
  const fullPath = join(uploadDir, fileName);
  const publicUrl = `/uploads/bouquets/${fileName}`;

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

    const publicUrl = await downloadTelegramFile(photo.file_id, `bouquet-${request.orderId}`);

    const updatedRows = await sql<{
      id: string;
      order_number: string;
      status: string;
      bouquet_photo_url: string | null;
    }[]>`
      UPDATE orders
      SET bouquet_photo_url = ${publicUrl},
          updated_at = NOW()
      WHERE id = ${request.orderId}
        AND shop_id = ${request.shopId}
        AND florist_id = ${request.userId}
        AND status IN ('assembling', 'ready')
      RETURNING id, order_number, status, bouquet_photo_url
    `;

    const updatedOrder = updatedRows[0];

    if (!updatedOrder) {
      pendingBouquetPhotoRequests.delete(chatId);

      await sendTelegramMessage(
        chatId,
        "Фото получено, но заказ уже недоступен для загрузки фото.",
        {
          reply_markup: await mainKeyboardForChat(chatId)
        }
      );

      return true;
    }

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
        ${request.shopId},
        ${updatedOrder.id},
        ${updatedOrder.status}::order_status,
        ${updatedOrder.status}::order_status,
        'Флорист загрузил фото готового букета через Telegram',
        NOW()
      )
    `;

    pendingBouquetPhotoRequests.delete(chatId);

    await sendTelegramMessage(
      chatId,
      [
        `✅ Фото по заказу ${updatedOrder.order_number} сохранено`,
        "",
        "Фото теперь отображается в CRM-карточке заказа.",
        `Ссылка: ${absoluteUrl(publicUrl)}`
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "✅ Готово",
              callback_data: `florist:ready:${updatedOrder.id}`
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

    return true;
  } catch (error) {
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

  if (order.status !== "assembling" && order.status !== "ready") {
    await answerCallbackQuery(callbackQuery.id, "Фото можно загрузить для заказа в сборке");
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
      "После отправки фото оно появится в CRM-карточке заказа."
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
  }[]>`
    SELECT id, order_number, status, florist_id, bouquet_photo_url
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

  await sql`
    UPDATE orders
    SET status = 'ready',
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
      'ready',
      'Флорист отметил заказ готовым через Telegram',
      NOW()
    )
  `;

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
    WHERE o.id = ${order.id}
      AND o.shop_id = ${profile.shop_id}
      AND o.courier_id IS NOT NULL
  `;

  await queueCustomerOrderNotification({
    shopId: profile.shop_id,
    orderId: order.id,
    type: "order_ready",
    status: "ready"
  });

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

async function handleCourierDeliveryOrders(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (!profile?.user_id) {
    await sendTelegramMessage(chatId, "🚚 Раздел доставки доступен только сотруднику.", {
      reply_markup: replyMarkup
    });
    return;
  }

  if (!["owner", "admin", "courier"].includes(profile.role || "")) {
    await sendTelegramMessage(chatId, "🚚 Раздел доставки доступен только курьеру.", {
      reply_markup: replyMarkup
    });
    return;
  }

  const orders = await sql<{
    id: string;
    order_number: string;
    status: string;
    delivery_date: string | null;
    delivery_interval_name: string | null;
    delivery_address_text: string | null;
    delivery_comment: string | null;
    recipient_name: string | null;
    recipient_phone: string | null;
    created_at: string;
  }[]>`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.delivery_date,
      di.name AS delivery_interval_name,
      o.delivery_address_text,
      o.delivery_comment,
      o.recipient_name,
      o.recipient_phone,
      o.created_at
    FROM orders o
    LEFT JOIN delivery_intervals di
      ON di.id = o.delivery_interval_id
     AND di.shop_id = o.shop_id
    WHERE o.shop_id = ${profile.shop_id}
      AND o.courier_id = ${profile.user_id}
      AND o.status IN ('ready', 'assigned_courier', 'delivering')
    ORDER BY
      CASE o.status
        WHEN 'ready' THEN 1
        WHEN 'assigned_courier' THEN 2
        WHEN 'delivering' THEN 3
        ELSE 4
      END,
      o.delivery_date NULLS LAST,
      o.created_at DESC
    LIMIT 10
  `;

  if (!orders.length) {
    await sendTelegramMessage(
      chatId,
      [
        "🚚 Доставка",
        "",
        "У вас пока нет активных доставок."
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
      "🚚 Доставка",
      "",
      `Активных доставок: ${orders.length}`,
      "Ниже отправляю карточки заказов."
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );

  for (const order of orders) {
    const rows: TelegramInlineKeyboardButton[][] = [];

    if (order.status === "ready") {
      rows.push([
        {
          text: "🚚 Принять доставку",
          callback_data: `courier:accept:${order.id}`
        }
      ]);
    }

    if (order.status === "assigned_courier") {
      rows.push([
        {
          text: "🚗 Выехал",
          callback_data: `courier:start:${order.id}`
        }
      ]);
    }

    if (order.status === "delivering") {
      rows.push([
        {
          text: "✅ Доставлено",
          callback_data: `courier:delivered:${order.id}`
        }
      ]);
    }

    const recipientPhone = normalizePhone(String(order.recipient_phone || ""));
    const recipientPhoneDigits = phoneDigitsOnly(recipientPhone);

    if (recipientPhoneDigits) {
      rows.push([
        {
          text: "WhatsApp",
          url: `https://wa.me/${recipientPhoneDigits}`
        }
      ]);
    }

    if (order.delivery_address_text) {
      const encodedAddress = encodeURIComponent(order.delivery_address_text);

      rows.push([
        {
          text: "Яндекс.Карты",
          url: `https://yandex.ru/maps/?text=${encodedAddress}`
        },
        {
          text: "Google Maps",
          url: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
        }
      ]);
    }

    rows.push([
      {
        text: "🔄 Обновить список",
        callback_data: "courier:list"
      }
    ]);

    const orderCardText = [
      `Заказ ${order.order_number}`,
      `Статус: ${orderStatusText(order.status)}`,
      order.delivery_date ? `Дата: ${shortDateText(order.delivery_date)}` : "",
      order.delivery_interval_name ? `Интервал: ${order.delivery_interval_name}` : "",
      order.delivery_address_text ? `Адрес: ${order.delivery_address_text}` : "",
      order.recipient_name ? `Получатель: ${order.recipient_name}` : "",
      order.recipient_phone ? `Телефон: ${order.recipient_phone}` : "",
      order.delivery_comment ? `Комментарий: ${order.delivery_comment}` : ""
    ].filter(Boolean).join("\n");

    try {
      await sendTelegramMessage(chatId, orderCardText, {
        reply_markup: inlineKeyboard(rows)
      });
    } catch (error) {
      console.error(`[bot-worker] failed to send courier order card order=${order.id}`, error);

      try {
        await sendTelegramMessage(
          chatId,
          [
            orderCardText,
            "",
            "Кнопки временно недоступны. Обновите раздел доставки через меню."
          ].join("\n")
        );
      } catch (fallbackError) {
        console.error(`[bot-worker] failed to send fallback courier order card order=${order.id}`, fallbackError);
      }
    }
  }
}

async function handleCourierStartDelivery(callbackQuery: TelegramCallbackQuery, orderId: string) {
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
    courier_id: string | null;
  }[]>`
    SELECT id, order_number, status, courier_id
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

  if (order.courier_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому курьеру");
    return;
  }

  if (order.status === "delivering") {
    await answerCallbackQuery(callbackQuery.id, "Вы уже в пути");

    await sendTelegramMessage(
      chatId,
      [
        `🚗 Вы уже в пути по заказу ${order.order_number}`,
        "",
        "После вручения заказа нажмите «Доставлено»."
      ].join("\n"),
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: "✅ Доставлено",
              callback_data: `courier:delivered:${order.id}`
            }
          ],
          [
            {
              text: "🔄 Обновить список",
              callback_data: "courier:list"
            }
          ]
        ])
      }
    );

    return;
  }

  if (order.status !== "assigned_courier") {
    await answerCallbackQuery(callbackQuery.id, "Сначала примите доставку");
    return;
  }

  await sql`
    UPDATE orders
    SET status = 'delivering',
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
      'delivering',
      'Курьер выехал на доставку через Telegram',
      NOW()
    )
  `;

  await queueCustomerOrderNotification({
    shopId: profile.shop_id,
    orderId: order.id,
    type: "order_delivering",
    status: "delivering"
  });

  await answerCallbackQuery(callbackQuery.id, "Статус: в доставке");

  await sendTelegramMessage(
    chatId,
    [
      `🚗 Вы выехали по заказу ${order.order_number}`,
      "",
      "Статус в CRM изменён на «В доставке».",
      "После вручения заказа нажмите «Доставлено»."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "✅ Доставлено",
            callback_data: `courier:delivered:${order.id}`
          }
        ],
        [
          {
            text: "🔄 Обновить список",
            callback_data: "courier:list"
          }
        ]
      ])
    }
  );
}

async function handleCourierDeliveredOrder(callbackQuery: TelegramCallbackQuery, orderId: string) {
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
    courier_id: string | null;
  }[]>`
    SELECT id, order_number, status, courier_id
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

  if (order.courier_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому курьеру");
    return;
  }

  if (order.status === "delivered") {
    await answerCallbackQuery(callbackQuery.id, "Заказ уже доставлен");
    return;
  }

  if (order.status !== "delivering") {
    await answerCallbackQuery(callbackQuery.id, "Сначала отметьте выезд");
    return;
  }

  await sql`
    UPDATE orders
    SET status = 'delivered',
        delivered_at = NOW(),
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
      'delivered',
      'Курьер отметил доставку через Telegram',
      NOW()
    )
  `;

  await queueCustomerOrderNotification({
    shopId: profile.shop_id,
    orderId: order.id,
    type: "order_delivered",
    status: "delivered"
  });

  await answerCallbackQuery(callbackQuery.id, "Заказ доставлен");

  await sendTelegramMessage(
    chatId,
    [
      `✅ Заказ ${order.order_number} доставлен`,
      "",
      "Статус в CRM изменён на «Доставлен»."
    ].join("\n"),
    {
      reply_markup: await mainKeyboardForChat(chatId)
    }
  );
}

async function handleCourierAcceptOrder(callbackQuery: TelegramCallbackQuery, orderId: string) {
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
    courier_id: string | null;
  }[]>`
    SELECT id, order_number, status, courier_id
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

  if (order.courier_id !== profile.user_id) {
    await answerCallbackQuery(callbackQuery.id, "Заказ назначен другому курьеру");
    return;
  }

  if (order.status === "assigned_courier") {
    await answerCallbackQuery(callbackQuery.id, "Доставка уже принята");
    await handleCourierDeliveryOrders(chatId);
    return;
  }

  if (order.status !== "ready") {
    await answerCallbackQuery(callbackQuery.id, "Заказ ещё не готов к доставке");
    return;
  }

  await sql`
    UPDATE orders
    SET status = 'assigned_courier',
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
      'assigned_courier',
      'Курьер принял доставку через Telegram',
      NOW()
    )
  `;

  await answerCallbackQuery(callbackQuery.id, "Доставка принята");

  await sendTelegramMessage(
    chatId,
    [
      `🚚 Доставка по заказу ${order.order_number} принята`,
      "",
      "Статус в CRM изменён на «Передан курьеру».",
      "Когда вы выедете к получателю, нажмите «Выехал»."
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [
          {
            text: "🚗 Выехал",
            callback_data: `courier:start:${order.id}`
          }
        ],
        [
          {
            text: "🔄 Обновить список",
            callback_data: "courier:list"
          }
        ]
      ])
    }
  );
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

  if (data.startsWith("courier:delivered:")) {
    const orderId = data.slice("courier:delivered:".length);
    await handleCourierDeliveredOrder(callbackQuery, orderId);
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
    const photoHandled = await handleFloristBouquetPhotoMessage(message);

    if (photoHandled) {
      return;
    }
  }

  const text = message.text?.trim();

  if (!text) {
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

    if (event.type === "order_ready") {
      return [
        `💐 Букет по заказу ${orderTitle} готов`,
        "",
        "Флорист собрал букет и прикрепил фото. Скоро передадим заказ курьеру.",
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
      return [
        `✅ Заказ ${orderTitle} доставлен`,
        "",
        "Спасибо, что выбрали ВЫБЕРИ МЕНЯ. Будем рады собрать следующий букет.",
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

async function getRecipients(event: NotificationEvent): Promise<string[]> {
  const directRecipient = valueToText(event.recipient_telegram_id).trim();

  if (event.recipient_type === "staff" && event.type === "order_confirmed") {
    return [];
  }

  if (directRecipient) {
    return [directRecipient];
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
      ORDER BY ta.telegram_id
    `;

    return rows.map((row) => row.telegram_id).filter(Boolean);
  }

  return [];
}

async function processNotificationEvents() {
  const events = await sql<NotificationEvent[]>`
    SELECT id, shop_id, order_id, type, channel, recipient_type, recipient_telegram_id, payload, attempts, created_at
    FROM notification_events
    WHERE status = 'pending'
      AND channel = 'telegram'
      AND attempts < 5
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
        throw new Error("No active Telegram staff recipients");
      }

      for (const chatId of recipients) {
        const payload = eventPayload(event);
        const productImageUrl = absoluteUrl(payloadValue(payload, "productImageUrl", "product_image_url"));
        const bouquetPhotoUrl = absoluteUrl(payloadValue(payload, "bouquetPhotoUrl", "bouquet_photo_url"));
        const orderId = payloadText(payload, "orderId", "order_id");
        const crmUrl = absoluteUrl(payloadValue(payload, "crmUrl", "crm_url"));
        const trackingUrl = absoluteUrl(payloadValue(payload, "trackingUrl", "tracking_url"));

        const deliveryAddressText = payloadText(payload, "deliveryAddressText", "delivery_address_text");
        const actionButtonRows: TelegramInlineKeyboardButton[][] = [];

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

        if ((event.type === "florist_order_assigned" || event.type === "courier_order_assigned") && crmUrl) {
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

        if (event.type === "florist_order_assigned" && productImageUrl) {
          await sendTelegramPhoto(chatId, productImageUrl, message);

          if (actionReplyMarkup) {
            await sendTelegramMessage(chatId, "Действие по заказу:", {
              reply_markup: actionReplyMarkup
            });
          }
        } else if (event.type === "order_ready" && bouquetPhotoUrl) {
          await sendTelegramPhoto(chatId, bouquetPhotoUrl, message, actionReplyMarkup ? {
            reply_markup: actionReplyMarkup
          } : undefined);
        } else if (actionReplyMarkup) {
          await sendTelegramMessage(chatId, message, {
            reply_markup: actionReplyMarkup
          });
        } else {
          await sendTelegramMessage(chatId, message);
        }
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
      const nextAttempts = Number(event.attempts || 0) + 1;
      const nextStatus = nextAttempts >= 5 ? "failed" : "pending";

      await sql`
        UPDATE notification_events
        SET status = ${nextStatus},
            attempts = attempts + 1,
            error = ${error instanceof Error ? error.message : String(error)},
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
