import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

function requireText(text, value, message) {
  if (!text.includes(value)) throw new Error(message);
  console.log(`✓ ${message}`);
}

const [page, client, helper, cart, shell, publicRoutes, service] = await Promise.all([
  source("apps/web/src/app/checkout/page.tsx"),
  source("apps/web/src/app/checkout/checkout-client.tsx"),
  source("apps/web/src/app/checkout/checkout-customer-recipient.ts"),
  source("apps/web/src/app/cart/components/cart-client.tsx"),
  source("apps/web/src/app/components/public-shell.tsx"),
  source("apps/api/src/routes/public.ts"),
  source("apps/api/src/modules/customers/customer-checkout-draft.service.ts"),
]);

requireText(page, "<CheckoutClient />", "отдельная страница /checkout подключена");
requireText(page, "index: false", "checkout исключён из поисковой индексации");
requireText(client, "/api/public/account/checkout-draft", "страница использует серверный общий draft");
requireText(client, "expectedRevision", "site autosave защищён revision control");
requireText(client, "checkout_draft_conflict", "конфликт между устройствами обрабатывается");
requireText(client, "recipientSameAsCustomer", "поддержан отдельный получатель и режим «я»");
requireText(client, "Продолжить к доставке", "контакты передают управление этапу доставки");
requireText(helper, "preserveWebCheckoutProgressStep", "более поздний Telegram progress не откатывается");
requireText(helper, "webCheckoutContactFingerprint", "эквивалентные autosave данные дедуплицируются");
requireText(cart, "Контакты покупателя и получателя восстановлены", "корзина восстанавливает общий draft");
requireText(cart, 'href="/checkout"', "корзина содержит вход в пошаговое оформление");
requireText(cart, 'id="checkout-delivery"', "продолжение открывает реальный раздел доставки");
requireText(shell, 'pathname.startsWith("/checkout")', "checkout разрешён оболочкой и отмечает корзину активной");
requireText(publicRoutes, "contactValidation", "API возвращает серверную проверку контактов");
requireText(service, "validateCustomerCheckoutDraftContacts", "контакты проверяются сервером");
requireText(service, "customer_email_invalid", "сервер проверяет необязательный email");

console.log("\nWEB CHECKOUT CUSTOMER RECIPIENT SOURCE CONTRACT: OK");
