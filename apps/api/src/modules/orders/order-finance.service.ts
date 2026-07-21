import type { createDb } from "@viberimenya/db";
import { HttpError } from "../../lib/http-error";
import { recordPaymentEvent } from "../payments/payment-audit.service";

type SqlClient = ReturnType<typeof createDb>["client"];

type RefundOrderParams = {
  client: SqlClient;
  shopId: string;
  orderId: string;
  actorUserId: string | null;
  reason: string;
  cancelOrder: boolean;
  source?: "admin_manual_full_refund" | "yookassa_refund" | "yookassa_webhook";
  providerRefundId?: string;
  providerPayload?: unknown;
};

type CancellationRollbackParams = {
  transaction: any;
  shopId: string;
  orderId: string;
  actorUserId: string | null;
};

type RefundResult = {
  changed: boolean;
  orderId: string;
  orderNumber: string;
  previousStatus: string;
  status: string;
  paymentStatus: string;
  amount: number;
  bonusReturned: number;
  bonusReversed: number;
  balanceAfter: number | null;
  promoRestored: boolean;
  releasedUnits: number;
  paymentCreated: boolean;
};

type CancellationRollbackResult = {
  changed: boolean;
  bonusReturned: number;
  balanceAfter: number | null;
  promoRestored: boolean;
  releasedUnits: number;
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

async function restorePromocodeUsage(
  transaction: any,
  params: {
    shopId: string;
    promoCode: string;
  }
) {
  if (!params.promoCode) {
    return false;
  }

  const rows = await transaction<{ id: string }[]>`
    UPDATE promocodes
    SET
      used_count = GREATEST(0, used_count - 1),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND UPPER(code) = UPPER(${params.promoCode})
      AND used_count > 0
    RETURNING id
  `;

  return Boolean(rows[0]);
}

async function releaseReservedInventory(
  transaction: any,
  params: {
    shopId: string;
    orderId: string;
    reservationState: string | null;
    reservationCount: number;
    actorUserId: string | null;
    releaseReason: string;
  }
) {
  if (params.reservationState !== "reserved") {
    return 0;
  }

  if (params.reservationCount < 1) {
    throw new HttpError(
      500,
      "Повреждён журнал резервирования заказа"
    );
  }

  const restoredRows = await transaction<{
    product_id: string;
    quantity: number;
  }[]>`
    WITH reservation_items AS (
      SELECT
        (item ->> 'productId')::uuid AS product_id,
        (item ->> 'quantity')::int AS quantity
      FROM orders source_order
      CROSS JOIN LATERAL jsonb_array_elements(
        source_order.metadata #> '{inventoryReservation,items}'
      ) AS item
      WHERE source_order.shop_id = ${params.shopId}
        AND source_order.id = ${params.orderId}
        AND source_order.metadata #>> '{inventoryReservation,state}' = 'reserved'
        AND jsonb_typeof(item) = 'object'
        AND item ? 'productId'
        AND item ? 'quantity'
        AND (item ->> 'productId') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (item ->> 'quantity') ~ '^[1-9][0-9]*$'
        AND (item ->> 'quantity')::int BETWEEN 1 AND 99
    ),
    unique_items AS (
      SELECT
        product_id,
        SUM(quantity)::int AS quantity
      FROM reservation_items
      GROUP BY product_id
    )
    UPDATE products product
    SET
      stock_quantity = COALESCE(product.stock_quantity, 0) + unique_items.quantity,
      updated_at = NOW()
    FROM unique_items
    WHERE product.shop_id = ${params.shopId}
      AND product.id = unique_items.product_id
    RETURNING
      product.id AS product_id,
      unique_items.quantity
  `;

  if (restoredRows.length !== params.reservationCount) {
    throw new HttpError(
      409,
      "Не удалось вернуть все товары из резерва. Проверьте каталог."
    );
  }

  const releasedUnits = restoredRows.reduce(
    (sum: number, row: { quantity: number }) => sum + Number(row.quantity || 0),
    0
  );

  const releasePatch = {
    state: "released",
    releasedAt: new Date().toISOString(),
    releasedByUserId: params.actorUserId,
    releaseReason: params.releaseReason
  };

  await transaction`
    UPDATE orders
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{inventoryReservation}',
        COALESCE(metadata -> 'inventoryReservation', '{}'::jsonb)
          || CAST(${JSON.stringify(releasePatch)} AS jsonb),
        true
      ),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND id = ${params.orderId}
  `;

  return releasedUnits;
}

/**
 * Возвращает бонусы и лимит промокода при отмене НЕОПЛАЧЕННОГО заказа.
 * Вызывается внутри той же транзакции, что и смена статуса на cancelled.
 */
export async function rollbackOrderFinancialsOnCancellation(
  params: CancellationRollbackParams
): Promise<CancellationRollbackResult> {
  const orderRows = await params.transaction<{
    id: string;
    customer_id: string | null;
    order_number: string;
    payment_status: string;
    total: number;
    bonus_spent: number;
    bonus_earned: number;
    metadata: Record<string, unknown> | null;
    rollback_state: string | null;
    reservation_state: string | null;
    reservation_count: number;
  }[]>`
    SELECT
      id,
      customer_id,
      order_number,
      payment_status::text AS payment_status,
      total,
      bonus_spent,
      bonus_earned,
      metadata,
      metadata #>> '{financial,cancellationRollback,state}' AS rollback_state,
      metadata #>> '{inventoryReservation,state}' AS reservation_state,
      CASE
        WHEN jsonb_typeof(metadata #> '{inventoryReservation,items}') = 'array'
        THEN jsonb_array_length(metadata #> '{inventoryReservation,items}')
        ELSE 0
      END::int AS reservation_count
    FROM orders
    WHERE shop_id = ${params.shopId}
      AND id = ${params.orderId}
    LIMIT 1
    FOR UPDATE
  `;

  const order = orderRows[0];

  if (!order) {
    throw new HttpError(404, "Заказ не найден");
  }

  if (order.payment_status === "paid") {
    throw new HttpError(
      409,
      "Оплаченный заказ нельзя отменить до фиксации полного возврата. Возврат доступен владельцу или администратору."
    );
  }

  if (order.rollback_state === "completed") {
    const releasedUnits = await releaseReservedInventory(params.transaction, {
      shopId: params.shopId,
      orderId: order.id,
      reservationState: order.reservation_state,
      reservationCount: order.reservation_count,
      actorUserId: params.actorUserId,
      releaseReason: "order_cancellation_repair"
    });

    return {
      changed: releasedUnits > 0,
      bonusReturned: 0,
      balanceAfter: null,
      promoRestored: false,
      releasedUnits
    };
  }

  // Полный возврат уже выполнил финансовый откат.
  if (order.payment_status === "refunded") {
    return {
      changed: false,
      bonusReturned: 0,
      balanceAfter: null,
      promoRestored: false,
      releasedUnits: 0
    };
  }

  if (Number(order.bonus_earned || 0) > 0) {
    throw new HttpError(
      409,
      "У неоплаченного заказа обнаружены начисленные бонусы. Проверьте финансовую историю заказа."
    );
  }

  const metadata = objectValue(order.metadata);
  const promoCode = textValue(metadata.promoCode);
  const bonusReturned = Math.max(0, Number(order.bonus_spent || 0));
  let balanceAfter: number | null = null;

  const releasedUnits = await releaseReservedInventory(params.transaction, {
    shopId: params.shopId,
    orderId: order.id,
    reservationState: order.reservation_state,
    reservationCount: order.reservation_count,
    actorUserId: params.actorUserId,
    releaseReason: "order_cancellation"
  });

  if (order.customer_id) {
    const customerRows = await params.transaction<{
      bonus_balance: number;
    }[]>`
      SELECT bonus_balance
      FROM customers
      WHERE shop_id = ${params.shopId}
        AND id = ${order.customer_id}
      LIMIT 1
      FOR UPDATE
    `;

    const customer = customerRows[0];

    if (!customer) {
      throw new HttpError(409, "Клиент заказа не найден");
    }

    const updatedRows = await params.transaction<{
      bonus_balance: number;
    }[]>`
      UPDATE customers
      SET
        bonus_balance = bonus_balance + ${bonusReturned},
        total_spent = GREATEST(0, total_spent - ${Math.max(0, Number(order.total || 0))}),
        updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND id = ${order.customer_id}
      RETURNING bonus_balance
    `;

    balanceAfter = Number(updatedRows[0]?.bonus_balance ?? customer.bonus_balance);

    if (bonusReturned > 0) {
      await params.transaction`
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
          'manual_add',
          ${bonusReturned},
          ${balanceAfter},
          ${`Возврат списанных бонусов после отмены заказа ${order.order_number}`},
          NOW()
        )
      `;
    }
  } else if (bonusReturned > 0) {
    throw new HttpError(
      409,
      "Нельзя вернуть списанные бонусы: у заказа не указан клиент"
    );
  }

  const promoRestored = await restorePromocodeUsage(params.transaction, {
    shopId: params.shopId,
    promoCode
  });

  const cancellablePayments = await params.transaction<{
    id: string;
    provider: string;
    status: "created" | "pending" | "waiting_for_capture" | "failed";
  }[]>`
    SELECT id, provider, status::text AS status
    FROM payments
    WHERE shop_id = ${params.shopId}
      AND order_id = ${order.id}
      AND status IN ('created', 'pending', 'waiting_for_capture', 'failed')
    FOR UPDATE
  `;

  await params.transaction`
    UPDATE payments
    SET
      status = 'cancelled',
      raw_payload = COALESCE(raw_payload, '{}'::jsonb)
        || jsonb_build_object(
          'cancelledAt', NOW(),
          'cancelledByUserId', ${params.actorUserId}::uuid,
          'source', 'order_cancellation'
        ),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND order_id = ${order.id}
      AND status IN ('created', 'pending', 'waiting_for_capture', 'failed')
  `;

  for (const payment of cancellablePayments) {
    await recordPaymentEvent({
      client: params.transaction,
      shopId: params.shopId,
      orderId: order.id,
      paymentId: payment.id,
      provider: payment.provider,
      eventType: "payment.cancelled",
      source: "order_cancellation",
      previousStatus: payment.status,
      nextStatus: "cancelled",
      idempotencyKey: `order-cancelled:${order.id}:${payment.id}`,
      payload: {
        actorUserId: params.actorUserId,
        bonusReturned,
        promoRestored,
        releasedUnits,
      },
    });
  }

  const rollbackPatch = {
    state: "completed",
    completedAt: new Date().toISOString(),
    completedByUserId: params.actorUserId,
    bonusReturned,
    balanceAfter,
    promoRestored,
    releasedUnits
  };

  await params.transaction`
    UPDATE orders
    SET
      payment_status = 'cancelled',
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{financial}',
        COALESCE(metadata -> 'financial', '{}'::jsonb)
          || jsonb_build_object(
            'cancellationRollback',
            CAST(${JSON.stringify(rollbackPatch)} AS jsonb)
          ),
        true
      ),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND id = ${order.id}
  `;

  return {
    changed: true,
    bonusReturned,
    balanceAfter,
    promoRestored,
    releasedUnits
  };
}

/**
 * Фиксирует ПОЛНЫЙ ручной возврат в учёте магазина.
 * Денежный перевод клиенту выполняется вне системы до подключения провайдера.
 */
export async function recordFullOrderRefund(
  params: RefundOrderParams
): Promise<RefundResult> {
  return params.client.begin(async (transaction) => {
    const orderRows = await transaction<{
      id: string;
      customer_id: string | null;
      order_number: string;
      status: string;
      payment_status: string;
      payment_method: string;
      total: number;
      bonus_spent: number;
      bonus_earned: number;
      metadata: Record<string, unknown> | null;
      refund_state: string | null;
      reservation_state: string | null;
      reservation_count: number;
    }[]>`
      SELECT
        id,
        customer_id,
        order_number,
        status::text AS status,
        payment_status::text AS payment_status,
        payment_method::text AS payment_method,
        total,
        bonus_spent,
        bonus_earned,
        metadata,
        metadata #>> '{financial,refund,state}' AS refund_state,
        metadata #>> '{inventoryReservation,state}' AS reservation_state,
        CASE
          WHEN jsonb_typeof(metadata #> '{inventoryReservation,items}') = 'array'
          THEN jsonb_array_length(metadata #> '{inventoryReservation,items}')
          ELSE 0
        END::int AS reservation_count
      FROM orders
      WHERE shop_id = ${params.shopId}
        AND id = ${params.orderId}
      LIMIT 1
      FOR UPDATE
    `;

    const order = orderRows[0];

    if (!order) {
      throw new HttpError(404, "Заказ не найден");
    }

    if (
      order.refund_state === "completed"
      || order.payment_status === "refunded"
    ) {
      const metadata = objectValue(order.metadata);
      const financial = objectValue(metadata.financial);
      const refund = objectValue(financial.refund);

      return {
        changed: false,
        orderId: order.id,
        orderNumber: order.order_number,
        previousStatus: order.status,
        status: order.status,
        paymentStatus: "refunded",
        amount: Math.max(0, Number(order.total || 0)),
        bonusReturned: Number(refund.bonusReturned || 0),
        bonusReversed: Number(refund.bonusReversed || 0),
        balanceAfter:
          typeof refund.balanceAfter === "number"
            ? refund.balanceAfter
            : null,
        promoRestored: refund.promoRestored === true,
        releasedUnits: Number(refund.releasedUnits || 0),
        paymentCreated: refund.paymentCreated === true
      };
    }

    if (order.payment_status !== "paid") {
      throw new HttpError(
        409,
        "Полный возврат можно зафиксировать только для оплаченного заказа"
      );
    }

    const amount = Math.max(0, Number(order.total || 0));
    const bonusReturned = Math.max(0, Number(order.bonus_spent || 0));
    const bonusReversed = Math.max(0, Number(order.bonus_earned || 0));
    const metadata = objectValue(order.metadata);
    const promoCode = textValue(metadata.promoCode);
    let balanceAfter: number | null = null;

    if (order.customer_id) {
      const customerRows = await transaction<{
        bonus_balance: number;
      }[]>`
        SELECT bonus_balance
        FROM customers
        WHERE shop_id = ${params.shopId}
          AND id = ${order.customer_id}
        LIMIT 1
        FOR UPDATE
      `;

      const customer = customerRows[0];

      if (!customer) {
        throw new HttpError(409, "Клиент заказа не найден");
      }

      const nextBalance =
        Number(customer.bonus_balance || 0)
        + bonusReturned
        - bonusReversed;

      const updatedRows = await transaction<{
        bonus_balance: number;
      }[]>`
        UPDATE customers
        SET
          bonus_balance = ${nextBalance},
          total_spent = GREATEST(0, total_spent - ${amount}),
          updated_at = NOW()
        WHERE shop_id = ${params.shopId}
          AND id = ${order.customer_id}
        RETURNING bonus_balance
      `;

      balanceAfter = Number(updatedRows[0]?.bonus_balance ?? nextBalance);

      if (bonusReturned > 0) {
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
            'manual_add',
            ${bonusReturned},
            ${Number(customer.bonus_balance || 0) + bonusReturned},
            ${`Возврат списанных бонусов после возврата заказа ${order.order_number}`},
            NOW()
          )
        `;
      }

      if (bonusReversed > 0) {
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
            'manual_remove',
            ${-bonusReversed},
            ${balanceAfter},
            ${`Отмена начисления бонусов после возврата заказа ${order.order_number}`},
            NOW()
          )
        `;
      }
    } else if (bonusReturned > 0 || bonusReversed > 0) {
      throw new HttpError(
        409,
        "Нельзя скорректировать бонусы: у заказа не указан клиент"
      );
    }

    const promoRestored = await restorePromocodeUsage(transaction, {
      shopId: params.shopId,
      promoCode
    });

    const paymentRows = await transaction<{
      id: string;
      status: string;
      provider: string;
    }[]>`
      SELECT id, status::text AS status, provider
      FROM payments
      WHERE shop_id = ${params.shopId}
        AND order_id = ${order.id}
      ORDER BY created_at DESC, id DESC
      FOR UPDATE
    `;

    const paidPayments = paymentRows.filter((payment) => payment.status === "paid");

    if (paidPayments.length > 1) {
      throw new HttpError(
        409,
        "У заказа обнаружено несколько оплаченных платежей"
      );
    }

    const refundAudit = {
      version: 2,
      source: params.source ?? "admin_manual_full_refund",
      refundedAt: new Date().toISOString(),
      refundedByUserId: params.actorUserId,
      reason: params.reason,
      amount,
      providerRefundId: params.providerRefundId ?? null,
      providerSnapshot: params.providerPayload ?? null
    };

    let paymentCreated = false;
    let refundedPaymentId = paidPayments[0]?.id ?? null;

    if (paidPayments[0]) {
      await transaction`
        UPDATE payments
        SET
          status = 'refunded',
          raw_payload = COALESCE(raw_payload, '{}'::jsonb)
            || CAST(${JSON.stringify(refundAudit)} AS jsonb),
          updated_at = NOW()
        WHERE shop_id = ${params.shopId}
          AND id = ${paidPayments[0].id}
      `;
    } else {
      const createdPaymentRows = await transaction<{ id: string }[]>`
        INSERT INTO payments (
          shop_id,
          order_id,
          provider,
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
          'manual',
          ${`manual-refund-repair-${order.id}`.slice(0, 64)},
          ${order.payment_method}::payment_method,
          'refunded',
          ${amount},
          'RUB',
          NULL,
          CAST(${JSON.stringify({ ...refundAudit, repairedMissingPayment: true })} AS jsonb),
          NOW(),
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      paymentCreated = true;
      refundedPaymentId = createdPaymentRows[0]?.id ?? null;
    }

    if (!refundedPaymentId) {
      throw new HttpError(500, "Не удалось определить платёж возврата");
    }

    await recordPaymentEvent({
      client: transaction,
      shopId: params.shopId,
      orderId: order.id,
      paymentId: refundedPaymentId,
      provider: paidPayments[0]?.provider ?? "manual",
      eventType: "payment.refunded",
      source: params.source ?? "admin_manual_full_refund",
      previousStatus: paidPayments[0] ? "paid" : null,
      nextStatus: "refunded",
      providerEventId: params.providerRefundId ?? null,
      idempotencyKey: `refund:${params.providerRefundId ?? order.id}`,
      payload: refundAudit,
    });

    await transaction`
      UPDATE payments
      SET
        status = 'cancelled',
        raw_payload = COALESCE(raw_payload, '{}'::jsonb)
          || jsonb_build_object(
            'cancelledAt', NOW(),
            'cancelledByUserId', ${params.actorUserId},
            'source', 'full_refund_cleanup'
          ),
        updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND order_id = ${order.id}
        AND status IN ('created', 'pending', 'waiting_for_capture', 'failed')
    `;

    const isActiveOrder =
      order.status !== "delivered"
      && order.status !== "cancelled";

    if (isActiveOrder && !params.cancelOrder) {
      throw new HttpError(
        400,
        "Активный заказ при полном возврате должен быть одновременно отменён"
      );
    }

    const shouldCancel =
      params.cancelOrder
      && isActiveOrder;

    const releasedUnits = shouldCancel
      ? await releaseReservedInventory(transaction, {
          shopId: params.shopId,
          orderId: order.id,
          reservationState: order.reservation_state,
          reservationCount: order.reservation_count,
          actorUserId: params.actorUserId,
          releaseReason: "full_refund"
        })
      : 0;

    const nextStatus = shouldCancel ? "cancelled" : order.status;

    const refundPatch = {
      state: "completed",
      completedAt: new Date().toISOString(),
      completedByUserId: params.actorUserId,
      reason: params.reason,
      amount,
      bonusReturned,
      bonusReversed,
      balanceAfter,
      promoRestored,
      releasedUnits,
      paymentCreated,
      orderCancelled: shouldCancel
    };

    await transaction`
      UPDATE orders
      SET
        payment_status = 'refunded',
        bonus_earned = 0,
        status = ${nextStatus}::order_status,
        cancelled_at = CASE
          WHEN ${shouldCancel} THEN COALESCE(cancelled_at, NOW())
          ELSE cancelled_at
        END,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{financial}',
          COALESCE(metadata -> 'financial', '{}'::jsonb)
            || jsonb_build_object(
              'refund',
              CAST(${JSON.stringify(refundPatch)} AS jsonb)
            ),
          true
        ),
        updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND id = ${order.id}
    `;

    const historyComment = [
      `Зафиксирован полный ручной возврат ${amount.toLocaleString("ru-RU")} ₽: ${params.reason}`,
      bonusReturned > 0 ? `возвращено списанных бонусов: ${bonusReturned}` : "",
      bonusReversed > 0 ? `отменено начисленных бонусов: ${bonusReversed}` : "",
      promoRestored ? "лимит промокода восстановлен" : "",
      releasedUnits > 0 ? `возвращено на склад: ${releasedUnits} шт.` : "",
      shouldCancel ? "заказ отменён" : ""
    ].filter(Boolean).join("; ");

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
        ${params.shopId},
        ${order.id},
        ${order.status}::order_status,
        ${nextStatus}::order_status,
        ${params.actorUserId},
        ${historyComment.slice(0, 1000)},
        NOW()
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
        'order_refunded',
        'telegram',
        'customer',
        'pending',
        jsonb_build_object(
          'orderId', o.id,
          'orderNumber', o.order_number,
          'status', o.status::text,
          'paymentStatus', 'refunded',
          'totalAmount', o.total,
          'refundAmount', ${amount},
          'refundReason', ${params.reason},
          'orderCancelled', ${shouldCancel},
          'trackingToken', o.tracking_token,
          'trackingUrl', CASE
            WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
            ELSE '/order/track/' || o.tracking_token
          END
        ),
        NOW(),
        NOW()
      FROM orders o
      WHERE o.shop_id = ${params.shopId}
        AND o.id = ${order.id}
        AND o.customer_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM notification_events existing
          WHERE existing.shop_id = o.shop_id
            AND existing.order_id = o.id
            AND existing.type = 'order_refunded'
            AND existing.channel = 'telegram'
            AND existing.recipient_type = 'customer'
            AND existing.status IN ('pending', 'processing', 'sent')
        )
    `;

    return {
      changed: true,
      orderId: order.id,
      orderNumber: order.order_number,
      previousStatus: order.status,
      status: nextStatus,
      paymentStatus: "refunded",
      amount,
      bonusReturned,
      bonusReversed,
      balanceAfter,
      promoRestored,
      releasedUnits,
      paymentCreated
    };
  });
}
