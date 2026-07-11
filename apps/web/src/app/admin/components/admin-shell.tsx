"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type AdminUser = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
};

type MeResponse = {
  ok?: boolean;
  user?: AdminUser;
};

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  florist: "Флорист",
  courier: "Курьер"
};

const navItems = [
  { href: "/admin", label: "Дашборд", roles: ["owner", "admin", "manager", "florist", "courier"] },
  { href: "/admin/orders", label: "Заказы", roles: ["owner", "admin", "manager", "florist", "courier"] },
  { href: "/admin/catalog", label: "Каталог", roles: ["owner", "admin", "manager"] },
  { href: "/admin/delivery", label: "Доставка", roles: ["owner", "admin", "manager"] },
  { href: "/admin/customers", label: "Клиенты", roles: ["owner", "admin", "manager"] },
  { href: "/admin/employees", label: "Сотрудники", roles: ["owner", "admin"] },
  { href: "/admin/settings", label: "Настройки", roles: ["owner", "admin"] }
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (pathname === "/admin/login") {
      setIsReady(true);
      return () => {
        isMounted = false;
      };
    }

    async function loadUser() {
      try {
        const response = await fetch("/api/admin/auth/me", {
          cache: "no-store",
          credentials: "include"
        });
        const data = (await response.json().catch(() => null)) as MeResponse | null;

        if (!isMounted) return;

        if (response.ok && data?.user) {
          setUser(data.user);
        }
      } finally {
        if (isMounted) setIsReady(true);
      }
    }

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  const visibleNav = useMemo(() => {
    if (!user) return [];

    return navItems.filter((item) => item.roles.includes(user.role));
  }, [user]);

  async function logout() {
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      credentials: "include"
    });
    window.location.href = "/admin/login";
  }

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand">
          <span>ВМ</span>
          <strong>CRM</strong>
        </a>

        <nav className="admin-nav" aria-label="CRM меню">
          {visibleNav.map((item) => (
            <a key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <span>{user ? roleLabels[user.role] ?? "Сотрудник" : isReady ? "CRM" : "Загрузка"}</span>
            <strong>{user?.name || user?.email || user?.phone || "Панель управления"}</strong>
          </div>
          <div className="admin-topbar-actions">
            <a href="/" target="_blank">
              Открыть сайт
            </a>
            <button type="button" onClick={logout}>
              Выйти
            </button>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
