import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  listPublicCatalogCategories,
  type PublicCategorySqlExecutor,
} from "./modules/catalog/public-category.service";

class VerificationRollback extends Error {}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const marker = `public-category-e2e-${randomUUID()}`;
const { client } = createDb();

try {
  try {
    await client.begin(async (transaction: PublicCategorySqlExecutor) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:public-category-visibility-e2e')
        )
      `;

      const shops = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const shop = shops[0];
      assertCondition(shop, "Активный магазин не найден");
      pass("активный магазин найден");

      const categoryRows = await transaction<{
        visible_id: string;
        inactive_id: string;
        empty_id: string;
        unavailable_id: string;
        subscription_id: string;
      }[]>`
        WITH visible AS (
          INSERT INTO categories (
            shop_id, slug, name, sort_order, is_active,
            created_at, updated_at
          )
          VALUES (
            ${shop.id}, ${`${marker}-visible`},
            'Видимый раздел E2E', 1, true, NOW(), NOW()
          )
          RETURNING id
        ),
        inactive AS (
          INSERT INTO categories (
            shop_id, slug, name, sort_order, is_active,
            created_at, updated_at
          )
          VALUES (
            ${shop.id}, ${`${marker}-inactive`},
            'Отключённый раздел E2E', 2, false, NOW(), NOW()
          )
          RETURNING id
        ),
        empty_category AS (
          INSERT INTO categories (
            shop_id, slug, name, sort_order, is_active,
            created_at, updated_at
          )
          VALUES (
            ${shop.id}, ${`${marker}-empty`},
            'Пустой раздел E2E', 3, true, NOW(), NOW()
          )
          RETURNING id
        ),
        unavailable_category AS (
          INSERT INTO categories (
            shop_id, slug, name, sort_order, is_active,
            created_at, updated_at
          )
          VALUES (
            ${shop.id}, ${`${marker}-unavailable`},
            'Недоступный раздел E2E', 4, true, NOW(), NOW()
          )
          RETURNING id
        ),
        subscription_category AS (
          INSERT INTO categories (
            shop_id, slug, name, sort_order, is_active,
            created_at, updated_at
          )
          VALUES (
            ${shop.id}, ${`${marker}-subscription`},
            'Подписка на цветы', 5, true, NOW(), NOW()
          )
          RETURNING id
        )
        SELECT
          visible.id AS visible_id,
          inactive.id AS inactive_id,
          empty_category.id AS empty_id,
          unavailable_category.id AS unavailable_id,
          subscription_category.id AS subscription_id
        FROM visible, inactive, empty_category,
          unavailable_category, subscription_category
      `;
      const categories = categoryRows[0];
      assertCondition(categories, "Синтетические категории не созданы");

      await transaction`
        INSERT INTO products (
          shop_id, category_id, slug, name, price,
          stock_quantity, status, metadata,
          created_at, updated_at
        )
        VALUES
          (
            ${shop.id}, ${categories.visible_id},
            ${`${marker}-visible-product`}, 'Доступный товар E2E',
            1000, 10, 'active',
            ${JSON.stringify({ catalog: { availability: "available" }, marker })}::jsonb,
            NOW(), NOW()
          ),
          (
            ${shop.id}, ${categories.inactive_id},
            ${`${marker}-inactive-product`}, 'Товар отключённой категории E2E',
            1000, 10, 'active',
            ${JSON.stringify({ catalog: { availability: "available" }, marker })}::jsonb,
            NOW(), NOW()
          ),
          (
            ${shop.id}, ${categories.unavailable_id},
            ${`${marker}-unavailable-product`}, 'Недоступный товар E2E',
            1000, 0, 'active',
            ${JSON.stringify({ catalog: { availability: "unavailable" }, marker })}::jsonb,
            NOW(), NOW()
          ),
          (
            ${shop.id}, ${categories.subscription_id},
            ${`${marker}-subscription-product`}, 'Подписка E2E',
            1000, 10, 'active',
            ${JSON.stringify({ catalog: { availability: "available" }, marker })}::jsonb,
            NOW(), NOW()
          )
      `;
      pass("созданы видимая, отключённая, пустая и служебная категории");

      const visible = await listPublicCatalogCategories(
        transaction,
        shop.id,
        100,
      );
      const ids = new Set(visible.map((item) => item.id));

      assertCondition(
        ids.has(categories.visible_id),
        "Доступная категория не попала в публичный каталог",
      );
      assertCondition(
        !ids.has(categories.inactive_id),
        "Отключённая категория попала в публичный каталог",
      );
      assertCondition(
        !ids.has(categories.empty_id),
        "Пустая категория попала в публичный каталог",
      );
      assertCondition(
        !ids.has(categories.unavailable_id),
        "Категория без доступных товаров попала в публичный каталог",
      );
      assertCondition(
        !ids.has(categories.subscription_id),
        "Служебная подписка попала в обычный каталог",
      );
      pass("сайт и Telegram получают только публичные категории с доступными товарами");

      await transaction`
        UPDATE categories
        SET is_active = false,
            updated_at = NOW()
        WHERE id = ${categories.visible_id}
      `;

      const afterDisable = await listPublicCatalogCategories(
        transaction,
        shop.id,
        100,
      );
      assertCondition(
        !afterDisable.some((item) => item.id === categories.visible_id),
        "Категория осталась публичной после отключения",
      );
      pass("отключение категории сразу скрывает её во всех каналах");

      throw new VerificationRollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const residue = await client<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM categories
    WHERE slug LIKE ${`${marker}%`}
  `;
  assertCondition(
    Number(residue[0]?.total || 0) === 0,
    "После rollback остались синтетические категории",
  );
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("\nPUBLIC CATEGORY VISIBILITY E2E: OK");
  console.log("Проверены активность, наличие товаров, служебные категории и мгновенное скрытие.");
  console.log("Реальные категории, товары и Telegram-сообщения не изменялись.");
} finally {
  await client.end({ timeout: 5 });
}
