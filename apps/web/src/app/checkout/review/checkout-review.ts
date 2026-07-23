export const WEB_CHECKOUT_REVIEW_VERSION = 1;

export type WebCheckoutPaymentMethod =
  | "cash_on_delivery"
  | "transfer_after_confirm"
  | "online_card"
  | "sbp";

export type WebCheckoutContactPreference =
  | "call_or_message"
  | "phone_call"
  | "messenger_only";

export type WebCheckoutDraftStep =
  | "customer_name"
  | "customer_phone"
  | "recipient_mode"
  | "recipient_name"
  | "recipient_phone"
  | "delivery_type"
  | "delivery_service"
  | "delivery_zone"
  | "delivery_date"
  | "delivery_interval"
  | "delivery_address"
  | "card_text"
  | "surprise"
  | "contact_preference"
  | "payment_method"
  | "promo_code"
  | "bonus"
  | "comment"
  | "privacy"
  | "confirm";

export type CheckoutPaymentOptions = {
  online: boolean;
  cash: boolean;
  transfer: boolean;
};

export type WebCheckoutReviewData = {
  cardText: string;
  isSurprise: boolean;
  doNotCallRecipient: boolean;
  contactPreference: WebCheckoutContactPreference;
  paymentMethod: WebCheckoutPaymentMethod;
  promoCode: string;
  bonusToSpend: number;
  comment: string;
  privacyAccepted: boolean;
};

export type WebCheckoutReviewIssue = {
  code: string;
  field:
    | "paymentMethod"
    | "promoCode"
    | "bonusToSpend"
    | "cardText"
    | "comment"
    | "privacyAccepted"
    | "items";
  message: string;
};

export type CheckoutDraftOrderData = Partial<WebCheckoutReviewData> & {
  clientRequestId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  recipientSameAsCustomer?: boolean;
  recipientName?: string;
  recipientPhone?: string;
  deliveryType?: "delivery" | "pickup";
  deliveryService?: "standard" | "express";
  deliveryZoneId?: string;
  deliveryDateText?: string;
  deliveryIntervalId?: string;
  deliveryInterval?: string;
  deliveryAddress?: string;
  deliveryAddressSelected?: boolean;
  deliveryAddressProvider?: "dadata" | "saved" | "manual";
  deliveryAddressFiasId?: string;
  deliveryAddressKladrId?: string;
  deliveryAddressPostalCode?: string;
  deliveryAddressRegion?: string;
  deliveryAddressCity?: string;
  deliveryAddressSettlement?: string;
  deliveryAddressStreet?: string;
  deliveryAddressHouse?: string;
  deliveryAddressBlock?: string;
  deliveryAddressLatitude?: string;
  deliveryAddressLongitude?: string;
  deliveryAddressGeoQuality?: string;
  deliveryApartment?: string;
  deliveryEntrance?: string;
  deliveryFloor?: string;
  deliveryIntercom?: string;
  deliveryNoApartment?: boolean;
  deliveryComment?: string;
};

export type CheckoutOrderItem = {
  productId: string;
  quantity: number;
};

const STEP_ORDER: Record<WebCheckoutDraftStep, number> = {
  customer_name: 1,
  customer_phone: 2,
  recipient_mode: 3,
  recipient_name: 4,
  recipient_phone: 5,
  delivery_type: 6,
  delivery_service: 7,
  delivery_zone: 8,
  delivery_date: 9,
  delivery_interval: 10,
  delivery_address: 11,
  card_text: 12,
  surprise: 13,
  contact_preference: 14,
  payment_method: 15,
  promo_code: 16,
  bonus: 17,
  comment: 18,
  privacy: 19,
  confirm: 20,
};

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function integer(value: unknown, minimum = 0, maximum = 1_000_000_000) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function availableWebCheckoutPaymentMethods(
  options: CheckoutPaymentOptions,
): WebCheckoutPaymentMethod[] {
  const methods: WebCheckoutPaymentMethod[] = [];

  // Онлайн-оплата должна быть основным сценарием, когда ЮKassa включена.
  // Ручной перевод и оплата при получении остаются доступными как явный выбор.
  if (options.online) methods.push("online_card", "sbp");
  if (options.transfer || (!options.online && !options.cash)) {
    methods.push("transfer_after_confirm");
  }
  if (options.cash) methods.push("cash_on_delivery");

  return methods;
}

