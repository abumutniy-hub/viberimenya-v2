"use client";

import {
  usePathname
} from "next/navigation";

import {
  CartCountBadge
} from "./cart-indicator";

import {
  PublicIcon,
  type PublicIconName
} from "./public-icon";

const items: Array<{
  href: string;
  label: string;
  icon: PublicIconName;
  match: (path: string) => boolean;
}> = [
  {
    href: "/",
    label: "Главная",
    icon: "home",
    match: (path) => path === "/"
  },
  {
    href: "/catalog",
    label: "Каталог",
    icon: "catalog",
    match: (path) =>
      path.startsWith("/catalog")
      || path.startsWith("/product")
  },
  {
    href: "/cart",
    label: "Корзина",
    icon: "cart",
    match: (path) =>
      path.startsWith("/cart")
  },
  {
    href: "/orders",
    label: "Заказы",
    icon: "orders",
    match: (path) =>
      path.startsWith("/orders")
  },
  {
    href: "/account",
    label: "Профиль",
    icon: "profile",
    match: (path) =>
      path.startsWith("/account")
  }
];

export function MobileTabbar() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <nav
      className="mobile-tabbar"
      aria-label="Мобильное меню"
    >
      {items.map((item) => {
        const isActive =
          item.match(pathname);

        return (
          <a
            key={item.href}
            href={item.href}
            className={
              isActive ? "active" : ""
            }
            aria-current={
              isActive ? "page" : undefined
            }
          >
            <span className="mobile-tabbar-icon">
              <PublicIcon
                name={item.icon}
              />

              {item.href === "/cart"
                ? <CartCountBadge />
                : null}
            </span>

            <span>
              {item.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
