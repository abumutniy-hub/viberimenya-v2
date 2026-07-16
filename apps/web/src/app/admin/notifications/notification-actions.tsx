"use client";

import { useState } from "react";

async function postAction(url: string) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include"
  });

  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    message?: string;
    retried?: number;
  } | null;

  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Не удалось выполнить действие");
  }

  return data;
}

export function NotificationActions({ id, status }: { id: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: "retry" | "skip") {
    setBusy(true);
    setMessage("");

    try {
      await postAction(`/api/admin/notifications/${id}/${action}`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка действия");
      setBusy(false);
    }
  }

  return (
    <div className="admin-notification-row-actions">
      {status === "failed" || status === "skipped" ? (
        <button type="button" disabled={busy} onClick={() => void act("retry")}>
          Повторить
        </button>
      ) : null}

      {status === "pending" || status === "processing" || status === "failed" ? (
        <button type="button" className="secondary" disabled={busy} onClick={() => void act("skip")}>
          Пропустить
        </button>
      ) : null}

      {message ? <small>{message}</small> : null}
    </div>
  );
}

export function RetryFailedNotifications() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function retryAll() {
    setBusy(true);
    setMessage("");

    try {
      const data = await postAction("/api/admin/notifications/retry-failed");
      setMessage(`Возвращено в очередь: ${Number(data.retried || 0)}`);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка повторной отправки");
      setBusy(false);
    }
  }

  return (
    <div className="admin-notification-bulk-action">
      <button type="button" disabled={busy} onClick={() => void retryAll()}>
        Повторить все ошибки
      </button>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
