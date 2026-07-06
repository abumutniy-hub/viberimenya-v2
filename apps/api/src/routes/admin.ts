import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http-error";

type ShopRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

function numberFromCount(value: unknown) {
  return Number(value ?? 0);
}

const settingsSchema = z.object({
  phone: z.string().optional().default(""),
  whatsapp: z.string().optional().default(""),
  telegram: z.string().optional().default(""),
  instagram: z.string().optional().default(""),
  address: z.string().optional().default(""),
  workHours: z.string().optional().default(""),
  heroTitle: z.string().optional().default("Цветы, которые говорят за вас"),
  heroSubtitle: z.string().optional().default("Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю.")
});

const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional().default(""),
  description: z.string().optional().default(""),
  sortOrder: z.coerce.number().int().optional().default(100),
  isActive: z.coerce.boolean().optional().default(true)
});

const productSchema = z.object({
  categoryId: z.string().uuid().optional().or(z.literal("")).default(""),
  name: z.string().min(2),
  slug: z.string().optional().default(""),
  shortDescription: z.string().optional().default(""),
  description: z.string().optional().default(""),
  price: z.coerce.number().int().min(0),
  stockQuantity: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(["draft", "active", "hidden", "archived"]).optional().default("active"),
  isFeatured: z.coerce.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().optional().default(100)
});

function slugify(value: string) {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };

  return value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}


