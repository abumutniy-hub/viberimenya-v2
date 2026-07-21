"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearLinkedCustomerCart,
  setLinkedCustomerCartItem,
  synchronizeLinkedCustomerCart,
  type LinkedCustomerCartSnapshot,
} from "../../lib/customer-cart-sync";

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
  acceptingOrders: boolean;
  maintenanceMode: boolean;
  ordersPausedMessage: string;

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

type SharedDeliveryAddressDetails = {
  deliveryAddressSelected: boolean;
  deliveryAddressProvider: "dadata" | "saved" | "manual";
  deliveryAddressFiasId: string;
  deliveryAddressKladrId: string;
  deliveryAddressPostalCode: string;
  deliveryAddressRegion: string;
  deliveryAddressCity: string;
  deliveryAddressSettlement: string;
  deliveryAddressStreet: string;
  deliveryAddressHouse: string;
  deliveryAddressBlock: string;
  deliveryAddressLatitude: string;
  deliveryAddressLongitude: string;
  deliveryAddressGeoQuality: string;
  deliveryApartment: string;
  deliveryEntrance: string;
  deliveryFloor: string;
  deliveryIntercom: string;
  deliveryNoApartment: boolean;
};

const EMPTY_DELIVERY_ADDRESS_DETAILS: SharedDeliveryAddressDetails = {
  deliveryAddressSelected: false,
  deliveryAddressProvider: "manual",
  deliveryAddressFiasId: "",
  deliveryAddressKladrId: "",
  deliveryAddressPostalCode: "",
  deliveryAddressRegion: "",
  deliveryAddressCity: "",
  deliveryAddressSettlement: "",
  deliveryAddressStreet: "",
  deliveryAddressHouse: "",
  deliveryAddressBlock: "",
  deliveryAddressLatitude: "",
  deliveryAddressLongitude: "",
  deliveryAddressGeoQuality: "",
  deliveryApartment: "",
  deliveryEntrance: "",
  deliveryFloor: "",
  deliveryIntercom: "",
  deliveryNoApartment: false,
};

