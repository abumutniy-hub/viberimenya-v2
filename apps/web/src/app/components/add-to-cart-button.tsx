"use client";

import {
  useEffect,
  useState
} from "react";

type CartItem = {
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

type StoredCartItem =
  Record<string, unknown>;

function createCartLineId(
  productId: string
) {
  return (
    `${productId}-${
      globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`
    }`
  );
}

function normalizeCartItem(
  value: unknown
): CartItem | null {
  if (
    !value
    || typeof value !== "object"
  ) {
    return null;
  }

  const item =
    value as StoredCartItem;

  const productId = String(
    item.productId
    ?? item.id
    ?? ""
  ).trim();

  const name =
    String(item.name ?? "").trim();

  const slug =
    String(item.slug ?? "").trim();

  const price =
    Number(item.price ?? 0);

  const quantity = Math.max(
    1,
    Number(item.quantity ?? 1) || 1
  );

  const imageUrl = String(
    item.imageUrl
    ?? item.image_url
    ?? ""
  ).trim();

  const imageAlt = String(
    item.imageAlt
    ?? item.image_alt
    ?? name
  ).trim();

  if (
    !productId
    || !name
    || !slug
    || !Number.isFinite(price)
    || price < 0
  ) {
    return null;
  }

  return {
    cartLineId:
      String(
        item.cartLineId ?? ""
      ).trim()
      || createCartLineId(productId),

    productId,
    slug,
    name,
    price,
    quantity,
    imageUrl,
    imageAlt: imageAlt || name,
    isAvailable:
      item.isAvailable !== false
  };
}

function readCart(): CartItem[] {
  try {
    const raw =
      window.localStorage.getItem(
        "viberimenya_cart"
      );

    const parsed =
      raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) =>
        normalizeCartItem(item)
      )
      .filter(
        (item): item is CartItem =>
          Boolean(item)
      );
  } catch {
    return [];
  }
}

function writeCart(
  items: CartItem[]
) {
  window.localStorage.setItem(
    "viberimenya_cart",
    JSON.stringify(items)
  );

  window.dispatchEvent(
    new Event(
      "viberimenya_cart_changed"
    )
  );
}

function readFavorites(): string[] {
  try {
    const raw =
      window.localStorage.getItem(
        "viberimenya_favorites"
      );

    const parsed =
      raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) =>
        String(value).trim()
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeFavorites(
  items: string[]
) {
  window.localStorage.setItem(
    "viberimenya_favorites",
    JSON.stringify(items)
  );

  window.dispatchEvent(
    new Event(
      "viberimenya_favorites_changed"
    )
  );
}

export function AddToCartButton({
  product,
  className = "dark-button",
  label = "Добавить в корзину"
}: {
  product: {
    id: string;
    slug: string;
    name: string;
    price: number;
    imageUrl?: string;
    imageAlt?: string;
  };
  className?: string;
  label?: string;
}) {
  const [added, setAdded] =
    useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const cart = readCart();

        const existing =
          cart.find(
            (item) =>
              item.productId
              === product.id
          );

        const imageUrl =
          String(
            product.imageUrl ?? ""
          ).trim();

        const imageAlt =
          String(
            product.imageAlt
            ?? product.name
          ).trim();

        if (existing) {
          existing.quantity += 1;
          existing.slug = product.slug;
          existing.name = product.name;
          existing.price =
            Number(product.price);
          existing.imageUrl =
            imageUrl;
          existing.imageAlt =
            imageAlt || product.name;
          existing.isAvailable = true;
        } else {
          cart.push({
            cartLineId:
              createCartLineId(
                product.id
              ),

            productId: product.id,
            slug: product.slug,
            name: product.name,
            price:
              Number(product.price),
            quantity: 1,
            imageUrl,
            imageAlt:
              imageAlt || product.name,
            isAvailable: true
          });
        }

        writeCart(cart);
        setAdded(true);

        window.setTimeout(
          () => setAdded(false),
          1400
        );
      }}
    >
      {added ? "Добавлено" : label}
    </button>
  );
}

export function FavoriteButton({
  productId,
  className = ""
}: {
  productId: string;
  className?: string;
}) {
  const [active, setActive] =
    useState(false);

  useEffect(() => {
    const sync = () => {
      setActive(
        readFavorites().includes(productId)
      );
    };

    sync();

    window.addEventListener("storage", sync);
    window.addEventListener(
      "viberimenya_favorites_changed",
      sync
    );

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(
        "viberimenya_favorites_changed",
        sync
      );
    };
  }, [productId]);

  return (
    <button
      type="button"
      className={[
        "favorite-button",
        className,
        active ? "active" : ""
      ].filter(Boolean).join(" ")}
      aria-label={
        active
          ? "Убрать из избранного"
          : "Добавить в избранное"
      }
      aria-pressed={active}
      onClick={() => {
        const favorites =
          readFavorites();

        const next =
          favorites.includes(productId)
            ? favorites.filter(
                (id) =>
                  id !== productId
              )
            : [
                ...favorites,
                productId
              ];

        writeFavorites(next);

        setActive(
          next.includes(productId)
        );
      }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
      </svg>
    </button>
  );
}
