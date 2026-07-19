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

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const marker = `customer-dashboard-${Date.now()}-${randomUUID().slice(0, 8)}`;
const phone = `+7998${String(Date.now()).slice(-7)}`;
const telegramId = `8${Date.now()}${Math.floor(Math.random() * 100)}`;
let customerId = "";
let activeOrderId = "";
let historyOrderId = "";

try {
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya-customer-telegram-dashboard-e2e')
        )
      `;

      const shops = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at
        LIMIT 1
      `;
      const shop = shops[0];
      assertCondition(shop, "Активный магазин не найден");
      pass("активный магазин найден");

      const products = await transaction<{
        id: string;
        name: string;
        price: number;
      }[]>`
        SELECT id, name, price
        FROM products
        WHERE shop_id = ${shop.id}
          AND status = 'active'
        ORDER BY created_at
        LIMIT 1
      `;
      const product = products[0];
      assertCondition(product, "Активный товар не найден");
      pass("активный товар найден");

      const customers = await transaction<{ id: string }[]>`
        INSERT INTO customers (
          shop_id,
          phone,
          name,
          email,
          bonus_balance,
          total_orders,
          total_spent,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${phone},
          'Dashboard E2E Customer',
          ${`${marker}@example.invalid`},
          400,
          2,
          5000,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const customer = customers[0];
      assertCondition(customer, "Синтетический клиент не создан");
      customerId = customer.id;

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
          ${telegramId},
          ${marker},
          'Dashboard E2E',
          true,
          true,
          NOW(),
          NOW(),
          NOW()
        )
      `;

      await transaction`
        INSERT INTO customer_addresses (
          shop_id,
          customer_id,
          city,
          street,
          house,
          apartment,
          entrance,
          floor,
          comment,
          is_default,
          created_at,
          updated_at
        )
        VALUES
          (
            ${shop.id}, ${customer.id}, 'Москва', 'Тестовая улица',
            '10', '20', '1', '5', ${marker}, true, NOW(), NOW()
          ),
          (
            ${shop.id}, ${customer.id}, 'Люберцы', 'Вторая улица',
            '7', NULL, NULL, NULL, ${marker}, false, NOW(), NOW()
          )
      `;

      const activeOrders = await transaction<{ id: string }[]>`
        INSERT INTO orders (
          shop_id,
          customer_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          delivery_date,
          delivery_address_text,
          recipient_name,
          recipient_phone,
          subtotal,
          total,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${`E2E-A-${Date.now()}`},
          'confirmed',
          'paid',
          'online_card',
          'delivery',
          NOW() + INTERVAL '1 day',
          'Москва, Тестовая улица, д. 10',
          'Получатель E2E',
          ${phone},
          3000,
          3000,
          ${`track-active-${randomUUID()}`},
          ${JSON.stringify({ marker })}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `;
      const activeOrder = activeOrders[0];
      assertCondition(activeOrder, "Активный заказ не создан");
      activeOrderId = activeOrder.id;

      const historyOrders = await transaction<{ id: string }[]>`
        INSERT INTO orders (
          shop_id,
          customer_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          delivery_date,
          recipient_name,
          recipient_phone,
          subtotal,
          total,
          tracking_token,
          delivered_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${`E2E-H-${Date.now()}`},
          'delivered',
          'paid',
          'online_card',
          'pickup',
          NOW() - INTERVAL '2 days',
          'Получатель E2E',
          ${phone},
          2000,
          2000,
          ${`track-history-${randomUUID()}`},
          NOW() - INTERVAL '2 days',
          ${JSON.stringify({ marker })}::jsonb,
          NOW() - INTERVAL '3 days',
          NOW() - INTERVAL '2 days'
        )
        RETURNING id
      `;
      const historyOrder = historyOrders[0];
      assertCondition(historyOrder, "Исторический заказ не создан");
      historyOrderId = historyOrder.id;

      await transaction`
        INSERT INTO order_items (
          shop_id,
          order_id,
          product_id,
          product_name,
          quantity,
          price,
          total,
          created_at,
          updated_at
        )
        VALUES
          (
            ${shop.id}, ${activeOrder.id}, ${product.id},
            ${product.name}, 2, ${product.price}, ${product.price * 2},
            NOW(), NOW()
          ),
          (
            ${shop.id}, ${historyOrder.id}, ${product.id},
            ${product.name}, 1, ${product.price}, ${product.price},
            NOW(), NOW()
          )
      `;

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
        VALUES
          (
            ${shop.id}, ${customer.id}, ${historyOrder.id},
            'earn', 500, 500, ${marker}, NOW() - INTERVAL '2 days'
          ),
          (
            ${shop.id}, ${customer.id}, ${activeOrder.id},
            'spend', -100, 400, ${marker}, NOW()
          )
      `;
      pass("созданы синтетические профиль, адреса, заказы и бонусы");

      const counts = await transaction<{
        active_count: number;
        history_count: number;
      }[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE status NOT IN ('delivered', 'cancelled')
          )::int AS active_count,
          COUNT(*) FILTER (
            WHERE status IN ('delivered', 'cancelled')
          )::int AS history_count
        FROM orders
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
      `;
      assertCondition(
        counts[0]?.active_count === 1 && counts[0]?.history_count === 1,
        "Счётчики активных заказов и истории неверны",
      );
      pass("активные заказы и история разделяются корректно");

      const orderList = await transaction<{
        id: string;
        item_names: string;
      }[]>`
        SELECT
          o.id,
          COALESCE((
            SELECT string_agg(oi.product_name, ', ' ORDER BY oi.created_at)
            FROM order_items oi
            WHERE oi.order_id = o.id
          ), '') AS item_names
        FROM orders o
        WHERE o.shop_id = ${shop.id}
          AND o.customer_id = ${customer.id}
        ORDER BY o.created_at DESC
      `;
      assertCondition(orderList.length === 2, "Список заказов неполный");
      assertCondition(
        orderList.every((order) => Boolean(order.item_names)),
        "В карточках заказов отсутствует состав",
      );
      pass("список заказов содержит состав товаров");

      const detail = await transaction<{
        id: string;
        delivery_address_text: string | null;
        recipient_name: string | null;
        item_names: string;
      }[]>`
        SELECT
          o.id,
          o.delivery_address_text,
          o.recipient_name,
          COALESCE((
            SELECT string_agg(oi.product_name, ', ' ORDER BY oi.created_at)
            FROM order_items oi
            WHERE oi.order_id = o.id
          ), '') AS item_names
        FROM orders o
        WHERE o.id = ${activeOrder.id}
          AND o.shop_id = ${shop.id}
          AND o.customer_id = ${customer.id}
        LIMIT 1
      `;
      assertCondition(
        detail[0]?.id === activeOrder.id &&
          Boolean(detail[0]?.delivery_address_text) &&
          Boolean(detail[0]?.recipient_name) &&
          Boolean(detail[0]?.item_names),
        "Детальная карточка заказа неполная",
      );
      pass("детальная карточка заказа принадлежит клиенту и заполнена");

      const addresses = await transaction<{
        city: string | null;
        is_default: boolean;
      }[]>`
        SELECT city, is_default
        FROM customer_addresses
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
        ORDER BY is_default DESC, created_at DESC
      `;
      assertCondition(addresses.length === 2, "Сохранённые адреса не прочитаны");
      assertCondition(addresses[0]?.is_default, "Адрес по умолчанию не первый");
      pass("сохранённые адреса и адрес по умолчанию читаются корректно");

      const favorites = await transaction<{
        id: string;
        ordered_quantity: number;
      }[]>`
        SELECT
          p.id,
          SUM(oi.quantity)::int AS ordered_quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.shop_id = ${shop.id}
          AND o.customer_id = ${customer.id}
          AND p.status = 'active'
        GROUP BY p.id
        ORDER BY SUM(oi.quantity) DESC
      `;
      assertCondition(
        favorites[0]?.id === product.id &&
          favorites[0]?.ordered_quantity === 3,
        "Любимые букеты рассчитаны неверно",
      );
      pass("любимые букеты формируются из истории покупок");

      const bonuses = await transaction<{
        amount: number;
        balance_after: number;
      }[]>`
        SELECT amount, balance_after
        FROM bonus_transactions
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
        ORDER BY created_at DESC
      `;
      assertCondition(bonuses.length === 2, "История бонусов неполная");
      assertCondition(
        bonuses[0]?.balance_after === 400,
        "Актуальный бонусный баланс неверен",
      );
      pass("баланс и история бонусов читаются корректно");

      const telegramProfile = await transaction<{
        customer_id: string | null;
        notifications_enabled: boolean;
      }[]>`
        SELECT customer_id, notifications_enabled
        FROM telegram_accounts
        WHERE shop_id = ${shop.id}
          AND telegram_id = ${telegramId}
          AND is_active = true
        LIMIT 1
      `;
      assertCondition(
        telegramProfile[0]?.customer_id === customer.id &&
          telegramProfile[0]?.notifications_enabled,
        "Telegram-профиль клиента не читается",
      );
      pass("Telegram-профиль клиента доступен для меню");

      throw new VerificationRollback("rollback customer dashboard E2E");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) {
      throw error;
    }
  }

  const residue = await sql<{ total: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${customerId || null})
      + (SELECT COUNT(*) FROM telegram_accounts WHERE telegram_id = ${telegramId})
      + (SELECT COUNT(*) FROM customer_addresses WHERE customer_id = ${customerId || null})
      + (SELECT COUNT(*) FROM orders WHERE id IN (${activeOrderId || null}, ${historyOrderId || null}))
      + (SELECT COUNT(*) FROM bonus_transactions WHERE customer_id = ${customerId || null})
    )::int AS total
  `;

  assertCondition(
    Number(residue[0]?.total ?? -1) === 0,
    "После rollback остались синтетические данные клиентского меню",
  );
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("");
  console.log("CUSTOMER TELEGRAM DASHBOARD E2E: OK");
  console.log("Проверены заказы, детали, адреса, любимые букеты и бонусы.");
  console.log("Реальные Telegram-сообщения не отправлялись.");
} finally {
  await sql.end({ timeout: 5 });
}
