import crypto from "node:crypto";
import { env } from "../../lib/env";
import { HttpError } from "../../lib/http-error";

const YOOKASSA_API_BASE = "https://api.yookassa.ru/v3";
const REQUEST_TIMEOUT_MS = 15_000;

type YooKassaAmount = {
  value: string;
  currency: string;
};

type YooKassaConfirmation = {
  type?: string;
  confirmation_url?: string;
};

export type YooKassaPayment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled" | string;
  amount: YooKassaAmount;
  description?: string;
  confirmation?: YooKassaConfirmation;
  created_at?: string;
  captured_at?: string;
  paid?: boolean;
  refundable?: boolean;
  test?: boolean;
  metadata?: Record<string, unknown>;
  payment_method?: {
    type?: string;
    id?: string;
    saved?: boolean;
    title?: string;
  };
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  receipt_registration?: string;
};

export type YooKassaRefund = {
  id: string;
  payment_id: string;
  status: "pending" | "succeeded" | "canceled" | string;
  amount: YooKassaAmount;
  created_at?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  receipt_registration?: string;
};

type ReceiptItem = {
  description: string;
  quantity: string;
  amount: YooKassaAmount;
  vat_code: number;
  payment_mode: string;
  payment_subject: string;
};

type CreatePaymentParams = {
  idempotenceKey: string;
  amountRubles: number;
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  method: "online_card" | "sbp";
  customerEmail: string | null;
  customerPhone: string | null;
  returnUrl: string;
  receiptItems?: ReceiptItem[];
};

type CreateRefundParams = {
  idempotenceKey: string;
  paymentId: string;
  amountRubles: number;
  orderId: string;
  orderNumber: string;
  reason: string;
};

type YooKassaCredentials = {
  shopId: string;
  secretKey: string;
};

function currentCredentials(): YooKassaCredentials {
  return {
    shopId: env.YOOKASSA_SHOP_ID,
    secretKey: env.YOOKASSA_SECRET_KEY,
  };
}

function basicAuthorization(credentials: YooKassaCredentials) {
  return `Basic ${Buffer.from(`${credentials.shopId}:${credentials.secretKey}`).toString("base64")}`;
}

function rubles(value: number) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  return `${safe}.00`;
}

function digitsPhone(value: string | null) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  return digits;
}

function parseProviderError(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const data = payload as Record<string, unknown>;
    const description = typeof data.description === "string" ? data.description : "";
    const code = typeof data.code === "string" ? data.code : "";

    if (description) {
      return code ? `${description} (${code})` : description;
    }
  }

  return `ЮKassa вернула HTTP ${status}`;
}

async function yookassaRequest<T>(params: {
  method: "GET" | "POST";
  path: string;
  idempotenceKey?: string;
  body?: Record<string, unknown>;
  credentials?: YooKassaCredentials;
}): Promise<T> {
  const credentials = params.credentials ?? currentCredentials();

  if (!credentials.shopId || !credentials.secretKey) {
    throw new HttpError(503, "ЮKassa пока не подключена");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Authorization: basicAuthorization(credentials),
      Accept: "application/json",
    };

    if (params.body) {
      headers["Content-Type"] = "application/json";
    }

    if (params.idempotenceKey) {
      headers["Idempotence-Key"] = params.idempotenceKey.slice(0, 64);
    }

    const init: RequestInit = {
      method: params.method,
      headers,
      signal: controller.signal,
    };

    if (params.body) {
      init.body = JSON.stringify(params.body);
    }

    const response = await fetch(`${YOOKASSA_API_BASE}${params.path}`, init);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new HttpError(
        response.status >= 500 ? 502 : 400,
        parseProviderError(payload, response.status),
      );

      (error as HttpError & { providerStatus?: number; providerPayload?: unknown }).providerStatus = response.status;
      (error as HttpError & { providerStatus?: number; providerPayload?: unknown }).providerPayload = payload;
      throw error;
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpError(
        504,
        "ЮKassa не ответила вовремя. Повторите попытку — второй платёж не создастся",
      );
    }

    throw new HttpError(
      502,
      "Не удалось связаться с ЮKassa. Повторите попытку позже",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function isYooKassaConfigured() {
  return Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);
}

