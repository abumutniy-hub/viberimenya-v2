import { createHash, randomUUID } from "node:crypto";
import {
  getCommerceCartSnapshot,
  resolveCustomerCommerceCartScope,
  type CommerceCartSqlExecutor,
} from "./customer-commerce-cart.service";

export type CheckoutDraftSqlExecutor = CommerceCartSqlExecutor;

export const CUSTOMER_CHECKOUT_DRAFT_SCHEMA_VERSION = 1;
export const CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS = 24;
export const CUSTOMER_CHECKOUT_DRAFT_MAX_COMMENT = 2000;
export const CUSTOMER_CHECKOUT_DRAFT_MAX_CARD_TEXT = 500;

export type CustomerCheckoutDraftStep =
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

export type CustomerCheckoutDraftSource = "site" | "telegram" | "max";

export type CustomerCheckoutDraftPaymentMethod =
  | "cash_on_delivery"
  | "transfer_after_confirm"
  | "online_card"
  | "sbp";

export type CustomerCheckoutDraftIssue = {
  code: string;
  field: string;
  message: string;
  severity: "error" | "warning";
};

export type CustomerCheckoutDraftQuote = {
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
  issues: CustomerCheckoutDraftIssue[];
};

export type CustomerCheckoutDraftCore = {
  schemaVersion: 1;
  revision: number;
  status: "draft";
  sourceChannel: CustomerCheckoutDraftSource;
  customerId: string | null;
  telegramChatId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastOperationId: string | null;
  quote: CustomerCheckoutDraftQuote | null;
};

export type CustomerCheckoutDraftData = {
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
  paymentMethod?: CustomerCheckoutDraftPaymentMethod;
  comment?: string;
  cardText?: string;
  isSurprise?: boolean;
  doNotCallRecipient?: boolean;
  contactPreference?: "call_or_message" | "phone_call" | "messenger_only";
  promoCode?: string;
  bonusToSpend?: number;
  privacyAccepted?: boolean;
  _core?: CustomerCheckoutDraftCore;
};

export type CustomerCheckoutDraftSnapshot = {
  linked: true;
  step: CustomerCheckoutDraftStep;
  data: CustomerCheckoutDraftData;
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

export type CustomerCheckoutDraftResult = {
  reused: boolean;
  draft: CustomerCheckoutDraftSnapshot;
};

export class CheckoutDraftConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("Черновик изменился на другом устройстве. Обновите данные и повторите действие.");
    this.name = "CheckoutDraftConflictError";
    this.currentRevision = currentRevision;
  }
}

export class CheckoutDraftNotFoundError extends Error {
  constructor() {
    super("Черновик оформления не найден");
    this.name = "CheckoutDraftNotFoundError";
  }
}

const CHECKOUT_STEPS = new Set<CustomerCheckoutDraftStep>([
  "customer_name",
  "customer_phone",
  "recipient_mode",
  "recipient_name",
  "recipient_phone",
  "delivery_type",
  "delivery_service",
  "delivery_zone",
  "delivery_date",
  "delivery_interval",
  "delivery_address",
  "card_text",
  "surprise",
  "contact_preference",
  "payment_method",
  "promo_code",
  "bonus",
  "comment",
  "privacy",
  "confirm",
]);

const PAYMENT_METHODS = new Set<CustomerCheckoutDraftPaymentMethod>([
  "cash_on_delivery",
  "transfer_after_confirm",
  "online_card",
  "sbp",
]);

const CONTACT_PREFERENCES = new Set([
  "call_or_message",
  "phone_call",
  "messenger_only",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum)
    : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function integerValue(value: unknown, minimum: number, maximum: number) {
  const parsed = Math.trunc(Number(value));

  if (!Number.isFinite(parsed)) return undefined;

  return Math.max(minimum, Math.min(maximum, parsed));
}

function isoDate(value: unknown) {
  const text = stringValue(value, 10);

  return text && /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : undefined;
}

function safeStep(value: unknown): CustomerCheckoutDraftStep {
  return typeof value === "string" && CHECKOUT_STEPS.has(value as CustomerCheckoutDraftStep)
    ? value as CustomerCheckoutDraftStep
    : "customer_name";
}

function safeSource(value: unknown): CustomerCheckoutDraftSource {
  return value === "telegram" || value === "max" ? value : "site";
}

function normalizePromoCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().slice(0, 80);
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  return digits.length === 11 && digits.startsWith("7")
    ? `+${digits}`
    : String(value ?? "").trim().slice(0, 32);
}

