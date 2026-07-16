import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http-error";
import { markOrderPaid } from "../modules/orders/order-payment.service";
import { recordFullOrderRefund } from "../modules/orders/order-finance.service";
import {
  createYooKassaIdempotenceKey,
  createYooKassaPayment,
  createYooKassaRefund,
  getYooKassaPayment,
  getYooKassaRefund,
  isYooKassaConfigured,
  mapYooKassaPaymentStatus,
  type YooKassaPayment,
  type YooKassaRefund,
  yookassaReceiptItem,
} from "../modules/payments/yookassa.service";

type SqlClient = ReturnType<typeof createDb>["client"];

type PaymentContext = {
  shop_id: string;
  order_id: string;
  order_number: string;
  tracking_token: string;
  order_status: string;
  order_payment_status: string;
  payment_method: "online_card" | "sbp";
  total: number;
  subtotal: number;
  delivery_price: number;
  customer_email: string | null;
  customer_phone: string | null;
  online_enabled: boolean;
};

type PaymentRow = {
  id: string;
  provider_payment_id: string | null;
  status: string;
  amount: number;
  payment_url: string | null;
  raw_payload: Record<string, unknown> | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerRubles(value: string | number | undefined) {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) return 0;

  return Math.round(amount);
}

function providerPaymentUrl(payment: YooKassaPayment) {
  const value = payment.confirmation?.confirmation_url;
  return typeof value === "string" && /^https:\/\//.test(value) ? value : null;
}

function paymentPublicResponse(payment: {
  status: string;
  amount: number;
  paymentUrl: string | null;
  providerPaymentId: string | null;
}) {
  return {
    provider: "yookassa",
    status: payment.status,
    amount: payment.amount,
    currency: "RUB",
    paymentUrl: payment.paymentUrl,
    providerPaymentId: payment.providerPaymentId,
  };
}

async function loadPaymentContext(
  client: any,
  trackingToken: string,
  lock: boolean,
): Promise<PaymentContext> {
  const suffix = lock ? client`FOR UPDATE OF o` : client``;
  const rows = await client<PaymentContext[]>`
    SELECT
      o.shop_id,
      o.id AS order_id,
      o.order_number,
      o.tracking_token,
      o.status::text AS order_status,
      o.payment_status::text AS order_payment_status,
      o.payment_method::text AS payment_method,
      o.total,
      o.subtotal,
      o.delivery_price,
      c.email AS customer_email,
      c.phone AS customer_phone,
      COALESCE(s.is_online_payment_enabled, false) AS online_enabled
    FROM orders o
    LEFT JOIN customers c
      ON c.id = o.customer_id
    LEFT JOIN shop_settings s
      ON s.shop_id = o.shop_id
    WHERE o.tracking_token = ${trackingToken}
    LIMIT 1
    ${suffix}
  `;

  const order = rows[0];

  if (!order) {
    throw new HttpError(404, "Заказ не найден");
  }

  if (order.payment_method !== "online_card" && order.payment_method !== "sbp") {
    throw new HttpError(400, "Для заказа выбран другой способ оплаты");
  }

  return order;
}

async function buildReceiptItems(client: SqlClient, order: PaymentContext) {
  const rows = await client<{
    product_name: string;
    quantity: number;
    total: number;
  }[]>`
    SELECT product_name, quantity, total
    FROM order_items
    WHERE shop_id = ${order.shop_id}
      AND order_id = ${order.order_id}
    ORDER BY created_at ASC, id ASC
  `;

  const sourceLines = rows
    .map((row) => ({
      description: `${row.product_name} — ${Math.max(1, Number(row.quantity || 1))} шт.`,
      base: Math.max(0, Number(row.total || 0)),
    }))
    .filter((line) => line.base > 0);

  if (Number(order.delivery_price || 0) > 0) {
    sourceLines.push({
      description: "Доставка заказа",
      base: Number(order.delivery_price),
    });
  }

  const sourceTotal = sourceLines.reduce((sum, line) => sum + line.base, 0);
  const targetTotal = Math.max(0, Number(order.total || 0));

  if (sourceTotal <= 0 || targetTotal <= 0) return [];

  let allocated = 0;
  const amounts = sourceLines.map((line, index) => {
    if (index === sourceLines.length - 1) {
      return Math.max(0, targetTotal - allocated);
    }

    const amount = Math.max(0, Math.floor((line.base * targetTotal) / sourceTotal));
    allocated += amount;
    return amount;
  });

  return sourceLines
    .map((line, index) => ({
      description: line.description,
      amountRubles: amounts[index] ?? 0,
    }))
    .filter((line) => line.amountRubles > 0)
    .map((line) => yookassaReceiptItem(line));
}

