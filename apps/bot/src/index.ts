import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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

type TelegramMessage = {
  message_id: number;
  text?: string;
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
const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://viberimenya.ru";
const DEFAULT_SHOP_SLUG = process.env.DEFAULT_SHOP_SLUG || "viberimenya";

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

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, requestInit);

  const data = await response.json() as { ok: boolean; result?: T; description?: string };

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.statusText}`);
  }

  return data.result as T;
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

function staffMainKeyboard(role: string) {
  const rows = [
    [{ text: "🛍 Каталог" }, { text: "📦 Заказы" }],
    [{ text: "🔔 Уведомления" }, { text: "👤 Профиль" }]
  ];

  if (["owner", "admin", "manager"].includes(role)) {
    rows.push([{ text: "🧾 CRM" }, { text: "⚙️ Настройки" }]);
  }

  if (["owner", "admin", "florist"].includes(role)) {
    rows.push([{ text: "💐 Сборка заказов" }]);
  }

  if (["owner", "admin", "courier"].includes(role)) {
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

  return clientMainKeyboard();
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
      ta.user_id,
      ta.customer_id,
      su.role
    FROM telegram_accounts ta
    LEFT JOIN shop_users su ON su.user_id = ta.user_id AND su.is_active = true
    WHERE ta.telegram_id = ${telegramId}
      AND ta.is_active = true
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

async function handleCustomerProfile(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);
  const profile = await getTelegramProfile(String(chatId));

  if (profile?.user_id) {
    await sendTelegramMessage(
      chatId,
      [
        "👤 Профиль",
        "",
        "Вы вошли как сотрудник магазина.",
        `Роль: ${profile.role || "staff"}`,
        "",
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
        "👤 Профиль",
        "",
        "Личный кабинет покупателя пока не подключён.",
        "Оформите заказ на сайте и нажмите «Подключить Telegram» после оформления."
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
      reply_markup: inlineKeyboard([
        [{ text: "Открыть личный кабинет на сайте", url: loginUrl }]
      ])
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

async function handleUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  const text = message?.text?.trim();

  if (!message || message.chat.type !== "private" || !text) {
    return;
  }

  await ensureTelegramAccount(update);

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
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, "💐 Раздел сборки заказов закреплён за ролью флориста.", {
      reply_markup: replyMarkup
    });
    return;
  }

  if (text === "🚚 Доставка") {
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, "🚚 Раздел доставки закреплён за ролью курьера.", {
      reply_markup: replyMarkup
    });
    return;
  }

  if (text === "🔔 Уведомления") {
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, "🔔 Уведомления включены. Новые события по заказам будут приходить сюда.", {
      reply_markup: replyMarkup
    });
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

  const updates = await telegramApi<TelegramUpdate[]>(
    `getUpdates?timeout=${TELEGRAM_UPDATES_TIMEOUT_SECONDS}&limit=50${telegramOffset ? `&offset=${telegramOffset}` : ""}`
  );

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

        if (event.type === "florist_order_assigned" && productImageUrl) {
          await sendTelegramPhoto(chatId, productImageUrl, message);
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
