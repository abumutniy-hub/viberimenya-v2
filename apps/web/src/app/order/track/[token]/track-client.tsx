"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addRepeatOrderProducts,
  type RepeatOrderCartProduct,
} from "../../../lib/repeat-order-cart";

type TrackOrder = {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryType: string;
  deliveryDate: string | null;
  deliveryInterval: string | null;
  deliveryAddress: string | null;
  subtotal: number;
  discountTotal: number;
  deliveryPrice: number;
  bonusSpent: number;
  bonusEarned: number;
  total: number;
  trackingToken: string;
  bouquetPhotoUrl: string | null;
  bouquetApproval: {
    status: string;
    requestedAt: string | null;
    decidedAt: string | null;
    note: string | null;
    source: string | null;
    revisionCount: number;
    photoVersion: number;
    canRespond: boolean;
  };
  deliveryProofPhotoUrl: string | null;
  deliveryProofUploadedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrackItem = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
};

type Payment = {
  status: string;
  amount: number;
  currency: string;
  payment_url: string | null;
} | null;

type TrackResponse = {
  ok?: boolean;
  message?: string;
  order?: TrackOrder;
  items?: TrackItem[];
  payment?: Payment;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function dateText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU");
}

function dateTimeText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusText(status: string) {
  const map: Record<string, string> = {
    new: "Заказ принят",
    confirmed: "Заказ подтверждён",
    assembling: "Букет собирается",
    ready: "Заказ готов",
    assigned_courier: "Передан курьеру",
    delivering: "В доставке",
    delivered: "Доставлен",
    cancelled: "Отменён",
    problem: "Требует уточнения",
  };

  return map[status] || status;
}

function paymentText(status: string) {
  const map: Record<string, string> = {
    not_required: "Оплата не требуется",
    pending: "Ожидает оплаты",
    paid: "Оплачен",
    failed: "Ошибка оплаты",
    refunded: "Возврат",
    cancelled: "Отменена",
  };

  return map[status] || status;
}

function deliveryTypeText(type: string) {
  return type === "pickup" ? "Самовывоз" : "Доставка";
}

function paymentMethodText(method: string) {
  const map: Record<string, string> = {
    cash_on_delivery: "При получении",
    transfer_after_confirm: "Перевод после подтверждения",
    online_card: "Онлайн-картой",
    sbp: "СБП",
  };

  return map[method] || method;
}

type OrderStepState = "done" | "active" | "waiting";

const orderTimelineSteps = [
  {
    key: "accepted",
    title: "Заказ принят",
    text: "Мы получили заказ и передали его менеджеру.",
  },
  {
    key: "confirmed",
    title: "Подтверждение",
    text: "Менеджер проверяет детали, состав и время доставки.",
  },
  {
    key: "payment",
    title: "Оплата",
    text: "После подтверждения появится ссылка или инструкция для оплаты.",
  },
  {
    key: "assembly",
    title: "Сборка букета",
    text: "Флорист собирает композицию к выбранному времени.",
  },
  {
    key: "delivery",
    title: "Доставка",
    text: "Курьер получает заказ и везёт его получателю.",
  },
  {
    key: "delivered",
    title: "Доставлен",
    text: "Заказ передан получателю.",
  },
] as const;