export function yookassaPublicStatus() {
  return {
    provider: "yookassa",
    configured: isYooKassaConfigured(),
    shopId: env.YOOKASSA_SHOP_ID,
    secretKeyConfigured: Boolean(env.YOOKASSA_SECRET_KEY),
    receiptsEnabled: env.YOOKASSA_RECEIPTS_ENABLED,
    testModeHint: env.YOOKASSA_TEST_MODE,
  };
}

export async function testYooKassaCredentials(params: YooKassaCredentials) {
  const result = await yookassaRequest<{
    type?: string;
    items?: unknown[];
    next_cursor?: string;
  }>({
    method: "GET",
    path: "/payments?limit=1",
    credentials: params,
  });

  return {
    ok: true,
    itemsChecked: Array.isArray(result.items) ? result.items.length : 0,
  };
}

export function createYooKassaIdempotenceKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`.slice(0, 64);
}

export async function createYooKassaPayment(
  params: CreatePaymentParams,
): Promise<YooKassaPayment> {
  const customer: Record<string, string> = {};

  if (params.customerEmail) {
    customer.email = params.customerEmail;
  } else {
    const phone = digitsPhone(params.customerPhone);
    if (phone) customer.phone = phone;
  }

  const body: Record<string, unknown> = {
    amount: {
      value: rubles(params.amountRubles),
      currency: "RUB",
    },
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: params.returnUrl,
    },
    description: `Заказ ${params.orderNumber}`.slice(0, 128),
    metadata: {
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      trackingToken: params.trackingToken,
      source: "viberimenya-v2",
    },
  };

  if (params.method === "sbp") {
    body.payment_method_data = { type: "sbp" };
  }

  if (
    env.YOOKASSA_RECEIPTS_ENABLED
    && params.receiptItems?.length
    && Object.keys(customer).length > 0
  ) {
    const receipt: Record<string, unknown> = {
      customer,
      items: params.receiptItems,
    };

    if (env.YOOKASSA_TAX_SYSTEM_CODE > 0) {
      receipt.tax_system_code = env.YOOKASSA_TAX_SYSTEM_CODE;
    }

    body.receipt = receipt;
  }

  return yookassaRequest<YooKassaPayment>({
    method: "POST",
    path: "/payments",
    idempotenceKey: params.idempotenceKey,
    body,
  });
}

export async function getYooKassaPayment(paymentId: string) {
  return yookassaRequest<YooKassaPayment>({
    method: "GET",
    path: `/payments/${encodeURIComponent(paymentId)}`,
  });
}

export async function createYooKassaRefund(
  params: CreateRefundParams,
): Promise<YooKassaRefund> {
  return yookassaRequest<YooKassaRefund>({
    method: "POST",
    path: "/refunds",
    idempotenceKey: params.idempotenceKey,
    body: {
      payment_id: params.paymentId,
      amount: {
        value: rubles(params.amountRubles),
        currency: "RUB",
      },
      description: `Возврат по заказу ${params.orderNumber}: ${params.reason}`.slice(0, 250),
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        source: "viberimenya-v2",
      },
    },
  });
}

export async function getYooKassaRefund(refundId: string) {
  return yookassaRequest<YooKassaRefund>({
    method: "GET",
    path: `/refunds/${encodeURIComponent(refundId)}`,
  });
}

export function mapYooKassaPaymentStatus(status: string) {
  if (status === "succeeded") return "paid" as const;
  if (status === "canceled") return "cancelled" as const;
  return "pending" as const;
}

export function yookassaReceiptItem(params: {
  description: string;
  amountRubles: number;
}) {
  return {
    description: params.description.replace(/\s+/g, " ").trim().slice(0, 128),
    quantity: "1.000",
    amount: {
      value: rubles(params.amountRubles),
      currency: "RUB",
    },
    vat_code: env.YOOKASSA_VAT_CODE,
    payment_mode: env.YOOKASSA_PAYMENT_MODE,
    payment_subject: env.YOOKASSA_PAYMENT_SUBJECT,
  } satisfies ReceiptItem;
}
