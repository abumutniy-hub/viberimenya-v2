import { createDb } from "@viberimenya/db";
import { env } from "../../lib/env";
import { reconcileProviderPayment } from "../../routes/payments";
import { rollbackOrderFinancialsOnCancellation } from "../orders/order-finance.service";
import { recordPaymentEvent } from "./payment-audit.service";
import { expectedAmountMinor, type ProviderPaymentSnapshot } from "./payment-provider";
import { yooKassaProvider } from "./yookassa.service";

type ExpiryCandidate = {
  payment_id: string;
  provider_payment_id: string | null;
  shop_id: string;
  order_id: string;
  total: number;
};

type LockedExpiry = {
  payment_id: string;
  shop_id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  payment_status: string;
  local_payment_status: string;
  payment_method: string;
  tracking_token: string;
  customer_id: string | null;
  total: number;
  expires_at: string;
};

async function expireOne(
  client: ReturnType<typeof createDb>["client"],
  paymentId: string,
  providerPayment: ProviderPaymentSnapshot | null,
) {
  return client.begin(async (transaction) => {
    const rows = await transaction<LockedExpiry[]>`
      SELECT
        p.id AS payment_id,
        p.shop_id,
        p.order_id,
        o.order_number,
        o.status::text AS order_status,
        o.payment_status::text AS payment_status,
        p.status::text AS local_payment_status,
        o.payment_method::text AS payment_method,
        o.tracking_token,
        o.customer_id,
        o.total,
        p.expires_at::text AS expires_at
      FROM payments p
      JOIN orders o
        ON o.shop_id = p.shop_id
        AND o.id = p.order_id
      WHERE p.id = ${paymentId}
        AND p.status IN ('created', 'pending', 'waiting_for_capture', 'failed', 'cancelled')
        AND p.expires_at IS NOT NULL
        AND p.expires_at <= NOW()
      LIMIT 1
      FOR UPDATE OF p, o
    `;

    const row = rows[0];

    if (!row) return false;

    if (row.payment_status === "paid" || row.payment_status === "refunded") {
      return false;
    }

    if (row.order_status === "delivered" || row.order_status === "cancelled") {
      await transaction`
        UPDATE payments
        SET
          status = 'expired',
          expired_at = COALESCE(expired_at, NOW()),
          payment_url = NULL,
          last_provider_status = COALESCE(
            ${providerPayment?.providerStatus ?? null},
            last_provider_status,
            'local_expired'
          ),
          updated_at = NOW()
        WHERE id = ${row.payment_id}
          AND status IN ('created', 'pending', 'waiting_for_capture', 'failed', 'cancelled')
      `;

      await recordPaymentEvent({
        client: transaction,
        shopId: row.shop_id,
        orderId: row.order_id,
        paymentId: row.payment_id,
        provider: "yookassa",
        eventType: "payment.expired",
        source: "expiry_worker",
        previousStatus: row.local_payment_status as "created" | "pending" | "waiting_for_capture",
        nextStatus: "expired",
        idempotencyKey: `expired:${row.payment_id}`,
        payload: { expiresAt: row.expires_at, orderAlreadyClosed: true },
      });

      return true;
    }

    await transaction`
      UPDATE payments
      SET
        status = 'expired',
        expired_at = COALESCE(expired_at, NOW()),
        payment_url = NULL,
        last_provider_status = COALESCE(
          ${providerPayment?.providerStatus ?? null},
          last_provider_status,
          'local_expired'
        ),
        raw_payload = COALESCE(raw_payload, '{}'::jsonb)
          || jsonb_build_object(
            'expiredAt', NOW(),
            'expiredBy', 'payment_expiry_worker',
            'providerSnapshot', ${JSON.stringify(providerPayment?.raw ?? null)}::jsonb
          ),
        updated_at = NOW()
      WHERE id = ${row.payment_id}
          AND status IN ('created', 'pending', 'waiting_for_capture', 'failed', 'cancelled')
    `;

    const rollback = await rollbackOrderFinancialsOnCancellation({
      transaction,
      shopId: row.shop_id,
      orderId: row.order_id,
      actorUserId: null,
    });

    await transaction`
      UPDATE orders
      SET
        status = 'cancelled',
        payment_status = 'expired',
        cancelled_at = COALESCE(cancelled_at, NOW()),
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{financial}',
          COALESCE(metadata -> 'financial', '{}'::jsonb)
            || jsonb_build_object(
              'paymentExpiry',
              ${JSON.stringify({
                state: "completed",
                source: "payment_expiry_worker",
                paymentId: row.payment_id,
                expiredAt: new Date().toISOString(),
                bonusReturned: rollback.bonusReturned,
                promoRestored: rollback.promoRestored,
                releasedUnits: rollback.releasedUnits,
              })}::jsonb
            ),
          true
        ),
        updated_at = NOW()
      WHERE shop_id = ${row.shop_id}
        AND id = ${row.order_id}
    `;

    if (row.order_status !== "cancelled") {
      await transaction`
        INSERT INTO order_status_history (
          shop_id,
          order_id,
          from_status,
          to_status,
          changed_by_user_id,
          comment,
          created_at
        )
        VALUES (
          ${row.shop_id},
          ${row.order_id},
          ${row.order_status}::order_status,
          'cancelled',
          NULL,
          'Истёк срок онлайн-оплаты',
          NOW()
        )
      `;
    }

    const payload = {
      orderId: row.order_id,
      orderNumber: row.order_number,
      paymentId: row.payment_id,
      paymentStatus: "expired",
      paymentMethod: row.payment_method,
      totalAmount: Number(row.total || 0),
      trackingToken: row.tracking_token,
      trackingUrl: `/order/track/${row.tracking_token}`,
      bonusReturned: rollback.bonusReturned,
      promoRestored: rollback.promoRestored,
      releasedUnits: rollback.releasedUnits,
    };

    await transaction`
      INSERT INTO notification_events (
        shop_id, order_id, type, channel, recipient_type,
        status, payload, created_at, updated_at
      )
      SELECT
        ${row.shop_id}, ${row.order_id}, 'order_payment_expired',
        'telegram', 'staff', 'pending', ${JSON.stringify(payload)}::jsonb,
        NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM notification_events
        WHERE shop_id = ${row.shop_id}
          AND order_id = ${row.order_id}
          AND type = 'order_payment_expired'
          AND recipient_type = 'staff'
      )
    `;

    if (row.customer_id) {
      await transaction`
        INSERT INTO notification_events (
          shop_id, order_id, type, channel, recipient_type,
          status, payload, created_at, updated_at
        )
        SELECT
          ${row.shop_id}, ${row.order_id}, 'order_payment_expired',
          'telegram', 'customer', 'pending', ${JSON.stringify(payload)}::jsonb,
          NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM notification_events
          WHERE shop_id = ${row.shop_id}
            AND order_id = ${row.order_id}
            AND type = 'order_payment_expired'
            AND recipient_type = 'customer'
        )
      `;
    }

    await recordPaymentEvent({
      client: transaction,
      shopId: row.shop_id,
      orderId: row.order_id,
      paymentId: row.payment_id,
      provider: "yookassa",
      eventType: "payment.expired",
      source: "expiry_worker",
      previousStatus: row.local_payment_status as "created" | "pending" | "waiting_for_capture",
      nextStatus: "expired",
      idempotencyKey: `expired:${row.payment_id}`,
      payload: {
        expiresAt: row.expires_at,
        rollback,
      },
    });

    return true;
  });
}

