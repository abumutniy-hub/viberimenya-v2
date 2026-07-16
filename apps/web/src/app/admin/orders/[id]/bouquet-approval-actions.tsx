"use client";

import { useState } from "react";

type BouquetApprovalAction = "approve" | "waive" | "revision" | "resend";

type Props = {
  orderId: string;
  approvalStatus: string;
  disabled: boolean;
};

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function BouquetApprovalActions({
  orderId,
  approvalStatus,
  disabled,
}: Props) {
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<BouquetApprovalAction | "">("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(action: BouquetApprovalAction) {
    if (busyAction || disabled) return;

    if (action === "revision" && note.trim().length < 3) {
      setIsError(true);
      setMessage("Опишите правку минимум тремя символами.");
      return;
    }

    setBusyAction(action);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(orderId)}/bouquet-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: note.trim(),
          }),
        },
      );
      const data = await readJson(response);
      const responseMessage = String(data.message || "").trim();

      if (!response.ok || data.ok !== true) {
        throw new Error(responseMessage || "Не удалось обновить согласование");
      }

      setMessage(responseMessage || "Согласование обновлено.");
      setIsError(false);
      window.setTimeout(() => window.location.reload(), 650);
    } catch (cause) {
      setIsError(true);
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Не удалось обновить согласование",
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="admin-bouquet-approval-actions">
      <label>
        <span>Комментарий для флориста</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          placeholder="Например: сделать упаковку светлее или добавить белые цветы"
          rows={3}
          disabled={disabled || Boolean(busyAction)}
        />
        <small>{note.length}/500</small>
      </label>

      <div className="admin-bouquet-approval-buttons">
        <button
          type="button"
          onClick={() => void submit("approve")}
          disabled={disabled || Boolean(busyAction) || approvalStatus === "approved"}
        >
          {busyAction === "approve" ? "Сохраняем…" : "✓ Одобрено по телефону"}
        </button>

        <button
          type="button"
          className="is-secondary"
          onClick={() => void submit("resend")}
          disabled={disabled || Boolean(busyAction)}
        >
          {busyAction === "resend" ? "Отправляем…" : "↻ Отправить фото повторно"}
        </button>

        <button
          type="button"
          className="is-warning"
          onClick={() => void submit("revision")}
          disabled={disabled || Boolean(busyAction)}
        >
          {busyAction === "revision" ? "Передаём…" : "Правка от менеджера"}
        </button>

        <button
          type="button"
          className="is-ghost"
          onClick={() => void submit("waive")}
          disabled={disabled || Boolean(busyAction) || approvalStatus === "waived"}
        >
          {busyAction === "waive" ? "Сохраняем…" : "Продолжить без согласования"}
        </button>
      </div>

      {message ? (
        <p
          className={
            isError
              ? "admin-bouquet-approval-message is-error"
              : "admin-bouquet-approval-message"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
