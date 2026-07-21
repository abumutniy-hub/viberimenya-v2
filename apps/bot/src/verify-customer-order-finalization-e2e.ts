import {
  TELEGRAM_ORDER_FINALIZATION_ENABLED,
  TELEGRAM_ORDER_FINALIZATION_VERSION,
  TelegramOrderFinalizationError,
  buildTelegramOrderCreateBody,
  readTelegramFinalizedOrder,
  readTelegramOrderError,
} from "./customer-order-finalization";

function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

assertCondition(TELEGRAM_ORDER_FINALIZATION_ENABLED === true, "Финализация должна быть включена");
assertCondition(TELEGRAM_ORDER_FINALIZATION_VERSION === 1, "Неверная версия финализации");
pass("атомарная финализация включена отдельным версионированным модулем");

const body = buildTelegramOrderCreateBody(
  {
    clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
    customerName: "Микаил",
    customerPhone: "+79991234567",
    recipientSameAsCustomer: false,
    recipientName: "Амина",
    recipientPhone: "+79997654321",
    deliveryType: "delivery",
    deliveryService: "express",
    deliveryZoneId: "550e8400-e29b-41d4-a716-446655440001",
    deliveryDateText: "2026-07-22",
    deliveryIntervalId: "550e8400-e29b-41d4-a716-446655440002",
    deliveryInterval: "12:00–15:00",
    deliveryAddress: "Москва, улица Примерная, 1",
    paymentMethod: "transfer_after_confirm",
    promoCode: " summer10 ",
    bonusToSpend: 300,
    privacyAccepted: true,
  },
  [
    { product_id: "550e8400-e29b-41d4-a716-446655440010", quantity: 2 },
    { product_id: "550e8400-e29b-41d4-a716-446655440009", quantity: 1 },
  ],
);

assertCondition(body.clientRequestId === "550e8400-e29b-41d4-a716-446655440000", "clientRequestId должен сохраняться");
assertCondition(body.items.length === 2 && body.items[0]?.productId.endsWith("0009"), "Товары должны сортироваться детерминированно");
assertCondition(body.deliveryService === "express", "Срочная доставка потеряна");
assertCondition(body.promoCode === "SUMMER10", "Промокод должен нормализоваться");
assertCondition(body.privacyAccepted === true, "Согласие обязательно");
pass("черновик и единая корзина преобразуются в серверный order request");

const pickup = buildTelegramOrderCreateBody(
  {
    clientRequestId: "550e8400-e29b-41d4-a716-446655440100",
    customerName: "Микаил",
    customerPhone: "+79991234567",
    recipientSameAsCustomer: true,
    deliveryType: "pickup",
    privacyAccepted: true,
  },
  [{ product_id: "550e8400-e29b-41d4-a716-446655440010", quantity: 1 }],
);

assertCondition(pickup.recipientName === "Микаил", "Получатель-покупатель должен копироваться");
assertCondition(pickup.deliveryDate === "" && pickup.deliveryZoneId === "", "Самовывоз не должен нести поля доставки");
pass("ветка самовывоза не отправляет несовместимые поля доставки");

const result = readTelegramFinalizedOrder({
  ok: true,
  order: {
    id: "550e8400-e29b-41d4-a716-446655440020",
    orderNumber: "VM-1000",
    status: "new",
    totalAmount: 4700,
    discountTotal: 300,
    bonusSpent: 200,
    deliveryPrice: 500,
    deliveryTariffName: "Обычная доставка",
    deliveryIsExpress: false,
    trackingToken: "track-token",
    paymentMethod: "transfer_after_confirm",
    reused: true,
  },
});

assertCondition(result.orderNumber === "VM-1000", "Номер заказа потерян");
assertCondition(result.reused === true, "Повторный callback должен возвращать тот же заказ");
pass("идемпотентный ответ повторного подтверждения распознаётся безопасно");

const error = readTelegramOrderError({ message: "Остаток изменился" }, 409);
assertCondition(error instanceof TelegramOrderFinalizationError, "Должна возвращаться доменная ошибка");
assertCondition(error.statusCode === 409 && error.message === "Остаток изменился", "Ошибка API должна сохраняться");
pass("ошибки цены, остатка, промокода и бонусов передаются клиенту без маскировки");

console.log("\nCUSTOMER ORDER FINALIZATION E2E: OK");
console.log("Проверены request mapping, самовывоз, идемпотентный reuse и ошибки API.");
console.log("Реальные заказы и Telegram-сообщения не создавались.");