function phoneIsValid(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function safeQuote(value: unknown): CustomerCheckoutDraftQuote | null {
  const raw = record(value);

  if (
    typeof raw.quotedAt !== "string"
    || typeof raw.cartFingerprint !== "string"
    || typeof raw.quoteHash !== "string"
  ) {
    return null;
  }

  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  const issues = rawIssues
    .map((item) => {
      const issue = record(item);
      const severity = issue.severity === "warning" ? "warning" : "error";
      const code = stringValue(issue.code, 100);
      const field = stringValue(issue.field, 100);
      const message = stringValue(issue.message, 500);

      return code && field && message
        ? { code, field, message, severity }
        : null;
    })
    .filter((item): item is CustomerCheckoutDraftIssue => Boolean(item));

  return {
    quotedAt: raw.quotedAt.slice(0, 80),
    cartFingerprint: raw.cartFingerprint.slice(0, 128),
    quoteHash: raw.quoteHash.slice(0, 128),
    itemCount: integerValue(raw.itemCount, 0, 100) ?? 0,
    quantityCount: integerValue(raw.quantityCount, 0, 9900) ?? 0,
    subtotal: integerValue(raw.subtotal, 0, 1000000000) ?? 0,
    minimumOrderAmount: integerValue(raw.minimumOrderAmount, 0, 1000000000) ?? 0,
    deliveryPrice: integerValue(raw.deliveryPrice, 0, 1000000000) ?? 0,
    deliveryTariffName: stringValue(raw.deliveryTariffName, 160) || "Доставка",
    discountTotal: integerValue(raw.discountTotal, 0, 1000000000) ?? 0,
    promoCode: stringValue(raw.promoCode, 80) || "",
    bonusRequested: integerValue(raw.bonusRequested, 0, 1000000000) ?? 0,
    bonusAvailable: integerValue(raw.bonusAvailable, 0, 1000000000) ?? 0,
    bonusApplied: integerValue(raw.bonusApplied, 0, 1000000000) ?? 0,
    total: integerValue(raw.total, 0, 1000000000) ?? 0,
    currency: "RUB",
    readyForConfirmation: raw.readyForConfirmation === true,
    issues,
  };
}

function defaultCore(params: {
  customerId: string | null;
  telegramChatId: string;
  source: CustomerCheckoutDraftSource;
  now?: Date;
}): CustomerCheckoutDraftCore {
  const now = params.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
  );

  return {
    schemaVersion: CUSTOMER_CHECKOUT_DRAFT_SCHEMA_VERSION,
    revision: 0,
    status: "draft",
    sourceChannel: params.source,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastOperationId: null,
    quote: null,
  };
}

