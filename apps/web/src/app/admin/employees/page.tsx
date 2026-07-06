import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import { EmployeeActions } from "./employee-actions";
import { EmployeeForm } from "./employee-form";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function bool(value: unknown) {
  return value === true || value === "true";
}

function roleText(role: unknown) {
  const value = text(role);

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
  return bool(value) ? "Активен" : "Отключён";
}

function telegramText(item: AdminRow) {
  const username = text(item.linked_telegram_username);
  const telegramId = text(item.linked_telegram_id);

  if (username) return `@${username}`;
  if (telegramId) return telegramId;

  return "";
}

export default async function AdminEmployeesPage() {
  const data = await fetchAdmin<Response>("/api/admin/employees");
  const rows = data?.items ?? [];

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

      <section className="admin-panel admin-employees-panel">
        <div className="admin-employees-table-wrap">
          <table className="admin-employees-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Управление</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((item) => {
                  const role = text(item.role);
                  const employeeId = text(item.id);
                  const name = text(item.name);
                  const phone = text(item.phone);
                  const email = text(item.email);
                  const isActive = bool(item.is_active);
                  const canManage = role !== "owner";

                  return (
                    <tr key={employeeId}>
                      <td>
                        <strong>{name || "—"}</strong>
                      </td>
                      <td>{phone || "—"}</td>
                      <td>{email || "—"}</td>
                      <td>{roleText(role)}</td>
                      <td>{activeText(isActive)}</td>
                      <td>
                        <EmployeeActions
                          employeeId={employeeId}
                          name={name}
                          phone={phone}
                          email={email}
                          role={role}
                          isActive={isActive}
                          canManage={canManage}
                          telegramLinkUrl={text(item.telegram_link_url)}
                          linkedTelegramText={telegramText(item)}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>Сотрудники пока не добавлены.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
