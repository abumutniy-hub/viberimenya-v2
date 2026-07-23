import type { createDb } from "@viberimenya/db";
import { env } from "../../lib/env";
import { HttpError } from "../../lib/http-error";
import { recordPaymentEvent } from "../payments/payment-audit.service";

type SqlClient =
  ReturnType<
    typeof createDb
  >["client"];

type MarkOrderPaidParams = {
  client?: SqlClient;
  transaction?: unknown;
  shopId: string;
  orderId: string;
  source?: "admin_manual_paid" | "yookassa_webhook" | "yookassa_sync";
  paymentId?: string;
  providerPaymentId?: string;
  providerPayload?: unknown;
  paidAt?: string | null;
  allowNewOrder?: boolean;
};

type LockedOrderRow = {
  id: string;
  customer_id: string | null;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string;
  total: number;
  bonus_earned: number;
};

type CustomerRow = {
  bonus_balance: number;
};

type PaymentRow = {
  id: string;
  status: string;
  provider: string;
  provider_payment_id: string | null;
};

type EarnRow = {
  id: string;
  amount: number;
  balance_after: number;
};

type UpdatedOrderRow = {
  customer_phone: string | null;
  customer_name: string | null;
  total_amount: number;
  [key: string]: unknown;
};

export type MarkOrderPaidResult = {
  order: UpdatedOrderRow;
  earnedNow: number;
  balanceAfter: number;
  wasAlreadyPaid: boolean;
  paymentCreated: boolean;
  paymentRepaired: boolean;
};

/*
 * ORDER DOMAIN FOUNDATION 1.0
 * ORDER FINANCIAL INTEGRITY 1.1
 * ORDER PAYMENT SQL TYPES 1.2
 *
 * Все изменения оплаты, платёжной записи,
 * бонусного баланса, бонусной операции
 * и уведомлений выполняются одной транзакцией.
 */
