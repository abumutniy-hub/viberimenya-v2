"use client";

import { useState, type FormEvent } from "react";

type YooKassaSettings = {
  enabled: boolean;
  shopId: string;
  secretKeyConfigured: boolean;
  receiptsEnabled: boolean;
  webhookUrl: string;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

async function readResponse(response: Response) {
  return await response.json().catch(() => null) as ApiResponse | null;
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await readResponse(response);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || "Не удалось сохранить настройки");
  }

  return data;
}

export function YooKassaSettingsCard({
  initialSettings
}: {
  initialSettings: YooKassaSettings;
}) {
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [shopId, setShopId] = useState(initialSettings.shopId);
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const secretConfigured = initialSettings.secretKeyConfigured;

  function payload() {
    return {
      enabled,
      shopId: shopId.trim(),
      secretKey: secretKey.trim()
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    setIsError(false);

    try {
      const data = await postJson("/api/admin/finance/yookassa-settings", payload());
      setMessage(data.message || "Настройки ЮKassa сохранены");
      setSecretKey("");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
      setIsError(true);
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage("");
    setIsError(false);

    try {
      const data = await postJson(
        "/api/admin/finance/yookassa-settings/test",
        payload()
      );
      setMessage(data.message || "Подключение подтверждено");
      setBusy(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Проверка не пройдена");
      setIsError(true);
      setBusy(null);
    }
  }

  async function clearCredentials() {
    const confirmed = window.confirm(
      "Удалить Shop ID и секретный ключ с сервера? Новые онлайн-платежи будут выключены."
    );

    if (!confirmed) return;

    setBusy("clear");
    setMessage("");
    setIsError(false);

    try {
      const data = await postJson(
        "/api/admin/finance/yookassa-settings/clear",
        {}
      );
      setMessage(data.message || "Ключи удалены");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить ключи");
      setIsError(true);
      setBusy(null);
    }
  }

  return (
    <section className="admin-panel admin-yookassa-settings">
      <div className="admin-panel-head">
        <div>
          <span>Без редактирования сервера</span>
          <h2>Подключение ЮKassa</h2>
        </div>
        <strong className={`admin-yookassa-state ${enabled && secretConfigured ? "ready" : "off"}`}>
          {enabled && secretConfigured ? "Включена" : secretConfigured ? "Выключена" : "Ключи не добавлены"}
        </strong>
      </div>

      <form onSubmit={handleSubmit} className="admin-yookassa-form">
        <label className="admin-yookassa-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>
            <strong>Принимать новые онлайн-платежи</strong>
            <small>
              При выключении уже созданные платежи и возвраты продолжат синхронизироваться.
            </small>
          </span>
        </label>

        <div className="admin-yookassa-grid">
          <label>
            <span>Shop ID</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              value={shopId}
              onChange={(event) => setShopId(event.target.value.replace(/\D/g, "").slice(0, 64))}
              placeholder="Идентификатор магазина"
            />
          </label>

          <label>
            <span>Секретный ключ</span>
            <input
              type="password"
              autoComplete="new-password"
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder={secretConfigured ? "Ключ сохранён — оставьте пустым, чтобы не менять" : "Вставьте секретный ключ"}
            />
            <small>После сохранения ключ больше не показывается в CRM.</small>
          </label>
        </div>

        <div className="admin-yookassa-webhook">
          <span>Webhook для личного кабинета ЮKassa</span>
          <code>{initialSettings.webhookUrl}</code>
          <small>
            В ЮKassa включите уведомления о платежах и возвратах на этот HTTPS-адрес.
          </small>
        </div>

        <div className="admin-yookassa-actions">
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void testConnection()}>
            {busy === "test" ? "Проверяем…" : "Проверить подключение"}
          </button>
          <button type="submit" disabled={busy !== null}>
            {busy === "save" ? "Сохраняем…" : "Сохранить настройки"}
          </button>
          {secretConfigured ? (
            <button type="button" className="danger" disabled={busy !== null} onClick={() => void clearCredentials()}>
              {busy === "clear" ? "Удаляем…" : "Удалить ключи"}
            </button>
          ) : null}
        </div>

        {message ? (
          <div className={`admin-yookassa-message ${isError ? "error" : "success"}`}>
            {message}
          </div>
        ) : null}

        <div className="admin-yookassa-security-note">
          <strong>Защита ключа</strong>
          <span>
            Секрет сохраняется только в закрытом серверном файле <code>.env</code> с правами 600,
            не возвращается браузеру и не попадает в журнал действий.
          </span>
        </div>

        {!initialSettings.receiptsEnabled ? (
          <div className="admin-yookassa-notice">
            Передача чеков сейчас выключена. Её включим отдельно после настройки налоговой системы,
            НДС и онлайн-кассы.
          </div>
        ) : null}
      </form>
    </section>
  );
}
