import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";

type SqlClient = ReturnType<typeof createDb>["client"];

type SqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[]
  >(
    strings: TemplateStringsArray,
    ...parameters: any[]
  ): PromiseLike<T>;
};

type ShopRow = {
  id: string;
};

type AdminRole = "owner" | "admin" | "manager" | "florist" | "courier";

type AdminRequest = FastifyRequest & {
  adminContext?: {
    userId: string;
    shopId: string;
    role: AdminRole;
  };
};

const statusValues = [
  "all",
  "pending",
  "processing",
  "sent",
  "partial",
  "skipped",
  "dead"
] as const;

const recipientTypeValues = [
  "all",
  "customer",
  "staff"
] as const;

const channelValues = [
  "all",
  "telegram",
  "site",
  "max"
] as const;

async function getShop(client: SqlClient) {
  const rows = await client<ShopRow[]>`
    SELECT id
    FROM shops
    WHERE slug = ${env.DEFAULT_SHOP_SLUG}
    LIMIT 1
  `;

  const shop = rows[0];

  if (!shop) {
    throw new Error("Магазин не найден");
  }

  return shop;
}

function safeCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resetOutboxForRetry(
  transaction: SqlExecutor,
  params: {
    shopId: string;
    outboxId: string;
  }
) {
  const rows = await transaction<{
    id: string;
    source_notification_event_id: string | null;
  }[]>`
    SELECT
      id,
      source_notification_event_id
    FROM notification_outbox
    WHERE shop_id = ${params.shopId}
      AND id = ${params.outboxId}
      AND status IN ('dead', 'partial', 'skipped')
    FOR UPDATE
  `;

  const outbox = rows[0];

  if (!outbox) {
    return null;
  }

  const deliveryRows = await transaction<{ id: string }[]>`
    UPDATE notification_deliveries
    SET
      status = 'pending',
      attempts = 0,
      next_attempt_at = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      failed_at = NULL,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND outbox_id = ${outbox.id}
      AND status IN ('failed', 'skipped')
    RETURNING id
  `;

  await transaction`
    UPDATE notification_outbox
    SET
      status = 'pending',
      attempts = 0,
      next_attempt_at = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      sent_at = NULL,
      dead_at = NULL,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND id = ${outbox.id}
  `;

  if (outbox.source_notification_event_id) {
    await transaction`
      UPDATE notification_events
      SET
        status = 'pending',
        attempts = 0,
        error = NULL,
        sent_at = NULL,
        updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND id = ${outbox.source_notification_event_id}
        AND status <> 'sent'
    `;
  }

  return {
    outboxId: outbox.id,
    deliveriesReset: deliveryRows.length
  };
}

