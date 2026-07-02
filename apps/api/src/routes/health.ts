import type { FastifyInstance } from "fastify";
import { createDb, shops } from "@viberimenya/db";
import { env } from "../lib/env";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    const { db, client } = createDb();

    try {
      const shopCount = await db.select().from(shops).limit(1);

      return {
        ok: true,
        service: "viberimenya-api-v2",
        appName: env.APP_NAME,
        environment: env.NODE_ENV,
        database: "ok",
        shopExists: shopCount.length > 0,
        time: new Date().toISOString()
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/health", async () => {
    return {
      ok: true,
      area: "admin",
      message: "Admin API placeholder is ready",
      time: new Date().toISOString()
    };
  });
}
