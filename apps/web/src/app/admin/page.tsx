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
    products: number;
    customers: number;
    categories: number;
    deliveryZones: number;
  };
  latestOrders: AdminRow[];
};

export default async function AdminDashboardPage() {
  const data = await fetchAdmin<DashboardResponse>("/api/admin/dashboard");

  const metrics = data?.metrics ?? {
    orders: 0,
    products: 0,
    customers: 0,
    categories: 0,
    deliveryZones: 0
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Обзор</span>
          <h1>Дашборд</h1>
        </div>
        <p>{data?.shop.name ?? "ВЫБЕРИ МЕНЯ"}</p>
      </div>

      <div className="admin-metrics">
        <div><span>Заказы</span><strong>{metrics.orders}</strong></div>
        <div><span>Товары</span><strong>{metrics.products}</strong></div>
        <div><span>Клиенты</span><strong>{metrics.customers}</strong></div>
        <div><span>Категории</span><strong>{metrics.categories}</strong></div>
        <div><span>Зоны доставки</span><strong>{metrics.deliveryZones}</strong></div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Последние заказы</h2>
          <a href="/admin/orders">Все заказы</a>
        </div>

        <AdminTable
          rows={data?.latestOrders ?? []}
          emptyText="Заказов пока нет."
          columns={[
            { key: "order_number", label: "Номер" },
            { key: "status", label: "Статус" },
            { key: "payment_status", label: "Оплата" },
            { key: "total_amount", label: "Сумма" },
            { key: "created_at", label: "Создан", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
