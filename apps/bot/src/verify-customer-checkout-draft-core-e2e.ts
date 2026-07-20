import {
  normalizeTelegramCheckoutDraftData,
  prepareTelegramCheckoutDraftData,
  telegramCheckoutDraftExpired,
} from "./customer-checkout-draft-core";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const chatId = "79990001122";
const customerId = "11111111-1111-4111-8111-111111111111";
const initial = prepareTelegramCheckoutDraftData({
  previous: {},
  next: {
    customerName: "Клиент",
    customerPhone: "+79990000000",
    promoCode: "FLOWERS10",
    bonusToSpend: 500,
    cardText: "С любовью",
  },
  customerId,
  telegramChatId: chatId,
  operationId: "operation-one",
  now: new Date("2026-07-20T20:00:00.000Z"),
});

assertCondition(initial._core?.revision === 1, "Первый revision не равен 1");
assertCondition(initial._core?.customerId === customerId, "Customer ID не сохранён");
assertCondition(initial._core?.telegramChatId === chatId, "Telegram chat ID не сохранён");
assertCondition(initial.clientRequestId, "Client request ID не создан");
pass("первый draft получает identity, revision, TTL и clientRequestId");

const siteUpdated = normalizeTelegramCheckoutDraftData({
  ...initial,
  deliveryType: "delivery",
  deliveryService: "express",
  deliveryDateText: "2026-07-25",
  deliveryAddress: "Москва, улица Тестовая, 1",
  _core: {
    ...initial._core,
    sourceChannel: "site",
    revision: 2,
    quote: {
      quotedAt: "2026-07-20T20:05:00.000Z",
      cartFingerprint: "cart-hash",
      quoteHash: "quote-hash",
      itemCount: 1,
      quantityCount: 2,
      subtotal: 10000,
      minimumOrderAmount: 0,
      deliveryPrice: 500,
      deliveryTariffName: "Обычная доставка",
      discountTotal: 1000,
      promoCode: "FLOWERS10",
      bonusRequested: 500,
      bonusAvailable: 800,
      bonusApplied: 500,
      total: 9000,
      currency: "RUB",
      readyForConfirmation: true,
      issues: [],
    },
  },
}, {
  customerId,
  telegramChatId: chatId,
});

const telegramUpdated = prepareTelegramCheckoutDraftData({
  previous: siteUpdated,
  next: {
    comment: "Позвонить перед доставкой",
  },
  customerId,
  telegramChatId: chatId,
  operationId: "operation-two",
  now: new Date("2026-07-20T21:00:00.000Z"),
});

assertCondition(telegramUpdated._core?.revision === 3, "Revision не увеличен");
assertCondition(telegramUpdated.deliveryAddress === siteUpdated.deliveryAddress, "Telegram потерял поле сайта");
assertCondition(telegramUpdated.promoCode === "FLOWERS10", "Промокод потерян");
assertCondition(telegramUpdated.cardText === "С любовью", "Открытка потеряна");
assertCondition(telegramUpdated.comment === "Позвонить перед доставкой", "Telegram patch не применён");
assertCondition(telegramUpdated._core?.quote === null, "Старый quote не сброшен после изменения");
pass("Telegram patch сохраняет поля сайта и сбрасывает устаревший quote");

assertCondition(
  !telegramCheckoutDraftExpired(
    telegramUpdated,
    Date.parse("2026-07-21T20:59:59.000Z"),
  ),
  "Draft истёк раньше 24 часов",
);
assertCondition(
  telegramCheckoutDraftExpired(
    telegramUpdated,
    Date.parse("2026-07-21T21:00:01.000Z"),
  ),
  "Draft не истёк после TTL",
);
pass("TTL черновика составляет 24 часа");

const sanitized = normalizeTelegramCheckoutDraftData({
  customerName: "x".repeat(500),
  bonusToSpend: -100,
  paymentMethod: "malicious",
  contactPreference: "malicious",
  _core: {
    revision: -10,
    sourceChannel: "malicious",
  },
}, {
  customerId,
  telegramChatId: chatId,
});
assertCondition(sanitized.customerName?.length === 160, "Имя не ограничено");
assertCondition(sanitized.bonusToSpend === 0, "Отрицательные бонусы разрешены");
assertCondition(!sanitized.paymentMethod, "Недопустимый способ оплаты сохранён");
assertCondition(!sanitized.contactPreference, "Недопустимый способ связи сохранён");
assertCondition(sanitized._core?.revision === 0, "Отрицательный revision сохранён");
pass("невалидные поля нормализуются до безопасных значений");

console.log("\nCUSTOMER CHECKOUT DRAFT CORE BOT E2E: OK");
console.log("Проверены merge, revision, TTL, quote invalidation и sanitization.");
console.log("Реальные Telegram-сообщения не отправлялись.");
