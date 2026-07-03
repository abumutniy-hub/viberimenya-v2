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

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
};

const DATABASE_URL = process.env.DATABASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DRY_RUN = process.env.BOT_DRY_RUN !== "false";
const RUN_ONCE = process.env.BOT_RUN_ONCE === "true";
const POLL_INTERVAL_MS = Number(process.env.BOT_POLL_INTERVAL_MS || 15000);
const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://viberimenya.ru";

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

  const chatId = message.chat.id;
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
        "Выберите нужный раздел:"
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
      "Добро пожаловать в магазин цветов.",
      "Здесь можно выбрать букет, оформить заказ, отслеживать доставку и пользоваться бонусами.",
      "",
      "Выберите раздел:"
    ].join("\n"),
    {
      reply_markup: clientMainKeyboard()
    }
  );
}

async function handleCatalog(chatId: number) {
  const categories = await sql<{ name: string; slug: string }[]>`
    SELECT name, slug
    FROM categories
    WHERE is_active = true
    ORDER BY sort_order ASC, name ASC
  `;

  const replyMarkup = await mainKeyboardForChat(chatId);

  if (categories.length === 0) {
    await sendTelegramMessage(chatId, "Каталог пока наполняется.", {
      reply_markup: replyMarkup
    });
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "🛍 Каталог",
      "",
      "Выберите раздел каталога:",
      "",
      ...categories.map((category, index) => `${index + 1}. ${category.name}`),
      "",
      `Открыть каталог на сайте: ${SITE_URL}/catalog`
    ].join("\n"),
    {
      reply_markup: replyMarkup
    }
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

async function handleUpdate(update: TelegramUpdate) {
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
    const replyMarkup = await mainKeyboardForChat(message.chat.id);
    await sendTelegramMessage(message.chat.id, `🧺 Корзина доступна на сайте: ${SITE_URL}/cart`, {
      reply_markup: replyMarkup
    });
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
    `getUpdates?timeout=1&limit=20${telegramOffset ? `&offset=${telegramOffset}` : ""}`
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
  console.log(`[bot-worker] started dryRun=${DRY_RUN} runOnce=${RUN_ONCE} tokenSet=${Boolean(TELEGRAM_BOT_TOKEN)}`);

  while (!isStopping) {
    await processNotificationEvents();
    await processTelegramUpdates();

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
