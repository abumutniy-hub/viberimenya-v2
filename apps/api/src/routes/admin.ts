import type { FastifyInstance } from "fastify";
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
