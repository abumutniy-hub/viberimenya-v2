import { fetchAdmin } from "../lib/admin-api";
import {
  DeliveryActions,
  NotificationActions,
  NotificationBulkActions
} from "./notification-actions";

export const dynamic = "force-dynamic";

type DeliveryRow = {
  id: string;
  channel: string;
  recipientType: string;
  recipientRole: string | null;
  recipientAddress: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  providerMessageId: string | null;
  lastError: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type OutboxRow = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  template_key: string;
  channel: string;
  recipient_type: string;
  recipient_role: string | null;
  recipient_address_masked: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  last_error: string | null;
  sent_at: string | null;
  dead_at: string | null;
  created_at: string;
  updated_at: string;
  deliveries_total: number;
  deliveries_pending: number;
  deliveries_processing: number;
  deliveries_sent: number;
  deliveries_failed: number;
  deliveries_skipped: number;
  deliveries: DeliveryRow[];
};

type AuditRow = {
  id: string;
  actor_name: string | null;
  actor_role: string | null;
  summary: string;
  entity_id: string | null;
  created_at: string;
};

type ResponseData = {
  metrics: {
    pending: number;
    processing: number;
    sent: number;
    partial: number;
    skipped: number;
    dead: number;
    sent_today: number;
    dead_24h: number;
    failed_deliveries: number;
    stale_outbox_processing: number;
    stale_delivery_processing: number;
    oldest_pending_minutes: number;
    success_rate_24h: number;
  };
  outboxes: OutboxRow[];
  types: Array<{ type: string; count: number }>;
  channels: Array<{ channel: string; count: number }>;
  audit: AuditRow[];
  permissions: {
    canDeactivateRecipient: boolean;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabels: Record<string, string> = {
  pending: "Ожидает",
  processing: "Обрабатывается",
  sent: "Доставлено",
  partial: "Частично",
  skipped: "Пропущено",
  dead: "Dead-letter",
  failed: "Ошибка"
};

const recipientLabels: Record<string, string> = {
  customer: "Покупатель",
  staff: "Сотрудник"
};

const channelLabels: Record<string, string> = {
  telegram: "Telegram",
  site: "Сайт",
  max: "MAX"
};

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  florist: "Флорист",
  courier: "Курьер"
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

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function deliverySummary(outbox: OutboxRow) {
  const parts = [
    outbox.deliveries_sent ? `доставлено ${outbox.deliveries_sent}` : "",
    outbox.deliveries_pending ? `ожидает ${outbox.deliveries_pending}` : "",
    outbox.deliveries_processing ? `в работе ${outbox.deliveries_processing}` : "",
    outbox.deliveries_failed ? `ошибок ${outbox.deliveries_failed}` : "",
    outbox.deliveries_skipped ? `пропущено ${outbox.deliveries_skipped}` : ""
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "Получатели ещё не рассчитаны";
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const status = first(params.status, "all");
  const channel = first(params.channel, "all");
  const recipientType = first(params.recipientType, "all");
  const type = first(params.type);
  const q = first(params.q);
  const page = Math.max(1, Number(first(params.page, "1")) || 1);

  const apiQuery = queryString({
    status,
    channel,
    recipientType,
    type,
    q,
    page,
    pageSize: 30
  });
  const data = await fetchAdmin<ResponseData>(
    `/api/admin/notifications${apiQuery}`
  );
  const metrics = data?.metrics ?? {
    pending: 0,
    processing: 0,
    sent: 0,
    partial: 0,
    skipped: 0,
    dead: 0,
    sent_today: 0,
    dead_24h: 0,
    failed_deliveries: 0,
    stale_outbox_processing: 0,
    stale_delivery_processing: 0,
    oldest_pending_minutes: 0,
    success_rate_24h: 100
  };
  const pagination = data?.pagination ?? {
    page: 1,
    pageSize: 30,
    total: 0,
    pages: 1
  };
  const staleCount = numberValue(metrics.stale_outbox_processing)
    + numberValue(metrics.stale_delivery_processing);
  const dangerCount = numberValue(metrics.dead)
    + numberValue(metrics.partial)
    + numberValue(metrics.failed_deliveries)
    + staleCount;

  return (
    <div className="admin-page admin-notifications-page">
      <div className="admin-page-head">
        <div>
          <span>Outbox, доставки и dead-letter</span>
          <h1>Центр уведомлений</h1>
          <p>
            Контроль очереди, индивидуальных Telegram-доставок, повторных
            попыток и отключённых получателей.
          </p>
        </div>
        <NotificationBulkActions
          deadCount={numberValue(metrics.dead) + numberValue(metrics.partial)}
          staleCount={staleCount}
        />
      </div>

      <section
        className={`admin-notification-health ${dangerCount ? "warning" : "healthy"}`}
      >
        <div>
          <strong>
            {dangerCount
              ? "Очередь требует внимания"
              : "Очередь работает штатно"}
          </strong>
          <span>
            {dangerCount
              ? `Проблемных записей: ${dangerCount}. Проверьте dead-letter, частичные и зависшие доставки.`
              : "Dead-letter, частичных и зависших доставок сейчас нет."}
          </span>
        </div>
        <div className="admin-notification-health-kpis">
          <span>Успех за 24 часа <strong>{numberValue(metrics.success_rate_24h)}%</strong></span>
          <span>Старейшая очередь <strong>{numberValue(metrics.oldest_pending_minutes)} мин.</strong></span>
        </div>
      </section>

      <section className="admin-notification-metrics">
        <a href="/admin/notifications?status=pending">
          <span>Ожидают</span>
          <strong>{metrics.pending}</strong>
        </a>
        <a href="/admin/notifications?status=processing">
          <span>В обработке</span>
          <strong>{metrics.processing}</strong>
        </a>
        <a href="/admin/notifications?status=partial" className={metrics.partial ? "danger" : ""}>
          <span>Частично</span>
          <strong>{metrics.partial}</strong>
        </a>
        <a href="/admin/notifications?status=dead" className={metrics.dead ? "danger" : ""}>
          <span>Dead-letter</span>
          <strong>{metrics.dead}</strong>
        </a>
        <a href="/admin/notifications?status=skipped">
          <span>Пропущены</span>
          <strong>{metrics.skipped}</strong>
        </a>
        <a href="/admin/notifications?status=sent">
          <span>Сегодня доставлено</span>
          <strong>{metrics.sent_today}</strong>
        </a>
        <a href="/admin/notifications?status=all&q=failed">
          <span>Ошибки доставок</span>
          <strong>{metrics.failed_deliveries}</strong>
        </a>
      </section>

      <form className="admin-notification-filters" method="get">
        <label>
          <span>Статус</span>
          <select name="status" defaultValue={status}>
            <option value="all">Все</option>
            <option value="pending">Ожидают</option>
            <option value="processing">Обрабатываются</option>
            <option value="sent">Доставлены</option>
            <option value="partial">Частично</option>
            <option value="dead">Dead-letter</option>
            <option value="skipped">Пропущены</option>
          </select>
        </label>
        <label>
          <span>Канал</span>
          <select name="channel" defaultValue={channel}>
            <option value="all">Все</option>
            {(data?.channels ?? []).length ? (
              (data?.channels ?? []).map((item) => (
                <option key={item.channel} value={item.channel}>
                  {channelLabels[item.channel] || item.channel} ({item.count})
                </option>
              ))
            ) : (
              <option value="telegram">Telegram</option>
            )}
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
          <input
            name="q"
            defaultValue={q}
            placeholder="Заказ, событие, роль, Telegram ID или текст ошибки"
          />
        </label>
        <button type="submit">Применить</button>
        <a href="/admin/notifications">Сбросить</a>
      </form>

      <section className="admin-panel admin-notification-list">
        <div className="admin-panel-head">
          <div>
            <span>Всего по фильтру: {pagination.total}</span>
            <h2>Outbox и индивидуальные доставки</h2>
          </div>
        </div>

        {(data?.outboxes ?? []).length ? (
          <div className="admin-notification-table-wrap">
            <table className="admin-table admin-notification-table">
              <thead>
                <tr>
                  <th>Событие</th>
                  <th>Канал и получатель</th>
                  <th>Статус</th>
                  <th>Доставки</th>
                  <th>Попытки</th>
                  <th>Дата</th>
                  <th>Диагностика</th>
                </tr>
              </thead>
              <tbody>
                {(data?.outboxes ?? []).map((outbox) => (
                  <tr key={outbox.id}>
                    <td>
                      <strong>{eventLabels[outbox.template_key] || outbox.template_key}</strong>
                      {outbox.order_id ? (
                        <a href={`/admin/orders/${outbox.order_id}`}>
                          {outbox.order_number || "Открыть заказ"}
                        </a>
                      ) : (
                        <small>Без заказа</small>
                      )}
                      <small>Приоритет: {outbox.priority}</small>
                    </td>
                    <td>
                      <strong>{channelLabels[outbox.channel] || outbox.channel}</strong>
                      <small>{recipientLabels[outbox.recipient_type] || outbox.recipient_type}</small>
                      {outbox.recipient_role ? (
                        <small>{roleLabels[outbox.recipient_role] || outbox.recipient_role}</small>
                      ) : null}
                      {outbox.recipient_address_masked ? (
                        <small>{outbox.recipient_address_masked}</small>
                      ) : null}
                    </td>
                    <td>
                      <span className={`admin-notification-status ${outbox.status}`}>
                        {statusLabels[outbox.status] || outbox.status}
                      </span>
                      {outbox.dead_at ? <small>Dead: {dateText(outbox.dead_at)}</small> : null}
                      {outbox.locked_at ? <small>Заблокировано: {dateText(outbox.locked_at)}</small> : null}
                    </td>
                    <td>
                      <strong>{outbox.deliveries_total}</strong>
                      <small>{deliverySummary(outbox)}</small>
                      {(outbox.deliveries ?? []).length ? (
                        <details className="admin-notification-deliveries">
                          <summary>Показать доставки</summary>
                          <div>
                            {(outbox.deliveries ?? []).map((delivery) => (
                              <article key={delivery.id}>
                                <header>
                                  <strong>{channelLabels[delivery.channel] || delivery.channel}</strong>
                                  <span className={`admin-notification-status ${delivery.status}`}>
                                    {statusLabels[delivery.status] || delivery.status}
                                  </span>
                                </header>
                                <p>
                                  {recipientLabels[delivery.recipientType] || delivery.recipientType}
                                  {delivery.recipientRole
                                    ? ` · ${roleLabels[delivery.recipientRole] || delivery.recipientRole}`
                                    : ""}
                                  {` · ${delivery.recipientAddress}`}
                                </p>
                                <small>
                                  Попытки: {delivery.attempts}/{delivery.maxAttempts}
                                  {delivery.sentAt ? ` · Отправлено ${dateText(delivery.sentAt)}` : ""}
                                  {delivery.failedAt ? ` · Ошибка ${dateText(delivery.failedAt)}` : ""}
                                </small>
                                {delivery.lastError ? (
                                  <p className="admin-notification-error">{delivery.lastError}</p>
                                ) : null}
                                <DeliveryActions
                                  id={delivery.id}
                                  status={delivery.status}
                                  channel={delivery.channel}
                                  canDeactivateRecipient={Boolean(
                                    data?.permissions.canDeactivateRecipient
                                  )}
                                />
                              </article>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      <strong>{outbox.attempts}/{outbox.max_attempts}</strong>
                      <small>Следующая: {dateText(outbox.next_attempt_at)}</small>
                    </td>
                    <td>
                      <span>{dateText(outbox.created_at)}</span>
                      {outbox.sent_at ? <small>Доставлено: {dateText(outbox.sent_at)}</small> : null}
                    </td>
                    <td>
                      {outbox.last_error ? (
                        <p className="admin-notification-error">{outbox.last_error}</p>
                      ) : (
                        <small>Ошибок outbox нет</small>
                      )}
                      <NotificationActions id={outbox.id} status={outbox.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">
            Уведомления по выбранному фильтру не найдены.
          </div>
        )}
      </section>

      <nav className="admin-notification-pagination" aria-label="Страницы уведомлений">
        {pagination.page > 1 ? (
          <a
            href={`/admin/notifications${queryString({
              status,
              channel,
              recipientType,
              type,
              q,
              page: pagination.page - 1
            })}`}
          >
            ← Назад
          </a>
        ) : <span />}
        <strong>Страница {pagination.page} из {pagination.pages}</strong>
        {pagination.page < pagination.pages ? (
          <a
            href={`/admin/notifications${queryString({
              status,
              channel,
              recipientType,
              type,
              q,
              page: pagination.page + 1
            })}`}
          >
            Дальше →
          </a>
        ) : <span />}
      </nav>

      <section className="admin-panel admin-notification-audit">
        <div className="admin-panel-head">
          <div>
            <span>Последние 30 дней</span>
            <h2>Действия сотрудников с уведомлениями</h2>
          </div>
          <a href="/admin/security?event=notification.changed">Полный аудит</a>
        </div>

        {(data?.audit ?? []).length ? (
          <div className="admin-notification-audit-list">
            {(data?.audit ?? []).map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.actor_name || "Системный сотрудник"}</strong>
                  <span>{item.actor_role ? roleLabels[item.actor_role] || item.actor_role : "Роль не определена"}</span>
                </div>
                <p>{item.summary}</p>
                <time>{dateText(item.created_at)}</time>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">Действий с уведомлениями пока нет.</div>
        )}
      </section>
    </div>
  );
}