export function normalizeCustomerCheckoutDraftData(
  value: unknown,
  fallback: {
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    createdAt?: string;
    updatedAt?: string;
  },
): CustomerCheckoutDraftData {
  const raw = record(value);
  const data: CustomerCheckoutDraftData = {};
  const stringFields: Array<[keyof CustomerCheckoutDraftData, number]> = [
    ["clientRequestId", 80],
    ["customerName", 160],
    ["customerPhone", 32],
    ["customerEmail", 255],
    ["recipientName", 160],
    ["recipientPhone", 32],
    ["deliveryZoneId", 80],
    ["deliveryZoneName", 160],
    ["deliveryIntervalId", 80],
    ["deliveryInterval", 80],
    ["deliveryAddress", 1000],
    ["deliveryComment", 1000],
    ["paymentMethod", 40],
    ["comment", CUSTOMER_CHECKOUT_DRAFT_MAX_COMMENT],
    ["cardText", CUSTOMER_CHECKOUT_DRAFT_MAX_CARD_TEXT],
    ["contactPreference", 80],
    ["promoCode", 80],
  ];

  for (const [field, maximum] of stringFields) {
    const text = stringValue(raw[field as string], maximum);

    if (text !== undefined) {
      (data as Record<string, unknown>)[field] = text;
    }
  }

  const dateText = isoDate(raw.deliveryDateText);
  if (dateText) {
    data.deliveryDateText = dateText;
  } else if (raw.deliveryDateText === "") {
    data.deliveryDateText = "";
  }

  if (raw.deliveryType === "delivery" || raw.deliveryType === "pickup") {
    data.deliveryType = raw.deliveryType;
  }

  if (raw.deliveryService === "express" || raw.deliveryService === "standard") {
    data.deliveryService = raw.deliveryService;
  }

  if (
    typeof data.paymentMethod !== "string"
    || !PAYMENT_METHODS.has(data.paymentMethod as CustomerCheckoutDraftPaymentMethod)
  ) {
    delete data.paymentMethod;
  }

  if (
    typeof data.contactPreference !== "string"
    || !CONTACT_PREFERENCES.has(data.contactPreference)
  ) {
    delete data.contactPreference;
  }

  for (const field of [
    "recipientSameAsCustomer",
    "isSurprise",
    "doNotCallRecipient",
    "privacyAccepted",
  ] as const) {
    const value = booleanValue(raw[field]);
    if (value !== undefined) data[field] = value;
  }

  const bonus = integerValue(raw.bonusToSpend, 0, 1000000000);
  if (bonus !== undefined) data.bonusToSpend = bonus;

  const rawCore = record(raw._core);
  const initial = defaultCore({
    customerId: fallback.customerId,
    telegramChatId: fallback.telegramChatId,
    source: fallback.source,
  });
  const createdAt = stringValue(rawCore.createdAt, 80)
    || fallback.createdAt
    || initial.createdAt;
  const updatedAt = stringValue(rawCore.updatedAt, 80)
    || fallback.updatedAt
    || initial.updatedAt;
  const fallbackExpiryBase = Date.parse(
    fallback.updatedAt || fallback.createdAt || initial.updatedAt,
  );
  const expiresAt = stringValue(rawCore.expiresAt, 80)
    || new Date(
      (Number.isFinite(fallbackExpiryBase)
        ? fallbackExpiryBase
        : Date.now())
      + CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();

  data._core = {
    schemaVersion: CUSTOMER_CHECKOUT_DRAFT_SCHEMA_VERSION,
    revision: integerValue(rawCore.revision, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    status: "draft",
    sourceChannel: safeSource(rawCore.sourceChannel || fallback.source),
    customerId: typeof rawCore.customerId === "string"
      ? rawCore.customerId
      : fallback.customerId,
    telegramChatId: fallback.telegramChatId,
    createdAt,
    updatedAt,
    expiresAt,
    lastOperationId: stringValue(rawCore.lastOperationId, 180) || null,
    quote: safeQuote(rawCore.quote),
  };

  return data;
}

function publicData(data: CustomerCheckoutDraftData): CustomerCheckoutDraftData {
  const { _core: core, ...publicFields } = data;

  if (!core) {
    return publicFields;
  }

  return {
    ...publicFields,
    _core: {
      ...core,
      customerId: null,
      telegramChatId: "",
    },
  };
}

function snapshot(
  step: CustomerCheckoutDraftStep,
  data: CustomerCheckoutDraftData,
): CustomerCheckoutDraftSnapshot {
  const core = data._core;

  if (!core) {
    throw new Error("Checkout draft core metadata is missing");
  }

  return {
    linked: true,
    step,
    data: publicData(data),
    revision: core.revision,
    expiresAt: core.expiresAt,
    updatedAt: core.updatedAt,
  };
}

function expired(core: CustomerCheckoutDraftCore) {
  const timestamp = Date.parse(core.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

async function readDraftRow(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    telegramChatId: string;
    lock?: boolean;
  },
) {
  type DraftRow = {
    step: string;
    data: unknown;
    created_at: string;
    updated_at: string;
  };

  const rows = params.lock
    ? await sql<DraftRow[]>`
        SELECT
          step,
          data,
          created_at::text,
          updated_at::text
        FROM telegram_checkout_sessions
        WHERE shop_id = ${params.shopId}
          AND telegram_chat_id = ${params.telegramChatId}::bigint
        LIMIT 1
        FOR UPDATE
      `
    : await sql<DraftRow[]>`
        SELECT
          step,
          data,
          created_at::text,
          updated_at::text
        FROM telegram_checkout_sessions
        WHERE shop_id = ${params.shopId}
          AND telegram_chat_id = ${params.telegramChatId}::bigint
        LIMIT 1
      `;

  return rows[0] ?? null;
}

async function claimDraftOperation(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    operationId: string;
    action: string;
    payload?: Record<string, unknown>;
  },
) {
  const operationId = params.operationId.trim().slice(0, 180);
  const idempotencyKey = `checkout-draft:${params.telegramChatId}:${operationId}`;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO domain_events (
      shop_id,
      aggregate_type,
      aggregate_id,
      event_type,
      event_version,
      actor_type,
      actor_customer_id,
      idempotency_key,
      payload,
      occurred_at,
      created_at,
      updated_at
    )
    VALUES (
      ${params.shopId},
      'checkout_draft',
      ${params.customerId},
      'customer.checkout_draft.changed',
      1,
      ${params.customerId ? "customer" : params.source},
      ${params.customerId},
      ${idempotencyKey},
      ${JSON.stringify({
        action: params.action,
        source: params.source,
        telegramChatId: params.telegramChatId,
        operationId,
        ...params.payload,
      })}::jsonb,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, idempotency_key)
    DO NOTHING
    RETURNING id
  `;

  return rows.length === 1;
}

export async function resolveCustomerCheckoutDraftScope(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string;
  },
) {
  return resolveCustomerCommerceCartScope(sql, params);
}

export async function resolveTelegramCheckoutDraftCustomer(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    telegramChatId: string;
  },
) {
  const rows = await sql<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${params.shopId}
      AND telegram_id = ${params.telegramChatId}
      AND is_active = true
    ORDER BY linked_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `;

  return rows[0]?.customer_id ?? null;
}

export async function getCustomerCheckoutDraft(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    cleanupExpired?: boolean;
  },
): Promise<CustomerCheckoutDraftSnapshot | null> {
  const row = await readDraftRow(sql, params);

  if (!row) return null;

  const data = normalizeCustomerCheckoutDraftData(row.data, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  if (data._core && expired(data._core)) {
    if (params.cleanupExpired !== false) {
      await sql`
        DELETE FROM telegram_checkout_sessions
        WHERE shop_id = ${params.shopId}
          AND telegram_chat_id = ${params.telegramChatId}::bigint
      `;
    }

    return null;
  }

  return snapshot(safeStep(row.step), data);
}

export async function saveCustomerCheckoutDraft(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    operationId: string;
    expectedRevision?: number;
    step: CustomerCheckoutDraftStep;
    patch: Partial<CustomerCheckoutDraftData>;
  },
): Promise<CustomerCheckoutDraftResult> {
  const claimed = await claimDraftOperation(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    operationId: params.operationId,
    action: "save",
    payload: { step: params.step },
  });

  if (!claimed) {
    const current = await getCustomerCheckoutDraft(sql, {
      shopId: params.shopId,
      customerId: params.customerId,
      telegramChatId: params.telegramChatId,
      source: params.source,
      cleanupExpired: false,
    });

    if (!current) throw new CheckoutDraftNotFoundError();

    return { reused: true, draft: current };
  }

  const row = await readDraftRow(sql, { ...params, lock: true });
  const previous = normalizeCustomerCheckoutDraftData(row?.data, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    ...(row?.created_at ? { createdAt: row.created_at } : {}),
    ...(row?.updated_at ? { updatedAt: row.updated_at } : {}),
  });
  const currentRevision = previous._core?.revision ?? 0;

  if (
    params.expectedRevision !== undefined
    && params.expectedRevision !== currentRevision
  ) {
    throw new CheckoutDraftConflictError(currentRevision);
  }

  const normalizedPatch = normalizeCustomerCheckoutDraftData(params.patch, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
  });
  delete normalizedPatch._core;

  const now = new Date();
  const previousCore = previous._core || defaultCore({
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    now,
  });
  const expiresAt = new Date(
    now.getTime() + CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
  );
  const data: CustomerCheckoutDraftData = {
    ...previous,
    ...normalizedPatch,
    clientRequestId:
      normalizedPatch.clientRequestId
      || previous.clientRequestId
      || randomUUID(),
    _core: {
      ...previousCore,
      schemaVersion: CUSTOMER_CHECKOUT_DRAFT_SCHEMA_VERSION,
      revision: currentRevision + 1,
      status: "draft",
      sourceChannel: params.source,
      customerId: params.customerId,
      telegramChatId: params.telegramChatId,
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastOperationId: params.operationId.slice(0, 180),
      quote: null,
    },
  };

  await sql`
    INSERT INTO telegram_checkout_sessions (
      shop_id,
      telegram_chat_id,
      step,
      data,
      created_at,
      updated_at
    )
    VALUES (
      ${params.shopId},
      ${params.telegramChatId}::bigint,
      ${params.step},
      ${JSON.stringify(data)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, telegram_chat_id)
    DO UPDATE SET
      step = EXCLUDED.step,
      data = EXCLUDED.data,
      updated_at = NOW()
  `;

  return {
    reused: false,
    draft: snapshot(params.step, data),
  };
}

