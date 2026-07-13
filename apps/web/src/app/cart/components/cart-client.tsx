"use client";

import { useEffect, useMemo, useState } from "react";

type CartItem = {
  cartLineId: string;
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
  imageAlt: string;
  isAvailable: boolean;
};

type StoredCartItem = Record<string, unknown>;

type DeliveryData = {
  zones: Array<{
    id: string;
    name: string;
    price: number;
    freeFromAmount: number | null;
    isExpressAvailable: boolean;
    expressPrice: number | null;
  }>;

  intervals: Array<{
    id: string;
    name: string;
  }>;
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

function createCartLineId(productId: string) {
  return `${productId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function normalizeCartItem(value: unknown): CartItem | null {
  if (!value || typeof value !== "object") return null;

  const item = value as StoredCartItem;
  const productId = String(item.productId ?? item.id ?? "").trim();
  const name = String(item.name ?? "").trim();
  const slug = String(item.slug ?? "").trim();
  const price = Number(item.price ?? 0);
  const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);

  const imageUrl = String(
    item.imageUrl
    ?? item.image_url
    ?? ""
  ).trim();

  const imageAlt = String(
    item.imageAlt
    ?? item.image_alt
    ?? name
  ).trim();

  if (!productId || !name || !slug || !Number.isFinite(price) || price < 0) {
    return null;
  }

  return {
    cartLineId: String(item.cartLineId ?? "").trim() || createCartLineId(productId),
    productId,
    slug,
    name,
    price,
    quantity,
    imageUrl,
    imageAlt: imageAlt || name,
    isAvailable:
      item.isAvailable !== false
  };
}

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) return [];

    const items = parsed
      .map((item) => normalizeCartItem(item))
      .filter((item): item is CartItem => Boolean(item));

    if (JSON.stringify(parsed) !== JSON.stringify(items)) {
      writeCart(items);
    }

    return items;
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  window.localStorage.setItem("viberimenya_cart", JSON.stringify(items));
  window.dispatchEvent(new Event("viberimenya_cart_changed"));
}

type CartSyncProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;

  primaryImage?: {
    url?: string;
    alt?: string | null;
  } | null;
};

type CartSyncResponse = {
  items?: CartSyncProduct[];
};

async function refreshCartProducts(
  items: CartItem[]
): Promise<CartItem[]> {
  if (!items.length) {
    return [];
  }

  try {
    const response = await fetch(
      "/api/public/cart-products",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          productIds:
            items.map(
              (item) =>
                item.productId
            ),

          slugs:
            items.map(
              (item) =>
                item.slug
            )
        })
      }
    );

    if (!response.ok) {
      return items;
    }

    const data = (
      await response.json()
    ) as CartSyncResponse;

    const products =
      Array.isArray(data.items)
        ? data.items
        : [];

    const productsById =
      new Map(
        products.map(
          (product) => [
            String(product.id),
            product
          ]
        )
      );

    const productsBySlug =
      new Map(
        products.map(
          (product) => [
            String(product.slug),
            product
          ]
        )
      );

    return items.map((item) => {
      const product = (
        productsById.get(
          item.productId
        )
        ?? productsBySlug.get(
          item.slug
        )
      );

      if (!product) {
        return {
          ...item,
          isAvailable: false
        };
      }

      const price =
        Number(product.price);

      const imageUrl =
        String(
          product.primaryImage?.url
          ?? item.imageUrl
          ?? ""
        ).trim();

      const imageAlt =
        String(
          product.primaryImage?.alt
          ?? product.name
          ?? item.imageAlt
          ?? item.name
        ).trim();

      return {
        ...item,

        productId:
          String(product.id),

        slug:
          String(
            product.slug
            ?? item.slug
          ),

        name:
          String(
            product.name
            ?? item.name
          ),

        price:
          Number.isFinite(price)
          && price >= 0
            ? price
            : item.price,

        imageUrl,

        imageAlt:
          imageAlt
          || product.name
          || item.name,

        isAvailable: true
      };
    });
  } catch {
    return items;
  }
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
  const [intervalId, setIntervalId] = useState("");

  const [
    deliveryService,
    setDeliveryService
  ] = useState<
    "standard" | "express"
  >("standard");

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
    telegramLinkCode?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const storedItems =
      readCart();

    setItems(storedItems);

    void refreshCartProducts(
      storedItems
    ).then((freshItems) => {
      setItems(freshItems);

      if (
        JSON.stringify(freshItems)
        !== JSON.stringify(storedItems)
      ) {
        writeCart(freshItems);
      }
    });

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

  const isDelivery =
    deliveryType === "delivery";

  const selectedZone =
    delivery.zones.find(
      (zone) =>
        zone.id === zoneId
    ) ?? null;

  const deliveryIsExpress = (
    isDelivery
    && deliveryService === "express"
    && selectedZone?.isExpressAvailable
      === true
    && Number(
      selectedZone.expressPrice ?? 0
    ) > 0
  );

  const freeFromAmount =
    Math.max(
      0,
      Number(
        selectedZone?.freeFromAmount
        ?? 0
      )
    );

  const standardDeliveryQualifiesForFree = (
    isDelivery
    && Boolean(selectedZone)
    && freeFromAmount > 0
    && subtotal >= freeFromAmount
  );

  const standardDeliveryIsFree = (
    !deliveryIsExpress
    && standardDeliveryQualifiesForFree
  );

  const deliveryPrice =
    !isDelivery || !selectedZone
      ? 0
      : deliveryIsExpress
        ? Math.max(
            0,
            Number(
              selectedZone.expressPrice
              ?? 0
            )
          )
        : standardDeliveryIsFree
          ? 0
          : Math.max(
              0,
              Number(
                selectedZone.price
                ?? 0
              )
            );

  const deliveryTariffLabel =
    !isDelivery
      ? "Самовывоз"
      : deliveryIsExpress
        ? "Срочная доставка"
        : standardDeliveryIsFree
          ? "Бесплатная доставка"
          : "Обычная доставка";

  const remainingForFreeDelivery = (
    isDelivery
    && selectedZone
    && !deliveryIsExpress
    && freeFromAmount > 0
  )
    ? Math.max(
        0,
        freeFromAmount - subtotal
      )
    : 0;

  const amountBeforeBonus =
    Math.max(
      0,
      subtotal
      + deliveryPrice
      - discountTotal
    );

  const total =
    Math.max(
      0,
      amountBeforeBonus
      - bonusToSpend
    );

  function resetCartAdjustments() {
    setDiscountTotal(0);
    setPromoMessage("");
    setBonusToSpend(0);
    setBonusMessage("");
  }

  function updateQty(cartLineId: string, quantity: number) {
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    const next = items
      .map((item) => (item.cartLineId === cartLineId ? { ...item, quantity: safeQuantity } : item))
      .filter((item) => item.quantity > 0);

    resetCartAdjustments();
    setItems(next);
    writeCart(next);
  }

  function removeItem(cartLineId: string) {
    const next = items.filter((item) => item.cartLineId !== cartLineId);

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
        credentials: "include",
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
        credentials: "include",
        body: JSON.stringify({
          customerName: form.get("customerName"),
          customerPhone: form.get("customerPhone"),
          recipientName: form.get("recipientName"),
          recipientPhone: form.get("recipientPhone"),
          deliveryType,

          deliveryService:
            isDelivery
              ? deliveryService
              : "standard",

          deliveryAddress:
            isDelivery
              ? form.get(
                  "deliveryAddress"
                )
              : "",
          deliveryDate:
            isDelivery
              ? form.get("deliveryDate")
              : "",

          deliveryIntervalId:
            isDelivery
              ? intervalId
              : "",

          deliveryIntervalText: "",

          deliveryZoneId:
            isDelivery
              ? zoneId
              : "",
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

        {success.telegramLinkCode ? (
          <div className="cart-success-telegram">
            <strong>Telegram-уведомления</strong>
            <p>Откройте бота в Telegram, нажмите «🔗 Привязать аккаунт» и введите код:</p>
            <div className="cart-success-telegram-code">{success.telegramLinkCode}</div>
            <p>Код действует 30 минут.</p>
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
            <article className="cart-item" key={item.cartLineId}>
              <a
                href={`/product/${item.slug}`}
                className={[
                  "cart-item-image",
                  item.imageUrl
                    ? "has-image"
                    : "is-placeholder"
                ].join(" ")}
                aria-label={`Открыть ${item.name}`}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={
                      item.imageAlt
                      || item.name
                    }
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget
                        .parentElement
                        ?.classList.add(
                          "image-failed"
                        );
                    }}
                  />
                ) : null}

                <span className="cart-item-image-fallback">
                  ВМ
                </span>
              </a>

              <div>
                <h3>
                  <a
                    href={`/product/${item.slug}`}
                  >
                    {item.name}
                  </a>
                </h3>

                <p>{money(item.price)}</p>

                {item.isAvailable === false ? (
                  <span className="cart-item-unavailable">
                    Товар больше недоступен
                  </span>
                ) : null}
              </div>

              <div className="cart-item-controls">
                <div className="quantity-control" aria-label={`Количество: ${item.name}`}>
                  <button type="button" onClick={() => updateQty(item.cartLineId, item.quantity - 1)}>−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateQty(item.cartLineId, item.quantity + 1)}>+</button>
                </div>

                <button type="button" className="cart-remove-button" onClick={() => removeItem(item.cartLineId)}>
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
          <div
            className={[
              "checkout-delivery",
              deliveryIsExpress
                ? "express"
                : "",
              standardDeliveryIsFree
                ? "free"
                : ""
            ].filter(Boolean).join(" ")}
          >
            <div>
              <span>
                {deliveryTariffLabel}
              </span>

              {selectedZone ? (
                <small>
                  {selectedZone.name}
                </small>
              ) : null}
            </div>

            <strong>
              {!selectedZone
                ? "Выберите зону"
                : deliveryPrice > 0
                  ? money(deliveryPrice)
                  : "Бесплатно"}
            </strong>
          </div>
        ) : (
          <div className="checkout-delivery free">
            <div>
              <span>Самовывоз</span>

              <small>
                Получение в магазине
              </small>
            </div>

            <strong>Бесплатно</strong>
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
                setIntervalId("");
                setDeliveryService(
                  "standard"
                );
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
                  setZoneId(
                    event.target.value
                  );

                  setDeliveryService(
                    "standard"
                  );

                  resetCartAdjustments();
                }}
                required
              >
                <option value="">
                  Выберите зону
                </option>

                {delivery.zones.map(
                  (zone) => (
                    <option
                      key={zone.id}
                      value={zone.id}
                    >
                      {zone.name}
                    </option>
                  )
                )}
              </select>
            </label>

            {selectedZone ? (
              <fieldset className="checkout-delivery-service">
                <legend>
                  Тариф доставки
                </legend>

                <label
                  className={[
                    "checkout-delivery-service-option",
                    deliveryService
                      === "standard"
                      ? "active"
                      : ""
                  ].filter(Boolean).join(" ")}
                >
                  <input
                    type="radio"
                    name="deliveryService"
                    value="standard"
                    checked={
                      deliveryService
                        === "standard"
                    }
                    onChange={() => {
                      setDeliveryService(
                        "standard"
                      );

                      resetCartAdjustments();
                    }}
                  />

                  <span>
                    <strong>
                      Обычная доставка
                    </strong>

                    <small>
                      {standardDeliveryQualifiesForFree
                        ? "Бесплатно"
                        : money(
                            selectedZone.price
                          )}
                    </small>
                  </span>
                </label>

                {selectedZone
                  .isExpressAvailable
                  && Number(
                    selectedZone
                      .expressPrice
                    ?? 0
                  ) > 0 ? (
                  <label
                    className={[
                      "checkout-delivery-service-option",
                      deliveryService
                        === "express"
                        ? "active express"
                        : ""
                    ].filter(Boolean).join(" ")}
                  >
                    <input
                      type="radio"
                      name="deliveryService"
                      value="express"
                      checked={
                        deliveryService
                          === "express"
                      }
                      onChange={() => {
                        setDeliveryService(
                          "express"
                        );

                        resetCartAdjustments();
                      }}
                    />

                    <span>
                      <strong>
                        Срочная доставка
                      </strong>

                      <small>
                        {money(
                          Number(
                            selectedZone
                              .expressPrice
                            ?? 0
                          )
                        )}
                      </small>
                    </span>
                  </label>
                ) : null}

                {deliveryIsExpress ? (
                  <p className="checkout-delivery-service-note express">
                    Срочный тариф оплачивается
                    отдельно и не становится
                    бесплатным от суммы заказа.
                  </p>
                ) : freeFromAmount > 0 ? (
                  <p
                    className={[
                      "checkout-delivery-service-note",
                      standardDeliveryIsFree
                        ? "success"
                        : ""
                    ].filter(Boolean).join(" ")}
                  >
                    {remainingForFreeDelivery > 0
                      ? `До бесплатной доставки осталось ${money(
                          remainingForFreeDelivery
                        )}`
                      : "Бесплатная доставка активирована"}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <label>
              <span>Дата доставки</span>

              <input
                name="deliveryDate"
                type="date"
              />
            </label>

            <label>
              <span>Интервал</span>

              <select
                name="deliveryIntervalId"
                value={intervalId}
                onChange={(event) => {
                  setIntervalId(
                    event.target.value
                  );
                }}
                required
              >
                <option value="">
                  Выберите интервал
                </option>

                {delivery.intervals.map(
                  (interval) => (
                    <option
                      key={interval.id}
                      value={interval.id}
                    >
                      {interval.name}
                    </option>
                  )
                )}
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
