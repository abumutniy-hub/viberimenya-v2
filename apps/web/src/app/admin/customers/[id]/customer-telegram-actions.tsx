"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  customerId: string;
  connected: boolean;
  username: string | null;
  canManage: boolean;
};

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function CustomerTelegramActions(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!props.connected || !props.canManage) {
    return null;
  }

  async function unlinkTelegram() {
    const confirmed = window.confirm(
      [
        "Отключить Telegram у клиента?",
        "",
        props.username ? `Аккаунт: @${props.username}` : "",
        "Заказы, бонусы, адреса и профиль клиента сохранятся.",
        "Новые Telegram-уведомления этому клиенту отправляться не будут.",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/customers/${props.customerId}/telegram-link`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      const data = await readJson(response);

      if (!response.ok || data.ok !== true) {
        setMessage(String(data.message || "Не удалось отключить Telegram"));
        return;
      }

      setMessage("Telegram клиента отключён");
      router.refresh();
    } catch {
      setMessage("Не удалось связаться с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-customer-telegram-actions">
      <button
        type="button"
        className="danger-button"
        disabled={busy}
        onClick={() => void unlinkTelegram()}
      >
        {busy ? "Отключаем…" : "Отключить Telegram"}
      </button>
      {message ? <small>{message}</small> : null}
    </div>
  );
}
