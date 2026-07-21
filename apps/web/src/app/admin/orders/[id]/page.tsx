import { fetchAdmin, type AdminRow } from "../../lib/admin-api";
import { OrderActions } from "../order-actions";
import { OrderAssigneesForm, type OrderStaffMember } from "./order-assignees-form";
import { ContactActions } from "./contact-actions";
import { InternalCommentForm } from "./internal-comment-form";
import { DeliveryAddressActions } from "./delivery-address-actions";
import { BouquetApprovalActions } from "./bouquet-approval-actions";
import { OrderFinanceActions } from "./order-finance-actions";
import {
  OrderOperationsForm,
  type OrderDeliveryIntervalOption,
  type OrderDeliveryZoneOption
} from "./order-operations-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

type Response = {
  ok: boolean;
  order: AdminRow;
  items: AdminRow[];
  history: AdminRow[];
  payments?: AdminRow[];
  staff: OrderStaffMember[];
  deliveryOptions?: {
    zones?: AdminRow[];
    intervals?: AdminRow[];
    settings?: AdminRow;
  };
  viewer?: {
    userId?: string;
    role?: string;
    canManage?: boolean;
    canChangeStatus?: boolean;
    canUseInternalChat?: boolean;
    canRefund?: boolean;
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
  pending: "Ожидает оплаты",
  waiting_for_capture: "Ожидает подтверждения",
  paid: "Оплачен",
  failed: "Ошибка оплаты",
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

const contactPreferenceLabels: Record<string, string> = {
  call_or_message: "Позвонить или написать",
  phone_call: "Только звонок",
  messenger_only: "Только сообщение"
};

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function rawText(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function numberValue(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "t" || value === 1 || value === "1";
}

function dateTime(value: unknown) {
  const raw = rawText(value);
  if (!raw) return "—";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dateOnly(value: unknown) {
  const raw = rawText(value);
  if (!raw) return "—";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString("ru-RU");
}

function dateInputValue(value: unknown) {
  const raw = rawText(value);
  if (!raw) return "";

  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function statusClass(value: unknown) {
  return rawText(value).replace(/[^a-z0-9_-]/gi, "-");
}

function safePaymentUrl(value: unknown) {
  const raw = rawText(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : "";
  } catch {
    return "";
  }
}

function safeBouquetPhotoUrl(value: unknown) {
  const raw = rawText(value);

  if (!raw.startsWith("/uploads/bouquets/") || raw.includes("..")) {
    return "";
  }

  return /^\/uploads\/bouquets\/[a-zA-Z0-9._/-]+$/.test(raw) ? raw : "";
}

function safeDeliveryProofPhotoUrl(value: unknown) {
  const raw = rawText(value);

  if (!raw.startsWith("/uploads/deliveries/") || raw.includes("..")) {
    return "";
  }

  return /^\/uploads\/deliveries\/[a-zA-Z0-9._/-]+$/.test(raw) ? raw : "";
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="admin-order-info-row">
      <span>{label}</span>
      <strong>{text(value)}</strong>
    </div>
  );
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

type ChecklistState = "ready" | "warning" | "missing";

type ChecklistItem = {
  label: string;
  detail: string;
  state: ChecklistState;
};

function ChecklistCard({ item }: { item: ChecklistItem }) {
  const symbol = item.state === "ready" ? "✓" : item.state === "warning" ? "!" : "×";

  return (
    <article className={`admin-order-check-item is-${item.state}`}>
      <span>{symbol}</span>
      <div>
        <strong>{item.label}</strong>
        <small>{item.detail}</small>
      </div>
    </article>
  );
}

export default async function AdminOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchAdmin<Response>(`/api/admin/orders/${id}`);

  const viewerRole = rawText(data?.viewer?.role) || "manager";
  const canManage =
    data?.viewer?.canManage
    ?? ["owner", "admin", "manager"].includes(viewerRole);
  const canRefund =
    data?.viewer?.canRefund
    ?? ["owner", "admin"].includes(viewerRole);

  const order = data?.order;
  const items = data?.items ?? [];
  const history = data?.history ?? [];
  const payments = data?.payments ?? [];
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

  const status = rawText(order.status);
  const paymentStatus = rawText(order.payment_status);
  const paymentMethod = rawText(order.payment_method);
  const paymentUrl = safePaymentUrl(order.payment_url);
  const paymentPaidAt = order.latest_payment_paid_at;
  const orderMetadata = recordValue(order.metadata);
  const recipientMetadata = recordValue(orderMetadata.recipient);
  const bouquetApproval = recordValue(orderMetadata.bouquetApproval);
  const deliverySnapshot = recordValue(orderMetadata.delivery);
  const bouquetPhotoUrl = safeBouquetPhotoUrl(order.bouquet_photo_url);
  const bouquetApprovalStatus =
    rawText(bouquetApproval.status)
    || (bouquetPhotoUrl ? "not_required" : "not_started");
  const bouquetApprovalNote = rawText(bouquetApproval.note);
  const bouquetApprovalRequestedAt = rawText(bouquetApproval.requestedAt);
  const bouquetApprovalDecidedAt = rawText(bouquetApproval.decidedAt);
  const bouquetApprovalRevisionCount = numberValue(
    bouquetApproval.revisionCount,
  );
  const bouquetApprovalLabels: Record<string, string> = {
    pending: "Ожидает ответа покупателя",
    approved: "Одобрено покупателем",
    revision_requested: "Запрошена правка",
    waived: "Разрешено без согласования",
    not_required: "Для старого заказа согласование не требовалось",
    not_started: "Фото ещё не загружено",
  };
  const deliveryType = rawText(order.delivery_type) || "delivery";
  const isPickup = deliveryType === "pickup";
  const hasDeliverySnapshot = Object.keys(deliverySnapshot).length > 0;
  const deliveryProofPhotoUrl = safeDeliveryProofPhotoUrl(
    deliverySnapshot.proofPhotoUrl
  );
  const deliveryProofUploadedAt = rawText(deliverySnapshot.proofUploadedAt);

  const deliveryTariffName =
    rawText(deliverySnapshot.tariffName)
    || (isPickup ? "Самовывоз" : rawText(order.delivery_zone_current_name) || "Обычная доставка");

  const deliveryZoneName =
    rawText(deliverySnapshot.zoneName)
    || rawText(order.delivery_zone_current_name);

  const deliveryIsExpress = booleanValue(deliverySnapshot.isExpress);
  const deliveryFreeThresholdApplied = booleanValue(deliverySnapshot.freeThresholdApplied);
  const trackingToken = rawText(order.tracking_token);
  const deliveryIntervalName = rawText(order.delivery_interval_name);
  const deliveryCommentText = rawText(order.delivery_comment);
  const isDeliveryCommentJustInterval = /^\d{1,2}:\d{2}\s*[—–-]\s*\d{1,2}:\d{2}$/.test(deliveryCommentText);
  const deliveryIntervalText =
    deliveryIntervalName
    || rawText(deliverySnapshot.intervalName)
    || (isDeliveryCommentJustInterval ? deliveryCommentText : "");
  const visibleDeliveryComment =
    deliveryCommentText
    && deliveryCommentText !== deliveryIntervalText
    && !isDeliveryCommentJustInterval
      ? deliveryCommentText
      : "";

  const zones: OrderDeliveryZoneOption[] = (data?.deliveryOptions?.zones ?? [])
    .filter((zone) => rawText(zone.id) && rawText(zone.name))
    .map((zone) => ({
      id: rawText(zone.id),
      name: rawText(zone.name),
      price: numberValue(zone.price),
      freeFromAmount:
        zone.free_from_amount === null || zone.free_from_amount === undefined
          ? null
          : numberValue(zone.free_from_amount),
      isExpressAvailable: booleanValue(zone.is_express_available),
      expressPrice:
        zone.express_price === null || zone.express_price === undefined
          ? null
          : numberValue(zone.express_price),
      isActive: booleanValue(zone.is_active)
    }));

  const intervals: OrderDeliveryIntervalOption[] = (data?.deliveryOptions?.intervals ?? [])
    .filter((interval) => rawText(interval.id) && rawText(interval.name))
    .map((interval) => ({
      id: rawText(interval.id),
      name: rawText(interval.name),
      startsAt: rawText(interval.starts_at),
      endsAt: rawText(interval.ends_at),
      isActive: booleanValue(interval.is_active)
    }));

  const deliverySettings = data?.deliveryOptions?.settings ?? {};
  const pickupEnabled = booleanValue(deliverySettings.pickup_enabled);
  const pickupAddress = rawText(deliverySettings.pickup_address);
  const isTerminal = status === "delivered" || status === "cancelled";

  const operationalChecklist: ChecklistItem[] = [];

  if (canManage) {
    const hasCustomer = rawText(order.customer_name).length >= 2 && rawText(order.customer_phone).length >= 5;
    const hasRecipient = rawText(order.recipient_name).length >= 2 && rawText(order.recipient_phone).length >= 5;
    const hasDelivery = isPickup
      ? pickupEnabled || Boolean(rawText(order.delivery_address_text))
      : Boolean(rawText(order.delivery_date) && deliveryIntervalText && rawText(order.delivery_address_text));
    const needsFlorist = !["new", "cancelled"].includes(status);
    const needsCourier = ["ready", "assigned_courier", "delivering"].includes(status);
    const needsPhoto = ["ready", "assigned_courier", "delivering", "delivered"].includes(status);
    const paymentReady = paymentStatus === "paid" || paymentMethod === "cash_on_delivery";

    operationalChecklist.push(
      {
        label: "Контакты покупателя",
        detail: hasCustomer ? "Имя и телефон заполнены" : "Нужно уточнить имя или телефон",
        state: hasCustomer ? "ready" : "missing"
      },
      {
        label: "Получатель",
        detail: hasRecipient ? "Получатель и телефон указаны" : "Нужно заполнить данные получателя",
        state: hasRecipient ? "ready" : "missing"
      },
      {
        label: isPickup ? "Самовывоз" : "Доставка",
        detail: hasDelivery
          ? isPickup
            ? "Условия получения заполнены"
            : `${dateOnly(order.delivery_date)}, ${deliveryIntervalText}`
          : "Не хватает даты, интервала или адреса",
        state: hasDelivery ? "ready" : "missing"
      },
      {
        label: "Флорист",
        detail: rawText(order.florist_name)
          ? `Назначен: ${rawText(order.florist_name)}`
          : needsFlorist
            ? "Флорист ещё не назначен"
            : "Назначение после подтверждения",
        state: rawText(order.florist_name) ? "ready" : needsFlorist ? "missing" : "warning"
      },
      {
        label: "Курьер",
        detail: isPickup
          ? "Для самовывоза не требуется"
          : rawText(order.courier_name)
            ? `Назначен: ${rawText(order.courier_name)}`
            : needsCourier
              ? "Курьер ещё не назначен"
              : "Назначение ближе к готовности",
        state: isPickup || rawText(order.courier_name)
          ? "ready"
          : needsCourier
            ? "missing"
            : "warning"
      },
      {
        label: "Оплата",
        detail: paymentReady
          ? paymentStatus === "paid"
            ? "Заказ оплачен"
            : "Оплата при получении"
          : paymentUrl
            ? "Ссылка отправлена, ждём оплату"
            : "Ссылка или отметка оплаты отсутствует",
        state: paymentReady ? "ready" : paymentUrl ? "warning" : "missing"
      },
      {
        label: "Фото букета",
        detail: bouquetPhotoUrl
          ? "Фото готового букета загружено"
          : needsPhoto
            ? "Фото должно быть загружено флористом"
            : "Появится после сборки",
        state: bouquetPhotoUrl ? "ready" : needsPhoto ? "missing" : "warning"
      },
      {
        label: "Согласование букета",
        detail: bouquetApprovalLabels[bouquetApprovalStatus] || bouquetApprovalStatus,
        state: !bouquetPhotoUrl
          ? needsPhoto
            ? "missing"
            : "warning"
          : ["approved", "waived", "not_required"].includes(
                bouquetApprovalStatus,
              )
            ? "ready"
            : bouquetApprovalStatus === "revision_requested"
              ? "missing"
              : "warning"
      },
      {
        label: "Фото доставки",
        detail: isPickup
          ? "Для самовывоза не требуется"
          : deliveryProofPhotoUrl
            ? "Курьер подтвердил вручение фотографией"
            : status === "delivered"
              ? "Заказ закрыт без фотографии доставки"
              : ["assigned_courier", "delivering"].includes(status)
                ? "Курьер загрузит фото при завершении доставки"
                : "Появится после вручения заказа",
        state: isPickup || deliveryProofPhotoUrl
          ? "ready"
          : status === "delivered"
            ? "missing"
            : "warning"
      }
    );
  }

  return (
    <div
      className={[
        "admin-page",
        "admin-order-detail-page",
        `admin-order-detail-role-${viewerRole}`
      ].join(" ")}
    >
      <div className="admin-page-head">
        <div>
          <span>CRM / заказ</span>
          <h1>{text(order.order_number)}</h1>
          <p>Создан: {dateTime(order.created_at)}</p>
        </div>
        <a className="admin-small-link" href="/admin/orders">← К списку</a>
      </div>

      <section className="admin-order-detail-hero admin-panel">
        <div className="admin-order-detail-statuses">
          <span className={`admin-status-chip status-${statusClass(status)}`}>
            {orderStatusLabels[status] || status || "—"}
          </span>
          {canManage ? (
            <span className={`admin-status-chip payment-${statusClass(paymentStatus)}`}>
              {paymentStatusLabels[paymentStatus] || paymentStatus || "—"}
            </span>
          ) : null}
        </div>

        {canManage ? (
          <div className="admin-order-detail-total">
            <span>Итого</span>
            <strong>{money(order.total)}</strong>
          </div>
        ) : null}

        <OrderActions
          orderId={rawText(order.id)}
          status={status}
          paymentStatus={paymentStatus}
          paymentUrl={paymentUrl}
          trackingToken={trackingToken}
          internalChatCount={numberValue(order.internal_chat_unread_count)}
          internalChatPreview={rawText(order.internal_chat_last_message)}
          problemReturnStatus={rawText(order.problem_return_status)}
          showDetailsLink={false}
          showStatusActions
          viewerRole={viewerRole}
        />
      </section>

      {canManage ? (
        <section className="admin-panel admin-order-detail-card admin-order-checklist-card">
          <div className="admin-panel-head">
            <div>
              <span>Контроль перед выполнением</span>
              <h2>Готовность заказа</h2>
            </div>
          </div>

          <div className="admin-order-checklist">
            {operationalChecklist.map((item) => (
              <ChecklistCard key={item.label} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {canManage ? (
        <section className="admin-panel admin-order-detail-card admin-order-assignees-card">
          <div className="admin-panel-head">
            <div>
              <span>Команда заказа</span>
              <h2>Ответственные</h2>
            </div>
          </div>

          <OrderAssigneesForm
            orderId={rawText(order.id)}
            currentManagerId={rawText(order.manager_id)}
            currentFloristId={rawText(order.florist_id)}
            currentCourierId={rawText(order.courier_id)}
            staff={staff}
          />
        </section>
      ) : null}

      {canManage ? (
        <section className="admin-panel admin-order-detail-card admin-order-edit-card">
          <div className="admin-panel-head">
            <div>
              <span>Операционная карточка</span>
              <h2>Покупатель, получатель и доставка</h2>
            </div>
          </div>

          <OrderOperationsForm
            orderId={rawText(order.id)}
            disabled={isTerminal}
            disabledReason={
              status === "delivered"
                ? "Доставленный заказ защищён от изменений."
                : status === "cancelled"
                  ? "Отменённый заказ защищён от изменений."
                  : ""
            }
            paymentStatus={paymentStatus}
            subtotal={numberValue(order.subtotal)}
            discountTotal={numberValue(order.discount_total)}
            bonusSpent={numberValue(order.bonus_spent)}
            currentDeliveryPrice={numberValue(order.delivery_price)}
            initial={{
              customerName: rawText(order.customer_name),
              customerPhone: rawText(order.customer_phone),
              customerEmail: rawText(order.customer_email),
              recipientName: rawText(order.recipient_name),
              recipientPhone: rawText(order.recipient_phone),
              contactPreference:
                ["call_or_message", "phone_call", "messenger_only"].includes(rawText(order.contact_preference))
                  ? rawText(order.contact_preference) as "call_or_message" | "phone_call" | "messenger_only"
                  : "call_or_message",
              isSurprise: booleanValue(recipientMetadata.isSurprise),
              doNotCallRecipient: booleanValue(recipientMetadata.doNotCall),
              cardText: rawText(recipientMetadata.cardText),
              customerComment: rawText(order.customer_comment),
              deliveryType: isPickup ? "pickup" : "delivery",
              deliveryService: deliveryIsExpress ? "express" : "standard",
              deliveryZoneId: rawText(order.delivery_zone_id),
              deliveryIntervalId: rawText(order.delivery_interval_id),
              deliveryDate: dateInputValue(order.delivery_date),
              deliveryAddress: rawText(order.delivery_address_text),
              deliveryComment: visibleDeliveryComment
            }}
            zones={zones}
            intervals={intervals}
            pickupEnabled={pickupEnabled}
            pickupAddress={pickupAddress}
          />
        </section>
      ) : null}

      <section className="admin-panel admin-order-detail-card admin-order-history-card">
        <div className="admin-panel-head">
          <div>
            <span>Движение и изменения</span>
            <h2>История заказа</h2>
          </div>
        </div>

        {history.length ? (
          <div className="admin-order-history-list">
            {history.map((event, index) => {
              const fromStatus = rawText(event.from_status);
              const toStatus = rawText(event.to_status);
              const eventKey = rawText(event.id) || `${rawText(event.created_at)}-${index}`;
              const changedByName = rawText(event.changed_by_name);
              const isOperationalUpdate = fromStatus && fromStatus === toStatus;

              return (
                <article key={eventKey} className="admin-order-history-item">
                  <div className="admin-order-history-dot" />
                  <div className="admin-order-history-body">
                    <div className="admin-order-history-top">
                      <strong>{dateTime(event.created_at)}</strong>
                      <span>
                        {isOperationalUpdate
                          ? "Данные заказа обновлены"
                          : `${orderStatusLabels[fromStatus] || fromStatus || "—"} → ${orderStatusLabels[toStatus] || toStatus || "—"}`}
                      </span>
                    </div>
                    <p>{text(event.comment)}</p>
                    <small className="admin-order-history-author">
                      Автор: {changedByName || "Система"}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="admin-order-comment">История заказа пока пустая.</p>
        )}
      </section>

      <section className="admin-order-detail-grid admin-order-main-grid">
        {canManage ? (
          <article className="admin-panel admin-order-detail-card admin-order-customer-card">
            <div className="admin-panel-head"><h2>Покупатель</h2></div>
            <InfoRow label="Имя" value={order.customer_name} />
            <InfoRow label="Телефон" value={order.customer_phone} />
            <ContactActions phone={rawText(order.customer_phone)} />
            <InfoRow label="Email" value={order.customer_email} />
            <InfoRow
              label="Связь"
              value={contactPreferenceLabels[rawText(order.contact_preference)] || order.contact_preference}
            />
          </article>
        ) : null}

        {canManage || viewerRole === "courier" ? (
          <article className="admin-panel admin-order-detail-card admin-order-recipient-card">
            <div className="admin-panel-head"><h2>Получатель</h2></div>
            <InfoRow label="Имя" value={order.recipient_name} />
            <InfoRow label="Телефон" value={order.recipient_phone} />
            {rawText(order.recipient_phone) ? (
              <ContactActions phone={rawText(order.recipient_phone)} />
            ) : null}
            <InfoRow label="Сюрприз" value={booleanValue(recipientMetadata.isSurprise) ? "Да" : "Нет"} />
            <InfoRow label="Не звонить" value={booleanValue(recipientMetadata.doNotCall) ? "Да" : "Нет"} />
            {rawText(recipientMetadata.cardText) ? (
              <InfoRow label="Открытка" value={recipientMetadata.cardText} />
            ) : null}
          </article>
        ) : null}

        <article
          className={[
            "admin-panel",
            "admin-order-detail-card",
            "admin-order-delivery-card",
            deliveryIsExpress ? "is-express" : ""
          ].filter(Boolean).join(" ")}
        >
          <div className="admin-panel-head">
            <div>
              <span>Логистика</span>
              <h2>{isPickup ? "Самовывоз" : deliveryTariffName}</h2>
            </div>
            {deliveryIsExpress ? <span className="admin-express-order-badge">СРОЧНО</span> : null}
          </div>

          <InfoRow label="Тип получения" value={isPickup ? "Самовывоз" : "Доставка"} />
          {!isPickup ? <InfoRow label="Тариф" value={deliveryTariffName} /> : null}
          {!isPickup && deliveryZoneName ? <InfoRow label="Зона" value={deliveryZoneName} /> : null}
          {!isPickup && hasDeliverySnapshot ? (
            <InfoRow label="Срочная доставка" value={deliveryIsExpress ? "Да, приоритетная" : "Нет"} />
          ) : null}
          {!isPickup && deliveryFreeThresholdApplied ? (
            <InfoRow label="Бесплатный порог" value="Применён" />
          ) : null}
          {!isPickup ? <InfoRow label="Дата" value={dateOnly(order.delivery_date)} /> : null}
          {!isPickup ? <InfoRow label="Интервал" value={deliveryIntervalText} /> : null}
          {status === "delivered" ? (
            <InfoRow label="Доставлено" value={dateTime(order.delivered_at)} />
          ) : null}
          {visibleDeliveryComment ? <InfoRow label="Комментарий" value={visibleDeliveryComment} /> : null}
          <InfoRow label="Адрес" value={order.delivery_address_text} />
          {!isPickup && rawText(order.delivery_address_text) ? (
            <DeliveryAddressActions address={rawText(order.delivery_address_text)} />
          ) : null}
          {canManage ? (
            <InfoRow
              label={isPickup ? "Стоимость" : "Стоимость тарифа"}
              value={numberValue(order.delivery_price) > 0 ? money(order.delivery_price) : "Бесплатно"}
            />
          ) : null}
        </article>

        {canManage ? (
          <article className="admin-panel admin-order-detail-card admin-order-payment-card">
            <div className="admin-panel-head">
              <div><span>Расчёты</span><h2>Оплата</h2></div>
            </div>
            <InfoRow label="Статус" value={paymentStatusLabels[paymentStatus] || paymentStatus || "—"} />
            <InfoRow label="Способ" value={paymentMethodLabels[paymentMethod] || paymentMethod || "—"} />
            {paymentStatus === "paid" ? (
              <InfoRow label="Оплачено" value={paymentPaidAt ? dateTime(paymentPaidAt) : "Дата не зафиксирована"} />
            ) : null}
            {paymentUrl ? (
              <div className="admin-order-info-row">
                <span>Ссылка оплаты</span>
                <a className="admin-payment-open-link" href={paymentUrl} target="_blank" rel="noopener noreferrer">
                  Открыть ссылку
                </a>
              </div>
            ) : (
              <InfoRow
                label="Ссылка оплаты"
                value={status === "new" ? "Будет доступна после подтверждения" : "Не добавлена"}
              />
            )}

            {payments.length ? (
              <div className="admin-order-payment-history">
                <strong>История платежей</strong>
                {payments.map((payment, index) => {
                  const paymentId = rawText(payment.id) || `payment-${index}`;
                  const historyStatus = rawText(payment.status);

                  return (
                    <div key={paymentId} className="admin-order-payment-history-row">
                      <div>
                        <span>{paymentStatusLabels[historyStatus] || historyStatus || "—"}</span>
                        <small>{paymentMethodLabels[rawText(payment.method)] || rawText(payment.method) || "—"}</small>
                      </div>
                      <div>
                        <strong>{money(payment.amount)}</strong>
                        <small>{dateTime(payment.paid_at || payment.created_at)}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <OrderFinanceActions
              orderId={rawText(order.id)}
              orderNumber={rawText(order.order_number)}
              orderStatus={status}
              paymentStatus={paymentStatus}
              total={numberValue(order.total)}
              canRefund={canRefund}
            />
          </article>
        ) : null}
      </section>

      <section className="admin-panel admin-order-detail-card admin-order-items-card">
        <div className="admin-panel-head"><h2>Состав заказа</h2></div>
        <div className="admin-order-items-list">
          {items.map((item, index) => (
            <article key={`${text(item.product_id)}-${index}`} className="admin-order-item-row admin-order-item-row-with-image">
              <div className="admin-order-item-main">
                {item.image_url ? (
                  <img className="admin-order-item-image" src={rawText(item.image_url)} alt={text(item.product_name)} />
                ) : null}
                <div>
                  <strong>{text(item.product_name)}</strong>
                  <span>
                    {numberValue(item.quantity)}{canManage ? ` × ${money(item.price)}` : ""}
                  </span>
                </div>
              </div>
              {canManage ? <strong>{money(item.total)}</strong> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="admin-order-detail-grid admin-order-summary-grid">
        {canManage ? (
          <article className="admin-panel admin-order-detail-card admin-order-finance-card">
            <div className="admin-panel-head"><h2>Финансы</h2></div>
            <InfoRow label="Товары" value={money(order.subtotal)} />
            <InfoRow label={isPickup ? "Самовывоз" : "Доставка"} value={money(order.delivery_price)} />
            <InfoRow
              label="Скидка"
              value={numberValue(order.discount_total) > 0 ? `−${money(order.discount_total)}` : money(0)}
            />
            <InfoRow
              label="Бонусы списаны"
              value={numberValue(order.bonus_spent) > 0 ? `−${money(order.bonus_spent)}` : money(0)}
            />
            <InfoRow label="Бонусы к начислению" value={money(order.bonus_earned)} />
            <InfoRow label="Итого" value={money(order.total)} />
          </article>
        ) : null}

        <article className="admin-panel admin-order-detail-card admin-order-bouquet-card">
          <div className="admin-panel-head">
            <div><span>Контроль качества</span><h2>Фото готового букета</h2></div>
          </div>
          {bouquetPhotoUrl ? (
            <div className="admin-bouquet-photo-card">
              <a
                className="admin-bouquet-photo-preview-link"
                href={bouquetPhotoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Открыть фото готового букета в полном размере"
              >
                <img
                  src={bouquetPhotoUrl}
                  alt={`Фото готового букета по заказу ${rawText(order.order_number)}`}
                  loading="lazy"
                  decoding="async"
                />
              </a>
              <div className="admin-bouquet-photo-meta">
                <span>Загружено флористом</span>
                <a className="admin-bouquet-photo-link" href={bouquetPhotoUrl} target="_blank" rel="noopener noreferrer">
                  Открыть оригинал
                </a>
              </div>

              <div className={`admin-bouquet-approval-status is-${statusClass(bouquetApprovalStatus)}`}>
                <strong>
                  {bouquetApprovalLabels[bouquetApprovalStatus]
                    || bouquetApprovalStatus}
                </strong>
                {bouquetApprovalRequestedAt ? (
                  <span>Отправлено: {dateTime(bouquetApprovalRequestedAt)}</span>
                ) : null}
                {bouquetApprovalDecidedAt ? (
                  <span>Решение: {dateTime(bouquetApprovalDecidedAt)}</span>
                ) : null}
                {bouquetApprovalRevisionCount > 0 ? (
                  <span>Запросов на правку: {bouquetApprovalRevisionCount}</span>
                ) : null}
                {bouquetApprovalNote ? <p>{bouquetApprovalNote}</p> : null}
              </div>

              {canManage && status === "assembling" ? (
                <>
                  <BouquetApprovalActions
                    orderId={rawText(order.id)}
                    approvalStatus={bouquetApprovalStatus}
                    disabled={isTerminal}
                  />
                  {trackingToken ? (
                    <a
                      className="admin-bouquet-tracking-link"
                      href={`/order/track/${encodeURIComponent(trackingToken)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть страницу согласования покупателя
                    </a>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div className="admin-bouquet-photo-empty">
              <strong>Фото ещё не загружено</strong>
              <p>Оно появится здесь после того, как флорист отправит снимок через Telegram.</p>
            </div>
          )}
        </article>

        <article className="admin-panel admin-order-detail-card admin-order-delivery-proof-card">
          <div className="admin-panel-head">
            <div>
              <span>Подтверждение вручения</span>
              <h2>Фото доставки</h2>
            </div>
          </div>

          {isPickup ? (
            <div className="admin-bouquet-photo-empty">
              <strong>Для самовывоза фото не требуется</strong>
              <p>Заказ получает клиент непосредственно в точке самовывоза.</p>
            </div>
          ) : deliveryProofPhotoUrl ? (
            <div className="admin-bouquet-photo-card admin-delivery-proof-photo-card">
              <a
                className="admin-bouquet-photo-preview-link"
                href={deliveryProofPhotoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Открыть фото подтверждения доставки в полном размере"
              >
                <img
                  src={deliveryProofPhotoUrl}
                  alt={`Подтверждение доставки заказа ${rawText(order.order_number)}`}
                  loading="lazy"
                  decoding="async"
                />
              </a>
              <div className="admin-bouquet-photo-meta">
                <span>
                  Загружено курьером
                  {deliveryProofUploadedAt
                    ? ` · ${dateTime(deliveryProofUploadedAt)}`
                    : ""}
                </span>
                <a
                  className="admin-bouquet-photo-link"
                  href={deliveryProofPhotoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть оригинал
                </a>
              </div>
              <p className="admin-delivery-proof-note">
                Не требуется фотографировать лицо получателя. Люди могут быть
                в кадре только с их согласия.
              </p>
            </div>
          ) : (
            <div className="admin-bouquet-photo-empty">
              <strong>
                {status === "delivered"
                  ? "Заказ доставлен без фото"
                  : "Фото доставки ещё не загружено"}
              </strong>
              <p>
                Курьер должен отправить фотографию через Telegram после
                вручения. Только после сохранения фото заказ автоматически
                получает статус «Доставлен».
              </p>
            </div>
          )}
        </article>

        {rawText(order.customer_comment) ? (
          <article className="admin-panel admin-order-detail-card admin-order-customer-comment-card">
            <div className="admin-panel-head">
              <div><span>От клиента</span><h2>Комментарий клиента</h2></div>
            </div>
            <p className="admin-order-comment">{text(order.customer_comment)}</p>
          </article>
        ) : null}

        {canManage ? (
          <article className="admin-panel admin-order-detail-card admin-order-internal-comment-card">
            <div className="admin-panel-head">
              <div><span>Только для CRM</span><h2>Внутренний комментарий</h2></div>
            </div>
            <InternalCommentForm
              orderId={rawText(order.id)}
              initialValue={rawText(order.internal_comment)}
            />
          </article>
        ) : null}
      </section>
    </div>
  );
}
