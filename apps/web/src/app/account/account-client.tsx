"use client";

import { useEffect, useMemo, useState } from "react";
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

type Bonus = {
  type: string;
  amount: number;
  balance_after: number;
  comment: string | null;
  created_at: string;
};

type Address = {
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

type CustomerSession = {
  id: string;
  device: string;
  ip: string | null;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

type SecurityEvent = {
  type: string;
  severity: string;
  summary: string;
  createdAt: string;
};

type AddressDraft = {
  city: string;
  street: string;
  house: string;
  apartment: string;
  entrance: string;
  floor: string;
  comment: string;
  isDefault: boolean;
};

type PairingIntent = {
  requestId: string;
  status: string;
  expiresAt: string;
  telegramUrl: string | null;
  qrDataUrl: string | null;
  manualCode: string;
  browserProof: string;
};

const PAIRING_STORAGE_KEY = "viberimenya:customer-pairing:v1";

function readStoredPairing(): PairingIntent | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PAIRING_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PairingIntent>;
    if (
      typeof value.requestId !== "string"
      || typeof value.expiresAt !== "string"
      || typeof value.manualCode !== "string"
      || typeof value.browserProof !== "string"
      || !/^[a-f0-9]{48}$/i.test(value.browserProof)
      || new Date(value.expiresAt).getTime() <= Date.now()
    ) {
      window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
      return null;
    }

    return {
      requestId: value.requestId,
      status: typeof value.status === "string" ? value.status : "pending",
      expiresAt: value.expiresAt,
      telegramUrl: typeof value.telegramUrl === "string" ? value.telegramUrl : null,
      qrDataUrl: typeof value.qrDataUrl === "string" ? value.qrDataUrl : null,
      manualCode: value.manualCode,
      browserProof: value.browserProof,
    };
  } catch {
    window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
    return null;
  }
}

function storePairing(value: PairingIntent | null) {
  if (typeof window === "undefined") return;

  if (!value) {
    window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(value));
}

type AccountResponse = {
  ok: boolean;
  customer?: Customer;
  orders?: Order[];
  bonuses?: Bonus[];
  addresses?: Address[];
  telegram?: {
    connected?: boolean;
    username?: string | null;
    notificationsEnabled?: boolean;
    linkedAt?: string | null;
  };
  message?: string;
};

