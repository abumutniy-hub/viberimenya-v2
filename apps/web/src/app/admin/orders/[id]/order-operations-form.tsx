"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type OrderDeliveryZoneOption = {
  id: string;
  name: string;
  price: number;
  freeFromAmount: number | null;
  isExpressAvailable: boolean;
  expressPrice: number | null;
  isActive: boolean;
};

export type OrderDeliveryIntervalOption = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

type InitialOrderOperations = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  recipientName: string;
  recipientPhone: string;
  contactPreference: "call_or_message" | "phone_call" | "messenger_only";
  isSurprise: boolean;
  doNotCallRecipient: boolean;
  cardText: string;
  customerComment: string;
  deliveryType: "delivery" | "pickup";
  deliveryService: "standard" | "express";
  deliveryZoneId: string;
  deliveryIntervalId: string;
  deliveryDate: string;
  deliveryAddress: string;
  deliveryComment: string;
};

type Props = {
  orderId: string;
  disabled: boolean;
  disabledReason: string;
  paymentStatus: string;
  subtotal: number;
  discountTotal: number;
  bonusSpent: number;
  currentDeliveryPrice: number;
  initial: InitialOrderOperations;
  zones: OrderDeliveryZoneOption[];
  intervals: OrderDeliveryIntervalOption[];
  pickupEnabled: boolean;
  pickupAddress: string;
};

type ApiResponse = {
  ok?: boolean;
  changed?: boolean;
  total?: number;
  message?: string;
};

function money(value: number) {
  return `${Math.max(0, Math.round(value)).toLocaleString("ru-RU")} ₽`;
}

function validPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function OrderOperationsForm({
  orderId,
  disabled,
  disabledReason,
  paymentStatus,
  subtotal,
  discountTotal,
  bonusSpent,
  currentDeliveryPrice,
  initial,
  zones,
  intervals,
  pickupEnabled,
  pickupAddress
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<InitialOrderOperations>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const minDeliveryDate = useMemo(() => dateInputValue(new Date()), []);
  const maxDeliveryDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 90);
    return dateInputValue(date);
  }, []);

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.id === form.deliveryZoneId) ?? null,
    [form.deliveryZoneId, zones]
  );

  const calculatedDeliveryPrice = useMemo(() => {
    if (form.deliveryType === "pickup") return 0;
    if (!selectedZone) return currentDeliveryPrice;

    if (form.deliveryService === "express") {
      return Math.max(0, Number(selectedZone.expressPrice || 0));
    }

    const freeFromAmount = Math.max(0, Number(selectedZone.freeFromAmount || 0));

    if (freeFromAmount > 0 && subtotal >= freeFromAmount) {
      return 0;
    }

    return Math.max(0, Number(selectedZone.price || 0));
  }, [currentDeliveryPrice, form.deliveryService, form.deliveryType, selectedZone, subtotal]);

  const calculatedTotal = Math.max(
    0,
    subtotal - discountTotal - bonusSpent + calculatedDeliveryPrice
  );

  function update<K extends keyof InitialOrderOperations>(
    key: K,
    value: InitialOrderOperations[K]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  }

  function switchDeliveryType(value: "delivery" | "pickup") {
    if (value === "pickup" && !pickupEnabled) return;

    setForm((current) => ({
      ...current,
      deliveryType: value,
      deliveryService: value === "pickup" ? "standard" : current.deliveryService,
      deliveryAddress:
        value === "pickup"
          ? pickupAddress
          : current.deliveryType === "pickup"
            ? ""
            : current.deliveryAddress
    }));
    setMessage("");
    setError("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled || isSaving) return;

    if (form.customerName.trim().length < 2) {
      setError("Укажите имя покупателя");
      return;
    }

    if (!validPhone(form.customerPhone)) {
      setError("Укажите корректный телефон покупателя");
      return;
    }

    if (form.customerEmail && !/^\S+@\S+\.\S+$/.test(form.customerEmail)) {
      setError("Проверьте email покупателя");
      return;
    }

    if (form.recipientName.trim().length < 2) {
      setError("Укажите имя получателя");
      return;
    }

    if (!validPhone(form.recipientPhone)) {
      setError("Укажите корректный телефон получателя");
      return;
    }

    if (form.deliveryType === "delivery") {
      if (!form.deliveryZoneId) {
        setError("Выберите зону доставки");
        return;
      }

      if (!form.deliveryIntervalId) {
        setError("Выберите интервал доставки");
        return;
      }

      if (!form.deliveryDate) {
        setError("Укажите дату доставки");
        return;
      }

      if (form.deliveryAddress.trim().length < 5) {
        setError("Укажите полный адрес доставки");
        return;
      }

      if (
        form.deliveryService === "express"
        && (!selectedZone?.isExpressAvailable || Number(selectedZone.expressPrice || 0) <= 0)
      ) {
        setError("Срочная доставка недоступна для выбранной зоны");
        return;
      }
    }

    if (
      paymentStatus === "paid"
      && calculatedTotal !== subtotal - discountTotal - bonusSpent + currentDeliveryPrice
    ) {
      setError("Нельзя менять итоговую сумму уже оплаченного заказа");
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/operations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const data = (await response.json().catch(() => null)) as ApiResponse | null;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || "Не удалось сохранить данные заказа");
      }

      setMessage(data.changed === false ? "Изменений нет" : "Данные заказа сохранены");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Не удалось сохранить данные заказа"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="admin-order-operations-form" onSubmit={save}>
      {disabled ? (
        <div className="admin-order-form-lock">
          <strong>Редактирование закрыто</strong>
          <span>{disabledReason}</span>
        </div>
      ) : null}

      <div className="admin-order-form-section">
        <div className="admin-order-form-section-head">
          <span>Покупатель</span>
          <small>Контакты, по которым менеджер подтверждает заказ</small>
        </div>

        <div className="admin-order-form-grid three">
          <label>
            <span>Имя покупателя</span>
            <input
              value={form.customerName}
              maxLength={160}
              disabled={disabled}
              onChange={(event) => update("customerName", event.target.value)}
            />
          </label>

          <label>
            <span>Телефон покупателя</span>
            <input
              value={form.customerPhone}
              maxLength={32}
              inputMode="tel"
              disabled={disabled}
              onChange={(event) => update("customerPhone", event.target.value)}
            />
          </label>

          <label>
            <span>Email</span>
            <input
              value={form.customerEmail}
              maxLength={255}
              inputMode="email"
              disabled={disabled}
              onChange={(event) => update("customerEmail", event.target.value)}
            />
          </label>
        </div>

        <label className="admin-order-form-field compact">
          <span>Предпочтительный способ связи</span>
          <select
            value={form.contactPreference}
            disabled={disabled}
            onChange={(event) => update(
              "contactPreference",
              event.target.value as InitialOrderOperations["contactPreference"]
            )}
          >
            <option value="call_or_message">Позвонить или написать</option>
            <option value="phone_call">Только звонок</option>
            <option value="messenger_only">Только сообщение</option>
          </select>
        </label>
      </div>

      <div className="admin-order-form-section">
        <div className="admin-order-form-section-head">
          <span>Получатель и открытка</span>
          <small>Эти данные увидит курьер только после назначения</small>
        </div>

        <div className="admin-order-form-grid two">
          <label>
            <span>Имя получателя</span>
            <input
              value={form.recipientName}
              maxLength={160}
              disabled={disabled}
              onChange={(event) => update("recipientName", event.target.value)}
            />
          </label>

          <label>
            <span>Телефон получателя</span>
            <input
              value={form.recipientPhone}
              maxLength={32}
              inputMode="tel"
              disabled={disabled}
              onChange={(event) => update("recipientPhone", event.target.value)}
            />
          </label>
        </div>

        <div className="admin-order-form-checks">
          <label>
            <input
              type="checkbox"
              checked={form.isSurprise}
              disabled={disabled}
              onChange={(event) => update("isSurprise", event.target.checked)}
            />
            <span>Заказ-сюрприз</span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.doNotCallRecipient}
              disabled={disabled}
              onChange={(event) => update("doNotCallRecipient", event.target.checked)}
            />
            <span>Не звонить получателю</span>
          </label>
        </div>

        <label className="admin-order-form-field">
          <span>Текст открытки</span>
          <textarea
            value={form.cardText}
            maxLength={500}
            rows={3}
            disabled={disabled}
            placeholder="Текст, который нужно вложить в заказ"
            onChange={(event) => update("cardText", event.target.value)}
          />
        </label>
      </div>

      <div className="admin-order-form-section">
        <div className="admin-order-form-section-head">
          <span>Получение заказа</span>
          <small>Стоимость пересчитывается на сервере по актуальным тарифам</small>
        </div>

        <div className="admin-order-delivery-type-switch">
          <button
            type="button"
            className={form.deliveryType === "delivery" ? "is-active" : ""}
            disabled={disabled}
            onClick={() => switchDeliveryType("delivery")}
          >
            Доставка
          </button>

          <button
            type="button"
            className={form.deliveryType === "pickup" ? "is-active" : ""}
            disabled={disabled || !pickupEnabled}
            title={!pickupEnabled ? "Самовывоз отключён в настройках" : ""}
            onClick={() => switchDeliveryType("pickup")}
          >
            Самовывоз
          </button>
        </div>

        {form.deliveryType === "delivery" ? (
          <>
            <div className="admin-order-form-grid three">
              <label>
                <span>Зона</span>
                <select
                  value={form.deliveryZoneId}
                  disabled={disabled}
                  onChange={(event) => {
                    update("deliveryZoneId", event.target.value);
                    const zone = zones.find((item) => item.id === event.target.value);

                    if (!zone?.isExpressAvailable && form.deliveryService === "express") {
                      update("deliveryService", "standard");
                    }
                  }}
                >
                  <option value="">Выберите зону</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}{zone.isActive ? "" : " · отключена"}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Дата</span>
                <input
                  type="date"
                  value={form.deliveryDate}
                  min={minDeliveryDate}
                  max={maxDeliveryDate}
                  disabled={disabled}
                  onChange={(event) => update("deliveryDate", event.target.value)}
                />
              </label>

              <label>
                <span>Интервал</span>
                <select
                  value={form.deliveryIntervalId}
                  disabled={disabled}
                  onChange={(event) => update("deliveryIntervalId", event.target.value)}
                >
                  <option value="">Выберите интервал</option>
                  {intervals.map((interval) => (
                    <option key={interval.id} value={interval.id}>
                      {interval.name}{interval.isActive ? "" : " · отключён"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="admin-order-form-checks tariff">
              <label>
                <input
                  type="radio"
                  name={`delivery-service-${orderId}`}
                  checked={form.deliveryService === "standard"}
                  disabled={disabled}
                  onChange={() => update("deliveryService", "standard")}
                />
                <span>Обычная доставка</span>
              </label>

              <label className={!selectedZone?.isExpressAvailable ? "is-disabled" : ""}>
                <input
                  type="radio"
                  name={`delivery-service-${orderId}`}
                  checked={form.deliveryService === "express"}
                  disabled={disabled || !selectedZone?.isExpressAvailable}
                  onChange={() => update("deliveryService", "express")}
                />
                <span>Срочная доставка</span>
              </label>
            </div>

            <label className="admin-order-form-field">
              <span>Адрес доставки</span>
              <textarea
                value={form.deliveryAddress}
                maxLength={1000}
                rows={3}
                disabled={disabled}
                placeholder="Город, улица, дом, квартира, подъезд и домофон"
                onChange={(event) => update("deliveryAddress", event.target.value)}
              />
            </label>
          </>
        ) : (
          <div className="admin-order-pickup-preview">
            <strong>Адрес самовывоза</strong>
            <span>{pickupAddress || "Адрес пока не указан в настройках магазина"}</span>
          </div>
        )}

        <label className="admin-order-form-field">
          <span>{form.deliveryType === "pickup" ? "Комментарий к выдаче" : "Комментарий курьеру"}</span>
          <textarea
            value={form.deliveryComment}
            maxLength={1000}
            rows={3}
            disabled={disabled}
            placeholder={
              form.deliveryType === "pickup"
                ? "Например: позвонить, когда заказ будет готов"
                : "Подъезд, этаж, домофон, ориентир, особые условия"
            }
            onChange={(event) => update("deliveryComment", event.target.value)}
          />
        </label>
      </div>

      <div className="admin-order-form-section">
        <div className="admin-order-form-section-head">
          <span>Комментарий клиента</span>
          <small>Пожелания к букету и заказу</small>
        </div>

        <label className="admin-order-form-field">
          <textarea
            value={form.customerComment}
            maxLength={2000}
            rows={4}
            disabled={disabled}
            onChange={(event) => update("customerComment", event.target.value)}
          />
        </label>
      </div>

      <div className="admin-order-form-summary">
        <div>
          <span>Товары</span>
          <strong>{money(subtotal)}</strong>
        </div>
        <div>
          <span>Доставка после пересчёта</span>
          <strong>{calculatedDeliveryPrice > 0 ? money(calculatedDeliveryPrice) : "Бесплатно"}</strong>
        </div>
        <div>
          <span>Новый итог</span>
          <strong>{money(calculatedTotal)}</strong>
        </div>
      </div>

      {paymentStatus === "paid" ? (
        <p className="admin-order-form-warning">
          Заказ оплачен: контакты, адрес и время можно уточнить, но итоговая сумма не должна измениться.
        </p>
      ) : null}

      {error ? <p className="admin-order-form-error">{error}</p> : null}
      {message ? <p className="admin-order-form-success">{message}</p> : null}

      <button
        type="submit"
        className="admin-order-form-save"
        disabled={disabled || isSaving}
      >
        {isSaving ? "Сохраняем…" : "Сохранить данные заказа"}
      </button>
    </form>
  );
}
