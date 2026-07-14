import {
  fetchAdmin,
  type AdminRow
} from "../lib/admin-api";

import { EmployeeActions } from "./employee-actions";
import { EmployeeForm } from "./employee-form";

export const dynamic =
  "force-dynamic";

type EmployeesResponse = {
  items: AdminRow[];
};

function text(value: unknown) {
  return String(
    value ?? ""
  ).trim();
}

function bool(value: unknown) {
  return (
    value === true
    || value === "true"
  );
}

function number(value: unknown) {
  const parsed =
    Number(value ?? 0);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function roleText(value: unknown) {
  const role = text(value);

  const roles:
    Record<string, string> = {
      owner: "Владелец",
      admin: "Администратор",
      manager: "Менеджер",
      florist: "Флорист",
      courier: "Курьер"
    };

  return roles[role] || role || "—";
}

function telegramText(
  item: AdminRow
) {
  const username =
    text(
      item.linked_telegram_username
    );

  if (username) {
    return `@${username}`;
  }

  return text(
    item.linked_telegram_id
  );
}

export default async function AdminEmployeesPage() {
  const data =
    await fetchAdmin<EmployeesResponse>(
      "/api/admin/employees"
    );

  const rows =
    data?.items ?? [];

  return (
    <div className="admin-page admin-employees-workspace">
      <div className="admin-page-head">
        <div>
          <span>Команда</span>
          <h1>Сотрудники</h1>
        </div>
      </div>

      <section className="admin-panel admin-employee-create-panel">
        <div className="admin-panel-head">
          <div>
            <span>
              Новый сотрудник
            </span>

            <h2>
              Добавить в команду
            </h2>

            <p>
              Все сотрудники входят
              через общую страницу CRM
              по своему телефону или Email.
            </p>
          </div>
        </div>

        <EmployeeForm />
      </section>

      <section className="admin-panel admin-employees-panel">
        <div className="admin-panel-head admin-employees-list-head">
          <div>
            <span>Команда магазина</span>

            <h2>
              Сотрудники и доступы
            </h2>

            <p>
              Всего в системе: {rows.length}.
              Управляйте входом в CRM,
              Telegram и рабочими ролями.
            </p>
          </div>
        </div>

        <div className="admin-employees-table-wrap">
          <table className="admin-employees-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Доступ</th>
                <th>Управление</th>
              </tr>
            </thead>

            <tbody>
              {rows.length ? (
                rows.map(item => {
                  const employeeId =
                    text(item.id);

                  const role =
                    text(item.role);

                  const isActive =
                    bool(item.is_active);

                  const activeSessions =
                    number(
                      item.active_sessions
                    );

                  const hasPassword =
                    bool(
                      item.has_password
                    );

                  return (
                    <tr key={employeeId}>
                      <td>
                        <strong>
                          {text(item.name)
                            || "—"}
                        </strong>
                      </td>

                      <td>
                        {text(item.phone)
                          || "—"}
                      </td>

                      <td>
                        {text(item.email)
                          || "—"}
                      </td>

                      <td>
                        {roleText(role)}
                      </td>

                      <td>
                        {isActive
                          ? "Активен"
                          : "Отключён"}
                      </td>

                      <td>
                        <strong>
                          {hasPassword
                            ? "Пароль установлен"
                            : "Нет пароля"}
                        </strong>

                        <br />

                        <span>
                          Сеансов:{" "}
                          {activeSessions}
                        </span>
                      </td>

                      <td>
                        <EmployeeActions
                          employeeId={
                            employeeId
                          }
                          name={
                            text(item.name)
                          }
                          phone={
                            text(item.phone)
                          }
                          email={
                            text(item.email)
                          }
                          role={role}
                          isActive={
                            isActive
                          }
                          canManage={
                            role !== "owner"
                          }
                          telegramLinkCode={
                            text(
                              item.telegram_link_code
                            )
                          }
                          linkedTelegramText={
                            telegramText(item)
                          }
                          lastLoginAt={
                            text(
                              item.last_login_at
                            )
                          }
                          activeSessions={
                            activeSessions
                          }
                          hasPassword={
                            hasPassword
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>
                    Сотрудники пока
                    не добавлены.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
