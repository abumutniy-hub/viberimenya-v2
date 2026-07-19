import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

export {};

const projectRoot =
  process.env.VIBERIMENYA_PROJECT_ROOT ||
  resolve(process.cwd(), "../..");

config({ path: resolve(projectRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL не найден");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
});

class VerificationRollback extends Error {}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sameValues(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

type IdRow = { id: string };
type UserMap = Record<
  "owner" | "admin" | "manager" | "florist" | "courier",
  { id: string; telegramId: string }
>;

type OutboxRow = {
  id: string;
  source_notification_event_id: string;
  type: string;
  recipient_user_id: string | null;
  recipient_customer_id: string | null;
  recipient_role: string | null;
  recipient_address: string | null;
  status: string;
  attempts: number;
  locked_by: string | null;
  last_error: string | null;
  sent_at: string | null;
  dead_at: string | null;
};

const marker = `outbox-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
const results: string[] = [];

function pass(message: string) {
  results.push(message);
  console.log(`✓ ${message}`);
}

try {
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya-notification-outbox-e2e')
        )
      `;

      const shops = await transaction<IdRow[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at
        LIMIT 1
      `;
      const shop = shops[0];

      assertCondition(shop, "Не найден активный магазин");
      pass("активный магазин найден");

      const users = {} as UserMap;
      const roles = [
        "owner",
        "admin",
        "manager",
        "florist",
        "courier",
      ] as const;

      for (const [index, role] of roles.entries()) {
        const email = `${marker}-${role}@invalid.local`;
        const telegramId = `99000${String(index + 1).padStart(3, "0")}${Date.now()}`;
        const rows = await transaction<IdRow[]>`
          INSERT INTO users (
            email,
            name,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ${email},
            ${`E2E ${role}`},
            'active',
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        const user = rows[0];

        assertCondition(user, `Не создан пользователь ${role}`);

        await transaction`
          INSERT INTO shop_users (
            shop_id,
            user_id,
            role,
            is_active,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${user.id},
            ${role},
            true,
            NOW(),
            NOW()
          )
        `;

        await transaction`
          INSERT INTO telegram_accounts (
            shop_id,
            user_id,
            telegram_id,
            username,
            first_name,
            notifications_enabled,
            is_active,
            linked_at,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${user.id},
            ${telegramId},
            ${`${marker}-${role}`},
            ${`E2E ${role}`},
            true,
            true,
            NOW(),
            NOW(),
            NOW()
          )
        `;

        users[role] = {
          id: user.id,
          telegramId,
        };
      }

      pass("созданы временные роли owner/admin/manager/florist/courier");

      const managementRecipients = await transaction<{
        telegram_id: string;
        role: string;
      }[]>`
        SELECT DISTINCT
          ta.telegram_id,
          su.role::text AS role
        FROM telegram_accounts ta
        JOIN shop_users su
          ON su.shop_id = ta.shop_id
         AND su.user_id = ta.user_id
         AND su.is_active = true
        WHERE ta.shop_id = ${shop.id}
          AND ta.username LIKE ${`${marker}-%`}
          AND ta.user_id IS NOT NULL
          AND ta.is_active = true
          AND ta.notifications_enabled = true
          AND su.role IN ('owner', 'admin', 'manager')
        ORDER BY role
      `;

      const managementRoles = managementRecipients
        .map((row) => row.role)
        .sort();

      assertCondition(
        sameValues(managementRoles, ["admin", "manager", "owner"]),
        `Общий staff-routing неверен: ${managementRoles.join(", ")}`,
      );
      pass("общие staff-уведомления ограничены owner/admin/manager");

      const customerRows = await transaction<IdRow[]>`
        INSERT INTO customers (
          shop_id,
          phone,
          name,
          email,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${`+7999${String(Date.now()).slice(-7)}`},
          'E2E customer',
          ${`${marker}-customer@invalid.local`},
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const customer = customerRows[0];

      assertCondition(customer, "Не создан тестовый клиент");

      const customerTelegramId = `99100${Date.now()}`;

      await transaction`
        INSERT INTO telegram_accounts (
          shop_id,
          customer_id,
          telegram_id,
          username,
          first_name,
          notifications_enabled,
          is_active,
          linked_at,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${customerTelegramId},
          ${`${marker}-customer`},
          'E2E customer',
          true,
          true,
          NOW(),
          NOW(),
          NOW()
        )
      `;

      const orderRows = await transaction<IdRow[]>`
        INSERT INTO orders (
          shop_id,
          customer_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          recipient_name,
          recipient_phone,
          subtotal,
          total,
          manager_id,
          florist_id,
          courier_id,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${`E2E-${String(Date.now()).slice(-10)}`},
          'new',
          'pending',
          'transfer_after_confirm',
          'delivery',
          'E2E recipient',
          '+79990000000',
          1000,
          1000,
          ${users.manager.id},
          ${users.florist.id},
          ${users.courier.id},
          ${`${marker}-tracking`},
          ${JSON.stringify({ marker, synthetic: true })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const order = orderRows[0];

      assertCondition(order, "Не создан тестовый заказ");
      pass("в транзакции создан синтетический заказ");

      const eventSpecs = [
        {
          key: "florist",
          type: "florist_order_assigned",
          recipientType: "staff",
          direct: null,
        },
        {
          key: "courier",
          type: "courier_order_assigned",
          recipientType: "staff",
          direct: null,
        },
        {
          key: "manager",
          type: "order_created",
          recipientType: "staff",
          direct: null,
        },
        {
          key: "customer",
          type: "order_paid",
          recipientType: "customer",
          direct: null,
        },
        {
          key: "direct-owner",
          type: "e2e_direct_owner",
          recipientType: "staff",
          direct: users.owner.telegramId,
        },
      ] as const;

      const eventIds = new Map<string, string>();

      for (const spec of eventSpecs) {
        const rows = await transaction<IdRow[]>`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            recipient_telegram_id,
            status,
            payload,
            attempts,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${order.id},
            ${spec.type},
            'telegram',
            ${spec.recipientType},
            ${spec.direct},
            'pending',
            ${JSON.stringify({ marker, key: spec.key })}::jsonb,
            0,
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        const event = rows[0];

        assertCondition(event, `Не создано событие ${spec.key}`);
        eventIds.set(spec.key, event.id);
      }

      const sourceEventIds = [...eventIds.values()];
      const expectedIdempotencyKeys = sourceEventIds.map(
        (eventId) => `legacy-notification-event:${eventId}`,
      );

      assertCondition(
        sourceEventIds.length === eventSpecs.length,
        "Не все source notification event ID сохранены тестом",
      );

      const outboxes = await transaction<OutboxRow[]>`
        SELECT
          outbox.id,
          outbox.source_notification_event_id,
          events.type,
          outbox.recipient_user_id,
          outbox.recipient_customer_id,
          outbox.recipient_role,
          outbox.recipient_address,
          outbox.status,
          outbox.attempts,
          outbox.locked_by,
          outbox.last_error,
          outbox.sent_at::text,
          outbox.dead_at::text
        FROM notification_outbox outbox
        JOIN notification_events events
          ON events.id = outbox.source_notification_event_id
        WHERE outbox.source_notification_event_id = ANY(
          ${sourceEventIds}::uuid[]
        )
        ORDER BY events.type
      `;

      const foundSourceIds = new Set(
        outboxes.map((row) => row.source_notification_event_id),
      );
      const missingEvents = eventSpecs
        .map((spec) => ({
          key: spec.key,
          type: spec.type,
          id: eventIds.get(spec.key),
        }))
        .filter(
          (item) =>
            !item.id ||
            !foundSourceIds.has(item.id),
        );

      assertCondition(
        outboxes.length === eventSpecs.length &&
          missingEvents.length === 0,
        [
          `Ожидалось ${eventSpecs.length} outbox, найдено ${outboxes.length}.`,
          missingEvents.length > 0
            ? `Отсутствуют: ${missingEvents
                .map(
                  (item) =>
                    `${item.key}/${item.type}/${item.id || "no-id"}`,
                )
                .join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      pass(
        "AFTER INSERT trigger создал outbox для каждого source event ID",
      );

      const byType = new Map(outboxes.map((row) => [row.type, row]));
      const floristOutbox = byType.get("florist_order_assigned");
      const courierOutbox = byType.get("courier_order_assigned");
      const managerOutbox = byType.get("order_created");
      const customerOutbox = byType.get("order_paid");
      const ownerOutbox = byType.get("e2e_direct_owner");

      assertCondition(
        floristOutbox?.recipient_user_id === users.florist.id &&
          floristOutbox.recipient_role === "florist",
        "Неверная маршрутизация флористу",
      );
      assertCondition(
        courierOutbox?.recipient_user_id === users.courier.id &&
          courierOutbox.recipient_role === "courier",
        "Неверная маршрутизация курьеру",
      );
      assertCondition(
        managerOutbox?.recipient_user_id === users.manager.id &&
          managerOutbox.recipient_role === "manager",
        "Неверная маршрутизация менеджеру",
      );
      assertCondition(
        customerOutbox?.recipient_customer_id === customer.id,
        "Неверная маршрутизация клиенту",
      );
      assertCondition(
        ownerOutbox?.recipient_user_id === users.owner.id &&
          ownerOutbox.recipient_role === "owner" &&
          ownerOutbox.recipient_address === users.owner.telegramId,
        "Неверная маршрутизация прямому owner-получателю",
      );
      pass("маршрутизация manager/florist/courier/customer/direct-owner корректна");

      const domainCounts = await transaction<{
        total: number;
        unique_keys: number;
      }[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(DISTINCT idempotency_key)::int AS unique_keys
        FROM domain_events
        WHERE idempotency_key = ANY(
          ${expectedIdempotencyKeys}::text[]
        )
      `;

      assertCondition(
        domainCounts[0]?.total === eventSpecs.length &&
          domainCounts[0]?.unique_keys === eventSpecs.length,
        "Domain events или idempotency keys созданы неверно",
      );
      pass("domain_events и idempotency keys созданы корректно");

      for (const eventId of eventIds.values()) {
        await transaction`
          SELECT enqueue_notification_event_outbox(${eventId}::uuid)
        `;
        await transaction`
          SELECT enqueue_notification_event_outbox(${eventId}::uuid)
        `;
      }

      const idempotencyCounts = await transaction<{
        outboxes: number;
        domains: number;
      }[]>`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM notification_outbox outbox
            WHERE outbox.source_notification_event_id = ANY(
              ${sourceEventIds}::uuid[]
            )
          ) AS outboxes,
          (
            SELECT COUNT(*)::int
            FROM domain_events
            WHERE idempotency_key = ANY(
          ${expectedIdempotencyKeys}::text[]
        )
          ) AS domains
      `;

      assertCondition(
        idempotencyCounts[0]?.outboxes === eventSpecs.length &&
          idempotencyCounts[0]?.domains === eventSpecs.length,
        "Повторный enqueue создал дубликаты",
      );
      pass("повторный enqueue идемпотентен");

      const managerEventId = eventIds.get("manager");
      assertCondition(managerEventId, "Не найден manager event id");

      await transaction`
        UPDATE notification_events
        SET status = 'processing',
            attempts = 2,
            error = 'e2e-processing',
            updated_at = NOW()
        WHERE id = ${managerEventId}
      `;

      const processingRows = await transaction<OutboxRow[]>`
        SELECT
          id,
          template_key AS type,
          recipient_user_id,
          recipient_customer_id,
          recipient_role,
          recipient_address,
          status,
          attempts,
          locked_by,
          last_error,
          sent_at::text,
          dead_at::text
        FROM notification_outbox
        WHERE source_notification_event_id = ${managerEventId}
      `;
      const processing = processingRows[0];

      assertCondition(
        processing?.status === "processing" &&
          processing.attempts === 2 &&
          processing.locked_by === "legacy-notification-worker" &&
          processing.last_error === "e2e-processing",
        "Legacy → outbox processing sync не прошёл",
      );

      await transaction`
        UPDATE notification_events
        SET status = 'sent',
            error = NULL,
            sent_at = NOW(),
            updated_at = NOW()
        WHERE id = ${managerEventId}
      `;

      const sentRows = await transaction<{
        status: string;
        sent_at: string | null;
        locked_by: string | null;
      }[]>`
        SELECT status, sent_at::text, locked_by
        FROM notification_outbox
        WHERE source_notification_event_id = ${managerEventId}
      `;
      const sent = sentRows[0];

      assertCondition(
        sent?.status === "sent" &&
          Boolean(sent.sent_at) &&
          sent.locked_by === null,
        "Legacy → outbox sent sync не прошёл",
      );
      pass("legacy status sync processing → sent работает");

      assertCondition(floristOutbox, "Не найден florist outbox");

      await transaction`
        INSERT INTO notification_deliveries (
          shop_id,
          outbox_id,
          channel,
          recipient_type,
          recipient_user_id,
          recipient_role,
          recipient_address,
          status,
          attempts,
          max_attempts,
          next_attempt_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${floristOutbox.id},
          'telegram',
          'staff',
          ${users.florist.id},
          'florist',
          ${users.florist.telegramId},
          'pending',
          0,
          5,
          NOW(),
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (outbox_id, channel, recipient_address)
        DO NOTHING
      `;

      await transaction`
        INSERT INTO notification_deliveries (
          shop_id,
          outbox_id,
          channel,
          recipient_type,
          recipient_user_id,
          recipient_role,
          recipient_address,
          status,
          attempts,
          max_attempts,
          next_attempt_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${floristOutbox.id},
          'telegram',
          'staff',
          ${users.florist.id},
          'florist',
          ${users.florist.telegramId},
          'pending',
          0,
          5,
          NOW(),
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (outbox_id, channel, recipient_address)
        DO NOTHING
      `;

      const deliveryRows = await transaction<{
        id: string;
        count: number;
      }[]>`
        SELECT MIN(id::text) AS id, COUNT(*)::int AS count
        FROM notification_deliveries
        WHERE outbox_id = ${floristOutbox.id}
          AND recipient_address = ${users.florist.telegramId}
      `;
      const delivery = deliveryRows[0];

      assertCondition(
        delivery?.id && delivery.count === 1,
        "Delivery idempotency нарушена",
      );
      pass("персональная доставка создаётся идемпотентно");

      await transaction`
        UPDATE notification_deliveries
        SET status = 'processing',
            attempts = attempts + 1,
            locked_at = NOW() - INTERVAL '20 minutes',
            locked_by = 'e2e-stale-worker',
            updated_at = NOW()
        WHERE id = ${delivery.id}::uuid
      `;

      await transaction`
        UPDATE notification_outbox
        SET status = 'processing',
            attempts = 1,
            locked_at = NOW() - INTERVAL '20 minutes',
            locked_by = 'e2e-stale-worker',
            updated_at = NOW()
        WHERE id = ${floristOutbox.id}
      `;

      await transaction`
        UPDATE notification_deliveries
        SET status = 'pending',
            locked_at = NULL,
            locked_by = NULL,
            last_error = COALESCE(
              last_error,
              'Восстановлено после зависшего Telegram worker'
            ),
            next_attempt_at = NOW(),
            updated_at = NOW()
        WHERE id = ${delivery.id}::uuid
          AND channel = 'telegram'
          AND status = 'processing'
          AND locked_at < NOW() - INTERVAL '10 minutes'
      `;

      await transaction`
        UPDATE notification_outbox
        SET status = 'pending',
            locked_at = NULL,
            locked_by = NULL,
            last_error = COALESCE(
              last_error,
              'Восстановлено после зависшего Telegram worker'
            ),
            next_attempt_at = NOW(),
            updated_at = NOW()
        WHERE id = ${floristOutbox.id}
          AND channel = 'telegram'
          AND status = 'processing'
          AND locked_at < NOW() - INTERVAL '10 minutes'
      `;

      const recoveredRows = await transaction<{
        outbox_status: string;
        delivery_status: string;
        outbox_lock: string | null;
        delivery_lock: string | null;
      }[]>`
        SELECT
          outbox.status AS outbox_status,
          delivery.status AS delivery_status,
          outbox.locked_by AS outbox_lock,
          delivery.locked_by AS delivery_lock
        FROM notification_outbox outbox
        JOIN notification_deliveries delivery
          ON delivery.outbox_id = outbox.id
        WHERE outbox.id = ${floristOutbox.id}
          AND delivery.id = ${delivery.id}::uuid
      `;
      const recovered = recoveredRows[0];

      assertCondition(
        recovered?.outbox_status === "pending" &&
          recovered.delivery_status === "pending" &&
          recovered.outbox_lock === null &&
          recovered.delivery_lock === null,
        "Восстановление stale processing не прошло",
      );
      pass("stale outbox и delivery восстанавливаются в pending");

      await transaction`
        UPDATE notification_deliveries
        SET status = 'failed',
            attempts = max_attempts,
            locked_at = NULL,
            locked_by = NULL,
            last_error = 'e2e-permanent-failure',
            failed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${delivery.id}::uuid
      `;

      await transaction`
        UPDATE notification_outbox
        SET status = 'dead',
            attempts = max_attempts,
            locked_at = NULL,
            locked_by = NULL,
            last_error = 'e2e-permanent-failure',
            dead_at = NOW(),
            updated_at = NOW()
        WHERE id = ${floristOutbox.id}
      `;

      const deadRows = await transaction<{
        outbox_status: string;
        delivery_status: string;
        dead_at: string | null;
        failed_at: string | null;
      }[]>`
        SELECT
          outbox.status AS outbox_status,
          delivery.status AS delivery_status,
          outbox.dead_at::text,
          delivery.failed_at::text
        FROM notification_outbox outbox
        JOIN notification_deliveries delivery
          ON delivery.outbox_id = outbox.id
        WHERE outbox.id = ${floristOutbox.id}
          AND delivery.id = ${delivery.id}::uuid
      `;
      const dead = deadRows[0];

      assertCondition(
        dead?.outbox_status === "dead" &&
          dead.delivery_status === "failed" &&
          Boolean(dead.dead_at) &&
          Boolean(dead.failed_at),
        "Dead-letter переход не прошёл",
      );
      pass("dead-letter состояние outbox/delivery фиксируется корректно");

      await transaction`
        UPDATE notification_deliveries
        SET status = 'pending',
            attempts = 0,
            next_attempt_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            failed_at = NULL,
            updated_at = NOW()
        WHERE id = ${delivery.id}::uuid
          AND status IN ('failed', 'skipped')
      `;

      await transaction`
        UPDATE notification_outbox
        SET status = 'pending',
            attempts = 0,
            next_attempt_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            dead_at = NULL,
            updated_at = NOW()
        WHERE id = ${floristOutbox.id}
          AND status IN ('dead', 'partial', 'skipped')
      `;

      const retryRows = await transaction<{
        outbox_status: string;
        delivery_status: string;
        outbox_attempts: number;
        delivery_attempts: number;
        dead_at: string | null;
        failed_at: string | null;
      }[]>`
        SELECT
          outbox.status AS outbox_status,
          delivery.status AS delivery_status,
          outbox.attempts AS outbox_attempts,
          delivery.attempts AS delivery_attempts,
          outbox.dead_at::text,
          delivery.failed_at::text
        FROM notification_outbox outbox
        JOIN notification_deliveries delivery
          ON delivery.outbox_id = outbox.id
        WHERE outbox.id = ${floristOutbox.id}
          AND delivery.id = ${delivery.id}::uuid
      `;
      const retry = retryRows[0];

      assertCondition(
        retry?.outbox_status === "pending" &&
          retry.delivery_status === "pending" &&
          retry.outbox_attempts === 0 &&
          retry.delivery_attempts === 0 &&
          retry.dead_at === null &&
          retry.failed_at === null,
        "CRM retry transition не прошёл",
      );
      pass("dead-letter можно безопасно вернуть в pending");

      const constraintRows = await transaction<{
        invalid_outbox_status_rejected: boolean;
        invalid_delivery_status_rejected: boolean;
      }[]>`
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'notification_outbox_status_check'
          ) AS invalid_outbox_status_rejected,
          EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'notification_deliveries_status_check'
          ) AS invalid_delivery_status_rejected
      `;
      const constraints = constraintRows[0];

      assertCondition(
        constraints?.invalid_outbox_status_rejected &&
          constraints.invalid_delivery_status_rejected,
        "Status CHECK constraints не найдены",
      );
      pass("CHECK constraints статусов присутствуют");

      throw new VerificationRollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) {
      throw error;
    }
  }

  const residue = await sql<{
    users: number;
    customers: number;
    orders: number;
    events: number;
    outboxes: number;
    deliveries: number;
  }[]>`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE email LIKE ${`${marker}-%`}
      ) AS users,
      (
        SELECT COUNT(*)::int
        FROM customers
        WHERE email = ${`${marker}-customer@invalid.local`}
      ) AS customers,
      (
        SELECT COUNT(*)::int
        FROM orders
        WHERE tracking_token = ${`${marker}-tracking`}
      ) AS orders,
      (
        SELECT COUNT(*)::int
        FROM notification_events
        WHERE payload::text LIKE ${`%${marker}%`}
      ) AS events,
      (
        SELECT COUNT(*)::int
        FROM notification_outbox outbox
        JOIN notification_events events
          ON events.id = outbox.source_notification_event_id
        WHERE events.payload::text LIKE ${`%${marker}%`}
      ) AS outboxes,
      (
        SELECT COUNT(*)::int
        FROM notification_deliveries
        WHERE metadata ->> 'marker' = ${marker}
      ) AS deliveries
  `;
  const remaining = residue[0];

  assertCondition(remaining, "Не получена проверка остаточных данных");

  const totalResidue = Object.values(remaining).reduce(
    (sum, value) => sum + Number(value),
    0,
  );

  assertCondition(
    totalResidue === 0,
    `После rollback остались тестовые записи: ${JSON.stringify(remaining)}`,
  );
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("");
  console.log("NOTIFICATION OUTBOX E2E: OK");
  console.log(`Проверок пройдено: ${results.length}`);
  console.log("Реальные Telegram-сообщения не отправлялись.");
} finally {
  await sql.end({ timeout: 5 });
}