function addIssue(
  issues: CustomerCheckoutDraftIssue[],
  issue: CustomerCheckoutDraftIssue,
) {
  issues.push(issue);
}

function calculateDiscount(params: {
  subtotal: number;
  discountType: string;
  discountValue: number;
}) {
  if (params.subtotal <= 0) return 0;

  if (params.discountType === "percent") {
    return Math.min(
      params.subtotal,
      Math.floor((params.subtotal * params.discountValue) / 100),
    );
  }

  return Math.min(params.subtotal, Math.max(0, params.discountValue));
}

function checkoutSettings(value: unknown) {
  const root = record(value);
  const delivery = record(root.delivery);
  const launch = record(root.launch);

  return {
    pickupEnabled: delivery.pickupEnabled !== false,
    pickupAddress: stringValue(delivery.pickupAddress, 1000) || "",
    minimumOrderAmount:
      integerValue(delivery.minimumOrderAmount, 0, 1000000000) ?? 0,
    acceptingOrders: launch.acceptingOrders !== false,
    maintenanceMode: launch.maintenanceMode === true,
    ordersPausedMessage:
      stringValue(launch.ordersPausedMessage, 500)
      || "Приём новых заказов временно приостановлен",
    maintenanceMessage:
      stringValue(launch.maintenanceMessage, 500)
      || "Магазин временно недоступен для оформления",
  };
}

