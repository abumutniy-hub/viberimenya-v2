import type { CorePaymentStatus } from "./payment-provider";

export async function recordPaymentEvent(params: {
  client: any;
  shopId: string;
  orderId: string;
  paymentId: string;
  provider: string;
  eventType: string;
  source: string;
  previousStatus?: CorePaymentStatus | "refunded" | "partially_refunded" | "not_required" | null;
  nextStatus?: CorePaymentStatus | "refunded" | "partially_refunded" | "not_required" | null;
  providerEventId?: string | null;
  idempotencyKey: string;
  payload?: unknown;
  occurredAt?: string | null;
}) {
  const rows = await params.client`
    INSERT INTO payment_events (
      shop_id,
      order_id,
      payment_id,
      provider,
      event_type,
      source,
      previous_status,
      next_status,
      provider_event_id,
      idempotency_key,
      payload,
      occurred_at,
      created_at
    )
    VALUES (
      ${params.shopId},
      ${params.orderId},
      ${params.paymentId},
      ${params.provider},
      ${params.eventType},
      ${params.source},
      ${params.previousStatus ?? null}::payment_status,
      ${params.nextStatus ?? null}::payment_status,
      ${params.providerEventId ?? null},
      ${params.idempotencyKey},
      ${JSON.stringify(params.payload ?? {})}::jsonb,
      COALESCE(${params.occurredAt ?? null}::timestamptz, NOW()),
      NOW()
    )
    ON CONFLICT (payment_id, idempotency_key)
    DO NOTHING
    RETURNING id
  ` as { id: string }[];

  return Boolean(rows[0]);
}
