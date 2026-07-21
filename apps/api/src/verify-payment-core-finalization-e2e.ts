import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import { env } from "./lib/env";
import { recordPaymentEvent } from "./modules/payments/payment-audit.service";
import {
  expectedAmountMinor,
  parseDecimalAmountMinor,
} from "./modules/payments/payment-provider";
import {
  isYooKassaConfigured,
  mapYooKassaPaymentStatus,
  yookassaReceiptItem,
} from "./modules/payments/yookassa.service";

class VerificationRollback extends Error {}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const expectedStatuses = [
  "not_required",
  "created",
  "pending",
  "waiting_for_capture",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "cancelled",
  "expired",
];

assertCondition(expectedAmountMinor(123) === 12_300, "Рубли должны переводиться в копейки");
assertCondition(parseDecimalAmountMinor("123.45") === 12_345, "Десятичная сумма должна разбираться строго");
assertCondition(parseDecimalAmountMinor("123.4") === null, "Сумма без двух знаков должна отклоняться");
assertCondition(mapYooKassaPaymentStatus("succeeded") === "paid", "succeeded должен стать paid");
assertCondition(
  mapYooKassaPaymentStatus("waiting_for_capture") === "waiting_for_capture",
  "waiting_for_capture должен сохраняться",
);
assertCondition(mapYooKassaPaymentStatus("canceled") === "cancelled", "canceled должен стать cancelled");
assertCondition(mapYooKassaPaymentStatus("pending") === "pending", "pending должен сохраняться");

const receiptItem = yookassaReceiptItem({
  description: "  Проверочный   товар  ",
  amountRubles: 123,
});
assertCondition(receiptItem.description === "Проверочный товар", "Описание чека должно нормализоваться");
assertCondition(receiptItem.amount.value === "123.00", "Сумма чека должна иметь два знака");
assertCondition(receiptItem.amount.currency === "RUB", "Валюта чека должна быть RUB");
pass("чистые функции суммы, статуса и чека работают детерминированно");

assertCondition(
  isYooKassaConfigured() === Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY),
  "Признак настройки ЮKassa не совпадает с наличием обоих реквизитов",
);
pass("ЮKassa считается настроенной только при наличии Shop ID и Secret Key");

