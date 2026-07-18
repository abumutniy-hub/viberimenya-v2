import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import {
  inferProductType,
  mergeCatalogMetadata
} from "../lib/catalog-product";

type ProductRow = {
  id: string;
  name: string;
  category_name: string | null;
  category_slug: string | null;
  composition: string | null;
  metadata: unknown;
};

type UnknownRecord = Record<string, unknown>;

const TEST_CATEGORY_ID = "3345ff2e-cd6a-4e70-a910-7a42cffcb69a";
const TEST_PRODUCT_IDS = [
  "54d7bb9b-fc03-4aea-bf15-76e096996a70",
  "6ba05e24-075c-4217-b448-eb96aa0c49b3"
] as const;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSentence(value: string, max = 190) {
  if (value.length <= max) {
    return value;
  }

  const shortened = value.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

function lowerFirst(value: string) {
  return value.replace(/^([А-ЯЁ])/, (letter) => letter.toLocaleLowerCase("ru-RU"));
}

function categoryPhrase(categoryName: string | null) {
  const name = clean(categoryName);
  return name ? `из раздела «${name}»` : "из ассортимента магазина";
}

function generatedDescriptions(product: ProductRow) {
  const name = clean(product.name) || "Товар";
  const composition = clean(product.composition)
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\.{2,}/g, ".")
    .trim();
  const productType = inferProductType(
    product.metadata,
    product.category_name,
    product.category_slug,
    name,
    composition
  );
  const section = categoryPhrase(product.category_name);
  const compositionSentence = composition
    ? `Состав: ${composition.replace(/[.!?]+$/, "")}.`
    : "";

  let shortDescription: string;
  let description: string;

  switch (productType) {
    case "bouquet":
      shortDescription = composition
        ? `${name}: ${lowerFirst(composition.replace(/[.!?]+$/, ""))}. Собираем вручную к выбранной дате.`
        : `${name} — букет ${section}, который флорист соберёт вручную к выбранной дате.`;
      description = `«${name}» — букет ${section}. ${compositionSentence} Флорист собирает заказ вручную к выбранной дате и сохраняет заявленный стиль композиции. Перед отправкой можно получить фотографию готового заказа; оттенки отдельных цветов и упаковки могут немного отличаться из-за сезонных поставок.`;
      break;

    case "arrangement":
      shortDescription = composition
        ? `${name}: ${lowerFirst(composition.replace(/[.!?]+$/, ""))}. Готовая композиция для вручения.`
        : `${name} — цветочная композиция ${section}, собранная в корзине, коробке или декоративной основе.`;
      description = `«${name}» — готовая цветочная композиция ${section}. ${compositionSentence} Флорист подготовит её к выбранной дате, аккуратно закрепит цветы и сохранит форму при доставке. Возможны небольшие сезонные отличия в оттенках и деталях оформления без снижения ценности заказа.`;
      break;

    case "flowers":
      shortDescription = composition
        ? `${name}: ${lowerFirst(composition.replace(/[.!?]+$/, ""))}. Подготавливаем к выбранной дате.`
        : `${name} — свежие цветы ${section}, подготовленные флористом к выбранной дате.`;
      description = `«${name}» — цветочная позиция ${section}. ${compositionSentence} Цветы подготавливаются флористом непосредственно к выбранной дате. Оттенок, степень раскрытия бутонов и отдельные природные особенности могут немного различаться, поскольку каждый цветок уникален.`;
      break;

    case "card":
      shortDescription = `${name} — открытка, которую можно добавить к заказу и подписать для получателя.`;
      description = `«${name}» — открытка ${section}. Добавьте её к цветочному заказу и укажите текст пожелания в комментарии. Менеджер подтвердит оформление и передаст подпись получателю вместе с заказом.`;
      break;

    case "sweets":
      shortDescription = `${name} — сладкое дополнение к цветам или самостоятельному подарку.`;
      description = `«${name}» — сладкое дополнение ${section}. Его можно добавить к букету или композиции, чтобы сделать подарок более полным. Состав упаковки и актуальный срок годности проверяются перед передачей заказа.`;
      break;

    case "toy":
      shortDescription = `${name} — мягкая игрушка для дополнения цветочного заказа.`;
      description = `«${name}» — подарочная игрушка ${section}. Её можно добавить к букету, композиции или вручить как отдельный подарок. Перед отправкой товар проверяется на внешний вид и аккуратно упаковывается вместе с заказом.`;
      break;

    case "balloon":
      shortDescription = `${name} — воздушные шары для поздравления и праздничного оформления.`;
      description = `«${name}» — праздничная позиция ${section}. Шары можно добавить к цветочному заказу или заказать как самостоятельное поздравление. Менеджер уточнит доступные оттенки, количество и детали оформления перед подтверждением.`;
      break;

    case "vase":
      shortDescription = `${name} — ваза, которую можно добавить к букету или композиции.`;
      description = `«${name}» — практичное дополнение ${section}. Ваза поможет сразу поставить цветы в воду после вручения. Менеджер проверит совместимость размера с выбранным букетом и подтвердит наличие.`;
      break;

    case "perfume":
      shortDescription = `${name} — подарочная позиция, которую можно добавить к основному заказу.`;
      description = `«${name}» — подарочная позиция ${section}. Её можно дополнить букетом, открыткой или другим товаром. Перед подтверждением заказа менеджер проверит наличие и уточнит характеристики позиции.`;
      break;

    case "gift":
      shortDescription = `${name} — подарок, который можно добавить к цветам или заказать отдельно.`;
      description = `«${name}» — подарочная позиция ${section}. Она дополнит букет или композицию и сделает поздравление более личным. Перед отправкой товар проверяется и аккуратно упаковывается вместе с заказом.`;
      break;

    default:
      shortDescription = `${name} — товар ${section} с актуальной ценой и подтверждением наличия.`;
      description = `«${name}» — товар ${section}. ${compositionSentence} Менеджер проверит наличие, характеристики и детали оформления при подтверждении заказа. Позицию можно добавить к цветам или заказать отдельно, если это предусмотрено её форматом.`;
      break;
  }

  return {
    shortDescription: trimSentence(shortDescription),
    description: description.replace(/\s+/g, " ").trim(),
    productType
  };
}

