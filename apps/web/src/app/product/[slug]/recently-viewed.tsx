"use client";

import {
  useEffect,
  useState
} from "react";

import {
  AddToCartButton
} from "../../components/add-to-cart-button";
import {
  ProductGroupCarousel
} from "./product-group-carousel";

type RecentProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  imageUrl: string;
  imageAlt: string;
};

const STORAGE_KEY = "viberimenya_recent_products";
const MAX_STORED_PRODUCTS = 16;
const MAX_VISIBLE_PRODUCTS = 12;

function readRecentProducts(): RecentProduct[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value): RecentProduct | null => {
        if (!value || typeof value !== "object") {
          return null;
        }

        const item = value as Record<string, unknown>;
        const id = String(item.id ?? "").trim();
        const slug = String(item.slug ?? "").trim();
        const name = String(item.name ?? "").trim();
        const price = Number(item.price ?? 0);

        if (!id || !slug || !name || !Number.isFinite(price) || price < 0) {
          return null;
        }

        return {
          id,
          slug,
          name,
          price,
          imageUrl: String(item.imageUrl ?? "").trim(),
          imageAlt: String(item.imageAlt ?? name).trim() || name
        };
      })
      .filter((item): item is RecentProduct => Boolean(item));
  } catch {
    return [];
  }
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export function RecentlyViewed({
  current
}: {
  current: RecentProduct;
}) {
  const [items, setItems] = useState<RecentProduct[]>([]);

  useEffect(() => {
    const previous = readRecentProducts();
    const withoutCurrent = previous.filter((item) => item.id !== current.id);
    const next = [current, ...withoutCurrent].slice(0, MAX_STORED_PRODUCTS);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setItems(withoutCurrent.slice(0, MAX_VISIBLE_PRODUCTS));
  }, [
    current.id,
    current.imageAlt,
    current.imageUrl,
    current.name,
    current.price,
    current.slug
  ]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="product-merch-section product-recent-section">
      <ProductGroupCarousel
        ariaLabel="Недавно просмотренные товары"
        eyebrow="История просмотра"
        title="Вы недавно смотрели"
        linkHref="/catalog"
        linkLabel="Весь каталог"
        mobileHint="Смахните в сторону, чтобы посмотреть историю"
      >
        {items.map((item) => (
          <article key={item.id} className="product-merch-card">
            <a href={`/product/${item.slug}`} className="product-merch-image">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.imageAlt || item.name}
                  loading="lazy"
                />
              ) : (
                <span>Фото скоро появится</span>
              )}
            </a>

            <div>
              <a href={`/product/${item.slug}`}>
                <h3>{item.name}</h3>
              </a>
              <strong>{money(item.price)}</strong>
            </div>

            <AddToCartButton
              className="product-merch-add-button"
              label="+ В корзину"
              product={item}
            />
          </article>
        ))}
      </ProductGroupCarousel>
    </section>
  );
}
