import type { Metadata } from "next";
import { CheckoutDeliveryClient } from "./delivery-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Доставка заказа",
  description: "Адрес, дата и интервал доставки в едином черновике сайта и Telegram.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CheckoutDeliveryPage() {
  return <CheckoutDeliveryClient />;
}
