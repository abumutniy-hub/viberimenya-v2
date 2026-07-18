import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import {
  inferProductType,
  mergeCatalogMetadata,
  readCatalogMetadata,
  resolveProductAvailability
} from "../lib/catalog-product";

type ProductRow = {
  id: string;
  name: string;
  category_name: string | null;
  category_slug: string | null;
  short_description: string | null;
  description: string | null;
  composition: string | null;
  price: number;
  old_price: number | null;
  stock_quantity: number | null;
  metadata: unknown;
};

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
};

const categoryDescriptions: Array<{
  pattern: RegExp;
  text: string;
}> = [
  {
    pattern: /авторск.*букет/i,
    text: "Уникальные композиции, которые флористы собирают вручную из сезонных цветов к выбранной дате."
  },
  {
    pattern: /монобукет/i,
    text: "Букеты из одного вида цветов — лаконичный подарок с выразительным цветом и формой."
  },
  {
    pattern: /корзин|короб/i,
    text: "Цветочные композиции в корзинах и декоративных коробках, готовые к вручению получателю."
  },
  {
    pattern: /роз/i,
    text: "Классические и необычные композиции из роз разных оттенков, сортов и размеров."
  },
  {
    pattern: /пион/i,
    text: "Сезонные композиции из пионов и букеты с их участием в нежной цветовой гамме."
  },
  {
    pattern: /тюльпан/i,
    text: "Свежие тюльпаны и сезонные букеты для весенних праздников и тёплых знаков внимания."
  },
  {
    pattern: /гортенз/i,
    text: "Объёмные букеты и композиции с гортензиями в спокойных и ярких оттенках."
  },
  {
    pattern: /гвоздик/i,
    text: "Стойкие гвоздики в монобукетах и авторских композициях разных оттенков."
  },
  {
    pattern: /открытк|конверт/i,
    text: "Открытки и конверты, которые можно добавить к заказу и подписать для получателя."
  },
  {
    pattern: /конфет|сладост|шоколад/i,
    text: "Сладкие дополнения к цветам для полноценного подарка."
  },
  {
    pattern: /игруш/i,
    text: "Мягкие игрушки, которые можно добавить к букету или подарить отдельно."
  },
  {
    pattern: /шар/i,
    text: "Воздушные шары и праздничные наборы для поздравления и оформления события."
  },
  {
    pattern: /подар/i,
    text: "Подарки и приятные дополнения, которые сделают заказ более личным."
  }
];

function decodeEntities(value: string) {
  return value
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanProductName(value: unknown) {
  const decoded = decodeEntities(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return decoded.replace(
    /^([а-яё])/,
    (letter) => letter.toLocaleUpperCase("ru-RU")
  );
}

function normalizedWords(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/giu, " ")
    .trim();
}

function cleanText(value: unknown, productName: string) {
  const original = String(value ?? "").trim();

  if (!original) {
    return "";
  }

  let text = decodeEntities(original)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*/g, ". ")
    .trim();

  text = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !(
      /заказать цветы|доставка цветов|доставк[а-я]* недорого|по россии|бесплатн/i
        .test(sentence)
    ))
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?]){2,}/g, "$1")
    .trim();

  const normalizedText = normalizedWords(text);
  const normalizedName = normalizedWords(productName);
  const withoutGenericPrefix = normalizedText.replace(
    /^(розы|цветы|букеты|композиции|подарки)\s+/,
    ""
  );

  if (
    /^\d+(?:[.,]\d+)?$/.test(text)
    || normalizedText === normalizedName
    || withoutGenericPrefix === normalizedName
  ) {
    return "";
  }

  return text;
}

function generatedShortDescription(product: ProductRow) {
  const type = inferProductType(
    product.metadata,
    product.category_name,
    product.category_slug,
    product.name,
    product.composition
  );

  if (type === "card") {
    return "Открытка, которую можно добавить к заказу и подписать для получателя.";
  }

  if (type === "sweets") {
    return "Сладкое дополнение к букету или самостоятельному подарку.";
  }

  if (type === "toy") {
    return "Мягкая игрушка для дополнения цветочного заказа.";
  }

  if (type === "balloon") {
    return "Воздушные шары для праздничного поздравления и оформления события.";
  }

  if (type === "gift" || type === "vase" || type === "perfume") {
    return "Подарочное дополнение, которое можно добавить к основному заказу.";
  }

  if (product.composition?.trim()) {
    return "Композиция, собранная вручную флористом к выбранной дате.";
  }

  return "Цветочная композиция, подготовленная к выбранной дате и интервалу доставки.";
}

function generatedDescription(product: ProductRow) {
  const type = inferProductType(
    product.metadata,
    product.category_name,
    product.category_slug,
    product.name,
    product.composition
  );

  if (["bouquet", "arrangement", "flowers"].includes(type)) {
    return `${product.name} собирается вручную к выбранной дате. Оттенки и расположение отдельных цветов могут немного отличаться в зависимости от сезонной поставки, при этом стиль и ценность композиции сохраняются.`;
  }

  return `${product.name} можно добавить к основному заказу. Менеджер подтвердит наличие и детали вместе с заказом.`;
}

