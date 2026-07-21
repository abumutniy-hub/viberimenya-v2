import type { Metadata } from "next";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Оформление заказа",
  description: "Защищённое оформление заказа с единым черновиком сайта и Telegram.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
