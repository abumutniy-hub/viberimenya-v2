"use client";

import { useState } from "react";

export type CustomerBouquetApprovalState = {
  status: string;
  requestedAt: string | null;
  decidedAt: string | null;
  note: string | null;
  canRespond: boolean;
};

type Props = {
  orderNumber: string;
  trackingToken: string;
  approval: CustomerBouquetApprovalState;
  onChanged: (approval: CustomerBouquetApprovalState) => void;
};

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function CustomerBouquetApproval({
  orderNumber,
  trackingToken,
  approval,
  onChanged,
}: Props) {
  const [note, setNote] = useState(approval.note || "");
  const [busy, setBusy] = useState<"approve" | "revision" | "">("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(action: "approve" | "revision") {
    if (busy || !approval.canRespond) return;

    const normalizedNote = note.trim();
    if (action === "revision" && normalizedNote.length < 3) {
      setMessage("Напишите, что нужно изменить — минимум 3 символа.");
      setIsError(true);
      return;
    }

    setBusy(action);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch(
        `/api/public/orders/track/${encodeURIComponent(trackingToken)}/bouquet-approval`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            note: action === "revision" ? normalizedNote : "",
          }),
        },
      );
      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Не удалось отправить решение",
        );
      }

      const nextStatus = action === "approve" ? "approved" : "revision_requested";
      const nextApproval: CustomerBouquetApprovalState = {
        ...approval,
        status: nextStatus,
        decidedAt: new Date().toISOString(),
        note: action === "revision" ? normalizedNote : null,
        canRespond: false,
      };

      onChanged(nextApproval);
      setMessage(
        action === "approve"
          ? "Букет одобрен. Флорист получил подтверждение."
          : "Правка отправлена флористу.",
      );
      setIsError(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Не удалось обновить заказ ${orderNumber}`,
      );
      setIsError(true);
    } finally {
      setBusy("");
    }
  }

  if (!approval.canRespond) {
    if (approval.status === "revision_requested" && approval.note) {
      return (
        <p className="customer-bouquet-approval-result is-revision">
          Правка отправлена: {approval.note}
        </p>
      );
    }

    if (approval.status === "approved") {
      return (
        <p className="customer-bouquet-approval-result is-approved">
          ✓ Букет одобрен
        </p>
      );
    }

    return null;
  }

  return (
    <div className="customer-bouquet-approval-controls">
      <label>
        <span>Комментарий для правки</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="Например: сделать упаковку светлее"
          disabled={Boolean(busy)}
        />
      </label>

      <div className="customer-bouquet-approval-buttons">
        <button
          type="button"
          onClick={() => void submit("approve")}
          disabled={Boolean(busy)}
        >
          {busy === "approve" ? "Отправляем…" : "✓ Одобряю"}
        </button>
        <button
          type="button"
          className="is-secondary"
          onClick={() => void submit("revision")}
          disabled={Boolean(busy)}
        >
          {busy === "revision" ? "Отправляем…" : "Нужна правка"}
        </button>
      </div>

      {message ? (
        <p
          className={
            isError
              ? "customer-bouquet-approval-message is-error"
              : "customer-bouquet-approval-message"
          }
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
