import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb } from "../src/client";
import {
  deliveryIntervals,
  deliveryZones,
  shopDomains,
  shops,
  shopSettings
} from "../src/schema";

const { db, client } = createDb();

try {
  const existing = await db
    .select()
    .from(shops)
    .where(eq(shops.slug, "viberimenya"))
    .limit(1);

  let shopId = existing[0]?.id;

  if (!shopId) {
    const inserted = await db
      .insert(shops)
      .values({
        slug: "viberimenya",
        name: "ВЫБЕРИ МЕНЯ",
        legalName: "ВЫБЕРИ МЕНЯ",
        status: "active",
        timezone: "Europe/Moscow",
        currency: "RUB"
      })
      .returning();

    shopId = inserted[0]!.id;

    await db.insert(shopSettings).values({
      shopId,
      primaryColor: "#7c3aed",
      accentColor: "#f43f5e",
      phone: "",
      whatsapp: "",
      telegram: "",
      instagram: "",
      address: "",
      workHours: "",
      heroTitle: "Цветы, которые говорят за вас",
      heroSubtitle: "Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю.",
      isOnlinePaymentEnabled: false,
      isCashPaymentEnabled: true,
      isTransferPaymentEnabled: true
    });

    await db.insert(shopDomains).values({
      shopId,
      domain: "45.88.172.241",
      isPrimary: true
    });

    await db.insert(deliveryZones).values([
      {
        shopId,
        name: "Самовывоз",
        description: "Получение заказа в магазине",
        price: 0,
        isExpressAvailable: false,
        isActive: true,
        sortOrder: 10
      },
      {
        shopId,
        name: "Доставка по городу",
        description: "Базовая зона доставки",
        price: 500,
        freeFromAmount: 10000,
        isExpressAvailable: true,
        expressPrice: 900,
        isActive: true,
        sortOrder: 20
      }
    ]);

    await db.insert(deliveryIntervals).values([
      { shopId, name: "10:00–13:00", startsAt: "10:00", endsAt: "13:00", sortOrder: 10 },
      { shopId, name: "13:00–16:00", startsAt: "13:00", endsAt: "16:00", sortOrder: 20 },
      { shopId, name: "16:00–19:00", startsAt: "16:00", endsAt: "19:00", sortOrder: 30 },
      { shopId, name: "19:00–22:00", startsAt: "19:00", endsAt: "22:00", sortOrder: 40 }
    ]);

    console.log("Initial shop created: ВЫБЕРИ МЕНЯ");
  } else {
    console.log("Initial shop already exists: ВЫБЕРИ МЕНЯ");
  }
} finally {
  await client.end();
}
