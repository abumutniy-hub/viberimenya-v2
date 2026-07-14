"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import { usePathname } from "next/navigation";

type AdminUser = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  home?: string;
};

type MeResponse = {
  ok?: boolean;
  user?: AdminUser;
};

type NavItem = {
  href: string;
  label: string;
  roles: string[];
};

const roleLabels:
  Record<string, string> = {
    owner: "Владелец",
    admin: "Администратор",
    manager: "Менеджер",
    florist: "Флорист",
    courier: "Курьер"
  };

const navItems: NavItem[] = [
  {
    href: "/admin",
    label: "Дашборд",
    roles: [
      "owner",
      "admin",
      "manager"
    ]
  },
  {
    href: "/admin/orders",
    label: "Заказы",
    roles: [
      "owner",
      "admin",
      "manager",
      "florist",
      "courier"
    ]
  },
  {
    href: "/admin/catalog",
    label: "Каталог",
    roles: [
      "owner",
      "admin"
    ]
  },
  {
    href: "/admin/delivery",
    label: "Доставка",
    roles: [
      "owner",
      "admin"
    ]
  },
  {
    href: "/admin/customers",
    label: "Клиенты",
    roles: [
      "owner",
      "admin",
      "manager"
    ]
  },
  {
    href: "/admin/employees",
    label: "Сотрудники",
    roles: [
      "owner",
      "admin"
    ]
  },
  {
    href: "/admin/settings",
    label: "Настройки",
    roles: [
      "owner",
      "admin"
    ]
  }
];

function roleHome(role: string) {
  if (
    role === "florist"
    || role === "courier"
  ) {
    return "/admin/orders";
  }

  return "/admin";
}

function isAllowedPath(
  role: string,
  pathname: string
) {
  if (
    role === "owner"
    || role === "admin"
  ) {
    return true;
  }

  if (role === "manager") {
    return (
      pathname === "/admin"
      || pathname.startsWith(
        "/admin/orders"
      )
      || pathname.startsWith(
        "/admin/customers"
      )
    );
  }

  if (
    role === "florist"
    || role === "courier"
  ) {
    return pathname.startsWith(
      "/admin/orders"
    );
  }

  return false;
}

function isNavActive(
  href: string,
  pathname: string
) {
  if (href === "/admin") {
    return pathname === "/admin";
  }

  return pathname.startsWith(href);
}

function navLabel(
  item: NavItem,
  role: string
) {
  if (
    item.href === "/admin/orders"
    && (
      role === "florist"
      || role === "courier"
    )
  ) {
    return "Мои заказы";
  }

  return item.label;
}

export function AdminShell({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [
    user,
    setUser
  ] = useState<AdminUser | null>(
    null
  );

  const [
    isReady,
    setIsReady
  ] = useState(false);

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
        const response =
          await fetch(
            "/api/admin/auth/me",
            {
              cache: "no-store",
              credentials: "include"
            }
          );

        const data = (
          await response
            .json()
            .catch(() => null)
        ) as MeResponse | null;

        if (!isMounted) return;

        if (
          response.status === 401
          || !data?.user
        ) {
          window.location.replace(
            "/admin/login"
          );

          return;
        }

        if (!response.ok) {
          window.location.replace(
            "/admin/login"
          );

          return;
        }

        const currentUser =
          data.user;

        const home =
          currentUser.home
          || roleHome(
            currentUser.role
          );

        if (
          !isAllowedPath(
            currentUser.role,
            pathname
          )
        ) {
          window.location.replace(home);
          return;
        }

        setUser(currentUser);
      } finally {
        if (isMounted) {
          setIsReady(true);
        }
      }
    }

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  const visibleNav =
    useMemo(() => {
      if (!user) return [];

      return navItems.filter(
        item =>
          item.roles.includes(
            user.role
          )
      );
    }, [user]);

  async function logout() {
    await fetch(
      "/api/admin/auth/logout",
      {
        method: "POST",
        credentials: "include"
      }
    );

    window.location.href =
      "/admin/login";
  }

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (!isReady || !user) {
    return (
      <main className="admin-access-loading">
        <p>Проверяем доступ…</p>
      </main>
    );
  }

  const home =
    user.home
    || roleHome(user.role);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a
          href={home}
          className="admin-brand"
        >
          <span>ВМ</span>
          <strong>CRM</strong>
        </a>

        <nav
          className="admin-nav"
          aria-label="CRM меню"
        >
          {visibleNav.map(item => (
            <a
              key={item.href}
              href={item.href}
              aria-current={
                isNavActive(
                  item.href,
                  pathname
                )
                  ? "page"
                  : undefined
              }
            >
              {navLabel(
                item,
                user.role
              )}
            </a>
          ))}
        </nav>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <span>
              {roleLabels[user.role]
                ?? "Сотрудник"}
            </span>

            <strong>
              {user.name
                || user.email
                || user.phone
                || "Панель управления"}
            </strong>
          </div>

          <div className="admin-topbar-actions">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
            >
              Открыть сайт
            </a>

            <button
              type="button"
              onClick={logout}
            >
              Выйти
            </button>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
