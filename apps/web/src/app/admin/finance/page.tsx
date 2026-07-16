import { fetchAdmin } from "../lib/admin-api";
import { YooKassaSettingsCard } from "./yookassa-settings-card";

export const dynamic = "force-dynamic";

type PaymentRow = {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  order_payment_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  provider: string;
  provider_payment_id: string | null;
  method: string;
  status: string;
  amount: number;
  currency: string;
  payment_url: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  refund_reason: string | null;
  refunded_at: string | null;
};

type FinanceResponse = {
  ok: boolean;
  metrics: {
    paid_amount: number;
    paid_count: number;
    refunded_amount: number;
    refunded_count: number;
    pending_amount: number;
    pending_count: number;
    failed_count: number;
    customers_with_debt: number;
    total_bonus_debt: number;
  };
  payments: PaymentRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
  viewer: {
    role: string;
    canRefund: boolean;
  };
  provider: {
    provider: string;
    configured: boolean;
    enabled: boolean;
    shopId: string;
    secretKeyConfigured: boolean;
    receiptsEnabled: boolean;
    testModeHint: boolean;
  };
};


type YooKassaSettingsResponse = {
  ok: boolean;
  settings: {
    enabled: boolean;
    shopId: string;
    secretKeyConfigured: boolean;
    testMode: boolean;
    receiptsEnabled: boolean;
    webhookUrl: string;
  };
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabels: Record<string, string> = {
  pending: "Ожидает",
  paid: "Оплачен",
  failed: "Ошибка",
  refunded: "Возврат",
  cancelled: "Отменён",
  not_required: "Не требуется"
};

const methodLabels: Record<string, string> = {
  cash_on_delivery: "При получении",
  transfer_after_confirm: "Перевод",
  online_card: "Онлайн-картой",
  sbp: "СБП"
};

function first(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] || fallback : value || fallback;
}

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function dateTime(value: string | null | undefined) {
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

export default async function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const status = first(params.status, "all");
  const dateFrom = first(params.dateFrom);
  const dateTo = first(params.dateTo);
  const page = Math.max(1, Number(first(params.page, "1")) || 1);

  const apiQuery = queryString({ q, status, dateFrom, dateTo, page });
  const data = await fetchAdmin<FinanceResponse>(`/api/admin/finance${apiQuery}`);
  const canManageProvider = data?.viewer?.role === "owner" || data?.viewer?.role === "admin";
  const providerSettings = canManageProvider
    ? await fetchAdmin<YooKassaSettingsResponse>("/api/admin/finance/yookassa-settings")
    : null;
  const metrics = data?.metrics ?? {
    paid_amount: 0,
    paid_count: 0,
    refunded_amount: 0,
    refunded_count: 0,
    pending_amount: 0,
    pending_count: 0,
    failed_count: 0,
    customers_with_debt: 0,
    total_bonus_debt: 0
  };
  const pagination = data?.pagination ?? {
    page: 1,
    pageSize: 50,
    total: 0,
    pages: 1
  };

  return (
    <div className="admin-page admin-finance-page">
      <div className="admin-page-head">
        <div>
          <span>Оплаты, возвраты и бонусы</span>
          <h1>Финансовый контроль</h1>
          <p>
            Единый журнал платежей. До подключения платёжного провайдера возврат в CRM является
            учётной фиксацией после фактического перевода клиенту.
          </p>
        </div>
        <a className="admin-small-link" href="/admin/orders">К заказам</a>
      </div>

      <section className={`admin-finance-provider ${data?.provider?.enabled && data?.provider?.configured ? "ready" : "warning"}`}>
        <div>
          <span>Платёжный провайдер</span>
          <h2>ЮKassa</h2>
          <p>
            {data?.provider?.enabled && data?.provider?.configured
              ? "Онлайн-оплата включена. Платежи, webhook и полные возвраты готовы к работе."
              : data?.provider?.configured
                ? "Ключи сохранены, но создание новых онлайн-платежей выключено."
                : "Интеграция установлена. Добавьте Shop ID и секретный ключ в форме ниже."}
          </p>
        </div>
        <div className="admin-finance-provider-badges">
          <strong>
            {data?.provider?.enabled && data?.provider?.configured
              ? "Включена"
              : data?.provider?.configured
                ? "Выключена"
                : "Ожидает ключи"}
          </strong>
          <small>
            Режим: {data?.provider?.testModeHint ? "тестовый" : "боевой"}
          </small>
          <small>
            Чеки: {data?.provider?.receiptsEnabled ? "передаются через API" : "выключены"}
          </small>
        </div>
      </section>

      {providerSettings?.settings ? (
        <YooKassaSettingsCard initialSettings={providerSettings.settings} />
      ) : null}

      <section className="admin-finance-metrics">
        <article>
          <span>Получено оплат</span>
          <strong>{money(metrics.paid_amount)}</strong>
          <small>{metrics.paid_count} платежей</small>
        </article>
        <article>
          <span>Зафиксировано возвратов</span>
          <strong>{money(metrics.refunded_amount)}</strong>
          <small>{metrics.refunded_count} возвратов</small>
        </article>
        <article>
          <span>Ожидают оплаты</span>
          <strong>{money(metrics.pending_amount)}</strong>
          <small>{metrics.pending_count} платежей</small>
        </article>
        <article className={metrics.failed_count ? "danger" : ""}>
          <span>Ошибки оплаты</span>
          <strong>{metrics.failed_count}</strong>
          <small>требуют проверки</small>
        </article>
        <article className={metrics.customers_with_debt ? "warning" : ""}>
          <span>Бонусный долг</span>
          <strong>{money(metrics.total_bonus_debt)}</strong>
          <small>{metrics.customers_with_debt} клиентов</small>
        </article>
      </section>

      {metrics.customers_with_debt > 0 ? (
        <div className="admin-finance-notice warning">
          После возврата начисленные бонусы могут образовать внутренний долг, если клиент уже успел
          их потратить. Клиент видит баланс 0 ₽, а будущие начисления автоматически погашают долг.
        </div>
      ) : null}

      <form className="admin-finance-filters" method="get">
        <label>
          <span>Статус</span>
          <select name="status" defaultValue={status}>
            <option value="all">Все платежи</option>
            <option value="pending">Ожидают</option>
            <option value="paid">Оплачены</option>
            <option value="refunded">Возвраты</option>
            <option value="failed">Ошибки</option>
            <option value="cancelled">Отменены</option>
          </select>
        </label>
        <label>
          <span>С даты</span>
          <input type="date" name="dateFrom" defaultValue={dateFrom} />
        </label>
        <label>
          <span>По дату</span>
          <input type="date" name="dateTo" defaultValue={dateTo} />
        </label>
        <label className="wide">
          <span>Поиск</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Номер заказа, клиент, телефон или ID платежа"
          />
        </label>
        <button type="submit">Применить</button>
        <a href="/admin/finance">Сбросить</a>
      </form>

      <section className="admin-panel admin-finance-list">
        <div className="admin-panel-head">
          <div>
            <span>Всего по фильтру: {pagination.total}</span>
            <h2>Журнал платежей</h2>
          </div>
        </div>

        {(data?.payments ?? []).length ? (
          <div className="admin-finance-table-wrap">
            <table className="admin-table admin-finance-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th>Способ</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {(data?.payments ?? []).map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <a href={`/admin/orders/${payment.order_id}`}>
                        <strong>{payment.order_number}</strong>
                      </a>
                      <small>{payment.provider || "manual"}</small>
                    </td>
                    <td>
                      <strong>{payment.customer_name || "Клиент"}</strong>
                      <small>{payment.customer_phone || "—"}</small>
                    </td>
                    <td>
                      <strong>{methodLabels[payment.method] || payment.method}</strong>
                      <small>{payment.provider_payment_id || "Без ID провайдера"}</small>
                    </td>
                    <td>
                      <span className={`admin-finance-status ${payment.status}`}>
                        {statusLabels[payment.status] || payment.status}
                      </span>
                      {payment.refund_reason ? <small>{payment.refund_reason}</small> : null}
                    </td>
                    <td><strong>{money(payment.amount)}</strong></td>
                    <td>
                      <span>{dateTime(payment.paid_at || payment.created_at)}</span>
                      {payment.refunded_at ? <small>Возврат: {dateTime(payment.refunded_at)}</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">Платежи по выбранному фильтру не найдены.</div>
        )}
      </section>

      <nav className="admin-notification-pagination" aria-label="Страницы платежей">
        {pagination.page > 1 ? (
          <a href={`/admin/finance${queryString({ q, status, dateFrom, dateTo, page: pagination.page - 1 })}`}>
            ← Назад
          </a>
        ) : <span />}
        <strong>Страница {pagination.page} из {pagination.pages}</strong>
        {pagination.page < pagination.pages ? (
          <a href={`/admin/finance${queryString({ q, status, dateFrom, dateTo, page: pagination.page + 1 })}`}>
            Дальше →
          </a>
        ) : <span />}
      </nav>
    </div>
  );
}
