import { randomUUID } from "node:crypto";

export type CommerceCartSqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[],
  >(
    strings: TemplateStringsArray,
    ...parameters: any[]
  ): PromiseLike<T>;
};

export const MAX_COMMERCE_CART_QUANTITY = 99;
export const MAX_COMMERCE_CART_LINES = 100;

export type CommerceCartSource = "site" | "telegram";

export type CommerceCartItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  availability: "available" | "preorder";
  imageUrl: string | null;
  imageAlt: string | null;
  updatedAt: string;
};

export type CommerceCartSnapshot = {
  linked: boolean;
  telegramChatId: string | null;
  items: CommerceCartItem[];
  removed: Array<{
    productId: string;
    name: string;
    reason: "inactive" | "category_inactive" | "unavailable";
  }>;
  itemCount: number;
  quantityCount: number;
  subtotal: number;
};

type RawCartRow = {
  product_id: string;
  quantity: number;
  name: string;
  slug: string;
  price: number;
  status: string;
  category_active: boolean;
  availability: string;
  image_url: string | null;
  image_alt: string | null;
  updated_at: string;
};

function normalizeQuantity(value: unknown) {
  const number = Math.trunc(Number(value));

  if (!Number.isFinite(number)) return 1;

  return Math.min(
    MAX_COMMERCE_CART_QUANTITY,
    Math.max(0, number),
  );
}

function availabilityReason(row: RawCartRow) {
  if (row.status !== "active") return "inactive" as const;
  if (!row.category_active) return "category_inactive" as const;
  if (!new Set(["available", "preorder"]).has(row.availability)) {
    return "unavailable" as const;
  }

  return null;
}

async function readRawCart(
  sql: CommerceCartSqlExecutor,
  shopId: string,
  telegramChatId: string,
) {
  return sql<RawCartRow[]>`
    SELECT
      tci.product_id::text,
      tci.quantity,
      p.name,
      p.slug,
      p.price,
      p.status,
      CASE
        WHEN p.category_id IS NULL THEN true
        ELSE COALESCE(c.is_active, false)
      END AS category_active,
      COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) AS availability,
      image.url AS image_url,
      image.alt AS image_alt,
      tci.updated_at::text
    FROM telegram_cart_items tci
    INNER JOIN products p
      ON p.id = tci.product_id
      AND p.shop_id = tci.shop_id
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
    LEFT JOIN LATERAL (
      SELECT pi.url, pi.alt
      FROM product_images pi
      WHERE pi.shop_id = p.shop_id
        AND pi.product_id = p.id
      ORDER BY
        pi.is_main DESC,
        pi.sort_order ASC,
        pi.created_at ASC
      LIMIT 1
    ) image ON true
    WHERE tci.shop_id = ${shopId}
      AND tci.telegram_chat_id = ${telegramChatId}::bigint
    ORDER BY tci.created_at ASC, tci.id ASC
  `;
}

async function writeCartEvent(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CommerceCartSource;
    action: string;
    operationId?: string;
    payload?: Record<string, unknown>;
  },
) {
  const operationId = String(params.operationId || randomUUID()).slice(0, 160);
  const idempotencyKey = `commerce-cart:${params.telegramChatId}:${operationId}`;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO domain_events (
      shop_id,
      aggregate_type,
      aggregate_id,
      event_type,
      event_version,
      actor_type,
      actor_customer_id,
      idempotency_key,
      payload,
      occurred_at,
      created_at,
      updated_at
    )
    VALUES (
      ${params.shopId},
      'commerce_cart',
      ${params.customerId},
      'customer.cart.mutated',
      1,
      ${params.customerId ? "customer" : params.source},
      ${params.customerId},
      ${idempotencyKey},
      ${JSON.stringify({
        source: params.source,
        action: params.action,
        telegramChatId: params.telegramChatId,
        ...params.payload,
      })}::jsonb,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, idempotency_key)
    DO NOTHING
    RETURNING id
  `;

  return {
    claimed: rows.length === 1,
    eventId: rows[0]?.id ?? null,
  };
}

export async function resolveCustomerCommerceCartScope(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string;
  },
) {
  const rows = await sql<{ telegram_id: string }[]>`
    SELECT telegram_id
    FROM telegram_accounts
    WHERE shop_id = ${params.shopId}
      AND customer_id = ${params.customerId}
      AND is_active = true
      AND telegram_id ~ '^[0-9]{1,20}$'
    ORDER BY linked_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `;
  const telegramChatId = rows[0]?.telegram_id ?? null;

  return telegramChatId
    ? {
        linked: true as const,
        telegramChatId,
      }
    : {
        linked: false as const,
        telegramChatId: null,
      };
}

export async function resolveTelegramCommerceCustomer(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    telegramChatId: string;
  },
) {
  const rows = await sql<{ customer_id: string | null }[]>`
    SELECT customer_id
    FROM telegram_accounts
    WHERE shop_id = ${params.shopId}
      AND telegram_id = ${params.telegramChatId}
      AND is_active = true
    ORDER BY linked_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `;

  return rows[0]?.customer_id ?? null;
}

export async function getCommerceCartSnapshot(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    telegramChatId: string;
    cleanup?: boolean;
  },
): Promise<CommerceCartSnapshot> {
  const rows = await readRawCart(
    sql,
    params.shopId,
    params.telegramChatId,
  );
  const removed = rows
    .map((row) => {
      const reason = availabilityReason(row);

      return reason
        ? {
            productId: row.product_id,
            name: row.name,
            reason,
          }
        : null;
    })
    .filter(
      (
        row,
      ): row is {
        productId: string;
        name: string;
        reason: "inactive" | "category_inactive" | "unavailable";
      } => Boolean(row),
    );

  if (params.cleanup !== false && removed.length > 0) {
    const removedIds = removed.map((row) => row.productId);

    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ANY(${removedIds}::uuid[])
    `;
  }

  if (params.cleanup !== false) {
    await sql`
      UPDATE telegram_cart_items
      SET quantity = ${MAX_COMMERCE_CART_QUANTITY},
          updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND quantity > ${MAX_COMMERCE_CART_QUANTITY}
    `;
  }

  const items = rows
    .filter((row) => !availabilityReason(row))
    .map((row): CommerceCartItem => ({
      productId: row.product_id,
      slug: row.slug,
      name: row.name,
      price: Number(row.price || 0),
      quantity: normalizeQuantity(row.quantity),
      availability: row.availability === "preorder" ? "preorder" : "available",
      imageUrl: row.image_url,
      imageAlt: row.image_alt || row.name,
      updatedAt: row.updated_at,
    }));

  return {
    linked: true,
    telegramChatId: params.telegramChatId,
    items,
    removed,
    itemCount: items.length,
    quantityCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    ),
  };
}

