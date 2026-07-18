"use client";

import { useState, type FormEvent } from "react";

type ActionName = "diagnostics" | "backup" | "restore-check";

type Settings = {
  alertsEnabled: boolean;
  operationalAlertsEnabled: boolean;
  alertRepeatHours: number;
  dailySummaryEnabled: boolean;
  autoRestartEnabled: boolean;
  backupRetentionDays: number;
  diskWarningPercent: number;
  diskCriticalPercent: number;
  staleOrderMinutes: number;
};

async function responseMessage(response: Response) {
  const data = await response.json().catch(() => null) as {
    message?: string;
    error?: string;
  } | null;

  return data?.message || data?.error || "Операция не выполнена";
}

export function SystemActionButton({
  action,
  children,
  confirmText,
}: {
  action: ActionName;
  children: React.ReactNode;
  confirmText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runAction() {
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/system/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => null) as {
        message?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Операция не выполнена");
      }

      setMessage(data?.message || "Готово");
      window.setTimeout(() => window.location.reload(), action === "diagnostics" ? 700 : 1800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-system-action-wrap">
      <button type="button" onClick={runAction} disabled={busy}>
        {busy ? "Выполняется…" : children}
      </button>
      {message ? <small>{message}</small> : null}
    </div>
  );
}

export function MonitoringSettingsForm({ initial }: { initial: Settings }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Settings = {
      alertsEnabled: form.get("alertsEnabled") === "on",
      operationalAlertsEnabled: form.get("operationalAlertsEnabled") === "on",
      alertRepeatHours: Number(form.get("alertRepeatHours") || 24),
      dailySummaryEnabled: form.get("dailySummaryEnabled") === "on",
      autoRestartEnabled: form.get("autoRestartEnabled") === "on",
      backupRetentionDays: Number(form.get("backupRetentionDays") || 30),
      diskWarningPercent: Number(form.get("diskWarningPercent") || 75),
      diskCriticalPercent: Number(form.get("diskCriticalPercent") || 90),
      staleOrderMinutes: Number(form.get("staleOrderMinutes") || 120),
    };

    if (body.diskCriticalPercent <= body.diskWarningPercent) {
      setMessage("Критический порог диска должен быть выше предупредительного.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/system/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await responseMessage(response));
      }

      setMessage("Настройки сохранены.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-system-settings" onSubmit={submit}>
      <div className="admin-system-switches">
        <label>
          <input type="checkbox" name="alertsEnabled" defaultChecked={initial.alertsEnabled} />
          <span><strong>Telegram-предупреждения</strong><small>Владелец получает сообщение только при проблеме или изменении уровня опасности.</small></span>
        </label>
        <label>
          <input type="checkbox" name="operationalAlertsEnabled" defaultChecked={initial.operationalAlertsEnabled} />
          <span><strong>Напоминания по заказам</strong><small>Сообщать о старых тестовых заказах, проблемных заказах, фото доставки и ошибках уведомлений. До финальной очистки лучше оставить выключенным.</small></span>
        </label>
        <label>
          <input type="checkbox" name="autoRestartEnabled" defaultChecked={initial.autoRestartEnabled} />
          <span><strong>Автоматический перезапуск</strong><small>Если API, WEB или BOT остановился, монитор попробует поднять процесс через PM2.</small></span>
        </label>
        <label>
          <input type="checkbox" name="dailySummaryEnabled" defaultChecked={initial.dailySummaryEnabled} />
          <span><strong>Ежедневный отчёт</strong><small>В 09:00 владелец получает заказы, выручку и состояние системы.</small></span>
        </label>
      </div>

      <div className="admin-system-settings-grid">
        <label>
          <span>Повтор одинакового предупреждения</span>
          <select name="alertRepeatHours" defaultValue={String(initial.alertRepeatHours)}>
            <option value="6">раз в 6 часов</option>
            <option value="12">раз в 12 часов</option>
            <option value="24">раз в сутки</option>
            <option value="48">раз в 2 суток</option>
            <option value="72">раз в 3 суток</option>
          </select>
        </label>
        <label>
          <span>Хранить резервные копии</span>
          <select name="backupRetentionDays" defaultValue={String(initial.backupRetentionDays)}>
            <option value="14">14 дней</option>
            <option value="21">21 день</option>
            <option value="30">30 дней</option>
            <option value="45">45 дней</option>
            <option value="60">60 дней</option>
            <option value="90">90 дней</option>
          </select>
        </label>
        <label>
          <span>Предупреждение о диске</span>
          <input name="diskWarningPercent" type="number" min="60" max="90" defaultValue={initial.diskWarningPercent} />
        </label>
        <label>
          <span>Критический уровень диска</span>
          <input name="diskCriticalPercent" type="number" min="75" max="99" defaultValue={initial.diskCriticalPercent} />
        </label>
        <label>
          <span>Заказ считается зависшим через</span>
          <select name="staleOrderMinutes" defaultValue={String(initial.staleOrderMinutes)}>
            <option value="30">30 минут</option>
            <option value="60">1 час</option>
            <option value="120">2 часа</option>
            <option value="180">3 часа</option>
            <option value="360">6 часов</option>
            <option value="720">12 часов</option>
          </select>
        </label>
      </div>

      <div className="admin-system-settings-actions">
        <span>{message || "Настройки применяются к следующей автоматической проверке."}</span>
        <button type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить настройки"}</button>
      </div>
    </form>
  );
}
