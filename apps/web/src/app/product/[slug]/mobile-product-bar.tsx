"use client";

import {
  AddToCartButton
} from "../../components/add-to-cart-button";

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export function MobileProductBar({
  available,
  unavailableLabel,
  product
}: {
  available: boolean;
  unavailableLabel: string;
  product: {
    id: string;
    slug: string;
    name: string;
    price: number;
    imageUrl: string;
    imageAlt: string;
  };
}) {
  return (
    <div className="mobile-product-bar" aria-label="Быстрая покупка">
      <div>
        <small>Цена</small>
        <strong>{money(product.price)}</strong>
      </div>

      {available ? (
        <AddToCartButton
          className="mobile-product-bar-button"
          label="В корзину"
          product={product}
        />
      ) : (
        <button
          type="button"
          className="mobile-product-bar-button is-disabled"
          disabled
        >
          {unavailableLabel}
        </button>
      )}
    </div>
  );
}
