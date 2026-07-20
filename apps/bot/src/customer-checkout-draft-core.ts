import { randomUUID } from "node:crypto";

export const TELEGRAM_CHECKOUT_DRAFT_SCHEMA_VERSION = 1;
export const TELEGRAM_CHECKOUT_DRAFT_TTL_HOURS = 24;

export type TelegramCheckoutDraftStep =
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

export type TelegramCheckoutDraftPaymentMethod =
  | "cash_on_delivery"
  | "transfer_after_confirm"
  | "online_card"
  | "sbp";

export type TelegramCheckoutDraftQuote = {
  quotedAt: string;
  cartFingerprint: string;
  quoteHash: string;
  itemCount: number;
  quantityCount: number;
  subtotal: number;
  minimumOrderAmount: number;
  deliveryPrice: number;
  deliveryTariffName: string;
  discountTotal: number;
  promoCode: string;
  bonusRequested: number;
  bonusAvailable: number;
  bonusApplied: number;
  total: number;
  currency: "RUB";
  readyForConfirmation: boolean;
  issues: Array<{
    code: string;
    field: string;
    message: string;
    severity: "error" | "warning";
  }>;
};

export type TelegramCheckoutDraftCore = {
  schemaVersion: 1;
  revision: number;
  status: "draft";
  sourceChannel: "site" | "telegram" | "max";
  customerId: string | null;
  telegramChatId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastOperationId: string | null;
  quote: TelegramCheckoutDraftQuote | null;
};

export type TelegramCheckoutDraftData = {
  clientRequestId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientSameAsCustomer?: boolean;
  deliveryType?: "delivery" | "pickup";
  deliveryService?: "standard" | "express";
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  deliveryDateText?: string;
  deliveryIntervalId?: string;
  deliveryInterval?: string;
  deliveryAddress?: string;
  deliveryComment?: string;
  paymentMethod?: TelegramCheckoutDraftPaymentMethod;
  comment?: string;
  cardText?: string;
  isSurprise?: boolean;
  doNotCallRecipient?: boolean;
  contactPreference?: "call_or_message" | "phone_call" | "messenger_only";
  promoCode?: string;
  bonusToSpend?: number;
  privacyAccepted?: boolean;
  _core?: TelegramCheckoutDraftCore;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum)
    : undefined;
}

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = Math.trunc(Number(value));

  if (!Number.isFinite(parsed)) return undefined;

  return Math.max(minimum, Math.min(maximum, parsed));
}

