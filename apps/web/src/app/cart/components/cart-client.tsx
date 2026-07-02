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

export function CartClient() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [delivery, setDelivery] = useState<DeliveryData>({ zones: [], intervals: [] });
  const [zoneId, setZoneId] = useState("");
  const [success, setSuccess] = useState<{ orderNumber: string; totalAmount: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems(readCart());
    fetch("/api/public/delivery")
      .then((res) => res.json())
      .then((data) => setDelivery(data))
      .catch(() => undefined);
  }, []);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const deliveryPrice = Number(delivery.zones.find((zone) => zone.id === zoneId)?.price ?? 0);
  const total = subtotal + deliveryPrice;

  function updateQty(productId: string, quantity: number) {
    const next = items
      .map((item) => (item.productId === productId ? { ...item, quantity } : item))
      .filter((item) => item.quantity > 0);

    setItems(next);
    writeCart(next);
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
          deliveryType: form.get("deliveryType"),
          deliveryAddress: form.get("deliveryAddress"),
          deliveryDate: form.get("deliveryDate"),
          deliveryIntervalText: form.get("deliveryIntervalText"),
          deliveryZoneId: form.get("deliveryZoneId"),
          paymentMethod: form.get("paymentMethod"),
          customerComment: form.get("customerComment"),
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
      <section className="cart-success">
        <span>Заказ оформлен</span>
        <h1>{success.orderNumber}</h1>
        <p>Мы получили заказ. Менеджер проверит детали и свяжется с вами.</p>
        <strong>{money(success.totalAmount)}</strong>
        <div className="cart-success-actions">
          <a href="/catalog" className="light-button">Вернуться в каталог</a>
          <a href="/orders" className="dark-button">Мои заказы</a>
        </div>
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

              <div className="quantity-control">
                <button type="button" onClick={() => updateQty(item.productId, item.quantity - 1)}>−</button>
                <span>{item.quantity}</span>
                <button type="button" onClick={() => updateQty(item.productId, item.quantity + 1)}>+</button>
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

        <label><span>Ваше имя</span><input name="customerName" required /></label>
        <label><span>Ваш телефон</span><input name="customerPhone" required /></label>
        <label><span>Имя получателя</span><input name="recipientName" /></label>
        <label><span>Телефон получателя</span><input name="recipientPhone" /></label>

        <label>
          <span>Способ получения</span>
          <select name="deliveryType" defaultValue="delivery">
            <option value="delivery">Доставка</option>
            <option value="pickup">Самовывоз</option>
          </select>
        </label>

        <label>
          <span>Зона доставки</span>
          <select name="deliveryZoneId" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
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