function orderStepState(order: TrackOrder, stepKey: string): OrderStepState {
  const status = order.status;
  const paymentStatus = order.paymentStatus;

  if (status === "cancelled" || status === "problem") {
    return stepKey === "confirmed"
      ? "active"
      : stepKey === "accepted"
        ? "done"
        : "waiting";
  }

  if (stepKey === "accepted") return "done";

  if (stepKey === "confirmed") {
    return [
      "confirmed",
      "assembling",
      "ready",
      "assigned_courier",
      "delivering",
      "delivered",
    ].includes(status)
      ? "done"
      : "active";
  }

  if (stepKey === "payment") {
    if (paymentStatus === "paid") return "done";
    if (status === "confirmed") return "active";
    return [
      "assembling",
      "ready",
      "assigned_courier",
      "delivering",
      "delivered",
    ].includes(status)
      ? "done"
      : "waiting";
  }

  if (stepKey === "assembly") {
    if (
      ["ready", "assigned_courier", "delivering", "delivered"].includes(status)
    )
      return "done";
    return status === "assembling" ? "active" : "waiting";
  }

  if (stepKey === "delivery") {
    if (status === "delivered") return "done";
    return ["ready", "assigned_courier", "delivering"].includes(status)
      ? "active"
      : "waiting";
  }

  if (stepKey === "delivered")
    return status === "delivered" ? "done" : "waiting";
  return "waiting";
}