function quote(value: unknown): TelegramCheckoutDraftQuote | null {
  const raw = record(value);

  if (
    typeof raw.quotedAt !== "string"
    || typeof raw.cartFingerprint !== "string"
    || typeof raw.quoteHash !== "string"
  ) {
    return null;
  }

  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((value) => {
      const item = record(value);
      const code = text(item.code, 100);
      const field = text(item.field, 100);
      const message = text(item.message, 500);

      if (!code || !field || !message) return null;

      return {
        code,
        field,
        message,
        severity: item.severity === "warning"
          ? "warning" as const
          : "error" as const,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    quotedAt: raw.quotedAt.slice(0, 80),
    cartFingerprint: raw.cartFingerprint.slice(0, 128),
    quoteHash: raw.quoteHash.slice(0, 128),
    itemCount: integer(raw.itemCount, 0, 100) ?? 0,
    quantityCount: integer(raw.quantityCount, 0, 9900) ?? 0,
    subtotal: integer(raw.subtotal, 0, 1000000000) ?? 0,
    minimumOrderAmount: integer(raw.minimumOrderAmount, 0, 1000000000) ?? 0,
    deliveryPrice: integer(raw.deliveryPrice, 0, 1000000000) ?? 0,
    deliveryTariffName: text(raw.deliveryTariffName, 160) || "Доставка",
    discountTotal: integer(raw.discountTotal, 0, 1000000000) ?? 0,
    promoCode: text(raw.promoCode, 80) || "",
    bonusRequested: integer(raw.bonusRequested, 0, 1000000000) ?? 0,
    bonusAvailable: integer(raw.bonusAvailable, 0, 1000000000) ?? 0,
    bonusApplied: integer(raw.bonusApplied, 0, 1000000000) ?? 0,
    total: integer(raw.total, 0, 1000000000) ?? 0,
    currency: "RUB",
    readyForConfirmation: raw.readyForConfirmation === true,
    issues,
  };
}

export function normalizeTelegramCheckoutDraftData(
  value: unknown,
  fallback: {
    customerId?: string | null;
    telegramChatId?: string;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): TelegramCheckoutDraftData {
  if (typeof value === "string") {
    try {
      return normalizeTelegramCheckoutDraftData(JSON.parse(value), fallback);
    } catch {
      return normalizeTelegramCheckoutDraftData({}, fallback);
    }
  }

  const raw = record(value);
  const data: TelegramCheckoutDraftData = {};
  const stringFields: Array<[keyof TelegramCheckoutDraftData, number]> = [
    ["clientRequestId", 80],
    ["customerName", 160],
    ["customerPhone", 32],
    ["customerEmail", 255],
    ["recipientName", 160],
    ["recipientPhone", 32],
    ["deliveryZoneId", 80],
    ["deliveryZoneName", 160],
    ["deliveryDateText", 10],
    ["deliveryIntervalId", 80],
    ["deliveryInterval", 80],
    ["deliveryAddress", 1000],
    ["deliveryComment", 1000],
    ["paymentMethod", 40],
    ["comment", 2000],
    ["cardText", 500],
    ["contactPreference", 80],
    ["promoCode", 80],
  ];

  for (const [field, maximum] of stringFields) {
    const value = text(raw[field as string], maximum);

    if (value !== undefined) {
      (data as Record<string, unknown>)[field] = value;
    }
  }

  if (raw.deliveryType === "delivery" || raw.deliveryType === "pickup") {
    data.deliveryType = raw.deliveryType;
  }

  if (raw.deliveryService === "express" || raw.deliveryService === "standard") {
    data.deliveryService = raw.deliveryService;
  }

  if (!new Set([
    "cash_on_delivery",
    "transfer_after_confirm",
    "online_card",
    "sbp",
  ]).has(String(data.paymentMethod || ""))) {
    delete data.paymentMethod;
  }

  if (!new Set([
    "call_or_message",
    "phone_call",
    "messenger_only",
  ]).has(String(data.contactPreference || ""))) {
    delete data.contactPreference;
  }

  for (const field of [
    "recipientSameAsCustomer",
    "isSurprise",
    "doNotCallRecipient",
    "privacyAccepted",
  ] as const) {
    if (typeof raw[field] === "boolean") data[field] = raw[field];
  }

  const bonus = integer(raw.bonusToSpend, 0, 1000000000);
  if (bonus !== undefined) data.bonusToSpend = bonus;

  const rawCore = record(raw._core);
  const now = new Date();
  const createdAt = text(rawCore.createdAt, 80)
    || fallback.createdAt
    || now.toISOString();
  const updatedAt = text(rawCore.updatedAt, 80)
    || fallback.updatedAt
    || createdAt;
  const fallbackExpiryBase = Date.parse(
    fallback.updatedAt || fallback.createdAt || updatedAt,
  );
  const expiresAt = text(rawCore.expiresAt, 80)
    || new Date(
      (Number.isFinite(fallbackExpiryBase)
        ? fallbackExpiryBase
        : now.getTime())
      + TELEGRAM_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();
  const sourceChannel = rawCore.sourceChannel === "site" || rawCore.sourceChannel === "max"
    ? rawCore.sourceChannel
    : "telegram";

  data._core = {
    schemaVersion: TELEGRAM_CHECKOUT_DRAFT_SCHEMA_VERSION,
    revision: integer(rawCore.revision, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    status: "draft",
    sourceChannel,
    customerId: typeof rawCore.customerId === "string"
      ? rawCore.customerId
      : fallback.customerId ?? null,
    telegramChatId: fallback.telegramChatId || text(rawCore.telegramChatId, 40) || "",
    createdAt,
    updatedAt,
    expiresAt,
    lastOperationId: text(rawCore.lastOperationId, 180) || null,
    quote: quote(rawCore.quote),
  };

  return data;
}

export function prepareTelegramCheckoutDraftData(params: {
  previous: unknown;
  next: TelegramCheckoutDraftData;
  customerId: string | null;
  telegramChatId: string;
  operationId?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const previous = normalizeTelegramCheckoutDraftData(params.previous, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
  });
  const next = normalizeTelegramCheckoutDraftData(params.next, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
  });
  const core = previous._core!;

  return {
    ...previous,
    ...next,
    clientRequestId:
      next.clientRequestId
      || previous.clientRequestId
      || randomUUID(),
    _core: {
      ...core,
      schemaVersion: TELEGRAM_CHECKOUT_DRAFT_SCHEMA_VERSION,
      revision: core.revision + 1,
      status: "draft" as const,
      sourceChannel: "telegram" as const,
      customerId: params.customerId,
      telegramChatId: params.telegramChatId,
      updatedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + TELEGRAM_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
      ).toISOString(),
      lastOperationId: (params.operationId || randomUUID()).slice(0, 180),
      quote: null,
    },
  } satisfies TelegramCheckoutDraftData;
}

export function telegramCheckoutDraftExpired(value: unknown, now = Date.now()) {
  const data = normalizeTelegramCheckoutDraftData(value);
  const expiresAt = Date.parse(data._core?.expiresAt || "");

  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
