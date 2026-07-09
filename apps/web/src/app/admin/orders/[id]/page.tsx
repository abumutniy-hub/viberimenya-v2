import { fetchAdmin, type AdminRow } from "../../lib/admin-api";
import { OrderActions } from "../order-actions";
import { OrderAssigneesForm, type OrderStaffMember } from "./order-assignees-form";
import { ContactActions } from "./contact-actions";
import { InternalCommentForm } from "./internal-comment-form";
import { DeliveryAddressActions } from "./delivery-address-actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

type Response = {
  ok: boolean;
  order: AdminRow;
  items: AdminRow[];
  history: AdminRow[];
  staff: OrderStaffMember[];
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
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  failed: "Ошибка оплаты",
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

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
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

function statusClass(value: unknown) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "-");
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="admin-order-info-row">
      <span>{label}</span>
      <strong>{text(value)}</strong>
    </div>
  );
}

export default async function AdminOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchAdmin<Response>(`/api/admin/orders/${id}`);
  const order = data?.order;
  const items = data?.items ?? [];
  const history = data?.history ?? [];
  const staff = data?.staff ?? [];

  if (!order) {
    return (
      <div className="admin-page">
        <div className="admin-page-head">
          <div>
            <span>CRM</span>
            <h1>Заказ не найден</h1>
            <p>Проверьте ссылку или вернитесь в список заказов.</p>
          </div>
          <a className="admin-small-link" href="/admin/orders">К заказам</a>
        </div>
      </div>
    );
  }

  const status = String(order.status || "");
  const paymentStatus = String(order.payment_status || "");
  const deliveryType = String(order.delivery_type || "");
  const isPickup = deliveryType === "pickup";
  const trackingToken = String(order.tracking_token || "");
  const deliveryIntervalText = text(order.delivery_interval_name) || text(order.delivery_comment);
  const deliveryCommentText = text(order.delivery_comment);
  const isDeliveryCommentJustInterval = /^\d{1,2}:\d{2}\s*[—–-]\s*\d{1,2}:\d{2}$/.test(deliveryCommentText);
  const visibleDeliveryComment =
    deliveryCommentText && deliveryCommentText !== deliveryIntervalText && !isDeliveryCommentJustInterval
      ? deliveryCommentText
      : "";

  return (
    <div className="admin-page admin-order-detail-page">
      <div className="admin-page-head">
        <div>
          <span>CRM / заказ</span>
          <h1>{text(order.order_number)}</h1>
          <p>Создан: {dateTime(order.created_at)}</p>
        </div>
        <a className="admin-small-link" href="/admin/orders">← К списку</a>
      </div>

      <section className="admin-order-detail-hero admin-panel">
        <div>
          <span className={`admin-status-chip status-${statusClass(status)}`}>
            {orderStatusLabels[status] || status || "—"}
          </span>
          <span className={`admin-status-chip payment-${statusClass(paymentStatus)}`}>
            {paymentStatusLabels[paymentStatus] || paymentStatus || "—"}
          </span>
        </div>

        <div className="admin-order-detail-total">
          <span>Итого</span>
          <strong>{money(order.total)}</strong>
        </div>

        <OrderActions
          orderId={String(order.id)}
          status={status}
          paymentStatus={paymentStatus}
          paymentUrl={String(order.payment_url || "")}
          trackingToken={trackingToken}
          internalChatCount={0}
          internalChatPreview=""
          showDetailsLink={false}
          showStatusActions
        />
      </section>

      <section className="admin-panel admin-order-detail-card admin-order-assignees-card">
        <div className="admin-panel-head">
          <div>
            <span>Команда заказа</span>
            <h2>Ответственные</h2>
          </div>
        </div>

        <OrderAssigneesForm
          orderId={String(order.id)}
          currentManagerId={String(order.manager_id || "")}
          currentFloristId={String(order.florist_id || "")}
          currentCourierId={String(order.courier_id || "")}
          staff={staff}
        />
      </section>

      <section className="admin-panel admin-order-detail-card admin-order-history-card">
        <div className="admin-panel-head">
          <div>
            <span>Движение заказа</span>
            <h2>История статусов</h2>
          </div>
        </div>

        {history.length ? (
          <div className="admin-order-history-list">
            {history.map((event, index) => {
              const fromStatus = String(event.from_status || "");
              const toStatus = String(event.to_status || "");
              const eventKey = String(event.id || `${event.created_at}-${index}`);

              return (
                <article key={eventKey} className="admin-order-history-item">
                  <div className="admin-order-history-dot" />
                  <div className="admin-order-history-body">
                    <div className="admin-order-history-top">
                      <strong>{dateTime(event.created_at)}</strong>
                      <span>
                        {orderStatusLabels[fromStatus] || fromStatus || "—"}
                        {" → "}
                        {orderStatusLabels[toStatus] || toStatus || "—"}
                      </span>
                    </div>
                    <p>{text(event.comment)}</p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="admin-order-comment">История статусов пока пустая.</p>
        )}
      </section>

      <section className="admin-order-detail-grid">
        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <h2>Клиент</h2>
          </div>
          <InfoRow label="Имя" value={order.customer_name} />
          <InfoRow label="Телефон" value={order.customer_phone} />
          <ContactActions phone={String(order.customer_phone || "")} />
          <InfoRow label="Email" value={order.customer_email} />
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <h2>Получатель</h2>
          </div>
          <InfoRow label="Имя" value={order.recipient_name} />
          <InfoRow label="Телефон" value={order.recipient_phone} />
          <ContactActions phone={String(order.recipient_phone || "")} />
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <h2>{isPickup ? "Самовывоз" : "Доставка"}</h2>
          </div>
          <InfoRow label="Тип" value={isPickup ? "Самовывоз" : "Доставка"} />
          {!isPickup ? <InfoRow label="Дата" value={dateOnly(order.delivery_date)} /> : null}
          {!isPickup ? <InfoRow label="Интервал" value={deliveryIntervalText} /> : null}
          {!isPickup && visibleDeliveryComment ? (
            <InfoRow label="Комментарий к доставке" value={visibleDeliveryComment} />
          ) : null}
          {!isPickup ? <InfoRow label="Адрес" value={order.delivery_address_text} /> : null}
          {!isPickup && order.delivery_address_text ? (
            <DeliveryAddressActions address={String(order.delivery_address_text || "")} />
          ) : null}
          <InfoRow label={isPickup ? "Стоимость" : "Доставка"} value={money(order.delivery_price)} />
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <h2>Оплата</h2>
          </div>
          <InfoRow label="Статус" value={paymentStatusLabels[paymentStatus] || paymentStatus} />
          <InfoRow label="Способ" value={paymentMethodLabels[String(order.payment_method || "")] || order.payment_method} />
          <InfoRow label="Ссылка оплаты" value={order.payment_url} />
        </article>
      </section>

      <section className="admin-panel admin-order-detail-card">
        <div className="admin-panel-head">
          <h2>Состав заказа</h2>
        </div>

        <div className="admin-order-items-list">
          {items.map((item, index) => (
            <article key={`${text(item.product_id)}-${index}`} className="admin-order-item-row admin-order-item-row-with-image">
              <div className="admin-order-item-main">
                {item.image_url ? (
                  <img
                    className="admin-order-item-image"
                    src={String(item.image_url)}
                    alt={text(item.product_name)}
                  />
                ) : null}

                <div>
                  <strong>{text(item.product_name)}</strong>
                  <span>{Number(item.quantity || 0)} × {money(item.price)}</span>
                </div>
              </div>
              <strong>{money(item.total)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-order-detail-grid">
        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <h2>Финансы</h2>
          </div>
          <InfoRow label="Товары" value={money(order.subtotal)} />
          <InfoRow label={isPickup ? "Самовывоз" : "Доставка"} value={money(order.delivery_price)} />
          <InfoRow
            label="Скидка"
            value={Number(order.discount_total || 0) > 0 ? `−${money(order.discount_total)}` : money(0)}
          />
          <InfoRow
            label="Бонусы списаны"
            value={Number(order.bonus_spent || 0) > 0 ? `−${money(order.bonus_spent)}` : money(0)}
          />
          <InfoRow label="Бонусы к начислению" value={money(order.bonus_earned)} />
          <InfoRow label="Итого" value={money(order.total)} />
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <div>
              <span>Контроль качества</span>
              <h2>Фото готового букета</h2>
            </div>
          </div>

          {order.bouquet_photo_url ? (
            <div className="admin-bouquet-photo-card">
              <img
                src={String(order.bouquet_photo_url)}
                alt={`Фото готового букета по заказу ${String(order.order_number || "")}`}
              />
              <a href={String(order.bouquet_photo_url)} target="_blank" rel="noreferrer">
                Открыть фото
              </a>
            </div>
          ) : (
            <p className="admin-order-comment">
              Фото пока не загружено. Позже флорист сможет прикреплять фото готового букета через Telegram.
            </p>
          )}
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <div>
              <span>От клиента</span>
              <h2>Комментарий клиента</h2>
            </div>
          </div>
          <p className="admin-order-comment">{text(order.customer_comment)}</p>
        </article>

        <article className="admin-panel admin-order-detail-card">
          <div className="admin-panel-head">
            <div>
              <span>Только для CRM</span>
              <h2>Внутренний комментарий</h2>
            </div>
          </div>

          <InternalCommentForm
            orderId={String(order.id)}
            initialValue={String(order.internal_comment || "")}
          />
        </article>
      </section>
    </div>
  );
}
