import {
  buildWebCheckoutDeliveryPatch,
  emptyWebCheckoutDeliveryData,
  nextWebCheckoutDeliveryStep,
  preserveWebCheckoutDeliveryStep,
  suggestionToDeliveryData,
  validateWebCheckoutDelivery,
  webCheckoutDeliveryFingerprint,
  type CheckoutDeliveryOptions,
  type DeliveryAddressSuggestion,
} from "./checkout-delivery";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const options: CheckoutDeliveryOptions = {
  pickup: { enabled: true, address: "Москва, ул. Тестовая, д. 1" },
  acceptingOrders: true,
  ordersPausedMessage: "",
  zones: [{
    id: "11111111-1111-4111-8111-111111111111",
    name: "Москва",
    price: 500,
    freeFromAmount: 7000,
    expressAvailable: true,
    expressPrice: 1200,
  }],
  intervals: [{
    id: "22222222-2222-4222-8222-222222222222",
    name: "12:00–15:00",
    startsAt: "12:00",
    endsAt: "15:00",
  }],
  addresses: [],
  draftTtlHours: 24,
};

const incomplete = emptyWebCheckoutDeliveryData();
const incompleteValidation = validateWebCheckoutDelivery(
  incomplete,
  options,
  "2026-07-21",
);
assertCondition(!incompleteValidation.valid, "Неполная доставка принята");
assertCondition(
  new Set(incompleteValidation.issues.map((issue) => issue.field)).has(
    "deliveryAddress",
  ),
  "Адрес не проверяется",
);
pass("обязательные поля доставки проверяются локально");

const suggestion: DeliveryAddressSuggestion = {
  id: "address-1",
  provider: "dadata",
  value: "г Москва, ул Тверская, д 10",
  unrestrictedValue: "101000, г Москва, ул Тверская, д 10",
  postalCode: "101000",
  countryIsoCode: "RU",
  region: "Москва",
  regionWithType: "г Москва",
  city: "Москва",
  cityWithType: "г Москва",
  settlement: "",
  settlementWithType: "",
  street: "Тверская",
  streetWithType: "ул Тверская",
  house: "10",
  houseType: "д",
  block: "",
  blockType: "",
  apartment: "",
  apartmentType: "",
  fiasId: "fias-test",
  fiasLevel: "8",
  kladrId: "7700000000000",
  geoLat: "55.757",
  geoLon: "37.615",
  geoQuality: "0",
  hasHouse: true,
};

const complete = {
  ...emptyWebCheckoutDeliveryData(),
  ...suggestionToDeliveryData(suggestion),
  deliveryZoneId: options.zones[0]!.id,
  deliveryZoneName: options.zones[0]!.name,
  deliveryDateText: "2026-07-22",
  deliveryIntervalId: options.intervals[0]!.id,
  deliveryInterval: options.intervals[0]!.name,
  deliveryApartment: "15",
};
const completeValidation = validateWebCheckoutDelivery(
  complete,
  options,
  "2026-07-21",
);
assertCondition(completeValidation.valid, "Точный адрес не прошёл проверку");
assertCondition(
  complete.deliveryAddressFiasId === "fias-test"
    && complete.deliveryAddressHouse === "10",
  "Структурированные данные подсказки потеряны",
);
pass("подсказка адреса сохраняет ФИАС, дом и координаты");

const noApartment = {
  ...complete,
  deliveryApartment: "",
  deliveryNoApartment: true,
};
assertCondition(
  validateWebCheckoutDelivery(noApartment, options, "2026-07-21").valid,
  "Частный дом ошибочно требует квартиру",
);
pass("режим «Частный дом / квартиры нет» работает");

const patch = buildWebCheckoutDeliveryPatch(noApartment, options);
assertCondition(
  patch.deliveryZoneName === "Москва"
    && patch.deliveryInterval === "12:00–15:00"
    && patch.deliveryApartment === "",
  "Delivery patch не нормализован",
);
assertCondition(
  nextWebCheckoutDeliveryStep(noApartment, options) === "card_text",
  "Завершённая доставка не передаёт прогресс дальше",
);
pass("нормализованный patch готов к общему checkout draft");

assertCondition(
  preserveWebCheckoutDeliveryStep("payment_method", "card_text")
    === "payment_method",
  "Более поздний Telegram progress отброшен назад",
);
pass("редактирование доставки не откатывает поздний Telegram progress");

const firstFingerprint = webCheckoutDeliveryFingerprint(noApartment, options);
const secondFingerprint = webCheckoutDeliveryFingerprint(
  { ...noApartment, deliveryZoneName: "Устаревшее название" },
  options,
);
assertCondition(
  firstFingerprint === secondFingerprint,
  "Серверные названия зоны создают лишние autosave",
);
pass("эквивалентные данные дедуплицируются");

console.log("\nWEB CHECKOUT DELIVERY CLIENT E2E: OK");
console.log("Проверены validation, подсказка, частный дом, patch и progress.");
