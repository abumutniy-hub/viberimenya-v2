import {
  TELEGRAM_CHECKOUT_FLOW_CREATES_ORDER,
  TELEGRAM_CHECKOUT_PROGRESS_TOTAL,
  normalizeTelegramBonus,
  normalizeTelegramPromoCode,
  telegramCheckoutCallbackFits,
  telegramCheckoutDateChoices,
  telegramCheckoutEditStep,
  telegramCheckoutPreviousStep,
  telegramCheckoutProgress,
} from "./customer-checkout-flow";

function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const empty = {};

assertCondition(TELEGRAM_CHECKOUT_FLOW_CREATES_ORDER === false, "Этап 1B не должен создавать заказ");
assertCondition(TELEGRAM_CHECKOUT_PROGRESS_TOTAL === 9, "Неверное число групп прогресса");
assertCondition(telegramCheckoutProgress("customer_name").current === 1, "Покупатель должен быть первым шагом");
assertCondition(telegramCheckoutProgress("confirm").current === 9, "Проверка должна быть последним шагом");
pass("прогресс оформления стабилен и не создаёт финальный заказ");

assertCondition(telegramCheckoutPreviousStep("customer_phone", empty) === "customer_name", "Назад от телефона");
assertCondition(telegramCheckoutPreviousStep("delivery_type", { recipientSameAsCustomer: true }) === "recipient_mode", "Назад для получателя-покупателя");
assertCondition(telegramCheckoutPreviousStep("card_text", { deliveryType: "pickup" }) === "delivery_type", "Назад для самовывоза");
assertCondition(telegramCheckoutPreviousStep("confirm", empty) === "privacy", "Назад с проверки");
pass("кнопка Назад учитывает ветки доставки и получателя");

assertCondition(telegramCheckoutEditStep("customer") === "customer_name", "Редактирование покупателя");
assertCondition(telegramCheckoutEditStep("delivery") === "delivery_type", "Редактирование доставки");
assertCondition(telegramCheckoutEditStep("unknown") === null, "Неизвестный раздел должен отклоняться");
pass("итоговый экран поддерживает адресное редактирование разделов");

const dates = telegramCheckoutDateChoices("2026-07-20", 7);
assertCondition(dates.length === 7, "Должно быть семь быстрых дат");
assertCondition(dates[0]?.iso === "2026-07-20", "Первая дата должна быть сегодня");
assertCondition(dates[1]?.iso === "2026-07-21", "Вторая дата должна быть завтра");
assertCondition(dates.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.iso)), "Неверный ISO формат даты");
pass("календарь предлагает только детерминированные ISO-даты");

assertCondition(normalizeTelegramPromoCode(" summer 10 ") === "SUMMER10", "Промокод должен нормализоваться");
assertCondition(normalizeTelegramPromoCode("-") === "", "Минус должен отключать промокод");
assertCondition(normalizeTelegramBonus("все", 450) === 450, "Нужно уметь списать все бонусы");
assertCondition(normalizeTelegramBonus("999", 450) === 450, "Бонусы должны ограничиваться балансом");
assertCondition(normalizeTelegramBonus("ошибка", 450) === null, "Невалидные бонусы должны отклоняться");
pass("промокод и бонусы нормализуются безопасно");

for (const callback of [
  "checkout:recipient:self",
  "checkout:delivery_service:standard",
  "checkout:date:2026-07-20",
  "checkout:address:new",
  "checkout:edit:delivery",
  "checkout:continue_site",
]) {
  assertCondition(telegramCheckoutCallbackFits(callback), `Callback превышает 64 байта: ${callback}`);
}
pass("все новые callback data укладываются в лимит Telegram");

console.log("\nCUSTOMER TELEGRAM CHECKOUT FLOW E2E: OK");
console.log("Проверены прогресс, Назад, редактирование, даты, промокод, бонусы и callback limits.");
console.log("Реальные заказы и Telegram-сообщения не создавались.");
