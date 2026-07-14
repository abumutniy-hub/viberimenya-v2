import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import { OrderActions } from "./order-actions";
import { AdminPresenceHeartbeat } from "../components/admin-presence-heartbeat";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];

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
  pending: "Ожидает",
  paid: "Оплачен",
  failed: "Ошибка",
  refunded: "Возврат",
  cancelled: "Отменена",
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

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
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

function orderStatusChip(row: AdminRow) {
  const status = field(row, "status");

  return (
    <span className={`admin-status-chip status-${statusClass(status)}`}>
      {orderStatusLabels[status] || status || "—"}
    </span>
  );
}

function recordValue(
  value: unknown
): Record<string, unknown> {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  ) {
    return value as
      Record<string, unknown>;
  }

  if (
    typeof value === "string"
    && value.trim()
  ) {
    try {
      const parsed =
        JSON.parse(value);

      if (
        parsed
        && typeof parsed === "object"
        && !Array.isArray(parsed)
      ) {
        return parsed as
          Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function deliverySnapshot(
  row: AdminRow
) {
  const metadata =
    recordValue(row.metadata);

  return recordValue(
    metadata.delivery
  );
}

function isExpressOrder(
  row: AdminRow
) {
  const snapshot =
    deliverySnapshot(row);

  return (
    snapshot.isExpress === true
    || String(
      snapshot.isExpress ?? ""
    )
      .trim()
      .toLowerCase()
      === "true"
  );
}

function deliveryTariffName(
  row: AdminRow
) {
  const snapshot =
    deliverySnapshot(row);

  const name =
    String(
      snapshot.tariffName ?? ""
    ).trim();

  if (name) {
    return name;
  }

  return field(
    row,
    "delivery_type"
  ) === "pickup"
    ? "Самовывоз"
    : "Обычная доставка";
}

function isActiveExpressOrder(
  row: AdminRow
) {
  const status =
    field(row, "status");

  return (
    isExpressOrder(row)
    && status !== "delivered"
    && status !== "cancelled"
  );
}

function orderCreatedTimestamp(
  row: AdminRow
) {
  const timestamp =
    Date.parse(
      String(
        row.created_at ?? ""
      )
    );

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

function sortOrders(
  rows: AdminRow[]
) {
  return rows
    .map((row, index) => ({
      row,
      index
    }))
    .sort((left, right) => {
      const priorityDifference =
        Number(
          isActiveExpressOrder(
            right.row
          )
        )
        - Number(
          isActiveExpressOrder(
            left.row
          )
        );

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const dateDifference =
        orderCreatedTimestamp(
          right.row
        )
        - orderCreatedTimestamp(
            left.row
          );

      if (dateDifference !== 0) {
        return dateDifference;
      }

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

export default async function AdminOrdersPage() {
  const data =
    await fetchAdmin<Response>(
      "/api/admin/orders"
    );

  const viewerRole =
    String(
      data?.viewer?.role
      || "manager"
    );

  const isFieldRole =
    viewerRole === "florist"
    || viewerRole === "courier";

  return (
    <div
      className={[
        "admin-page",
        "admin-orders-page",
        `admin-orders-role-${viewerRole}`
      ].join(" ")}
    >
      <AdminPresenceHeartbeat />
      <div className="admin-page-head">
        <div>
          <span>CRM</span>
          <h1>
            {isFieldRole
              ? "Мои заказы"
              : "Заказы"}
          </h1>

          <p>
            {viewerRole === "florist"
              ? "Назначенные вам заказы на сборку и внутренний чат команды."
              : viewerRole === "courier"
                ? "Назначенные вам доставки и контакты получателя."
                : "Рабочий список заказов: статус, клиент, получение, оплата и быстрые действия."}
          </p>
        </div>
      </div>

      <section className="admin-panel">
        <AdminTable
          rows={sortOrders(data?.items ?? [])}
          emptyText="Заказов пока нет."
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
                const status =
                  field(
                    row,
                    "status"
                  );

                const isExpress =
                  isExpressOrder(row);

                return (
                  <div className="admin-order-status-stack">
                    {isExpress ? (
                      <span className="admin-order-express-list-badge">
                        СРОЧНО
                      </span>
                    ) : null}

                    <span
                      className={
                        `admin-status-chip status-${statusClass(
                          status
                        )}`
                      }
                    >
                      {orderStatusLabels[status]
                        || status
                        || "—"}
                    </span>
                  </div>
                );
              }
            },
            {
              key: "customer_name",
              label:
                viewerRole === "courier"
                  ? "Получатель"
                  : "Клиент",
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
                const deliveryType =
                  field(
                    row,
                    "delivery_type"
                  );

                const isPickup =
                  deliveryType === "pickup";

                const isExpress =
                  isExpressOrder(row);

                const tariffName =
                  deliveryTariffName(row);

                return (
                  <div
                    className={[
                      "admin-order-delivery-cell",
                      isExpress
                        ? "is-express"
                        : ""
                    ].filter(Boolean).join(" ")}
                  >
                    <strong>
                      {isPickup
                        ? "Самовывоз"
                        : isExpress
                          ? "Срочная доставка"
                          : tariffName}
                    </strong>

                    <span>
                      {isPickup
                        ? "Без доставки"
                        : `Дата: ${dateOnly(
                            row.delivery_date
                          )}`}
                    </span>

                    {isExpress ? (
                      <small className="admin-order-express-note">
                        Приоритетный заказ
                      </small>
                    ) : null}

                    {!isPickup ? (
                      <em>
                        {money(
                          row.delivery_price
                        )}
                      </em>
                    ) : null}
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
      </section>
    </div>
  );
}
