"use client";

import { useEffect, useState } from "react";

type InternalChatMessage = {
  id: string;
  author_type: string;
  author_name?: string | null;
  text: string;
  attachment_url?: string | null;
  created_at: string;
};

function displayDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function OrderActions({
  orderId,
  status,
  paymentStatus,
  paymentUrl,
  trackingToken
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  paymentUrl?: string;
  trackingToken?: string;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [link, setLink] = useState(paymentUrl || "");

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<InternalChatMessage[]>([]);
  const [chatError, setChatError] = useState("");

  const canMarkPaid = status !== "new" && status !== "cancelled" && paymentStatus !== "paid";
  const canAddPaymentLink = status === "confirmed" && paymentStatus !== "paid";
  const trackingUrl = trackingToken ? `/order/track/${trackingToken}` : "";

  async function loadInternalChat() {
    setIsChatLoading(true);
    setChatError("");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/internal-chat`, {
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.message || "Не удалось загрузить чат");
      }

      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Не удалось загрузить чат");
    } finally {
      setIsChatLoading(false);
    }
  }

  useEffect(() => {
    if (isChatOpen) {
      void loadInternalChat();
    }
  }, [isChatOpen]);

  async function sendInternalMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = chatMessage.trim();

    if (!text) {
      return;
    }

    setIsSendingMessage(true);
    setChatError("");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/internal-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.message || "Не удалось отправить сообщение");
      }

      setChatMessage("");
      await loadInternalChat();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function copyTrackingLink() {
    if (!trackingToken) return;

    const absoluteUrl = `${window.location.origin}${trackingUrl}`;

    try {
      await navigator.clipboard.writeText(absoluteUrl);
      alert("Ссылка заказа скопирована");
    } catch {
      window.prompt("Скопируйте ссылку заказа", absoluteUrl);
    }
  }

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

  async function savePaymentLink() {
    const paymentUrlToSave = link.trim();

    if (!paymentUrlToSave) {
      alert("Вставьте ссылку на оплату");
      return;
    }

    setIsSavingLink(true);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/payment-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentUrl: paymentUrlToSave })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Не удалось сохранить ссылку");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить ссылку");
      setIsSavingLink(false);
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
      {trackingToken ? (
        <div className="admin-order-link-actions">
          <a className="admin-small-link" href={trackingUrl} target="_blank" rel="noreferrer">
            Открыть заказ
          </a>
          <button type="button" className="admin-copy-link" onClick={copyTrackingLink}>
            Копировать ссылку
          </button>
        </div>
      ) : null}

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

      {canAddPaymentLink ? (
        <div className="admin-payment-link-box">
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Ссылка оплаты"
          />
          <button
            type="button"
            className="admin-action-button secondary"
            disabled={isSavingLink}
            onClick={savePaymentLink}
          >
            {isSavingLink ? "..." : paymentUrl ? "Обновить ссылку" : "Добавить ссылку"}
          </button>
        </div>
      ) : null}

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

      <button
        type="button"
        className="admin-action-button chat"
        onClick={() => setIsChatOpen((value) => !value)}
      >
        {isChatOpen ? "Скрыть чат" : "Чат команды"}
      </button>

      {isChatOpen ? (
        <div className="admin-internal-chat">
          <div className="admin-internal-chat-head">
            <strong>Внутренний чат</strong>
            <span>Видят только сотрудники</span>
          </div>

          {isChatLoading ? (
            <p className="admin-chat-muted">Загружаем сообщения…</p>
          ) : chatMessages.length ? (
            <div className="admin-chat-messages">
              {chatMessages.map((message) => (
                <article key={message.id} className="admin-chat-message">
                  <div>
                    <strong>{message.author_name || "Сотрудник"}</strong>
                    <span>{displayDateTime(message.created_at)}</span>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-chat-muted">Сообщений пока нет.</p>
          )}

          {chatError ? <p className="admin-chat-error">{chatError}</p> : null}

          <form className="admin-chat-form" onSubmit={sendInternalMessage}>
            <textarea
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              placeholder="Написать внутренний комментарий по заказу"
              rows={3}
            />
            <button type="submit" disabled={isSendingMessage || !chatMessage.trim()}>
              {isSendingMessage ? "Отправляем…" : "Отправить"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
