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

  pickup: {
    enabled: boolean;
    address: string;
    note: string;
  };

  minimumOrderAmount: number;
  orderLeadTimeMinutes: number;
  expressLeadTimeMinutes: number;
  notice: string;

  paymentMethods: {
    online: boolean;
    cash: boolean;
    transfer: boolean;
  };
};

type AccountCustomer = {
  id: string;
  phone: string;
  name: string | null;
  email?: string | null;
  bonus_balance: number;
};

type SavedAddress = {
  id: string;
  city: string | null;
  street: string | null;
  house: string | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  comment: string | null;
  is_default: boolean;
};

function formatSavedAddress(address: SavedAddress) {
  return [
    address.city,
    address.street,
    address.house ? `д. ${address.house}` : "",
    address.apartment ? `кв. ${address.apartment}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function savedAddressComment(address: SavedAddress) {
  return [
    address.entrance ? `Подъезд ${address.entrance}` : "",
    address.floor ? `этаж ${address.floor}` : "",
    address.comment ?? "",
  ]
    .filter(Boolean)
    .join(", ");
}

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
  const quantity = Math.min(99, Math.max(1, Number(item.quantity ?? 1) || 1));

  const imageUrl = String(item.imageUrl ?? item.image_url ?? "").trim();

  const imageAlt = String(item.imageAlt ?? item.image_alt ?? name).trim();

  if (!productId || !name || !slug || !Number.isFinite(price) || price < 0) {
    return null;
  }

  return {
    cartLineId:
      String(item.cartLineId ?? "").trim() || createCartLineId(productId),
    productId,
    slug,
    name,
    price,
    quantity,
    imageUrl,
    imageAlt: imageAlt || name,
    isAvailable: item.isAvailable !== false,
  };
}

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem("viberimenya_cart");
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) return [];

    const normalizedItems = parsed
      .map((item) => normalizeCartItem(item))
      .filter((item): item is CartItem => Boolean(item));

    const itemsByProductId = new Map<string, CartItem>();

    for (const item of normalizedItems) {
      const existing = itemsByProductId.get(item.productId);

      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + item.quantity);
        existing.slug = item.slug;
        existing.name = item.name;
        existing.price = item.price;
        existing.imageUrl = item.imageUrl;
        existing.imageAlt = item.imageAlt;
        existing.isAvailable = existing.isAvailable && item.isAvailable;
      } else {
        itemsByProductId.set(item.productId, { ...item });
      }
    }

    const items = Array.from(itemsByProductId.values());

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
  availability: "available" | "unavailable";

  primaryImage?: {
    url?: string;
    alt?: string | null;
  } | null;
};

type CartSyncResponse = {
  items?: CartSyncProduct[];
};

async function refreshCartProducts(items: CartItem[]): Promise<CartItem[]> {
  if (!items.length) {
    return [];
  }

  try {
    const response = await fetch("/api/public/cart-products", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        productIds: items.map((item) => item.productId),

        slugs: items.map((item) => item.slug),
      }),
    });

    if (!response.ok) {
      return items;
    }

    const data = (await response.json()) as CartSyncResponse;

    const products = Array.isArray(data.items) ? data.items : [];

    const productsById = new Map(
      products.map((product) => [String(product.id), product]),
    );

    const productsBySlug = new Map(
      products.map((product) => [String(product.slug), product]),
    );

    return items.map((item) => {
      const product =
        productsById.get(item.productId) ?? productsBySlug.get(item.slug);

      if (!product) {
        return {
          ...item,
          isAvailable: false,
        };
      }

      const price = Number(product.price);

      const imageUrl = String(
        product.primaryImage?.url ?? item.imageUrl ?? "",
      ).trim();

      const imageAlt = String(
        product.primaryImage?.alt ?? product.name ?? item.imageAlt ?? item.name,
      ).trim();

      return {
        ...item,

        productId: String(product.id),

        slug: String(product.slug ?? item.slug),

        name: String(product.name ?? item.name),

        price: Number.isFinite(price) && price >= 0 ? price : item.price,

        imageUrl,

        imageAlt: imageAlt || product.name || item.name,

        isAvailable: product.availability === "available",
      };
    });
  } catch {
    return items;
  }
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function createClientRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function moscowDateInputValue(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToDateInput(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function validPhone(value: string) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

function phonesMatch(left: string, right: string) {
  const leftDigits = phoneDigits(left);
  const rightDigits = phoneDigits(right);

  if (!leftDigits || !rightDigits) return false;

  const leftTail = leftDigits.length > 10 ? leftDigits.slice(-10) : leftDigits;
  const rightTail =
    rightDigits.length > 10 ? rightDigits.slice(-10) : rightDigits;

  return leftTail === rightTail;
}

export function CartClient() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [delivery, setDelivery] = useState<DeliveryData>({
    zones: [],
    intervals: [],
    pickup: {
      enabled: true,
      address: "",
      note:
        "После оформления менеджер подтвердит время готовности заказа.",
    },
    minimumOrderAmount: 0,
    orderLeadTimeMinutes: 120,
    expressLeadTimeMinutes: 60,
    notice: "",
    paymentMethods: {
      online: false,
      cash: true,
      transfer: true,
    },
  });
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">(
    "delivery",
  );
  const [zoneId, setZoneId] = useState("");
  const [intervalId, setIntervalId] = useState("");

  const [deliveryService, setDeliveryService] = useState<
    "standard" | "express"
  >("standard");

  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [discountTotal, setDiscountTotal] = useState(0);
  const [account, setAccount] = useState<AccountCustomer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [recipientSameAsCustomer, setRecipientSameAsCustomer] = useState(false);
  const [isSurprise, setIsSurprise] = useState(false);
  const [doNotCallRecipient, setDoNotCallRecipient] = useState(false);
  const [clientRequestId, setClientRequestId] = useState("");
  const [cartNotice, setCartNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [bonusBalance, setBonusBalance] = useState(0);
  const [bonusToSpend, setBonusToSpend] = useState(0);
  const [bonusMessage, setBonusMessage] = useState("");
  const [success, setSuccess] = useState<{
    orderNumber: string;
    totalAmount: number;
    trackingToken?: string;
    telegramLinkCode?: string;
    reused?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setClientRequestId(createClientRequestId());

    const storedItems = readCart();

    setItems(storedItems);

    void refreshCartProducts(storedItems).then((freshItems) => {
      setItems(freshItems);

      const storedById = new Map(
        storedItems.map((item) => [item.productId, item]),
      );

      const priceChanged = freshItems.some((item) => {
        const stored = storedById.get(item.productId);

        return Boolean(stored && stored.price !== item.price);
      });

      const availabilityChanged = freshItems.some((item) => {
        const stored = storedById.get(item.productId);

        return Boolean(stored && stored.isAvailable !== item.isAvailable);
      });

      if (priceChanged || availabilityChanged) {
        setCartNotice(
          "Цены и наличие товаров обновлены по актуальным данным каталога.",
        );
      }

      if (JSON.stringify(freshItems) !== JSON.stringify(storedItems)) {
        writeCart(freshItems);
      }
    });

    fetch("/api/public/delivery")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Delivery unavailable");
        }

        return res.json();
      })
      .then((data) => {
        const nextDelivery = data as DeliveryData;

        setDelivery(nextDelivery);

        if (
          nextDelivery.pickup?.enabled === false
          && deliveryType === "pickup"
        ) {
          setDeliveryType("delivery");
        }

        if (
          !Array.isArray(nextDelivery.zones) ||
          nextDelivery.zones.length === 0 ||
          !Array.isArray(nextDelivery.intervals) ||
          nextDelivery.intervals.length === 0
        ) {
          setDeliveryError(
            nextDelivery.pickup?.enabled !== false
              ? "Доставка пока не настроена. Выберите самовывоз или обратитесь к менеджеру."
              : "Доставка пока не настроена. Обратитесь к менеджеру.",
          );
        } else {
          setDeliveryError("");
        }
      })
      .catch(() => {
        setDeliveryError(
          "Не удалось загрузить зоны и интервалы доставки. Обновите страницу.",
        );
      });

    fetch("/api/public/account/me", {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const customer = data?.customer as AccountCustomer | undefined;

        if (!customer) return;

        setAccount(customer);
        setCustomerName(customer.name || "");
        setCustomerPhone(customer.phone || "");
        setCustomerEmail(customer.email || "");
        setBonusBalance(Number(customer.bonus_balance || 0));

        const addresses = Array.isArray(data?.addresses)
          ? (data.addresses as SavedAddress[])
          : [];

        setSavedAddresses(addresses);

        const preferredAddress =
          addresses.find((address) => address.is_default) ?? addresses[0];

        if (preferredAddress) {
          setSelectedAddressId(preferredAddress.id);
          setDeliveryAddress(formatSavedAddress(preferredAddress));
          setDeliveryComment(savedAddressComment(preferredAddress));
        }
      })
      .catch(() => undefined);
  }, []);

  const hasUnavailableItems = items.some((item) => !item.isAvailable);

  const availableItems = items.filter((item) => item.isAvailable);

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          item.isAvailable ? sum + item.price * item.quantity : sum,
        0,
      ),
    [items],
  );

  const minDeliveryDate = moscowDateInputValue();

  const maxDeliveryDate = addDaysToDateInput(minDeliveryDate, 180);

  const isDelivery = deliveryType === "delivery";

  const selectedZone =
    delivery.zones.find((zone) => zone.id === zoneId) ?? null;

  const deliveryIsExpress =
    isDelivery &&
    deliveryService === "express" &&
    selectedZone?.isExpressAvailable === true &&
    Number(selectedZone.expressPrice ?? 0) > 0;

  const freeFromAmount = Math.max(0, Number(selectedZone?.freeFromAmount ?? 0));

  const standardDeliveryQualifiesForFree =
    isDelivery &&
    Boolean(selectedZone) &&
    freeFromAmount > 0 &&
    subtotal >= freeFromAmount;

  const standardDeliveryIsFree =
    !deliveryIsExpress && standardDeliveryQualifiesForFree;

  const deliveryPrice =
    !isDelivery || !selectedZone
      ? 0
      : deliveryIsExpress
        ? Math.max(0, Number(selectedZone.expressPrice ?? 0))
        : standardDeliveryIsFree
          ? 0
          : Math.max(0, Number(selectedZone.price ?? 0));

  const deliveryTariffLabel = !isDelivery
    ? "Самовывоз"
    : deliveryIsExpress
      ? "Срочная доставка"
      : standardDeliveryIsFree
        ? "Бесплатная доставка"
        : "Обычная доставка";

  const remainingForFreeDelivery =
    isDelivery && selectedZone && !deliveryIsExpress && freeFromAmount > 0
      ? Math.max(0, freeFromAmount - subtotal)
      : 0;

  const amountBeforeBonus = Math.max(
    0,
    subtotal + deliveryPrice - discountTotal,
  );

  const total = Math.max(0, amountBeforeBonus - bonusToSpend);

  const minimumOrderAmount = Math.max(
    0,
    Number(delivery.minimumOrderAmount || 0),
  );

  const missingForMinimumOrder = Math.max(
    0,
    minimumOrderAmount - subtotal,
  );

  const minimumOrderReached =
    minimumOrderAmount <= 0
    || subtotal >= minimumOrderAmount;

  const defaultPaymentMethod =
    delivery.paymentMethods.transfer
      ? "transfer_after_confirm"
      : delivery.paymentMethods.cash
        ? "cash_on_delivery"
        : delivery.paymentMethods.online
          ? "online_card"
          : "transfer_after_confirm";

  function resetCartAdjustments() {
    setDiscountTotal(0);
    setPromoMessage("");
    setBonusToSpend(0);
    setBonusMessage("");
  }

  function updateQty(cartLineId: string, quantity: number) {
    const safeQuantity = Math.min(99, Math.max(0, Number(quantity) || 0));
    const next = items
      .map((item) =>
        item.cartLineId === cartLineId
          ? { ...item, quantity: safeQuantity }
          : item,
      )
      .filter((item) => item.quantity > 0);

    resetCartAdjustments();
    setItems(next);
    writeCart(next);
  }

  function removeItem(cartLineId: string) {
    const next = items.filter((item) => item.cartLineId !== cartLineId);

    resetCartAdjustments();
    setFormError("");
    setItems(next);
    writeCart(next);
  }

  function removeUnavailableItems() {
    const next = items.filter((item) => item.isAvailable);

    resetCartAdjustments();
    setFormError("");
    setCartNotice("");
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
        body: JSON.stringify({ code, subtotal }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setDiscountTotal(0);
        setPromoMessage(data?.message || "Промокод не применён");
        return;
      }

      setDiscountTotal(Number(data.promo.discountTotal || 0));
      setPromoCode(data.promo.code);
      setPromoMessage(
        `Промокод применён: −${money(Number(data.promo.discountTotal || 0))}`,
      );
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
      setBonusMessage(
        "Для списания бонусов укажите телефон из личного кабинета",
      );
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
        body: JSON.stringify({ amount: amountBeforeBonus }),
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

    if (loading) {
      return;
    }

    setFormError("");

    if (items.length === 0) {
      setFormError("Корзина пуста. Добавьте хотя бы один товар.");
      return;
    }

    if (hasUnavailableItems) {
      setFormError("Удалите недоступные товары перед оформлением заказа.");
      return;
    }

    if (!minimumOrderReached) {
      setFormError(
        `Минимальная сумма заказа — ${money(minimumOrderAmount)}. Добавьте товаров ещё на ${money(missingForMinimumOrder)}.`,
      );
      return;
    }

    if (
      deliveryType === "pickup"
      && !delivery.pickup.enabled
    ) {
      setFormError("Самовывоз временно недоступен. Выберите доставку.");
      return;
    }

    if (!clientRequestId) {
      setFormError(
        "Страница ещё загружается. Повторите попытку через несколько секунд.",
      );
      return;
    }

    if (isDelivery && deliveryError) {
      setFormError(deliveryError);
      return;
    }

    const form = new FormData(event.currentTarget);

    const formCustomerName = String(form.get("customerName") ?? "").trim();

    const formCustomerPhone = String(form.get("customerPhone") ?? "").trim();

    const formRecipientName = recipientSameAsCustomer
      ? formCustomerName
      : String(form.get("recipientName") ?? "").trim();

    const formRecipientPhone = recipientSameAsCustomer
      ? formCustomerPhone
      : String(form.get("recipientPhone") ?? "").trim();

    if (formCustomerName.length < 2) {
      setFormError("Укажите ваше имя.");
      return;
    }

    if (!validPhone(formCustomerPhone)) {
      setFormError("Укажите корректный телефон покупателя.");
      return;
    }

    if (!recipientSameAsCustomer && formRecipientName.length < 2) {
      setFormError("Укажите имя получателя.");
      return;
    }

    if (!recipientSameAsCustomer && !validPhone(formRecipientPhone)) {
      setFormError("Укажите корректный телефон получателя.");
      return;
    }

    const deliveryDate = isDelivery
      ? String(form.get("deliveryDate") ?? "").trim()
      : "";

    const deliveryAddress = isDelivery
      ? String(form.get("deliveryAddress") ?? "").trim()
      : "";

    if (
      isDelivery &&
      (!zoneId || !intervalId || !deliveryDate || deliveryAddress.length < 5)
    ) {
      setFormError("Заполните зону, дату, интервал и полный адрес доставки.");
      return;
    }

    const privacyAccepted = form.get("privacyAccepted") === "on";

    if (!privacyAccepted) {
      setFormError("Подтвердите согласие с условиями оформления заказа.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/public/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          clientRequestId,
          customerName: formCustomerName,
          customerPhone: formCustomerPhone,
          customerEmail: String(form.get("customerEmail") ?? "").trim(),
          recipientSameAsCustomer,
          recipientName: formRecipientName,
          recipientPhone: formRecipientPhone,
          isSurprise,
          doNotCallRecipient,
          cardText: String(form.get("cardText") ?? "").trim(),
          contactPreference: String(
            form.get("contactPreference") ?? "call_or_message",
          ),
          deliveryType,
          deliveryService: isDelivery ? deliveryService : "standard",
          deliveryAddress,
          deliveryComment: isDelivery
            ? String(form.get("deliveryComment") ?? "").trim()
            : "",
          deliveryDate,
          deliveryIntervalId: isDelivery ? intervalId : "",
          deliveryIntervalText: "",
          deliveryZoneId: isDelivery ? zoneId : "",
          paymentMethod: String(
            form.get("paymentMethod") ?? "transfer_after_confirm",
          ),
          customerComment: String(form.get("customerComment") ?? "").trim(),
          promoCode,
          bonusToSpend,
          privacyAccepted,
          items: availableItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message
          || data?.error
          || "Не удалось оформить заказ",
        );
      }

      writeCart([]);
      setItems([]);
      setCartNotice("");
      setClientRequestId(createClientRequestId());
      setSuccess(data.order);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось оформить заказ",
      );
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
          {success.reused
            ? "Заказ уже был создан ранее. Повторный запрос распознан, второй заказ не добавлен."
            : "Мы получили заказ. Менеджер проверит детали, подтвердит состав и свяжется с вами."}
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
            <a
              href={`/order/track/${success.trackingToken}`}
              className="dark-button"
            >
              Отследить заказ
            </a>
          ) : (
            <a href="/account" className="dark-button">
              Личный кабинет
            </a>
          )}
          <a href="/catalog" className="light-button">
            Вернуться в каталог
          </a>
        </div>

        {success.telegramLinkCode ? (
          <div className="cart-success-telegram">
            <strong>Telegram-уведомления</strong>
            <p>
              Откройте бота в Telegram, нажмите «🔗 Привязать аккаунт» и введите
              код:
            </p>
            <div className="cart-success-telegram-code">
              {success.telegramLinkCode}
            </div>
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

        {cartNotice ? (
          <div className="cart-system-notice" role="status">
            <span>{cartNotice}</span>

            <button
              type="button"
              onClick={() => {
                setCartNotice("");
              }}
            >
              Понятно
            </button>
          </div>
        ) : null}

        {hasUnavailableItems ? (
          <div className="cart-unavailable-notice" role="alert">
            <div>
              <strong>В корзине есть недоступные товары</strong>

              <p>Они не входят в итоговую сумму и мешают оформить заказ.</p>
            </div>

            <button type="button" onClick={removeUnavailableItems}>
              Удалить недоступные
            </button>
          </div>
        ) : null}

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
                  item.imageUrl ? "has-image" : "is-placeholder",
                ].join(" ")}
                aria-label={`Открыть ${item.name}`}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.imageAlt || item.name}
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.parentElement?.classList.add(
                        "image-failed",
                      );
                    }}
                  />
                ) : null}

                <span className="cart-item-image-fallback">ВМ</span>
              </a>

              <div>
                <h3>
                  <a href={`/product/${item.slug}`}>{item.name}</a>
                </h3>

                <p>{money(item.price)}</p>

                {item.isAvailable === false ? (
                  <span className="cart-item-unavailable">
                    Товар больше недоступен
                  </span>
                ) : null}
              </div>

              <div className="cart-item-controls">
                <div
                  className="quantity-control"
                  aria-label={`Количество: ${item.name}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateQty(item.cartLineId, item.quantity - 1)
                    }
                  >
                    −
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateQty(item.cartLineId, item.quantity + 1)
                    }
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className="cart-remove-button"
                  onClick={() => removeItem(item.cartLineId)}
                >
                  Удалить
                </button>
              </div>

              <strong>
                {item.isAvailable
                  ? money(item.price * item.quantity)
                  : "Не входит в итог"}
              </strong>
            </article>
          ))
        )}
      </div>

      <form
        className="checkout-form checkout-form-v2"
        onSubmit={submitOrder}
        noValidate
      >
        <div className="checkout-total">
          <span>Итого</span>
          <strong>{money(total)}</strong>
        </div>

        <div className="checkout-price-breakdown">
          <div>
            <span>Товары</span>
            <strong>{money(subtotal)}</strong>
          </div>

          {isDelivery ? (
            <div>
              <span>Доставка</span>
              <strong>
                {!selectedZone
                  ? "Не выбрана"
                  : deliveryPrice > 0
                    ? money(deliveryPrice)
                    : "Бесплатно"}
              </strong>
            </div>
          ) : (
            <div>
              <span>Самовывоз</span>
              <strong>Бесплатно</strong>
            </div>
          )}
        </div>

        {minimumOrderAmount > 0 ? (
          <div
            className={[
              "checkout-minimum-order",
              minimumOrderReached ? "success" : "warning",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <strong>
              {minimumOrderReached
                ? "Минимальная сумма набрана"
                : `До минимальной суммы осталось ${money(missingForMinimumOrder)}`}
            </strong>

            <span>
              Минимальная сумма товаров: {money(minimumOrderAmount)}
            </span>
          </div>
        ) : null}

        {delivery.notice ? (
          <div className="checkout-shop-notice">
            {delivery.notice}
          </div>
        ) : null}

        {isDelivery ? (
          <div
            className={[
              "checkout-delivery",
              deliveryIsExpress ? "express" : "",
              standardDeliveryIsFree ? "free" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div>
              <span>{deliveryTariffLabel}</span>

              {selectedZone ? <small>{selectedZone.name}</small> : null}
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
              <small>Получение в магазине</small>
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

        {formError ? (
          <div className="checkout-form-error" role="alert">
            {formError}
          </div>
        ) : null}

        {deliveryError && isDelivery ? (
          <div className="checkout-form-error" role="alert">
            {deliveryError}
          </div>
        ) : null}

        <section className="checkout-section">
          <div className="checkout-section-heading">
            <span>1</span>

            <div>
              <strong>Покупатель</strong>
              <small>Контакты для подтверждения заказа</small>
            </div>
          </div>

          <div className="checkout-fields">
            <label>
              <span>Ваше имя *</span>
              <input
                name="customerName"
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setFormError("");
                }}
                autoComplete="name"
                minLength={2}
                maxLength={160}
                required
              />
            </label>

            <label>
              <span>Ваш телефон *</span>
              <input
                name="customerPhone"
                value={customerPhone}
                onChange={(event) => {
                  setCustomerPhone(event.target.value);
                  setBonusToSpend(0);
                  setBonusMessage("");
                  setFormError("");
                }}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 999 000-00-00"
                maxLength={32}
                required
              />
            </label>

            <label>
              <span>Email</span>
              <input
                name="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(event) => {
                  setCustomerEmail(event.target.value);
                }}
                autoComplete="email"
                placeholder="Для чека и уведомлений"
                maxLength={255}
              />
            </label>

            <label>
              <span>Как связаться</span>
              <select name="contactPreference" defaultValue="call_or_message">
                <option value="call_or_message">Позвонить или написать</option>
                <option value="phone_call">Лучше позвонить</option>
                <option value="messenger_only">Только сообщение</option>
              </select>
            </label>
          </div>
        </section>

        <section className="checkout-section">
          <div className="checkout-section-heading">
            <span>2</span>

            <div>
              <strong>Получатель</strong>
              <small>Кому передать букет или подарок</small>
            </div>
          </div>

          <div className="checkout-fields">
            <label className="checkout-choice wide">
              <input
                type="checkbox"
                checked={recipientSameAsCustomer}
                onChange={(event) => {
                  const checked = event.target.checked;

                  setRecipientSameAsCustomer(checked);

                  if (checked) {
                    setIsSurprise(false);
                    setDoNotCallRecipient(false);
                  }

                  setFormError("");
                }}
              />

              <span>
                <strong>Получатель — я</strong>
                <small>Используем имя и телефон покупателя</small>
              </span>
            </label>

            {!recipientSameAsCustomer ? (
              <>
                <label>
                  <span>Имя получателя *</span>
                  <input
                    name="recipientName"
                    autoComplete="off"
                    minLength={2}
                    maxLength={160}
                    required
                  />
                </label>

                <label>
                  <span>Телефон получателя *</span>
                  <input
                    name="recipientPhone"
                    inputMode="tel"
                    autoComplete="off"
                    placeholder="+7 999 000-00-00"
                    maxLength={32}
                    required
                  />
                </label>

                <label className="checkout-choice wide">
                  <input
                    type="checkbox"
                    checked={isSurprise}
                    onChange={(event) => {
                      setIsSurprise(event.target.checked);
                    }}
                  />

                  <span>
                    <strong>Это сюрприз</strong>
                    <small>
                      Не сообщать получателю содержание заказа заранее
                    </small>
                  </span>
                </label>

                <label className="checkout-choice wide">
                  <input
                    type="checkbox"
                    checked={doNotCallRecipient}
                    onChange={(event) => {
                      setDoNotCallRecipient(event.target.checked);
                    }}
                  />

                  <span>
                    <strong>Не звонить получателю</strong>
                    <small>
                      Менеджер согласует безопасный способ вручения с
                      покупателем
                    </small>
                  </span>
                </label>
              </>
            ) : null}

            <label className="wide">
              <span>Текст для открытки</span>
              <textarea
                name="cardText"
                maxLength={500}
                placeholder="Например: С любовью и самыми тёплыми пожеланиями"
              />
            </label>
          </div>
        </section>

        <section className="checkout-section">
          <div className="checkout-section-heading">
            <span>3</span>

            <div>
              <strong>Получение</strong>
              <small>Доставка или самовывоз</small>
            </div>
          </div>

          <div className="checkout-fields">
            <label className="wide">
              <span>Способ получения</span>
              <select
                name="deliveryType"
                value={deliveryType}
                onChange={(event) => {
                  const nextDeliveryType =
                    event.target.value === "pickup" ? "pickup" : "delivery";

                  setDeliveryType(nextDeliveryType);

                  if (nextDeliveryType === "pickup") {
                    setZoneId("");
                    setIntervalId("");
                    setDeliveryService("standard");
                  }

                  resetCartAdjustments();
                  setFormError("");
                }}
              >
                <option value="delivery">Доставка</option>
                {delivery.pickup.enabled ? (
                  <option value="pickup">Самовывоз</option>
                ) : null}
              </select>
            </label>

            {isDelivery ? (
              <>
                <label className="wide">
                  <span>Зона доставки *</span>
                  <select
                    name="deliveryZoneId"
                    value={zoneId}
                    onChange={(event) => {
                      setZoneId(event.target.value);
                      setDeliveryService("standard");
                      resetCartAdjustments();
                      setFormError("");
                    }}
                    required
                  >
                    <option value="">Выберите зону</option>

                    {delivery.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedZone ? (
                  <fieldset className="checkout-delivery-service wide">
                    <legend>Тариф доставки</legend>

                    <label
                      className={[
                        "checkout-delivery-service-option",
                        deliveryService === "standard" ? "active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <input
                        type="radio"
                        name="deliveryService"
                        value="standard"
                        checked={deliveryService === "standard"}
                        onChange={() => {
                          setDeliveryService("standard");
                          resetCartAdjustments();
                        }}
                      />

                      <span>
                        <strong>Обычная доставка</strong>
                        <small>
                          {standardDeliveryQualifiesForFree
                            ? "Бесплатно"
                            : money(selectedZone.price)}
                        </small>
                      </span>
                    </label>

                    {selectedZone.isExpressAvailable &&
                    Number(selectedZone.expressPrice ?? 0) > 0 ? (
                      <label
                        className={[
                          "checkout-delivery-service-option",
                          deliveryService === "express" ? "active express" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <input
                          type="radio"
                          name="deliveryService"
                          value="express"
                          checked={deliveryService === "express"}
                          onChange={() => {
                            setDeliveryService("express");
                            resetCartAdjustments();
                          }}
                        />

                        <span>
                          <strong>Срочная доставка</strong>
                          <small>
                            {money(Number(selectedZone.expressPrice ?? 0))}
                          </small>
                        </span>
                      </label>
                    ) : null}

                    {deliveryIsExpress ? (
                      <p className="checkout-delivery-service-note express">
                        Срочный тариф оплачивается отдельно и не становится
                        бесплатным от суммы заказа.
                      </p>
                    ) : freeFromAmount > 0 ? (
                      <p
                        className={[
                          "checkout-delivery-service-note",
                          standardDeliveryIsFree ? "success" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {remainingForFreeDelivery > 0
                          ? `До бесплатной доставки осталось ${money(
                              remainingForFreeDelivery,
                            )}`
                          : "Бесплатная доставка активирована"}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}

                <label>
                  <span>Дата доставки *</span>
                  <input
                    name="deliveryDate"
                    type="date"
                    min={minDeliveryDate}
                    max={maxDeliveryDate}
                    required
                  />
                </label>

                <label>
                  <span>Интервал *</span>
                  <select
                    name="deliveryIntervalId"
                    value={intervalId}
                    onChange={(event) => {
                      setIntervalId(event.target.value);
                      setFormError("");
                    }}
                    required
                  >
                    <option value="">Выберите интервал</option>

                    {delivery.intervals.map((interval) => (
                      <option key={interval.id} value={interval.id}>
                        {interval.name}
                      </option>
                    ))}
                  </select>
                </label>

                {savedAddresses.length ? (
                  <label className="wide checkout-saved-address">
                    <span>Сохранённый адрес</span>
                    <select
                      value={selectedAddressId}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        setSelectedAddressId(nextId);

                        const address = savedAddresses.find(
                          (item) => item.id === nextId,
                        );

                        if (address) {
                          setDeliveryAddress(formatSavedAddress(address));
                          setDeliveryComment(savedAddressComment(address));
                        }

                        setFormError("");
                      }}
                    >
                      <option value="">Ввести другой адрес</option>
                      {savedAddresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {address.is_default ? "Основной · " : ""}
                          {formatSavedAddress(address)}
                        </option>
                      ))}
                    </select>
                    <small>Адреса можно изменить в личном кабинете.</small>
                  </label>
                ) : null}

                <label className="wide">
                  <span>Полный адрес доставки *</span>
                  <input
                    name="deliveryAddress"
                    value={deliveryAddress}
                    onChange={(event) => {
                      setDeliveryAddress(event.target.value);
                      setSelectedAddressId("");
                      setFormError("");
                    }}
                    autoComplete="street-address"
                    placeholder="Город, улица, дом, квартира"
                    minLength={5}
                    maxLength={1000}
                    required
                  />
                </label>

                <label className="wide">
                  <span>Комментарий курьеру</span>
                  <textarea
                    name="deliveryComment"
                    value={deliveryComment}
                    onChange={(event) => setDeliveryComment(event.target.value)}
                    maxLength={1000}
                    placeholder="Подъезд, этаж, домофон, ориентир или особые пожелания"
                  />
                </label>
              </>
            ) : (
              <div className="pickup-note wide">
                <strong>Самовывоз</strong>

                {delivery.pickup.address ? (
                  <p>
                    <b>Адрес:</b> {delivery.pickup.address}
                  </p>
                ) : null}

                <p>{delivery.pickup.note}</p>
              </div>
            )}
          </div>
        </section>

        <section className="checkout-section">
          <div className="checkout-section-heading">
            <span>4</span>

            <div>
              <strong>Оплата и скидки</strong>
              <small>Промокод, бонусы и способ оплаты</small>
            </div>
          </div>

          <div className="checkout-fields">
            <div className="promo-box wide">
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
                  maxLength={80}
                />
              </label>

              <button
                type="button"
                onClick={checkPromo}
                disabled={items.length === 0 || hasUnavailableItems}
              >
                Применить
              </button>

              {promoMessage ? <p>{promoMessage}</p> : null}
            </div>

            {account ? (
              <div className="promo-box bonus-box wide">
                <div>
                  <strong>Бонусы</strong>
                  <p>Доступно: {money(bonusBalance)}</p>
                  {bonusMessage ? <p>{bonusMessage}</p> : null}
                </div>

                <button
                  type="button"
                  onClick={checkBonus}
                  disabled={
                    items.length === 0 ||
                    amountBeforeBonus <= 0 ||
                    hasUnavailableItems
                  }
                >
                  Использовать
                </button>
              </div>
            ) : null}

            <label className="wide">
              <span>Способ оплаты</span>
              <select
                name="paymentMethod"
                defaultValue={defaultPaymentMethod}
              >
                {delivery.paymentMethods.transfer ? (
                  <option value="transfer_after_confirm">
                    Перевод после подтверждения
                  </option>
                ) : null}

                {delivery.paymentMethods.cash ? (
                  <option value="cash_on_delivery">
                    При получении
                  </option>
                ) : null}

                {delivery.paymentMethods.online ? (
                  <option value="online_card">
                    Онлайн-оплата
                  </option>
                ) : null}
              </select>
            </label>

            <label className="wide">
              <span>Комментарий к заказу</span>
              <textarea
                name="customerComment"
                maxLength={2000}
                placeholder="Пожелания по составу, цветовой гамме или связи с вами"
              />
            </label>
          </div>
        </section>

        <label className="checkout-consent">
          <input type="checkbox" name="privacyAccepted" required />

          <span>
            Я согласен на обработку данных и подтверждаю корректность указанных
            контактов и адреса.
          </span>
        </label>

        <button
          type="submit"
          className="checkout-submit-button"
          disabled={
            loading ||
            items.length === 0 ||
            hasUnavailableItems ||
            !clientRequestId ||
            !minimumOrderReached ||
            (!isDelivery && !delivery.pickup.enabled) ||
            (isDelivery && Boolean(deliveryError))
          }
        >
          {loading ? "Оформляем заказ..." : "Оформить заказ"}
        </button>

        <p className="checkout-submit-note">
          Повторное нажатие не создаст второй заказ: запрос защищён от
          дублирования.
        </p>
      </form>
    </section>
  );
}
