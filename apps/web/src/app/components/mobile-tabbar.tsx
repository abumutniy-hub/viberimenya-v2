"use client";

import Link from "next/link";

import {
  usePathname
} from "next/navigation";

import {
  CartCountBadge
} from "./cart-indicator";

import {
  ShellIcon,
  type ShellIconName
} from "./shell-icon";

type MobileItem = {
  href: string;
  label: string;
  icon: ShellIconName;
  active: (
    pathname: string
  ) => boolean;
};

const items:
  MobileItem[] = [
    {
      href: "/",
      label: "Главная",
      icon: "home",
      active: pathname =>
        pathname === "/"
    },
    {
      href: "/catalog",
      label: "Каталог",
      icon: "catalog",
      active: pathname =>
        pathname.startsWith(
          "/catalog"
        )
        || pathname.startsWith(
          "/product/"
        )
    },
    {
      href: "/cart",
      label: "Корзина",
      icon: "cart",
      active: pathname =>
        pathname.startsWith(
          "/cart"
        )
    },
    {
      href: "/orders",
      label: "Заказы",
      icon: "orders",
      active: pathname =>
        pathname.startsWith(
          "/orders"
        )
        || pathname.startsWith(
          "/order/track/"
        )
    },
    {
      href: "/account",
      label: "Профиль",
      icon: "profile",
      active: pathname =>
        pathname.startsWith(
          "/account"
        )
    }
  ];

export function MobileTabbar() {
  const pathname =
    usePathname();

  if (
    pathname.startsWith(
      "/admin"
    )
  ) {
    return null;
  }

  return (
    <nav
      className="vm-clean-mobile-nav"
      aria-label={
        "Мобильная навигация"
      }
    >
      {items.map(
        item => {
          const active =
            item.active(
              pathname
            );

          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "is-active"
                  : ""
              }
              aria-current={
                active
                  ? "page"
                  : undefined
              }
            >
              <span className="vm-clean-mobile-icon">
                <ShellIcon
                  name={item.icon}
                />

                {item.icon === "cart"
                  ? (
                    <CartCountBadge />
                  )
                  : null}
              </span>

              <span>
                {item.label}
              </span>
            </Link>
          );
        }
      )}
    </nav>
  );
}
