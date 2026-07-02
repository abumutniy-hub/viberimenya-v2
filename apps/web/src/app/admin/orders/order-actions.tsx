"use client";

import { useState } from "react";

export function OrderActions({
  orderId,
  paymentStatus
}: {
  orderId: string;
  paymentStatus: string;
}) {
  const [isLoading, setIsLoading] = useState(false);

  if (paymentStatus === "paid") {
    return <span className="admin-paid-badge">Оплачен</span>;
  }

  return (
    <button
      type="button"
      className="admin-action-button"
      disabled={isLoading}
      onClick={async () => {
        const confirmed = window.confirm("Отметить заказ как оплаченный и начислить бонусы?");
        if (!confirmed) return;

        setIsLoading(true);

        try {
          const response = await fetch(`/api/admin/orders/${orderId}/mark-paid`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: "{}"
          });

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || "Не удалось обновить заказ");
          }

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Не удалось обновить заказ");
          setIsLoading(false);
        }
      }}
    >
      {isLoading ? "..." : "Оплачен"}
    </button>
  );
}
