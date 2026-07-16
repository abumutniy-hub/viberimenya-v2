import { fetchAdmin } from "../lib/admin-api";
import {
  RevokeOtherSessionsButton,
  SecurityCleanupButton,
  SessionRevokeButton
} from "./security-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type SecurityData = {
  currentUser: {
    id: string;
    role: string;
  };
  policy: {
    sessionDays: number;
    maxActiveSessions: number;
    failedAttempts: number;
    blockMinutes: number;
    telegramCodeMinutes: number;
    passwordMinimumLength: number;
  };
  summary: Record<string, number> | null;
  sessions: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  employees: Array<Record<string, unknown>>;
  eventTypes: Array<{ event_type: string; total: number }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  florist: "Флорист",
  courier: "Курьер"
};

const severityLabels: Record<string, string> = {
  info: "Информация",
  warning: "Внимание",
  critical: "Критично"
};

const eventLabels: Record<string, string> = {
  "auth.login_success": "Успешный вход",
  "auth.login_failed": "Ошибка входа",
  "auth.login_blocked": "Вход заблокирован",
  "auth.logout": "Выход",
  "security.access_denied": "Отказ в доступе",
  "security.session_revoked": "Сеанс завершён",
  "security.other_sessions_revoked": "Другие сеансы завершены",
  "security.cleanup": "Очистка безопасности",
  "employee.changed": "Сотрудники",
  "order.changed": "Заказы",
  "finance.refund": "Возврат",
  "finance.changed": "Финансы",
  "catalog.changed": "Каталог",
  "delivery.changed": "Доставка",
  "settings.changed": "Настройки",
  "promocode.changed": "Промокоды",
  "customer.changed": "Клиенты и бонусы",
  "notification.changed": "Уведомления",
  "system.changed": "Системная операция",
  "system.settings_changed": "Настройки мониторинга",
  "admin.mutation": "Изменение CRM"
};

function first(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] || fallback : value || fallback;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function bool(value: unknown) {
  return value === true || value === "true";
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      query.set(key, String(value));
    }
  }

  const result = query.toString();
  return result ? `?${result}` : "";
}

