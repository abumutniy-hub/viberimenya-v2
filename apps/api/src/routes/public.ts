import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, asc, desc } from "drizzle-orm";
import {
  categories,
  createDb,
  deliveryIntervals,
  deliveryZones,
  productImages,
  products,
  shopDomains,
  shops,
  shopSettings
} from "@viberimenya/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http-error";

const createOrderSchema = z.object({
  customerName: z.string().min(2),
  customerPhone: z.string().min(5),
  recipientName: z.string().optional().default(""),
  recipientPhone: z.string().optional().default(""),
  deliveryType: z.enum(["delivery", "pickup"]).default("delivery"),
  deliveryAddress: z.string().optional().default(""),
  deliveryDate: z.string().optional().default(""),
  deliveryIntervalText: z.string().optional().default(""),
  deliveryZoneId: z.string().uuid().optional().or(z.literal("")).default(""),
  paymentMethod: z.enum(["cash_on_delivery", "transfer_after_confirm", "online_card", "sbp"]).default("transfer_after_confirm"),
  customerComment: z.string().optional().default(""),
  promoCode: z.string().optional().default(""),
  bonusToSpend: z.coerce.number().int().min(0).optional().default(0),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.coerce.number().int().min(1).max(99)
    })
  ).min(1)
});

function createOrderNumber() {
  return `VM-${Date.now()}`;
}

function createTrackingToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

function normalizePromoCode(code: string) {
  return code.trim().toUpperCase();
}

function calculateDiscount(params: {
  subtotal: number;
  discountType: string;
  discountValue: number;
}) {
  if (params.subtotal <= 0) return 0;

  if (params.discountType === "percent") {
    return Math.min(
      params.subtotal,
      Math.floor((params.subtotal * params.discountValue) / 100)
    );
  }

  return Math.min(params.subtotal, params.discountValue);
}

const CUSTOMER_SESSION_COOKIE = "vm_customer_session";

function createLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createSessionToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function createCustomerLinkToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function telegramBotDeepLink(token: string) {
  const username = process.env.TELEGRAM_BOT_USERNAME || "viberimenya_bot";
  return `https://t.me/${username}?start=link_${token}`;
}