async function main() {
  const { client } = createDb();
  const reportPath = process.env.VM_CATALOG_REPORT || "";

  try {
    const shops = await client<{ id: string }[]>`
      SELECT id
      FROM shops
      WHERE slug = ${env.DEFAULT_SHOP_SLUG}
      LIMIT 1
    `;
    const shop = shops[0];

    if (!shop) {
      throw new Error("Магазин не найден");
    }

    const report = {
      startedAt: new Date().toISOString(),
      deletedTestCategory: false,
      deletedTestProducts: 0,
      productsPublished: 0,
      categoriesEnabled: 0,
      descriptionsGenerated: 0,
      uncategorizedProducts: 0,
      subscriptionProductsHidden: 0
    };

    await client.begin(async (sql) => {
      const testCategories = await sql<{
        id: string;
        name: string;
        slug: string;
      }[]>`
        SELECT id, name, slug
        FROM categories
        WHERE id = ${TEST_CATEGORY_ID}
          AND shop_id = ${shop.id}
        FOR UPDATE
      `;

      if (testCategories[0]) {
        const testCategory = testCategories[0];

        if (
          testCategory.name.trim().toLocaleLowerCase("ru-RU") !== "букеты"
          || testCategory.slug.trim().toLocaleLowerCase("ru-RU") !== "bukety"
        ) {
          throw new Error("Контрольный ID больше не принадлежит тестовой категории «Букеты»");
        }

        const deletedProducts = await sql<{ id: string }[]>`
          DELETE FROM products
          WHERE shop_id = ${shop.id}
            AND category_id = ${TEST_CATEGORY_ID}
            AND id IN (
              ${TEST_PRODUCT_IDS[0]}::uuid,
              ${TEST_PRODUCT_IDS[1]}::uuid
            )
          RETURNING id
        `;

        const unexpectedProducts = await sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM products
          WHERE shop_id = ${shop.id}
            AND category_id = ${TEST_CATEGORY_ID}
        `;

        if (Number(unexpectedProducts[0]?.count || 0) > 0) {
          throw new Error("В тестовой категории появились дополнительные товары; автоматическое удаление остановлено");
        }

        await sql`
          DELETE FROM categories
          WHERE id = ${TEST_CATEGORY_ID}
            AND shop_id = ${shop.id}
        `;

        report.deletedTestCategory = true;
        report.deletedTestProducts = deletedProducts.length;
      }

      const categoriesEnabled = await sql<{ id: string }[]>`
        UPDATE categories
        SET
          is_active = CASE
            WHEN name ~* 'подписка.*цвет'
              OR slug ~* 'podpiska|subscription'
              THEN false
            ELSE true
          END,
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
        RETURNING id
      `;
      report.categoriesEnabled = categoriesEnabled.length;

      const products = await sql<ProductRow[]>`
        SELECT
          p.id,
          p.name,
          c.name AS category_name,
          c.slug AS category_slug,
          p.composition,
          p.metadata
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
        WHERE p.shop_id = ${shop.id}
        ORDER BY p.created_at ASC
      `;

      for (const product of products) {
        const generated = generatedDescriptions(product);
        const currentRoot = asRecord(product.metadata);
        const metadata = {
          ...mergeCatalogMetadata(product.metadata, {
            availability: "available",
            productType: generated.productType
          }),
          catalog: {
            ...asRecord(asRecord(
              mergeCatalogMetadata(product.metadata, {
                availability: "available",
                productType: generated.productType
              })
            ).catalog),
            descriptionSource: "generated-16g",
            descriptionGeneratedAt: new Date().toISOString()
          },
          import: asRecord(currentRoot.import)
        };

        await sql`
          UPDATE products
          SET
            short_description = ${generated.shortDescription},
            description = ${generated.description},
            status = 'active',
            stock_quantity = GREATEST(COALESCE(stock_quantity, 0), 1),
            is_stock_visible = false,
            metadata = ${JSON.stringify(metadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${product.id}
            AND shop_id = ${shop.id}
        `;

        report.productsPublished += 1;
        report.descriptionsGenerated += 1;

        if (!product.category_name) {
          report.uncategorizedProducts += 1;
        }

        if (
          /подписка.*цвет/i.test(product.category_name || "")
          || /podpiska|subscription/i.test(product.category_slug || "")
        ) {
          report.subscriptionProductsHidden += 1;
        }
      }
    });

    const output = {
      ...report,
      completedAt: new Date().toISOString()
    };

    if (reportPath) {
      await writeFile(reportPath, JSON.stringify(output, null, 2), "utf8");
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ...output,
      reportPath: reportPath || null
    })}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
