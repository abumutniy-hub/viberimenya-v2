import { readFile, access } from "node:fs/promises";

const paths = {
  api: "apps/api/src/routes/public.ts",
  cartService: "apps/api/src/modules/customers/customer-commerce-cart.service.ts",
  guestService: "apps/api/src/modules/customers/customer-guest-checkout.service.ts",
  guestTest: "apps/api/src/verify-guest-checkout-e2e.ts",
  cart: "apps/web/src/app/cart/components/cart-client.tsx",
  contacts: "apps/web/src/app/checkout/checkout-client.tsx",
  delivery: "apps/web/src/app/checkout/delivery/delivery-client.tsx",
  review: "apps/web/src/app/checkout/review/review-client.tsx",
  track: "apps/web/src/app/order/track/[token]/track-client.tsx",
  css: "apps/web/src/app/globals.css",
};

await Promise.all(Object.values(paths).map((path) => access(path)));
const source = Object.fromEntries(
  await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")])),
);

const checks = [
  [source.guestService.includes('GUEST_CHECKOUT_COOKIE = "vm_guest_checkout"'), "гостевой checkout использует отдельную cookie"],
  [source.guestService.includes("24 * 60 * 60") && source.guestService.includes("randomUUID"), "cookie имеет 24-часовой TTL и случайный токен"],
  [source.guestService.includes('return `-${positive.toString()}`'), "гостевой scope отделён от положительных Telegram ID"],
  [source.api.includes("function ensureGuestCheckoutScope") && source.api.includes("HttpOnly; Path=/; SameSite=Lax"), "cookie защищена HttpOnly и SameSite=Lax"],
  [source.api.includes("async function resolveSiteCheckoutContext"), "сайт использует единый resolver гостя и Telegram-клиента"],
  [source.api.includes('app.get("/api/public/account/checkout-options"') && source.api.includes("resolveSiteCheckoutContext(client"), "настройки checkout доступны гостю"],
  [source.api.includes('app.get("/api/public/account/checkout-draft"') && source.api.includes("telegramChatId: context.telegramChatId") && !source.api.includes("Подключите Telegram, чтобы синхронизировать оформление."), "черновик больше не требует Telegram"],
  [source.api.includes('app.get("/api/public/account/cart"') && source.api.includes("customerId: context.customerId"), "серверная корзина работает в гостевом scope"],
  [source.cartService.includes("customerId: string | null"), "синхронизация корзины принимает гостя без customerId"],
  [source.contacts.includes("Оформление доступно без регистрации") && !source.contacts.includes('pageState === "unauthorized"') && !source.contacts.includes('pageState === "telegram_required"'), "контакты не блокируются авторизацией"],
  [source.contacts.includes('authenticated ? "Подтверждённый телефон" : "Ваш телефон *"') && source.contacts.includes("readOnly={authenticated}"), "гость вводит телефон, а подтверждённый Telegram-профиль защищён"],
  [!source.delivery.includes('pageState === "unauthorized"') && !source.delivery.includes('pageState === "telegram_required"'), "доставка доступна без входа"],
  [!source.review.includes('pageState === "unauthorized"') && !source.review.includes('pageState === "telegram_required"'), "итог и создание заказа доступны без входа"],
  [source.review.includes("telegramLinkCode") && source.review.includes("viberimenya_order_telegram_code"), "код подключения Telegram сохраняется после заказа"],
  [source.track.includes("Подключите Telegram") && source.track.includes("viberimenya_bot"), "страница заказа предлагает бесплатную Telegram-авторизацию"],
  [!source.api.includes('source: "order_created"') && !source.api.includes('source: "order_reuse"'), "гостевой заказ не выдаёт полную сессию без Telegram-подтверждения"],
  [source.api.includes("mayUpdateCustomerProfile") && source.api.includes("activeCustomerSession?.customer_id === customer.id"), "чужой профиль не перезаписывается по одному номеру"],
  [source.cart.includes("Оформить заказ") && !source.cart.includes(">Начать<"), "в корзине оставлена одна понятная кнопка оформления"],
  [source.css.includes(".checkout-submit-button") && source.css.includes("color: #fff"), "основная кнопка имеет читаемый контраст"],
  [source.guestTest.includes("GUEST CHECKOUT IDENTITY E2E: OK"), "добавлен E2E-контракт гостевой идентичности"],
];

let failed = false;
for (const [ok, label] of checks) {
  if (!ok) {
    failed = true;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

if (failed) process.exit(1);
console.log("\nGUEST CHECKOUT + TELEGRAM AUTH SOURCE CONTRACT: OK");
