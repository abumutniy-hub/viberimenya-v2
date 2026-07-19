"use client";

import { useState } from "react";

type ActionResponse = {
  ok?: boolean;
  message?: string;
  retried?: number;
  deliveriesReset?: number;
  releasedOutboxes?: number;
  releasedDeliveries?: number;
  accountsDisabled?: number;
};

async function postAction(url: string) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include"
  });

  const data = await response.json().catch(() => null) as ActionResponse | null;

  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Не удалось выполнить действие");
  }

  return data;
}

function actionMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ошибка действия";
}

export function NotificationActions({
  id,
  status
}: {
  id: string;
  status: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: "retry" | "skip") {
    setBusy(true);
    setMessage("");

    try {
      const data = await postAction(`/api/admin/notifications/${id}/${action}`);
      setMessage(
        action === "retry"
          ? `Возвращено доставок: ${Number(data.deliveriesReset || 0)}`
          : "Уведомление пропущено"
      );
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setMessage(actionMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="admin-notification-row-actions">
      {["dead", "partial", "skipped"].includes(status) ? (
        <button type="button" disabled={busy} onClick={() => void act("retry")}>
          Повторить
        </button>
      ) : null}

      {["pending", "processing", "partial", "dead"].includes(status) ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void act("skip")}
        >
          Пропустить
        </button>
      ) : null}

      {message ? <small>{message}</small> : null}
    </div>
  );
}

export function DeliveryActions({
  id,
  status,
  channel,
  canDeactivateRecipient
}: {
  id: string;
  status: string;
  channel: string;
  canDeactivateRecipient: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: "retry" | "deactivate") {
    setBusy(true);
    setMessage("");

    try {
      const data = await postAction(
        `/api/admin/notifications/deliveries/${id}/${action}`
      );
      setMessage(
        action === "retry"
          ? "Доставка возвращена в очередь"
          : `Отключено аккаунтов: ${Number(data.accountsDisabled || 0)}`
      );
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(actionMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="admin-notification-delivery-actions">
      {["failed", "skipped"].includes(status) ? (
        <button type="button" disabled={busy} onClick={() => void act("retry")}>
          Повторить доставку
        </button>
      ) : null}

      {canDeactivateRecipient
        && channel === "telegram"
        && status !== "sent" ? (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void act("deactivate")}
          >
            Отключить получателя
          </button>
        ) : null}

      {message ? <small>{message}</small> : null}
    </div>
  );
}

export function NotificationBulkActions({
  deadCount,
  staleCount
}: {
  deadCount: number;
  staleCount: number;
}) {
  const [busy, setBusy] = useState<"retry" | "stale" | "">("");
  const [message, setMessage] = useState("");

  async function retryDead() {
    setBusy("retry");
    setMessage("");

    try {
      const data = await postAction("/api/admin/notifications/retry-dead");
      setMessage(
        `Возвращено событий: ${Number(data.retried || 0)}, доставок: ${Number(data.deliveriesReset || 0)}`
      );
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setMessage(actionMessage(error));
      setBusy("");
    }
  }

  async function releaseStale() {
    setBusy("stale");
    setMessage("");

    try {
      const data = await postAction("/api/admin/notifications/release-stale");
      setMessage(
        `Освобождено задач: ${Number(data.releasedOutboxes || 0)}, доставок: ${Number(data.releasedDeliveries || 0)}`
      );
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setMessage(actionMessage(error));
      setBusy("");
    }
  }

  return (
    <div className="admin-notification-bulk-action">
      <div>
        <button
          type="button"
          disabled={Boolean(busy) || deadCount <= 0}
          onClick={() => void retryDead()}
        >
          Повторить dead-letter
        </button>
        <button
          type="button"
          className="secondary"
          disabled={Boolean(busy) || staleCount <= 0}
          onClick={() => void releaseStale()}
        >
          Освободить зависшие
        </button>
      </div>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
