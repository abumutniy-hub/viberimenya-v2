import type { Metadata } from "next";
import { OrdersClient } from "./orders-client";

export const metadata: Metadata = {
  title: "Мои заказы — Выбери Меня",
  description: "История заказов, статусы сборки и доставки.",
};

export default function Page() {
  return <OrdersClient />;
}