function categoryDescription(category: CategoryRow) {
  const current = cleanText(category.description, category.name);

  if (
    current
    && !/импортирован|cvetirima|товары и предложения этого раздела/i.test(current)
  ) {
    return current;
  }

  const source = `${category.name} ${category.slug}`;
  return categoryDescriptions.find((item) => item.pattern.test(source))?.text
    ?? `Товары раздела «${category.name}» с актуальными фотографиями, ценами и статусом наличия.`;
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

    const [products, categories] = await Promise.all([
      client<ProductRow[]>`
        SELECT
          p.id,
          p.name,
          c.name AS category_name,
          c.slug AS category_slug,
          p.short_description,
          p.description,
          p.composition,
          p.price,
          p.old_price,
          p.stock_quantity,
          p.metadata
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
        WHERE p.shop_id = ${shop.id}
        ORDER BY p.created_at ASC
      `,
      client<CategoryRow[]>`
        SELECT id, name, slug, description, is_active
        FROM categories
        WHERE shop_id = ${shop.id}
        ORDER BY sort_order ASC, name ASC
      `
    ]);

    const report = {
      startedAt: new Date().toISOString(),
      productsReviewed: products.length,
      productsUpdated: 0,
      categoriesReviewed: categories.length,
      categoriesUpdated: 0,
      subscriptionCategoriesDisabled: 0,
      productChanges: [] as Array<{
        id: string;
        name: string;
        fields: string[];
      }>,
      categoryChanges: [] as Array<{
        id: string;
        name: string;
        fields: string[];
      }>
    };

    await client.begin(async (sql) => {
      for (const product of products) {
        const name = cleanProductName(product.name);
        const normalizedProduct: ProductRow = {
          ...product,
          name
        };
        const cleanShort = cleanText(
          product.short_description,
          name
        );
        const cleanFull = cleanText(
          product.description,
          name
        );

        const shortDescription = cleanShort
          || generatedShortDescription(normalizedProduct);
        const description = cleanFull
          || generatedDescription(normalizedProduct);
        const productType = inferProductType(
          product.metadata,
          product.category_name,
          product.category_slug,
          name,
          shortDescription,
          product.composition
        );
        const availability = resolveProductAvailability(
          product.metadata,
          product.stock_quantity
        );
        const oldPrice = (
          product.old_price !== null
          && Number(product.old_price) > Number(product.price)
        )
          ? Number(product.old_price)
          : null;
        const metadata = mergeCatalogMetadata(
          product.metadata,
          { availability, productType }
        );
        const currentCatalog = readCatalogMetadata(
          product.metadata
        );

        const fields: string[] = [];

        if (name !== String(product.name ?? "").trim()) {
          fields.push("name");
        }

        if (shortDescription !== String(product.short_description ?? "").trim()) {
          fields.push("short_description");
        }

        if (description !== String(product.description ?? "").trim()) {
          fields.push("description");
        }

        if (oldPrice !== product.old_price) {
          fields.push("old_price");
        }

        if (
          currentCatalog.availability !== availability
          || currentCatalog.productType !== productType
        ) {
          fields.push("metadata.catalog");
        }

        if (!fields.length) {
          continue;
        }

        await sql`
          UPDATE products
          SET
            name = ${name},
            short_description = ${shortDescription},
            description = ${description},
            old_price = ${oldPrice},
            metadata = ${JSON.stringify(metadata)}::jsonb
          WHERE id = ${product.id}
            AND shop_id = ${shop.id}
        `;

        report.productsUpdated += 1;
        report.productChanges.push({
          id: product.id,
          name,
          fields
        });
      }

      for (const category of categories) {
        const description = categoryDescription(category);
        const isSubscription = (
          /подписка.*цвет/i.test(category.name)
          || /podpiska|subscription/i.test(category.slug)
        );
        const nextActive = isSubscription
          ? false
          : category.is_active;
        const fields: string[] = [];

        if (description !== String(category.description ?? "").trim()) {
          fields.push("description");
        }

        if (nextActive !== category.is_active) {
          fields.push("is_active");
          report.subscriptionCategoriesDisabled += 1;
        }

        if (!fields.length) {
          continue;
        }

        await sql`
          UPDATE categories
          SET
            description = ${description},
            is_active = ${nextActive},
            updated_at = NOW()
          WHERE id = ${category.id}
            AND shop_id = ${shop.id}
        `;

        report.categoriesUpdated += 1;
        report.categoryChanges.push({
          id: category.id,
          name: category.name,
          fields
        });
      }
    });

    const output = {
      ...report,
      completedAt: new Date().toISOString()
    };

    if (reportPath) {
      await writeFile(
        reportPath,
        JSON.stringify(output, null, 2),
        "utf8"
      );
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      productsReviewed: output.productsReviewed,
      productsUpdated: output.productsUpdated,
      descriptionsChanged: output.productChanges.length,
      categoriesUpdated: output.categoriesUpdated,
      subscriptionCategoriesDisabled:
        output.subscriptionCategoriesDisabled,
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
