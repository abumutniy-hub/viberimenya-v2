import type { Metadata } from "next";
import { CartClient } from "./components/cart-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Корзина",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CartPage() {
  return (
    <main className="cart-page">
      <CartClient />
    </main>
  );
}