export function registerAdminNotificationRoutes(
  app: FastifyInstance
) {
  app.get("/api/admin/notifications", async (request) => {
    const query = z.object({
      status: z.enum(statusValues).optional().default("all"),
      channel: z.enum(channelValues).optional().default("all"),
      recipientType: z.enum(recipientTypeValues).optional().default("all"),
      type: z.string().trim().max(120).optional().default(""),
      q: z.string().trim().max(160).optional().default(""),
      page: z.coerce.number().int().min(1).max(100000).optional().default(1),
      pageSize: z.coerce.number().int().min(10).max(100).optional().default(30)
    }).parse(request.query ?? {});

    const adminContext = (request as AdminRequest).adminContext;
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const offset = (query.page - 1) * query.pageSize;
      const search = `%${query.q}%`;

      const [
        metricsRows,
        totalRows,
        outboxRows,
        typeRows,
        channelRows,
        auditRows
      ] = await Promise.all([
        client<{
          pending: number;
          processing: number;
          sent: number;
          partial: number;
          skipped: number;
          dead: number;
          sent_today: number;
          dead_24h: number;
          failed_deliveries: number;
          stale_outbox_processing: number;
          stale_delivery_processing: number;
          oldest_pending_minutes: number;
          success_rate_24h: number;
        }[]>`
          WITH outbox AS (
            SELECT *
            FROM notification_outbox
            WHERE shop_id = ${shop.id}
              AND created_at > NOW() - INTERVAL '30 days'
          ), delivery AS (
            SELECT *
            FROM notification_deliveries
            WHERE shop_id = ${shop.id}
              AND created_at > NOW() - INTERVAL '30 days'
          )
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
            COUNT(*) FILTER (
              WHERE status = 'sent'
                AND (sent_at AT TIME ZONE 'Europe/Moscow')::date
                  = (NOW() AT TIME ZONE 'Europe/Moscow')::date
            )::int AS sent_today,
            COUNT(*) FILTER (
              WHERE status = 'dead'
                AND dead_at >= NOW() - INTERVAL '24 hours'
            )::int AS dead_24h,
            (
              SELECT COUNT(*)::int
              FROM delivery
              WHERE status = 'failed'
            ) AS failed_deliveries,
            COUNT(*) FILTER (
              WHERE status = 'processing'
                AND locked_at < NOW() - INTERVAL '10 minutes'
            )::int AS stale_outbox_processing,
            (
              SELECT COUNT(*)::int
              FROM delivery
              WHERE status = 'processing'
                AND locked_at < NOW() - INTERVAL '10 minutes'
            ) AS stale_delivery_processing,
            COALESCE(
              FLOOR(
                EXTRACT(
                  EPOCH FROM (
                    NOW() - MIN(created_at) FILTER (
                      WHERE status = 'pending'
                        AND next_attempt_at <= NOW()
                    )
                  )
                ) / 60
              ),
              0
            )::int AS oldest_pending_minutes,
            COALESCE(
              (
                SELECT ROUND(
                  100.0 * COUNT(*) FILTER (WHERE status = 'sent')
                  / NULLIF(
                    COUNT(*) FILTER (WHERE status IN ('sent', 'failed')),
                    0
                  ),
                  1
                )
                FROM delivery
                WHERE created_at >= NOW() - INTERVAL '24 hours'
              ),
              100
            )::float AS success_rate_24h
          FROM outbox
        `,
        client<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM notification_outbox outbox
          LEFT JOIN orders order_row ON order_row.id = outbox.order_id
          WHERE outbox.shop_id = ${shop.id}
            AND (${query.status} = 'all' OR outbox.status = ${query.status})
            AND (${query.channel} = 'all' OR outbox.channel = ${query.channel})
            AND (${query.recipientType} = 'all' OR outbox.recipient_type = ${query.recipientType})
            AND (${query.type} = '' OR outbox.template_key = ${query.type})
            AND (
              ${query.q} = ''
              OR outbox.template_key ILIKE ${search}
              OR COALESCE(outbox.last_error, '') ILIKE ${search}
              OR COALESCE(outbox.recipient_address, '') ILIKE ${search}
              OR COALESCE(outbox.recipient_role, '') ILIKE ${search}
              OR COALESCE(order_row.order_number, '') ILIKE ${search}
              OR EXISTS (
                SELECT 1
                FROM notification_deliveries delivery
                WHERE delivery.outbox_id = outbox.id
                  AND (
                    delivery.recipient_address ILIKE ${search}
                    OR COALESCE(delivery.last_error, '') ILIKE ${search}
                  )
              )
            )
        `,
        client<{
          id: string;
          order_id: string | null;
          order_number: string | null;
          template_key: string;
          channel: string;
          recipient_type: string;
          recipient_role: string | null;
          recipient_address_masked: string | null;
          status: string;
          priority: number;
          attempts: number;
          max_attempts: number;
          next_attempt_at: string;
          locked_at: string | null;
          last_error: string | null;
          sent_at: string | null;
          dead_at: string | null;
          created_at: string;
          updated_at: string;
          deliveries_total: number;
          deliveries_pending: number;
          deliveries_processing: number;
          deliveries_sent: number;
          deliveries_failed: number;
          deliveries_skipped: number;
          deliveries: unknown;
        }[]>`
          SELECT
            outbox.id,
            outbox.order_id,
            order_row.order_number,
            outbox.template_key,
            outbox.channel,
            outbox.recipient_type,
            outbox.recipient_role,
            CASE
              WHEN outbox.recipient_address IS NULL THEN NULL
              ELSE '••••' || RIGHT(outbox.recipient_address, 4)
            END AS recipient_address_masked,
            outbox.status,
            outbox.priority,
            outbox.attempts,
            outbox.max_attempts,
            outbox.next_attempt_at::text,
            outbox.locked_at::text,
            outbox.last_error,
            outbox.sent_at::text,
            outbox.dead_at::text,
            outbox.created_at::text,
            outbox.updated_at::text,
            COUNT(delivery.id)::int AS deliveries_total,
            COUNT(delivery.id) FILTER (WHERE delivery.status = 'pending')::int AS deliveries_pending,
            COUNT(delivery.id) FILTER (WHERE delivery.status = 'processing')::int AS deliveries_processing,
            COUNT(delivery.id) FILTER (WHERE delivery.status = 'sent')::int AS deliveries_sent,
            COUNT(delivery.id) FILTER (WHERE delivery.status = 'failed')::int AS deliveries_failed,
            COUNT(delivery.id) FILTER (WHERE delivery.status = 'skipped')::int AS deliveries_skipped,
            COALESCE(
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'id', delivery.id,
                  'channel', delivery.channel,
                  'recipientType', delivery.recipient_type,
                  'recipientRole', delivery.recipient_role,
                  'recipientAddress', '••••' || RIGHT(delivery.recipient_address, 4),
                  'status', delivery.status,
                  'attempts', delivery.attempts,
                  'maxAttempts', delivery.max_attempts,
                  'nextAttemptAt', delivery.next_attempt_at,
                  'providerMessageId', delivery.provider_message_id,
                  'lastError', delivery.last_error,
                  'sentAt', delivery.sent_at,
                  'failedAt', delivery.failed_at,
                  'createdAt', delivery.created_at,
                  'updatedAt', delivery.updated_at
                )
                ORDER BY delivery.created_at ASC
              ) FILTER (WHERE delivery.id IS NOT NULL),
              '[]'::jsonb
            ) AS deliveries
          FROM notification_outbox outbox
          LEFT JOIN orders order_row ON order_row.id = outbox.order_id
          LEFT JOIN notification_deliveries delivery ON delivery.outbox_id = outbox.id
          WHERE outbox.shop_id = ${shop.id}
            AND (${query.status} = 'all' OR outbox.status = ${query.status})
            AND (${query.channel} = 'all' OR outbox.channel = ${query.channel})
            AND (${query.recipientType} = 'all' OR outbox.recipient_type = ${query.recipientType})
            AND (${query.type} = '' OR outbox.template_key = ${query.type})
            AND (
              ${query.q} = ''
              OR outbox.template_key ILIKE ${search}
              OR COALESCE(outbox.last_error, '') ILIKE ${search}
              OR COALESCE(outbox.recipient_address, '') ILIKE ${search}
              OR COALESCE(outbox.recipient_role, '') ILIKE ${search}
              OR COALESCE(order_row.order_number, '') ILIKE ${search}
              OR EXISTS (
                SELECT 1
                FROM notification_deliveries delivery_search
                WHERE delivery_search.outbox_id = outbox.id
                  AND (
                    delivery_search.recipient_address ILIKE ${search}
                    OR COALESCE(delivery_search.last_error, '') ILIKE ${search}
                  )
              )
            )
          GROUP BY
            outbox.id,
            order_row.order_number
          ORDER BY
            CASE outbox.status
              WHEN 'dead' THEN 1
              WHEN 'partial' THEN 2
              WHEN 'pending' THEN 3
              WHEN 'processing' THEN 4
              WHEN 'skipped' THEN 5
              ELSE 6
            END,
            outbox.priority ASC,
            outbox.created_at DESC
          LIMIT ${query.pageSize}
          OFFSET ${offset}
        `,
        client<{ type: string; count: number }[]>`
          SELECT
            template_key AS type,
            COUNT(*)::int AS count
          FROM notification_outbox
          WHERE shop_id = ${shop.id}
            AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY template_key
          ORDER BY count DESC, template_key ASC
          LIMIT 60
        `,
        client<{ channel: string; count: number }[]>`
          SELECT
            channel,
            COUNT(*)::int AS count
          FROM notification_outbox
          WHERE shop_id = ${shop.id}
            AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY channel
          ORDER BY count DESC, channel ASC
        `,
        client<{
          id: string;
          actor_name: string | null;
          actor_role: string | null;
          summary: string;
          entity_id: string | null;
          created_at: string;
        }[]>`
          SELECT
            audit.id,
            user_row.name AS actor_name,
            audit.actor_role,
            audit.summary,
            audit.entity_id,
            audit.created_at::text
          FROM admin_audit_log audit
          LEFT JOIN users user_row ON user_row.id = audit.actor_user_id
          WHERE audit.shop_id = ${shop.id}
            AND audit.event_type = 'notification.changed'
            AND audit.created_at > NOW() - INTERVAL '30 days'
          ORDER BY audit.created_at DESC
          LIMIT 12
        `
      ]);

      const metrics = metricsRows[0] ?? {
        pending: 0,
        processing: 0,
        sent: 0,
        partial: 0,
        skipped: 0,
        dead: 0,
        sent_today: 0,
        dead_24h: 0,
        failed_deliveries: 0,
        stale_outbox_processing: 0,
        stale_delivery_processing: 0,
        oldest_pending_minutes: 0,
        success_rate_24h: 100
      };

      const total = safeCount(totalRows[0]?.count);

      return {
        ok: true,
        metrics,
        outboxes: outboxRows,
        types: typeRows,
        channels: channelRows,
        audit: auditRows,
        permissions: {
          canDeactivateRecipient: Boolean(
            adminContext
            && ["owner", "admin"].includes(adminContext.role)
          )
        },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / query.pageSize))
        }
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/:id/retry", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const result = await client.begin(async (transaction) => {
        return resetOutboxForRetry(transaction, {
          shopId: shop.id,
          outboxId: params.id
        });
      });

      if (!result) {
        return reply.status(409).send({
          ok: false,
          message: "Повтор доступен только для dead-letter, частично доставленного или пропущенного уведомления"
        });
      }

      return {
        ok: true,
        deliveriesReset: result.deliveriesReset
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/:id/skip", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const result = await client.begin(async (transaction) => {
        const rows = await transaction<{
          id: string;
          source_notification_event_id: string | null;
        }[]>`
          UPDATE notification_outbox
          SET
            status = 'skipped',
            locked_at = NULL,
            locked_by = NULL,
            last_error = COALESCE(last_error, 'Отменено сотрудником CRM'),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
            AND status IN ('pending', 'processing', 'partial', 'dead')
          RETURNING id, source_notification_event_id
        `;

        const outbox = rows[0];

        if (!outbox) {
          return null;
        }

        const deliveries = await transaction<{ id: string }[]>`
          UPDATE notification_deliveries
          SET
            status = 'skipped',
            locked_at = NULL,
            locked_by = NULL,
            last_error = COALESCE(last_error, 'Отменено сотрудником CRM'),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND outbox_id = ${outbox.id}
            AND status IN ('pending', 'processing', 'failed')
          RETURNING id
        `;

        if (outbox.source_notification_event_id) {
          await transaction`
            UPDATE notification_events
            SET
              status = 'skipped',
              error = COALESCE(error, 'Отменено сотрудником CRM'),
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${outbox.source_notification_event_id}
              AND status <> 'sent'
          `;
        }

        return {
          deliveriesSkipped: deliveries.length
        };
      });

      if (!result) {
        return reply.status(409).send({
          ok: false,
          message: "Это уведомление уже окончательно обработано"
        });
      }

      return {
        ok: true,
        deliveriesSkipped: result.deliveriesSkipped
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/retry-dead", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const ids = await client<{ id: string }[]>`
        SELECT id
        FROM notification_outbox
        WHERE shop_id = ${shop.id}
          AND status IN ('dead', 'partial')
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at ASC
        LIMIT 100
      `;

      let retried = 0;
      let deliveriesReset = 0;

      for (const row of ids) {
        const result = await client.begin(async (transaction) => {
          return resetOutboxForRetry(transaction, {
            shopId: shop.id,
            outboxId: row.id
          });
        });

        if (result) {
          retried += 1;
          deliveriesReset += result.deliveriesReset;
        }
      }

      return {
        ok: true,
        retried,
        deliveriesReset
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/release-stale", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const result = await client.begin(async (transaction) => {
        const outboxes = await transaction<{ id: string }[]>`
          UPDATE notification_outbox
          SET
            status = 'pending',
            locked_at = NULL,
            locked_by = NULL,
            next_attempt_at = NOW(),
            last_error = COALESCE(last_error, 'Зависшая задача возвращена в очередь из CRM'),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND status = 'processing'
            AND locked_at < NOW() - INTERVAL '10 minutes'
          RETURNING id
        `;

        const deliveries = await transaction<{ id: string }[]>`
          UPDATE notification_deliveries
          SET
            status = 'pending',
            locked_at = NULL,
            locked_by = NULL,
            next_attempt_at = NOW(),
            last_error = COALESCE(last_error, 'Зависшая доставка возвращена в очередь из CRM'),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND status = 'processing'
            AND locked_at < NOW() - INTERVAL '10 minutes'
          RETURNING id
        `;

        return {
          outboxes: outboxes.length,
          deliveries: deliveries.length
        };
      });

      return {
        ok: true,
        releasedOutboxes: result.outboxes,
        releasedDeliveries: result.deliveries
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/deliveries/:id/retry", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const result = await client.begin(async (transaction) => {
        const rows = await transaction<{
          id: string;
          outbox_id: string;
        }[]>`
          UPDATE notification_deliveries
          SET
            status = 'pending',
            attempts = 0,
            next_attempt_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            failed_at = NULL,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
            AND status IN ('failed', 'skipped')
          RETURNING id, outbox_id
        `;

        const delivery = rows[0];

        if (!delivery) {
          return null;
        }

        await transaction`
          UPDATE notification_outbox
          SET
            status = 'pending',
            next_attempt_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            dead_at = NULL,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${delivery.outbox_id}
            AND status <> 'sent'
        `;

        return delivery;
      });

      if (!result) {
        return reply.status(409).send({
          ok: false,
          message: "Эту доставку нельзя вернуть в очередь"
        });
      }

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/deliveries/:id/deactivate", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});
    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext || !["owner", "admin"].includes(adminContext.role)) {
      return reply.status(403).send({
        ok: false,
        message: "Отключать Telegram-получателя может только владелец или администратор"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const result = await client.begin(async (transaction) => {
        const rows = await transaction<{
          id: string;
          outbox_id: string;
          channel: string;
          recipient_address: string;
        }[]>`
          SELECT
            id,
            outbox_id,
            channel,
            recipient_address
          FROM notification_deliveries
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          FOR UPDATE
        `;

        const delivery = rows[0];

        if (!delivery || delivery.channel !== "telegram") {
          return null;
        }

        const accounts = await transaction<{ id: string }[]>`
          UPDATE telegram_accounts
          SET
            notifications_enabled = false,
            is_active = false,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND telegram_id = ${delivery.recipient_address}
            AND (
              notifications_enabled = true
              OR is_active = true
            )
          RETURNING id
        `;

        await transaction`
          UPDATE notification_deliveries
          SET
            status = CASE WHEN status = 'sent' THEN status ELSE 'skipped' END,
            locked_at = NULL,
            locked_by = NULL,
            last_error = CASE
              WHEN status = 'sent' THEN last_error
              ELSE COALESCE(last_error, 'Telegram-получатель отключён в CRM')
            END,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${delivery.id}
        `;

        await transaction`
          UPDATE notification_outbox
          SET
            status = CASE WHEN status = 'sent' THEN status ELSE 'pending' END,
            next_attempt_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${delivery.outbox_id}
        `;

        return {
          accountsDisabled: accounts.length
        };
      });

      if (!result) {
        return reply.status(409).send({
          ok: false,
          message: "Telegram-получатель для этой доставки не найден"
        });
      }

      return {
        ok: true,
        accountsDisabled: result.accountsDisabled
      };
    } finally {
      await client.end();
    }
  });
}
