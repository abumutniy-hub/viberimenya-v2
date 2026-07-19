import { AdminTable } from "./components/admin-table";
import { fetchAdmin, type AdminRow } from "./lib/admin-api";

export const dynamic = "force-dynamic";

type DashboardResponse = {
  shop: {
    name: string;
    status: string;
  };
  metrics: {
    orders: number;
    ordersToday: number;
    activeOrders: number;
    problemOrders: number;
    pendingPayments: number;
    paidRevenue: number;
    paidRevenueToday: number;
    averageCheck: number;
    products: number;
    activeProducts: number;
    lowStockProducts: number;
    outOfStockProducts: number;
    customers: number;
    categories: number;
    deliveryZones: number;
    pendingNotifications: number;
    processingNotifications: number;
    failedNotifications: number;
  };
  statusBreakdown: AdminRow[];
  latestOrders: AdminRow[];
  lowStockProducts: AdminRow[];
};

const orderStatusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  assembling: "Собирается",
  ready: "Готов",
  assigned_courier: "Передан курьеру",
  delivering: "В доставке",
  delivered: "Доставлен",
  cancelled: "Отменён",
  problem: "Проблема"
};

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown) {
  return `${numberValue(value).toLocaleString("ru-RU")} ₽`;
}

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function statusClass(value: unknown) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "-");
}

