import type { Metadata } from "next";
import { OrdersClient } from "./orders-client";

export const metadata: Metadata = {
  title: "Мои заказы — Выбери Меня",
  robots: { index: false, follow: false, noarchive: true },
  description: "История заказов, статусы сборки и доставки.",
};

export default function Page() {
  return <OrdersClient />;
}