function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return "";

  const parts = cookieHeader.split(";").map((item) => item.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");

    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

function buildCustomerSessionCookie(token: string) {
  return `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
}

function clearCustomerSessionCookie() {
  return `${CUSTOMER_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}



async function getShopContext() {
  const { db, client } = createDb();

  try {
    const shopRows = await db
      .select()
      .from(shops)
      .where(eq(shops.slug, env.DEFAULT_SHOP_SLUG))
      .limit(1);

    const shop = shopRows[0];

    if (!shop) {
      throw new HttpError(404, "Shop not found");
    }

    return { db, client, shop };
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function publicRoutes(app: FastifyInstance) {
  app.get("/api/public/shop", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const settings = await db
        .select()
        .from(shopSettings)
        .where(eq(shopSettings.shopId, shop.id))
        .limit(1);

      const domains = await db
        .select()
        .from(shopDomains)
        .where(eq(shopDomains.shopId, shop.id));

      return {
        shop,
        settings: settings[0] ?? null,
        domains
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/home", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const settingsRows = await db
        .select()
        .from(shopSettings)
        .where(eq(shopSettings.shopId, shop.id))
        .limit(1);

      const categoryRows = await db
        .select()
        .from(categories)
        .where(and(eq(categories.shopId, shop.id), eq(categories.isActive, true)))
        .orderBy(asc(categories.sortOrder))
        .limit(12);

      const featuredProducts = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.shopId, shop.id),
            eq(products.status, "active"),
            eq(products.isFeatured, true)
          )
        )
        .orderBy(asc(products.sortOrder), desc(products.createdAt))
        .limit(12);

      return {
        shop,
        settings: settingsRows[0] ?? null,
        sections: {
          hero: {
            title: settingsRows[0]?.heroTitle ?? "Цветы, которые говорят за вас",
            subtitle:
              settingsRows[0]?.heroSubtitle ??
              "Собираем стильные букеты и бережно доставляем получателю."
          },
          occasions: [
            "Любимой",
            "Маме",
            "День рождения",
            "Извиниться",
            "Без повода",
            "Свадьба",
            "Выписка",
            "Учителю",
            "Коллеге"
          ],
          categories: categoryRows,
          featuredProducts
        }
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/categories", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const result = await db
        .select()
        .from(categories)
        .where(and(eq(categories.shopId, shop.id), eq(categories.isActive, true)))
        .orderBy(asc(categories.sortOrder), asc(categories.name));

      return {
        items: result
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/products", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const result = await db
        .select()
        .from(products)
        .where(and(eq(products.shopId, shop.id), eq(products.status, "active")))
        .orderBy(asc(products.sortOrder), desc(products.createdAt))
        .limit(100);

      return {
        items: result
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/products/:slug", async (request) => {
    const params = request.params as { slug: string };
    const { db, client, shop } = await getShopContext();

    try {
      const productRows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.shopId, shop.id),
            eq(products.slug, params.slug),
            eq(products.status, "active")
          )
        )
        .limit(1);

      const product = productRows[0];

      if (!product) {
        throw new HttpError(404, "Product not found");
      }

      const images = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id))
        .orderBy(asc(productImages.sortOrder));

      return {
        product,
        images
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/request-code", async (request, reply) => {
    const schema = z.object({
      phone: z.string().min(5),
      name: z.string().optional().default("")
    });

    const body = schema.parse(request.body ?? {});
    const phone = body.phone.trim();
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const customerRows = await client<{ id: string }[]>`
        SELECT id
        FROM customers
        WHERE shop_id = ${shop.id}
          AND phone = ${phone}
        LIMIT 1
      `;

      const customer = customerRows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message: "Клиент с таким телефоном не найден. Оформите первый заказ или проверьте номер."
        });
      }

      const code = createLoginCode();

      await client`
        INSERT INTO customer_login_codes (
          shop_id,
          customer_id,
          phone,
          code,
          expires_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${phone},
          ${code},
          NOW() + INTERVAL '10 minutes',
          NOW()
        )
      `;

      console.log(`[account-login] phone=${phone} code=${code}`);

      return {
        ok: true,
        message: "Код подтверждения создан"
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/verify-code", async (request, reply) => {
    const schema = z.object({
      phone: z.string().min(5),
      code: z.string().min(4).max(12)
    });

    const body = schema.parse(request.body ?? {});
    const phone = body.phone.trim();
    const code = body.code.trim();
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const loginRows = await client<{
        id: string;
        customer_id: string;
        code: string;
        attempts: number;
      }[]>`
        SELECT id, customer_id, code, attempts
        FROM customer_login_codes
        WHERE shop_id = ${shop.id}
          AND phone = ${phone}
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const login = loginRows[0];

      if (!login) {
        return reply.status(400).send({
          ok: false,
          message: "Код не найден или срок действия истёк"
        });
      }

      if (Number(login.attempts) >= 5) {
        return reply.status(400).send({
          ok: false,
          message: "Слишком много попыток. Запросите новый код."
        });
      }

      if (login.code !== code) {
        await client`
          UPDATE customer_login_codes
          SET attempts = attempts + 1
          WHERE id = ${login.id}
        `;

        return reply.status(400).send({
          ok: false,
          message: "Неверный код"
        });
      }

      const token = createSessionToken();

      await client`
        UPDATE customer_login_codes
        SET consumed_at = NOW()
        WHERE id = ${login.id}
      `;

      await client`
        INSERT INTO customer_sessions (
          shop_id,
          customer_id,
          token,
          user_agent,
          expires_at,
          last_seen_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${login.customer_id},
          ${token},
          ${String(request.headers["user-agent"] ?? "")},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

      const customerRows = await client`
        SELECT id, phone, name, email, bonus_balance, total_orders, total_spent, last_order_at
        FROM customers
        WHERE id = ${login.customer_id}
        LIMIT 1
      `;

      reply.header("Set-Cookie", buildCustomerSessionCookie(token));

      return {
        ok: true,
        customer: customerRows[0]
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/account/me", async (request, reply) => {
    const token = getCookieValue(request.headers.cookie, CUSTOMER_SESSION_COOKIE);

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход"
      });
    }

    const { client } = createDb();

    try {
      const sessionRows = await client<{ customer_id: string }[]>`
        SELECT customer_id
        FROM customer_sessions
        WHERE token = ${token}
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const session = sessionRows[0];

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Сессия истекла"
        });
      }

      await client`
        UPDATE customer_sessions
        SET last_seen_at = NOW()
        WHERE token = ${token}
      `;

      const customerRows = await client`
        SELECT id, phone, name, email, telegram_username, bonus_balance, total_orders, total_spent, last_order_at
        FROM customers
        WHERE id = ${session.customer_id}
        LIMIT 1
      `;

      const orders = await client`
        SELECT order_number, status, payment_status, total, bonus_spent, bonus_earned, tracking_token, created_at
        FROM orders
        WHERE customer_id = ${session.customer_id}
        ORDER BY created_at DESC
        LIMIT 20
      `;

      const bonuses = await client`
        SELECT type, amount, balance_after, comment, created_at
        FROM bonus_transactions
        WHERE customer_id = ${session.customer_id}
        ORDER BY created_at DESC
        LIMIT 20
      `;

      return {
        ok: true,
        customer: customerRows[0],
        orders,
        bonuses
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/auth/magic/:token", async (request, reply) => {
    const params = z.object({
      token: z.string().min(24)
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        return reply.redirect("/account");
      }

      const tokenRows = await client<{
        id: string;
        customer_id: string;
        order_id: string | null;
      }[]>`
        SELECT id, customer_id, order_id
        FROM customer_link_tokens
        WHERE shop_id = ${shop.id}
          AND provider = 'site'
          AND purpose = 'magic_login'
          AND token = ${params.token}
          AND status = 'pending'
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const loginToken = tokenRows[0];

      if (!loginToken) {
        return reply.redirect("/account");
      }

      const sessionToken = createSessionToken();

      await client`
        INSERT INTO customer_sessions (
          shop_id,
          customer_id,
          token,
          user_agent,
          expires_at,
          last_seen_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${loginToken.customer_id},
          ${sessionToken},
          ${String(request.headers["user-agent"] ?? "")},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

      await client`
        UPDATE customer_link_tokens
        SET status = 'consumed',
            consumed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${loginToken.id}
      `;

      let redirectUrl = "/account";

      if (loginToken.order_id) {
        const orderRows = await client<{ tracking_token: string | null }[]>`
          SELECT tracking_token
          FROM orders
          WHERE id = ${loginToken.order_id}
            AND customer_id = ${loginToken.customer_id}
          LIMIT 1
        `;

        const order = orderRows[0];

        if (order?.tracking_token) {
          redirectUrl = `/order/track/${order.tracking_token}`;
        }
      }

      reply.header("Set-Cookie", buildCustomerSessionCookie(sessionToken));
      return reply.redirect(redirectUrl);
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/logout", async (request, reply) => {
    const token = getCookieValue(request.headers.cookie, CUSTOMER_SESSION_COOKIE);

    if (token) {
      const { client } = createDb();

      try {
        await client`
          UPDATE customer_sessions
          SET revoked_at = NOW()
          WHERE token = ${token}
        `;
      } finally {
        await client.end();
      }
    }

    reply.header("Set-Cookie", clearCustomerSessionCookie());

    return {
      ok: true
    };
  });


  app.post("/api/public/bonus/check", async (request, reply) => {
    const schema = z.object({
      amount: z.coerce.number().int().min(0)
    });

    const body = schema.parse(request.body ?? {});
    const token = getCookieValue(request.headers.cookie, CUSTOMER_SESSION_COOKIE);

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Войдите в личный кабинет, чтобы использовать бонусы"
      });
    }

    const { client } = createDb();

    try {
      const sessionRows = await client<{ customer_id: string }[]>`
        SELECT customer_id
        FROM customer_sessions
        WHERE token = ${token}
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const session = sessionRows[0];

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Сессия истекла. Войдите снова."
        });
      }

      const customerRows = await client<{
        id: string;
        phone: string;
        name: string | null;
        bonus_balance: number;
      }[]>`
        SELECT id, phone, name, bonus_balance
        FROM customers
        WHERE id = ${session.customer_id}
        LIMIT 1
      `;

      const customer = customerRows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message: "Покупатель не найден"
        });
      }

      const balance = Number(customer.bonus_balance || 0);
      const maxSpend = Math.min(balance, Math.floor(body.amount * 0.3), body.amount);

      return {
        ok: true,
        customer: {
          id: customer.id,
          phone: customer.phone,
          name: customer.name
        },
        bonus: {
          balance,
          maxSpend
        }
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/promocodes/check", async (request, reply) => {
    const schema = z.object({
      code: z.string().min(1),
      subtotal: z.coerce.number().int().min(0)
    });

    const body = schema.parse(request.body ?? {});
    const code = normalizePromoCode(body.code);
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const rows = await client<{
        id: string;
        code: string;
        discount_type: string;
        discount_value: number;
        min_order_amount: number | null;
        usage_limit: number | null;
        used_count: number;
      }[]>`
        SELECT id, code, discount_type, discount_value, min_order_amount, usage_limit, used_count
        FROM promocodes
        WHERE shop_id = ${shop.id}
          AND UPPER(code) = ${code}
          AND is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        LIMIT 1
      `;

      const promo = rows[0];

      if (!promo) {
        return reply.status(404).send({
          ok: false,
          message: "Промокод не найден или уже не действует"
        });
      }

      if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
        return reply.status(400).send({
          ok: false,
          message: "Лимит использования промокода исчерпан"
        });
      }

      if (promo.min_order_amount !== null && body.subtotal < promo.min_order_amount) {
        return reply.status(400).send({
          ok: false,
          message: `Минимальная сумма заказа для промокода — ${promo.min_order_amount} ₽`
        });
      }

      const discountTotal = calculateDiscount({
        subtotal: body.subtotal,
        discountType: promo.discount_type,
        discountValue: Number(promo.discount_value)
      });

      return {
        ok: true,
        promo: {
          id: promo.id,
          code: promo.code,
          discountType: promo.discount_type,
          discountValue: promo.discount_value,
          discountTotal
        }
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/orders/track/:token", async (request, reply) => {
    const params = z.object({
      token: z.string().min(16)
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const orderRows = await client<{
        id: string;
        order_number: string;
        status: string;
        payment_status: string;
        payment_method: string;
        delivery_type: string;
        delivery_date: string | null;
        delivery_address_text: string | null;
        delivery_comment: string | null;
        recipient_name: string | null;
        recipient_phone: string | null;
        customer_comment: string | null;
        subtotal: number;
        discount_total: number;
        delivery_price: number;
        bonus_spent: number;
        bonus_earned: number;
        total: number;
        tracking_token: string;
        bouquet_photo_url: string | null;
        created_at: string;
        updated_at: string;
        customer_name: string | null;
        customer_phone: string | null;
      }[]>`
        SELECT
          o.id,
          o.order_number,
          o.status,
          o.payment_status,
          o.payment_method,
          o.delivery_type,
          o.delivery_date,
          o.delivery_address_text,
          o.delivery_comment,
          o.recipient_name,
          o.recipient_phone,
          o.customer_comment,
          o.subtotal,
          o.discount_total,
          o.delivery_price,
          o.bonus_spent,
          o.bonus_earned,
          o.total,
          o.tracking_token,
          o.bouquet_photo_url,
          o.created_at,
          o.updated_at,
          c.name AS customer_name,
          c.phone AS customer_phone
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.tracking_token = ${params.token}
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
          total
        FROM order_items
        WHERE order_id = ${order.id}
        ORDER BY created_at ASC
      `;

      const payments = await client`
        SELECT
          provider,
          method,
          status,
          amount,
          currency,
          payment_url,
          paid_at,
          created_at
        FROM payments
        WHERE order_id = ${order.id}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      return {
        ok: true,
        order: {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status,
          paymentStatus: order.payment_status,
          paymentMethod: order.payment_method,
          deliveryType: order.delivery_type,
          deliveryDate: order.delivery_date,
          deliveryInterval: order.delivery_comment,
          deliveryAddress: order.delivery_address_text,
          recipientName: order.recipient_name,
          recipientPhone: order.recipient_phone,
          customerName: order.customer_name,
          customerPhone: order.customer_phone,
          customerComment: order.customer_comment,
          subtotal: Number(order.subtotal || 0),
          discountTotal: Number(order.discount_total || 0),
          deliveryPrice: Number(order.delivery_price || 0),
          bonusSpent: Number(order.bonus_spent || 0),
          bonusEarned: Number(order.bonus_earned || 0),
          total: Number(order.total || 0),
          trackingToken: order.tracking_token,
          bouquetPhotoUrl: order.bouquet_photo_url,
          createdAt: order.created_at,
          updatedAt: order.updated_at
        },
        items: items.map((item: any) => ({
          productId: item.product_id,
          name: item.product_name,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          total: Number(item.total || 0)
        })),
        payment: payments[0] || null
      };
    } finally {
      await client.end();
    }
  });


  app.post("/api/public/orders", async (request, reply) => {
    const body = createOrderSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const productsMap = new Map<string, {
        id: string;
        name: string;
        price: number;
      }>();

      for (const item of body.items) {
        const rows = await client<{ id: string; name: string; price: number }[]>`
          SELECT id, name, price
          FROM products
          WHERE shop_id = ${shop.id}
            AND id = ${item.productId}
            AND status = 'active'
          LIMIT 1
        `;

        const product = rows[0];

        if (!product) {
          throw new HttpError(400, "Product not found or inactive");
        }

        productsMap.set(product.id, {
          id: product.id,
          name: product.name,
          price: Number(product.price)
        });
      }

      const subtotalAmount = body.items.reduce((sum, item) => {
        const product = productsMap.get(item.productId);
        return sum + Number(product?.price ?? 0) * item.quantity;
      }, 0);

      let deliveryPrice = 0;

      if (body.deliveryZoneId) {
        const zoneRows = await client<{ price: number }[]>`
          SELECT price
          FROM delivery_zones
          WHERE shop_id = ${shop.id}
            AND id = ${body.deliveryZoneId}
            AND is_active = true
          LIMIT 1
        `;

        deliveryPrice = Number(zoneRows[0]?.price ?? 0);
      }

      let discountTotal = 0;
      let promoId: string | null = null;
      const promoCode = normalizePromoCode(body.promoCode || "");

      if (promoCode) {
        const promoRows = await client<{
          id: string;
          discount_type: string;
          discount_value: number;
          min_order_amount: number | null;
          usage_limit: number | null;
          used_count: number;
        }[]>`
          SELECT id, discount_type, discount_value, min_order_amount, usage_limit, used_count
          FROM promocodes
          WHERE shop_id = ${shop.id}
            AND UPPER(code) = ${promoCode}
            AND is_active = true
            AND (starts_at IS NULL OR starts_at <= NOW())
            AND (ends_at IS NULL OR ends_at >= NOW())
          LIMIT 1
        `;

        const promo = promoRows[0];

        if (!promo) {
          throw new HttpError(400, "Промокод не найден или уже не действует");
        }

        if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
          throw new HttpError(400, "Лимит использования промокода исчерпан");
        }

        if (promo.min_order_amount !== null && subtotalAmount < promo.min_order_amount) {
          throw new HttpError(400, `Минимальная сумма заказа для промокода — ${promo.min_order_amount} ₽`);
        }

        promoId = promo.id;
        discountTotal = calculateDiscount({
          subtotal: subtotalAmount,
          discountType: promo.discount_type,
          discountValue: Number(promo.discount_value)
        });
      }

      const amountBeforeBonus = Math.max(0, subtotalAmount + deliveryPrice - discountTotal);
      let bonusSpent = 0;
      let totalAmount = amountBeforeBonus;
      const orderNumber = createOrderNumber();
      const trackingToken = createTrackingToken();

      const customerRows = await client<{ id: string; bonus_balance: number }[]>`
        INSERT INTO customers (
          shop_id,
          phone,
          name,
          total_orders,
          total_spent,
          last_order_at,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${body.customerPhone},
          ${body.customerName},
          0,
          0,
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, phone)
        DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
          updated_at = NOW()
        RETURNING id, bonus_balance
      `;

      const customer = customerRows[0];

      if (!customer?.id) {
        throw new HttpError(500, "Customer was not created");
      }

      const requestedBonusSpend = Math.max(0, Math.floor(Number(body.bonusToSpend || 0)));

      if (requestedBonusSpend > 0) {
        const token = getCookieValue(request.headers.cookie, CUSTOMER_SESSION_COOKIE);

        if (!token) {
          throw new HttpError(401, "Войдите в личный кабинет, чтобы использовать бонусы");
        }

        const sessionRows = await client<{ customer_id: string }[]>`
          SELECT customer_id
          FROM customer_sessions
          WHERE token = ${token}
            AND revoked_at IS NULL
            AND expires_at > NOW()
          LIMIT 1
        `;

        const session = sessionRows[0];

        if (!session || session.customer_id !== customer.id) {
          throw new HttpError(403, "Бонусы можно списать только со своего профиля");
        }

        const freshCustomerRows = await client<{ bonus_balance: number }[]>`
          SELECT bonus_balance
          FROM customers
          WHERE id = ${customer.id}
          LIMIT 1
        `;

        const balance = Number(freshCustomerRows[0]?.bonus_balance || 0);
        const maxBonusSpend = Math.min(balance, Math.floor(amountBeforeBonus * 0.3), amountBeforeBonus);

        bonusSpent = Math.min(requestedBonusSpend, maxBonusSpend);
        totalAmount = Math.max(0, amountBeforeBonus - bonusSpent);
      }

      const orderRows = await client<{ id: string }[]>`
        INSERT INTO orders (
          shop_id,
          customer_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          delivery_zone_id,
          delivery_date,
          delivery_address_text,
          delivery_comment,
          recipient_name,
          recipient_phone,
          customer_comment,
          subtotal,
          discount_total,
          delivery_price,
          bonus_spent,
          bonus_earned,
          total,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${orderNumber},
          'new',
          'pending',
          ${body.paymentMethod},
          ${body.deliveryType},
          ${body.deliveryZoneId || null},
          ${body.deliveryDate || null},
          ${body.deliveryAddress},
          ${body.deliveryIntervalText},
          ${body.recipientName || body.customerName},
          ${body.recipientPhone || body.customerPhone},
          ${body.customerComment},
          ${subtotalAmount},
          ${discountTotal},
          ${deliveryPrice},
          ${bonusSpent},
          0,
          ${totalAmount},
          ${trackingToken},
          ${JSON.stringify({ promoCode: promoCode || null })},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      const order = orderRows[0];

      if (!order?.id) {
        throw new HttpError(500, "Order was not created");
      }

      for (const item of body.items) {
        const product = productsMap.get(item.productId);

        if (!product) continue;

        const quantity = item.quantity;
        const unitPrice = Number(product.price);
        const itemTotal = unitPrice * quantity;

        await client`
          INSERT INTO order_items (
            shop_id,
            order_id,
            product_id,
            product_name,
            product_snapshot,
            quantity,
            price,
            total,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${order.id},
            ${product.id},
            ${product.name},
            ${JSON.stringify({ id: product.id, name: product.name, price: unitPrice })},
            ${quantity},
            ${unitPrice},
            ${itemTotal},
            NOW(),
            NOW()
          )
        `;
      }

      if (promoId) {
        await client`
          UPDATE promocodes
          SET used_count = used_count + 1,
              updated_at = NOW()
          WHERE id = ${promoId}
        `;
      }

      const updatedCustomerRows = await client<{ bonus_balance: number }[]>`
        UPDATE customers
        SET total_orders = total_orders + 1,
            total_spent = total_spent + ${totalAmount},
            bonus_balance = bonus_balance - ${bonusSpent},
            last_order_at = NOW(),
            updated_at = NOW()
        WHERE id = ${customer.id}
        RETURNING bonus_balance
      `;

      if (bonusSpent > 0) {
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
            ${customer.id},
            ${order.id},
            'spend',
            ${-bonusSpent},
            ${Number(updatedCustomerRows[0]?.bonus_balance ?? 0)},
            ${`Списание бонусов в заказе ${orderNumber}`},
            NOW()
          )
        `;
      }

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
            'order_created',
            'telegram',
            'staff',
            'pending',
            ${JSON.stringify({
              orderId: order.id,
              orderNumber,
              status: "new",
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              recipientName: body.recipientName || body.customerName,
              recipientPhone: body.recipientPhone || body.customerPhone,
              totalAmount,
              discountTotal,
              bonusSpent,
              deliveryType: body.deliveryType,
              deliveryDate: body.deliveryDate || null,
              trackingToken,
              trackingUrl: `/order/track/${trackingToken}`
            })},
            NOW(),
            NOW()
          )
        `;

      const telegramLinkToken = createCustomerLinkToken();

      await client`
        INSERT INTO customer_link_tokens (
          shop_id, customer_id, order_id, provider, purpose,
          token, status, expires_at, metadata, created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${customer.id}, ${order.id}, 'telegram', 'connect_channel',
          ${telegramLinkToken}, 'pending', NOW() + INTERVAL '7 days',
          ${JSON.stringify({ source: "site_order_success", orderNumber })},
          NOW(), NOW()
        )
      `;

      return reply.status(201).send({
        ok: true,
        order: {
          id: order.id,
          orderNumber,
          status: "new",
          totalAmount,
          discountTotal,
          bonusSpent,
          promoCode,
          trackingToken,
          telegramLinkUrl: telegramBotDeepLink(telegramLinkToken)
        }
      });
    } catch (error) {
      throw error;
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/delivery", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const zones = await db
        .select()
        .from(deliveryZones)
        .where(and(eq(deliveryZones.shopId, shop.id), eq(deliveryZones.isActive, true)))
        .orderBy(asc(deliveryZones.sortOrder));

      const intervals = await db
        .select()
        .from(deliveryIntervals)
        .where(and(eq(deliveryIntervals.shopId, shop.id), eq(deliveryIntervals.isActive, true)))
        .orderBy(asc(deliveryIntervals.sortOrder));

      return {
        zones,
        intervals
      };
    } finally {
      await client.end();
    }
  });
}
