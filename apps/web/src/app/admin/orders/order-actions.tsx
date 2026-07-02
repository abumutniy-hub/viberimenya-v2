"use client";

import { useState } from "react";

export function OrderActions({
  orderId,
  status,
  paymentStatus
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const canMarkPaid = status !== "new" && status !== "cancelled" && paymentStatus !== "paid";

  async function confirmOrder() {
    const confirmed = window.confirm("Подтвердить заказ?");
    if (!confirmed) return;

    setIsConfirming(true);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Не удалось подтвердить заказ");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось подтвердить заказ");
      setIsConfirming(false);
    }
  }

  async function markPaid() {
    const confirmed = window.confirm("Отметить заказ как оплаченный и начислить бонусы?");
    if (!confirmed) return;

    setIsPaying(true);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Не удалось обновить заказ");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось обновить заказ");
      setIsPaying(false);
    }
  }

  return (
    <div className="admin-order-actions">
      {status === "new" ? (
        <button
          type="button"
          className="admin-action-button"
          disabled={isConfirming}
          onClick={confirmOrder}
        >
          {isConfirming ? "..." : "Подтвердить"}
        </button>
      ) : (
        <span className="admin-status-badge">{status === "confirmed" ? "Подтверждён" : status}</span>
      )}

      {paymentStatus === "paid" ? (
        <span className="admin-paid-badge">Оплачен</span>
      ) : canMarkPaid ? (
        <button
          type="button"
          className="admin-action-button secondary"
          disabled={isPaying}
          onClick={markPaid}
        >
          {isPaying ? "..." : "Оплачен"}
        </button>
      ) : (
        <span className="admin-muted-badge">Оплата после подтверждения</span>
      )}
    </div>
  );
}
