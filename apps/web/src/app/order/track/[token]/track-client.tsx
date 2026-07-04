"use client";

import { useEffect, useState } from "react";

type TrackOrder = {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryType: string;
  deliveryDate: string | null;
  deliveryInterval: string | null;
  deliveryAddress: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: number;
  discountTotal: number;
  deliveryPrice: number;
  bonusSpent: number;
  bonusEarned: number;
  total: number;
  trackingToken: string;
  createdAt: string;
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

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function dateText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU");
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
    problem: "Требует уточнения"
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
    cancelled: "Отменена"
  };

  return map[status] || status;
}

type OrderStepState = "done" | "active" | "waiting";

const orderTimelineSteps = [
  {
    key: "accepted",
    title: "Заказ принят",
    text: "Мы получили заказ и передали его менеджеру."
  },
  {
    key: "confirmed",
    title: "Подтверждение",
    text: "Менеджер проверяет детали, состав и время доставки."
  },
  {
    key: "payment",
    title: "Оплата",
    text: "После подтверждения появится ссылка для оплаты."
  },
  {
    key: "assembly",
    title: "Сборка букета",
    text: "Флорист собирает композицию к выбранному времени."
  },
  {
    key: "delivery",
    title: "Доставка",
    text: "Курьер получает заказ и везёт его получателю."
  },
  {
    key: "delivered",
    title: "Доставлен",
    text: "Заказ передан получателю."
  }
] as const;

function orderStepState(order: TrackOrder, stepKey: string): OrderStepState {
  const status = order.status;
  const paymentStatus = order.paymentStatus;

  if (status === "cancelled" || status === "problem") {
    return stepKey === "confirmed" ? "active" : stepKey === "accepted" ? "done" : "waiting";
  }

  if (stepKey === "accepted") {
    return "done";
  }

  if (stepKey === "confirmed") {
    if (["confirmed", "assembling", "ready", "assigned_courier", "delivering", "delivered"].includes(status)) {
      return "done";
    }

    return "active";
  }

  if (stepKey === "payment") {
    if (paymentStatus === "paid") {
      return "done";
    }

    if (status === "confirmed") {
      return "active";
    }

    return ["assembling", "ready", "assigned_courier", "delivering", "delivered"].includes(status) ? "done" : "waiting";
  }

  if (stepKey === "assembly") {
    if (["ready", "assigned_courier", "delivering", "delivered"].includes(status)) {
      return "done";
    }

    if (status === "assembling") {
      return "active";
    }

    return "waiting";
  }

  if (stepKey === "delivery") {
    if (status === "delivered") {
      return "done";
    }

    if (["ready", "assigned_courier", "delivering"].includes(status)) {
      return "active";
    }

    return "waiting";
  }

  if (stepKey === "delivered") {
    return status === "delivered" ? "done" : "waiting";
  }

  return "waiting";
}

function orderProgressText(order: TrackOrder) {
  if (order.status === "cancelled") {
    return "Заказ отменён";
  }

  if (order.status === "problem") {
    return "Нужно уточнение по заказу";
  }

  if (order.status === "delivered") {
    return "Заказ доставлен";
  }

  if (order.status === "delivering" || order.status === "assigned_courier") {
    return "Заказ в доставке";
  }

  if (order.status === "ready") {
    return "Букет готовится к передаче курьеру";
  }

  if (order.status === "assembling") {
    return "Букет собирается";
  }

  if (order.paymentStatus !== "paid" && order.status === "confirmed") {
    return "Ожидается оплата";
  }

  if (order.status === "confirmed") {
    return "Заказ подтверждён";
  }

  return "Менеджер проверяет заказ";
}

export function TrackClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [items, setItems] = useState<TrackItem[]>([]);
  const [payment, setPayment] = useState<Payment>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/orders/track/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data?.message || "Заказ не найден");
        }

        setOrder(data.order);
        setItems(data.items || []);
        setPayment(data.payment || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Заказ не найден"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <main className="track-page">
        <section className="track-card">
          <p>Загружаем заказ…</p>
        </section>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="track-page">
        <section className="track-card">
          <p className="eyebrow">Заказ</p>
          <h1>Заказ не найден</h1>
          <p>{error || "Проверьте ссылку или свяжитесь с магазином."}</p>
          <a href="/" className="track-dark-link">На главную</a>
        </section>
      </main>
    );
  }

  return (
    <main className="track-page">
      <section className="track-hero">
        <div>
          <p className="eyebrow">Заказ</p>
          <h1>{order.orderNumber}</h1>
          <p>Статус: {statusText(order.status)}</p>
        </div>

        <div className="track-status-pill">
          {paymentText(order.paymentStatus)}
        </div>
      </section>

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
              <article key={step.key} className={`order-timeline-step ${state}`}>
                <span className="order-timeline-dot">{state === "done" ? "✓" : index + 1}</span>
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

          {order.paymentStatus === "paid" ? (
            <p>Заказ оплачен. Спасибо!</p>
          ) : payment?.payment_url ? (
            <>
              <p>Заказ подтверждён. Можно перейти к оплате.</p>
              <a href={payment.payment_url} className="track-dark-link">Оплатить заказ</a>
            </>
          ) : (
            <p>После подтверждения менеджером здесь появится ссылка на оплату.</p>
          )}
        </article>

        <article className="track-card">
          <h2>Доставка</h2>
          <div className="track-lines">
            <span>Дата: {dateText(order.deliveryDate)}</span>
            <span>Интервал: {order.deliveryInterval || "—"}</span>
            <span>Адрес: {order.deliveryAddress || "—"}</span>
          </div>
        </article>
      </section>

      <section className="track-card">
        <h2>Состав заказа</h2>

        <div className="track-items">
          {items.map((item) => (
            <article key={`${item.productId}-${item.name}`} className="track-item">
              <div>
                <strong>{item.name}</strong>
                <span>{item.quantity} × {money(item.price)}</span>
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

          <span>Доставка</span>
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
    </main>
  );
}
