"use client";

import { useState, type FormEvent } from "react";

type CreateEmployeeResponse = {
  ok?: boolean;
  message?: string;
  telegramLinkUrl?: string;
};

export function EmployeeForm() {
  const [isSaving, setIsSaving] = useState(false);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      telegramUsername: String(formData.get("telegramUsername") || "").trim(),
      role: String(formData.get("role") || "florist")
    };

    if (!payload.name || !payload.phone) {
      alert("Укажите имя и телефон сотрудника");
      return;
    }

    setIsSaving(true);
    setTelegramLinkUrl("");

    try {
      const response = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null) as CreateEmployeeResponse | null;

      if (!response.ok) {
        throw new Error(data?.message || "Не удалось создать сотрудника");
      }

      form.reset();

      if (data?.telegramLinkUrl) {
        setTelegramLinkUrl(data.telegramLinkUrl);
      }

      setIsSaving(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось создать сотрудника");
      setIsSaving(false);
    }
  }

  async function copyTelegramLink() {
    if (!telegramLinkUrl) return;

    try {
      await navigator.clipboard.writeText(telegramLinkUrl);
      alert("Ссылка скопирована");
    } catch {
      alert(telegramLinkUrl);
    }
  }

  return (
    <div className="admin-employee-form-wrap">
      <form className="admin-employee-form" onSubmit={onSubmit}>
        <div>
          <label>Имя</label>
          <input name="name" placeholder="Например: Анна" />
        </div>

        <div>
          <label>Телефон</label>
          <input name="phone" placeholder="+79990000002" />
        </div>

        <div>
          <label>Email</label>
          <input name="email" placeholder="employee@example.com" />
        </div>

        <div>
          <label>Telegram</label>
          <input name="telegramUsername" placeholder="@username" />
        </div>

        <div>
          <label>Роль</label>
          <select name="role" defaultValue="florist">
            <option value="manager">Менеджер</option>
            <option value="florist">Флорист</option>
            <option value="courier">Курьер</option>
            <option value="admin">Администратор</option>
          </select>
        </div>

        <button type="submit" disabled={isSaving}>
          {isSaving ? "Добавляем..." : "Добавить сотрудника"}
        </button>
      </form>

      {telegramLinkUrl ? (
        <div className="admin-employee-telegram-link">
          <div>
            <strong>Ссылка для привязки Telegram</strong>
            <span>Отправьте её сотруднику. После перехода бот узнает его роль.</span>
          </div>
          <button type="button" onClick={copyTelegramLink}>
            Скопировать ссылку
          </button>
        </div>
      ) : null}
    </div>
  );
}
