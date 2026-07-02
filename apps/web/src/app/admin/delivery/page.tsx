import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  zones: AdminRow[];
  intervals: AdminRow[];
};

export default async function AdminDeliveryPage() {
  const data = await fetchAdmin<Response>("/api/admin/delivery");

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Логистика</span>
          <h1>Доставка</h1>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Зоны доставки</h2>
        </div>
        <AdminTable
          rows={data?.zones ?? []}
          emptyText="Зоны доставки пока не добавлены."
          columns={[
            { key: "name", label: "Название" },
            { key: "price", label: "Цена" },
            { key: "free_from_amount", label: "Бесплатно от" },
            { key: "is_express_available", label: "Срочная" },
            { key: "express_price", label: "Цена срочной" }
          ]}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Интервалы</h2>
        </div>
        <AdminTable
          rows={data?.intervals ?? []}
          emptyText="Интервалы пока не добавлены."
          columns={[
            { key: "name", label: "Название" },
            { key: "starts_at", label: "Начало" },
            { key: "ends_at", label: "Окончание" },
            { key: "is_active", label: "Активен" }
          ]}
        />
      </section>
    </div>
  );
}