export default async function SecurityPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const severity = first(params.severity, "all");
  const event = first(params.event, "all");
  const employeeId = first(params.employeeId);
  const days = Math.min(90, Math.max(1, Number(first(params.days, "14")) || 14));
  const page = Math.max(1, Number(first(params.page, "1")) || 1);
  const apiQuery = queryString({ q, severity, event, employeeId, days, page, pageSize: 50 });
  const data = await fetchAdmin<SecurityData>(`/api/admin/security${apiQuery}`);
  const summary = data?.summary ?? {};
  const policy = data?.policy;
  const pagination = data?.pagination ?? {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1
  };

  return (
    <div className="admin-page admin-security-page">
      <div className="admin-page-head admin-security-head">
        <div>
          <span>Доступы, входы и журнал действий</span>
          <h1>Безопасность CRM</h1>
          <p>
            Контроль активных сеансов, подозрительных входов и всех важных изменений сотрудников.
          </p>
        </div>

        <div className="admin-security-head-actions">
          <RevokeOtherSessionsButton />
          {data?.currentUser.role === "owner" ? <SecurityCleanupButton /> : null}
        </div>
      </div>

      <section className="admin-security-metrics">
        <article>
          <span>Активные сотрудники</span>
          <strong>{number(summary.active_employees)}</strong>
          <small>владельцев: {number(summary.active_owners)}</small>
        </article>
        <article>
          <span>Активные сеансы</span>
          <strong>{number(summary.active_sessions)}</strong>
          <small>устаревших: {number(summary.stale_sessions)}</small>
        </article>
        <article className={number(summary.failed_logins_24h) ? "warning" : ""}>
          <span>Ошибки входа за 24 часа</span>
          <strong>{number(summary.failed_logins_24h)}</strong>
          <small>блокировок: {number(summary.blocked_logins_24h)}</small>
        </article>
        <article className={number(summary.warnings_7d) ? "warning" : ""}>
          <span>Требуют внимания</span>
          <strong>{number(summary.warnings_7d)}</strong>
          <small>за последние 7 дней</small>
        </article>
      </section>

      {policy ? (
        <section className="admin-panel admin-security-policy">
          <div className="admin-panel-head">
            <div>
              <span>Действующие правила</span>
              <h2>Политика доступа</h2>
            </div>
          </div>
          <div className="admin-security-policy-grid">
            <span>Сессия: <strong>{policy.sessionDays} дней</strong></span>
            <span>Сеансов на сотрудника: <strong>до {policy.maxActiveSessions}</strong></span>
            <span>Блокировка входа: <strong>{policy.failedAttempts} ошибок / {policy.blockMinutes} минут</strong></span>
            <span>Telegram-код: <strong>{policy.telegramCodeMinutes} минут</strong></span>
            <span>Пароль: <strong>от {policy.passwordMinimumLength} символов, буква и цифра</strong></span>
          </div>
        </section>
      ) : null}

      <section className="admin-panel admin-security-role-matrix">
        <div className="admin-panel-head">
          <div>
            <span>Кто и что может делать</span>
            <h2>Матрица ролей</h2>
            <p>Ограничения проверяются сервером, а не только скрытием кнопок в интерфейсе.</p>
          </div>
        </div>
        <div className="admin-security-role-grid">
          <article><strong>Владелец</strong><span>Все разделы, финансы, возвраты, сотрудники, безопасность и настройки.</span></article>
          <article><strong>Администратор</strong><span>Управление магазином и сотрудниками, без действий над сеансами владельца.</span></article>
          <article><strong>Менеджер</strong><span>Заказы, клиенты, отчёты, уведомления и просмотр финансов без системных настроек.</span></article>
          <article><strong>Флорист</strong><span>Только назначенные заказы, сборка, фото букета и рабочий чат.</span></article>
          <article><strong>Курьер</strong><span>Только назначенные доставки, статусы, проблемы и фото вручения.</span></article>
        </div>
      </section>

      <section className="admin-panel admin-security-sessions">
        <div className="admin-panel-head">
          <div>
            <span>Устройства, на которых открыта CRM</span>
            <h2>Активные сеансы</h2>
          </div>
        </div>

        {(data?.sessions ?? []).length ? (
          <div className="admin-security-table-wrap">
            <table className="admin-table admin-security-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Устройство</th>
                  <th>IP</th>
                  <th>Активность</th>
                  <th>Истекает</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {(data?.sessions ?? []).map((session) => {
                  const current = bool(session.is_current);
                  const name = text(session.name) || text(session.email) || text(session.phone) || "Сотрудник";

                  return (
                    <tr key={text(session.session_key)} className={current ? "current" : ""}>
                      <td>
                        <strong>{name}</strong>
                        <small>{roleLabels[text(session.role)] || text(session.role)}</small>
                      </td>
                      <td>
                        <strong>{text(session.device) || "Неизвестно"}</strong>
                        <small>{current ? "Текущий сеанс" : `Открыт ${dateText(session.created_at)}`}</small>
                      </td>
                      <td>{text(session.ip) || "—"}</td>
                      <td>{dateText(session.last_activity_at)}</td>
                      <td>{dateText(session.expires_at)}</td>
                      <td>
                        {current ? (
                          <span className="admin-security-current">Сейчас</span>
                        ) : (
                          <SessionRevokeButton
                            sessionKey={text(session.session_key)}
                            employeeName={name}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">Активных сеансов нет.</div>
        )}
      </section>

      <form className="admin-security-filters" method="get">
        <label>
          <span>Период</span>
          <select name="days" defaultValue={String(days)}>
            <option value="1">24 часа</option>
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
          </select>
        </label>
        <label>
          <span>Важность</span>
          <select name="severity" defaultValue={severity}>
            <option value="all">Все</option>
            <option value="info">Информация</option>
            <option value="warning">Внимание</option>
            <option value="critical">Критично</option>
          </select>
        </label>
        <label>
          <span>Событие</span>
          <select name="event" defaultValue={event}>
            <option value="all">Все события</option>
            {(data?.eventTypes ?? []).map((item) => (
              <option key={item.event_type} value={item.event_type}>
                {eventLabels[item.event_type] || item.event_type} ({item.total})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Сотрудник</span>
          <select name="employeeId" defaultValue={employeeId}>
            <option value="">Все сотрудники</option>
            {(data?.employees ?? []).map((employee) => (
              <option key={text(employee.user_id)} value={text(employee.user_id)}>
                {text(employee.name) || "Без имени"} · {roleLabels[text(employee.role)] || text(employee.role)}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>Поиск</span>
          <input name="q" defaultValue={q} placeholder="Действие, IP или идентификатор" />
        </label>
        <button type="submit">Применить</button>
        <a href="/admin/security">Сбросить</a>
      </form>

      <section className="admin-panel admin-security-events">
        <div className="admin-panel-head">
          <div>
            <span>Найдено: {pagination.total}</span>
            <h2>Журнал действий</h2>
          </div>
        </div>

        {(data?.events ?? []).length ? (
          <div className="admin-security-event-list">
            {(data?.events ?? []).map((eventItem) => {
              const severityValue = text(eventItem.severity) || "info";
              const actor = text(eventItem.actor_name) || (text(eventItem.actor_user_id) ? "Сотрудник" : "Система / неизвестный вход");

              return (
                <article key={text(eventItem.id)} className={`severity-${severityValue}`}>
                  <div className="admin-security-event-mark" />
                  <div>
                    <div className="admin-security-event-title">
                      <strong>{eventLabels[text(eventItem.event_type)] || text(eventItem.event_type)}</strong>
                      <span>{severityLabels[severityValue] || severityValue}</span>
                    </div>
                    <p>{text(eventItem.summary)}</p>
                    <small>
                      {actor}
                      {text(eventItem.actor_role) ? ` · ${roleLabels[text(eventItem.actor_role)] || text(eventItem.actor_role)}` : ""}
                      {text(eventItem.ip) ? ` · IP ${text(eventItem.ip)}` : ""}
                      {text(eventItem.device) ? ` · ${text(eventItem.device)}` : ""}
                    </small>
                  </div>
                  <time>{dateText(eventItem.created_at)}</time>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">События по выбранному фильтру не найдены.</div>
        )}
      </section>

      <nav className="admin-security-pagination" aria-label="Страницы журнала безопасности">
        {pagination.page > 1 ? (
          <a href={`/admin/security${queryString({ q, severity, event, employeeId, days, page: pagination.page - 1 })}`}>
            ← Назад
          </a>
        ) : <span />}
        <strong>Страница {pagination.page} из {pagination.totalPages}</strong>
        {pagination.page < pagination.totalPages ? (
          <a href={`/admin/security${queryString({ q, severity, event, employeeId, days, page: pagination.page + 1 })}`}>
            Дальше →
          </a>
        ) : <span />}
      </nav>
    </div>
  );
}
