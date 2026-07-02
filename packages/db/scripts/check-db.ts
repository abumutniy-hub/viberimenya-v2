import "dotenv/config";
import { shops } from "../src/schema";
import { createDb } from "../src/client";

const { db, client } = createDb();

try {
  const result = await db.select().from(shops).limit(10);

  console.log("DB connection: OK");
  console.log(`Shops found: ${result.length}`);

  for (const shop of result) {
    console.log(`- ${shop.slug}: ${shop.name} (${shop.status})`);
  }
} finally {
  await client.end();
}
