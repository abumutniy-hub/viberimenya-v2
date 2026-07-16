"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function operationKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-" + Date.now().toString().padStart(12, "0").slice(-12);
}

export function BonusAdjustmentForm({ customerId, balance }: { customerId: string; balance: number }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useMemo(operationKey, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (direction === "remove" && Number(amount) > balance) {
      setError("Нельзя списать больше доступного баланса.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/customers/${customerId}/bonus-adjust`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount: Number(amount), reason, idempotencyKey: key })
      });
      const data = await response.json().catch(() => null) as { message?: string; balanceAfter?: number } | null;
      if (!response.ok) throw new Error(data?.message || "Не удалось изменить бонусы");
      setMessage(`Готово. Новый внутренний баланс: ${Number(data?.balanceAfter || 0).toLocaleString("ru-RU")} ₽.`);
      setAmount("");
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить бонусы");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-bonus-adjust-form" onSubmit={submit}>
      <div className="admin-bonus-mode">
        <button type="button" className={direction === "add" ? "active" : ""} onClick={() => setDirection("add")}>Начислить</button>
        <button type="button" className={direction === "remove" ? "active danger" : ""} onClick={() => setDirection("remove")}>Списать</button>
      </div>
      <label><span>Сумма, ₽</span><input type="number" min="1" max="1000000" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label><span>Обязательная причина</span><textarea minLength={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: компенсация за задержку доставки" /></label>
      <p className="admin-growth-help">Операция записывается в историю. Повторный запрос с тем же ключом не изменит баланс второй раз.</p>
      {error ? <p className="admin-form-error">{error}</p> : null}
      {message ? <p className="admin-form-success">{message}</p> : null}
      <button className={direction === "remove" ? "danger-button" : ""} type="submit" disabled={busy}>{busy ? "Сохраняем…" : direction === "add" ? "Начислить бонусы" : "Списать бонусы"}</button>
    </form>
  );
}