export default async function AdminDashboardPage() {
  const data = await fetchAdmin<DashboardResponse>("/api/admin/dashboard");

  const metrics = data?.metrics ?? {
    orders: 0,
    ordersToday: 0,
    activeOrders: 0,
    problemOrders: 0,
    pendingPayments: 0,
    paidRevenue: 0,
    paidRevenueToday: 0,
    averageCheck: 0,
    products: 0,
    activeProducts: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
    customers: 0,
    categories: 0,
    deliveryZones: 0,
    pendingNotifications: 0,
    processingNotifications: 0,
    failedNotifications: 0
  };

  const statuses = new Map(
    (data?.statusBreakdown ?? []).map((item) => [
      String(item.status ?? ""),
      numberValue(item.count)
    ])
  );

  const needsAttention =
    metrics.problemOrders
    + metrics.pendingPayments
    + metrics.lowStockProducts
    + metrics.outOfStockProducts
    + metrics.failedNotifications;

  return (
    <div className="admin-page admin-dashboard-page">
      <div className="admin-page-head admin-dashboard-head">
        <div>
          <span>Обзор магазина</span>
          <h1>Дашборд</h1>
          <p>
            Оперативная картина по заказам, оплатам, выручке и остаткам.
          </p>
        </div>

        <div className="admin-dashboard-shop-state">
          <strong>{data?.shop.name ?? "ВЫБЕРИ МЕНЯ"}</strong>
          <span>{data?.shop.status === "active" ? "Магазин активен" : "Проверьте статус магазина"}</span>
        </div>
      </div>

      <section className="admin-dashboard-primary-metrics">
        <article>
          <span>Заказы сегодня</span>
          <strong>{metrics.ordersToday}</strong>
          <small>Всего: {metrics.orders}</small>
        </article>

        <article>
          <span>Выручка сегодня</span>
          <strong>{money(metrics.paidRevenueToday)}</strong>
          <small>Только оплаченные заказы</small>
        </article>

        <article>
          <span>Активные заказы</span>
          <strong>{metrics.activeOrders}</strong>
          <small>Не доставлены и не отменены</small>
        </article>

        <article className={needsAttention > 0 ? "warning" : ""}>
          <span>Требуют внимания</span>
          <strong>{needsAttention}</strong>
          <small>Проблемы, оплаты и остатки</small>
        </article>
      </section>

      <section className="admin-dashboard-secondary-grid">
        <article className="admin-panel admin-dashboard-finance-card">
          <div className="admin-panel-head">
            <div>
              <span>Финансы</span>
              <h2>Оплаченные заказы</h2>
            </div>
          </div>

          <div className="admin-dashboard-kpi-list">
            <div>
              <span>Общая выручка</span>
              <strong>{money(metrics.paidRevenue)}</strong>
            </div>
            <div>
              <span>Средний чек</span>
              <strong>{money(metrics.averageCheck)}</strong>
            </div>
            <div className={metrics.pendingPayments > 0 ? "warning" : ""}>
              <span>Ожидают оплаты</span>
              <strong>{metrics.pendingPayments}</strong>
            </div>
          </div>

          <a className="admin-dashboard-action-link" href="/admin/orders?attention=pending_payment">
            Открыть неоплаченные заказы
          </a>
        </article>

        <article className="admin-panel admin-dashboard-status-card">
          <div className="admin-panel-head">
            <div>
              <span>Производство</span>
              <h2>Заказы по этапам</h2>
            </div>
          </div>

          <div className="admin-dashboard-status-grid">
            {["new", "confirmed", "assembling", "ready", "assigned_courier", "delivering", "problem"].map((status) => (
              <a
                key={status}
                href={`/admin/orders?status=${status}`}
                className={status === "problem" && numberValue(statuses.get(status)) > 0 ? "warning" : ""}
              >
                <span>{orderStatusLabels[status]}</span>
                <strong>{numberValue(statuses.get(status))}</strong>
              </a>
            ))}
          </div>
        </article>
      </section>

      <section className="admin-dashboard-secondary-grid">
        <article className="admin-panel admin-dashboard-catalog-card">
          <div className="admin-panel-head">
            <div>
              <span>Каталог</span>
              <h2>Ассортимент и остатки</h2>
            </div>
            <a href="/admin/catalog">Каталог</a>
          </div>

          <div className="admin-dashboard-kpi-list compact">
            <div>
              <span>Товаров</span>
              <strong>{metrics.products}</strong>
            </div>
            <div>
              <span>Опубликовано</span>
              <strong>{metrics.activeProducts}</strong>
            </div>
            <div className={metrics.lowStockProducts > 0 ? "warning" : ""}>
              <span>Заканчиваются</span>
              <strong>{metrics.lowStockProducts}</strong>
            </div>
            <div className={metrics.outOfStockProducts > 0 ? "danger" : ""}>
              <span>Нет в наличии</span>
              <strong>{metrics.outOfStockProducts}</strong>
            </div>
          </div>

          {(data?.lowStockProducts ?? []).length ? (
            <div className="admin-dashboard-stock-list">
              {(data?.lowStockProducts ?? []).map((product) => (
                <a key={String(product.id)} href={`/admin/catalog/products/${String(product.id)}`}>
                  <div>
                    <strong>{text(product.name)}</strong>
                    <span>{text(product.category_name, "Без категории")}</span>
                  </div>
                  <em>{numberValue(product.stock_quantity)} шт.</em>
                </a>
              ))}
            </div>
          ) : (
            <p className="admin-dashboard-empty-note">Критичных остатков сейчас нет.</p>
          )}
        </article>

        <article className="admin-panel admin-dashboard-store-card">
          <div className="admin-panel-head">
            <div>
              <span>Магазин</span>
              <h2>Основные показатели</h2>
            </div>
          </div>

          <div className="admin-dashboard-kpi-list compact">
            <div>
              <span>Клиенты</span>
              <strong>{metrics.customers}</strong>
            </div>
            <div>
              <span>Категории</span>
              <strong>{metrics.categories}</strong>
            </div>
            <div>
              <span>Активные зоны</span>
              <strong>{metrics.deliveryZones}</strong>
            </div>
            <div>
              <span>Доставлено</span>
              <strong>{numberValue(statuses.get("delivered"))}</strong>
            </div>
          </div>

          <div className="admin-dashboard-quick-links">
            <a href="/admin/delivery">Настроить доставку</a>
            <a href="/admin/customers">Открыть клиентов</a>
            <a href="/admin/settings">Настройки магазина</a>
          </div>
        </article>
      </section>

      <section className="admin-panel admin-dashboard-notification-card">
        <div className="admin-panel-head">
          <div>
            <span>Связь с клиентами и командой</span>
            <h2>Telegram-уведомления</h2>
          </div>
          <a href="/admin/notifications">Центр уведомлений</a>
        </div>

        <div className="admin-dashboard-notification-grid">
          <a href="/admin/notifications?status=pending">
            <span>Ожидают отправки</span>
            <strong>{metrics.pendingNotifications}</strong>
          </a>
          <a href="/admin/notifications?status=processing">
            <span>Отправляются</span>
            <strong>{metrics.processingNotifications}</strong>
          </a>
          <a
            href="/admin/notifications?status=dead"
            className={metrics.failedNotifications > 0 ? "danger" : ""}
          >
            <span>Dead-letter / частично</span>
            <strong>{metrics.failedNotifications}</strong>
          </a>
        </div>
      </section>

      <section className="admin-panel admin-dashboard-latest-orders">
        <div className="admin-panel-head">
          <div>
            <span>Последние события</span>
            <h2>Последние заказы</h2>
          </div>
          <a href="/admin/orders">Все заказы</a>
        </div>

        <AdminTable
          rows={data?.latestOrders ?? []}
          emptyText="Заказов пока нет."
          columns={[
            {
              key: "order_number",
              label: "Заказ",
              render: (row) => (
                <a className="admin-dashboard-order-link" href={`/admin/orders/${String(row.id)}`}>
                  {text(row.order_number)}
                </a>
              )
            },
            {
              key: "customer_name",
              label: "Клиент",
              render: (row) => (
                <div className="admin-dashboard-customer-cell">
                  <strong>{text(row.customer_name, "Без имени")}</strong>
                  <span>{text(row.customer_phone, "Телефон не указан")}</span>
                </div>
              )
            },
            {
              key: "status",
              label: "Статус",
              render: (row) => {
                const status = String(row.status ?? "");
                return (
                  <span className={`admin-status-chip status-${statusClass(status)}`}>
                    {orderStatusLabels[status] || status || "—"}
                  </span>
                );
              }
            },
            { key: "payment_status", label: "Оплата" },
            {
              key: "total_amount",
              label: "Сумма",
              render: (row) => <strong>{money(row.total_amount)}</strong>
            },
            { key: "created_at", label: "Создан", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
