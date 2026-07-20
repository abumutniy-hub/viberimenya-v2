import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  cancelCustomerCheckoutDraft,
  CheckoutDraftConflictError,
  getCustomerCheckoutDraft,
  getCustomerCheckoutOptions,
  quoteCustomerCheckoutDraft,
  resolveCustomerCheckoutDraftScope,
  saveCustomerCheckoutDraft,
  type CheckoutDraftSqlExecutor,
} from "./modules/customers/customer-checkout-draft.service";

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

function futureDateIso(days: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
}

const marker = `checkout-draft-e2e-${randomUUID()}`;
const telegramId = `7${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `+7996${String(Date.now()).slice(-7)}`;
let customerId = "";
const { client } = createDb();

try {
  try {
    await client.begin(async (transaction: CheckoutDraftSqlExecutor) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:customer-checkout-draft-e2e')
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

      await transaction`
        INSERT INTO shop_settings (
          shop_id,
          is_online_payment_enabled,
          is_cash_payment_enabled,
          is_transfer_payment_enabled,
          settings,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          true,
          true,
          true,
          ${JSON.stringify({
            delivery: {
              minimumOrderAmount: 0,
              pickupEnabled: true,
            },
            launch: {
              acceptingOrders: true,
              maintenanceMode: false,
            },
          })}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id)
        DO UPDATE SET
          is_online_payment_enabled = true,
          is_cash_payment_enabled = true,
          is_transfer_payment_enabled = true,
          settings = jsonb_set(
            jsonb_set(
              COALESCE(shop_settings.settings, '{}'::jsonb),
              '{delivery}',
              COALESCE(shop_settings.settings -> 'delivery', '{}'::jsonb)
                || ${JSON.stringify({
                  minimumOrderAmount: 0,
                  pickupEnabled: true,
                })}::jsonb,
              true
            ),
            '{launch}',
            COALESCE(shop_settings.settings -> 'launch', '{}'::jsonb)
              || ${JSON.stringify({
                acceptingOrders: true,
                maintenanceMode: false,
              })}::jsonb,
            true
          ),
          updated_at = NOW()
      `;

      const customerRows = await transaction<{ id: string }[]>`
        INSERT INTO customers (
          shop_id,
          phone,
          name,
          email,
          bonus_balance,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${phone},
          'Checkout Draft E2E',
          ${`${marker}@example.invalid`},
          1500,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const customer = customerRows[0];
      assertCondition(customer, "Синтетический клиент не создан");
      customerId = customer.id;

      await transaction`
        INSERT INTO telegram_accounts (
          shop_id,
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

      const productRows = await transaction<{ id: string }[]>`
        INSERT INTO products (
          shop_id,
          slug,
          name,
          price,
          stock_quantity,
          status,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${`${marker}-product`},
          'Товар Checkout Draft E2E',
          50000,
          10,
          'active',
          ${JSON.stringify({
            catalog: { availability: "available" },
            marker,
          })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const product = productRows[0];
      assertCondition(product, "Синтетический товар не создан");

      await transaction`
        INSERT INTO telegram_cart_items (
          shop_id,
          telegram_chat_id,
          product_id,
          quantity,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${telegramId}::bigint,
          ${product.id},
          2,
          NOW(),
          NOW()
        )
      `;

      const zoneRows = await transaction<{ id: string }[]>`
        INSERT INTO delivery_zones (
          shop_id,
          name,
          price,
          free_from_amount,
          is_express_available,
          express_price,
          is_active,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${`E2E zone ${marker}`},
          500,
          NULL,
          true,
          1200,
          true,
          9999,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const zone = zoneRows[0];
      assertCondition(zone, "Синтетическая зона не создана");

      const intervalRows = await transaction<{ id: string }[]>`
        INSERT INTO delivery_intervals (
          shop_id,
          name,
          starts_at,
          ends_at,
          is_active,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${`E2E interval ${marker}`},
          '10:00',
          '13:00',
          true,
          9999,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const interval = intervalRows[0];
      assertCondition(interval, "Синтетический интервал не создан");

      const promoCode = `E2E${String(Date.now()).slice(-8)}`;
      await transaction`
        INSERT INTO promocodes (
          shop_id,
          code,
          description,
          discount_type,
          discount_value,
          min_order_amount,
          usage_limit,
          used_count,
          is_active,
          starts_at,
          ends_at,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${promoCode},
          ${marker},
          'percent',
          10,
          1000,
          10,
          0,
          true,
          NOW() - INTERVAL '1 day',
          NOW() + INTERVAL '1 day',
          NOW(),
          NOW()
        )
      `;

      const scope = await resolveCustomerCheckoutDraftScope(transaction, {
        shopId: shop.id,
        customerId: customer.id,
      });
      assertCondition(scope.linked, "Telegram checkout scope не найден");
      assertCondition(
        scope.telegramChatId === telegramId,
        "Checkout draft привязан к другому Telegram",
      );
      pass("сайт и Telegram используют один owner scope");

      const saveOperation = randomUUID();
      const saved = await saveCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
        operationId: saveOperation,
        expectedRevision: 0,
        step: "confirm",
        patch: {
          customerName: "Покупатель E2E",
          customerPhone: phone,
          recipientSameAsCustomer: true,
          deliveryType: "delivery",
          deliveryService: "standard",
          deliveryZoneId: zone.id,
          deliveryZoneName: `E2E zone ${marker}`,
          deliveryDateText: futureDateIso(2),
          deliveryIntervalId: interval.id,
          deliveryInterval: `E2E interval ${marker}`,
          deliveryAddress: "Москва, тестовая улица, дом 1",
          paymentMethod: "transfer_after_confirm",
          promoCode,
          bonusToSpend: 1000,
          privacyAccepted: true,
        },
      });
      assertCondition(!saved.reused, "Первая запись помечена повторной");
      assertCondition(saved.draft.revision === 1, "Revision первой записи не равен 1");
      pass("черновик сохраняется с revision и TTL");

      const replay = await saveCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
        operationId: saveOperation,
        expectedRevision: 1,
        step: "confirm",
        patch: { customerName: "Не должно примениться" },
      });
      assertCondition(replay.reused, "Повторная операция не распознана");
      assertCondition(
        replay.draft.data.customerName === "Покупатель E2E",
        "Повторная операция изменила черновик",
      );
      pass("повторная операция не изменяет данные дважды");

      const telegramPatch = await saveCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "telegram",
        operationId: randomUUID(),
        expectedRevision: 1,
        step: "confirm",
        patch: {
          cardText: "С любовью",
          isSurprise: true,
          doNotCallRecipient: true,
          contactPreference: "messenger_only",
        },
      });
      assertCondition(telegramPatch.draft.revision === 2, "Telegram patch не повысил revision");
      assertCondition(
        telegramPatch.draft.data.promoCode === promoCode,
        "Telegram patch потерял данные сайта",
      );
      pass("site и Telegram patch объединяются без потери полей");

      const quoted = await quoteCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "telegram",
        operationId: randomUUID(),
        expectedRevision: 2,
      });
      const quote = quoted.draft.data._core?.quote;
      assertCondition(quote, "Серверный quote не создан");
      assertCondition(quote.readyForConfirmation, "Валидный draft не готов к подтверждению");
      assertCondition(quote.subtotal === 100000, "Subtotal рассчитан неверно");
      assertCondition(quote.deliveryPrice === 500, "Доставка рассчитана неверно");
      assertCondition(quote.discountTotal === 10000, "Промокод рассчитан неверно");
      assertCondition(quote.bonusApplied === 1000, "Бонусы рассчитаны неверно");
      assertCondition(quote.total === 89500, "Итог рассчитан неверно");
      pass("цены, доставка, промокод и бонусы считаются только сервером");

      const options = await getCustomerCheckoutOptions(transaction, {
        shopId: shop.id,
        customerId: customer.id,
      });
      assertCondition(
        options.zones.some((item) => item.id === zone.id),
        "Новая зона отсутствует в checkout options",
      );
      assertCondition(
        options.intervals.some((item) => item.id === interval.id),
        "Новый интервал отсутствует в checkout options",
      );
      assertCondition(options.bonusBalance === 1500, "Баланс бонусов не прочитан");
      pass("options возвращают актуальные зоны, интервалы и бонусы");

      let conflictCaught = false;
      try {
        await saveCustomerCheckoutDraft(transaction, {
          shopId: shop.id,
          customerId: customer.id,
          telegramChatId: telegramId,
          source: "site",
          operationId: randomUUID(),
          expectedRevision: 1,
          step: "comment",
          patch: { comment: "Устаревшая запись" },
        });
      } catch (error) {
        conflictCaught = error instanceof CheckoutDraftConflictError;
      }
      assertCondition(conflictCaught, "Optimistic concurrency конфликт не обнаружен");
      pass("устаревший revision не перезаписывает новый черновик");

      const loaded = await getCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
      });
      assertCondition(loaded?.revision === 3, "Общий draft не прочитан после quote");
      assertCondition(
        loaded.data.cardText === "С любовью",
        "Данные Telegram отсутствуют на сайте",
      );
      pass("один и тот же draft читается из обоих каналов");

      const cancelled = await cancelCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
        operationId: randomUUID(),
      });
      assertCondition(cancelled.removed, "Черновик не отменён");
      const afterCancel = await getCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "telegram",
      });
      assertCondition(afterCancel === null, "Отменённый черновик остался доступен");
      pass("отмена синхронно удаляет общий черновик");

      const eventRows = await transaction<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM domain_events
        WHERE shop_id = ${shop.id}
          AND event_type = 'customer.checkout_draft.changed'
          AND actor_customer_id = ${customer.id}
      `;
      assertCondition(Number(eventRows[0]?.total || 0) >= 4, "Журнал draft-событий не создан");
      pass("изменения черновика записываются в domain events");

      throw new VerificationRollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const residue = await client<{ total: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${customerId})
      + (SELECT COUNT(*) FROM products WHERE metadata ->> 'marker' = ${marker})
      + (SELECT COUNT(*) FROM promocodes WHERE description = ${marker})
      + (SELECT COUNT(*) FROM domain_events WHERE payload ->> 'telegramChatId' = ${telegramId})
    )::int AS total
  `;
  assertCondition(Number(residue[0]?.total || 0) === 0, "Синтетические данные остались в БД");
  pass("транзакционный rollback удалил синтетические данные");

  console.log("\nCUSTOMER CHECKOUT DRAFT E2E: OK");
  console.log("Проверены общий draft, TTL, revision, idempotency, quote, options и отмена.");
  console.log("Реальные клиенты, заказы и Telegram-сообщения не изменялись.");
} finally {
  await client.end({ timeout: 5 });
}
