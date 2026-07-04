"use client";

import { useEffect, useState } from "react";

type Customer = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  bonus_balance: number;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
};

type Order = {
  order_number: string;
  status: string;
  payment_status: string;
  total: number;
  bonus_spent: number;
  bonus_earned: number;
  tracking_token: string | null;
  created_at: string;
};

type Bonus = {
  type: string;
  amount: number;
  balance_after: number;
  comment: string | null;
  created_at: string;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0)) + " ₽";
}

function dateText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU");
}

function statusText(status: string) {
  const map: Record<string, string> = {
    new: "Новый",
    confirmed: "Подтверждён",
    assembling: "Собирается",
    ready: "Готов",
    assigned_courier: "Передан курьеру",
    delivering: "В доставке",
    delivered: "Доставлен",
    cancelled: "Отменён",
    problem: "Требует внимания"
  };

  return map[status] || status;
}

function paymentText(status: string) {
  const map: Record<string, string> = {
    not_required: "Не требуется",
    pending: "Ожидает оплаты",
    paid: "Оплачен",
    failed: "Ошибка оплаты",
    refunded: "Возврат",
    cancelled: "Отменён"
  };

  return map[status] || status;
}

function orderProgressPercent(status: string, paymentStatus: string) {
  if (status === "cancelled") return 100;
  if (status === "problem") return 30;
  if (status === "delivered") return 100;
  if (status === "delivering") return 88;
  if (status === "assigned_courier") return 78;
  if (status === "ready") return 68;
  if (status === "assembling") return 56;
  if (paymentStatus === "paid") return 46;
  if (status === "confirmed") return 36;
  return 18;
}

function orderProgressLabel(status: string, paymentStatus: string) {
  if (status === "cancelled") return "Заказ отменён";
  if (status === "problem") return "Нужно уточнение";
  if (status === "delivered") return "Доставлен";
  if (status === "delivering" || status === "assigned_courier") return "В доставке";
  if (status === "ready") return "Готов к доставке";
  if (status === "assembling") return "Собирается";
  if (paymentStatus === "paid") return "Оплачен";
  if (status === "confirmed") return "Подтверждён";
  return "Принят";
}

export function AccountClient() {
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);

  async function loadAccount() {
    try {
      const response = await fetch("/api/public/account/me", {
        credentials: "include",
        cache: "no-store"
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        setCustomer(data.customer);
        setOrders(data.orders || []);
        setBonuses(data.bonuses || []);
      } else {
        setCustomer(null);
      }
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
  }, []);

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      setMessage("Введите телефон");
      return;
    }

    const response = await fetch("/api/public/account/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ phone: cleanPhone })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      setMessage(data?.message || "Не удалось создать код");
      return;
    }

    setStep("code");
    setMessage(
      data?.message
        ? `${data.message}. Откройте Telegram, посмотрите код и введите его здесь.`
        : "Код отправлен в Telegram. Откройте Telegram, посмотрите код и введите его здесь."
    );
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const response = await fetch("/api/public/account/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ phone: phone.trim(), code: code.trim() })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      setMessage(data?.message || "Не удалось войти");
      return;
    }

    setCustomer(data.customer);
    setMessage("");
    await loadAccount();
  }

  async function logout() {
    await fetch("/api/public/account/logout", {
      method: "POST",
      credentials: "include"
    });

    setCustomer(null);
    setOrders([]);
    setBonuses([]);
    setCode("");
    setMessage("");
    setStep("phone");
  }

  if (loading) {
    return (
      <main className="account-page">
        <section className="account-card">
          <p>Загружаем профиль…</p>
        </section>
      </main>
    );
  }

  if (!customer) {
    return (
      <main className="account-page">
        <section className="account-card account-login">
          <div className="account-heading">
            <p className="eyebrow">Личный кабинет</p>
            <h1>Вход по телефону</h1>
            <p>Введите номер телефона, который указывали при оформлении заказа.</p>
          </div>

          {step === "phone" ? (
            <form onSubmit={requestCode} className="account-form">
              <label>
                <span>Телефон</span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+7..."
                  autoComplete="tel"
                />
              </label>

              <button type="submit">Получить код</button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="account-form">
              <label>
                <span>Код подтверждения</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                />
              </label>

              <button type="submit">Войти</button>
              <button
                type="button"
                className="ghost-button"
                onClick={async () => {
                  setMessage("");

                  const response = await fetch("/api/public/account/request-code", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ phone: phone.trim() })
                  });

                  const data = await response.json();

                  if (!response.ok || !data.ok) {
                    setMessage(data?.message || "Не удалось отправить код повторно");
                    return;
                  }

                  setCode("");
                  setMessage(
                    data?.message
                      ? `${data.message}. Откройте Telegram, посмотрите код и введите его здесь.`
                      : "Код отправлен повторно в Telegram. Откройте Telegram, посмотрите код и введите его здесь."
                  );
                }}
              >
                Отправить код ещё раз
              </button>
              <button type="button" className="ghost-button" onClick={() => setStep("phone")}>
                Изменить телефон
              </button>
            </form>
          )}

          {message ? <p className="account-message">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="account-page">
      <section className="account-hero">
        <div>
          <p className="eyebrow">Личный кабинет</p>
          <h1>{customer.name || "Покупатель"}</h1>
          <p>{customer.phone}</p>
        </div>

        <button type="button" onClick={logout}>Выйти</button>
      </section>

      <section className="account-grid">
        <article className="account-stat">
          <span>Бонусы</span>
          <strong>{money(customer.bonus_balance)}</strong>
        </article>

        <article className="account-stat">
          <span>Заказы</span>
          <strong>{customer.total_orders}</strong>
        </article>

        <article className="account-stat">
          <span>Покупки</span>
          <strong>{money(customer.total_spent)}</strong>
        </article>
      </section>

      <section className="account-card">
        <h2>Мои заказы</h2>

        {orders.length ? (
          <div className="account-list">
            {orders.map((order) => (
              <article key={order.order_number} className="account-list-item account-order-item">
                <div>
                  {order.tracking_token ? (
                    <a href={`/order/track/${order.tracking_token}`} className="account-order-link">
                      {order.order_number}
                    </a>
                  ) : (
                    <strong>{order.order_number}</strong>
                  )}
                  <span>{dateText(order.created_at)}</span>
                  <div className="account-order-progress">
                    <span style={{ width: `${orderProgressPercent(order.status, order.payment_status)}%` }} />
                  </div>
                </div>

                <div>
                  <span>{orderProgressLabel(order.status, order.payment_status)}</span>
                  <span>{paymentText(order.payment_status)}</span>
                </div>

                <strong>{money(order.total)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p>Заказов пока нет.</p>
        )}
      </section>

      <section className="account-card">
        <h2>История бонусов</h2>

        {bonuses.length ? (
          <div className="account-list">
            {bonuses.map((bonus, index) => (
              <article key={`${bonus.created_at}-${index}`} className="account-list-item">
                <div>
                  <strong>{bonus.amount > 0 ? "+" : ""}{bonus.amount}</strong>
                  <span>{dateText(bonus.created_at)}</span>
                </div>

                <p>{bonus.comment || "Операция по бонусам"}</p>

                <strong>Баланс: {bonus.balance_after}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p>Истории бонусов пока нет.</p>
        )}
      </section>
    </main>
  );
}
