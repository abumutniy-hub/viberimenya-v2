export type LinkedCustomerCartItem = {
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

export type LinkedCustomerCartSnapshot = {
  linked: boolean;
  items: LinkedCustomerCartItem[];
  removed: Array<{
    productId: string;
    name: string;
    reason: "inactive" | "category_inactive" | "unavailable";
  }>;
  itemCount: number;
  quantityCount: number;
  subtotal: number;
};

type CartResponse = {
  ok?: boolean;
  cart?: LinkedCustomerCartSnapshot;
  code?: string;
};

function operationId() {
  return (
    globalThis.crypto?.randomUUID?.()
    ?? `cart-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

async function requestCart(
  input: string,
  init?: RequestInit,
): Promise<LinkedCustomerCartSnapshot | null> {
  try {
    const response = await fetch(input, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (response.status === 401 || response.status === 409) {
      return null;
    }

    const data = (await response.json().catch(() => null)) as CartResponse | null;

    if (!response.ok || !data?.ok || !data.cart) {
      return null;
    }

    return data.cart;
  } catch {
    return null;
  }
}

export function synchronizeLinkedCustomerCart(
  items: Array<{
    productId: string;
    quantity: number;
  }>,
  mode: "merge_max" | "replace" = "merge_max",
) {
  return requestCart("/api/public/account/cart/sync", {
    method: "POST",
    body: JSON.stringify({
      operationId: operationId(),
      mode,
      items: items
        .map((item) => ({
          productId: String(item.productId || "").trim(),
          quantity: Math.min(99, Math.max(1, Math.trunc(Number(item.quantity) || 1))),
        }))
        .filter((item) => item.productId),
    }),
  });
}

export function setLinkedCustomerCartItem(
  productId: string,
  quantity: number,
) {
  return requestCart(
    `/api/public/account/cart/items/${encodeURIComponent(productId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        operationId: operationId(),
        quantity: Math.min(99, Math.max(0, Math.trunc(Number(quantity) || 0))),
      }),
    },
  );
}

export function incrementLinkedCustomerCartItem(
  productId: string,
  delta: -1 | 1,
) {
  return requestCart(
    `/api/public/account/cart/items/${encodeURIComponent(productId)}/increment`,
    {
      method: "POST",
      body: JSON.stringify({
        operationId: operationId(),
        delta,
      }),
    },
  );
}

export function clearLinkedCustomerCart() {
  return requestCart("/api/public/account/cart", {
    method: "DELETE",
    body: JSON.stringify({
      operationId: operationId(),
    }),
  });
}
