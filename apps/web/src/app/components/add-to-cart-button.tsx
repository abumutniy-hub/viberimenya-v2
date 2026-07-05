"use client";

import { useEffect, useState } from "react";

type CartItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
};

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  window.localStorage.setItem("viberimenya_cart", JSON.stringify(items));
  window.dispatchEvent(new Event("viberimenya_cart_changed"));
}

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem("viberimenya_favorites");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeFavorites(items: string[]) {
  window.localStorage.setItem("viberimenya_favorites", JSON.stringify(items));
  window.dispatchEvent(new Event("viberimenya_favorites_changed"));
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
  };
  className?: string;
  label?: string;
}) {
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const cart = readCart();
        const existing = cart.find((item) => item.productId === product.id);

        if (existing) {
          existing.quantity += 1;
        } else {
          cart.push({
            productId: product.id,
            slug: product.slug,
            name: product.name,
            price: Number(product.price),
            quantity: 1
          });
        }

        writeCart(cart);
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1400);
      }}
    >
      {added ? "Добавлено" : label}
    </button>
  );
}

export function FavoriteButton({
  productId,
  className = "favorite-button"
}: {
  productId: string;
  className?: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(readFavorites().includes(productId));
  }, [productId]);

  return (
    <button
      type="button"
      className={`${className}${active ? " active" : ""}`}
      aria-label={active ? "Убрать из избранного" : "Добавить в избранное"}
      onClick={() => {
        const favorites = readFavorites();
        const next = favorites.includes(productId)
          ? favorites.filter((id) => id !== productId)
          : [...favorites, productId];

        writeFavorites(next);
        setActive(next.includes(productId));
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
      </svg>
    </button>
  );
}