function dateInAllowedRange(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const latest = new Date(`${today}T00:00:00.000Z`);
  latest.setUTCDate(latest.getUTCDate() + 180);

  return value >= today && value <= latest.toISOString().slice(0, 10);
}

export async function quoteCustomerCheckoutDraft(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    operationId: string;
    expectedRevision?: number;
  },
): Promise<CustomerCheckoutDraftResult> {
  const claimed = await claimDraftOperation(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    operationId: params.operationId,
    action: "quote",
  });

  if (!claimed) {
    const current = await getCustomerCheckoutDraft(sql, {
      shopId: params.shopId,
      customerId: params.customerId,
      telegramChatId: params.telegramChatId,
      source: params.source,
      cleanupExpired: false,
    });

    if (!current) throw new CheckoutDraftNotFoundError();

    return { reused: true, draft: current };
  }

  const row = await readDraftRow(sql, { ...params, lock: true });
  if (!row) throw new CheckoutDraftNotFoundError();

  const data = normalizeCustomerCheckoutDraftData(row.data, {
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const currentRevision = data._core?.revision ?? 0;

  if (
    params.expectedRevision !== undefined
    && params.expectedRevision !== currentRevision
  ) {
    throw new CheckoutDraftConflictError(currentRevision);
  }

  const cart = await getCommerceCartSnapshot(sql, {
    shopId: params.shopId,
    telegramChatId: params.telegramChatId,
  });
  const settingsRows = await sql<{
    settings: unknown;
    is_online_payment_enabled: boolean;
    is_cash_payment_enabled: boolean;
    is_transfer_payment_enabled: boolean;
  }[]>`
    SELECT
      settings,
      is_online_payment_enabled,
      is_cash_payment_enabled,
      is_transfer_payment_enabled
    FROM shop_settings
    WHERE shop_id = ${params.shopId}
    LIMIT 1
  `;
  const settingsRow = settingsRows[0];
  const settings = checkoutSettings(settingsRow?.settings);
  const issues: CustomerCheckoutDraftIssue[] = [];

  if (settings.maintenanceMode || !settings.acceptingOrders) {
    addIssue(issues, {
      code: settings.maintenanceMode ? "maintenance_mode" : "orders_paused",
      field: "shop",
      message: settings.maintenanceMode
        ? settings.maintenanceMessage
        : settings.ordersPausedMessage,
      severity: "error",
    });
  }

  if (cart.items.length === 0) {
    addIssue(issues, {
      code: "cart_empty",
      field: "items",
      message: "Корзина пуста",
      severity: "error",
    });
  }

  const cartIds = cart.items.map((item) => item.productId);
  const stockRows = cartIds.length > 0
    ? await sql<{ id: string; stock_quantity: number | null; name: string }[]>`
        SELECT id, stock_quantity, name
        FROM products
        WHERE shop_id = ${params.shopId}
          AND id = ANY(${cartIds}::uuid[])
      `
    : [];
  const stocks = new Map(stockRows.map((item) => [item.id, item]));

  for (const item of cart.items) {
    const stock = Number(stocks.get(item.productId)?.stock_quantity ?? 0);

    if (stock < item.quantity) {
      addIssue(issues, {
        code: "insufficient_stock",
        field: "items",
        message: `Товар «${item.name}» доступен в меньшем количестве`,
        severity: "error",
      });
    }
  }

  const minimumOrderAmount = settings.minimumOrderAmount;

  if (minimumOrderAmount > 0 && cart.subtotal < minimumOrderAmount) {
    addIssue(issues, {
      code: "minimum_order",
      field: "items",
      message: `Минимальная сумма заказа — ${minimumOrderAmount} ₽`,
      severity: "error",
    });
  }

  if (!data.customerName || data.customerName.length < 2) {
    addIssue(issues, {
      code: "customer_name_required",
      field: "customerName",
      message: "Укажите имя покупателя",
      severity: "error",
    });
  }

  if (!phoneIsValid(data.customerPhone)) {
    addIssue(issues, {
      code: "customer_phone_required",
      field: "customerPhone",
      message: "Укажите корректный телефон покупателя",
      severity: "error",
    });
  }

  const recipientName = data.recipientSameAsCustomer
    ? data.customerName
    : data.recipientName;
  const recipientPhone = data.recipientSameAsCustomer
    ? data.customerPhone
    : data.recipientPhone;

  if (!recipientName || recipientName.length < 2) {
    addIssue(issues, {
      code: "recipient_name_required",
      field: "recipientName",
      message: "Укажите имя получателя",
      severity: "error",
    });
  }

  if (!phoneIsValid(recipientPhone)) {
    addIssue(issues, {
      code: "recipient_phone_required",
      field: "recipientPhone",
      message: "Укажите корректный телефон получателя",
      severity: "error",
    });
  }

  let deliveryPrice = 0;
  let deliveryTariffName = data.deliveryType === "pickup"
    ? "Самовывоз"
    : "Обычная доставка";

  if (data.deliveryType === "pickup") {
    if (!settings.pickupEnabled) {
      addIssue(issues, {
        code: "pickup_unavailable",
        field: "deliveryType",
        message: "Самовывоз сейчас недоступен",
        severity: "error",
      });
    }
  } else if (data.deliveryType === "delivery") {
    const zoneRows = data.deliveryZoneId
      ? await sql<{
          id: string;
          name: string;
          price: number;
          free_from_amount: number | null;
          is_express_available: boolean;
          express_price: number | null;
        }[]>`
          SELECT
            id,
            name,
            price,
            free_from_amount,
            is_express_available,
            express_price
          FROM delivery_zones
          WHERE shop_id = ${params.shopId}
            AND id = ${data.deliveryZoneId}
            AND is_active = true
            AND LOWER(BTRIM(name)) <> 'самовывоз'
          LIMIT 1
        `
      : [];
    const zone = zoneRows[0];

    if (!zone) {
      addIssue(issues, {
        code: "delivery_zone_required",
        field: "deliveryZoneId",
        message: "Выберите доступную зону доставки",
        severity: "error",
      });
    } else if (data.deliveryService === "express") {
      const expressPrice = Math.max(0, Number(zone.express_price || 0));

      if (!zone.is_express_available || expressPrice <= 0) {
        addIssue(issues, {
          code: "express_unavailable",
          field: "deliveryService",
          message: "Срочная доставка недоступна для выбранной зоны",
          severity: "error",
        });
      } else {
        deliveryPrice = expressPrice;
        deliveryTariffName = "Срочная доставка";
      }
    } else {
      const freeFromAmount = Math.max(0, Number(zone.free_from_amount || 0));

      if (freeFromAmount > 0 && cart.subtotal >= freeFromAmount) {
        deliveryPrice = 0;
        deliveryTariffName = "Бесплатная доставка";
      } else {
        deliveryPrice = Math.max(0, Number(zone.price || 0));
        deliveryTariffName = "Обычная доставка";
      }
    }

    if (!dateInAllowedRange(data.deliveryDateText)) {
      addIssue(issues, {
        code: "delivery_date_required",
        field: "deliveryDateText",
        message: "Выберите доступную дату доставки",
        severity: "error",
      });
    }

    const intervalRows = data.deliveryIntervalId
      ? await sql<{ id: string; name: string }[]>`
          SELECT id, name
          FROM delivery_intervals
          WHERE shop_id = ${params.shopId}
            AND id = ${data.deliveryIntervalId}
            AND is_active = true
          LIMIT 1
        `
      : [];

    if (!intervalRows[0]) {
      addIssue(issues, {
        code: "delivery_interval_required",
        field: "deliveryIntervalId",
        message: "Выберите доступный интервал доставки",
        severity: "error",
      });
    }

    if (!data.deliveryAddress || data.deliveryAddress.length < 5) {
      addIssue(issues, {
        code: "delivery_address_required",
        field: "deliveryAddress",
        message: "Укажите адрес доставки",
        severity: "error",
      });
    }
  } else {
    addIssue(issues, {
      code: "delivery_type_required",
      field: "deliveryType",
      message: "Выберите доставку или самовывоз",
      severity: "error",
    });
  }

  const paymentMethod = data.paymentMethod || "transfer_after_confirm";
  const paymentEnabled =
    paymentMethod === "cash_on_delivery"
      ? settingsRow?.is_cash_payment_enabled !== false
      : paymentMethod === "transfer_after_confirm"
        ? settingsRow?.is_transfer_payment_enabled !== false
        : settingsRow?.is_online_payment_enabled === true;

  if (!paymentEnabled) {
    addIssue(issues, {
      code: "payment_method_unavailable",
      field: "paymentMethod",
      message: "Выбранный способ оплаты сейчас недоступен",
      severity: "error",
    });
  }

  let promoCode = normalizePromoCode(data.promoCode);
  let discountTotal = 0;

  if (promoCode) {
    const promoRows = await sql<{
      discount_type: string;
      discount_value: number;
      min_order_amount: number | null;
      usage_limit: number | null;
      used_count: number;
    }[]>`
      SELECT
        discount_type,
        discount_value,
        min_order_amount,
        usage_limit,
        used_count
      FROM promocodes
      WHERE shop_id = ${params.shopId}
        AND UPPER(code) = ${promoCode}
        AND is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
      LIMIT 1
    `;
    const promo = promoRows[0];

    if (!promo) {
      addIssue(issues, {
        code: "promo_invalid",
        field: "promoCode",
        message: "Промокод не найден или уже не действует",
        severity: "error",
      });
      promoCode = "";
    } else if (
      promo.usage_limit !== null
      && Number(promo.used_count) >= Number(promo.usage_limit)
    ) {
      addIssue(issues, {
        code: "promo_limit",
        field: "promoCode",
        message: "Лимит использования промокода исчерпан",
        severity: "error",
      });
      promoCode = "";
    } else if (
      promo.min_order_amount !== null
      && cart.subtotal < Number(promo.min_order_amount)
    ) {
      addIssue(issues, {
        code: "promo_minimum",
        field: "promoCode",
        message: `Для промокода нужна сумма от ${promo.min_order_amount} ₽`,
        severity: "error",
      });
      promoCode = "";
    } else {
      discountTotal = calculateDiscount({
        subtotal: cart.subtotal,
        discountType: promo.discount_type,
        discountValue: Number(promo.discount_value),
      });
    }
  }

  const customerRows = params.customerId
    ? await sql<{ bonus_balance: number }[]>`
        SELECT bonus_balance
        FROM customers
        WHERE shop_id = ${params.shopId}
          AND id = ${params.customerId}
        LIMIT 1
      `
    : [];
  const bonusAvailable = Math.max(0, Number(customerRows[0]?.bonus_balance || 0));
  const bonusRequested = Math.max(0, Math.floor(Number(data.bonusToSpend || 0)));
  const beforeBonus = Math.max(0, cart.subtotal + deliveryPrice - discountTotal);
  const bonusApplied = Math.min(bonusRequested, bonusAvailable, beforeBonus);

  if (bonusRequested > bonusApplied) {
    addIssue(issues, {
      code: "bonus_adjusted",
      field: "bonusToSpend",
      message: `Можно списать не более ${bonusApplied} бонусов`,
      severity: "warning",
    });
  }

  if (data.privacyAccepted !== true) {
    addIssue(issues, {
      code: "privacy_required",
      field: "privacyAccepted",
      message: "Подтвердите согласие с условиями магазина",
      severity: "error",
    });
  }

  const total = Math.max(0, beforeBonus - bonusApplied);
  const cartFingerprint = createHash("sha256")
    .update(JSON.stringify(cart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      availability: item.availability,
    }))))
    .digest("hex");
  const readyForConfirmation = !issues.some((item) => item.severity === "error");
  const quotedAt = new Date().toISOString();
  const quoteSource = {
    cartFingerprint,
    subtotal: cart.subtotal,
    deliveryPrice,
    discountTotal,
    bonusApplied,
    total,
    promoCode,
    deliveryType: data.deliveryType || null,
    deliveryZoneId: data.deliveryZoneId || null,
    deliveryIntervalId: data.deliveryIntervalId || null,
    readyForConfirmation,
  };
  const quoteHash = createHash("sha256")
    .update(JSON.stringify(quoteSource))
    .digest("hex");
  const quote: CustomerCheckoutDraftQuote = {
    quotedAt,
    cartFingerprint,
    quoteHash,
    itemCount: cart.itemCount,
    quantityCount: cart.quantityCount,
    subtotal: cart.subtotal,
    minimumOrderAmount,
    deliveryPrice,
    deliveryTariffName,
    discountTotal,
    promoCode,
    bonusRequested,
    bonusAvailable,
    bonusApplied,
    total,
    currency: "RUB",
    readyForConfirmation,
    issues,
  };
  const now = new Date();
  const core = data._core || defaultCore({
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    now,
  });
  const updatedData: CustomerCheckoutDraftData = {
    ...data,
    customerPhone: normalizePhone(data.customerPhone),
    recipientPhone: normalizePhone(recipientPhone),
    promoCode,
    bonusToSpend: bonusRequested,
    _core: {
      ...core,
      revision: currentRevision + 1,
      sourceChannel: params.source,
      customerId: params.customerId,
      telegramChatId: params.telegramChatId,
      updatedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS * 60 * 60 * 1000,
      ).toISOString(),
      lastOperationId: params.operationId.slice(0, 180),
      quote,
    },
  };

  await sql`
    UPDATE telegram_checkout_sessions
    SET
      data = ${JSON.stringify(updatedData)}::jsonb,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND telegram_chat_id = ${params.telegramChatId}::bigint
  `;

  return {
    reused: false,
    draft: snapshot(safeStep(row.step), updatedData),
  };
}

