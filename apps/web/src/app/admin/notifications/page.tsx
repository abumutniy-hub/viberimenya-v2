import { fetchAdmin } from "../lib/admin-api";
import { NotificationActions, RetryFailedNotifications } from "./notification-actions";

export const dynamic = "force-dynamic";

type NotificationEventRow = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  type: string;
  recipient_type: string;
  recipient_telegram_id: string | null;
  status: string;
  attempts: number;
  error: string | null;
  sent_at: string | null;
  created_at: string;
};

type ResponseData = {
  metrics: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    skipped: number;
    sent_today: number;
  };
  events: NotificationEventRow[];
  types: Array<{ type: string; count: number }>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabels: Record<string, string> = {
  pending: "Ожидает",
  processing: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  skipped: "Пропущено"
};

const recipientLabels: Record<string, string> = {
  customer: "Покупатель",
  staff: "Сотрудник"
};

const eventLabels: Record<string, string> = {
  order_created: "Новый заказ",
  order_confirmed: "Заказ подтверждён",
  payment_link_added: "Ссылка оплаты",
  order_paid: "Оплата получена",
  bouquet_approval_requested: "Фото на согласование",
  bouquet_approved: "Букет одобрен",
  bouquet_revision_requested: "Запрошена правка",
  order_ready: "Букет готов",
  order_courier_assigned: "Передан курьеру",
  order_delivering: "Курьер выехал",
  order_delivered: "Заказ доставлен",
  order_problem: "Проблема по заказу",
  order_cancelled: "Заказ отменён",
  order_refunded: "Возврат зафиксирован",
  florist_order_assigned: "Назначение флористу",
  courier_order_assigned: "Назначение курьеру",
  customer_login_code: "Код входа",
  internal_chat_message: "Сообщение команды"
};

function first(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] || fallback : value || fallback;
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
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

  const text = query.toString();
  return text ? `?${text}` : "";
}

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status, "all");
  const recipientType = first(params.recipientType, "all");
  const type = first(params.type);
  const q = first(params.q);
  const page = Math.max(1, Number(first(params.page, "1")) || 1);

  const apiQuery = queryString({ status, recipientType, type, q, page, pageSize: 30 });
  const data = await fetchAdmin<ResponseData>(`/api/admin/notifications${apiQuery}`);
  const metrics = data?.metrics ?? {
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    sent_today: 0
  };
  const pagination = data?.pagination ?? {
    page: 1,
    pageSize: 30,
    total: 0,
    pages: 1
  };

  return (
    <div className="admin-page admin-notifications-page">
      <div className="admin-page-head">
        <div>
          <span>Telegram и системные события</span>
          <h1>Центр уведомлений</h1>
          <p>Контроль отправки клиентам и сотрудникам, повтор ошибок и отключённых получателей.</p>
        </div>
        <RetryFailedNotifications />
      </div>

      <section className="admin-notification-metrics">
        <a href="/admin/notifications?status=pending"><span>Ожидают</span><strong>{metrics.pending}</strong></a>
        <a href="/admin/notifications?status=processing"><span>Отправляются</span><strong>{metrics.processing}</strong></a>
        <a href="/admin/notifications?status=failed" className={metrics.failed ? "danger" : ""}><span>Ошибки</span><strong>{metrics.failed}</strong></a>
        <a href="/admin/notifications?status=skipped"><span>Пропущены</span><strong>{metrics.skipped}</strong></a>
        <a href="/admin/notifications?status=sent"><span>Сегодня отправлено</span><strong>{metrics.sent_today}</strong></a>
      </section>

      <form className="admin-notification-filters" method="get">
        <label>
          <span>Статус</span>
          <select name="status" defaultValue={status}>
            <option value="all">Все</option>
            <option value="pending">Ожидают</option>
            <option value="processing">Отправляются</option>
            <option value="sent">Отправлено</option>
            <option value="failed">Ошибки</option>
            <option value="skipped">Пропущено</option>
          </select>
        </label>
        <label>
          <span>Получатель</span>
          <select name="recipientType" defaultValue={recipientType}>
            <option value="all">Все</option>
            <option value="customer">Покупатель</option>
            <option value="staff">Сотрудник</option>
          </select>
        </label>
        <label>
          <span>Событие</span>
          <select name="type" defaultValue={type}>
            <option value="">Все события</option>
            {(data?.types ?? []).map((item) => (
              <option key={item.type} value={item.type}>
                {eventLabels[item.type] || item.type} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>Поиск</span>
          <input name="q" defaultValue={q} placeholder="Номер заказа, тип, Telegram ID или ошибка" />
        </label>
        <button type="submit">Применить</button>
        <a href="/admin/notifications">Сбросить</a>
      </form>

      <section className="admin-panel admin-notification-list">
        <div className="admin-panel-head">
          <div>
            <span>Всего по фильтру: {pagination.total}</span>
            <h2>Журнал отправки</h2>
          </div>
        </div>

        {(data?.events ?? []).length ? (
          <div className="admin-notification-table-wrap">
            <table className="admin-table admin-notification-table">
              <thead>
                <tr>
                  <th>Событие</th>
                  <th>Получатель</th>
                  <th>Статус</th>
                  <th>Попытки</th>
                  <th>Дата</th>
                  <th>Ошибка / действие</th>
                </tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((event) => (
                  <tr key={event.id}>
                    <td>
                      <strong>{eventLabels[event.type] || event.type}</strong>
                      {event.order_id ? (
                        <a href={`/admin/orders/${event.order_id}`}>{event.order_number || "Открыть заказ"}</a>
                      ) : <small>Без заказа</small>}
                    </td>
                    <td>
                      <strong>{recipientLabels[event.recipient_type] || event.recipient_type}</strong>
                      <small>{event.recipient_telegram_id || "Определяется автоматически"}</small>
                    </td>
                    <td>
                      <span className={`admin-notification-status ${event.status}`}>
                        {statusLabels[event.status] || event.status}
                      </span>
                    </td>
                    <td>{event.attempts}</td>
                    <td>
                      <span>{dateText(event.created_at)}</span>
                      {event.sent_at ? <small>Отправлено: {dateText(event.sent_at)}</small> : null}
                    </td>
                    <td>
                      {event.error ? <p className="admin-notification-error">{event.error}</p> : <small>Ошибок нет</small>}
                      <NotificationActions id={event.id} status={event.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">Уведомления по выбранному фильтру не найдены.</div>
        )}
      </section>

      <nav className="admin-notification-pagination" aria-label="Страницы уведомлений">
        {pagination.page > 1 ? (
          <a href={`/admin/notifications${queryString({ status, recipientType, type, q, page: pagination.page - 1 })}`}>← Назад</a>
        ) : <span />}
        <strong>Страница {pagination.page} из {pagination.pages}</strong>
        {pagination.page < pagination.pages ? (
          <a href={`/admin/notifications${queryString({ status, recipientType, type, q, page: pagination.page + 1 })}`}>Дальше →</a>
        ) : <span />}
      </nav>
    </div>
  );
}
