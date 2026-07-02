"use client";

import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Главная", icon: "🏠", match: (path: string) => path === "/" },
  {
    href: "/catalog",
    label: "Каталог",
    icon: "🌸",
    match: (path: string) => path.startsWith("/catalog") || path.startsWith("/product")
  },
  { href: "/cart", label: "Корзина", icon: "🛒", match: (path: string) => path.startsWith("/cart") },
  { href: "/orders", label: "Заказы", icon: "📦", match: (path: string) => path.startsWith("/orders") },
  { href: "/account", label: "Профиль", icon: "👤", match: (path: string) => path.startsWith("/account") }
];

export function MobileTabbar() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <nav className="mobile-tabbar" aria-label="Мобильное меню">
      {items.map((item) => (
        <a key={item.href} href={item.href} className={item.match(pathname) ? "active" : ""}>
          <span>{item.icon}</span>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
