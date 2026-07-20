export type PublicCategorySqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[],
  >(
    strings: TemplateStringsArray,
    ...values: any[]
  ): PromiseLike<T>;
};

export type PublicCatalogCategory = {
  id: string;
  shop_id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  public_count: number;
};

export async function listPublicCatalogCategories(
  executor: PublicCategorySqlExecutor,
  shopId: string,
  limit = 48,
): Promise<PublicCatalogCategory[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));

  return await executor<PublicCatalogCategory[]>`
    SELECT
      c.id::text AS id,
      c.shop_id::text AS shop_id,
      c.parent_id::text AS parent_id,
      c.slug,
      c.name,
      c.description,
      COALESCE(
        NULLIF(TRIM(c.image_url), ''),
        cover.url
      ) AS image_url,
      c.sort_order,
      c.is_active,
      COUNT(p.id)::int AS public_count
    FROM categories c
    INNER JOIN products p
      ON p.category_id = c.id
      AND p.shop_id = c.shop_id
      AND p.status = 'active'
      AND COALESCE(
        NULLIF(
          p.metadata #>> '{catalog,availability}',
          ''
        ),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
          THEN 'available'
          ELSE 'unavailable'
        END
      ) = 'available'
    LEFT JOIN LATERAL (
      SELECT pi.url
      FROM products cp
      INNER JOIN product_images pi
        ON pi.product_id = cp.id
        AND pi.shop_id = cp.shop_id
      WHERE cp.shop_id = c.shop_id
        AND cp.category_id = c.id
        AND cp.status = 'active'
        AND COALESCE(
          NULLIF(
            cp.metadata #>> '{catalog,availability}',
            ''
          ),
          CASE
            WHEN COALESCE(cp.stock_quantity, 0) > 0
            THEN 'available'
            ELSE 'unavailable'
          END
        ) = 'available'
      ORDER BY
        cp.is_featured DESC,
        cp.sort_order ASC,
        pi.is_main DESC,
        pi.sort_order ASC,
        pi.created_at ASC
      LIMIT 1
    ) cover ON true
    WHERE c.shop_id = ${shopId}
      AND c.is_active = true
      AND LOWER(c.slug) NOT IN (
        'podpiska-na-cvety',
        'podpiska-na-tsvety',
        'subscription'
      )
      AND LOWER(BTRIM(c.name)) <> LOWER('Подписка на цветы')
    GROUP BY
      c.id,
      c.shop_id,
      c.parent_id,
      c.slug,
      c.name,
      c.description,
      c.image_url,
      c.sort_order,
      c.is_active,
      cover.url
    ORDER BY
      COUNT(p.id) DESC,
      c.sort_order ASC,
      c.name ASC
    LIMIT ${safeLimit}
  `;
}
