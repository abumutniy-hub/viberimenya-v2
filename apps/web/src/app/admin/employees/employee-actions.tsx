"use client";

import { useState } from "react";

type Props = {
  employeeId: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  isActive: boolean;
  canManage: boolean;
  telegramLinkUrl: string;
  linkedTelegramText: string;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  telegramLinkUrl?: string;
};

const roleOptions = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "florist", label: "Флорист" },
  { value: "courier", label: "Курьер" }
];

export function EmployeeActions(props: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState(props.telegramLinkUrl);

  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone);
  const [email, setEmail] = useState(props.email);
  const [role, setRole] = useState(props.role === "owner" ? "admin" : props.role);
  const [isActive, setIsActive] = useState(props.isActive);

  async function copyLink() {
    if (!linkUrl) return;

    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(linkUrl);
      alert("Ссылка скопирована");
      return;
    }

    window.prompt("Скопируйте ссылку вручную:", linkUrl);
  }

  async function createTelegramLink() {
    setIsBusy(true);

    try {
      const response = await fetch(`/api/admin/employees/${props.employeeId}/telegram-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      const data = await response.json().catch(() => null) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось создать Telegram-ссылку");
      }

      if (data?.telegramLinkUrl) {
        setLinkUrl(data.telegramLinkUrl);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось создать Telegram-ссылку");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveEmployee() {
    if (!props.canManage) return;

    if (!name.trim() || !phone.trim()) {
      alert("Укажите имя и телефон сотрудника");
      return;
    }

    setIsBusy(true);

    try {
      const response = await fetch(`/api/admin/employees/${props.employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          telegramUsername: "",
          role,
          isActive
        })
      });

      const data = await response.json().catch(() => null) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось сохранить сотрудника");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить сотрудника");
      setIsBusy(false);
    }
  }

  async function deleteEmployee() {
    if (!props.canManage) return;

    const confirmed = window.confirm("Отключить сотрудника? Он пропадёт из активной команды, а история заказов сохранится.");
    if (!confirmed) return;

    setIsBusy(true);

    try {
      const response = await fetch(`/api/admin/employees/${props.employeeId}`, {
        method: "DELETE"
      });

      const data = await response.json().catch(() => null) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось отключить сотрудника");
      }

      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось отключить сотрудника");
      setIsBusy(false);
    }
  }

  return (
    <div className="admin-employee-actions">
      <div className="admin-employee-telegram-status">
        {props.linkedTelegramText ? (
          <span>Telegram: {props.linkedTelegramText}</span>
        ) : (
          <span>Telegram не привязан</span>
        )}
      </div>

      {linkUrl ? (
        <div className="admin-employee-link-box">
          <input value={linkUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          <button type="button" onClick={copyLink}>
            Скопировать
          </button>
        </div>
      ) : null}

      <div className="admin-employee-action-row">
        <button type="button" onClick={createTelegramLink} disabled={isBusy}>
          Новая Telegram-ссылка
        </button>

        {props.canManage ? (
          <button type="button" onClick={() => setIsEditing((value) => !value)} disabled={isBusy}>
            {isEditing ? "Закрыть" : "Редактировать"}
          </button>
        ) : null}

        {props.canManage ? (
          <button type="button" className="danger" onClick={deleteEmployee} disabled={isBusy}>
            Отключить
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="admin-employee-edit">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя" />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Телефон" />
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />

          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Активен
          </label>

          <button type="button" onClick={saveEmployee} disabled={isBusy}>
            Сохранить
          </button>
        </div>
      ) : null}
    </div>
  );
}
