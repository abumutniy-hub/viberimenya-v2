import type {
  TelegramCheckoutDraftData,
} from "./customer-checkout-draft-core";

export const TELEGRAM_ORDER_FINALIZATION_VERSION = 1;
export const TELEGRAM_ORDER_FINALIZATION_ENABLED = true;

export type TelegramFinalizationCartItem = {
  product_id: string;
  quantity: number;
};

export type TelegramOrderCreateBody = {
  clientRequestId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  recipientSameAsCustomer: boolean;
  recipientName: string;
  recipientPhone: string;
  isSurprise: boolean;
  doNotCallRecipient: boolean;
  cardText: string;
  contactPreference: "call_or_message" | "phone_call" | "messenger_only";
  deliveryType: "delivery" | "pickup";
  deliveryService: "standard" | "express";
  deliveryAddress: string;
  deliveryAddressSelected: boolean;
  deliveryAddressProvider: "dadata" | "saved" | "manual";
  deliveryAddressFiasId: string;
  deliveryAddressKladrId: string;
  deliveryAddressPostalCode: string;
  deliveryAddressRegion: string;
  deliveryAddressCity: string;
  deliveryAddressSettlement: string;
  deliveryAddressStreet: string;
  deliveryAddressHouse: string;
  deliveryAddressBlock: string;
  deliveryAddressLatitude: string;
  deliveryAddressLongitude: string;
  deliveryAddressGeoQuality: string;
  deliveryApartment: string;
  deliveryEntrance: string;
  deliveryFloor: string;
  deliveryIntercom: string;
  deliveryNoApartment: boolean;
  deliveryComment: string;
  deliveryDate: string;
  deliveryIntervalId: string;
  deliveryIntervalText: string;
  deliveryZoneId: string;
  paymentMethod: "cash_on_delivery" | "transfer_after_confirm" | "online_card" | "sbp";
  customerComment: string;
  promoCode: string;
  bonusToSpend: number;
  privacyAccepted: true;
  items: Array<{ productId: string; quantity: number }>;
};

export type TelegramFinalizedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  discountTotal: number;
  bonusSpent: number;
  promoCode: string;
  deliveryPrice: number;
  deliveryTariffName: string;
  deliveryIsExpress: boolean;
  trackingToken: string;
  paymentMethod: string;
  reused: boolean;
};

export class TelegramOrderFinalizationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "TelegramOrderFinalizationError";
    this.statusCode = statusCode;
  }
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function positiveInteger(value: unknown) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(99, number) : 0;
}

function required(value: unknown, message: string) {
  const text = stringValue(value);
  if (!text) throw new TelegramOrderFinalizationError(message, 400);
  return text;
}