export function normalizeWebCheckoutReviewData(
  value: Partial<WebCheckoutReviewData> | null | undefined,
  options: CheckoutPaymentOptions,
): WebCheckoutReviewData {
  const available = availableWebCheckoutPaymentMethods(options);
  const requested = value?.paymentMethod;
  const paymentMethod = requested && available.includes(requested)
    ? requested
    : available[0] || "transfer_after_confirm";

  return {
    cardText: text(value?.cardText, 500),
    isSurprise: value?.isSurprise === true,
    doNotCallRecipient: value?.doNotCallRecipient === true,
    contactPreference:
      value?.contactPreference === "phone_call"
      || value?.contactPreference === "messenger_only"
        ? value.contactPreference
        : "call_or_message",
    paymentMethod,
    promoCode: text(value?.promoCode, 80).toUpperCase(),
    bonusToSpend: integer(value?.bonusToSpend),
    comment: text(value?.comment, 2000),
    privacyAccepted: value?.privacyAccepted === true,
  };
}

export function validateWebCheckoutReview(
  value: WebCheckoutReviewData,
  options: CheckoutPaymentOptions,
  itemCount: number,
) {
  const issues: WebCheckoutReviewIssue[] = [];
  const available = availableWebCheckoutPaymentMethods(options);

  if (itemCount <= 0) {
    issues.push({
      code: "cart_empty",
      field: "items",
      message: "Корзина пуста",
    });
  }

  if (!available.includes(value.paymentMethod)) {
    issues.push({
      code: "payment_unavailable",
      field: "paymentMethod",
      message: "Выбранный способ оплаты сейчас недоступен",
    });
  }

  if (value.cardText.length > 500) {
    issues.push({
      code: "card_text_too_long",
      field: "cardText",
      message: "Текст открытки должен быть не длиннее 500 символов",
    });
  }

  if (value.comment.length > 2000) {
    issues.push({
      code: "comment_too_long",
      field: "comment",
      message: "Комментарий должен быть не длиннее 2000 символов",
    });
  }

  if (value.privacyAccepted !== true) {
    issues.push({
      code: "privacy_required",
      field: "privacyAccepted",
      message: "Подтвердите согласие с условиями магазина",
    });
  }

  return { valid: issues.length === 0, issues };
}

export function buildWebCheckoutReviewPatch(value: WebCheckoutReviewData) {
  return {
    cardText: text(value.cardText, 500),
    isSurprise: value.isSurprise === true,
    doNotCallRecipient: value.doNotCallRecipient === true,
    contactPreference: value.contactPreference,
    paymentMethod: value.paymentMethod,
    promoCode: text(value.promoCode, 80).toUpperCase(),
    bonusToSpend: integer(value.bonusToSpend),
    comment: text(value.comment, 2000),
    privacyAccepted: value.privacyAccepted === true,
  };
}

export function preserveWebCheckoutReviewStep(
  current: WebCheckoutDraftStep | null | undefined,
  desired: WebCheckoutDraftStep = "payment_method",
): WebCheckoutDraftStep {
  if (!current) return desired;
  return STEP_ORDER[current] >= STEP_ORDER[desired] ? current : desired;
}

export function webCheckoutReviewFingerprint(value: WebCheckoutReviewData) {
  return JSON.stringify(buildWebCheckoutReviewPatch(value));
}