export async function cancelCustomerCheckoutDraft(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CustomerCheckoutDraftSource;
    operationId: string;
  },
) {
  const claimed = await claimDraftOperation(sql, {
    ...params,
    action: "cancel",
  });

  if (!claimed) return { reused: true, removed: false };

  const rows = await sql<{ id: string }[]>`
    DELETE FROM telegram_checkout_sessions
    WHERE shop_id = ${params.shopId}
      AND telegram_chat_id = ${params.telegramChatId}::bigint
    RETURNING id
  `;

  return {
    reused: false,
    removed: rows.length === 1,
  };
}

export async function getCustomerCheckoutOptions(
  sql: CheckoutDraftSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
  },
) {
  const [settingsRows, zones, intervals, addresses, customerRows] = await Promise.all([
    sql<{
      settings: unknown;
      is_online_payment_enabled: boolean;
      is_cash_payment_enabled: boolean;
      is_transfer_payment_enabled: boolean;
    }[]>`
      SELECT
        settings,
        is_online_payment_enabled,
        is_cash_payment_enabled,
        is_transfer_payment_enabled
      FROM shop_settings
      WHERE shop_id = ${params.shopId}
      LIMIT 1
    `,
    sql<{
      id: string;
      name: string;
      price: number;
      free_from_amount: number | null;
      is_express_available: boolean;
      express_price: number | null;
    }[]>`
      SELECT
        id,
        name,
        price,
        free_from_amount,
        is_express_available,
        express_price
      FROM delivery_zones
      WHERE shop_id = ${params.shopId}
        AND is_active = true
        AND LOWER(BTRIM(name)) <> 'самовывоз'
      ORDER BY sort_order ASC, name ASC
    `,
    sql<{ id: string; name: string; starts_at: string; ends_at: string }[]>`
      SELECT id, name, starts_at, ends_at
      FROM delivery_intervals
      WHERE shop_id = ${params.shopId}
        AND is_active = true
      ORDER BY sort_order ASC, name ASC
    `,
    params.customerId
      ? sql<{
          id: string;
          city: string | null;
          street: string | null;
          house: string | null;
          apartment: string | null;
          entrance: string | null;
          floor: string | null;
          comment: string | null;
          is_default: boolean;
        }[]>`
          SELECT
            id,
            city,
            street,
            house,
            apartment,
            entrance,
            floor,
            comment,
            is_default
          FROM customer_addresses
          WHERE shop_id = ${params.shopId}
            AND customer_id = ${params.customerId}
          ORDER BY is_default DESC, updated_at DESC, id DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    params.customerId
      ? sql<{ bonus_balance: number }[]>`
          SELECT bonus_balance
          FROM customers
          WHERE shop_id = ${params.shopId}
            AND id = ${params.customerId}
          LIMIT 1
        `
      : Promise.resolve([]),
  ]);
  const settingsRow = settingsRows[0];
  const delivery = checkoutSettings(settingsRow?.settings);

  return {
    pickup: {
      enabled: delivery.pickupEnabled,
      address: delivery.pickupAddress,
    },
    minimumOrderAmount: delivery.minimumOrderAmount,
    acceptingOrders: delivery.acceptingOrders && !delivery.maintenanceMode,
    ordersPausedMessage: delivery.maintenanceMode
      ? delivery.maintenanceMessage
      : delivery.ordersPausedMessage,
    paymentMethods: {
      cashOnDelivery: settingsRow?.is_cash_payment_enabled !== false,
      transferAfterConfirm: settingsRow?.is_transfer_payment_enabled !== false,
      onlineCard: settingsRow?.is_online_payment_enabled === true,
      sbp: settingsRow?.is_online_payment_enabled === true,
    },
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      price: Number(zone.price || 0),
      freeFromAmount: zone.free_from_amount === null
        ? null
        : Number(zone.free_from_amount),
      expressAvailable: zone.is_express_available === true,
      expressPrice: zone.express_price === null
        ? null
        : Number(zone.express_price),
    })),
    intervals: intervals.map((interval) => ({
      id: interval.id,
      name: interval.name,
      startsAt: interval.starts_at,
      endsAt: interval.ends_at,
    })),
    addresses: addresses.map((address) => ({
      id: address.id,
      city: address.city || "",
      street: address.street || "",
      house: address.house || "",
      apartment: address.apartment || "",
      entrance: address.entrance || "",
      floor: address.floor || "",
      comment: address.comment || "",
      isDefault: address.is_default === true,
    })),
    bonusBalance: Math.max(0, Number(customerRows[0]?.bonus_balance || 0)),
    draftTtlHours: CUSTOMER_CHECKOUT_DRAFT_TTL_HOURS,
  };
}
