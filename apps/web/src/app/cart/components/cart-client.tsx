"use client";

import { useEffect, useMemo, useState } from "react";

type CartItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
};

type DeliveryData = {
  zones: Array<{ id: string; name: string; price: number }>;
  intervals: Array<{ id: string; name: string }>;
};

type AccountCustomer = {
  id: string;
  phone: string;
  name: string | null;
  bonus_balance: number;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  window.localStorage.setItem("viberimenya_cart", JSON.stringify(items));
  window.dispatchEvent(new Event("viberimenya_cart_changed"));
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function phonesMatch(left: string, right: string) {
  const leftDigits = phoneDigits(left);
  const rightDigits = phoneDigits(right);

  if (!leftDigits || !rightDigits) return false;

  const leftTail = leftDigits.length > 10 ? leftDigits.slice(-10) : leftDigits;
  const rightTail = rightDigits.length > 10 ? rightDigits.slice(-10) : rightDigits;

  return leftTail === rightTail;
}

export function CartClient() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [delivery, setDelivery] = useState<DeliveryData>({ zones: [], intervals: [] });
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">("delivery");
  const [zoneId, setZoneId] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [discountTotal, setDiscountTotal] = useState(0);
  const [account, setAccount] = useState<AccountCustomer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [bonusBalance, setBonusBalance] = useState(0);
  const [bonusToSpend, setBonusToSpend] = useState(0);
  const [bonusMessage, setBonusMessage] = useState("");
  const [success, setSuccess] = useState<{
    orderNumber: string;
    totalAmount: number;
    trackingToken?: string;
    telegramLinkUrl?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems(readCart());

    fetch("/api/public/delivery")
      .then((res) => res.json())
      .then((data) => setDelivery(data))
      .catch(() => undefined);

    fetch("/api/public/account/me", {
      credentials: "include"
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const customer = data?.customer as AccountCustomer | undefined;

        if (!customer) return;

        setAccount(customer);
        setCustomerName(customer.name || "");
        setCustomerPhone(customer.phone || "");
        setBonusBalance(Number(customer.bonus_balance || 0));
      })
      .catch(() => undefined);
  }, []);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const isDelivery = deliveryType === "delivery";
  const deliveryPrice = isDelivery ? Number(delivery.zones.find((zone) => zone.id === zoneId)?.price ?? 0) : 0;
  const amountBeforeBonus = Math.max(0, subtotal + deliveryPrice - discountTotal);
  const total = Math.max(0, amountBeforeBonus - bonusToSpend);

  function resetCartAdjustments() {
    setDiscountTotal(0);
    setPromoMessage("");
    setBonusToSpend(0);
    setBonusMessage("");
  }

  function updateQty(productId: string, quantity: number) {
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    const next = items
      .map((item) => (item.productId === productId ? { ...item, quantity: safeQuantity } : item))
      .filter((item) => item.quantity > 0);

    resetCartAdjustments();
    setItems(next);
    writeCart(next);
  }

  function removeItem(productId: string) {
    const next = items.filter((item) => item.productId !== productId);

    resetCartAdjustments();
    setItems(next);
    writeCart(next);
  }


  async function checkPromo() {
    const code = promoCode.trim();

    if (!code) {
      setDiscountTotal(0);
      setPromoMessage("Введите промокод");
      return;
    }

    if (subtotal <= 0) {
      setDiscountTotal(0);
      setPromoMessage("Сначала добавьте товары в корзину");
      return;
    }

    try {
      const response = await fetch("/api/public/promocodes/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setDiscountTotal(0);
        setPromoMessage(data?.message || "Промокод не применён");
        return;
      }

      setDiscountTotal(Number(data.promo.discountTotal || 0));
      setPromoCode(data.promo.code);
      setPromoMessage(`Промокод применён: −${money(Number(data.promo.discountTotal || 0))}`);
    } catch {
      setDiscountTotal(0);
      setPromoMessage("Не удалось проверить промокод");
    }
  }


  async function checkBonus() {
    if (!account) {
      setBonusMessage("Войдите в личный кабинет, чтобы использовать бонусы");
      return;
    }

    if (!phonesMatch(customerPhone, account.phone)) {
      setBonusToSpend(0);
      setBonusMessage("Для списания бонусов укажите телефон из личного кабинета");
      return;
    }

    if (amountBeforeBonus <= 0) {
      setBonusMessage("Сначала добавьте товары в корзину");
      return;
    }

    try {
      const response = await fetch("/api/public/bonus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount: amountBeforeBonus })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setBonusToSpend(0);
        setBonusMessage(data?.message || "Не удалось проверить бонусы");
        return;
      }

      const balance = Number(data.bonus.balance || 0);
      const maxSpend = Number(data.bonus.maxSpend || 0);

      setBonusBalance(balance);
      setBonusToSpend(maxSpend);

      if (maxSpend > 0) {
        setBonusMessage(`Будет списано ${money(maxSpend)}`);
      } else {
        setBonusMessage("Доступных бонусов для списания пока нет");
      }
    } catch {
      setBonusToSpend(0);
      setBonusMessage("Не удалось проверить бонусы");
    }
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (items.length === 0) return;

    const form = new FormData(event.currentTarget);
    setLoading(true);

    try {
      const response = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.get("customerName"),
          customerPhone: form.get("customerPhone"),
          recipientName: form.get("recipientName"),
          recipientPhone: form.get("recipientPhone"),
          deliveryType,
          deliveryAddress: isDelivery ? form.get("deliveryAddress") : "",
          deliveryDate: isDelivery ? form.get("deliveryDate") : "",
          deliveryIntervalText: isDelivery ? form.get("deliveryIntervalText") : "",
          deliveryZoneId: isDelivery ? zoneId : "",
          paymentMethod: form.get("paymentMethod"),
          customerComment: form.get("customerComment"),
          promoCode,
          bonusToSpend,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Не удалось оформить заказ");
      }

      writeCart([]);
      setItems([]);
      setSuccess(data.order);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось оформить заказ");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <section className="cart-success cart-success-polished">
        <div className="cart-success-icon">✓</div>
        <span>Заказ оформлен</span>
        <h1>{success.orderNumber}</h1>
        <p>
          Мы получили заказ. Менеджер проверит детали, подтвердит состав и свяжется с вами.
        </p>

        <div className="cart-success-summary">
          <div>
            <small>Сумма заказа</small>
            <strong>{money(success.totalAmount)}</strong>
          </div>
          <div>
            <small>Статус</small>
            <strong>Принят</strong>
          </div>
        </div>

        <div className="cart-success-actions cart-success-main-actions">
          {success.trackingToken ? (
            <a href={`/order/track/${success.trackingToken}`} className="dark-button">
              Отследить заказ
            </a>
          ) : (
            <a href="/account" className="dark-button">Личный кабинет</a>
          )}
          <a href="/catalog" className="light-button">Вернуться в каталог</a>
        </div>

        {success.telegramLinkUrl ? (
          <div className="cart-success-telegram">
            <strong>Telegram-уведомления</strong>
            <p>Подключите Telegram, чтобы получать сообщения по заказу и быстро открыть личный кабинет.</p>
            <a href={success.telegramLinkUrl} className="light-button" target="_blank" rel="noreferrer">
              Подключить Telegram
            </a>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="cart-layout">
      <div className="cart-items">
        <div className="cart-head">
          <span>Корзина</span>
          <h1>Ваш заказ</h1>
        </div>

        {items.length === 0 ? (
          <div className="catalog-empty">
            <h3>Корзина пуста</h3>
            <p>Выберите букет или подарок в каталоге.</p>
            <a href="/catalog">Перейти в каталог</a>
          </div>
        ) : (
          items.map((item) => (
            <article className="cart-item" key={item.productId}>
              <a href={`/product/${item.slug}`} className="cart-item-image">ВМ</a>

              <div>
                <h3>{item.name}</h3>
                <p>{money(item.price)}</p>
              </div>

              <div className="cart-item-controls">
                <div className="quantity-control" aria-label={`Количество: ${item.name}`}>
                  <button type="button" onClick={() => updateQty(item.productId, item.quantity - 1)}>−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateQty(item.productId, item.quantity + 1)}>+</button>
                </div>

                <button type="button" className="cart-remove-button" onClick={() => removeItem(item.productId)}>
                  Удалить
                </button>
              </div>

              <strong>{money(item.price * item.quantity)}</strong>
            </article>
          ))
        )}
      </div>

      <form className="checkout-form" onSubmit={submitOrder}>
        <div className="checkout-total">
          <span>Итого</span>
          <strong>{money(total)}</strong>
        </div>


        {isDelivery ? (
          <div className="checkout-delivery">
            <span>Доставка</span>
            <strong>{deliveryPrice > 0 ? money(deliveryPrice) : "Выберите зону"}</strong>
          </div>
        ) : (
          <div className="checkout-delivery">
            <span>Самовывоз</span>
            <strong>0 ₽</strong>
          </div>
        )}

        {discountTotal > 0 ? (
          <div className="checkout-discount">
            <span>Скидка</span>
            <strong>−{money(discountTotal)}</strong>
          </div>
        ) : null}

        {bonusToSpend > 0 ? (
          <div className="checkout-discount bonus-discount">
            <span>Бонусы</span>
            <strong>−{money(bonusToSpend)}</strong>
          </div>
        ) : null}

        <div className="promo-box">
          <label>
            <span>Промокод</span>
            <input
              value={promoCode}
              onChange={(event) => {
                setPromoCode(event.target.value);
                setDiscountTotal(0);
                setPromoMessage("");
              }}
              placeholder="Введите промокод"
            />
          </label>

          <button type="button" onClick={checkPromo} disabled={items.length === 0}>
            Применить
          </button>

          {promoMessage ? <p>{promoMessage}</p> : null}
        </div>

        {account ? (
          <div className="promo-box bonus-box">
            <div>
              <strong>Бонусы</strong>
              <p>Доступно: {money(bonusBalance)}</p>
              {bonusMessage ? <p>{bonusMessage}</p> : null}
            </div>

            <button type="button" onClick={checkBonus} disabled={items.length === 0 || amountBeforeBonus <= 0}>
              Использовать
            </button>
          </div>
        ) : null}

        <label>
          <span>Ваше имя</span>
          <input
            name="customerName"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            required
          />
        </label>

        <label>
          <span>Ваш телефон</span>
          <input
            name="customerPhone"
            value={customerPhone}
            onChange={(event) => {
              setCustomerPhone(event.target.value);
              setBonusToSpend(0);
              setBonusMessage("");
            }}
            required
          />
        </label>
        <label><span>Имя получателя</span><input name="recipientName" /></label>
        <label><span>Телефон получателя</span><input name="recipientPhone" /></label>

        <label>
          <span>Способ получения</span>
          <select
            name="deliveryType"
            value={deliveryType}
            onChange={(event) => {
              const nextDeliveryType = event.target.value === "pickup" ? "pickup" : "delivery";

              setDeliveryType(nextDeliveryType);
              if (nextDeliveryType === "pickup") {
                setZoneId("");
              }
              resetCartAdjustments();
            }}
          >
            <option value="delivery">Доставка</option>
            <option value="pickup">Самовывоз</option>
          </select>
        </label>

        {isDelivery ? (
          <>
            <label>
              <span>Зона доставки</span>
              <select
                name="deliveryZoneId"
                value={zoneId}
                onChange={(event) => {
                  setZoneId(event.target.value);
                  resetCartAdjustments();
                }}
              >
                <option value="">Выберите зону</option>
                {delivery.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>{zone.name} — {money(zone.price)}</option>
                ))}
              </select>
            </label>

            <label><span>Дата доставки</span><input name="deliveryDate" type="date" /></label>

            <label>
              <span>Интервал</span>
              <select name="deliveryIntervalText">
                <option value="">Выберите интервал</option>
                {delivery.intervals.map((interval) => (
                  <option key={interval.id} value={interval.name}>{interval.name}</option>
                ))}
              </select>
            </label>

            <label className="wide"><span>Адрес доставки</span><input name="deliveryAddress" /></label>
          </>
        ) : (
          <div className="pickup-note">
            <strong>Самовывоз</strong>
            <p>После оформления менеджер подтвердит адрес и время получения заказа.</p>
          </div>
        )}

        <label>
          <span>Оплата</span>
          <select name="paymentMethod" defaultValue="transfer_after_confirm">
            <option value="transfer_after_confirm">Перевод после подтверждения</option>
            <option value="cash_on_delivery">При получении</option>
          </select>
        </label>

        <label className="wide"><span>Комментарий</span><textarea name="customerComment" /></label>

        <button type="submit" disabled={loading || items.length === 0}>
          {loading ? "Оформляем..." : "Оформить заказ"}
        </button>
      </form>
    </section>
  );
}
