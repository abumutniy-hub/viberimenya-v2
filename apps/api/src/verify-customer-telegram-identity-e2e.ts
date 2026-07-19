import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import { unlinkCustomerTelegramIdentity } from "./modules/customers/customer-telegram-identity.service";

class VerificationRollback extends Error {}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const marker = `identity-e2e-${randomUUID()}`;
const telegramId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `+7999${String(Date.now()).slice(-7)}`;
const token = randomUUID().replace(/-/g, "");
let syntheticCustomerId = "";

const { client } = createDb();

try {
  try {
    await client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:customer-telegram-identity-e2e')
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
      pass("активный магазин найден");

      const staffRows = await transaction<{ user_id: string }[]>`
        SELECT user_id
        FROM shop_users
        WHERE shop_id = ${shop.id}
          AND is_active = true
        ORDER BY
          CASE role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            ELSE 3
          END,
          created_at ASC
        LIMIT 1
      `;
      const staff = staffRows[0];
      assertCondition(staff, "Активный сотрудник не найден");
      pass("найден сотрудник для проверки двойной привязки");

      const customerRows = await transaction<{ id: string }[]>`
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
          ${phone},
          'Identity E2E Customer',
          ${`${marker}@example.invalid`},
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const customer = customerRows[0];
      assertCondition(customer, "Синтетический клиент не создан");
      syntheticCustomerId = customer.id;

      await transaction`
        INSERT INTO telegram_accounts (
          shop_id,
          user_id,
          customer_id,
          telegram_id,
          username,
          notifications_enabled,
          is_active,
          linked_at,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${staff.user_id},
          ${customer.id},
          ${telegramId},
          ${marker},
          true,
          true,
          NOW(),
          NOW(),
          NOW()
        )
      `;

      await transaction`
        INSERT INTO customer_channel_links (
          shop_id,
          customer_id,
          provider,
          provider_user_id,
          provider_username,
          provider_display_name,
          is_active,
          linked_at,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          'telegram',
          ${telegramId},
          ${marker},
          'Identity E2E',
          true,
          NOW(),
          NOW(),
          NOW()
        )
      `;

      await transaction`
        INSERT INTO customer_link_tokens (
          shop_id,
          customer_id,
          provider,
          purpose,
          token,
          status,
          expires_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          'telegram',
          'connect_channel',
          ${token},
          'pending',
          NOW() + INTERVAL '30 minutes',
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
      `;

      const eventRows = await transaction<{ id: string }[]>`
        INSERT INTO notification_events (
          shop_id,
          type,
          channel,
          recipient_type,
          recipient_telegram_id,
          status,
          payload,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          'identity_unlink_test',
          'telegram',
          'customer',
          ${telegramId},
          'pending',
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const event = eventRows[0];
      assertCondition(event, "Синтетическое notification event не создано");

      const outboxRows = await transaction<{
        id: string;
        recipient_customer_id: string | null;
      }[]>`
        SELECT id, recipient_customer_id
        FROM notification_outbox
        WHERE source_notification_event_id = ${event.id}
        LIMIT 1
      `;
      const outbox = outboxRows[0];
      assertCondition(outbox, "Триггер не создал notification outbox");
      assertCondition(
        outbox.recipient_customer_id === customer.id,
        "Outbox не связан с синтетическим клиентом",
      );

      await transaction`
        INSERT INTO notification_deliveries (
          shop_id,
          outbox_id,
          channel,
          recipient_type,
          recipient_user_id,
          recipient_customer_id,
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
          ${outbox.id},
          'telegram',
          'customer',
          NULL,
          ${customer.id},
          NULL,
          ${telegramId},
          'pending',
          0,
          5,
          NOW(),
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
      `;
      pass("созданы синтетические identity, token, outbox и delivery");

      const result = await unlinkCustomerTelegramIdentity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        source: "customer_account",
        actorRole: "customer",
        ip: "127.0.0.1",
        userAgent: "identity-e2e",
      });

      assertCondition(result.unlinked, "Identity service не выполнил отвязку");
      assertCondition(
        result.disconnectedAccounts === 1,
        `Ожидалась 1 отвязка, найдено ${result.disconnectedAccounts}`,
      );
      assertCondition(
        result.staffLinksPreserved === 1,
        "Рабочая привязка сотрудника не была сохранена",
      );
      assertCondition(result.cancelledTokens === 1, "Pending token не отменён");
      assertCondition(result.skippedOutbox === 1, "Pending outbox не пропущен");
      assertCondition(result.skippedDeliveries === 1, "Pending delivery не пропущена");

      const accountRows = await transaction<{
        user_id: string | null;
        customer_id: string | null;
        is_active: boolean;
        notifications_enabled: boolean;
      }[]>`
        SELECT user_id, customer_id, is_active, notifications_enabled
        FROM telegram_accounts
        WHERE shop_id = ${shop.id}
          AND telegram_id = ${telegramId}
        LIMIT 1
      `;
      const account = accountRows[0];
      assertCondition(account, "Telegram account исчез после отвязки");
      assertCondition(account.user_id === staff.user_id, "user_id сотрудника потерян");
      assertCondition(account.customer_id === null, "customer_id не очищен");
      assertCondition(account.is_active, "Рабочая Telegram-привязка деактивирована");
      assertCondition(
        account.notifications_enabled,
        "Рабочие уведомления сотрудника были выключены",
      );
      pass("customer link очищен, staff link и уведомления сохранены");

      const stateRows = await transaction<{
        channel_active: boolean;
        token_status: string;
        outbox_status: string;
        delivery_status: string;
        audit_count: number;
      }[]>`
        SELECT
          COALESCE((
            SELECT is_active
            FROM customer_channel_links
            WHERE shop_id = ${shop.id}
              AND customer_id = ${customer.id}
              AND provider = 'telegram'
              AND provider_user_id = ${telegramId}
            LIMIT 1
          ), true) AS channel_active,
          COALESCE((
            SELECT status
            FROM customer_link_tokens
            WHERE token = ${token}
            LIMIT 1
          ), '') AS token_status,
          COALESCE((
            SELECT status
            FROM notification_outbox
            WHERE id = ${outbox.id}
            LIMIT 1
          ), '') AS outbox_status,
          COALESCE((
            SELECT status
            FROM notification_deliveries
            WHERE outbox_id = ${outbox.id}
              AND recipient_address = ${telegramId}
            LIMIT 1
          ), '') AS delivery_status,
          (
            SELECT COUNT(*)::int
            FROM admin_audit_log
            WHERE shop_id = ${shop.id}
              AND event_type = 'customer.telegram_unlinked'
              AND entity_id = ${customer.id}
          ) AS audit_count
      `;
      const state = stateRows[0];
      assertCondition(state, "Состояние отвязки не прочитано");
      assertCondition(!state.channel_active, "customer_channel_link остался активным");
      assertCondition(state.token_status === "cancelled", "Token не cancelled");
      assertCondition(state.outbox_status === "skipped", "Outbox не skipped");
      assertCondition(state.delivery_status === "skipped", "Delivery не skipped");
      assertCondition(state.audit_count === 1, "Audit event не создан");
      pass("channel, token, queue и audit обновлены атомарно");

      throw new VerificationRollback("rollback synthetic identity data");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) {
      throw error;
    }
  }

  const residueRows = await client<{ total: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${syntheticCustomerId || null})
      + (SELECT COUNT(*) FROM telegram_accounts WHERE telegram_id = ${telegramId})
      + (SELECT COUNT(*) FROM customer_channel_links WHERE provider_user_id = ${telegramId})
      + (SELECT COUNT(*) FROM customer_link_tokens WHERE token = ${token})
      + (SELECT COUNT(*) FROM notification_events WHERE payload::text LIKE ${`%${marker}%`})
      + (SELECT COUNT(*) FROM admin_audit_log WHERE entity_id = ${syntheticCustomerId || null})
    )::int AS total
  `;

  assertCondition(
    Number(residueRows[0]?.total ?? -1) === 0,
    "После rollback остались синтетические identity-данные",
  );
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("");
  console.log("CUSTOMER TELEGRAM IDENTITY E2E: OK");
  console.log("Заказы, бонусы и реальные Telegram-аккаунты не изменялись.");
  console.log("Реальные Telegram-сообщения не отправлялись.");
} finally {
  await client.end();
}
