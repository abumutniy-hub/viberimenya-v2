"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type CartItem = {
  productId: string;
  quantity: number;
};

function readCartCount() {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    const items = raw ? (JSON.parse(raw) as CartItem[]) : [];

    return items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0);
  } catch {
    return 0;
  }
}

function useCartCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(readCartCount());

    update();

    window.addEventListener("viberimenya_cart_changed", update);
    window.addEventListener("storage", update);

    return () => {
      window.removeEventListener("viberimenya_cart_changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  return count;
}

export function DesktopCartIndicator() {
  const pathname = usePathname();
  const count = useCartCount();

  if (pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <a className="desktop-cart-indicator" href="/cart" aria-label={`Корзина, товаров: ${count}`}>
      <span className="desktop-cart-icon">🛒</span>
      <strong>Корзина</strong>
      {count > 0 ? <em>{count}</em> : null}
    </a>
  );
}

export function CartCountBadge() {
  const count = useCartCount();

  if (count <= 0) {
    return null;
  }

  return <em className="cart-count-badge">{count}</em>;
}
