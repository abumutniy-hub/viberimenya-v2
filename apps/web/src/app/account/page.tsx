import type { Metadata } from "next";
import { AccountClient } from "./account-client";

export const metadata: Metadata = {
  title: "Личный кабинет — Выбери Меня",
  description: "Профиль покупателя, адреса, бонусы и история заказов.",
};

export default function Page() {
  return <AccountClient />;
}
