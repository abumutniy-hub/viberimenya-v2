import type {
  TelegramCheckoutDraftData,
  TelegramCheckoutDraftStep,
} from "./customer-checkout-draft-core";

export const TELEGRAM_CHECKOUT_FLOW_VERSION = 2;
export const TELEGRAM_CHECKOUT_FLOW_CREATES_ORDER = false;
export const TELEGRAM_CHECKOUT_PROGRESS_TOTAL = 9;

const STEP_PROGRESS: Record<TelegramCheckoutDraftStep, number> = {
  customer_name: 1,
  customer_phone: 1,
  recipient_mode: 2,
  recipient_name: 2,
  recipient_phone: 2,
  delivery_type: 3,
  delivery_service: 3,
  delivery_zone: 4,
  delivery_date: 4,
  delivery_interval: 4,
  delivery_address: 4,
  card_text: 5,
  surprise: 5,
  contact_preference: 5,
  payment_method: 6,
  promo_code: 7,
  bonus: 7,
  comment: 8,
  privacy: 9,
  confirm: 9,
};

const STEP_TITLES: Record<TelegramCheckoutDraftStep, string> = {
  customer_name: "Покупатель",
  customer_phone: "Покупатель",
  recipient_mode: "Получатель",
  recipient_name: "Получатель",
  recipient_phone: "Получатель",
  delivery_type: "Получение",
  delivery_service: "Получение",
  delivery_zone: "Доставка",
  delivery_date: "Доставка",
  delivery_interval: "Доставка",
  delivery_address: "Доставка",
  card_text: "Пожелания",
  surprise: "Пожелания",
  contact_preference: "Пожелания",
  payment_method: "Оплата",
  promo_code: "Скидка",
  bonus: "Скидка",
  comment: "Комментарий",
  privacy: "Проверка",
  confirm: "Проверка",
};

export function telegramCheckoutProgress(step: TelegramCheckoutDraftStep) {
  const current = STEP_PROGRESS[step];
  return {
    current,
    total: TELEGRAM_CHECKOUT_PROGRESS_TOTAL,
    title: STEP_TITLES[step],
    text: `Шаг ${current} из ${TELEGRAM_CHECKOUT_PROGRESS_TOTAL} · ${STEP_TITLES[step]}`,
  };
}

export function telegramCheckoutPreviousStep(
  step: TelegramCheckoutDraftStep,
  data: TelegramCheckoutDraftData,
): TelegramCheckoutDraftStep | null {
  switch (step) {
    case "customer_name":
      return null;
    case "customer_phone":
      return "customer_name";
    case "recipient_mode":
      return "customer_phone";
    case "recipient_name":
      return "recipient_mode";
    case "recipient_phone":
      return "recipient_name";
    case "delivery_type":
      return data.recipientSameAsCustomer === true
        ? "recipient_mode"
        : "recipient_phone";
    case "delivery_zone":
      return "delivery_type";
    case "delivery_service":
      return "delivery_zone";
    case "delivery_date":
      return "delivery_service";
    case "delivery_interval":
      return "delivery_date";
    case "delivery_address":
      return "delivery_interval";
    case "card_text":
      return data.deliveryType === "pickup"
        ? "delivery_type"
        : "delivery_address";
    case "surprise":
      return "card_text";
    case "contact_preference":
      return "surprise";
    case "payment_method":
      return "contact_preference";
    case "promo_code":
      return "payment_method";
    case "bonus":
      return "promo_code";
    case "comment":
      return "bonus";
    case "privacy":
      return "comment";
    case "confirm":
      return "privacy";
  }
}

export function telegramCheckoutEditStep(section: string): TelegramCheckoutDraftStep | null {
  const map: Record<string, TelegramCheckoutDraftStep> = {
    customer: "customer_name",
    recipient: "recipient_mode",
    delivery: "delivery_type",
    wishes: "card_text",
    payment: "payment_method",
    discount: "promo_code",
    comment: "comment",
  };

  return map[section] || null;
}

export function telegramCheckoutDateChoices(
  todayIso: string,
  count = 7,
): Array<{ iso: string; label: string }> {
  const date = new Date(`${todayIso}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) return [];

  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const result: Array<{ iso: string; label: string }> = [];

  for (let index = 0; index < Math.max(1, Math.min(14, count)); index += 1) {
    const item = new Date(date);
    item.setUTCDate(item.getUTCDate() + index);
    const iso = item.toISOString().slice(0, 10);
    const prefix = index === 0 ? "Сегодня" : index === 1 ? "Завтра" : "";
    const formatted = formatter.format(item).replace(",", "");

    result.push({
      iso,
      label: prefix ? `${prefix} · ${formatted}` : formatted,
    });
  }

  return result;
}

export function normalizeTelegramPromoCode(value: string) {
  const text = value.trim();
  if (text === "-" || /^нет$/i.test(text)) return "";
  return text.toUpperCase().replace(/\s+/g, "").slice(0, 80);
}

export function normalizeTelegramBonus(value: string, available: number) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "-" || normalized === "нет" || normalized === "0") {
    return 0;
  }

  if (normalized === "все" || normalized === "всё") {
    return Math.max(0, Math.floor(available));
  }

  const parsed = Math.floor(Number(normalized.replace(/\s+/g, "")));

  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(parsed, Math.max(0, Math.floor(available)));
}

export function telegramCheckoutCallbackFits(value: string) {
  return Buffer.byteLength(value, "utf8") <= 64;
}
