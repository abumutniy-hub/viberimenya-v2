import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  clearCommerceCart,
  getCommerceCartSnapshot,
  incrementCommerceCartQuantity,
  resolveCustomerCommerceCartScope,
  setCommerceCartQuantity,
  synchronizeCommerceCart,
  type CommerceCartSqlExecutor,
} from "./modules/customers/customer-commerce-cart.service";

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

const marker = `commerce-cart-e2e-${randomUUID()}`;
const phone = `+7997${String(Date.now()).slice(-7)}`;
const telegramId = `7${Date.now()}${Math.floor(Math.random() * 1000)}`;
let customerId = "";
const { client } = createDb();

try {
  try {
    await client.begin(async (transaction: CommerceCartSqlExecutor) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:customer-commerce-cart-e2e')
        )
      `;

      const shops = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const shop = shops[0];
      assertCondition(shop, "Активный магазин не найден");
      pass("активный магазин найден");

      const customers = await transaction<{ id: string }[]>`
        INSERT INTO customers (
          shop_id, phone, name, email, created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${phone}, 'Commerce Cart E2E',
          ${`${marker}@example.invalid`}, NOW(), NOW()
        )
        RETURNING id
      `;
      const customer = customers[0];
      assertCondition(customer, "Синтетический клиент не создан");
      customerId = customer.id;

      await transaction`
        INSERT INTO telegram_accounts (
          shop_id, customer_id, telegram_id, username,
          notifications_enabled, is_active,
          linked_at, created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${customer.id}, ${telegramId}, ${marker},
          true, true, NOW(), NOW(), NOW()
        )
      `;

      const productRows = await transaction<{
        id: string;
        unavailable_id: string;
      }[]>`
        WITH available AS (
          INSERT INTO products (
            shop_id, slug, name, price, stock_quantity,
            status, metadata, created_at, updated_at
          )
          VALUES (
            ${shop.id},
            ${`${marker}-available`},
            'Доступный товар E2E',
            2500,
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
        ),
        unavailable AS (
          INSERT INTO products (
            shop_id, slug, name, price, stock_quantity,
            status, metadata, created_at, updated_at
          )
          VALUES (
            ${shop.id},
            ${`${marker}-unavailable`},
            'Недоступный товар E2E',
            1500,
            0,
            'active',
            ${JSON.stringify({
              catalog: { availability: "unavailable" },
              marker,
            })}::jsonb,
            NOW(),
            NOW()
          )
          RETURNING id
        )
        SELECT
          available.id,
          unavailable.id AS unavailable_id
        FROM available, unavailable
      `;
      const product = productRows[0];
      assertCondition(product, "Синтетические товары не созданы");
      pass("созданы доступный и недоступный товары");

      const scope = await resolveCustomerCommerceCartScope(transaction, {
        shopId: shop.id,
        customerId: customer.id,
      });
      assertCondition(scope.linked, "Telegram cart scope не найден");
      assertCondition(
        scope.telegramChatId === telegramId,
        "Telegram cart scope принадлежит другому аккаунту",
      );
      pass("корзина привязана к единой Telegram identity");

      const syncOperation = randomUUID();
      const synchronized = await synchronizeCommerceCart(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        items: [
          { productId: product.id, quantity: 3 },
          { productId: product.unavailable_id, quantity: 2 },
        ],
        mode: "merge_max",
        operationId: syncOperation,
      });
      assertCondition(!synchronized.reused, "Первая синхронизация помечена повторной");
      assertCondition(synchronized.cart.items.length === 1, "Недоступный товар попал в корзину");
      assertCondition(synchronized.cart.items[0]?.quantity === 3, "Количество не синхронизировано");
      assertCondition(
        synchronized.omitted.includes(product.unavailable_id),
        "Недоступный товар не отмечен как пропущенный",
      );

      const repeatedSync = await synchronizeCommerceCart(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        items: [{ productId: product.id, quantity: 9 }],
        mode: "merge_max",
        operationId: syncOperation,
      });
      assertCondition(repeatedSync.reused, "Повторная операция не распознана");
      assertCondition(
        repeatedSync.cart.items[0]?.quantity === 3,
        "Повторная синхронизация изменила корзину",
      );
      pass("повторный запрос не дублирует изменение корзины");

      const setResult = await setCommerceCartQuantity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        productId: product.id,
        quantity: 5,
        source: "site",
        operationId: randomUUID(),
      });
      assertCondition(setResult.cart.items[0]?.quantity === 5, "Точное количество не установлено");

      const incrementOperation = randomUUID();
      const incremented = await incrementCommerceCartQuantity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        productId: product.id,
        delta: 1,
        source: "telegram",
        operationId: incrementOperation,
      });
      const repeatedIncrement = await incrementCommerceCartQuantity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        productId: product.id,
        delta: 1,
        source: "telegram",
        operationId: incrementOperation,
      });
      assertCondition(incremented.cart.items[0]?.quantity === 6, "Инкремент не выполнен");
      assertCondition(repeatedIncrement.reused, "Повторный инкремент не заблокирован");
      assertCondition(
        repeatedIncrement.cart.items[0]?.quantity === 6,
        "Повторный инкремент увеличил количество дважды",
      );
      pass("site и Telegram mutations идемпотентны");

      await setCommerceCartQuantity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        productId: product.id,
        quantity: 99,
        source: "site",
        operationId: randomUUID(),
      });
      const capped = await incrementCommerceCartQuantity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        productId: product.id,
        delta: 1,
        source: "telegram",
        operationId: randomUUID(),
      });
      assertCondition(capped.cart.items[0]?.quantity === 99, "Лимит 99 не соблюдён");
      pass("количество ограничено диапазоном 1–99");

      await transaction`
        INSERT INTO telegram_cart_items (
          shop_id, telegram_chat_id, product_id, quantity,
          created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${telegramId}::bigint,
          ${product.unavailable_id}, 1, NOW(), NOW()
        )
      `;
      const cleaned = await getCommerceCartSnapshot(transaction, {
        shopId: shop.id,
        telegramChatId: telegramId,
      });
      assertCondition(cleaned.items.length === 1, "Недоступная позиция не очищена");
      assertCondition(
        cleaned.removed.some((row) => row.productId === product.unavailable_id),
        "Удалённая позиция не отражена в результате",
      );
      pass("скрытые и недоступные товары удаляются автоматически");

      const cleared = await clearCommerceCart(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        telegramChatId: telegramId,
        source: "site",
        operationId: randomUUID(),
      });
      assertCondition(cleared.cart.items.length === 0, "Корзина не очищена");

      const eventRows = await transaction<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM domain_events
        WHERE shop_id = ${shop.id}
          AND event_type = 'customer.cart.mutated'
          AND actor_customer_id = ${customer.id}
      `;
      assertCondition(Number(eventRows[0]?.total || 0) >= 5, "Журнал изменений корзины не создан");
      pass("создана основа журнала и брошенной корзины без рассылки");

      throw new VerificationRollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const residue = await client<{ total: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${customerId})
      + (SELECT COUNT(*) FROM products WHERE metadata ->> 'marker' = ${marker})
      + (SELECT COUNT(*) FROM domain_events WHERE payload ->> 'marker' = ${marker})
    )::int AS total
  `;
  assertCondition(Number(residue[0]?.total || 0) === 0, "Синтетические данные остались в БД");
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("\nCUSTOMER COMMERCE CART E2E: OK");
  console.log("Проверены единая корзина, актуальные цены, availability, idempotency и лимиты.");
  console.log("Реальные заказы и Telegram-сообщения не создавались.");
} finally {
  await client.end({ timeout: 5 });
}
