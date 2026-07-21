import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

const provider = await text("apps/api/src/modules/payments/payment-provider.ts");
const yookassa = await text("apps/api/src/modules/payments/yookassa.service.ts");
const routes = await text("apps/api/src/routes/payments.ts");
const expiry = await text("apps/api/src/modules/payments/payment-expiry.service.ts");
const finance = await text("apps/api/src/modules/orders/order-finance.service.ts");
const payment = await text("apps/api/src/modules/orders/order-payment.service.ts");
const migration = await text("packages/db/drizzle/0002_payment_core_yookassa.sql");
const schema = await text("packages/db/src/schema.ts");
const envExample = await text(".env.example");
const bot = await text("apps/bot/src/index.ts");

for (const method of ["createPayment", "getPayment", "cancelPayment", "createRefund", "getRefund"]) {
  assertCondition(provider.includes(method), `Provider interface не содержит ${method}`);
}
assertCondition(provider.includes("parseDecimalAmountMinor"), "Отсутствует строгий parser суммы");
pass("provider contract содержит полный платёжный и refund API");

assertCondition(yookassa.includes('headers["Idempotence-Key"]'), "Запросы ЮKassa не используют Idempotence-Key");
assertCondition(yookassa.includes("cancelYooKassaPayment"), "Отсутствует отмена платежа у провайдера");
assertCondition(yookassa.includes("/^https:\\/\\//i"), "Confirmation URL не ограничен HTTPS");
assertCondition(yookassa.includes("metadata"), "Платёж не содержит metadata заказа и магазина");
pass("адаптер ЮKassa использует идемпотентность, HTTPS и metadata");

const webhookIndex = routes.indexOf('/api/public/payments/yookassa/webhook');
const refetchIndex = routes.indexOf("yooKassaProvider.getPayment", webhookIndex);
const reconcileIndex = routes.indexOf("reconcileProviderPayment", refetchIndex);
assertCondition(webhookIndex >= 0 && refetchIndex > webhookIndex && reconcileIndex > refetchIndex, "Webhook не перечитывает платёж у ЮKassa");
for (const invariant of [
  "params.providerPayment.amountMinor !== expectedAmountMinor",
  'params.providerPayment.currency !== "RUB"',
  "params.providerPayment.shopId !== params.order.shop_id",
  "params.providerPayment.orderId !== params.order.order_id",
]) {
  assertCondition(routes.includes(invariant), `Отсутствует проверка: ${invariant}`);
}
pass("webhook не доверяет входящему телу и сверяет сумму, валюту, shop и order");

const verifyProvider = expiry.indexOf("yooKassaProvider.getPayment");
const cancelProvider = expiry.indexOf("yooKassaProvider.cancelPayment", verifyProvider);
const localExpiry = expiry.indexOf("expireOne(client", cancelProvider);
assertCondition(verifyProvider >= 0 && cancelProvider > verifyProvider && localExpiry > cancelProvider, "Локальное истечение выполняется до проверки/отмены provider payment");
assertCondition(expiry.includes("rollbackOrderFinancialsOnCancellation"), "Истечение не возвращает финансовые резервы");
assertCondition(expiry.includes("order_payment_expired"), "Истечение не создаёт уведомление");
assertCondition(expiry.includes("payment.expired"), "Истечение не создаёт payment event");
pass("expiry worker сверяет провайдера до локального rollback и создаёт события");

for (const invariant of ["bonusReturned", "promoRestored", "releasedUnits"]) {
  assertCondition(finance.includes(invariant), `Финансовый rollback не содержит ${invariant}`);
}
assertCondition(payment.includes("payment_status"), "Сервис подтверждения оплаты не обновляет payment status");
pass("финансовая компенсация охватывает товары, бонусы и промокод");

for (const value of ["created", "waiting_for_capture", "partially_refunded", "expired"]) {
  assertCondition(migration.includes(`ADD VALUE '${value}'`) || schema.includes(`"${value}"`), `Статус ${value} отсутствует`);
}
for (const index of [
  "payments_provider_payment_uidx",
  "payments_provider_idempotency_uidx",
  "payments_order_attempt_uidx",
  "payment_events_payment_idem_uidx",
]) {
  assertCondition(migration.includes(index) && schema.includes(index), `Индекс ${index} не согласован`);
}
pass("migration и Drizzle schema согласованы по статусам и уникальности");

assertCondition(/^YOOKASSA_SECRET_KEY=$/m.test(envExample), "В .env.example Secret Key должен быть пустым");
assertCondition(/^YOOKASSA_TEST_MODE=true$/m.test(envExample), "В .env.example должен быть безопасный test mode");
assertCondition(/^PAYMENT_PENDING_TTL_MINUTES=180$/m.test(envExample), "TTL оплаты должен быть задокументирован");
assertCondition(!/live_[A-Za-z0-9_-]{10,}/.test(envExample), "В .env.example обнаружен похожий на боевой ключ");
pass("пример окружения не содержит секретов и включает test mode");

assertCondition(bot.includes('event.type === "payment_link_added"'), "BOT не обрабатывает payment_link_added");
assertCondition(bot.includes('event.type === "order_payment_expired"'), "BOT не обрабатывает order_payment_expired");
assertCondition(bot.includes("💳 Оплатить заказ"), "BOT не показывает кнопку оплаты");
pass("Telegram поддерживает ссылку оплаты и истечение платежа");

console.log("\nPAYMENT CORE SOURCE CONTRACT: OK");
console.log("Проверены provider, webhook, expiry, rollback, migration, env safety и Telegram CTA.");
