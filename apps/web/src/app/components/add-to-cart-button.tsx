"use client";

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

export function AddToCartButton({
  product,
  className = "dark-button"
}: {
  product: {
    id: string;
    slug: string;
    name: string;
    price: number;
  };
  className?: string;
}) {
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
        window.location.href = "/cart";
      }}
    >
      В корзину
    </button>
  );
}