export function buildTelegramOrderCreateBody(
  draft: TelegramCheckoutDraftData,
  cartItems: TelegramFinalizationCartItem[],
): TelegramOrderCreateBody {
  const clientRequestId = required(
    draft.clientRequestId,
    "У черновика отсутствует идентификатор. Начните оформление заново.",
  );
  const customerName = required(draft.customerName, "Укажите имя покупателя");
  const customerPhone = required(draft.customerPhone, "Укажите телефон покупателя");
  const deliveryType = draft.deliveryType === "pickup" ? "pickup" : "delivery";
  const recipientSameAsCustomer = draft.recipientSameAsCustomer === true;
  const recipientName = recipientSameAsCustomer
    ? customerName
    : required(draft.recipientName, "Укажите имя получателя");
  const recipientPhone = recipientSameAsCustomer
    ? customerPhone
    : required(draft.recipientPhone, "Укажите телефон получателя");
  const items = cartItems
    .map((item) => ({
      productId: stringValue(item.product_id),
      quantity: positiveInteger(item.quantity),
    }))
    .filter((item) => item.productId && item.quantity > 0)
    .sort((left, right) => left.productId.localeCompare(right.productId));

  if (items.length === 0) {
    throw new TelegramOrderFinalizationError("Корзина пуста", 409);
  }

  return {
    clientRequestId,
    customerName,
    customerPhone,
    customerEmail: stringValue(draft.customerEmail),
    recipientSameAsCustomer,
    recipientName,
    recipientPhone,
    isSurprise: draft.isSurprise === true,
    doNotCallRecipient: draft.doNotCallRecipient === true,
    cardText: stringValue(draft.cardText),
    contactPreference:
      draft.contactPreference === "phone_call"
      || draft.contactPreference === "messenger_only"
        ? draft.contactPreference
        : "call_or_message",
    deliveryType,
    deliveryService: draft.deliveryService === "express" ? "express" : "standard",
    deliveryAddress: stringValue(draft.deliveryAddress),
    deliveryAddressSelected: draft.deliveryAddressSelected === true,
    deliveryAddressProvider:
      draft.deliveryAddressProvider === "dadata"
      || draft.deliveryAddressProvider === "saved"
        ? draft.deliveryAddressProvider
        : "manual",
    deliveryAddressFiasId: stringValue(draft.deliveryAddressFiasId),
    deliveryAddressKladrId: stringValue(draft.deliveryAddressKladrId),
    deliveryAddressPostalCode: stringValue(draft.deliveryAddressPostalCode),
    deliveryAddressRegion: stringValue(draft.deliveryAddressRegion),
    deliveryAddressCity: stringValue(draft.deliveryAddressCity),
    deliveryAddressSettlement: stringValue(draft.deliveryAddressSettlement),
    deliveryAddressStreet: stringValue(draft.deliveryAddressStreet),
    deliveryAddressHouse: stringValue(draft.deliveryAddressHouse),
    deliveryAddressBlock: stringValue(draft.deliveryAddressBlock),
    deliveryAddressLatitude: stringValue(draft.deliveryAddressLatitude),
    deliveryAddressLongitude: stringValue(draft.deliveryAddressLongitude),
    deliveryAddressGeoQuality: stringValue(draft.deliveryAddressGeoQuality),
    deliveryApartment: stringValue(draft.deliveryApartment),
    deliveryEntrance: stringValue(draft.deliveryEntrance),
    deliveryFloor: stringValue(draft.deliveryFloor),
    deliveryIntercom: stringValue(draft.deliveryIntercom),
    deliveryNoApartment: draft.deliveryNoApartment === true,
    deliveryComment: stringValue(draft.deliveryComment),
    deliveryDate: deliveryType === "delivery" ? stringValue(draft.deliveryDateText) : "",
    deliveryIntervalId:
      deliveryType === "delivery" ? stringValue(draft.deliveryIntervalId) : "",
    deliveryIntervalText:
      deliveryType === "delivery" ? stringValue(draft.deliveryInterval) : "",
    deliveryZoneId: deliveryType === "delivery" ? stringValue(draft.deliveryZoneId) : "",
    paymentMethod:
      draft.paymentMethod === "cash_on_delivery"
      || draft.paymentMethod === "online_card"
      || draft.paymentMethod === "sbp"
        ? draft.paymentMethod
        : "transfer_after_confirm",
    customerComment: stringValue(draft.comment),
    promoCode: stringValue(draft.promoCode).toUpperCase(),
    bonusToSpend: Math.max(0, Math.trunc(Number(draft.bonusToSpend || 0))),
    privacyAccepted: true,
    items,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readTelegramFinalizedOrder(payload: unknown): TelegramFinalizedOrder {
  const root = record(payload);
  const order = record(root.order);
  const id = stringValue(order.id);
  const orderNumber = stringValue(order.orderNumber);
  const trackingToken = stringValue(order.trackingToken);

  if (root.ok !== true || !id || !orderNumber || !trackingToken) {
    throw new TelegramOrderFinalizationError(
      stringValue(root.message) || stringValue(root.error) || "Не удалось создать заказ",
      500,
    );
  }

  return {
    id,
    orderNumber,
    status: stringValue(order.status, "new"),
    totalAmount: Math.max(0, Number(order.totalAmount || 0)),
    discountTotal: Math.max(0, Number(order.discountTotal || 0)),
    bonusSpent: Math.max(0, Number(order.bonusSpent || 0)),
    promoCode: stringValue(order.promoCode),
    deliveryPrice: Math.max(0, Number(order.deliveryPrice || 0)),
    deliveryTariffName: stringValue(order.deliveryTariffName, "Доставка"),
    deliveryIsExpress: order.deliveryIsExpress === true,
    trackingToken,
    paymentMethod: stringValue(order.paymentMethod, "transfer_after_confirm"),
    reused: order.reused === true,
  };
}

export function readTelegramOrderError(payload: unknown, statusCode: number) {
  const root = record(payload);
  return new TelegramOrderFinalizationError(
    stringValue(root.message)
      || stringValue(root.error)
      || `Не удалось создать заказ: HTTP ${statusCode}`,
    statusCode,
  );
}
