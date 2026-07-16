"use client";

import { useState } from "react";

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export function OrderFinanceActions({
  orderId,
  orderNumber,
  orderStatus,
  paymentStatus,
  total,
  canRefund
}: {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  total: number;
  canRefund: boolean;
}) {
  const isDelivered = orderStatus === "delivered";
  const isCancelled = orderStatus === "cancelled";
  const [reason, setReason] = useState("");
  const cancelOrder = !isDelivered && !isCancelled;
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (paymentStatus === "refunded") {
    return (
      <div className="admin-order-finance-state success">
        <strong>Полный возврат зафиксирован</strong>
        <p>Платёж исключён из оплаченной выручки, бонусы и промокод скорректированы.</p>
      </div>
    );
  }

  if (paymentStatus !== "paid") {
    return (
      <div className="admin-order-finance-state">
        <strong>Возврат пока недоступен</strong>
        <p>Полный возврат можно зафиксировать только после подтверждения оплаты.</p>
      </div>
    );
  }

  if (!canRefund) {
    return (
      <div className="admin-order-finance-state warning">
        <strong>Требуется владелец или администратор</strong>
        <p>Менеджер видит финансовую историю, но не может фиксировать возврат.</p>
      </div>
    );
  }

  async function submitRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanReason = reason.trim();

    if (cleanReason.length < 5) {
      setError("Укажите причину возврата не короче 5 символов");
      return;
    }

    const confirmed = window.confirm(
      [
        `Зафиксировать полный возврат по заказу ${orderNumber} на сумму ${money(total)}?`,
        "",
        "Важно: CRM зафиксирует возврат в учёте, скорректирует бонусы и промокод.",
        "Сам денежный перевод клиенту до подключения платёжного провайдера выполняется отдельно.",
        cancelOrder ? "Заказ также будет отменён." : "Статус заказа останется без изменения."
      ].join("\n")
    );

    if (!confirmed) return;

    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reason: cleanReason,
          cancelOrder
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || "Не удалось зафиксировать возврат");
      }

      window.location.reload();
    } catch (refundError) {
      setError(
        refundError instanceof Error
          ? refundError.message
          : "Не удалось зафиксировать возврат"
      );
      setIsSaving(false);
    }
  }

  return (
    <form className="admin-order-refund-form" onSubmit={submitRefund}>
      <div className="admin-order-refund-warning">
        <strong>Полный ручной возврат: {money(total)}</strong>
        <p>
          Сначала фактически верните деньги клиенту согласованным способом, затем зафиксируйте операцию здесь.
          Частичные возвраты будут добавлены вместе с платёжным провайдером, чтобы не нарушить учёт.
        </p>
      </div>

      <label>
        <span>Причина возврата</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Например: отмена по просьбе покупателя, товар не может быть выполнен"
        />
      </label>

      {!isDelivered && !isCancelled ? (
        <p className="admin-order-refund-help">
          Активный заказ будет автоматически отменён, а зарезервированные товары вернутся на склад.
        </p>
      ) : null}

      {isDelivered ? (
        <p className="admin-order-refund-help">
          Доставленный заказ останется в статусе «Доставлен», а финансовый статус изменится на «Возврат».
        </p>
      ) : null}

      {error ? <p className="admin-order-refund-error">{error}</p> : null}

      <button type="submit" className="admin-action-button danger" disabled={isSaving}>
        {isSaving ? "Фиксируем…" : "Зафиксировать полный возврат"}
      </button>
    </form>
  );
}
