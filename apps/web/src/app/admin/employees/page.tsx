import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];
};

export default async function AdminEmployeesPage() {
  const data = await fetchAdmin<Response>("/api/admin/employees");

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Команда</span>
          <h1>Сотрудники</h1>
        </div>
      </div>

      <section className="admin-panel">
        <AdminTable
          rows={data?.items ?? []}
          emptyText="Сотрудники пока не добавлены."
          columns={[
            { key: "user_id", label: "Пользователь" },
            { key: "role", label: "Роль" },
            { key: "created_at", label: "Создан", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
