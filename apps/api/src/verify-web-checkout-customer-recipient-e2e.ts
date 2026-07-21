import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  CheckoutDraftConflictError,
  getCustomerCheckoutDraft,
  resolveCustomerCheckoutDraftScope,
  saveCustomerCheckoutDraft,
  validateCustomerCheckoutDraftContacts,
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

const marker = `web-checkout-contacts-${randomUUID()}`;
const telegramId = `79${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 10)}`;
const phone = `+7995${String(Date.now()).slice(-7)}`;
const { client } = createDb();

try {
  try {
    await client.begin(async (transaction: CheckoutDraftSqlExecutor) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:web-checkout-customer-recipient-e2e')
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
          'Покупатель Web Checkout',
          ${`${marker}@example.invalid`},
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const customer = customerRows[0];
      assertCondition(customer, "Синтетический клиент не создан");

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

      const scope = await resolveCustomerCheckoutDraftScope(transaction, {
        shopId: shop.id,
        customerId: customer.id,
      });
      assertCondition(scope.linked, "Telegram scope не найден");
      assertCondition(
        scope.telegramChatId === telegramId,
        "Site и Telegram получили разные owner scope",
      );
      pass("сайт и Telegram используют один owner scope");

      const invalid = validateCustomerCheckoutDraftContacts({
        customerName: "A",
        customerPhone: "123",
        customerEmail: "wrong-email",
        recipientSameAsCustomer: false,
        recipientName: "",
        recipientPhone: "",
      });
      assertCondition(!invalid.valid, "Некорректные контакты приняты");
      assertCondition(
        new Set(invalid.issues.map((issue) => issue.field)).size === 5,
        "Не все ошибки контактов обнаружены",
      );
      pass("сервер отклоняет неполные имя, телефон, email и получателя");

      const validSelf = validateCustomerCheckoutDraftContacts({
        customerName: "Покупатель Web Checkout",
        customerPhone: "8 995 000-00-00",
        customerEmail: `${marker}@example.invalid`,
        recipientSameAsCustomer: true,
        recipientName: "",
        recipientPhone: "",
      });
      assertCondition(validSelf.valid, "Получатель-покупатель не прошёл проверку");
      assertCondition(
        validSelf.customerPhone === "+79950000000",
        "Телефон покупателя не нормализован",
      );
      assertCondition(
        validSelf.recipientPhone === validSelf.customerPhone,
        "Получатель-покупатель получил другой телефон",
      );
      pass("режим «Получатель — я» нормализуется на сервере");

      const first = await saveCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
        operationId: `${marker}:site:create`,
        expectedRevision: 0,
        step: "delivery_type",
        patch: {
          customerName: "Покупатель Web Checkout",
          customerPhone: phone,
          customerEmail: `${marker}@example.invalid`,
          contactPreference: "messenger_only",
          recipientSameAsCustomer: true,
          recipientName: "Покупатель Web Checkout",
          recipientPhone: phone,
          isSurprise: false,
          doNotCallRecipient: false,
        },
      });
      assertCondition(first.draft.revision === 1, "Первая revision должна быть 1");
      assertCondition(
        first.draft.step === "delivery_type",
        "Web Checkout не передал управление шагу доставки",
      );
      pass("сайт сохранил покупателя и получателя с переходом к доставке");

      const telegramRead = await getCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "telegram",
      });
      assertCondition(telegramRead, "Telegram не прочитал site draft");
      assertCondition(
        telegramRead.data.customerName === "Покупатель Web Checkout",
        "Имя покупателя потеряно между каналами",
      );
      assertCondition(
        telegramRead.data.contactPreference === "messenger_only",
        "Предпочтение связи потеряно между каналами",
      );
      pass("Telegram читает тот же черновик без преобразования контактов");

      const second = await saveCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "telegram",
        operationId: `${marker}:telegram:recipient`,
        expectedRevision: telegramRead.revision,
        step: "delivery_type",
        patch: {
          recipientSameAsCustomer: false,
          recipientName: "Другой получатель",
          recipientPhone: "+79991112233",
          isSurprise: true,
          doNotCallRecipient: true,
        },
      });
      assertCondition(second.draft.revision === 2, "Вторая revision должна быть 2");

      const siteRead = await getCustomerCheckoutDraft(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
      });
      assertCondition(siteRead, "Сайт не прочитал Telegram draft");
      assertCondition(
        siteRead.data.recipientName === "Другой получатель"
          && siteRead.data.recipientPhone === "+79991112233",
        "Изменения получателя из Telegram не вернулись на сайт",
      );
      assertCondition(
        siteRead.data.isSurprise === true
          && siteRead.data.doNotCallRecipient === true,
        "Параметры вручения потеряны",
      );
      pass("изменения получателя синхронизируются Telegram → сайт");

      const eventRows = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM domain_events
        WHERE shop_id = ${shop.id}
          AND aggregate_type = 'checkout_draft'
          AND actor_customer_id = ${customer.id}
          AND idempotency_key LIKE ${`checkout-draft:${telegramId}:%`}
      `;
      assertCondition(
        Number(eventRows[0]?.count || 0) === 2,
        "Ожидались два подтверждённых события изменения",
      );
      pass("идемпотентные события записаны для двух успешных изменений");

      let conflictCaught = false;

      try {
        await saveCustomerCheckoutDraft(transaction, {
          shopId: shop.id,
          customerId: customer.id,
          telegramChatId: telegramId,
          source: "site",
          operationId: `${marker}:site:stale`,
          expectedRevision: 1,
          step: "delivery_type",
          patch: { recipientName: "Устаревшая запись" },
        });
      } catch (error) {
        conflictCaught = error instanceof CheckoutDraftConflictError
          && error.currentRevision === 2;
      }

      assertCondition(conflictCaught, "Устаревшая revision не заблокирована");
      pass("устаревшая вкладка не перезаписывает более новый Telegram draft");

      throw new VerificationRollback();
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const leakedRows = await client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM customers
    WHERE email = ${`${marker}@example.invalid`}
  `;
  assertCondition(
    Number(leakedRows[0]?.count || 0) === 0,
    "Синтетический клиент остался после rollback",
  );
  pass("транзакционный rollback удалил синтетические данные");

  console.log("\nWEB CHECKOUT CUSTOMER RECIPIENT E2E: OK");
  console.log(
    "Проверены контакты, общий draft, revision conflict и синхронизация site ↔ Telegram.",
  );
  console.log(
    "Реальные клиенты, заказы, платежи и Telegram-сообщения не изменялись.",
  );
} finally {
  await client.end();
}