const marker = `payment-finalization-e2e-${randomUUID()}`;
const orderNumber = `E2E-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const trackingToken = `${marker}-${randomUUID()}`.slice(0, 120);
let syntheticOrderId = "";
const { client } = createDb();

try {
  const enumRows = await client<{ enumlabel: string }[]>`
    SELECT enumlabel
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'payment_status'
    ORDER BY enumsortorder
  `;

  assertCondition(
    JSON.stringify(enumRows.map((row) => row.enumlabel)) === JSON.stringify(expectedStatuses),
    "Enum payment_status не совпадает с каноническим жизненным циклом",
  );
  pass("payment_status содержит полный канонический жизненный цикл");

  const columnRows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'payments' AND column_name IN (
          'attempt_no', 'idempotency_key', 'expires_at', 'cancelled_at',
          'expired_at', 'failure_code', 'last_provider_status'
        ))
        OR
        (table_name = 'payment_events' AND column_name IN (
          'payment_id', 'event_type', 'source', 'idempotency_key',
          'previous_status', 'next_status', 'provider_event_id'
        ))
      )
  `;

  const columns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const required of [
    "payments.attempt_no",
    "payments.idempotency_key",
    "payments.expires_at",
    "payments.cancelled_at",
    "payments.expired_at",
    "payments.failure_code",
    "payments.last_provider_status",
    "payment_events.payment_id",
    "payment_events.event_type",
    "payment_events.source",
    "payment_events.idempotency_key",
    "payment_events.previous_status",
    "payment_events.next_status",
    "payment_events.provider_event_id",
  ]) {
    assertCondition(columns.has(required), `Отсутствует колонка ${required}`);
  }
  pass("таблицы payments и payment_events содержат обязательные поля");

  const indexRows = await client<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'payments_expiry_idx',
        'payments_provider_payment_uidx',
        'payments_provider_idempotency_uidx',
        'payments_order_attempt_uidx',
        'payment_events_payment_idem_uidx',
        'payment_events_order_idx',
        'payment_events_provider_event_idx'
      )
  `;
  const indexes = new Set(indexRows.map((row) => row.indexname));
  for (const required of [
    "payments_expiry_idx",
    "payments_provider_payment_uidx",
    "payments_provider_idempotency_uidx",
    "payments_order_attempt_uidx",
    "payment_events_payment_idem_uidx",
    "payment_events_order_idx",
    "payment_events_provider_event_idx",
  ]) {
    assertCondition(indexes.has(required), `Отсутствует индекс ${required}`);
  }
  pass("уникальность попыток, событий и поиск истёкших платежей индексированы");

  if (!isYooKassaConfigured()) {
    const enabledRows = await client<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count
      FROM shop_settings
      WHERE is_online_payment_enabled = true
    `;
    assertCondition(
      Number(enabledRows[0]?.count || 0) === 0,
      "Онлайн-оплата включена при отсутствующих реквизитах ЮKassa",
    );
    pass("при отсутствующих реквизитах онлайн-оплата выключена во всех магазинах");
  } else {
    pass("реквизиты ЮKassa присутствуют; тест не выводит и не использует их");
  }

  try {
    await client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:payment-core-finalization-e2e')
        )
      `;

      const shopRows = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const shop = shopRows[0];
      assertCondition(shop, "Активный магазин не найден");

      const orderRows = await transaction<{ id: string }[]>`
        INSERT INTO orders (
          shop_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          subtotal,
          total,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${orderNumber},
          'new',
          'pending',
          'online_card',
          'pickup',
          123,
          123,
          ${trackingToken},
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const order = orderRows[0];
      assertCondition(order, "Синтетический заказ не создан");
      syntheticOrderId = order.id;

      const paymentRows = await transaction<{ id: string }[]>`
        INSERT INTO payments (
          shop_id,
          order_id,
          provider,
          attempt_no,
          idempotency_key,
          method,
          status,
          amount,
          currency,
          expires_at,
          raw_payload,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          'yookassa',
          1,
          ${`e2e-${randomUUID()}`.slice(0, 64)},
          'online_card',
          'pending',
          123,
          'RUB',
          NOW() + INTERVAL '3 hours',
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const payment = paymentRows[0];
      assertCondition(payment, "Синтетическая платёжная попытка не создана");

      const idempotencyKey = `e2e-event:${payment.id}`;
      const first = await recordPaymentEvent({
        client: transaction,
        shopId: shop.id,
        orderId: order.id,
        paymentId: payment.id,
        provider: "yookassa",
        eventType: "payment.pending",
        source: "e2e",
        previousStatus: "created",
        nextStatus: "pending",
        providerEventId: marker,
        idempotencyKey,
        payload: { marker },
      });
      const repeated = await recordPaymentEvent({
        client: transaction,
        shopId: shop.id,
        orderId: order.id,
        paymentId: payment.id,
        provider: "yookassa",
        eventType: "payment.pending",
        source: "e2e",
        previousStatus: "created",
        nextStatus: "pending",
        providerEventId: marker,
        idempotencyKey,
        payload: { marker },
      });

      assertCondition(first === true, "Первое платёжное событие должно сохраниться");
      assertCondition(repeated === false, "Повторное платёжное событие должно быть идемпотентным");

      const eventRows = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::integer AS count
        FROM payment_events
        WHERE payment_id = ${payment.id}
          AND idempotency_key = ${idempotencyKey}
      `;
      assertCondition(Number(eventRows[0]?.count || 0) === 1, "Платёжное событие продублировалось");

      await transaction`
        UPDATE payments
        SET status = 'expired', expired_at = NOW(), updated_at = NOW()
        WHERE id = ${payment.id}
      `;
      await transaction`
        UPDATE orders
        SET payment_status = 'expired', status = 'cancelled', updated_at = NOW()
        WHERE id = ${order.id}
      `;

      const finalRows = await transaction<{
        payment_status: string;
        order_payment_status: string;
        order_status: string;
      }[]>`
        SELECT
          p.status::text AS payment_status,
          o.payment_status::text AS order_payment_status,
          o.status::text AS order_status
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        WHERE p.id = ${payment.id}
      `;
      const final = finalRows[0];
      assertCondition(final?.payment_status === "expired", "Платёж не перешёл в expired");
      assertCondition(final?.order_payment_status === "expired", "Заказ не получил payment_status=expired");
      assertCondition(final?.order_status === "cancelled", "Неоплаченный заказ не отменён");

      throw new VerificationRollback();
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const rollbackRows = await client<{ count: number }[]>`
    SELECT COUNT(*)::integer AS count
    FROM orders
    WHERE id = ${syntheticOrderId || null}::uuid
       OR tracking_token = ${trackingToken}
  `;
  assertCondition(Number(rollbackRows[0]?.count || 0) === 0, "Транзакционный rollback не удалил синтетический заказ");
  pass("идемпотентность payment_events и статусы expired проверены в откатываемой транзакции");

  console.log("\nPAYMENT CORE FINALIZATION E2E: OK");
  console.log("Проверены enum, schema, indexes, idempotency, test safety и transaction rollback.");
  console.log("Сеть ЮKassa, реальные платежи, заказы и Telegram-сообщения не использовались.");
} finally {
  await client.end();
}
