import type { Metadata } from "next";
import { AccountClient } from "./account-client";

export const metadata: Metadata = {
  title: "Личный кабинет — Выбери Меня",
  robots: { index: false, follow: false, noarchive: true },
  description: "Профиль покупателя, адреса, бонусы и история заказов.",
};

export default function Page() {
  return <AccountClient />;
}
