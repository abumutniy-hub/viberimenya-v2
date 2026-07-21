export const WEB_CHECKOUT_CUSTOMER_RECIPIENT_VERSION = 1;

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

export type WebCheckoutCustomerRecipientData = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  contactPreference: WebCheckoutContactPreference;
  recipientSameAsCustomer: boolean;
  recipientName: string;
  recipientPhone: string;
  isSurprise: boolean;
  doNotCallRecipient: boolean;
};

export type WebCheckoutContactIssue = {
  code: string;
  field:
    | "customerName"
    | "customerPhone"
    | "customerEmail"
    | "recipientName"
    | "recipientPhone";
  message: string;
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

export function normalizeWebCheckoutPhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return `+${digits}`;
  }

  return String(value || "").trim().slice(0, 32);
}

export function webCheckoutPhoneIsValid(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function webCheckoutEmailIsValid(value: string) {
  const email = String(value || "").trim();

  if (!email) return true;

  return email.length <= 255
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateWebCheckoutCustomerRecipient(
  value: WebCheckoutCustomerRecipientData,
) {
  const issues: WebCheckoutContactIssue[] = [];
  const customerName = value.customerName.trim();
  const customerPhone = normalizeWebCheckoutPhone(value.customerPhone);
  const customerEmail = value.customerEmail.trim();
  const recipientName = value.recipientSameAsCustomer
    ? customerName
    : value.recipientName.trim();
  const recipientPhone = value.recipientSameAsCustomer
    ? customerPhone
    : normalizeWebCheckoutPhone(value.recipientPhone);

  if (customerName.length < 2) {
    issues.push({
      code: "customer_name_required",
      field: "customerName",
      message: "Укажите имя покупателя",
    });
  }

  if (!webCheckoutPhoneIsValid(customerPhone)) {
    issues.push({
      code: "customer_phone_required",
      field: "customerPhone",
      message: "Укажите корректный телефон покупателя",
    });
  }

  if (!webCheckoutEmailIsValid(customerEmail)) {
    issues.push({
      code: "customer_email_invalid",
      field: "customerEmail",
      message: "Проверьте адрес электронной почты",
    });
  }

  if (recipientName.length < 2) {
    issues.push({
      code: "recipient_name_required",
      field: "recipientName",
      message: "Укажите имя получателя",
    });
  }

  if (!webCheckoutPhoneIsValid(recipientPhone)) {
    issues.push({
      code: "recipient_phone_required",
      field: "recipientPhone",
      message: "Укажите корректный телефон получателя",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    normalized: {
      customerName,
      customerPhone,
      customerEmail,
      contactPreference: value.contactPreference,
      recipientSameAsCustomer: value.recipientSameAsCustomer,
      recipientName,
      recipientPhone,
      isSurprise: value.recipientSameAsCustomer ? false : value.isSurprise,
      doNotCallRecipient: value.recipientSameAsCustomer
        ? false
        : value.doNotCallRecipient,
    },
  };
}

export function buildWebCheckoutCustomerRecipientPatch(
  value: WebCheckoutCustomerRecipientData,
) {
  const validation = validateWebCheckoutCustomerRecipient(value);

  return {
    customerName: validation.normalized.customerName,
    customerPhone: validation.normalized.customerPhone,
    customerEmail: validation.normalized.customerEmail,
    contactPreference: validation.normalized.contactPreference,
    recipientSameAsCustomer:
      validation.normalized.recipientSameAsCustomer,
    recipientName: validation.normalized.recipientName,
    recipientPhone: validation.normalized.recipientPhone,
    isSurprise: validation.normalized.isSurprise,
    doNotCallRecipient: validation.normalized.doNotCallRecipient,
  };
}

export function preserveWebCheckoutProgressStep(
  current: WebCheckoutDraftStep | null | undefined,
): WebCheckoutDraftStep {
  if (!current) return "delivery_type";

  return STEP_ORDER[current] >= STEP_ORDER.delivery_type
    ? current
    : "delivery_type";
}

export function webCheckoutContactFingerprint(
  value: WebCheckoutCustomerRecipientData,
) {
  return JSON.stringify(buildWebCheckoutCustomerRecipientPatch(value));
}