const emptyAddress: AddressDraft = {
  city: "",
  street: "",
  house: "",
  apartment: "",
  entrance: "",
  floor: "",
  comment: "",
  isDefault: false,
};

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(value || 0))} ₽`;
}

function dateText(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU");
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
    pending: "Ожидает вашего согласования",
    approved: "Фото одобрено",
    revision_requested: "Запрошена правка",
    waived: "Согласование не требуется",
    not_required: "Фото пока не добавлено",
  };
  return map[status] || status;
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
    problem: "Требует внимания",
  };

  return map[status] || status;
}

function paymentText(status: string) {
  const map: Record<string, string> = {
    not_required: "Не требуется",
    created: "Платёж создаётся",
    pending: "Ожидает оплаты",
    waiting_for_capture: "Оплата подтверждается",
    paid: "Оплачен",
    failed: "Ошибка оплаты",
    refunded: "Возврат",
    partially_refunded: "Частичный возврат",
    cancelled: "Отменён",
    expired: "Срок оплаты истёк",
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
  if (status === "delivering" || status === "assigned_courier")
    return "В доставке";
  if (status === "ready") return "Готов к доставке";
  if (status === "assembling") return "Собирается";
  if (paymentStatus === "paid") return "Оплачен";
  if (status === "confirmed") return "Подтверждён";
  return "Принят";
}

function addressText(address: Address) {
  return [
    address.city,
    address.street,
    address.house ? `д. ${address.house}` : "",
    address.apartment ? `кв. ${address.apartment}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function AccountClient() {
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "pairing">("phone");
  const [pairing, setPairing] = useState<PairingIntent | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "error">(
    "info",
  );
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [telegramLinkedAt, setTelegramLinkedAt] = useState<string | null>(null);
  const [telegramNotificationsEnabled, setTelegramNotificationsEnabled] =
    useState(false);
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [requestCooldown, setRequestCooldown] = useState(0);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddress);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const [repeatingOrder, setRepeatingOrder] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionAction, setSessionAction] = useState<string | null>(null);

  const defaultAddressId = useMemo(
    () => addresses.find((address) => address.is_default)?.id ?? null,
    [addresses],
  );

  useEffect(() => {
    if (requestCooldown <= 0) return;

    const timer = window.setInterval(() => {
      setRequestCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [requestCooldown]);

  useEffect(() => {
    const stored = readStoredPairing();
    if (!stored) return;
    setPairing(stored);
    setStep("pairing");
  }, []);

  useEffect(() => {
    storePairing(pairing);
  }, [pairing]);

  function showMessage(
    text: string,
    kind: "info" | "success" | "error" = "info",
  ) {
    setMessage(text);
    setMessageKind(kind);
  }

  async function loadSessions() {
    setSessionsLoading(true);

    try {
      const response = await fetch("/api/public/account/sessions", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await readJson(response);

      if (response.ok && data.ok === true) {
        setSessions(
          Array.isArray(data.sessions)
            ? (data.sessions as CustomerSession[])
            : [],
        );
        setSecurityEvents(
          Array.isArray(data.events)
            ? (data.events as SecurityEvent[])
            : [],
        );
      } else if (response.status === 401) {
        setSessions([]);
        setSecurityEvents([]);
      }
    } catch {
      setSessions([]);
      setSecurityEvents([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function loadAccount() {
    try {
      const response = await fetch("/api/public/account/me", {
        credentials: "include",
        cache: "no-store",
      });

      const data = (await readJson(response)) as AccountResponse;

      if (response.ok && data.ok && data.customer) {
        setCustomer(data.customer);
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setBonuses(Array.isArray(data.bonuses) ? data.bonuses : []);
        setAddresses(Array.isArray(data.addresses) ? data.addresses : []);
        setProfileName(data.customer.name || "");
        setProfileEmail(data.customer.email || "");
        const connected = data.telegram?.connected === true;
        setTelegramConnected(connected);
        setTelegramUsername(String(data.telegram?.username || ""));
        setTelegramLinkedAt(data.telegram?.linkedAt || null);
        setTelegramNotificationsEnabled(
          data.telegram?.notificationsEnabled === true,
        );

        if (connected) {
          setTelegramCode("");
        }

        void loadSessions();
      } else {
        setCustomer(null);
        setOrders([]);
        setBonuses([]);
        setAddresses([]);
        setTelegramConnected(false);
        setTelegramUsername("");
        setTelegramLinkedAt(null);
        setTelegramNotificationsEnabled(false);
        setTelegramCode("");
        setSessions([]);
        setSecurityEvents([]);
      }
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");

    if (auth === "invalid") {
      showMessage(
        "Ссылка входа уже использована, истекла или была отозвана. Откройте новую ссылку в Telegram.",
        "error",
      );
    }
  }, []);

  useEffect(() => {
    if (
      !pairing
      || step !== "pairing"
      || customer
    ) {
      return;
    }

    let stopped = false;

    const checkStatus = async () => {
      try {
        const response = await fetch(
          `/api/public/account/auth/pairing/${encodeURIComponent(
            pairing.requestId,
          )}`,
          {
            credentials: "include",
            cache: "no-store",
            headers: {
              "x-vm-customer-pairing-proof": pairing.browserProof,
            },
          },
        );
        const data = await readJson(response);
        const status = String(data.status || "");

        if (
          response.ok
          && data.authenticated === true
          && status === "authenticated"
        ) {
          stopped = true;
          storePairing(null);
          setPairing(null);
          showMessage(
            "Telegram подтверждён. Выполняется вход…",
            "success",
          );
          await loadAccount();
          window.history.replaceState(
            null,
            "",
            String(data.redirectPath || "/account"),
          );
          return;
        }

        if (
          [
            "expired",
            "cancelled",
            "rejected",
            "invalid_browser",
          ].includes(status)
        ) {
          stopped = true;
          storePairing(null);
          setPairing(null);
          setStep("phone");
          showMessage(
            status === "expired"
              ? "Время подтверждения истекло. Создайте новый запрос."
              : status === "rejected"
                ? "Telegram не удалось привязать к этому номеру."
                : status === "invalid_browser"
                  ? "Эта попытка входа больше не активна. Создайте новый запрос."
                  : "Запрос входа отменён.",
            "error",
          );
        }
      } catch {
        // A temporary network error must not cancel an active request.
      }
    };

    void checkStatus();

    const timer = window.setInterval(() => {
      if (!stopped) {
        void checkStatus();
      }
    }, 2000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pairing, step, customer]);

  useEffect(() => {
    if (loading || !customer) return;

    const section = new URLSearchParams(window.location.search).get("section");
    if (!section) return;

    window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 150);
  }, [loading, customer]);

  useEffect(() => {
    if (!telegramCode || telegramConnected) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadAccount();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [telegramCode, telegramConnected]);

  async function requestCode(
    event?: React.FormEvent<HTMLFormElement>,
  ) {
    event?.preventDefault();

    if (requestCooldown > 0 || pairingBusy) return;

    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      showMessage("Введите телефон", "error");
      return;
    }

    setPairingBusy(true);

    try {
      const response = await fetch(
        "/api/public/account/auth/pairing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            phone: cleanPhone,
            redirectPath: "/account",
          }),
        },
      );
      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(
            data.message
              || "Не удалось создать запрос входа",
          ),
          "error",
        );
        return;
      }

      const intent: PairingIntent = {
        requestId: String(data.requestId || ""),
        status: String(data.status || "pending"),
        expiresAt: String(data.expiresAt || ""),
        telegramUrl:
          typeof data.telegramUrl === "string"
            ? data.telegramUrl
            : null,
        qrDataUrl:
          typeof data.qrDataUrl === "string"
            ? data.qrDataUrl
            : null,
        manualCode: String(data.manualCode || ""),
        browserProof: String(data.browserProof || ""),
      };

      if (
        !intent.requestId
        || !intent.manualCode
        || !/^[a-f0-9]{48}$/i.test(intent.browserProof)
      ) {
        showMessage(
          "Сервер не вернул данные подтверждения",
          "error",
        );
        return;
      }

      storePairing(intent);
      setPairing(intent);
      setStep("pairing");
      setRequestCooldown(60);
      showMessage(
        "Откройте Telegram и подтвердите вход. Эта страница авторизуется автоматически.",
        "success",
      );
    } catch {
      showMessage(
        "Не удалось связаться с сервером. Повторите попытку.",
        "error",
      );
    } finally {
      setPairingBusy(false);
    }
  }

  async function cancelPairing() {
    const current = pairing;

    if (current) {
      try {
        await fetch(
          `/api/public/account/auth/pairing/${encodeURIComponent(
            current.requestId,
          )}/cancel`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "x-vm-customer-pairing-proof": current.browserProof,
            },
          },
        );
      } catch {
        // The local screen is reset even if the request already expired.
      }
    }

    storePairing(null);
    setPairing(null);
    setStep("phone");
    setRequestCooldown(0);
    showMessage("Запрос входа отменён", "info");
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);

    try {
      const response = await fetch("/api/public/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: profileName.trim(),
          email: profileEmail.trim(),
        }),
      });

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось сохранить профиль"),
          "error",
        );
        return;
      }

      showMessage("Профиль сохранён", "success");
      await loadAccount();
    } catch {
      showMessage("Не удалось сохранить профиль", "error");
    } finally {
      setProfileSaving(false);
    }
  }

  async function createTelegramCode() {
    try {
      const response = await fetch("/api/public/account/telegram-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось создать код Telegram"),
          "error",
        );
        return;
      }

      setTelegramCode(String(data.telegramLinkCode || ""));
      showMessage(
        "Код создан. Откройте Telegram-бота и отправьте его в разделе привязки аккаунта.",
        "success",
      );
    } catch {
      showMessage("Не удалось создать код Telegram", "error");
    }
  }

  async function toggleTelegramNotifications() {
    setTelegramSaving(true);
    const enabled = !telegramNotificationsEnabled;

    try {
      const response = await fetch(
        "/api/public/account/telegram-notifications",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ enabled }),
        },
      );

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось изменить уведомления"),
          "error",
        );
        return;
      }

      setTelegramNotificationsEnabled(enabled);
      showMessage(
        enabled
          ? "Уведомления Telegram включены"
          : "Уведомления Telegram выключены",
        "success",
      );
    } catch {
      showMessage("Не удалось изменить уведомления", "error");
    } finally {
      setTelegramSaving(false);
    }
  }

  async function unlinkTelegram() {
    const confirmed = window.confirm(
      [
        "Отвязать Telegram от профиля?",
        "",
        "Заказы, бонусы, адреса и текущая сессия сайта сохранятся.",
        "Уведомления в этот Telegram больше приходить не будут.",
        "После выхода для нового входа потребуется снова подключить Telegram.",
      ].join("\n"),
    );

    if (!confirmed) return;

    setTelegramSaving(true);

    try {
      const response = await fetch("/api/public/account/telegram-link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: true }),
      });

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось отвязать Telegram"),
          "error",
        );
        return;
      }

      setTelegramConnected(false);
      setTelegramUsername("");
      setTelegramLinkedAt(null);
      setTelegramNotificationsEnabled(false);
      setTelegramCode("");
      showMessage(
        String(
          data.message ||
            "Telegram отвязан. Данные и текущая сессия сайта сохранены.",
        ),
        "success",
      );
      await loadAccount();
    } catch {
      showMessage("Не удалось отвязать Telegram", "error");
    } finally {
      setTelegramSaving(false);
    }
  }

  function startAddressEdit(address: Address) {
    setEditingAddressId(address.id);
    setAddressDraft({
      city: address.city || "",
      street: address.street || "",
      house: address.house || "",
      apartment: address.apartment || "",
      entrance: address.entrance || "",
      floor: address.floor || "",
      comment: address.comment || "",
      isDefault: address.is_default,
    });
  }

  function resetAddressForm() {
    setEditingAddressId(null);
    setAddressDraft({ ...emptyAddress, isDefault: addresses.length === 0 });
  }

  async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddressSaving(true);

    const url = editingAddressId
      ? `/api/public/account/addresses/${editingAddressId}`
      : "/api/public/account/addresses";

    try {
      const response = await fetch(url, {
        method: editingAddressId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(addressDraft),
      });

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось сохранить адрес"),
          "error",
        );
        return;
      }

      showMessage(
        editingAddressId ? "Адрес обновлён" : "Адрес добавлен",
        "success",
      );
      resetAddressForm();
      await loadAccount();
    } catch {
      showMessage("Не удалось сохранить адрес", "error");
    } finally {
      setAddressSaving(false);
    }
  }

  async function makeAddressDefault(address: Address) {
    try {
      const response = await fetch(
        `/api/public/account/addresses/${address.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            city: address.city || "",
            street: address.street || "",
            house: address.house || "",
            apartment: address.apartment || "",
            entrance: address.entrance || "",
            floor: address.floor || "",
            comment: address.comment || "",
            isDefault: true,
          }),
        },
      );

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось выбрать адрес"),
          "error",
        );
        return;
      }

      showMessage("Адрес выбран основным", "success");
      await loadAccount();
    } catch {
      showMessage("Не удалось выбрать основной адрес", "error");
    }
  }

  async function deleteAddress(address: Address) {
    if (!window.confirm(`Удалить адрес «${addressText(address)}»?`)) return;

    try {
      const response = await fetch(
        `/api/public/account/addresses/${address.id}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось удалить адрес"),
          "error",
        );
        return;
      }

      if (editingAddressId === address.id) resetAddressForm();
      showMessage("Адрес удалён", "success");
      await loadAccount();
    } catch {
      showMessage("Не удалось удалить адрес", "error");
    }
  }

  async function repeatOrder(orderNumber: string) {
    setRepeatingOrder(orderNumber);

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
        showMessage(
          String(data.message || "Не удалось повторить заказ"),
          "error",
        );
        return;
      }

      const products = Array.isArray(data.products)
        ? (data.products as RepeatOrderCartProduct[])
        : [];

      const result = addRepeatOrderProducts(products);

      if (result.addedQuantity <= 0) {
        showMessage("Товары из этого заказа сейчас недоступны", "error");
        return;
      }

      const skippedText =
        result.skippedQuantity > 0
          ? ` Недоступные позиции пропущены: ${result.skippedQuantity}.`
          : "";

      showMessage(`Товары добавлены в корзину.${skippedText}`, "success");
      window.setTimeout(() => window.location.assign("/cart"), 500);
    } catch {
      showMessage("Не удалось повторить заказ", "error");
    } finally {
      setRepeatingOrder(null);
    }
  }

  async function revokeSession(session: CustomerSession) {
    const confirmed = window.confirm(
      session.isCurrent
        ? "Завершить текущую сессию? Потребуется войти снова."
        : `Завершить сессию «${session.device}»?`,
    );
    if (!confirmed) return;

    setSessionAction(session.id);

    try {
      const response = await fetch(
        `/api/public/account/sessions/${session.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ confirm: true }),
        },
      );
      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось завершить сессию"),
          "error",
        );
        return;
      }

      if (data.currentRevoked === true) {
        setCustomer(null);
        setSessions([]);
        setSecurityEvents([]);
        setStep("phone");
        showMessage("Текущая сессия завершена", "info");
        return;
      }

      showMessage("Сессия завершена", "success");
      await loadSessions();
    } catch {
      showMessage("Не удалось завершить сессию", "error");
    } finally {
      setSessionAction(null);
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm("Завершить все сессии, кроме текущей?")) return;
    setSessionAction("others");

    try {
      const response = await fetch(
        "/api/public/account/sessions/revoke-others",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ confirm: true }),
        },
      );
      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось завершить сессии"),
          "error",
        );
        return;
      }

      showMessage(
        `Другие сессии завершены: ${Number(data.revokedCount || 0)}`,
        "success",
      );
      await loadSessions();
    } catch {
      showMessage("Не удалось завершить сессии", "error");
    } finally {
      setSessionAction(null);
    }
  }

  async function revokeAllSessions() {
    if (!window.confirm("Выйти со всех устройств, включая это?")) return;
    setSessionAction("all");

    try {
      const response = await fetch(
        "/api/public/account/sessions/revoke-all",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ confirm: true }),
        },
      );
      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        showMessage(
          String(data.message || "Не удалось завершить сессии"),
          "error",
        );
        return;
      }

      setCustomer(null);
      setSessions([]);
      setSecurityEvents([]);
      setPairing(null);
      setStep("phone");
      showMessage("Вы вышли со всех устройств", "info");
    } catch {
      showMessage("Не удалось завершить сессии", "error");
    } finally {
      setSessionAction(null);
    }
  }

  async function logout() {
    await fetch("/api/public/account/logout", {
      method: "POST",
      credentials: "include",
    });

    setCustomer(null);
    setOrders([]);
    setBonuses([]);
    setAddresses([]);
    setTelegramConnected(false);
    setTelegramNotificationsEnabled(false);
    setTelegramCode("");
    setSessions([]);
    setSecurityEvents([]);
    setPairing(null);
    setStep("phone");
    showMessage("Вы вышли из личного кабинета", "info");
  }

  if (loading) {
    return (
      <div className="account-page">
        <section className="account-card">
          <p>Загружаем профиль…</p>
        </section>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="account-page">
        <section className="account-card account-login">
          <div className="account-heading">
            <p className="eyebrow">Личный кабинет</p>
            <h1>Вход по телефону</h1>
            <p>
              Введите номер, откройте Telegram и подтвердите вход.
              Первый заказ для регистрации больше не требуется.
            </p>
          </div>

          {step === "phone" ? (
            <form onSubmit={requestCode} className="account-form">
              <label>
                <span>Телефон</span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+7 999 000-00-00"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={32}
                />
              </label>

              <button type="submit" disabled={pairingBusy}>
                {pairingBusy
                  ? "Создаём запрос…"
                  : "Продолжить через Telegram"}
              </button>
            </form>
          ) : pairing ? (
            <div className="account-pairing">
              <div className="account-pairing-status">
                <span className="account-pairing-pulse" />
                <div>
                  <strong>Ожидаем подтверждение в Telegram</strong>
                  <p>
                    После подтверждения личный кабинет откроется
                    автоматически.
                  </p>
                </div>
              </div>

              {pairing.telegramUrl ? (
                <a
                  className="account-pairing-primary"
                  href={pairing.telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть Telegram
                </a>
              ) : (
                <p className="account-pairing-note">
                  Откройте бот «Выбери Меня» вручную и введите код ниже.
                </p>
              )}

              {pairing.qrDataUrl ? (
                <div className="account-pairing-qr">
                  <img
                    src={pairing.qrDataUrl}
                    alt="QR-код для открытия Telegram"
                  />
                  <span>
                    Отсканируйте, если Telegram открыт на другом
                    устройстве
                  </span>
                </div>
              ) : null}

              <div className="account-pairing-code">
                <span>Резервный код</span>
                <strong>
                  {pairing.manualCode.slice(0, 3)}{" "}
                  {pairing.manualCode.slice(3)}
                </strong>
                <small>
                  В боте: «☰ Ещё» → «Привязать аккаунт»
                </small>
              </div>

              <p className="account-pairing-security">
                Номер Telegram должен совпасть с введённым на сайте.
                Запрос действует 10 минут и используется один раз.
              </p>

              <button
                type="button"
                className="ghost-button account-pairing-cancel"
                onClick={() => void cancelPairing()}
              >
                Отменить и изменить телефон
              </button>
            </div>
          ) : null}

          {message ? (
            <p className={`account-message ${messageKind}`}>{message}</p>
          ) : null}

          <div className="account-login-help">
            <strong>Ещё не оформляли заказ?</strong>
            <p>
              Это не мешает входу. Мы создадим профиль после
              подтверждения номера в Telegram.
            </p>
            <a href="/catalog">Можно сначала посмотреть каталог</a>
          </div>

          <div className="account-auth-providers">
            <span>Другие способы входа</span>
            <p>
              Яндекс ID, Сбер ID, email, MAX и passkey будут
              подключаться к этому же профилю без дублирования
              заказов и бонусов.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="account-page">
      <section className="account-hero">
        <div>
          <p className="eyebrow">Личный кабинет</p>
          <h1>{customer.name || "Покупатель"}</h1>
          <p>{customer.phone}</p>
        </div>

        <button type="button" onClick={() => void logout()}>
          Выйти
        </button>
      </section>

      {message ? (
        <p className={`account-message account-global-message ${messageKind}`}>
          {message}
        </p>
      ) : null}

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

      <section className="account-card" id="profile">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">Профиль</p>
            <h2>Контактные данные</h2>
          </div>
          <span>Телефон используется для безопасного входа</span>
        </div>

        <form className="account-profile-form" onSubmit={saveProfile}>
          <label>
            <span>Имя</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              minLength={2}
              maxLength={160}
              autoComplete="name"
              required
            />
          </label>
          <label>
            <span>Телефон</span>
            <input value={customer.phone} readOnly aria-readonly="true" />
          </label>
          <label>
            <span>Email</span>
            <input
              value={profileEmail}
              onChange={(event) => setProfileEmail(event.target.value)}
              type="email"
              maxLength={255}
              autoComplete="email"
              placeholder="Для чеков и уведомлений"
            />
          </label>
          <button type="submit" disabled={profileSaving}>
            {profileSaving ? "Сохраняем…" : "Сохранить профиль"}
          </button>
        </form>
      </section>

      {telegramConnected ? (
        <section className="account-card account-telegram-card is-connected">
          <div className="account-telegram-connected">
            <div className="account-telegram-connected-icon">✓</div>
            <div>
              <h2>Telegram подключён</h2>
              <p>
                {telegramUsername ? `@${telegramUsername} · ` : ""}
                Получайте уведомления о подтверждении, сборке и доставке заказа.
              </p>
              {telegramLinkedAt ? (
                <small>Подключён {dateText(telegramLinkedAt)}</small>
              ) : null}
            </div>
          </div>

          <label className="account-notification-toggle">
            <span>
              <strong>Уведомления по заказам</strong>
              <small>
                {telegramNotificationsEnabled ? "Включены" : "Выключены"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={telegramNotificationsEnabled}
              disabled={telegramSaving}
              onChange={() => void toggleTelegramNotifications()}
            />
          </label>

          <div className="account-telegram-unlink-row">
            <div>
              <strong>Сменить Telegram</strong>
              <small>
                Сначала отвяжите текущий аккаунт, затем подключите новый кодом.
              </small>
            </div>
            <button
              type="button"
              className="account-danger-button"
              disabled={telegramSaving}
              onClick={() => void unlinkTelegram()}
            >
              {telegramSaving ? "Отключаем…" : "Отвязать Telegram"}
            </button>
          </div>
        </section>
      ) : (
        <section className="account-card">
          <h2>Подключить Telegram</h2>
          <p>Telegram нужен для кодов входа и уведомлений по заказам.</p>
          <button type="button" onClick={() => void createTelegramCode()}>
            Сгенерировать код Telegram
          </button>
          {telegramCode ? (
            <div className="account-telegram-code">
              <span>Код для бота</span>
              <strong>{telegramCode}</strong>
              <p>Код действует 30 минут и используется один раз.</p>
            </div>
          ) : null}
        </section>
      )}

      <section className="account-card account-security-card" id="security">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">Безопасность</p>
            <h2>Активные устройства</h2>
          </div>
          <span>Не более 5 активных сессий</span>
        </div>

        <div className="account-security-actions">
          <button
            type="button"
            disabled={sessionAction !== null || sessions.length <= 1}
            onClick={() => void revokeOtherSessions()}
          >
            {sessionAction === "others"
              ? "Завершаем…"
              : "Завершить другие"}
          </button>
          <button
            type="button"
            className="account-danger-button"
            disabled={sessionAction !== null}
            onClick={() => void revokeAllSessions()}
          >
            {sessionAction === "all"
              ? "Выходим…"
              : "Выйти со всех устройств"}
          </button>
        </div>

        {sessionsLoading ? (
          <p>Проверяем активные устройства…</p>
        ) : sessions.length ? (
          <div className="account-session-list">
            {sessions.map((session) => (
              <article
                key={session.id}
                className={`account-session-item ${session.isCurrent ? "is-current" : ""}`}
              >
                <div>
                  <strong>{session.device}</strong>
                  <span>
                    {session.isCurrent ? "Текущее устройство · " : ""}
                    активность {dateText(session.lastSeenAt || session.createdAt)}
                  </span>
                  <small>
                    {session.ip ? `IP: ${session.ip} · ` : ""}
                    действует до {dateText(session.expiresAt)}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={sessionAction !== null}
                  onClick={() => void revokeSession(session)}
                >
                  {sessionAction === session.id
                    ? "Завершаем…"
                    : session.isCurrent
                      ? "Выйти"
                      : "Завершить"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p>Активные сессии не найдены.</p>
        )}

        {securityEvents.length ? (
          <details className="account-security-events">
            <summary>Последние события безопасности</summary>
            <div>
              {securityEvents.map((event, index) => (
                <p key={`${event.createdAt}-${index}`}>
                  <strong>{event.summary}</strong>
                  <span>{dateText(event.createdAt)}</span>
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="account-card" id="addresses">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">Адресная книга</p>
            <h2>Адреса доставки</h2>
          </div>
          <span>До 20 сохранённых адресов</span>
        </div>

        {addresses.length ? (
          <div className="account-address-list">
            {addresses.map((address) => (
              <article
                key={address.id}
                className={`account-address-card ${address.is_default ? "is-default" : ""}`}
              >
                <div>
                  <div className="account-address-title">
                    <strong>{addressText(address) || "Адрес"}</strong>
                    {address.is_default ? <span>Основной</span> : null}
                  </div>
                  <p>
                    {[
                      address.entrance ? `подъезд ${address.entrance}` : "",
                      address.floor ? `этаж ${address.floor}` : "",
                    ]
                      .filter(Boolean)
                      .join(", ") || "Дополнительные детали не указаны"}
                  </p>
                  {address.comment ? <small>{address.comment}</small> : null}
                </div>

                <div className="account-address-actions">
                  {!address.is_default ? (
                    <button
                      type="button"
                      onClick={() => void makeAddressDefault(address)}
                    >
                      Сделать основным
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => startAddressEdit(address)}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void deleteAddress(address)}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>Сохранённых адресов пока нет.</p>
        )}

        <form className="account-address-form" onSubmit={saveAddress}>
          <div className="account-address-form-heading">
            <h3>
              {editingAddressId ? "Редактировать адрес" : "Добавить адрес"}
            </h3>
            {editingAddressId ? (
              <button type="button" onClick={resetAddressForm}>
                Отменить редактирование
              </button>
            ) : null}
          </div>

          <div className="account-address-fields">
            <label>
              <span>Город *</span>
              <input
                value={addressDraft.city}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    city: event.target.value,
                  }))
                }
                maxLength={120}
                required
              />
            </label>
            <label className="wide">
              <span>Улица *</span>
              <input
                value={addressDraft.street}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    street: event.target.value,
                  }))
                }
                maxLength={255}
                required
              />
            </label>
            <label>
              <span>Дом *</span>
              <input
                value={addressDraft.house}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    house: event.target.value,
                  }))
                }
                maxLength={60}
                required
              />
            </label>
            <label>
              <span>Квартира</span>
              <input
                value={addressDraft.apartment}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    apartment: event.target.value,
                  }))
                }
                maxLength={60}
              />
            </label>
            <label>
              <span>Подъезд</span>
              <input
                value={addressDraft.entrance}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    entrance: event.target.value,
                  }))
                }
                maxLength={60}
              />
            </label>
            <label>
              <span>Этаж</span>
              <input
                value={addressDraft.floor}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    floor: event.target.value,
                  }))
                }
                maxLength={60}
              />
            </label>
            <label className="wide">
              <span>Комментарий</span>
              <textarea
                value={addressDraft.comment}
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    comment: event.target.value,
                  }))
                }
                maxLength={500}
                placeholder="Домофон, ориентир или важная информация"
              />
            </label>
            <label className="account-default-address wide">
              <input
                type="checkbox"
                checked={
                  addressDraft.isDefault ||
                  (addresses.length === 0 && !editingAddressId)
                }
                onChange={(event) =>
                  setAddressDraft((draft) => ({
                    ...draft,
                    isDefault: event.target.checked,
                  }))
                }
              />
              <span>Использовать как основной адрес</span>
            </label>
          </div>

          <button type="submit" disabled={addressSaving}>
            {addressSaving
              ? "Сохраняем…"
              : editingAddressId
                ? "Сохранить изменения"
                : "Добавить адрес"}
          </button>
        </form>
      </section>

      <section className="account-card" id="orders">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">История</p>
            <h2>Мои заказы</h2>
          </div>
          <a href="/orders">Открыть все заказы</a>
        </div>

        {orders.length ? (
          <div className="account-list">
            {orders.slice(0, 6).map((order) => (
              <article
                key={order.order_number}
                className="account-list-item account-order-item account-order-item-polished"
              >
                <div className="account-order-main">
                  {order.tracking_token ? (
                    <a
                      href={`/order/track/${order.tracking_token}`}
                      className="account-order-link"
                    >
                      {order.order_number}
                    </a>
                  ) : (
                    <strong>{order.order_number}</strong>
                  )}
                  <span>
                    {dateText(order.created_at)} · {order.items_count || 0} поз.
                  </span>
                  {order.item_names?.length ? (
                    <small>{order.item_names.join(", ")}</small>
                  ) : null}
                  <div className="account-order-delivery">
                    <span>
                      {order.delivery_type === "pickup" ? "Самовывоз" : "Доставка"}
                    </span>
                    <span>{deliveryDateText(order.delivery_date)}</span>
                    {order.delivery_type !== "pickup" ? (
                      <span>{order.delivery_interval || "Интервал уточняется"}</span>
                    ) : null}
                  </div>
                  {order.bouquet_photo_url ? (
                    <div className="account-order-bouquet">
                      <CustomerPhotoViewer
                        src={order.bouquet_photo_url}
                        alt={`Фото готового букета ${order.order_number}`}
                      />
                      <div>
                        <strong>Фото готового букета</strong>
                        <span>{bouquetApprovalText(order.bouquetApproval.status)}</span>
                        {order.tracking_token ? (
                          <>
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
                            <a href={`/order/track/${order.tracking_token}`}>
                              Открыть заказ полностью
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="account-order-progress">
                    <span
                      style={{
                        width: `${orderProgressPercent(order.status, order.payment_status)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="account-order-statuses">
                  <span>
                    {orderProgressLabel(order.status, order.payment_status)}
                  </span>
                  <small>{paymentText(order.payment_status)}</small>
                </div>

                <div className="account-order-total-actions">
                  <strong>{money(order.total)}</strong>
                  <button
                    type="button"
                    disabled={repeatingOrder === order.order_number}
                    onClick={() => void repeatOrder(order.order_number)}
                  >
                    {repeatingOrder === order.order_number
                      ? "Добавляем…"
                      : "Повторить"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="account-empty-state">
            <p>Заказов пока нет.</p>
            <a href="/catalog">Выбрать букет</a>
          </div>
        )}
      </section>

      <section className="account-card" id="bonuses">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">Лояльность</p>
            <h2>История бонусов</h2>
          </div>
          <span>Баланс: {money(customer.bonus_balance)}</span>
        </div>

        {bonuses.length ? (
          <div className="account-list">
            {bonuses.map((bonus, index) => (
              <article
                key={`${bonus.created_at}-${index}`}
                className="account-list-item account-bonus-item"
              >
                <div>
                  <strong>
                    {bonus.amount > 0 ? "+" : ""}
                    {bonus.amount}
                  </strong>
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

      {defaultAddressId ? (
        <span className="sr-only">Основной адрес настроен</span>
      ) : null}
    </div>
  );
}