export async function expirePendingPayments(limit = 50) {
  const { client } = createDb();

  try {
    const candidates = await client<ExpiryCandidate[]>`
      SELECT
        p.id AS payment_id,
        p.provider_payment_id,
        p.shop_id,
        p.order_id,
        o.total
      FROM payments p
      JOIN orders o
        ON o.shop_id = p.shop_id
        AND o.id = p.order_id
      WHERE p.provider = 'yookassa'
        AND p.status IN ('created', 'pending', 'waiting_for_capture', 'failed', 'cancelled')
        AND p.expires_at IS NOT NULL
        AND p.expires_at <= NOW()
        AND o.payment_status NOT IN ('paid', 'refunded')
        AND NOT EXISTS (
          SELECT 1
          FROM payments newer
          WHERE newer.shop_id = p.shop_id
            AND newer.order_id = p.order_id
            AND newer.provider = p.provider
            AND newer.attempt_no > p.attempt_no
        )
      ORDER BY p.expires_at ASC, p.id ASC
      LIMIT ${Math.max(1, Math.min(500, limit))}
    `;

    let expired = 0;

    for (const candidate of candidates) {
      let providerPayment: ProviderPaymentSnapshot | null = null;

      if (candidate.provider_payment_id) {
        try {
          providerPayment = await yooKassaProvider.getPayment(candidate.provider_payment_id);

          if (
            providerPayment.amountMinor !== expectedAmountMinor(candidate.total)
            || providerPayment.currency !== "RUB"
            || providerPayment.shopId !== candidate.shop_id
            || providerPayment.orderId !== candidate.order_id
          ) {
            throw new Error("provider payment does not match local order");
          }

          if (providerPayment.status === "paid") {
            await reconcileProviderPayment(client, providerPayment, "yookassa_sync");
            continue;
          }

          if (
            providerPayment.status === "pending"
            || providerPayment.status === "waiting_for_capture"
          ) {
            providerPayment = await yooKassaProvider.cancelPayment(
              providerPayment.id,
              `expire-${candidate.payment_id}`.slice(0, 64),
            );
          }

          if (providerPayment.status !== "cancelled") {
            console.error(
              `[payments] provider payment ${candidate.provider_payment_id} was not cancelled before expiry`,
            );
            continue;
          }
        } catch (error) {
          console.error(
            `[payments] could not verify/cancel provider payment ${candidate.provider_payment_id}`,
            error,
          );
          continue;
        }
      }

      if (await expireOne(client, candidate.payment_id, providerPayment)) expired += 1;
    }

    return expired;
  } finally {
    await client.end();
  }
}

export function startPaymentExpiryWorker() {
  let stopped = false;
  let running: Promise<void> | null = null;

  const sweep = () => {
    if (stopped || running) return;

    running = expirePendingPayments()
      .then((expired) => {
        if (expired > 0) {
          console.log(`[payments] expired ${expired} unpaid payment attempt(s)`);
        }
      })
      .catch((error) => {
        console.error("[payments] expiry sweep failed", error);
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(sweep, env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS);
  timer.unref();
  sweep();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