function orderProgressText(order: TrackOrder) {
  if (order.status === "cancelled") return "Заказ отменён";
  if (order.status === "problem") return "Нужно уточнение по заказу";
  if (order.status === "delivered") return "Заказ доставлен";
  if (order.status === "delivering" || order.status === "assigned_courier")
    return "Заказ в доставке";
  if (order.status === "ready") return "Букет готовится к передаче курьеру";
  if (order.status === "assembling") {
    if (order.bouquetApproval.status === "pending") {
      return "Фото готового букета ждёт вашего согласования";
    }

    if (order.bouquetApproval.status === "revision_requested") {
      return "Флорист вносит изменения по вашему комментарию";
    }

    return "Букет собирается";
  }
  if (order.paymentStatus !== "paid" && order.status === "confirmed")
    return "Ожидается оплата";
  if (order.status === "confirmed") return "Заказ подтверждён";
  return "Менеджер проверяет заказ";
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function TrackClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [items, setItems] = useState<TrackItem[]>([]);
  const [payment, setPayment] = useState<Payment>(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [repeatMessage, setRepeatMessage] = useState("");
  const [repeating, setRepeating] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [deliveryPhotoFailed, setDeliveryPhotoFailed] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [approvalBusy, setApprovalBusy] = useState<"approve" | "revision" | "">("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [approvalError, setApprovalError] = useState(false);

  const loadOrder = useCallback(
    async (silent: boolean) => {
      if (silent) setRefreshing(true);

      try {
        const response = await fetch(
          `/api/public/orders/track/${encodeURIComponent(token)}`,
          {
            cache: "no-store",
          },
        );
        const data = (await readJson(response)) as TrackResponse;

        if (!response.ok || data.ok !== true || !data.order) {
          throw new Error(data.message || "Заказ не найден");
        }

        setOrder(data.order);
        setItems(Array.isArray(data.items) ? data.items : []);
        setPayment(data.payment ?? null);
        setLastUpdated(new Date());
        setError("");
      } catch (cause) {
        if (!silent) {
          setError(cause instanceof Error ? cause.message : "Заказ не найден");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadOrder(false);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadOrder(true);
      }
    }, 30000);

    return () => window.clearInterval(timer);
  }, [loadOrder]);

  const canRepeat = useMemo(
    () => items.some((item) => Boolean(item.productId)),
    [items],
  );

  async function repeatOrder() {
    if (!canRepeat || repeating) return;

    setRepeating(true);
    setRepeatMessage("");

    try {
      const productIds = [
        ...new Set(items.map((item) => item.productId).filter(Boolean)),
      ];
      const response = await fetch("/api/public/cart-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, slugs: [] }),
      });
      const data = await readJson(response);

      if (!response.ok || !Array.isArray(data.items)) {
        throw new Error("Не удалось проверить актуальное наличие товаров");
      }

      const freshProducts = data.items as Array<{
        id: string;
        slug: string;
        name: string;
        price: number;
        availability: "available" | "unavailable";
        primaryImage?: { url?: string; alt?: string | null } | null;
      }>;
      const freshById = new Map(
        freshProducts.map((product) => [String(product.id), product]),
      );
      const products: RepeatOrderCartProduct[] = items.map((item) => {
        const fresh = freshById.get(item.productId);

        return {
          productId: item.productId,
          slug: fresh?.slug ?? "",
          name: fresh?.name ?? item.name,
          price: Number(fresh?.price ?? item.price),
          quantity: item.quantity,
          imageUrl: String(fresh?.primaryImage?.url ?? ""),
          imageAlt: String(
            fresh?.primaryImage?.alt ?? fresh?.name ?? item.name,
          ),
          availability: fresh?.availability ?? "unavailable",
        };
      });
      const result = addRepeatOrderProducts(products);

      if (result.addedQuantity <= 0) {
        throw new Error("Товары из этого заказа сейчас недоступны");
      }

      setRepeatMessage(
        result.skippedQuantity > 0
          ? `Доступные позиции добавлены. Пропущено: ${result.skippedQuantity}.`
          : "Заказ добавлен в корзину по актуальным ценам.",
      );
      window.setTimeout(() => window.location.assign("/cart"), 700);
    } catch (cause) {
      setRepeatMessage(
        cause instanceof Error ? cause.message : "Не удалось повторить заказ",
      );
    } finally {
      setRepeating(false);
    }
  }

  async function submitBouquetApproval(action: "approve" | "revision") {
    if (!order || approvalBusy || !order.bouquetApproval.canRespond) return;

    if (action === "revision" && approvalNote.trim().length < 3) {
      setApprovalError(true);
      setApprovalMessage("Опишите, что нужно изменить, минимум тремя символами.");
      return;
    }

    setApprovalBusy(action);
    setApprovalMessage("");
    setApprovalError(false);

    try {
      const response = await fetch(
        `/api/public/orders/track/${encodeURIComponent(token)}/bouquet-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: action === "revision" ? approvalNote.trim() : "",
          }),
        },
      );
      const data = await readJson(response);
      const responseMessage = String(data.message || "").trim();

      if (!response.ok || data.ok !== true) {
        throw new Error(responseMessage || "Не удалось отправить ответ");
      }

      setApprovalError(false);
      setApprovalMessage(
        responseMessage
          || (action === "approve"
            ? "Спасибо, фото одобрено."
            : "Комментарий передан флористу."),
      );
      setApprovalNote("");
      await loadOrder(true);
    } catch (cause) {
      setApprovalError(true);
      setApprovalMessage(
        cause instanceof Error ? cause.message : "Не удалось отправить ответ",
      );
    } finally {
      setApprovalBusy("");
    }
  }

  if (loading) {
    return (
      <div className="track-page">
        <section className="track-card">
          <p>Загружаем заказ…</p>
        </section>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="track-page">
        <section className="track-card">
          <p className="eyebrow">Заказ</p>
          <h1>Заказ не найден</h1>
          <p>{error || "Проверьте ссылку или свяжитесь с магазином."}</p>
          <a href="/" className="track-dark-link">
            На главную
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="track-page">
      <section
        className={`track-hero track-hero-polished status-${order.status}`}
      >
        <div>
          <p className="eyebrow">Заказ</p>
          <h1>{order.orderNumber}</h1>
          <p>{orderProgressText(order)}</p>
          <small>
            Обновлено:{" "}
            {lastUpdated ? dateTimeText(lastUpdated.toISOString()) : "—"}
            {refreshing ? " · проверяем статус…" : ""}
          </small>
        </div>

        <div className="track-hero-badges">
          <div className="track-status-pill">{statusText(order.status)}</div>
          <div className="track-status-pill light">
            {paymentText(order.paymentStatus)}
          </div>
          <button
            type="button"
            onClick={() => void loadOrder(true)}
            disabled={refreshing}
          >
            {refreshing ? "Обновляем…" : "Обновить"}
          </button>
        </div>
      </section>

      {order.status === "problem" || order.status === "cancelled" ? (
        <section className={`track-alert ${order.status}`}>
          <strong>
            {order.status === "problem" ? "Нужно уточнение" : "Заказ отменён"}
          </strong>
          <p>
            {order.status === "problem"
              ? "Менеджер свяжется с покупателем, чтобы уточнить детали заказа."
              : "Подробности отмены можно уточнить у менеджера магазина."}
          </p>
        </section>
      ) : null}

      <section className="track-card track-progress-card">
        <div className="track-progress-head">
          <div>
            <h2>Путь заказа</h2>
            <p>{orderProgressText(order)}</p>
          </div>
          <span>{statusText(order.status)}</span>
        </div>

        <div className="order-timeline">
          {orderTimelineSteps.map((step, index) => {
            const state = orderStepState(order, step.key);

            return (
              <article
                key={step.key}
                className={`order-timeline-step ${state}`}
              >
                <span className="order-timeline-dot">
                  {state === "done" ? "✓" : index + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.text}</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="track-grid">
        <article className="track-card">
          <h2>Оплата</h2>
          <div className="track-lines">
            <span>Статус: {paymentText(order.paymentStatus)}</span>
            <span>Способ: {paymentMethodText(order.paymentMethod)}</span>
          </div>

          {order.paymentStatus === "paid" ? (
            <p>Заказ оплачен. Спасибо!</p>
          ) : payment?.payment_url ? (
            <>
              <p>Заказ подтверждён. Можно перейти к оплате.</p>
              <a
                href={payment.payment_url}
                className="track-dark-link"
                rel="nofollow"
              >
                Оплатить заказ
              </a>
            </>
          ) : (
            <p>
              После подтверждения менеджером здесь появится ссылка или
              инструкция для оплаты.
            </p>
          )}
        </article>

        <article className="track-card">
          <h2>{deliveryTypeText(order.deliveryType)}</h2>
          {order.deliveryType === "pickup" ? (
            <div className="track-lines">
              <span>Формат: самовывоз</span>
              <span>Менеджер подтвердит адрес и время получения.</span>
            </div>
          ) : (
            <div className="track-lines">
              <span>Дата: {dateText(order.deliveryDate)}</span>
              <span>Интервал: {order.deliveryInterval || "—"}</span>
              <span>Адрес: {order.deliveryAddress || "—"}</span>
              {order.deliveredAt ? (
                <span>Доставлено: {dateTimeText(order.deliveredAt)}</span>
              ) : null}
            </div>
          )}
        </article>
      </section>

      {order.bouquetPhotoUrl && !photoFailed ? (
        <section className="track-card track-bouquet-card track-bouquet-approval-card">
          <div className="track-bouquet-copy">
            <h2>Фото готового букета</h2>
            <p>Фотография композиции, добавленная флористом перед доставкой.</p>

            <div
              className={`track-bouquet-approval-status is-${order.bouquetApproval.status}`}
            >
              <strong>
                {order.bouquetApproval.status === "pending"
                  ? "Ожидает вашего решения"
                  : order.bouquetApproval.status === "approved"
                    ? "Фото одобрено"
                    : order.bouquetApproval.status === "revision_requested"
                      ? "Правка передана флористу"
                      : order.bouquetApproval.status === "waived"
                        ? "Согласование завершено менеджером"
                        : "Фото добавлено"}
              </strong>
              {order.bouquetApproval.decidedAt ? (
                <span>
                  Решение: {dateTimeText(order.bouquetApproval.decidedAt)}
                </span>
              ) : order.bouquetApproval.requestedAt ? (
                <span>
                  Отправлено: {dateTimeText(order.bouquetApproval.requestedAt)}
                </span>
              ) : null}
              {order.bouquetApproval.note ? (
                <p>{order.bouquetApproval.note}</p>
              ) : null}
            </div>

            {order.bouquetApproval.canRespond ? (
              <div className="track-bouquet-approval-form">
                <p>Всё подходит или нужно что-то изменить?</p>
                <textarea
                  value={approvalNote}
                  onChange={(event) =>
                    setApprovalNote(event.target.value.slice(0, 500))
                  }
                  placeholder="Комментарий нужен только при запросе правки"
                  rows={3}
                  disabled={Boolean(approvalBusy)}
                />
                <div className="track-bouquet-approval-buttons">
                  <button
                    type="button"
                    onClick={() => void submitBouquetApproval("approve")}
                    disabled={Boolean(approvalBusy)}
                  >
                    {approvalBusy === "approve" ? "Отправляем…" : "✓ Всё подходит"}
                  </button>
                  <button
                    type="button"
                    className="is-secondary"
                    onClick={() => void submitBouquetApproval("revision")}
                    disabled={Boolean(approvalBusy)}
                  >
                    {approvalBusy === "revision" ? "Отправляем…" : "Нужна правка"}
                  </button>
                </div>
                {approvalMessage ? (
                  <span
                    className={
                      approvalError
                        ? "track-bouquet-approval-message is-error"
                        : "track-bouquet-approval-message"
                    }
                  >
                    {approvalMessage}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <img
            src={order.bouquetPhotoUrl}
            alt={`Фото заказа ${order.orderNumber}`}
            onError={() => setPhotoFailed(true)}
          />
        </section>
      ) : null}

      {order.status === "delivered"
      && order.deliveryProofPhotoUrl
      && !deliveryPhotoFailed ? (
        <section className="track-card track-bouquet-card track-delivery-proof-card">
          <div>
            <h2>Подтверждение доставки</h2>
            <p>
              Фото загружено курьером после вручения. Получатель может не
              присутствовать в кадре — это сделано для сохранения приватности.
            </p>
            {order.deliveryProofUploadedAt ? (
              <small>
                Загружено: {dateTimeText(order.deliveryProofUploadedAt)}
              </small>
            ) : null}
          </div>
          <img
            src={order.deliveryProofPhotoUrl}
            alt={`Подтверждение доставки заказа ${order.orderNumber}`}
            onError={() => setDeliveryPhotoFailed(true)}
          />
        </section>
      ) : null}

      <section className="track-card">
        <h2>Состав заказа</h2>
        <div className="track-items">
          {items.map((item, index) => (
            <article
              key={`${item.productId}-${item.name}-${index}`}
              className="track-item"
            >
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity} × {money(item.price)}
                </span>
              </div>
              <strong>{money(item.total)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="track-card">
        <h2>Итого</h2>
        <div className="track-total">
          <span>Товары</span>
          <strong>{money(order.subtotal)}</strong>
          <span>
            {order.deliveryType === "pickup" ? "Самовывоз" : "Доставка"}
          </span>
          <strong>{money(order.deliveryPrice)}</strong>
          {order.discountTotal > 0 ? (
            <>
              <span>Скидка</span>
              <strong>−{money(order.discountTotal)}</strong>
            </>
          ) : null}
          {order.bonusSpent > 0 ? (
            <>
              <span>Бонусы</span>
              <strong>−{money(order.bonusSpent)}</strong>
            </>
          ) : null}
          <span>К оплате</span>
          <strong>{money(order.total)}</strong>
        </div>
      </section>

      <section className="track-actions-card track-actions-polished">
        <div>
          <strong>Заказать похожий букет?</strong>
          <p>При повторении заказа цены и наличие проверяются заново.</p>
          {repeatMessage ? <span>{repeatMessage}</span> : null}
        </div>
        <div>
          <button
            type="button"
            className="track-dark-link"
            disabled={!canRepeat || repeating}
            onClick={() => void repeatOrder()}
          >
            {repeating ? "Проверяем товары…" : "Повторить заказ"}
          </button>
          <a href="/catalog" className="track-light-link">
            Вернуться в каталог
          </a>
        </div>
      </section>
    </div>
  );
}
