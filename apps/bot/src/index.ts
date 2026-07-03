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
      [{ text: "☎️ Связь" }]
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
    username: string | null;
    first_name: string | null;
    user_id: string | null;
    customer_id: string | null;
    role: string | null;
  }[]>`
    SELECT
      ta.telegram_id,
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

  const telegramId = String(message.from.id);
  const existing = await getTelegramProfile(telegramId);

  if (existing) {
    await sql`
      UPDATE telegram_accounts
      SET username = ${message.from.username || null},
          first_name = ${message.from.first_name || null},
          last_name = ${message.from.last_name || null},
          updated_at = NOW()
      WHERE telegram_id = ${telegramId}
    `;
  }
}

async function handleStart(update: TelegramUpdate) {
  const message = update.message;
  if (!message) return;

  await handleOpenMenu(message.chat.id, true);
}

async function handleOpenMenu(chatId: number, isStart = false) {
  const telegramId = String(chatId);
  const profile = await getTelegramProfile(telegramId);

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

async function handleOrders(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);

  await sendTelegramMessage(
    chatId,
    [
      "📦 Заказы",
      "",
      "Для сотрудников заказы доступны в CRM.",
      `CRM: ${SITE_URL}/admin`,
      "",
      "Для клиента отслеживание заказа доступно по ссылке после оформления."
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
  );
}

async function handleBonuses(chatId: number) {
  const replyMarkup = await mainKeyboardForChat(chatId);

  await sendTelegramMessage(
    chatId,
    [
      "🎁 Бонусы",
      "",
      "Бонусная система уже работает на сайте.",
      "Баланс отображается в личном кабинете после подтверждения телефона.",
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
    await sendTelegramMessage(
      chatId,
      [
        "✅ Оформление заказа",
        "",
        "Корзина уже работает в боте.",
        "Следующим блоком добавим пошаговое оформление: имя, телефон, получатель, дата, интервал и адрес доставки."
      ].join("\n")
    );
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

  if (text === "/start" || text === "👤 Профиль") {
    await handleStart(update);
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

function formatEvent(event: NotificationEvent): string {
  const p = event.payload || {};
  const orderNumber = valueToText(p.orderNumber) || "без номера";
  const trackingUrl = absoluteUrl(p.trackingUrl);
  const paymentUrl = absoluteUrl(p.paymentUrl);

  if (event.type === "order_created") {
    return [
      `🆕 Новый заказ ${orderNumber}`,
      `Клиент: ${valueToText(p.customerName)}`,
      `Телефон: ${valueToText(p.customerPhone)}`,
      `Сумма: ${money(p.totalAmount)}`,
      trackingUrl ? `Заказ: ${trackingUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  if (event.type === "order_confirmed") {
    return [
      `✅ Заказ подтверждён ${orderNumber}`,
      `Статус оплаты: ${valueToText(p.paymentStatus)}`,
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

async function processNotificationEvents() {
  const events = await sql<NotificationEvent[]>`
    SELECT id, type, channel, recipient_type, recipient_telegram_id, payload, attempts, created_at
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
        await sendTelegramMessage(chatId, message);
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
