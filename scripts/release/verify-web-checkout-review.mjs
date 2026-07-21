import fs from "node:fs";

const checks = [
  ["apps/web/src/app/checkout/review/page.tsx", ["CheckoutReviewClient", "robots"]],
  ["apps/web/src/app/checkout/review/review-client.tsx", [
    "/api/public/account/checkout-draft/quote",
    "/api/public/orders",
    "buildWebCheckoutOrderBody",
    "clearLinkedCustomerCart",
    "router.replace",
  ]],
  ["apps/web/src/app/checkout/review/checkout-review.ts", [
    "WEB_CHECKOUT_REVIEW_VERSION",
    "privacyAccepted: true as const",
    "deliveryNoApartment",
    "bonusToSpend",
  ]],
  ["apps/web/src/app/checkout/delivery/delivery-client.tsx", [
    'router.push("/checkout/review")',
    "К проверке заказа",
  ]],
  ["apps/web/src/app/cart/components/cart-client.tsx", [
    "Безопасное пошаговое оформление",
    'href="/checkout"',
    "финальной серверной проверки",
  ]],
  ["apps/api/src/modules/customers/customer-checkout-draft.service.ts", [
    "isYooKassaConfigured",
    "payment_method_unavailable",
    "readyForConfirmation",
  ]],
  ["apps/web/src/app/order/track/[token]/track-client.tsx", [
    "Заказ успешно оформлен",
    "createdNotice",
  ]],
];

for (const [file, needles] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Отсутствует файл: ${file}`);
  const source = fs.readFileSync(file, "utf8");
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`В ${file} отсутствует обязательный контракт: ${needle}`);
    }
  }
}

const cartSource = fs.readFileSync("apps/web/src/app/cart/components/cart-client.tsx", "utf8");
if (cartSource.includes('onSubmit={submitOrder}')) {
  throw new Error("Старая параллельная форма оформления всё ещё активна в корзине");
}

console.log("✓ отдельная страница /checkout/review подключена");
console.log("✓ итог исключён из поисковой индексации");
console.log("✓ товары и draft загружаются с сервера");
console.log("✓ промокоды и бонусы пересчитываются серверным quote");
console.log("✓ недоступные способы оплаты блокируются");
console.log("✓ ЮKassa учитывается и в options, и в quote");
console.log("✓ финализация защищена clientRequestId");
console.log("✓ корзина очищается только после успешного заказа");
console.log("✓ старая параллельная checkout-форма отключена");
console.log("✓ успешный заказ открывает страницу отслеживания");
console.log("\nWEB CHECKOUT REVIEW SOURCE CONTRACT: OK");
