import {
  WEB_CHECKOUT_REVIEW_VERSION,
  availableWebCheckoutPaymentMethods,
  buildWebCheckoutOrderBody,
  buildWebCheckoutReviewPatch,
  normalizeWebCheckoutReviewData,
  preserveWebCheckoutReviewStep,
  validateWebCheckoutReview,
} from "./checkout-review";

function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

assertCondition(WEB_CHECKOUT_REVIEW_VERSION === 1, "Неверная версия review flow");
pass("финальный web checkout включён отдельным версионированным модулем");

const methods = availableWebCheckoutPaymentMethods({
  cashOnDelivery: true,
  transferAfterConfirm: true,
  onlineCard: true,
  sbp: true,
});
assertCondition(
  methods.join(",") === "online_card,sbp,transfer_after_confirm,cash_on_delivery",
  "Способы оплаты должны сохранять стабильный порядок",
);
pass("доступные способы оплаты формируются из серверных настроек");

const normalized = normalizeWebCheckoutReviewData({
  paymentMethod: "online_card",
  promoCode: " summer10 ",
  bonusToSpend: 350.9,
  cardText: "  С праздником!  ",
  privacyAccepted: true,
}, {
  cashOnDelivery: false,
  transferAfterConfirm: true,
  onlineCard: false,
  sbp: false,
});
assertCondition(
  normalized.paymentMethod === "transfer_after_confirm",
  "Недоступный способ оплаты должен заменяться доступным",
);
assertCondition(normalized.promoCode === "SUMMER10", "Промокод должен нормализоваться");
assertCondition(normalized.bonusToSpend === 350, "Бонусы должны быть целым числом");
pass("данные итогового шага нормализуются безопасно");

const patch = buildWebCheckoutReviewPatch({
  ...normalized,
  paymentMethod: "transfer_after_confirm",
  promoCode: " vip15 ",
  privacyAccepted: true,
});
assertCondition(patch.promoCode === "VIP15", "Patch должен сохранять нормализованный промокод");
assertCondition(patch.privacyAccepted === true, "Согласие должно сохраняться явно");
pass("итоговый patch готов к общему checkout draft");

assertCondition(
  preserveWebCheckoutReviewStep("delivery_address") === "payment_method",
  "После доставки должен открываться платёжный шаг",
);
assertCondition(
  preserveWebCheckoutReviewStep("confirm") === "confirm",
  "Поздний progress нельзя откатывать",
);
pass("редактирование итогового шага не откатывает поздний progress");

const validation = validateWebCheckoutReview({
  ...normalized,
  paymentMethod: "transfer_after_confirm",
  privacyAccepted: false,
}, {
  cashOnDelivery: false,
  transferAfterConfirm: true,
  onlineCard: false,
  sbp: false,
}, 1);
assertCondition(
  validation.valid === false
    && validation.issues.some((issue) => issue.field === "privacyAccepted"),
  "Финализация без согласия должна блокироваться",
);
pass("клиентская проверка блокирует заказ без согласия");

const body = buildWebCheckoutOrderBody({
  clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
  customerName: "Микаил",
  customerPhone: "+79991234567",
  customerEmail: "test@example.com",
  recipientSameAsCustomer: false,
  recipientName: "Амина",
  recipientPhone: "+79997654321",
  isSurprise: true,
  doNotCallRecipient: true,
  contactPreference: "messenger_only",
  cardText: "С праздником!",
  deliveryType: "delivery",
  deliveryService: "express",
  deliveryZoneId: "550e8400-e29b-41d4-a716-446655440001",
  deliveryDateText: "2026-07-22",
  deliveryIntervalId: "550e8400-e29b-41d4-a716-446655440002",
  deliveryInterval: "12:00–15:00",
  deliveryAddress: "г Москва, ул Примерная, д 1",
  deliveryAddressSelected: true,
  deliveryAddressProvider: "dadata",
  deliveryAddressFiasId: "fias-test",
  deliveryAddressHouse: "1",
  deliveryApartment: "15",
  deliveryEntrance: "2",
  deliveryFloor: "5",
  deliveryIntercom: "15К",
  deliveryComment: "Вход со двора",
  paymentMethod: "sbp",
  promoCode: " summer10 ",
  bonusToSpend: 300,
  comment: "Связаться в мессенджере",
  privacyAccepted: true,
}, [
  { productId: "550e8400-e29b-41d4-a716-446655440010", quantity: 2 },
  { productId: "550e8400-e29b-41d4-a716-446655440009", quantity: 1 },
]);

assertCondition(body.items[0]?.productId.endsWith("0009"), "Товары должны сортироваться детерминированно");
assertCondition(body.paymentMethod === "sbp", "Выбранный способ оплаты потерян");
assertCondition(body.promoCode === "SUMMER10", "Промокод потерян при финализации");
assertCondition(body.deliveryApartment === "15" && body.deliveryIntercom === "15К", "Структурированный адрес потерян");
assertCondition(body.privacyAccepted === true, "Order request должен содержать согласие");
pass("черновик и единая корзина преобразуются в атомарный order request");

const pickup = buildWebCheckoutOrderBody({
  clientRequestId: "550e8400-e29b-41d4-a716-446655440100",
  customerName: "Микаил",
  customerPhone: "+79991234567",
  recipientSameAsCustomer: true,
  deliveryType: "pickup",
  paymentMethod: "cash_on_delivery",
  privacyAccepted: true,
}, [{ productId: "550e8400-e29b-41d4-a716-446655440010", quantity: 1 }]);
assertCondition(
  pickup.deliveryAddress === ""
    && pickup.deliveryDate === ""
    && pickup.deliveryZoneId === "",
  "Самовывоз не должен отправлять поля курьерской доставки",
);
pass("самовывоз финализируется без несовместимых полей доставки");

console.log("\nWEB CHECKOUT REVIEW E2E: OK");
console.log("Проверены payment availability, validation, draft patch, progress и order request mapping.");
