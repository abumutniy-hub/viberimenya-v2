import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import { OrderActions } from "./order-actions";
import { AdminPresenceHeartbeat } from "../components/admin-presence-heartbeat";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Response = {
  items: AdminRow[];
  pagination?: {
    page?: number;
    limit?: number;
    totalItems?: number;
    totalPages?: number;
  };
  filters?: {
    q?: string;
    status?: string;
    payment?: string;
    delivery?: string;
    attention?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  summary?: {
    total?: number;
    active?: number;
    new_orders?: number;
    problem?: number;
    pending_payment?: number;
    delivered_today?: number;
  };
  viewer?: {
    userId?: string;
    role?: string;
    scope?: string;
  };
};

const orderStatusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  assembling: "Собирается",
  ready: "Готов",
  assigned_courier: "Передан курьеру",
  delivering: "В доставке",
  delivered: "Доставлен",
  cancelled: "Отменён",
  problem: "Проблема"
};

const paymentStatusLabels: Record<string, string> = {
  created: "Создан",
  pending: "Ожидает",
  waiting_for_capture: "Ожидает подтверждения",
  paid: "Оплачен",
  failed: "Ошибка",
  refunded: "Возврат",
  partially_refunded: "Частичный возврат",
  cancelled: "Отменена",
  expired: "Истёк",
  not_required: "Не требуется"
};

const paymentMethodLabels: Record<string, string> = {
  transfer_after_confirm: "Перевод после подтверждения",
  cash_on_delivery: "При получении",
  online_card: "Онлайн-картой",
  sbp: "СБП"
};

function field(row: AdminRow, key: string) {
  return String(row[key] ?? "");
}

function numberField(row: AdminRow, key: string) {
  return Number(row[key] ?? 0);
}

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown) {
  return `${numberValue(value).toLocaleString("ru-RU")} ₽`;
}

function dateTime(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "—";

  try {
    return new Date(raw).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return raw;
  }
}

function dateOnly(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "—";

  try {
    return new Date(raw).toLocaleDateString("ru-RU");
  } catch {
    return raw;
  }
}

