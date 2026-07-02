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

  app.post("/api/public/orders", async (request, reply) => {
    const body = createOrderSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id FROM shops WHERE slug = ${env.DEFAULT_SHOP_SLUG} LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const productsMap = new Map<string, { id: string; name: string; price: number }>();

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

      const totalAmount = subtotalAmount + deliveryPrice;
      const orderNumber = createOrderNumber();
      const trackingToken = createTrackingToken();

      await client`BEGIN`;

      const orderRows = await client`
        INSERT INTO orders (
          shop_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          customer_name,
          customer_phone,
          recipient_name,
          recipient_phone,
          delivery_address,
          delivery_date,
          delivery_interval_text,
          delivery_zone_id,
          delivery_price,
          subtotal_amount,
          discount_amount,
          bonus_spent_amount,
          total_amount,
          customer_comment,
          source,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${orderNumber},
          'new',
          'pending',
          ${body.paymentMethod},
          ${body.deliveryType},
          ${body.customerName},
          ${body.customerPhone},
          ${body.recipientName || body.customerName},
          ${body.recipientPhone || body.customerPhone},
          ${body.deliveryAddress},
          ${body.deliveryDate || null},
          ${body.deliveryIntervalText},
          ${body.deliveryZoneId || null},
          ${deliveryPrice},
          ${subtotalAmount},
          0,
          0,
          ${totalAmount},
          ${body.customerComment},
          'site',
          ${trackingToken},
          ${JSON.stringify({})},
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      const order = orderRows[0];

      if (!order?.id) {
        throw new HttpError(500, "Order was not created");
      }

      const orderId = String(order.id);

      for (const item of body.items) {
        const product = productsMap.get(item.productId);

        if (!product) continue;

        const quantity = item.quantity;
        const unitPrice = Number(product.price);
        const totalPrice = unitPrice * quantity;

        await client`
          INSERT INTO order_items (
            shop_id,
            order_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            total_price,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${orderId},
            ${product.id},
            ${product.name},
            ${quantity},
            ${unitPrice},
            ${totalPrice},
            NOW(),
            NOW()
          )
        `;
      }

      await client`COMMIT`;

      return reply.status(201).send({
        ok: true,
        order: {
          id: orderId,
          orderNumber,
          status: "new",
          totalAmount,
          trackingToken
        }
      });
    } catch (error) {
      await client`ROLLBACK`.catch(() => undefined);
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
