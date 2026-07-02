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

  app.post("/api/public/bonus/check", async (_request, reply) => {
    return reply.status(403).send({
      ok: false,
      message: "Бонусы доступны только после подтверждения телефона в личном кабинете"
    });
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
      const bonusSpent = 0;
      const totalAmount = amountBeforeBonus;
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

      await client`
        UPDATE customers
        SET total_orders = total_orders + 1,
            total_spent = total_spent + ${totalAmount},
            last_order_at = NOW(),
            updated_at = NOW()
        WHERE id = ${customer.id}
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
          trackingToken
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
