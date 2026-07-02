import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];
};

export default async function AdminCustomersPage() {
  const data = await fetchAdmin<Response>("/api/admin/customers");

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>База</span>
          <h1>Клиенты</h1>
        </div>
      </div>

      <section className="admin-panel">
        <AdminTable
          rows={data?.items ?? []}
          emptyText="Клиентов пока нет."
          columns={[
            { key: "name", label: "Имя" },
            { key: "phone", label: "Телефон" },
            { key: "email", label: "Email" },
            { key: "bonus_balance", label: "Бонусы" },
            { key: "created_at", label: "Создан", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