async function eligibleProduct(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    productId: string;
  },
) {
  const rows = await sql<{
    id: string;
    name: string;
    availability: string;
  }[]>`
    SELECT
      p.id::text AS id,
      p.name,
      COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) AS availability
    FROM products p
    LEFT JOIN categories c
      ON c.id = p.category_id
      AND c.shop_id = p.shop_id
    WHERE p.shop_id = ${params.shopId}
      AND p.id = ${params.productId}::uuid
      AND p.status = 'active'
      AND (
        p.category_id IS NULL
        OR c.is_active = true
      )
      AND COALESCE(
        NULLIF(p.metadata #>> '{catalog,availability}', ''),
        CASE
          WHEN COALESCE(p.stock_quantity, 0) > 0
            THEN 'available'
          ELSE 'unavailable'
        END
      ) IN ('available', 'preorder')
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function setCommerceCartQuantity(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    productId: string;
    quantity: number;
    source: CommerceCartSource;
    operationId: string;
  },
) {
  const event = await writeCartEvent(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    action: "set_quantity",
    operationId: params.operationId,
    payload: {
      productId: params.productId,
      requestedQuantity: params.quantity,
    },
  });

  if (!event.claimed) {
    return {
      reused: true,
      applied: false,
      reason: "duplicate_operation" as const,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
    };
  }

  const quantity = normalizeQuantity(params.quantity);

  if (quantity === 0) {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ${params.productId}::uuid
    `;

    return {
      reused: false,
      applied: true,
      reason: "removed" as const,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
    };
  }

  const product = await eligibleProduct(sql, {
    shopId: params.shopId,
    productId: params.productId,
  });

  if (!product) {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ${params.productId}::uuid
    `;

    return {
      reused: false,
      applied: false,
      reason: "product_unavailable" as const,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
    };
  }

  await sql`
    INSERT INTO telegram_cart_items (
      shop_id,
      telegram_chat_id,
      product_id,
      quantity,
      created_at,
      updated_at
    )
    VALUES (
      ${params.shopId},
      ${params.telegramChatId}::bigint,
      ${params.productId}::uuid,
      ${quantity},
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_id, telegram_chat_id, product_id)
    DO UPDATE SET
      quantity = EXCLUDED.quantity,
      updated_at = NOW()
  `;

  return {
    reused: false,
    applied: true,
    reason: "quantity_updated" as const,
    cart: await getCommerceCartSnapshot(sql, {
      shopId: params.shopId,
      telegramChatId: params.telegramChatId,
    }),
  };
}

export async function incrementCommerceCartQuantity(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    productId: string;
    delta: number;
    source: CommerceCartSource;
    operationId: string;
  },
) {
  const delta = Math.max(-1, Math.min(1, Math.trunc(params.delta)));
  const event = await writeCartEvent(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    action: "increment",
    operationId: params.operationId,
    payload: {
      productId: params.productId,
      delta,
    },
  });

  if (!event.claimed) {
    return {
      reused: true,
      applied: false,
      reason: "duplicate_operation" as const,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
    };
  }

  const product = await eligibleProduct(sql, {
    shopId: params.shopId,
    productId: params.productId,
  });

  if (!product) {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ${params.productId}::uuid
    `;

    return {
      reused: false,
      applied: false,
      reason: "product_unavailable" as const,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
    };
  }

  if (delta < 0) {
    await sql`
      UPDATE telegram_cart_items
      SET
        quantity = quantity - 1,
        updated_at = NOW()
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ${params.productId}::uuid
        AND quantity > 1
    `;

    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
        AND product_id = ${params.productId}::uuid
        AND quantity <= 1
    `;
  } else {
    await sql`
      INSERT INTO telegram_cart_items (
        shop_id,
        telegram_chat_id,
        product_id,
        quantity,
        created_at,
        updated_at
      )
      VALUES (
        ${params.shopId},
        ${params.telegramChatId}::bigint,
        ${params.productId}::uuid,
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, telegram_chat_id, product_id)
      DO UPDATE SET
        quantity = LEAST(
          ${MAX_COMMERCE_CART_QUANTITY},
          telegram_cart_items.quantity + 1
        ),
        updated_at = NOW()
    `;
  }

  return {
    reused: false,
    applied: true,
    reason: "quantity_updated" as const,
    cart: await getCommerceCartSnapshot(sql, {
      shopId: params.shopId,
      telegramChatId: params.telegramChatId,
    }),
  };
}

export async function synchronizeCommerceCart(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    telegramChatId: string;
    items: Array<{
      productId: string;
      quantity: number;
    }>;
    mode: "merge_max" | "replace";
    operationId: string;
  },
) {
  const event = await writeCartEvent(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: "site",
    action: "synchronize",
    operationId: params.operationId,
    payload: {
      mode: params.mode,
      requestedLineCount: params.items.length,
    },
  });

  if (!event.claimed) {
    return {
      reused: true,
      cart: await getCommerceCartSnapshot(sql, {
        shopId: params.shopId,
        telegramChatId: params.telegramChatId,
      }),
      omitted: [],
    };
  }

  const normalized = new Map<string, number>();

  for (const item of params.items.slice(0, MAX_COMMERCE_CART_LINES)) {
    const productId = String(item.productId || "").trim();
    const quantity = normalizeQuantity(item.quantity);

    if (!/^[0-9a-f-]{36}$/i.test(productId) || quantity <= 0) {
      continue;
    }

    normalized.set(
      productId,
      Math.max(normalized.get(productId) ?? 0, quantity),
    );
  }

  const requestedIds = Array.from(normalized.keys());
  const validRows = requestedIds.length > 0
    ? await sql<{ id: string }[]>`
        SELECT p.id::text AS id
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
        WHERE p.shop_id = ${params.shopId}
          AND p.id = ANY(${requestedIds}::uuid[])
          AND p.status = 'active'
          AND (
            p.category_id IS NULL
            OR c.is_active = true
          )
          AND COALESCE(
            NULLIF(p.metadata #>> '{catalog,availability}', ''),
            CASE
              WHEN COALESCE(p.stock_quantity, 0) > 0
                THEN 'available'
              ELSE 'unavailable'
            END
          ) IN ('available', 'preorder')
      `
    : [];
  const validIds = new Set(validRows.map((row) => row.id));
  const omitted = requestedIds.filter((id) => !validIds.has(id));

  if (params.mode === "replace") {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
    `;
  }

  for (const [productId, quantity] of normalized) {
    if (!validIds.has(productId)) continue;

    await sql`
      INSERT INTO telegram_cart_items (
        shop_id,
        telegram_chat_id,
        product_id,
        quantity,
        created_at,
        updated_at
      )
      VALUES (
        ${params.shopId},
        ${params.telegramChatId}::bigint,
        ${productId}::uuid,
        ${quantity},
        NOW(),
        NOW()
      )
      ON CONFLICT (shop_id, telegram_chat_id, product_id)
      DO UPDATE SET
        quantity = CASE
          WHEN ${params.mode} = 'replace'
            THEN EXCLUDED.quantity
          ELSE GREATEST(
            telegram_cart_items.quantity,
            EXCLUDED.quantity
          )
        END,
        updated_at = NOW()
    `;
  }

  return {
    reused: false,
    cart: await getCommerceCartSnapshot(sql, {
      shopId: params.shopId,
      telegramChatId: params.telegramChatId,
    }),
    omitted,
  };
}

export async function clearCommerceCart(
  sql: CommerceCartSqlExecutor,
  params: {
    shopId: string;
    customerId: string | null;
    telegramChatId: string;
    source: CommerceCartSource;
    operationId: string;
  },
) {
  const event = await writeCartEvent(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    telegramChatId: params.telegramChatId,
    source: params.source,
    action: "clear",
    operationId: params.operationId,
  });

  if (event.claimed) {
    await sql`
      DELETE FROM telegram_cart_items
      WHERE shop_id = ${params.shopId}
        AND telegram_chat_id = ${params.telegramChatId}::bigint
    `;
  }

  return {
    reused: !event.claimed,
    cart: await getCommerceCartSnapshot(sql, {
      shopId: params.shopId,
      telegramChatId: params.telegramChatId,
    }),
  };
}
