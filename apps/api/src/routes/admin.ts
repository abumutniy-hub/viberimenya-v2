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

  app.get("/api/admin/orders", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client`
        SELECT *
        FROM orders
        WHERE shop_id = ${shop.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return { shop, items };
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
