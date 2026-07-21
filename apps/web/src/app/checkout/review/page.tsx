import type { Metadata } from "next";
import { CheckoutReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Проверка и оплата заказа",
  description: "Итог заказа, промокод, бонусы и выбор способа оплаты.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CheckoutReviewPage() {
  return <CheckoutReviewClient />;
}
