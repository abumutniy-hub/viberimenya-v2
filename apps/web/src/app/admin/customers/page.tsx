import { fetchAdmin } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  visible_bonus_balance: number;
  bonus_debt: number;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
  created_at: string;
  segment: "new" | "regular" | "vip" | "inactive";
  telegram_id: string | null;
  linked_telegram_username: string | null;
  notifications_enabled: boolean | null;
  telegram_is_active: boolean | null;
};

type Response = {
  items: Customer[];
  metrics: {
    total: number;
    new_count: number;
    regular_count: number;
    vip_count: number;
    inactive_count: number;
    bonus_balance_total: number;
    bonus_debt_total: number;
    lifetime_revenue: number;
  };
  segmentation: Record<string, string>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
};

const segmentLabels: Record<string, string> = {
  new: "Новый",
  regular: "Постоянный",
  vip: "VIP",
  inactive: "Неактивный"
};

function first(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function money(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      query.set(key, String(value));
    }
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export default async function AdminCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const segment = first(params.segment, "all");
  const page = Math.max(1, Number(first(params.page, "1")) || 1);
  const apiQuery = queryString({ q, segment, page });
  const data = await fetchAdmin<Response>(`/api/admin/customers${apiQuery}`);
  const metrics = data?.metrics ?? {
    total: 0,
    new_count: 0,
    regular_count: 0,
    vip_count: 0,
    inactive_count: 0,
    bonus_balance_total: 0,
    bonus_debt_total: 0,
    lifetime_revenue: 0
  };
  const pagination = data?.pagination ?? { page: 1, pageSize: 40, total: 0, pages: 1 };

  return (
    <div className="admin-page admin-customers-page">
      <div className="admin-page-head admin-growth-head">
        <div>
          <span>База, лояльность и история покупок</span>
          <h1>Клиенты</h1>
          <p>
            Сегменты рассчитываются автоматически: VIP — 5 заказов или покупки от 50 000 ₽,
            неактивный — без заказов более 90 дней.
          </p>
        </div>
        <a className="admin-small-link" href="/admin/reports">Открыть отчёты</a>
      </div>

      <section className="admin-growth-metrics">
        <article><span>Всего клиентов</span><strong>{Number(metrics.total)}</strong><small>{money(metrics.lifetime_revenue)} за всё время</small></article>
        <article><span>Новые</span><strong>{Number(metrics.new_count)}</strong><small>0–1 заказ</small></article>
        <article><span>Постоянные</span><strong>{Number(metrics.regular_count)}</strong><small>2–4 заказа</small></article>
        <article className="success"><span>VIP</span><strong>{Number(metrics.vip_count)}</strong><small>ключевые клиенты</small></article>
        <article className={Number(metrics.inactive_count) ? "warning" : ""}><span>Неактивные</span><strong>{Number(metrics.inactive_count)}</strong><small>90+ дней без заказа</small></article>
        <article className={Number(metrics.bonus_debt_total) ? "danger" : ""}><span>Бонусы клиентов</span><strong>{money(metrics.bonus_balance_total)}</strong><small>долг: {money(metrics.bonus_debt_total)}</small></article>
      </section>

      <form className="admin-growth-filters" method="get">
        <label className="wide">
          <span>Поиск</span>
          <input name="q" defaultValue={q} placeholder="Имя, телефон, email или Telegram" />
        </label>
        <label>
          <span>Сегмент</span>
          <select name="segment" defaultValue={segment}>
            <option value="all">Все клиенты</option>
            <option value="new">Новые</option>
            <option value="regular">Постоянные</option>
            <option value="vip">VIP</option>
            <option value="inactive">Неактивные</option>
          </select>
        </label>
        <button type="submit">Применить</button>
        <a href="/admin/customers">Сбросить</a>
      </form>

      <section className="admin-panel admin-customer-list-panel">
        <div className="admin-panel-head">
          <div><span>По фильтру: {pagination.total}</span><h2>Клиентская база</h2></div>
        </div>

        {(data?.items ?? []).length ? (
          <div className="admin-customer-list">
            {(data?.items ?? []).map((customer) => (
              <a className="admin-customer-row" href={`/admin/customers/${customer.id}`} key={customer.id}>
                <div className="admin-customer-main">
                  <span className={`admin-segment ${customer.segment}`}>{segmentLabels[customer.segment]}</span>
                  <strong>{customer.name || "Клиент без имени"}</strong>
                  <small>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</small>
                </div>
                <div><span>Заказы</span><strong>{Number(customer.total_orders)}</strong><small>последний: {date(customer.last_order_at)}</small></div>
                <div><span>Покупки</span><strong>{money(customer.total_spent)}</strong><small>за всё время</small></div>
                <div className={Number(customer.bonus_debt) ? "danger-text" : ""}>
                  <span>Бонусы</span><strong>{money(customer.visible_bonus_balance)}</strong>
                  <small>{Number(customer.bonus_debt) ? `долг ${money(customer.bonus_debt)}` : "без долга"}</small>
                </div>
                <div>
                  <span>Telegram</span>
                  <strong>{customer.telegram_is_active ? "Подключён" : "Не подключён"}</strong>
                  <small>{customer.linked_telegram_username ? `@${customer.linked_telegram_username}` : "—"}</small>
                </div>
              </a>
            ))}
          </div>
        ) : <div className="admin-empty">Клиенты по выбранному фильтру не найдены.</div>}
      </section>

      <nav className="admin-notification-pagination" aria-label="Страницы клиентов">
        {pagination.page > 1 ? <a href={`/admin/customers${queryString({ q, segment, page: pagination.page - 1 })}`}>← Назад</a> : <span />}
        <strong>Страница {pagination.page} из {pagination.pages}</strong>
        {pagination.page < pagination.pages ? <a href={`/admin/customers${queryString({ q, segment, page: pagination.page + 1 })}`}>Дальше →</a> : <span />}
      </nav>
    </div>
  );
}
