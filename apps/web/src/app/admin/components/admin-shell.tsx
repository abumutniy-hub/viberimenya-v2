const navItems = [
  { href: "/admin", label: "Дашборд" },
  { href: "/admin/orders", label: "Заказы" },
  { href: "/admin/catalog", label: "Каталог" },
  { href: "/admin/delivery", label: "Доставка" },
  { href: "/admin/customers", label: "Клиенты" },
  { href: "/admin/employees", label: "Сотрудники" },
  { href: "/admin/settings", label: "Настройки" }
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand">
          <span>ВМ</span>
          <strong>CRM</strong>
        </a>

        <nav className="admin-nav" aria-label="CRM меню">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <span>ВЫБЕРИ МЕНЯ</span>
            <strong>Панель управления</strong>
          </div>
          <a href="/" target="_blank">
            Открыть сайт
          </a>
        </header>

        {children}
      </section>
    </main>
  );
}