async function getShop(client: ReturnType<typeof createDb>["client"]) {
  const rows = await client<ShopRow[]>`
    SELECT id, slug, name, status
    FROM shops
    WHERE slug = ${env.DEFAULT_SHOP_SLUG}
    LIMIT 1
  `;

  const shop = rows[0];

  if (!shop) {
    throw new HttpError(404, "Shop not found");
  }

  return shop;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/dashboard", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [
        ordersCount,
        productsCount,
        customersCount,
        categoriesCount,
        deliveryZonesCount,
        latestOrders
      ] = await Promise.all([
        client`SELECT COUNT(*)::int AS count FROM orders WHERE shop_id = ${shop.id}`,
        client`SELECT COUNT(*)::int AS count FROM products WHERE shop_id = ${shop.id}`,
        client`SELECT COUNT(*)::int AS count FROM customers WHERE shop_id = ${shop.id}`,
        client`SELECT COUNT(*)::int AS count FROM categories WHERE shop_id = ${shop.id}`,
        client`SELECT COUNT(*)::int AS count FROM delivery_zones WHERE shop_id = ${shop.id}`,
        client`
          SELECT *
          FROM orders
          WHERE shop_id = ${shop.id}
          ORDER BY created_at DESC
          LIMIT 10
        `
      ]);

      return {
        shop,
        metrics: {
          orders: numberFromCount(ordersCount[0]?.count),
          products: numberFromCount(productsCount[0]?.count),
          customers: numberFromCount(customersCount[0]?.count),
          categories: numberFromCount(categoriesCount[0]?.count),
          deliveryZones: numberFromCount(deliveryZonesCount[0]?.count)
        },
        latestOrders
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/presence", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const rows = await client`
        WITH current_staff AS (
          SELECT u.id
          FROM users u
          JOIN shop_users su ON su.user_id = u.id
          WHERE su.shop_id = ${shop.id}
            AND su.is_active = true
            AND u.status = 'active'
            AND su.role IN ('owner', 'admin', 'manager')
          ORDER BY
            CASE su.role
              WHEN 'owner' THEN 1
              WHEN 'admin' THEN 2
              WHEN 'manager' THEN 3
              ELSE 10
            END,
            u.created_at ASC
          LIMIT 1
        )
        UPDATE users u
        SET last_login_at = NOW(),
            updated_at = NOW()
        FROM current_staff
        WHERE u.id = current_staff.id
        RETURNING u.id, u.name, u.last_login_at
      `;

      return {
        ok: true,
        staff: rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/orders", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client`
        SELECT
          o.*,
          c.phone AS customer_phone,
          c.name AS customer_name,
          o.total AS total_amount,
          p.payment_url AS payment_url,
          COALESCE(ic.messages_count, 0) AS internal_chat_messages_count,
          COALESCE(ic.unread_count, 0) AS internal_chat_unread_count,
          ic.last_message AS internal_chat_last_message,
          ic.last_at AS internal_chat_last_at
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN LATERAL (
          SELECT payment_url
          FROM payments
          WHERE order_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS messages_count,
            COUNT(*) FILTER (WHERE cm.is_read_by_staff = false)::int AS unread_count,
            (ARRAY_AGG(cm.text ORDER BY cm.created_at DESC))[1] AS last_message,
            MAX(cm.created_at) AS last_at
          FROM chat_messages cm
          WHERE cm.order_id = o.id
            AND cm.message_scope = 'internal'
        ) ic ON true
        WHERE o.shop_id = ${shop.id}
        ORDER BY o.created_at DESC
        LIMIT 100
      `;

      return { shop, items };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/orders/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client`
        SELECT
          o.*,
          c.phone AS customer_phone,
          c.name AS customer_name,
          c.email AS customer_email,
          p.payment_url AS payment_url,
          p.status AS latest_payment_status,
          p.method AS latest_payment_method,
          p.provider AS latest_payment_provider,
          p.created_at AS latest_payment_created_at
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN LATERAL (
          SELECT provider, method, status, payment_url, created_at
          FROM payments
          WHERE order_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) p ON true
        WHERE o.shop_id = ${shop.id}
          AND o.id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const items = await client`
        SELECT
          product_id,
          product_name,
          quantity,
          price,
          total,
          created_at
        FROM order_items
        WHERE order_id = ${params.id}
        ORDER BY created_at ASC
      `;

      return {
        ok: true,
        order,
        items
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/orders/:id/internal-chat", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{ id: string; order_number: string; tracking_token: string }[]>`
        SELECT id, order_number, tracking_token
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const chatRows = await client<{ id: string }[]>`
        INSERT INTO order_chats (
          shop_id,
          order_id,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          NOW(),
          NOW()
        )
        ON CONFLICT (order_id)
        DO UPDATE SET updated_at = order_chats.updated_at
        RETURNING id
      `;

      const chat = chatRows[0];

      const messages = chat?.id
        ? await client`
            SELECT
              cm.id,
              cm.author_type,
              cm.author_user_id,
              cm.text,
              cm.attachment_url,
              cm.created_at,
              u.name AS author_name
            FROM chat_messages cm
            LEFT JOIN users u ON u.id = cm.author_user_id
            WHERE cm.shop_id = ${shop.id}
              AND cm.order_id = ${order.id}
              AND cm.chat_id = ${chat.id}
              AND cm.message_scope = 'internal'
            ORDER BY cm.created_at ASC
            LIMIT 100
          `
        : [];

      await client`
        UPDATE chat_messages
        SET is_read_by_staff = true
        WHERE shop_id = ${shop.id}
          AND order_id = ${order.id}
          AND message_scope = 'internal'
          AND is_read_by_staff = false
      `;

      const staffPresence = await client`
        SELECT
          u.id,
          u.name,
          su.role,
          GREATEST(
            COALESCE(u.last_login_at, '1970-01-01'::timestamptz),
            COALESCE(ta.last_telegram_seen_at, '1970-01-01'::timestamptz)
          ) AS last_seen_at,
          CASE
            WHEN GREATEST(
              COALESCE(u.last_login_at, '1970-01-01'::timestamptz),
              COALESCE(ta.last_telegram_seen_at, '1970-01-01'::timestamptz)
            ) > NOW() - INTERVAL '3 minutes'
            THEN true
            ELSE false
          END AS is_online
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        LEFT JOIN LATERAL (
          SELECT MAX(updated_at) AS last_telegram_seen_at
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
        ) ta ON true
        WHERE su.shop_id = ${shop.id}
          AND su.is_active = true
          AND u.status = 'active'
        ORDER BY is_online DESC, u.name ASC NULLS LAST
        LIMIT 12
      `;

      return {
        ok: true,
        order,
        chat,
        messages,
        staffPresence
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/internal-chat", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      text: z.string().trim().min(1).max(2000)
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{ id: string; order_number: string; tracking_token: string }[]>`
        SELECT id, order_number, tracking_token
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const chatRows = await client<{ id: string }[]>`
        INSERT INTO order_chats (
          shop_id,
          order_id,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          NOW(),
          NOW()
        )
        ON CONFLICT (order_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      const chat = chatRows[0];

      if (!chat?.id) {
        return reply.status(500).send({
          ok: false,
          message: "Не удалось открыть чат заказа"
        });
      }

      const messageRows = await client`
        INSERT INTO chat_messages (
          shop_id,
          chat_id,
          order_id,
          author_type,
          author_user_id,
          author_customer_id,
          message_scope,
          text,
          attachment_url,
          is_read_by_staff,
          is_read_by_customer,
          created_at
        )
        VALUES (
          ${shop.id},
          ${chat.id},
          ${order.id},
          'staff',
          NULL,
          NULL,
          'internal',
          ${body.text},
          NULL,
          false,
          false,
          NOW()
        )
        RETURNING id, author_type, author_user_id, text, attachment_url, created_at
      `;

      const message = messageRows[0] as Record<string, unknown> | undefined;

      if (message?.id) {
        const notificationPayload = {
          orderId: order.id,
          orderNumber: order.order_number,
          messageText: body.text,
          trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
          source: "crm_internal_chat"
        };

        await client`
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
          VALUES (
            ${shop.id},
            ${order.id},
            'internal_chat_message',
            'telegram',
            'staff',
            'pending',
            CAST(${JSON.stringify(notificationPayload)} AS jsonb),
            NOW(),
            NOW()
          )
        `;
      }

      return {
        ok: true,
        message: messageRows[0]
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/status", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      status: z.enum([
        "new",
        "confirmed",
        "assembling",
        "ready",
        "assigned_courier",
        "delivering",
        "delivered",
        "cancelled",
        "problem"
      ]),
      comment: z.string().optional().default("")
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{ id: string; status: string }[]>`
        SELECT id, status
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      if (order.status === body.status) {
        return {
          ok: true,
          message: "Статус уже установлен"
        };
      }

      await client`
        UPDATE orders
        SET status = ${body.status}::order_status,
            delivered_at = CASE WHEN ${body.status} = 'delivered' THEN NOW() ELSE delivered_at END,
            cancelled_at = CASE WHEN ${body.status} = 'cancelled' THEN NOW() ELSE cancelled_at END,
            updated_at = NOW()
        WHERE id = ${order.id}
      `;

      await client`
        INSERT INTO order_status_history (
          shop_id,
          order_id,
          from_status,
          to_status,
          comment,
          created_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          ${order.status}::order_status,
          ${body.status}::order_status,
          ${body.comment || "Статус изменён в CRM"},
          NOW()
        )
      `;

      return {
        ok: true,
        status: body.status
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/confirm", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{
        id: string;
        order_number: string;
        status: string;
      }[]>`
        SELECT id, order_number, status
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      if (order.status === "cancelled") {
        return reply.status(400).send({
          ok: false,
          message: "Отменённый заказ нельзя подтвердить"
        });
      }

      if (order.status !== "new") {
        return {
          ok: true,
          message: "Заказ уже обработан"
        };
      }

      await client`
        UPDATE orders
        SET status = 'confirmed',
            updated_at = NOW()
        WHERE id = ${order.id}
      `;

      await client`
        INSERT INTO order_status_history (
          shop_id,
          order_id,
          from_status,
          to_status,
          comment,
          created_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          ${order.status},
          'confirmed',
          'Заказ подтверждён менеджером',
          NOW()
        )
      `;

      const updatedRows = await client`
        SELECT
          o.*,
          c.phone AS customer_phone,
          c.name AS customer_name,
          o.total AS total_amount
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${order.id}
        LIMIT 1
      `;
        const updatedOrder = updatedRows[0] as Record<string, any> | undefined;

        await client`
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
          VALUES (
            ${shop.id},
            ${order.id},
            'order_confirmed',
            'telegram',
            'staff',
            'pending',
            ${JSON.stringify({
              orderId: order.id,
              orderNumber: updatedOrder?.order_number ?? null,
              previousStatus: order.status,
              status: "confirmed",
              paymentStatus: updatedOrder?.payment_status ?? null,
              totalAmount: updatedOrder?.total_amount ?? updatedOrder?.total ?? null,
              customerPhone: updatedOrder?.customer_phone ?? null,
              trackingToken: updatedOrder?.tracking_token ?? null,
              trackingUrl: updatedOrder?.tracking_token ? `/order/track/${updatedOrder.tracking_token}` : null
            })},
            NOW(),
            NOW()
          )
        `;


      return {
        ok: true,
        order: updatedRows[0]
      };
    } finally {
      await client.end();
    }
  });


  app.post("/api/admin/orders/:id/payment-link", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      paymentUrl: z.string().url()
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{
        id: string;
        order_number: string;
        status: string;
        payment_status: string;
        payment_method: string;
        total: number;
      }[]>`
        SELECT id, order_number, status, payment_status, payment_method, total
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      if (order.status !== "confirmed") {
        return reply.status(400).send({
          ok: false,
          message: "Ссылку на оплату можно добавить только после подтверждения заказа"
        });
      }

      if (order.payment_status === "paid") {
        return reply.status(400).send({
          ok: false,
          message: "Заказ уже оплачен"
        });
      }

      const paymentRows = await client`
        INSERT INTO payments (
          shop_id,
          order_id,
          provider,
          method,
          status,
          amount,
          currency,
          payment_url,
          raw_payload,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          'manual',
          ${order.payment_method},
          'pending',
          ${Number(order.total || 0)},
          'RUB',
          ${body.paymentUrl},
          ${JSON.stringify({ source: "admin_manual_link" })},
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      await client`
        UPDATE orders
        SET payment_status = 'pending',
            updated_at = NOW()
        WHERE id = ${order.id}
      `;
        const payment = paymentRows[0] as Record<string, any> | undefined;

        await client`
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
          VALUES (
            ${shop.id},
            ${order.id},
            'payment_link_added',
            'telegram',
            'staff',
            'pending',
            ${JSON.stringify({
              orderId: order.id,
              orderNumber: order.order_number,
              status: order.status,
              paymentStatus: order.payment_status,
              amount: order.total,
              paymentUrl: body.paymentUrl,
              paymentId: payment?.id ?? null
            })},
            NOW(),
            NOW()
          )
        `;


      return {
        ok: true,
        payment: paymentRows[0]
      };
    } finally {
      await client.end();
    }
  });


  app.post("/api/admin/orders/:id/mark-paid", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const orderRows = await client<{
        id: string;
        customer_id: string | null;
        order_number: string;
        status: string;
        payment_status: string;
        total: number;
        bonus_earned: number;
      }[]>`
        SELECT id, customer_id, order_number, status, payment_status, total, bonus_earned
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      if (order.status === "new") {
        return reply.status(400).send({
          ok: false,
          message: "Сначала подтвердите заказ, затем отметьте оплату"
        });
      }

      if (order.status === "cancelled") {
        return reply.status(400).send({
          ok: false,
          message: "Отменённый заказ нельзя отметить оплаченным"
        });
      }

      if (!order.customer_id) {
        return reply.status(400).send({
          ok: false,
          message: "У заказа нет клиента для начисления бонусов"
        });
      }

      const wasAlreadyPaid = order.payment_status === "paid";
      const alreadyEarned = Number(order.bonus_earned || 0) > 0;
      const bonusAmount = wasAlreadyPaid || alreadyEarned
        ? 0
        : Math.floor(Number(order.total || 0) * 0.05);

      await client`
        UPDATE orders
        SET payment_status = 'paid',
            bonus_earned = CASE
              WHEN bonus_earned > 0 THEN bonus_earned
              ELSE ${bonusAmount}
            END,
            updated_at = NOW()
        WHERE id = ${order.id}
      `;

      await client`
        UPDATE payments
        SET status = 'paid',
            paid_at = COALESCE(paid_at, NOW()),
            updated_at = NOW()
        WHERE order_id = ${order.id}
          AND status <> 'paid'
      `;

      let balanceAfter: number | null = null;

      if (bonusAmount > 0) {
        const customerRows = await client<{ bonus_balance: number }[]>`
          UPDATE customers
          SET bonus_balance = bonus_balance + ${bonusAmount},
              updated_at = NOW()
          WHERE id = ${order.customer_id}
          RETURNING bonus_balance
        `;

        balanceAfter = Number(customerRows[0]?.bonus_balance ?? 0);

        await client`
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
            ${shop.id},
            ${order.customer_id},
            ${order.id},
            'earn',
            ${bonusAmount},
            ${balanceAfter},
            ${`Начисление 5% за оплаченный заказ ${order.order_number}`},
            NOW()
          )
        `;
      }
        if (!wasAlreadyPaid) {
          await client`
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
            VALUES (
              ${shop.id},
              ${order.id},
              'order_paid',
              'telegram',
              'staff',
              'pending',
              ${JSON.stringify({
                orderId: order.id,
                orderNumber: order.order_number,
                status: order.status,
                paymentStatus: "paid",
                totalAmount: order.total,
                bonusEarned: bonusAmount,
                balanceAfter
              })},
              NOW(),
              NOW()
            )
          `;
        }


      const updatedRows = await client`
        SELECT
          o.*,
          c.phone AS customer_phone,
          c.name AS customer_name,
          o.total AS total_amount
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${order.id}
        LIMIT 1
      `;

      return {
        ok: true,
        order: updatedRows[0],
        bonus: {
          earnedNow: bonusAmount,
          balanceAfter
        }
      };
    } finally {
      await client.end();
    }
  });


  app.get("/api/admin/catalog", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [categories, products] = await Promise.all([
        client`
          SELECT *
          FROM categories
          WHERE shop_id = ${shop.id}
          ORDER BY sort_order ASC, name ASC
        `,
        client`
          SELECT *
          FROM products
          WHERE shop_id = ${shop.id}
          ORDER BY created_at DESC
          LIMIT 100
        `
      ]);

      return { shop, categories, products };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/delivery", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [zones, intervals] = await Promise.all([
        client`
          SELECT *
          FROM delivery_zones
          WHERE shop_id = ${shop.id}
          ORDER BY sort_order ASC
        `,
        client`
          SELECT *
          FROM delivery_intervals
          WHERE shop_id = ${shop.id}
          ORDER BY sort_order ASC
        `
      ]);

      return { shop, zones, intervals };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/customers", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client`
        SELECT *
        FROM customers
        WHERE shop_id = ${shop.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return { shop, items };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/employees", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client`
        SELECT *
        FROM shop_users
        WHERE shop_id = ${shop.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return { shop, items };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/settings", async (request) => {
    const body = settingsSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const rows = await client`
        UPDATE shop_settings
        SET
          phone = ${body.phone},
          whatsapp = ${body.whatsapp},
          telegram = ${body.telegram},
          instagram = ${body.instagram},
          address = ${body.address},
          work_hours = ${body.workHours},
          hero_title = ${body.heroTitle},
          hero_subtitle = ${body.heroSubtitle},
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
        RETURNING *
      `;

      return {
        ok: true,
        settings: rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/categories", async (request) => {
    const body = categorySchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const slug = body.slug.trim() || slugify(body.name);

      if (!slug) {
        throw new HttpError(400, "Category slug is required");
      }

      const rows = await client`
        INSERT INTO categories (
          shop_id,
          slug,
          name,
          description,
          is_active,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${slug},
          ${body.name},
          ${body.description},
          ${body.isActive},
          ${body.sortOrder},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_active = EXCLUDED.is_active,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
        RETURNING *
      `;

      return {
        ok: true,
        category: rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/products", async (request) => {
    const body = productSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const slug = body.slug.trim() || slugify(body.name);
      const categoryId = body.categoryId || null;

      if (!slug) {
        throw new HttpError(400, "Product slug is required");
      }

      const rows = await client`
        INSERT INTO products (
          shop_id,
          category_id,
          slug,
          name,
          short_description,
          description,
          price,
          status,
          stock_quantity,
          is_featured,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${categoryId},
          ${slug},
          ${body.name},
          ${body.shortDescription},
          ${body.description},
          ${body.price},
          ${body.status},
          ${body.stockQuantity},
          ${body.isFeatured},
          ${body.sortOrder},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, slug)
        DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          short_description = EXCLUDED.short_description,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          status = EXCLUDED.status,
          stock_quantity = EXCLUDED.stock_quantity,
          is_featured = EXCLUDED.is_featured,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
        RETURNING *
      `;

      return {
        ok: true,
        product: rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/settings", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [settings, domains] = await Promise.all([
        client`
          SELECT *
          FROM shop_settings
          WHERE shop_id = ${shop.id}
          LIMIT 1
        `,
        client`
          SELECT *
          FROM shop_domains
          WHERE shop_id = ${shop.id}
          ORDER BY is_primary DESC, created_at ASC
        `
      ]);

      return {
        shop,
        settings: settings[0] ?? null,
        domains
      };
    } finally {
      await client.end();
    }
  });
}
