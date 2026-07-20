export const CUSTOMER_MENU_TEXT = {
  catalog: "🛍 Каталог",
  cart: "🧺 Корзина",
  orders: "📦 Мои заказы",
  profile: "👤 Профиль",
  bonuses: "🎁 Бонусы",
  more: "☰ Ещё",
  addresses: "🏠 Адреса",
  favorites: "❤️ Любимые",
  support: "💬 Поддержка",
  link: "🔗 Привязать аккаунт",
} as const;

export type CustomerMenuText =
  (typeof CUSTOMER_MENU_TEXT)[keyof typeof CUSTOMER_MENU_TEXT];

const CUSTOMER_MENU_COMMANDS = new Set<string>([
  ...Object.values(CUSTOMER_MENU_TEXT),
  "📦 Заказы",
  "☎️ Связь",
  "/menu",
]);

export function isCustomerMenuCommand(value: string) {
  return CUSTOMER_MENU_COMMANDS.has(value);
}

export function clientMainKeyboard() {
  return {
    keyboard: [
      [
        { text: CUSTOMER_MENU_TEXT.catalog },
        { text: CUSTOMER_MENU_TEXT.cart },
        { text: CUSTOMER_MENU_TEXT.orders },
      ],
      [
        { text: CUSTOMER_MENU_TEXT.profile },
        { text: CUSTOMER_MENU_TEXT.bonuses },
        { text: CUSTOMER_MENU_TEXT.more },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    is_persistent: false,
    input_field_placeholder: "Выберите раздел",
  };
}

export function unlinkedMainKeyboard() {
  return clientMainKeyboard();
}

export function customerLinkInstructions() {
  return [
    "Введите код, который показан на сайте.",
    "",
    "Код действует ограниченное время и используется только один раз.",
  ].join("\n");
}
