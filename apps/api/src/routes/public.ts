import type { FastifyInstance } from "fastify";
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
