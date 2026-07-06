"use client";

import { useMemo, useState } from "react";

export type OrderStaffMember = {
  user_id: unknown;
  role: unknown;
  name: unknown;
  phone: unknown;
  telegram_id: unknown;
  telegram_username: unknown;
};

type Props = {
  orderId: string;
  currentManagerId: string;
  currentFloristId: string;
  currentCourierId: string;
  staff: OrderStaffMember[];
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function roleText(role: string) {
  const map: Record<string, string> = {
    manager: "Менеджер",
    florist: "Флорист",
    courier: "Курьер"
  };

  return map[role] || role;
}

function staffLabel(member: OrderStaffMember) {
  const name = text(member.name) || "Без имени";
  const phone = text(member.phone);
  const username = text(member.telegram_username);

  const parts = [name];

  if (phone) parts.push(phone);
  if (username) parts.push(`@${username}`);

  return parts.join(" · ");
}

export function OrderAssigneesForm({
  orderId,
  currentManagerId,
  currentFloristId,
  currentCourierId,
  staff
}: Props) {
  const [managerId, setManagerId] = useState(currentManagerId);
  const [floristId, setFloristId] = useState(currentFloristId);
  const [courierId, setCourierId] = useState(currentCourierId);
  const [isSaving, setIsSaving] = useState(false);

  const grouped = useMemo(() => {
    return {
      manager: staff.filter((member) => text(member.role) === "manager"),
      florist: staff.filter((member) => text(member.role) === "florist"),
      courier: staff.filter((member) => text(member.role) === "courier")
    };
  }, [staff]);

  async function save() {
    setIsSaving(true);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/assignees`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerId,
          floristId,
          courierId
        })
      });

      const data = await response.json().catch(() => null) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось сохранить ответственных");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить ответственных");
      setIsSaving(false);
    }
  }

  function renderSelect(
    role: "manager" | "florist" | "courier",
    value: string,
    onChange: (value: string) => void
  ) {
    const members = grouped[role];

    return (
      <label className="admin-order-assignee-field">
        <span>{roleText(role)}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Не назначен</option>
          {members.map((member) => {
            const userId = text(member.user_id);

            return (
              <option key={userId} value={userId}>
                {staffLabel(member)}
              </option>
            );
          })}
        </select>
        {!members.length ? (
          <small>Нет активных сотрудников</small>
        ) : (
          <small>&nbsp;</small>
        )}
      </label>
    );
  }

  return (
    <div className="admin-order-assignees-form">
      <div className="admin-order-assignees-grid">
        {renderSelect("manager", managerId, setManagerId)}
        {renderSelect("florist", floristId, setFloristId)}
        {renderSelect("courier", courierId, setCourierId)}
      </div>

      <div className="admin-order-assignees-note">
        <span>После назначения флориста следующий шаг — Telegram-задача “Взять в работу”.</span>
      </div>

      <button type="button" onClick={save} disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Сохранить ответственных"}
      </button>
    </div>
  );
}
