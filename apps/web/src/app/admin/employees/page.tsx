import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import { EmployeeForm } from "./employee-form";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];
};

function roleText(role: unknown) {
  const value = String(role || "");

  const map: Record<string, string> = {
    owner: "Владелец",
    admin: "Администратор",
    manager: "Менеджер",
    florist: "Флорист",
    courier: "Курьер"
  };

  return map[value] || value || "—";
}

function activeText(value: unknown) {
  return value === true || value === "true" ? "Активен" : "Отключён";
}

export default async function AdminEmployeesPage() {
  const data = await fetchAdmin<Response>("/api/admin/employees");

  const rows = (data?.items ?? []).map((item) => ({
    ...item,
    role_label: roleText(item.role),
    active_label: activeText(item.is_active)
  }));

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Команда</span>
          <h1>Сотрудники</h1>
        </div>
      </div>

      <section className="admin-panel admin-employee-create-panel">
        <div className="admin-panel-head">
          <div>
            <span>Новый сотрудник</span>
            <h2>Добавить в команду</h2>
          </div>
        </div>
        <EmployeeForm />
      </section>

      <section className="admin-panel">
        <AdminTable
          rows={rows}
          emptyText="Сотрудники пока не добавлены."
          columns={[
            { key: "name", label: "Сотрудник" },
            { key: "phone", label: "Телефон" },
            { key: "email", label: "Email" },
            { key: "role_label", label: "Роль" },
            { key: "active_label", label: "Статус" },
            { key: "created_at", label: "Добавлен", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
