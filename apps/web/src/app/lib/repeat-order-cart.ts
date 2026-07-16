export type RepeatOrderCartProduct = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
  imageAlt: string;
  availability: "available" | "unavailable";
};

type StoredCartItem = {
  cartLineId: string;
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
  imageAlt: string;
  isAvailable: boolean;
};

function createCartLineId(productId: string) {
  return `${productId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function normalizeStoredItem(value: unknown): StoredCartItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const productId = String(raw.productId ?? raw.id ?? "").trim();
  const slug = String(raw.slug ?? "").trim();
  const name = String(raw.name ?? "").trim();
  const price = Number(raw.price ?? 0);
  const quantity = Math.min(99, Math.max(1, Number(raw.quantity ?? 1) || 1));
  const imageUrl = String(raw.imageUrl ?? raw.image_url ?? "").trim();
  const imageAlt = String(raw.imageAlt ?? raw.image_alt ?? name).trim();

  if (!productId || !slug || !name || !Number.isFinite(price) || price < 0) {
    return null;
  }

  return {
    cartLineId:
      String(raw.cartLineId ?? "").trim() || createCartLineId(productId),
    productId,
    slug,
    name,
    price,
    quantity,
    imageUrl,
    imageAlt: imageAlt || name,
    isAvailable: raw.isAvailable !== false,
  };
}

function readCart() {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [] as StoredCartItem[];
    }

    return parsed
      .map((item) => normalizeStoredItem(item))
      .filter((item): item is StoredCartItem => Boolean(item));
  } catch {
    return [] as StoredCartItem[];
  }
}

function writeCart(items: StoredCartItem[]) {
  window.localStorage.setItem("viberimenya_cart", JSON.stringify(items));
  window.dispatchEvent(new Event("viberimenya_cart_changed"));
}

export function addRepeatOrderProducts(products: RepeatOrderCartProduct[]) {
  const cart = readCart();
  const byProductId = new Map(cart.map((item) => [item.productId, item]));
  let addedQuantity = 0;
  let skippedQuantity = 0;

  for (const product of products) {
    const safeQuantity = Math.min(
      99,
      Math.max(1, Number(product.quantity) || 1),
    );

    if (product.availability !== "available") {
      skippedQuantity += safeQuantity;
      continue;
    }

    const existing = byProductId.get(product.productId);

    if (existing) {
      const before = existing.quantity;
      existing.quantity = Math.min(99, existing.quantity + safeQuantity);
      existing.slug = product.slug;
      existing.name = product.name;
      existing.price = Number(product.price);
      existing.imageUrl = product.imageUrl;
      existing.imageAlt = product.imageAlt || product.name;
      existing.isAvailable = true;
      addedQuantity += Math.max(0, existing.quantity - before);
      continue;
    }

    const item: StoredCartItem = {
      cartLineId: createCartLineId(product.productId),
      productId: product.productId,
      slug: product.slug,
      name: product.name,
      price: Number(product.price),
      quantity: safeQuantity,
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt || product.name,
      isAvailable: true,
    };

    cart.push(item);
    byProductId.set(product.productId, item);
    addedQuantity += safeQuantity;
  }

  writeCart(cart);

  return {
    addedQuantity,
    skippedQuantity,
  };
}
