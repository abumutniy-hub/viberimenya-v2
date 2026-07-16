"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Promo = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_amount: number | null;
  usage_limit: number | null;
  used_count: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  runtime_status: string;
};

type FormState = {
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  minOrderAmount: string;
  usageLimit: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function emptyState(): FormState {
  return {
    code: "",
    description: "",
    discountType: "percent",
    discountValue: "10",
    minOrderAmount: "",
    usageLimit: "",
    startsAt: "",
    endsAt: "",
    isActive: true
  };
}

function fromPromo(item: Promo): FormState {
  return {
    code: item.code,
    description: item.description || "",
    discountType: item.discount_type,
    discountValue: String(item.discount_value),
    minOrderAmount: item.min_order_amount === null ? "" : String(item.min_order_amount),
    usageLimit: item.usage_limit === null ? "" : String(item.usage_limit),
    startsAt: localDateTime(item.starts_at),
    endsAt: localDateTime(item.ends_at),
    isActive: item.is_active
  };
}

function payload(state: FormState) {
  return {
    code: state.code,
    description: state.description,
    discountType: state.discountType,
    discountValue: Number(state.discountValue),
    minOrderAmount: state.minOrderAmount === "" ? "" : Number(state.minOrderAmount),
    usageLimit: state.usageLimit === "" ? "" : Number(state.usageLimit),
    startsAt: state.startsAt ? new Date(state.startsAt).toISOString() : "",
    endsAt: state.endsAt ? new Date(state.endsAt).toISOString() : "",
    isActive: state.isActive
  };
}

function PromoForm({ state, onChange, busy, submitLabel }: {
  state: FormState;
  onChange: (next: FormState) => void;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <>
      <div className="admin-promo-form-grid">
        <label><span>Код</span><input required minLength={3} maxLength={80} value={state.code} onChange={(e) => onChange({ ...state, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></label>
        <label><span>Тип скидки</span><select value={state.discountType} onChange={(e) => onChange({ ...state, discountType: e.target.value as "percent" | "fixed" })}><option value="percent">Процент</option><option value="fixed">Фиксированная сумма</option></select></label>
        <label><span>{state.discountType === "percent" ? "Скидка, %" : "Скидка, ₽"}</span><input type="number" min="1" max={state.discountType === "percent" ? "100" : "10000000"} required value={state.discountValue} onChange={(e) => onChange({ ...state, discountValue: e.target.value })} /></label>
        <label><span>Минимальный заказ, ₽</span><input type="number" min="0" value={state.minOrderAmount} onChange={(e) => onChange({ ...state, minOrderAmount: e.target.value })} placeholder="Без ограничения" /></label>
        <label><span>Лимит применений</span><input type="number" min="1" value={state.usageLimit} onChange={(e) => onChange({ ...state, usageLimit: e.target.value })} placeholder="Без ограничения" /></label>
        <label><span>Начало действия</span><input type="datetime-local" value={state.startsAt} onChange={(e) => onChange({ ...state, startsAt: e.target.value })} /></label>
        <label><span>Окончание действия</span><input type="datetime-local" value={state.endsAt} onChange={(e) => onChange({ ...state, endsAt: e.target.value })} /></label>
        <label className="admin-promo-active"><input type="checkbox" checked={state.isActive} onChange={(e) => onChange({ ...state, isActive: e.target.checked })} /><span>Промокод включён</span></label>
        <label className="wide"><span>Описание для сотрудников</span><textarea maxLength={500} value={state.description} onChange={(e) => onChange({ ...state, description: e.target.value })} placeholder="Для какой акции создан код" /></label>
      </div>
      <button type="submit" disabled={busy}>{busy ? "Сохраняем…" : submitLabel}</button>
    </>
  );
}

export function CreatePromocodeForm() {
  const router = useRouter();
  const [state, setState] = useState<FormState>(emptyState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/promocodes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(state))
      });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message || "Не удалось создать промокод");
      setState(emptyState());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать промокод");
    } finally {
      setBusy(false);
    }
  }

  return <form className="admin-promo-form" onSubmit={submit}><PromoForm state={state} onChange={setState} busy={busy} submitLabel="Создать промокод" />{error ? <p className="admin-form-error">{error}</p> : null}</form>;
}

export function EditPromocodeForm({ item }: { item: Promo }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => fromPromo(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/promocodes/${item.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(state))
      });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message || "Не удалось сохранить промокод");
      setMessage("Промокод сохранён.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить промокод");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="admin-promo-edit">
      <summary>Изменить условия</summary>
      <form className="admin-promo-form" onSubmit={submit}>
        <PromoForm state={state} onChange={setState} busy={busy} submitLabel="Сохранить изменения" />
        {Number(item.used_count) > 0 ? <p className="admin-growth-help">Код уже применяли. Переименовать его нельзя, но можно остановить или изменить будущие условия.</p> : null}
        {error ? <p className="admin-form-error">{error}</p> : null}
        {message ? <p className="admin-form-success">{message}</p> : null}
      </form>
    </details>
  );
}