export async function markOrderPaid(
  params: MarkOrderPaidParams
): Promise<MarkOrderPaidResult> {
  const bonusRatePercent = 5;

  const execute = async (transaction: SqlClient): Promise<MarkOrderPaidResult> => {
      const orderRows =
        await transaction<
          LockedOrderRow[]
        >`
          SELECT
            id,
            customer_id,
            order_number,
            status::text
              AS status,
            payment_status::text
              AS payment_status,
            payment_method::text
              AS payment_method,
            total,
            bonus_earned
          FROM orders
          WHERE shop_id =
              ${params.shopId}
            AND id =
              ${params.orderId}
          LIMIT 1
          FOR UPDATE
        `;

      const order = orderRows[0];

      if (!order) {
        throw new HttpError(
          404,
          "Заказ не найден"
        );
      }

      if (order.status === "new" && params.allowNewOrder !== true) {
        throw new HttpError(
          400,
          "Сначала подтвердите заказ, затем отметьте оплату"
        );
      }

      if (order.status === "cancelled") {
        throw new HttpError(
          400,
          "Отменённый заказ нельзя отметить оплаченным"
        );
      }

      if (order.payment_status === "refunded") {
        throw new HttpError(
          400,
          "Заказ с зафиксированным возвратом нельзя повторно отметить оплаченным"
        );
      }

      if (order.payment_status === "cancelled") {
        throw new HttpError(
          400,
          "Отменённую оплату нельзя повторно подтвердить"
        );
      }

      if (!order.customer_id) {
        throw new HttpError(
          400,
          "У заказа нет клиента для начисления бонусов"
        );
      }

      const customerRows =
        await transaction<
          CustomerRow[]
        >`
          SELECT bonus_balance
          FROM customers
          WHERE shop_id =
              ${params.shopId}
            AND id =
              ${order.customer_id}
          LIMIT 1
          FOR UPDATE
        `;

      const customer =
        customerRows[0];

      if (!customer) {
        throw new HttpError(
          409,
          "Клиент заказа не найден"
        );
      }

      const earnRows =
        await transaction<
          EarnRow[]
        >`
          SELECT
            id,
            amount,
            balance_after
          FROM bonus_transactions
          WHERE shop_id =
              ${params.shopId}
            AND order_id =
              ${order.id}
            AND type = 'earn'
          ORDER BY created_at ASC
          LIMIT 2
          FOR UPDATE
        `;

      if (earnRows.length > 1) {
        throw new HttpError(
          409,
          "У заказа обнаружено несколько начислений бонусов"
        );
      }

      const existingEarn =
        earnRows[0];

      const storedBonusEarned =
        Number(
          order.bonus_earned
          || 0
        );

      if (storedBonusEarned < 0) {
        throw new HttpError(
          409,
          "У заказа указан некорректный размер бонусов"
        );
      }

      const wasAlreadyPaid =
        order.payment_status
        === "paid";

      if (
        !wasAlreadyPaid
        && (
          storedBonusEarned > 0
          || existingEarn
        )
      ) {
        throw new HttpError(
          409,
          "У неоплаченного заказа обнаружено незавершённое начисление бонусов"
        );
      }

      if (
        wasAlreadyPaid
        && storedBonusEarned > 0
        && !existingEarn
      ) {
        throw new HttpError(
          409,
          "У оплаченного заказа отсутствует запись начисления бонусов"
        );
      }

      if (
        existingEarn
        && Number(
          existingEarn.amount
        ) !== storedBonusEarned
      ) {
        throw new HttpError(
          409,
          "Сумма начисленных бонусов не совпадает с заказом"
        );
      }

      if (
        existingEarn
        && storedBonusEarned <= 0
      ) {
        throw new HttpError(
          409,
          "У заказа обнаружена лишняя бонусная операция"
        );
      }

      const paymentRows =
        await transaction<
          PaymentRow[]
        >`
          SELECT
            id,
            status::text
              AS status,
            provider,
            provider_payment_id
          FROM payments
          WHERE shop_id =
              ${params.shopId}
            AND order_id =
              ${order.id}
          ORDER BY
            created_at DESC,
            id DESC
          FOR UPDATE
        `;

      const paidPayments =
        paymentRows.filter(
          (payment) =>
            payment.status
            === "paid"
        );

      if (paidPayments.length > 1) {
        throw new HttpError(
          409,
          "У заказа обнаружено несколько оплаченных платежей"
        );
      }

      if (
        !wasAlreadyPaid
        && paidPayments.length > 0
      ) {
        throw new HttpError(
          409,
          "Платёж уже оплачен, но статус заказа не обновлён"
        );
      }

      const totalAmount =
        Math.max(
          0,
          Number(
            order.total
            || 0
          )
        );

      const earnedNow =
        wasAlreadyPaid
          ? 0
          : Math.floor(
              (
                totalAmount
                * bonusRatePercent
              )
              / 100
            );

      let balanceAfter =
        Number(
          customer.bonus_balance
          || 0
        );

      const paymentAuditKey =
        (params.source ?? "").startsWith("yookassa")
          ? "providerPayment"
          : "manualPayment";

      const paymentAudit = {
        version: 2,
        source: params.source ?? "admin_manual_paid",
        markedAt: new Date().toISOString(),
        providerPaymentId: params.providerPaymentId ?? null,
        providerSnapshot: params.providerPayload ?? null
      };

      if (!wasAlreadyPaid) {
        await transaction`
          UPDATE orders
          SET
            payment_status =
              'paid',
            bonus_earned =
              ${earnedNow},
            /*
             * ORDER PAYMENT AUDIT JSONB 1.1
             *
             * Сначала создаём или сохраняем
             * объект financial, затем добавляем
             * в него manualPayment.
             */
            metadata =
              jsonb_set(
                COALESCE(
                  metadata,
                  '{}'::jsonb
                ),
                '{financial}',
                COALESCE(
                  metadata
                    -> 'financial',
                  '{}'::jsonb
                )
                || jsonb_build_object(
                  ${paymentAuditKey}::text,
                  CAST(
                    ${JSON.stringify(
                      paymentAudit
                    )}
                    AS jsonb
                  )
                ),
                true
              ),
            updated_at =
              NOW()
          WHERE shop_id =
              ${params.shopId}
            AND id =
              ${order.id}
        `;
      }

      const selectedPayment = params.paymentId
        ? paymentRows.find((payment) => payment.id === params.paymentId)
        : params.providerPaymentId
          ? paymentRows.find(
              (payment) => payment.provider_payment_id === params.providerPaymentId
            ) ?? paymentRows[0]
          : paymentRows[0];

      if (params.paymentId && !selectedPayment) {
        throw new HttpError(409, "Платёжная попытка заказа не найдена");
      }

      let paymentCreated = false;
      let paymentId = selectedPayment?.id ?? null;

      const paymentRepaired =
        wasAlreadyPaid
        && paidPayments.length === 0;

      if (selectedPayment) {
        await transaction`
          UPDATE payments
          SET
            status = 'paid',
            provider_payment_id = COALESCE(
              ${params.providerPaymentId ?? null},
              provider_payment_id
            ),
            paid_at = COALESCE(
              ${params.paidAt ?? null}::timestamptz,
              paid_at,
              NOW()
            ),
            raw_payload =
              COALESCE(
                raw_payload,
                '{}'::jsonb
              )
              || CAST(
                ${JSON.stringify(
                  paymentAudit
                )}
                AS jsonb
              ),
            updated_at =
              NOW()
          WHERE shop_id =
              ${params.shopId}
            AND id =
              ${selectedPayment.id}
        `;
      } else {
        const createdPaymentRows = await transaction<{ id: string }[]>`
          INSERT INTO payments (
            shop_id,
            order_id,
            provider,
            provider_payment_id,
            idempotency_key,
            method,
            status,
            amount,
            currency,
            payment_url,
            raw_payload,
            paid_at,
            created_at,
            updated_at
          )
          VALUES (
            ${params.shopId},
            ${order.id},
            ${
              (params.source ?? "").startsWith("yookassa")
                ? "yookassa"
                : "manual"
            },
            ${params.providerPaymentId ?? null},
            ${(
              (params.source ?? "").startsWith("yookassa")
                ? `yookassa-paid-${params.providerPaymentId ?? order.id}`
                : `manual-paid-${order.id}`
            ).slice(0, 64)},
            ${order.payment_method}
              ::payment_method,
            'paid',
            ${totalAmount},
            'RUB',
            NULL,
            CAST(
              ${JSON.stringify(
                paymentAudit
              )}
              AS jsonb
            ),
            COALESCE(${params.paidAt ?? null}::timestamptz, NOW()),
            NOW(),
            NOW()
          )
          RETURNING id
        `;

        paymentCreated = true;
        paymentId = createdPaymentRows[0]?.id ?? null;
      }

      if (!paymentId) {
        throw new HttpError(500, "Не удалось определить платёжную запись");
      }

      await recordPaymentEvent({
        client: transaction,
        shopId: params.shopId,
        orderId: order.id,
        paymentId,
        provider: (params.source ?? "").startsWith("yookassa") ? "yookassa" : "manual",
        eventType: "payment.paid",
        source: params.source ?? "admin_manual_paid",
        previousStatus: (selectedPayment?.status ?? order.payment_status) as
          | "created"
          | "pending"
          | "waiting_for_capture"
          | "paid"
          | "failed"
          | "cancelled"
          | "expired",
        nextStatus: "paid",
        providerEventId: params.providerPaymentId ?? null,
        idempotencyKey: `paid:${params.source ?? "admin_manual_paid"}:${params.providerPaymentId ?? order.id}`,
        payload: paymentAudit,
        occurredAt: params.paidAt ?? null,
      });

      if (
        !wasAlreadyPaid
        && earnedNow > 0
      ) {
        const updatedCustomerRows =
          await transaction<
            CustomerRow[]
          >`
            UPDATE customers
            SET
              bonus_balance =
                bonus_balance
                + ${earnedNow},
              updated_at =
                NOW()
            WHERE shop_id =
                ${params.shopId}
              AND id =
                ${order.customer_id}
            RETURNING
              bonus_balance
          `;

        const updatedCustomer =
          updatedCustomerRows[0];

        if (!updatedCustomer) {
          throw new HttpError(
            409,
            "Не удалось обновить бонусный баланс клиента"
          );
        }

        balanceAfter =
          Number(
            updatedCustomer
              .bonus_balance
          );

        await transaction`
          INSERT INTO bonus_transactions (
            shop_id,
            customer_id,
            order_id,
            type,
            amount,
            balance_after,
            comment,
            created_at
          )
          VALUES (
            ${params.shopId},
            ${order.customer_id},
            ${order.id},
            'earn',
            ${earnedNow},
            ${balanceAfter},
            ${`Начисление ${bonusRatePercent}% за оплаченный заказ ${order.order_number}`},
            NOW()
          )
        `;
      }

      if (!wasAlreadyPaid) {
        await transaction`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            status,
            payload,
            created_at,
            updated_at
          )
          SELECT
            CAST(
              ${params.shopId}
              AS uuid
            ),
            CAST(
              ${order.id}
              AS uuid
            ),
            'order_paid',
            'telegram',
            'staff',
            'pending',
            CAST(
              ${JSON.stringify({
                orderId:
                  order.id,
                orderNumber:
                  order.order_number,
                status:
                  order.status,
                paymentStatus:
                  "paid",
                totalAmount,
                bonusEarned:
                  earnedNow,
                balanceAfter
              })}
              AS jsonb
            ),
            NOW(),
            NOW()
          WHERE NOT EXISTS (
            SELECT 1
            FROM notification_events
            WHERE shop_id =
                ${params.shopId}
              AND order_id =
                ${order.id}
              AND type =
                'order_paid'
              AND recipient_type =
                'staff'
          )
        `;

        await transaction`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            status,
            payload,
            created_at,
            updated_at
          )
          SELECT
            o.shop_id,
            o.id,
            'order_paid',
            'telegram',
            'customer',
            'pending',
            jsonb_build_object(
              'orderId',
                o.id,
              'orderNumber',
                o.order_number,
              'status',
                o.status::text,
              'paymentStatus',
                'paid',
              'totalAmount',
                o.total,
              'bonusEarned',
                CAST(
                  ${earnedNow}
                  AS integer
                ),
              'balanceAfter',
                CAST(
                  ${balanceAfter}
                  AS integer
                ),
              'customerName',
                c.name,
              'customerPhone',
                c.phone,
              'recipientName',
                o.recipient_name,
              'recipientPhone',
                o.recipient_phone,
              'deliveryAddressText',
                o.delivery_address_text,
              'deliveryComment',
                o.delivery_comment,
              'bouquetPhotoUrl',
                o.bouquet_photo_url,
              'trackingToken',
                o.tracking_token,
              'trackingUrl',
                CASE
                  WHEN
                    o.tracking_token
                    IS NULL
                    OR o.tracking_token
                      = ''
                  THEN NULL
                  ELSE
                    '/order/track/'
                    || o.tracking_token
                END
            ),
            NOW(),
            NOW()
          FROM orders o
          LEFT JOIN customers c
            ON c.id =
              o.customer_id
          WHERE o.shop_id =
              ${params.shopId}
            AND o.id =
              ${order.id}
            AND o.customer_id
              IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM notification_events
              existing_event
              WHERE
                existing_event.shop_id =
                  ${params.shopId}
                AND existing_event.order_id =
                  ${order.id}
                AND existing_event.type =
                  'order_paid'
                AND existing_event.channel =
                  'telegram'
                AND existing_event.recipient_type =
                  'customer'
            )
        `;


        if (env.MAX_BOT_TOKEN) {
          await transaction`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            status,
            payload,
            created_at,
            updated_at
          )
          SELECT
            o.shop_id,
            o.id,
            'order_paid',
            'max',
            'customer',
            'pending',
            jsonb_build_object(
              'orderId',
                o.id,
              'orderNumber',
                o.order_number,
              'status',
                o.status::text,
              'paymentStatus',
                'paid',
              'totalAmount',
                o.total,
              'bonusEarned',
                CAST(
                  ${earnedNow}
                  AS integer
                ),
              'balanceAfter',
                CAST(
                  ${balanceAfter}
                  AS integer
                ),
              'customerName',
                c.name,
              'customerPhone',
                c.phone,
              'recipientName',
                o.recipient_name,
              'recipientPhone',
                o.recipient_phone,
              'deliveryAddressText',
                o.delivery_address_text,
              'deliveryComment',
                o.delivery_comment,
              'bouquetPhotoUrl',
                o.bouquet_photo_url,
              'trackingToken',
                o.tracking_token,
              'trackingUrl',
                CASE
                  WHEN
                    o.tracking_token
                    IS NULL
                    OR o.tracking_token
                      = ''
                  THEN NULL
                  ELSE
                    '/order/track/'
                    || o.tracking_token
                END
            ),
            NOW(),
            NOW()
          FROM orders o
          JOIN shops s ON s.id = o.shop_id
          LEFT JOIN customers c
            ON c.id =
              o.customer_id
          WHERE o.shop_id =
              ${params.shopId}
            AND o.id =
              ${order.id}
            AND o.customer_id
              IS NOT NULL
            AND ${env.MAX_BOT_TOKEN !== ''}
            AND LOWER(COALESCE(s.settings #>> '{features,maxEnabled}', 'false')) = 'true'
            AND LOWER(COALESCE(s.settings #>> '{features,maxNotificationsEnabled}', 'false')) = 'true'
            AND NOT EXISTS (
              SELECT 1
              FROM notification_events
              existing_event
              WHERE
                existing_event.shop_id =
                  ${params.shopId}
                AND existing_event.order_id =
                  ${order.id}
                AND existing_event.type =
                  'order_paid'
                AND existing_event.channel =
                  'max'
                AND existing_event.recipient_type =
                  'customer'
            )
          `;
        }
      }

      const updatedRows =
        await transaction<
          UpdatedOrderRow[]
        >`
          SELECT
            o.*,
            c.phone
              AS customer_phone,
            c.name
              AS customer_name,
            o.total
              AS total_amount
          FROM orders o
          LEFT JOIN customers c
            ON c.id =
              o.customer_id
          WHERE o.shop_id =
              ${params.shopId}
            AND o.id =
              ${order.id}
          LIMIT 1
        `;

      const updatedOrder =
        updatedRows[0];

      if (!updatedOrder) {
        throw new HttpError(
          500,
          "Не удалось получить обновлённый заказ"
        );
      }

      return {
        order:
          updatedOrder,
        earnedNow,
        balanceAfter,
        wasAlreadyPaid,
        paymentCreated,
        paymentRepaired
      };
    };

  if (params.transaction) {
    return execute(params.transaction as SqlClient);
  }

  if (!params.client) {
    throw new HttpError(500, "Не передано подключение к базе данных");
  }

  return params.client.begin(
    async (transaction) => execute(transaction as unknown as SqlClient)
  );
}