export function buildWebCheckoutOrderBody(
  data: CheckoutDraftOrderData,
  items: CheckoutOrderItem[],
) {
  const customerName = text(data.customerName, 160);
  const customerPhone = text(data.customerPhone, 32);
  const recipientSameAsCustomer = data.recipientSameAsCustomer === true;
  const deliveryType = data.deliveryType === "pickup" ? "pickup" : "delivery";
  const normalizedItems = items
    .map((item) => ({
      productId: text(item.productId, 80),
      quantity: integer(item.quantity, 1, 99),
    }))
    .filter((item) => item.productId)
    .sort((left, right) => left.productId.localeCompare(right.productId));

  if (!text(data.clientRequestId, 80)) {
    throw new Error("Черновик заказа устарел. Вернитесь к контактам и сохраните данные заново.");
  }
  if (!customerName || !customerPhone) {
    throw new Error("Не заполнены контакты покупателя");
  }
  if (normalizedItems.length === 0) {
    throw new Error("Корзина пуста");
  }

  return {
    clientRequestId: text(data.clientRequestId, 80),
    customerName,
    customerPhone,
    customerEmail: text(data.customerEmail, 255),
    recipientSameAsCustomer,
    recipientName: recipientSameAsCustomer
      ? customerName
      : text(data.recipientName, 160),
    recipientPhone: recipientSameAsCustomer
      ? customerPhone
      : text(data.recipientPhone, 32),
    isSurprise: recipientSameAsCustomer ? false : data.isSurprise === true,
    doNotCallRecipient:
      recipientSameAsCustomer ? false : data.doNotCallRecipient === true,
    cardText: text(data.cardText, 500),
    contactPreference:
      data.contactPreference === "phone_call"
      || data.contactPreference === "messenger_only"
        ? data.contactPreference
        : "call_or_message",
    deliveryType,
    deliveryService: data.deliveryService === "express" ? "express" : "standard",
    deliveryAddress: deliveryType === "delivery" ? text(data.deliveryAddress, 1000) : "",
    deliveryAddressSelected:
      deliveryType === "delivery" && data.deliveryAddressSelected === true,
    deliveryAddressProvider:
      data.deliveryAddressProvider === "dadata"
      || data.deliveryAddressProvider === "saved"
        ? data.deliveryAddressProvider
        : "manual",
    deliveryAddressFiasId: text(data.deliveryAddressFiasId, 64),
    deliveryAddressKladrId: text(data.deliveryAddressKladrId, 32),
    deliveryAddressPostalCode: text(data.deliveryAddressPostalCode, 16),
    deliveryAddressRegion: text(data.deliveryAddressRegion, 160),
    deliveryAddressCity: text(data.deliveryAddressCity, 160),
    deliveryAddressSettlement: text(data.deliveryAddressSettlement, 160),
    deliveryAddressStreet: text(data.deliveryAddressStreet, 255),
    deliveryAddressHouse: text(data.deliveryAddressHouse, 60),
    deliveryAddressBlock: text(data.deliveryAddressBlock, 60),
    deliveryAddressLatitude: text(data.deliveryAddressLatitude, 32),
    deliveryAddressLongitude: text(data.deliveryAddressLongitude, 32),
    deliveryAddressGeoQuality: text(data.deliveryAddressGeoQuality, 8),
    deliveryApartment: text(data.deliveryApartment, 60),
    deliveryEntrance: text(data.deliveryEntrance, 60),
    deliveryFloor: text(data.deliveryFloor, 60),
    deliveryIntercom: text(data.deliveryIntercom, 120),
    deliveryNoApartment: data.deliveryNoApartment === true,
    deliveryComment: deliveryType === "delivery" ? text(data.deliveryComment, 1000) : "",
    deliveryDate: deliveryType === "delivery" ? text(data.deliveryDateText, 10) : "",
    deliveryIntervalId: deliveryType === "delivery" ? text(data.deliveryIntervalId, 80) : "",
    deliveryIntervalText: deliveryType === "delivery" ? text(data.deliveryInterval, 80) : "",
    deliveryZoneId: deliveryType === "delivery" ? text(data.deliveryZoneId, 80) : "",
    paymentMethod:
      data.paymentMethod === "cash_on_delivery"
      || data.paymentMethod === "online_card"
      || data.paymentMethod === "sbp"
        ? data.paymentMethod
        : "transfer_after_confirm",
    customerComment: text(data.comment, 2000),
    promoCode: text(data.promoCode, 80).toUpperCase(),
    bonusToSpend: integer(data.bonusToSpend),
    privacyAccepted: true as const,
    items: normalizedItems,
  };
}