function statusClass(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function deliverySnapshot(row: AdminRow) {
  const metadata = recordValue(row.metadata);
  return recordValue(metadata.delivery);
}

function isExpressOrder(row: AdminRow) {
  const snapshot = deliverySnapshot(row);

  return (
    snapshot.isExpress === true
    || String(snapshot.isExpress ?? "").trim().toLowerCase() === "true"
  );
}

function deliveryTariffName(row: AdminRow) {
  const snapshot = deliverySnapshot(row);
  const name = String(snapshot.tariffName ?? "").trim();

  if (name) return name;

  return field(row, "delivery_type") === "pickup"
    ? "Самовывоз"
    : "Обычная доставка";
}

function isActiveExpressOrder(row: AdminRow) {
  const status = field(row, "status");

  return (
    isExpressOrder(row)
    && status !== "delivered"
    && status !== "cancelled"
  );
}

function orderCreatedTimestamp(row: AdminRow) {
  const timestamp = Date.parse(String(row.created_at ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortOrders(rows: AdminRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const problemDifference =
        Number(field(right.row, "status") === "problem")
        - Number(field(left.row, "status") === "problem");

      if (problemDifference !== 0) return problemDifference;

      const priorityDifference =
        Number(isActiveExpressOrder(right.row))
        - Number(isActiveExpressOrder(left.row));

      if (priorityDifference !== 0) return priorityDifference;

      const dateDifference =
        orderCreatedTimestamp(right.row)
        - orderCreatedTimestamp(left.row);

      if (dateDifference !== 0) return dateDifference;

      return left.index - right.index;
    })
    .map((item) => item.row);
}

function paymentStatusChip(row: AdminRow) {
  const status = field(row, "payment_status");

  return (
    <span className={`admin-status-chip payment-${statusClass(status)}`}>
      {paymentStatusLabels[status] || status || "—"}
    </span>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function buildQuery(values: Record<string, string>, page?: number) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (!value || value === "all") continue;
    params.set(key, value);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  return params.toString();
}

export default async function AdminOrdersPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;

  const requestedFilters = {
    q: firstParam(rawParams.q).trim(),
    status: firstParam(rawParams.status) || "all",
    payment: firstParam(rawParams.payment) || "all",
    delivery: firstParam(rawParams.delivery) || "all",
    attention: firstParam(rawParams.attention) || "all",
    dateFrom: firstParam(rawParams.dateFrom),
    dateTo: firstParam(rawParams.dateTo)
  };

  const requestedPage = Math.max(1, Number(firstParam(rawParams.page)) || 1);
  const apiQuery = buildQuery(requestedFilters, requestedPage);

  const data = await fetchAdmin<Response>(
    `/api/admin/orders${apiQuery ? `?${apiQuery}` : ""}`
  );

  const viewerRole = String(data?.viewer?.role || "manager");
  const isFieldRole = viewerRole === "florist" || viewerRole === "courier";
  const filters = {
    q: String(data?.filters?.q ?? requestedFilters.q),
    status: String(data?.filters?.status ?? requestedFilters.status),
    payment: String(data?.filters?.payment ?? requestedFilters.payment),
    delivery: String(data?.filters?.delivery ?? requestedFilters.delivery),
    attention: String(data?.filters?.attention ?? requestedFilters.attention),
    dateFrom: String(data?.filters?.dateFrom ?? requestedFilters.dateFrom),
    dateTo: String(data?.filters?.dateTo ?? requestedFilters.dateTo)
  };

  const currentPage = Math.max(1, numberValue(data?.pagination?.page) || 1);
  const totalPages = Math.max(1, numberValue(data?.pagination?.totalPages) || 1);
  const totalItems = numberValue(data?.pagination?.totalItems);
  const summary = data?.summary ?? {};

  const hasFilters = Object.entries(filters).some(([, value]) => value && value !== "all");

  const previousHref = `/admin/orders${currentPage > 2
    ? `?${buildQuery(filters, currentPage - 1)}`
    : buildQuery(filters, 1)
      ? `?${buildQuery(filters, 1)}`
      : ""}`;

  const nextHref = `/admin/orders?${buildQuery(filters, currentPage + 1)}`;

  return (
    <div
      className={[
        "admin-page",
        "admin-orders-page",
        `admin-orders-role-${viewerRole}`
      ].join(" ")}
    >
      <AdminPresenceHeartbeat />

      <div className="admin-page-head admin-orders-head">
        <div>
          <span>CRM</span>
          <h1>{isFieldRole ? "Мои заказы" : "Заказы"}</h1>
          <p>
            {viewerRole === "florist"
              ? "Назначенные вам заказы на сборку и внутренний чат команды."
              : viewerRole === "courier"
                ? "Назначенные вам доставки и контакты получателя."
                : "Поиск, фильтры, контроль оплаты, производства и доставки."}
          </p>
        </div>

        <div className="admin-orders-result-count">
          <strong>{totalItems}</strong>
          <span>{hasFilters ? "найдено" : "в списке"}</span>
        </div>
      </div>

      <section className="admin-order-summary-cards">
        <a href="/admin/orders">
          <span>Все</span>
          <strong>{numberValue(summary.total)}</strong>
        </a>
        <a href="/admin/orders?attention=active">
          <span>Активные</span>
          <strong>{numberValue(summary.active)}</strong>
        </a>
        <a href="/admin/orders?status=new">
          <span>Новые</span>
          <strong>{numberValue(summary.new_orders)}</strong>
        </a>
        <a
          href="/admin/orders?attention=problem"
          className={numberValue(summary.problem) > 0 ? "danger" : ""}
        >
          <span>Проблемы</span>
          <strong>{numberValue(summary.problem)}</strong>
        </a>
        {!isFieldRole ? (
          <a
            href="/admin/orders?attention=pending_payment"
            className={numberValue(summary.pending_payment) > 0 ? "warning" : ""}
          >
            <span>Ждут оплаты</span>
            <strong>{numberValue(summary.pending_payment)}</strong>
          </a>
        ) : null}
        <a href="/admin/orders?status=delivered">
          <span>Доставлено сегодня</span>
          <strong>{numberValue(summary.delivered_today)}</strong>
        </a>
      </section>

      <section className="admin-panel admin-order-filter-panel">
        <div className="admin-panel-head">
          <div>
            <span>Рабочая выборка</span>
            <h2>Поиск и фильтры</h2>
          </div>
          {hasFilters ? <a href="/admin/orders">Сбросить всё</a> : null}
        </div>

        <form className="admin-order-filter-form" action="/admin/orders" method="get">
          <label className="admin-order-filter-search">
            <span>Поиск</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Номер, имя, телефон или адрес"
            />
          </label>

          <label>
            <span>Статус</span>
            <select name="status" defaultValue={filters.status}>
              <option value="all">Все статусы</option>
              {Object.entries(orderStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          {!isFieldRole ? (
            <label>
              <span>Оплата</span>
              <select name="payment" defaultValue={filters.payment}>
                <option value="all">Любая оплата</option>
                {Object.entries(paymentStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            <span>Получение</span>
            <select name="delivery" defaultValue={filters.delivery}>
              <option value="all">Все способы</option>
              <option value="delivery">Доставка</option>
              <option value="pickup">Самовывоз</option>
              <option value="express">Только срочные</option>
            </select>
          </label>

          <label>
            <span>Контроль</span>
            <select name="attention" defaultValue={filters.attention}>
              <option value="all">Без ограничения</option>
              <option value="active">Только активные</option>
              <option value="problem">Только проблемные</option>
              {!isFieldRole ? <option value="pending_payment">Ожидают оплаты</option> : null}
            </select>
          </label>

          <label>
            <span>Создан с</span>
            <input type="date" name="dateFrom" defaultValue={filters.dateFrom} />
          </label>

          <label>
            <span>Создан по</span>
            <input type="date" name="dateTo" defaultValue={filters.dateTo} />
          </label>

          <div className="admin-order-filter-actions">
            <button type="submit">Применить</button>
            {hasFilters ? <a href="/admin/orders">Очистить</a> : null}
          </div>
        </form>
      </section>

      <section className="admin-panel admin-order-list-panel">
        <div className="admin-panel-head">
          <div>
            <span>Результаты</span>
            <h2>{hasFilters ? "Найденные заказы" : "Все заказы"}</h2>
          </div>
          <span className="admin-orders-page-indicator">
            Страница {currentPage} из {totalPages}
          </span>
        </div>

        <AdminTable
          rows={sortOrders(data?.items ?? [])}
          emptyText="По выбранным условиям заказов нет."
          columns={[
            {
              key: "order_number",
              label: "Заказ",
              render: (row) => (
                <div className="admin-order-main-cell">
                  <strong>{field(row, "order_number")}</strong>
                  <span>{dateTime(row.created_at)}</span>
                </div>
              )
            },
            {
              key: "status",
              label: "Статус",
              render: (row) => {
                const status = field(row, "status");
                const isExpress = isExpressOrder(row);

                return (
                  <div className="admin-order-status-stack">
                    {isExpress ? (
                      <span className="admin-order-express-list-badge">СРОЧНО</span>
                    ) : null}
                    <span className={`admin-status-chip status-${statusClass(status)}`}>
                      {orderStatusLabels[status] || status || "—"}
                    </span>
                  </div>
                );
              }
            },
            {
              key: "customer_name",
              label: viewerRole === "courier" ? "Получатель" : "Клиент",
              render: (row) => (
                <div className="admin-order-customer-cell">
                  <strong>{field(row, "customer_name") || "Без имени"}</strong>
                  <span>{field(row, "customer_phone") || "Телефон не указан"}</span>
                </div>
              )
            },
            {
              key: "delivery_type",
              label: "Получение",
              render: (row) => {
                const deliveryType = field(row, "delivery_type");
                const isPickup = deliveryType === "pickup";
                const isExpress = isExpressOrder(row);
                const tariffName = deliveryTariffName(row);

                return (
                  <div className={["admin-order-delivery-cell", isExpress ? "is-express" : ""].filter(Boolean).join(" ")}>
                    <strong>
                      {isPickup
                        ? "Самовывоз"
                        : isExpress
                          ? "Срочная доставка"
                          : tariffName}
                    </strong>
                    <span>
                      {isPickup ? "Без доставки" : `Дата: ${dateOnly(row.delivery_date)}`}
                    </span>
                    {isExpress ? <small className="admin-order-express-note">Приоритетный заказ</small> : null}
                    {!isPickup && !isFieldRole ? <em>{money(row.delivery_price)}</em> : null}
                  </div>
                );
              }
            },
            {
              key: "payment_status",
              label: "Оплата",
              render: (row) => (
                <div className="admin-order-payment-cell">
                  {paymentStatusChip(row)}
                  <span>{paymentMethodLabels[field(row, "payment_method")] || field(row, "payment_method") || "—"}</span>
                </div>
              )
            },
            {
              key: "total_amount",
              label: "Сумма",
              render: (row) => {
                const discount = numberField(row, "discount_total");
                const bonusSpent = numberField(row, "bonus_spent");

                return (
                  <div className="admin-order-total-cell">
                    <strong>{money(row.total_amount)}</strong>
                    {discount > 0 ? <span>Скидка: −{money(discount)}</span> : null}
                    {bonusSpent > 0 ? <span>Бонусы: −{money(bonusSpent)}</span> : null}
                  </div>
                );
              }
            },
            {
              key: "actions",
              label: "Действия",
              render: (row) => (
                <OrderActions
                  orderId={String(row.id)}
                  status={String(row.status)}
                  paymentStatus={String(row.payment_status)}
                  paymentUrl={String(row.payment_url || "")}
                  trackingToken={String(row.tracking_token || "")}
                  internalChatCount={Number(row.internal_chat_unread_count || 0)}
                  internalChatPreview={String(row.internal_chat_last_message || "")}
                  viewerRole={viewerRole}
                />
              )
            }
          ]}
        />

        {totalPages > 1 ? (
          <nav className="admin-order-pagination" aria-label="Страницы заказов">
            {currentPage > 1 ? <a href={previousHref}>← Назад</a> : <span>← Назад</span>}
            <strong>{currentPage} / {totalPages}</strong>
            {currentPage < totalPages ? <a href={nextHref}>Вперёд →</a> : <span>Вперёд →</span>}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