type SharedCheckoutDraft = {
  data?: {
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    recipientName?: string;
    recipientPhone?: string;
    recipientSameAsCustomer?: boolean;
    isSurprise?: boolean;
    doNotCallRecipient?: boolean;
    contactPreference?:
      | "call_or_message"
      | "phone_call"
      | "messenger_only";
    cardText?: string;
    deliveryType?: "delivery" | "pickup";
    deliveryService?: "standard" | "express";
    deliveryZoneId?: string;
    deliveryDateText?: string;
    deliveryIntervalId?: string;
    deliveryAddress?: string;
    deliveryComment?: string;
  } & Partial<SharedDeliveryAddressDetails>;
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

function cartItemsFromLinkedSnapshot(
  snapshot: LinkedCustomerCartSnapshot,
  current: CartItem[],
): CartItem[] {
  const currentByProductId = new Map(
    current.map((item) => [item.productId, item]),
  );

  return snapshot.items.map((item) => {
    const existing = currentByProductId.get(item.productId);

    return {
      cartLineId: existing?.cartLineId || createCartLineId(item.productId),
      productId: item.productId,
      slug: item.slug,
      name: item.name,
      price: Number(item.price || 0),
      quantity: Math.min(99, Math.max(1, Number(item.quantity || 1))),
      imageUrl: item.imageUrl || existing?.imageUrl || "",
      imageAlt: item.imageAlt || item.name,
      isAvailable: true,
    };
  });
}

type CartSyncProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  availability: "available" | "preorder" | "unavailable";

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

        isAvailable: product.availability !== "unavailable",
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
  const cartMutationQueues = useRef(new Map<string, Promise<void>>());
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
    acceptingOrders: true,
    maintenanceMode: false,
    ordersPausedMessage:
      "Приём новых заказов временно приостановлен.",
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
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [deliveryAddressDetails, setDeliveryAddressDetails] =
    useState<SharedDeliveryAddressDetails>(EMPTY_DELIVERY_ADDRESS_DETAILS);
  const [recipientSameAsCustomer, setRecipientSameAsCustomer] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [contactPreference, setContactPreference] = useState<
    "call_or_message" | "phone_call" | "messenger_only"
  >("call_or_message");
  const [cardText, setCardText] = useState("");
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
    paymentMethod?: string;
    telegramLinkCode?: string;
    reused?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setClientRequestId(createClientRequestId());

    const storedItems = readCart();

    setItems(storedItems);

    void refreshCartProducts(storedItems).then(async (freshItems) => {
      const linkedCart = await synchronizeLinkedCustomerCart(
        freshItems
          .filter((item) => item.isAvailable)
          .map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        "merge_max",
      );
      const nextItems = linkedCart
        ? cartItemsFromLinkedSnapshot(linkedCart, freshItems)
        : freshItems;

      setItems(nextItems);

      const storedById = new Map(
        storedItems.map((item) => [item.productId, item]),
      );

      const priceChanged = nextItems.some((item) => {
        const stored = storedById.get(item.productId);

        return Boolean(stored && stored.price !== item.price);
      });

      const availabilityChanged = freshItems.some((item) => {
        const stored = storedById.get(item.productId);

        return Boolean(stored && stored.isAvailable !== item.isAvailable);
      });

      if (linkedCart) {
        const removedCount = linkedCart.removed.length;
        setCartNotice(
          removedCount > 0
            ? `Корзина синхронизирована с Telegram. Недоступных товаров удалено: ${removedCount}.`
            : "Корзина синхронизирована между сайтом и Telegram.",
        );
      } else if (priceChanged || availabilityChanged) {
        setCartNotice(
          "Цены и наличие товаров обновлены по актуальным данным каталога.",
        );
      }

      if (JSON.stringify(nextItems) !== JSON.stringify(storedItems)) {
        writeCart(nextItems);
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
          setDeliveryComment(preferredAddress.comment || "");
          setDeliveryAddressDetails({
            ...EMPTY_DELIVERY_ADDRESS_DETAILS,
            deliveryAddressSelected: true,
            deliveryAddressProvider: "saved",
            deliveryAddressCity: preferredAddress.city || "",
            deliveryAddressStreet: preferredAddress.street || "",
            deliveryAddressHouse: preferredAddress.house || "",
            deliveryApartment: preferredAddress.apartment || "",
            deliveryEntrance: preferredAddress.entrance || "",
            deliveryFloor: preferredAddress.floor || "",
            deliveryNoApartment: !preferredAddress.apartment,
          });
        }

        if (data?.telegram?.connected === true) {
          void fetch("/api/public/account/checkout-draft", {
            credentials: "include",
            cache: "no-store",
          })
            .then((response) => (response.ok ? response.json() : null))
            .then((draftResponse) => {
              const sharedDraft = draftResponse?.draft as
                | SharedCheckoutDraft
                | null
                | undefined;
              const draftData = sharedDraft?.data;

              if (!draftData) return;

              if (draftData.customerName) {
                setCustomerName(draftData.customerName);
              }

              if (draftData.customerEmail !== undefined) {
                setCustomerEmail(draftData.customerEmail || "");
              }

              const same = draftData.recipientSameAsCustomer === true;
              setRecipientSameAsCustomer(same);
              setRecipientName(
                same
                  ? draftData.customerName || customer.name || ""
                  : draftData.recipientName || "",
              );
              setRecipientPhone(
                same
                  ? customer.phone || ""
                  : draftData.recipientPhone || "",
              );
              setIsSurprise(same ? false : draftData.isSurprise === true);
              setDoNotCallRecipient(
                same ? false : draftData.doNotCallRecipient === true,
              );
              setContactPreference(
                draftData.contactPreference === "phone_call"
                  || draftData.contactPreference === "messenger_only"
                  ? draftData.contactPreference
                  : "call_or_message",
              );
              setCardText(draftData.cardText || "");

              if (draftData.deliveryType) {
                setDeliveryType(draftData.deliveryType);
              }
              if (draftData.deliveryService) {
                setDeliveryService(draftData.deliveryService);
              }
              if (draftData.deliveryZoneId) {
                setZoneId(draftData.deliveryZoneId);
              }
              if (draftData.deliveryDateText) {
                setDeliveryDate(draftData.deliveryDateText);
              }
              if (draftData.deliveryIntervalId) {
                setIntervalId(draftData.deliveryIntervalId);
              }
              if (draftData.deliveryAddress) {
                setDeliveryAddress(draftData.deliveryAddress);
              }
              if (draftData.deliveryComment !== undefined) {
                setDeliveryComment(draftData.deliveryComment || "");
              }
              setDeliveryAddressDetails({
                deliveryAddressSelected:
                  draftData.deliveryAddressSelected === true,
                deliveryAddressProvider:
                  draftData.deliveryAddressProvider === "dadata"
                    || draftData.deliveryAddressProvider === "saved"
                    ? draftData.deliveryAddressProvider
                    : "manual",
                deliveryAddressFiasId: draftData.deliveryAddressFiasId || "",
                deliveryAddressKladrId: draftData.deliveryAddressKladrId || "",
                deliveryAddressPostalCode:
                  draftData.deliveryAddressPostalCode || "",
                deliveryAddressRegion: draftData.deliveryAddressRegion || "",
                deliveryAddressCity: draftData.deliveryAddressCity || "",
                deliveryAddressSettlement:
                  draftData.deliveryAddressSettlement || "",
                deliveryAddressStreet: draftData.deliveryAddressStreet || "",
                deliveryAddressHouse: draftData.deliveryAddressHouse || "",
                deliveryAddressBlock: draftData.deliveryAddressBlock || "",
                deliveryAddressLatitude:
                  draftData.deliveryAddressLatitude || "",
                deliveryAddressLongitude:
                  draftData.deliveryAddressLongitude || "",
                deliveryAddressGeoQuality:
                  draftData.deliveryAddressGeoQuality || "",
                deliveryApartment: draftData.deliveryApartment || "",
                deliveryEntrance: draftData.deliveryEntrance || "",
                deliveryFloor: draftData.deliveryFloor || "",
                deliveryIntercom: draftData.deliveryIntercom || "",
                deliveryNoApartment: draftData.deliveryNoApartment === true,
              });
              setCartNotice(
                "Контакты и доставка восстановлены из общего черновика сайта и Telegram.",
              );
            })
            .catch(() => undefined);
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

  const ordersEnabled =
    delivery.acceptingOrders
    && !delivery.maintenanceMode;

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

  function queueLinkedCartQuantity(productId: string, quantity: number) {
    const previous = cartMutationQueues.current.get(productId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const snapshot = await setLinkedCustomerCartItem(productId, quantity);

        if (!snapshot) return;

        const serverItem = snapshot.items.find(
          (item) => item.productId === productId,
        );

        setItems((current) => {
          const updated = serverItem
            ? current.map((item) =>
                item.productId === productId
                  ? {
                      ...item,
                      slug: serverItem.slug,
                      name: serverItem.name,
                      price: serverItem.price,
                      quantity: serverItem.quantity,
                      imageUrl: serverItem.imageUrl || item.imageUrl,
                      imageAlt: serverItem.imageAlt || serverItem.name,
                      isAvailable: true,
                    }
                  : item,
              )
            : current.filter((item) => item.productId !== productId);

          writeCart(updated);
          return updated;
        });
      });

    cartMutationQueues.current.set(productId, next);
    void next.finally(() => {
      if (cartMutationQueues.current.get(productId) === next) {
        cartMutationQueues.current.delete(productId);
      }
    });
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

    const changed = items.find((item) => item.cartLineId === cartLineId);
    if (changed) {
      queueLinkedCartQuantity(changed.productId, safeQuantity);
    }
  }

  function removeItem(cartLineId: string) {
    const removed = items.find((item) => item.cartLineId === cartLineId);
    const next = items.filter((item) => item.cartLineId !== cartLineId);

    resetCartAdjustments();
    setFormError("");
    setItems(next);
    writeCart(next);

    if (removed) {
      queueLinkedCartQuantity(removed.productId, 0);
    }
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

    if (!ordersEnabled) {
      setFormError(
        delivery.ordersPausedMessage
        || "Приём новых заказов временно приостановлен.",
      );
      return;
    }

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

    const submittedDeliveryDate = isDelivery
      ? deliveryDate.trim()
      : "";

    const deliveryAddress = isDelivery
      ? String(form.get("deliveryAddress") ?? "").trim()
      : "";

    if (
      isDelivery &&
      (!zoneId || !intervalId || !submittedDeliveryDate || deliveryAddress.length < 5)
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
          ...deliveryAddressDetails,
          deliveryComment: isDelivery
            ? String(form.get("deliveryComment") ?? "").trim()
            : "",
          deliveryDate: submittedDeliveryDate,
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
      void clearLinkedCustomerCart();
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
              {success.paymentMethod === "online_card" || success.paymentMethod === "sbp"
                ? "Перейти к оплате"
                : "Отследить заказ"}
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

      <section className="checkout-form checkout-form-v2 checkout-launch-entry">
        <div className="checkout-guided-entry">
          <div>
            <strong>Пошаговое оформление без регистрации</strong>
            <span>Контакты, доставка, скидки и оплата проверяются на отдельных шагах. Telegram можно подключить после заказа.</span>
          </div>
        </div>

        <div className="checkout-total">
          <span>Товары в корзине</span>
          <strong>{money(subtotal)}</strong>
        </div>

        {minimumOrderAmount > 0 ? (
          <div
            className={[
              "checkout-minimum-order",
              minimumOrderReached ? "success" : "warning",
            ].filter(Boolean).join(" ")}
          >
            <strong>
              {minimumOrderReached
                ? "Минимальная сумма набрана"
                : `До минимальной суммы осталось ${money(missingForMinimumOrder)}`}
            </strong>
            <span>Минимальная сумма товаров: {money(minimumOrderAmount)}</span>
          </div>
        ) : null}

        {!ordersEnabled ? (
          <div className="checkout-orders-paused" role="status">
            <strong>Новые заказы временно не принимаются</strong>
            <p>{delivery.ordersPausedMessage}</p>
          </div>
        ) : null}

        {!ordersEnabled
          || items.length === 0
          || hasUnavailableItems
          || !minimumOrderReached ? (
          <span className="checkout-submit-button is-disabled" aria-disabled="true">
            Оформить заказ
          </span>
        ) : (
          <Link href="/checkout" className="checkout-submit-button">
            Оформить заказ
          </Link>
        )}


      </section>
    </section>
  );
}
