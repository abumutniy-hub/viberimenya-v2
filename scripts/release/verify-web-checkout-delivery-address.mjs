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

const [
  page,
  client,
  helper,
  cart,
  publicRoutes,
  service,
  draftService,
  botCore,
  botFinalization,
] = await Promise.all([
  source("apps/web/src/app/checkout/delivery/page.tsx"),
  source("apps/web/src/app/checkout/delivery/delivery-client.tsx"),
  source("apps/web/src/app/checkout/delivery/checkout-delivery.ts"),
  source("apps/web/src/app/cart/components/cart-client.tsx"),
  source("apps/api/src/routes/public.ts"),
  source("apps/api/src/modules/delivery/address-suggestions.service.ts"),
  source("apps/api/src/modules/customers/customer-checkout-draft.service.ts"),
  source("apps/bot/src/customer-checkout-draft-core.ts"),
  source("apps/bot/src/customer-order-finalization.ts"),
]);

requireText(page, "<CheckoutDeliveryClient />", "отдельная страница доставки подключена");
requireText(page, "index: false", "страница доставки исключена из индексации");
requireText(client, "address-suggestions", "клиент использует защищённый proxy подсказок");
requireText(client, "350", "подсказки имеют debounce");
requireText(client, "Подтвердить адрес вручную", "есть fallback ручного адреса");
requireText(client, "Частный дом / квартиры нет", "поддержан адрес без квартиры");
requireText(client, "expectedRevision", "autosave защищён revision control");
requireText(helper, "deliveryAddressFiasId", "структурированный адрес хранится в draft");
requireText(helper, "preserveWebCheckoutDeliveryStep", "поздний progress не откатывается");
requireText(cart, "deliveryAddressDetails", "корзина восстанавливает структурированный адрес");
requireText(cart, "submittedDeliveryDate", "корзина восстанавливает дату доставки");
requireText(publicRoutes, "/api/public/account/address-suggestions", "API proxy подсказок зарегистрирован");
requireText(publicRoutes, "addressDetails: deliveryAddressDetails", "заказ хранит структурированный адрес в metadata");
requireText(publicRoutes, "resolvedDeliveryComment", "детали подъезда попадают курьеру");
requireText(service, "Authorization: `Token ${token}`", "ключ провайдера используется только API");
requireText(service, "AbortController", "внешний запрос ограничен тайм-аутом");
requireText(draftService, "deliveryIntercom", "server draft сохраняет домофон");
requireText(botCore, "deliveryAddressProvider", "Telegram draft понимает новый адрес");
requireText(botFinalization, "deliveryNoApartment", "Telegram финализация передаёт детали адреса");

console.log("\nWEB CHECKOUT DELIVERY ADDRESS SOURCE CONTRACT: OK");
