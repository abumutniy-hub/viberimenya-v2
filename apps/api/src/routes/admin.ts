import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
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

function createEmployeeLinkToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function telegramStaffLinkUrl(token: string) {
  const username = process.env.TELEGRAM_BOT_USERNAME || "viberimenya_bot";
  return `https://t.me/${username}?start=staff_${token}`;
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

const employeeSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(5),
  email: z.string().email().optional().or(z.literal("")).default(""),
  telegramUsername: z.string().optional().default(""),
  role: z.enum(["admin", "manager", "florist", "courier"]),
  isActive: z.coerce.boolean().optional().default(true)
});

const orderAssigneesSchema = z.object({
  managerId: z.string().uuid().optional().or(z.literal("")).default(""),
  floristId: z.string().uuid().optional().or(z.literal("")).default(""),
  courierId: z.string().uuid().optional().or(z.literal("")).default("")
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

      const staff = await client`
        SELECT
          su.user_id,
          su.role,
          su.is_active,
          u.name,
          u.phone,
          u.email,
          ta.telegram_id AS telegram_id,
          ta.username AS telegram_username
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        LEFT JOIN LATERAL (
          SELECT telegram_id, username
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        ) ta ON true
        WHERE su.shop_id = ${shop.id}
          AND su.is_active = true
          AND su.role IN ('manager', 'florist', 'courier')
        ORDER BY
          CASE su.role
            WHEN 'manager' THEN 1
            WHEN 'florist' THEN 2
            WHEN 'courier' THEN 3
            ELSE 99
          END,
          u.name ASC NULLS LAST
      `;

      return {
        ok: true,
        order,
        items,
        staff
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/orders/:id/assignees", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = orderAssigneesSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const managerId = body.managerId.trim() || null;
      const floristId = body.floristId.trim() || null;
      const courierId = body.courierId.trim() || null;

      const orderRows = await client<{
        id: string;
        order_number: string;
        florist_id: string | null;
        courier_id: string | null;
        total: number | null;
        delivery_date: string | null;
        delivery_address_text: string | null;
        delivery_comment: string | null;
        recipient_name: string | null;
        recipient_phone: string | null;
        delivery_interval_name: string | null;
        tracking_token: string | null;
      }[]>`
        SELECT
          o.id,
          o.order_number,
          o.florist_id,
          o.courier_id,
          o.total,
          o.delivery_date,
          o.delivery_address_text,
          o.delivery_comment,
          o.recipient_name,
          o.recipient_phone,
          di.name AS delivery_interval_name,
          o.tracking_token
        FROM orders o
        LEFT JOIN delivery_intervals di
          ON di.id = o.delivery_interval_id
         AND di.shop_id = o.shop_id
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

      async function ensureAssignee(userId: string | null, role: "manager" | "florist" | "courier", label: string) {
        if (!userId) return;

        const rows = await client<{ id: string }[]>`
          SELECT su.id
          FROM shop_users su
          WHERE su.shop_id = ${shop.id}
            AND su.user_id = ${userId}
            AND su.role = ${role}::shop_user_role
            AND su.is_active = true
          LIMIT 1
        `;

        if (!rows[0]) {
          throw new HttpError(400, `${label} не найден или не активен`);
        }
      }

      await ensureAssignee(managerId, "manager", "Менеджер");
      await ensureAssignee(floristId, "florist", "Флорист");
      await ensureAssignee(courierId, "courier", "Курьер");

      const updatedRows = await client`
        UPDATE orders
        SET manager_id = ${managerId},
            florist_id = ${floristId},
            courier_id = ${courierId},
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${order.id}
        RETURNING id, manager_id, florist_id, courier_id, updated_at
      `;

      if (floristId && floristId !== order.florist_id) {
        const floristRows = await client<{ telegram_id: string; name: string | null }[]>`
          SELECT ta.telegram_id, u.name
          FROM shop_users su
          JOIN users u ON u.id = su.user_id
          JOIN telegram_accounts ta
            ON ta.shop_id = su.shop_id
           AND ta.user_id = su.user_id
           AND ta.is_active = true
          WHERE su.shop_id = ${shop.id}
            AND su.user_id = ${floristId}
            AND su.role = 'florist'
            AND su.is_active = true
          ORDER BY ta.linked_at DESC
          LIMIT 1
        `;

        const florist = floristRows[0];

        if (florist?.telegram_id) {
          const itemRows = await client<{
            product_name: string | null;
            product_image_url: string | null;
          }[]>`
            SELECT
              oi.product_name,
              pi.url AS product_image_url
            FROM order_items oi
            LEFT JOIN LATERAL (
              SELECT url
              FROM product_images
              WHERE product_id = oi.product_id
                AND shop_id = ${shop.id}
              ORDER BY is_main DESC, sort_order ASC, created_at ASC
              LIMIT 1
            ) pi ON true
            WHERE oi.order_id = ${order.id}
            ORDER BY oi.created_at ASC
            LIMIT 1
          `;

          const firstItem = itemRows[0];

          const notificationPayload = {
            orderId: order.id,
            orderNumber: order.order_number,
            floristId,
            floristName: florist.name,
            productName: firstItem?.product_name ?? null,
            productImageUrl: firstItem?.product_image_url ?? null,
            deliveryDate: order.delivery_date,
            trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
            crmUrl: `/admin/orders/${order.id}`
          };

          await client`
            INSERT INTO notification_events (
              shop_id,
              order_id,
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
              ${order.id},
              'florist_order_assigned',
              'telegram',
              'staff',
              ${florist.telegram_id},
              'pending',
              CAST(${JSON.stringify(notificationPayload)} AS jsonb),
              NOW(),
              NOW()
            )
          `;
        }
      }

      if (courierId && courierId !== order.courier_id) {
        const courierRows = await client<{ telegram_id: string; name: string | null }[]>`
          SELECT ta.telegram_id, u.name
          FROM shop_users su
          JOIN users u ON u.id = su.user_id
          JOIN telegram_accounts ta
            ON ta.shop_id = su.shop_id
           AND ta.user_id = su.user_id
           AND ta.is_active = true
          WHERE su.shop_id = ${shop.id}
            AND su.user_id = ${courierId}
            AND su.role = 'courier'
            AND su.is_active = true
          ORDER BY ta.linked_at DESC
          LIMIT 1
        `;

        const courier = courierRows[0];

        if (courier?.telegram_id) {
          const notificationPayload = {
            orderId: order.id,
            orderNumber: order.order_number,
            courierId,
            courierName: courier.name,
            deliveryDate: order.delivery_date,
            deliveryIntervalName: order.delivery_interval_name,
            deliveryAddressText: order.delivery_address_text,
            deliveryComment: order.delivery_comment,
            recipientName: order.recipient_name,
            recipientPhone: order.recipient_phone,
            trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
            crmUrl: `/admin/orders/${order.id}`
          };

          await client`
            INSERT INTO notification_events (
              shop_id,
              order_id,
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
              ${order.id},
              'courier_order_assigned',
              'telegram',
              'staff',
              ${courier.telegram_id},
              'pending',
              CAST(${JSON.stringify(notificationPayload)} AS jsonb),
              NOW(),
              NOW()
            )
          `;
        }
      }

      return {
        ok: true,
        order: updatedRows[0] ?? null
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

      const items = await client<{
        id: string;
        user_id: string;
        role: string;
        is_active: boolean;
        created_at: string;
        updated_at: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        user_status: string;
        last_login_at: string | null;
        linked_telegram_id: string | null;
        linked_telegram_username: string | null;
        telegram_link_token: string | null;
        telegram_link_expires_at: string | null;
      }[]>`
        SELECT
          su.id,
          su.user_id,
          su.role,
          su.is_active,
          su.created_at,
          su.updated_at,
          u.name,
          u.phone,
          u.email,
          u.status AS user_status,
          u.last_login_at,
          ta.telegram_id AS linked_telegram_id,
          ta.username AS linked_telegram_username,
          elt.token AS telegram_link_token,
          elt.expires_at AS telegram_link_expires_at
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        LEFT JOIN LATERAL (
          SELECT telegram_id, username
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        ) ta ON true
        LEFT JOIN LATERAL (
          SELECT token, expires_at
          FROM employee_link_tokens
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND provider = 'telegram'
            AND purpose = 'connect_staff'
            AND status = 'pending'
            AND consumed_at IS NULL
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
        ) elt ON true
        WHERE su.shop_id = ${shop.id}
        ORDER BY
          CASE su.role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'manager' THEN 3
            WHEN 'florist' THEN 4
            WHEN 'courier' THEN 5
            ELSE 99
          END,
          su.created_at DESC
        LIMIT 100
      `;

      return {
        shop,
        items: items.map((item) => ({
          ...item,
          telegram_link_url: item.telegram_link_token ? telegramStaffLinkUrl(String(item.telegram_link_token)) : null
        }))
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/employees", async (request, reply) => {
    const body = employeeSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const name = body.name.trim();
      const phone = body.phone.trim();
      const email = body.email.trim() || null;

      const existingRows = email
        ? await client<{ id: string }[]>`
            SELECT id
            FROM users
            WHERE phone = ${phone}
               OR email = ${email}
            LIMIT 1
          `
        : await client<{ id: string }[]>`
            SELECT id
            FROM users
            WHERE phone = ${phone}
            LIMIT 1
          `;

      let userId = existingRows[0]?.id;

      if (userId) {
        await client`
          UPDATE users
          SET name = ${name},
              phone = ${phone},
              email = ${email},
              status = 'active',
              updated_at = NOW()
          WHERE id = ${userId}
        `;
      } else {
        const userRows = await client<{ id: string }[]>`
          INSERT INTO users (
            phone,
            email,
            name,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ${phone},
            ${email},
            ${name},
            'active',
            NOW(),
            NOW()
          )
          RETURNING id
        `;

        userId = userRows[0]?.id;
      }

      if (!userId) {
        return reply.status(500).send({
          ok: false,
          message: "Не удалось создать пользователя"
        });
      }

      const employeeRows = await client`
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
          ${userId},
          ${body.role}::shop_user_role,
          ${body.isActive},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING *
      `;

      await client`
        UPDATE employee_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${userId}
          AND provider = 'telegram'
          AND purpose = 'connect_staff'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      const telegramToken = createEmployeeLinkToken();
      const telegramUsername = body.telegramUsername.trim().replace(/^@/, "");
      const employeeLinkMetadata = {
        source: "admin_employee_create",
        role: body.role,
        telegramUsername: telegramUsername || null
      };

      await client`
        INSERT INTO employee_link_tokens (
          shop_id,
          user_id,
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
          ${userId},
          'telegram',
          'connect_staff',
          ${telegramToken},
          'pending',
          NOW() + INTERVAL '7 days',
          CAST(${JSON.stringify(employeeLinkMetadata)} AS jsonb),
          NOW(),
          NOW()
        )
      `;

      return {
        ok: true,
        employee: employeeRows[0] ?? null,
        telegramLinkUrl: telegramStaffLinkUrl(telegramToken)
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/employees/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
    const body = employeeSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows = await client<{ user_id: string; role: string }[]>`
        SELECT user_id, role
        FROM shop_users
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const employee = employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message: "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message: "Владельца нельзя редактировать через эту форму"
        });
      }

      const name = body.name.trim();
      const phone = body.phone.trim();
      const email = body.email.trim() || null;

      await client`
        UPDATE users
        SET name = ${name},
            phone = ${phone},
            email = ${email},
            status = 'active',
            updated_at = NOW()
        WHERE id = ${employee.user_id}
      `;

      await client`
        UPDATE shop_users
        SET role = ${body.role}::shop_user_role,
            is_active = ${body.isActive},
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
      `;

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/employees/:id/telegram-link", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows = await client<{ user_id: string; role: string; name: string | null }[]>`
        SELECT su.user_id, su.role, u.name
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        WHERE su.shop_id = ${shop.id}
          AND su.id = ${params.id}
          AND su.is_active = true
        LIMIT 1
      `;

      const employee = employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message: "Активный сотрудник не найден"
        });
      }

      await client`
        UPDATE employee_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
          AND provider = 'telegram'
          AND purpose = 'connect_staff'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      const telegramToken = createEmployeeLinkToken();

      await client`
        INSERT INTO employee_link_tokens (
          shop_id,
          user_id,
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
          ${employee.user_id},
          'telegram',
          'connect_staff',
          ${telegramToken},
          'pending',
          NOW() + INTERVAL '7 days',
          CAST(${JSON.stringify({ source: "admin_employee_link_regenerate" })} AS jsonb),
          NOW(),
          NOW()
        )
      `;

      return {
        ok: true,
        telegramLinkUrl: telegramStaffLinkUrl(telegramToken)
      };
    } finally {
      await client.end();
    }
  });

  app.delete("/api/admin/employees/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows = await client<{ user_id: string; role: string }[]>`
        SELECT user_id, role
        FROM shop_users
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const employee = employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message: "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message: "Владельца нельзя удалить из команды"
        });
      }

      await client`
        UPDATE shop_users
        SET is_active = false,
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
      `;

      await client`
        UPDATE telegram_accounts
        SET is_active = false,
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
      `;

      await client`
        UPDATE employee_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      return { ok: true };
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
