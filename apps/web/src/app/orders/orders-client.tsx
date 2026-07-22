"use client";

import { useEffect, useState } from "react";
import {
  addRepeatOrderProducts,
  type RepeatOrderCartProduct,
} from "../lib/repeat-order-cart";
import { CustomerPhotoViewer } from "../components/customer-photo-viewer";
import {
  CustomerBouquetApproval,
  type CustomerBouquetApprovalState,
} from "../components/customer-bouquet-approval";

type Customer = {
  name: string | null;
  phone: string;
};

type Order = {
  order_number: string;
  status: string;
  payment_status: string;
  total: number;
  tracking_token: string | null;
  delivery_type: string;
  delivery_date: string | null;
  delivery_interval: string | null;
  delivery_address_text: string | null;
  bouquet_photo_url: string | null;
  bouquetApproval: {
    status: string;
    requestedAt: string | null;
    decidedAt: string | null;
    note: string | null;
    canRespond: boolean;
  };
  created_at: string;
  items_count: number;
  item_names: string[];
};

type OrdersResponse = {
  ok?: boolean;
  customer?: Customer;
  orders?: Order[];
  message?: string;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function dateText(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deliveryDateText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function bouquetApprovalText(status: string) {
  const map: Record<string, string> = {
    pending: "Ожидает согласования",
    approved: "Фото одобрено",
    revision_requested: "Запрошена правка",
    waived: "Согласование не требуется",
    not_required: "Фото пока не добавлено",
  };
  return map[status] || status;
}

function statusText(status: string) {
  const map: Record<string, string> = {
    new: "Заказ принят",
    confirmed: "Подтверждён",
    assembling: "Собирается",
    ready: "Готов",
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
    created: "Платёж создаётся",
    pending: "Ожидает оплаты",
    waiting_for_capture: "Оплата подтверждается",
    paid: "Оплачен",
    failed: "Ошибка оплаты",
    refunded: "Возврат",
    partially_refunded: "Частичный возврат",
    cancelled: "Оплата отменена",
    expired: "Срок оплаты истёк",
  };

  return map[status] || status;
}

function progress(status: string, paymentStatus: string) {
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

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function OrdersClient() {
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [repeatingOrder, setRepeatingOrder] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/account/me", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await readJson(response)) as OrdersResponse;

        if (response.status === 401) {
          setUnauthorized(true);
          return;
        }

        if (!response.ok || data.ok !== true) {
          throw new Error(data.message || "Не удалось загрузить заказы");
        }

        setCustomer(data.customer ?? null);
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      })
      .catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить заказы",
        );
        setMessageKind("error");
      })
      .finally(() => setLoading(false));
  }, []);

  async function repeatOrder(orderNumber: string) {
    setRepeatingOrder(orderNumber);
    setMessage("");

    try {
      const response = await fetch(
        `/api/public/account/orders/${encodeURIComponent(orderNumber)}/repeat`,
        {
          method: "POST",
          credentials: "include",
        },
      );

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        throw new Error(String(data.message || "Не удалось повторить заказ"));
      }

      const products = Array.isArray(data.products)
        ? (data.products as RepeatOrderCartProduct[])
        : [];

      const result = addRepeatOrderProducts(products);

      if (result.addedQuantity <= 0) {
        throw new Error("Товары из этого заказа сейчас недоступны");
      }

      setMessage(
        result.skippedQuantity > 0
          ? `Доступные товары добавлены в корзину. Пропущено недоступных позиций: ${result.skippedQuantity}.`
          : "Все доступные товары добавлены в корзину.",
      );
      setMessageKind("success");
      window.setTimeout(() => window.location.assign("/cart"), 600);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось повторить заказ",
      );
      setMessageKind("error");
    } finally {
      setRepeatingOrder(null);
    }
  }

  if (loading) {
    return (
      <div className="orders-page">
        <section className="orders-hero">
          <p>Загружаем историю заказов…</p>
        </section>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="orders-page">
        <section className="orders-login-card">
          <p className="eyebrow">Мои заказы</p>
          <h1>Войдите в личный кабинет</h1>
          <p>
            История заказов доступна после входа по номеру телефона и коду из
            Telegram.
          </p>
          <div className="orders-login-actions">
            <a href="/account">Войти</a>
            <a href="/catalog" className="secondary">
              Перейти в каталог
            </a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="orders-page">
      <section className="orders-hero">
        <div>
          <p className="eyebrow">Личный раздел</p>
          <h1>Мои заказы</h1>
          <p>
            {customer?.name || "Покупатель"}, здесь собраны ваши заказы и
            актуальные статусы.
          </p>
        </div>
        <a href="/catalog">Новый заказ</a>
      </section>

      {message ? (
        <p className={`orders-message ${messageKind}`}>{message}</p>
      ) : null}

      {orders.length ? (
        <section className="orders-list" aria-label="История заказов">
          {orders.map((order) => (
            <article
              key={order.order_number}
              className={`orders-card status-${order.status}`}
            >
              <div className="orders-card-top">
                <div>
                  <span>Заказ</span>
                  <h2>{order.order_number}</h2>
                  <p>{dateText(order.created_at)}</p>
                </div>
                <strong>{money(order.total)}</strong>
              </div>

              <div className="orders-card-status-row">
                <span>{statusText(order.status)}</span>
                <span>{paymentText(order.payment_status)}</span>
              </div>

              <div
                className="orders-progress"
                aria-label={`Готовность заказа ${progress(order.status, order.payment_status)}%`}
              >
                <span
                  style={{
                    width: `${progress(order.status, order.payment_status)}%`,
                  }}
                />
              </div>

              <div className="orders-card-items">
                <strong>{order.items_count || 0} поз.</strong>
                <p>
                  {order.item_names?.length
                    ? order.item_names.join(", ")
                    : "Состав заказа"}
                </p>
              </div>

              <div className="orders-card-delivery">
                <strong>
                  {order.delivery_type === "pickup" ? "Самовывоз" : "Доставка"}
                </strong>
                <span>Дата: {deliveryDateText(order.delivery_date)}</span>
                {order.delivery_type !== "pickup" ? (
                  <span>Интервал: {order.delivery_interval || "уточняется"}</span>
                ) : null}
                {order.delivery_address_text ? (
                  <span>Адрес: {order.delivery_address_text}</span>
                ) : null}
              </div>

              {order.bouquet_photo_url ? (
                <div className="orders-card-bouquet">
                  <CustomerPhotoViewer
                    src={order.bouquet_photo_url}
                    alt={`Фото готового букета ${order.order_number}`}
                  />
                  <div>
                    <strong>Фото готового букета</strong>
                    <span>{bouquetApprovalText(order.bouquetApproval.status)}</span>
                    {order.tracking_token ? (
                      <CustomerBouquetApproval
                        orderNumber={order.order_number}
                        trackingToken={order.tracking_token}
                        approval={order.bouquetApproval}
                        onChanged={(approval: CustomerBouquetApprovalState) =>
                          setOrders((current) =>
                            current.map((item) =>
                              item.order_number === order.order_number
                                ? { ...item, bouquetApproval: approval }
                                : item,
                            ),
                          )
                        }
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="orders-card-actions">
                {order.tracking_token ? (
                  <a href={`/order/track/${order.tracking_token}`}>
                    Открыть заказ
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={repeatingOrder === order.order_number}
                  onClick={() => void repeatOrder(order.order_number)}
                >
                  {repeatingOrder === order.order_number
                    ? "Добавляем…"
                    : "Повторить заказ"}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="orders-empty">
          <h2>Заказов пока нет</h2>
          <p>Выберите букет, и первый заказ появится здесь.</p>
          <a href="/catalog">Открыть каталог</a>
        </section>
      )}
    </div>
  );
}
