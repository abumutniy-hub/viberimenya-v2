import { CartClient } from "./components/cart-client";

export const dynamic = "force-dynamic";

export default function CartPage() {
  return (
    <main className="cart-page">
      <CartClient />
    </main>
  );
}
