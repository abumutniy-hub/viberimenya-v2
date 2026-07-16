"use client";

import { useState } from "react";

type ApiResponse = {
  ok?: boolean;
  message?: string;
  revokedSessions?: number;
  expiredSessions?: number;
  deletedAuditEvents?: number;
};

async function readResponse(response: Response) {
  return (
    await response.json().catch(() => null)
  ) as ApiResponse | null;
}

export function SessionRevokeButton({
  sessionKey,
  employeeName
}: {
  sessionKey: string;
  employeeName: string;
}) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (!window.confirm(`Завершить этот сеанс сотрудника «${employeeName}»?`)) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `/api/admin/security/sessions/${sessionKey}/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: "{}"
        }
      );
      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось завершить сеанс");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось завершить сеанс");
      setBusy(false);
    }
  }

  return (
    <button type="button" disabled={busy} onClick={() => void revoke()}>
      {busy ? "Завершаем…" : "Завершить"}
    </button>
  );
}

export function RevokeOtherSessionsButton() {
  const [busy, setBusy] = useState(false);

  async function revokeOthers() {
    if (!window.confirm("Завершить все ваши сеансы CRM, кроме текущего?")) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        "/api/admin/security/sessions/revoke-others",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: "{}"
        }
      );
      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось завершить сеансы");
      }

      alert(`Завершено других сеансов: ${Number(data?.revokedSessions || 0)}`);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось завершить сеансы");
      setBusy(false);
    }
  }

  return (
    <button type="button" disabled={busy} onClick={() => void revokeOthers()}>
      {busy ? "Завершаем…" : "Завершить мои другие сеансы"}
    </button>
  );
}

export function SecurityCleanupButton() {
  const [busy, setBusy] = useState(false);

  async function cleanup() {
    if (!window.confirm("Очистить истёкшие сеансы и события аудита старше одного года?")) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        "/api/admin/security/cleanup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: "{}"
        }
      );
      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось выполнить очистку");
      }

      alert(
        `Истёкших сеансов: ${Number(data?.expiredSessions || 0)}. `
        + `Удалено старых событий: ${Number(data?.deletedAuditEvents || 0)}.`
      );
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось выполнить очистку");
      setBusy(false);
    }
  }

  return (
    <button type="button" disabled={busy} onClick={() => void cleanup()}>
      {busy ? "Очищаем…" : "Очистить устаревшие записи"}
    </button>
  );
}
