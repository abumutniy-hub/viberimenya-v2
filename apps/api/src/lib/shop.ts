import { eq } from "drizzle-orm";
import { createDb, shops } from "@viberimenya/db";
import { env } from "./env";

export async function getDefaultShop() {
  const { db, client } = createDb();

  try {
    const result = await db
      .select()
      .from(shops)
      .where(eq(shops.slug, env.DEFAULT_SHOP_SLUG))
      .limit(1);

    return result[0] ?? null;
  } finally {
    await client.end();
  }
}