async function ensureLocalPaymentSlot(
  client: SqlClient,
  trackingToken: string,
): Promise<{
  order: PaymentContext;
  payment: PaymentRow;
  idempotenceKey: string;
  shouldCallProvider: boolean;
}> {
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${trackingToken}))
    `;

    const order = await loadPaymentContext(transaction, trackingToken, true);

    if (!order.online_enabled) {
      throw new HttpError(503, "Онлайн-оплата отключена в настройках магазина");
    }

    if (!isYooKassaConfigured()) {
      throw new HttpError(503, "ЮKassa ещё не подключена");
    }

    if (order.order_status === "new") {
      throw new HttpError(409, "Сначала менеджер подтвердит заказ");
    }

    if (order.order_status === "cancelled") {
      throw new HttpError(409, "Отменённый заказ нельзя оплатить");
    }

    if (order.order_payment_status === "refunded") {
      throw new HttpError(409, "По заказу уже зафиксирован возврат");
    }

    if (Number(order.total || 0) <= 0) {
      throw new HttpError(400, "Сумма заказа должна быть больше нуля");
    }

    const paymentRows = await transaction<PaymentRow[]>`
      SELECT
        id,
        provider_payment_id,
        status::text AS status,
        amount,
        payment_url,
        raw_payload
      FROM payments
      WHERE shop_id = ${order.shop_id}
        AND order_id = ${order.order_id}
        AND provider = 'yookassa'
      ORDER BY created_at DESC, id DESC
      FOR UPDATE
    `;

    const paidPayment = paymentRows.find((row) => row.status === "paid");

    if (order.order_payment_status === "paid" || paidPayment) {
      const payment = paidPayment ?? paymentRows[0];

      if (!payment) {
        throw new HttpError(409, "Заказ оплачен, но платёжная запись не найдена");
      }

      const raw = objectValue(payment.raw_payload);
      return {
        order,
        payment,
        idempotenceKey: textValue(raw.idempotenceKey),
        shouldCallProvider: false,
      };
    }

    const reusable = paymentRows.find((row) => {
      if (row.status !== "pending") return false;
      const raw = objectValue(row.raw_payload);
      return Boolean(textValue(raw.idempotenceKey));
    });

    if (reusable) {
      const raw = objectValue(reusable.raw_payload);
      const hasReadyUrl = Boolean(reusable.provider_payment_id && reusable.payment_url);

      return {
        order,
        payment: reusable,
        idempotenceKey: textValue(raw.idempotenceKey),
        shouldCallProvider: !hasReadyUrl,
      };
    }

    const idempotenceKey = createYooKassaIdempotenceKey("payment");
    const rows = await transaction<PaymentRow[]>`
      INSERT INTO payments (
        shop_id,
        order_id,
        provider,
        method,
        status,
        amount,
        currency,
        payment_url,
        raw_payload,
        created_at,
        updated_at
      )
      VALUES (
        ${order.shop_id},
        ${order.order_id},
        'yookassa',
        ${order.payment_method}::payment_method,
        'pending',
        ${Number(order.total || 0)},
        'RUB',
        NULL,
        ${JSON.stringify({
          version: 1,
          state: "creating",
          idempotenceKey,
          createdBy: "customer",
          createdAt: new Date().toISOString(),
        })}::jsonb,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        provider_payment_id,
        status::text AS status,
        amount,
        payment_url,
        raw_payload
    `;

    const payment = rows[0];

    if (!payment) {
      throw new HttpError(500, "Не удалось подготовить платёж");
    }

    return {
      order,
      payment,
      idempotenceKey,
      shouldCallProvider: true,
    };
  });
}

async function saveProviderPayment(
  client: SqlClient,
  params: {
    paymentRowId: string;
    order: PaymentContext;
    providerPayment: YooKassaPayment;
    source: "yookassa_sync" | "yookassa_webhook";
  },
) {
  const providerAmount = integerRubles(params.providerPayment.amount?.value);
  const expectedAmount = Math.max(0, Number(params.order.total || 0));
  const providerOrderId = textValue(params.providerPayment.metadata?.orderId);

  if (providerAmount !== expectedAmount) {
    throw new HttpError(409, "Сумма платежа ЮKassa не совпадает с заказом");
  }

  if (String(params.providerPayment.amount?.currency || "") !== "RUB") {
    throw new HttpError(409, "Валюта платежа ЮKassa не совпадает с заказом");
  }

  if (providerOrderId && providerOrderId !== params.order.order_id) {
    throw new HttpError(409, "Платёж ЮKassa относится к другому заказу");
  }

  const paymentUrl = providerPaymentUrl(params.providerPayment);
  const mappedStatus = mapYooKassaPaymentStatus(params.providerPayment.status);

  if (mappedStatus === "paid") {
    await client`
      UPDATE payments
      SET
        provider_payment_id = ${params.providerPayment.id},
        payment_url = ${paymentUrl},
        raw_payload = COALESCE(raw_payload, '{}'::jsonb)
          || ${JSON.stringify({
            providerStatus: params.providerPayment.status,
            providerSnapshot: params.providerPayment,
            synchronizedAt: new Date().toISOString(),
          })}::jsonb,
        updated_at = NOW()
      WHERE shop_id = ${params.order.shop_id}
        AND id = ${params.paymentRowId}
    `;

    await markOrderPaid({
      client,
      shopId: params.order.shop_id,
      orderId: params.order.order_id,
      source: params.source,
      providerPaymentId: params.providerPayment.id,
      providerPayload: params.providerPayment,
      paidAt: params.providerPayment.captured_at ?? params.providerPayment.created_at ?? null,
      allowNewOrder: false,
    });

    return "paid" as const;
  }

  const localStatus = mappedStatus === "cancelled" ? "cancelled" : "pending";

  await client.begin(async (transaction) => {
    await transaction`
      UPDATE payments
      SET
        provider_payment_id = ${params.providerPayment.id},
        status = ${localStatus}::payment_status,
        payment_url = ${paymentUrl},
        raw_payload = COALESCE(raw_payload, '{}'::jsonb)
          || ${JSON.stringify({
            providerStatus: params.providerPayment.status,
            providerSnapshot: params.providerPayment,
            synchronizedAt: new Date().toISOString(),
          })}::jsonb,
        updated_at = NOW()
      WHERE shop_id = ${params.order.shop_id}
        AND id = ${params.paymentRowId}
    `;

    if (mappedStatus === "cancelled") {
      await transaction`
        UPDATE orders
        SET
          payment_status = CASE
            WHEN payment_status = 'paid' THEN payment_status
            WHEN payment_status = 'refunded' THEN payment_status
            ELSE 'failed'::payment_status
          END,
          updated_at = NOW()
        WHERE shop_id = ${params.order.shop_id}
          AND id = ${params.order.order_id}
      `;
    }
  });

  return localStatus;
}

export async function createOrReuseYooKassaPayment(
  client: SqlClient,
  trackingToken: string,
) {
  const slot = await ensureLocalPaymentSlot(client, trackingToken);

  if (!slot.shouldCallProvider) {
    return paymentPublicResponse({
      status: slot.payment.status,
      amount: Number(slot.payment.amount || 0),
      paymentUrl: slot.payment.payment_url,
      providerPaymentId: slot.payment.provider_payment_id,
    });
  }

  const receiptItems = await buildReceiptItems(client, slot.order);
  const returnUrl = `${env.APP_URL.replace(/\/$/, "")}/order/track/${slot.order.tracking_token}?payment=return`;

  try {
    const providerPayment = await createYooKassaPayment({
      idempotenceKey: slot.idempotenceKey,
      amountRubles: Number(slot.order.total || 0),
      orderId: slot.order.order_id,
      orderNumber: slot.order.order_number,
      trackingToken: slot.order.tracking_token,
      method: slot.order.payment_method,
      customerEmail: slot.order.customer_email,
      customerPhone: slot.order.customer_phone,
      returnUrl,
      receiptItems,
    });

    const status = await saveProviderPayment(client, {
      paymentRowId: slot.payment.id,
      order: slot.order,
      providerPayment,
      source: "yookassa_sync",
    });

    return paymentPublicResponse({
      status,
      amount: Number(slot.order.total || 0),
      paymentUrl: providerPaymentUrl(providerPayment),
      providerPaymentId: providerPayment.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка ЮKassa";
    const statusCode = error instanceof HttpError ? error.statusCode : 500;

    await client`
      UPDATE payments
      SET
        status = CASE
          WHEN ${statusCode} BETWEEN 400 AND 499 THEN 'failed'::payment_status
          ELSE status
        END,
        raw_payload = COALESCE(raw_payload, '{}'::jsonb)
          || ${JSON.stringify({
            lastError: message,
            lastErrorAt: new Date().toISOString(),
            retryUsesSameIdempotenceKey: true,
          })}::jsonb,
        updated_at = NOW()
      WHERE shop_id = ${slot.order.shop_id}
        AND id = ${slot.payment.id}
    `;

    throw error;
  }
}

async function locateLocalPayment(
  client: SqlClient,
  providerPayment: YooKassaPayment,
) {
  const metadataOrderId = textValue(providerPayment.metadata?.orderId);
  const rows = await client<{
    payment_id: string | null;
    shop_id: string;
    order_id: string;
    order_number: string;
    tracking_token: string;
  }[]>`
    SELECT
      p.id AS payment_id,
      o.shop_id,
      o.id AS order_id,
      o.order_number,
      o.tracking_token
    FROM orders o
    LEFT JOIN payments p
      ON p.shop_id = o.shop_id
      AND p.order_id = o.id
      AND p.provider = 'yookassa'
      AND p.provider_payment_id = ${providerPayment.id}
    WHERE (
      p.provider_payment_id = ${providerPayment.id}
      OR (${metadataOrderId} <> '' AND o.id::text = ${metadataOrderId})
    )
    ORDER BY (p.provider_payment_id = ${providerPayment.id}) DESC, p.created_at DESC NULLS LAST
    LIMIT 1
  `;

  const row = rows[0];

  if (!row) {
    throw new HttpError(404, "Локальный заказ платежа не найден");
  }

  let paymentRowId = row.payment_id;

  if (!paymentRowId) {
    const inserted = await client<{ id: string }[]>`
      INSERT INTO payments (
        shop_id,
        order_id,
        provider,
        provider_payment_id,
        method,
        status,
        amount,
        currency,
        payment_url,
        raw_payload,
        created_at,
        updated_at
      )
      SELECT
        o.shop_id,
        o.id,
        'yookassa',
        ${providerPayment.id},
        o.payment_method,
        'pending',
        o.total,
        'RUB',
        ${providerPaymentUrl(providerPayment)},
        ${JSON.stringify({ recoveredFromWebhook: true })}::jsonb,
        NOW(),
        NOW()
      FROM orders o
      WHERE o.id = ${row.order_id}
      RETURNING id
    `;

    paymentRowId = inserted[0]?.id ?? null;
  }

  if (!paymentRowId) {
    throw new HttpError(500, "Не удалось восстановить платёжную запись");
  }

  const order = await loadPaymentContext(client, row.tracking_token, false);

  return { paymentRowId, order };
}

async function reconcileProviderPayment(
  client: SqlClient,
  providerPayment: YooKassaPayment,
  source: "yookassa_sync" | "yookassa_webhook",
) {
  const local = await locateLocalPayment(client, providerPayment);
  const status = await saveProviderPayment(client, {
    paymentRowId: local.paymentRowId,
    order: local.order,
    providerPayment,
    source,
  });

  return paymentPublicResponse({
    status,
    amount: Number(local.order.total || 0),
    paymentUrl: providerPaymentUrl(providerPayment),
    providerPaymentId: providerPayment.id,
  });
}

async function reconcileProviderRefund(client: SqlClient, refund: YooKassaRefund) {
  if (refund.status !== "succeeded") {
    return { changed: false, status: refund.status };
  }

  const paymentRows = await client<{
    shop_id: string;
    order_id: string;
    order_number: string;
    amount: number;
    raw_payload: Record<string, unknown> | null;
  }[]>`
    SELECT
      p.shop_id,
      p.order_id,
      o.order_number,
      p.amount,
      p.raw_payload
    FROM payments p
    JOIN orders o
      ON o.shop_id = p.shop_id
      AND o.id = p.order_id
    WHERE p.provider = 'yookassa'
      AND p.provider_payment_id = ${refund.payment_id}
    ORDER BY p.created_at DESC
    LIMIT 1
  `;

  const payment = paymentRows[0];

  if (!payment) {
    throw new HttpError(404, "Платёж возврата не найден в CRM");
  }

  if (integerRubles(refund.amount?.value) !== Number(payment.amount || 0)) {
    throw new HttpError(409, "Сумма возврата ЮKassa не совпадает с платежом");
  }

  const raw = objectValue(payment.raw_payload);
  const pending = objectValue(raw.providerRefundPending);
  const reason = textValue(pending.reason) || "Возврат подтверждён ЮKassa";
  const actorUserId = textValue(pending.actorUserId) || null;
  const cancelOrder = pending.cancelOrder !== false;

  const result = await recordFullOrderRefund({
    client,
    shopId: payment.shop_id,
    orderId: payment.order_id,
    actorUserId,
    reason,
    cancelOrder,
    source: "yookassa_webhook",
    providerRefundId: refund.id,
    providerPayload: refund,
  });

  return { changed: result.changed, status: "succeeded", refund: result };
}

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/api/public/orders/track/:token/payment/create", async (request) => {
    const params = z.object({
      token: z.string().min(16).max(120),
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const payment = await createOrReuseYooKassaPayment(client, params.token);
      return { ok: true, payment };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/orders/track/:token/payment/sync", async (request) => {
    const params = z.object({
      token: z.string().min(16).max(120),
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const order = await loadPaymentContext(client, params.token, false);
      const rows = await client<{ provider_payment_id: string | null }[]>`
        SELECT provider_payment_id
        FROM payments
        WHERE shop_id = ${order.shop_id}
          AND order_id = ${order.order_id}
          AND provider = 'yookassa'
          AND provider_payment_id IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `;

      const providerPaymentId = rows[0]?.provider_payment_id;

      if (!providerPaymentId) {
        const payment = await createOrReuseYooKassaPayment(client, params.token);
        return { ok: true, payment };
      }

      const providerPayment = await getYooKassaPayment(providerPaymentId);
      const payment = await reconcileProviderPayment(client, providerPayment, "yookassa_sync");
      return { ok: true, payment };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/payments/yookassa/webhook", async (request, reply) => {
    if (!isYooKassaConfigured()) {
      return reply.status(503).send({ ok: false });
    }

    const body = z.object({
      type: z.string().optional(),
      event: z.string().min(3).max(80),
      object: z.object({
        id: z.string().min(1).max(255),
      }).passthrough(),
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      if (body.event.startsWith("payment.")) {
        const providerPayment = await getYooKassaPayment(body.object.id);
        await reconcileProviderPayment(client, providerPayment, "yookassa_webhook");
      } else if (body.event === "refund.succeeded") {
        const refund = await getYooKassaRefund(body.object.id);
        await reconcileProviderRefund(client, refund);
      }

      return reply.status(200).send({ ok: true });
    } finally {
      await client.end();
    }
  });
}

export async function prepareYooKassaRefund(params: {
  client: SqlClient;
  shopId: string;
  orderId: string;
  actorUserId: string;
  reason: string;
  cancelOrder: boolean;
}) {
  const rows = await params.client<{
    order_number: string;
    total: number;
    payment_status: string;
    payment_id: string;
    provider_payment_id: string;
    raw_payload: Record<string, unknown> | null;
  }[]>`
    SELECT
      o.order_number,
      o.total,
      o.payment_status::text AS payment_status,
      p.id AS payment_id,
      p.provider_payment_id,
      p.raw_payload
    FROM orders o
    JOIN payments p
      ON p.shop_id = o.shop_id
      AND p.order_id = o.id
      AND p.provider = 'yookassa'
      AND p.status = 'paid'
    WHERE o.shop_id = ${params.shopId}
      AND o.id = ${params.orderId}
    ORDER BY p.created_at DESC
    LIMIT 1
  `;

  const payment = rows[0];

  if (!payment) {
    return null;
  }

  if (!payment.provider_payment_id) {
    throw new HttpError(409, "У платежа ЮKassa отсутствует ID провайдера");
  }

  if (!isYooKassaConfigured()) {
    throw new HttpError(503, "ЮKassa не настроена: автоматический возврат недоступен");
  }

  const raw = objectValue(payment.raw_payload);
  const existing = objectValue(raw.providerRefundPending);
  const existingId = textValue(existing.id);
  const idempotenceKey = textValue(existing.idempotenceKey)
    || `refund-${params.orderId}`.slice(0, 64);

  if (existingId) {
    const refund = await getYooKassaRefund(existingId);
    return { refund, payment };
  }

  const pending = {
    idempotenceKey,
    actorUserId: params.actorUserId,
    reason: params.reason,
    cancelOrder: params.cancelOrder,
    requestedAt: new Date().toISOString(),
  };

  await params.client`
    UPDATE payments
    SET
      raw_payload = COALESCE(raw_payload, '{}'::jsonb)
        || jsonb_build_object(
          'providerRefundPending',
          ${JSON.stringify(pending)}::jsonb
        ),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND id = ${payment.payment_id}
  `;

  const refund = await createYooKassaRefund({
    idempotenceKey,
    paymentId: payment.provider_payment_id,
    amountRubles: Number(payment.total || 0),
    orderId: params.orderId,
    orderNumber: payment.order_number,
    reason: params.reason,
  });

  if (refund.status === "canceled") {
    throw new HttpError(
      409,
      refund.cancellation_details?.reason
        ? `ЮKassa отклонила возврат: ${refund.cancellation_details.reason}`
        : "ЮKassa отклонила возврат",
    );
  }

  await params.client`
    UPDATE payments
    SET
      raw_payload = COALESCE(raw_payload, '{}'::jsonb)
        || jsonb_build_object(
          'providerRefundPending',
          ${JSON.stringify({
            ...pending,
            id: refund.id,
            status: refund.status,
            providerSnapshot: refund,
          })}::jsonb
        ),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND id = ${payment.payment_id}
  `;

  return { refund, payment };
}

export async function finalizeYooKassaRefund(params: {
  client: SqlClient;
  shopId: string;
  orderId: string;
  actorUserId: string;
  reason: string;
  cancelOrder: boolean;
  refund: YooKassaRefund;
}) {
  if (params.refund.status !== "succeeded") {
    return null;
  }

  return recordFullOrderRefund({
    client: params.client,
    shopId: params.shopId,
    orderId: params.orderId,
    actorUserId: params.actorUserId,
    reason: params.reason,
    cancelOrder: params.cancelOrder,
    source: "yookassa_refund",
    providerRefundId: params.refund.id,
    providerPayload: params.refund,
  });
}
