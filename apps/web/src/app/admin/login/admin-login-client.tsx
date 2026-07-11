"use client";

import { useState } from "react";

type LoginResponse = {
  ok?: boolean;
  message?: string;
  user?: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    role: string;
  };
};

export function AdminLoginClient() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!login.trim() || !password.trim()) {
      setMessage("Введите логин и пароль.");
      return;
    }

    setIsBusy(true);

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          login: login.trim(),
          password
        })
      });

      const data = (await response.json().catch(() => null)) as LoginResponse | null;

      if (!response.ok || !data?.ok) {
        setMessage(data?.message || "Не удалось войти.");
        setIsBusy(false);
        return;
      }

      window.location.href = "/admin";
    } catch {
      setMessage("Ошибка соединения. Попробуйте ещё раз.");
      setIsBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <span>ВМ</span>
          <div>
            <strong>ВЫБЕРИ МЕНЯ</strong>
            <p>Вход в CRM</p>
          </div>
        </div>

        <form className="admin-login-form" onSubmit={submit}>
          <label>
            <span>Телефон или email</span>
            <input
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder="Телефон или email"
              autoComplete="username"
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              type="password"
              autoComplete="current-password"
            />
          </label>

          {message ? <p className="admin-login-message">{message}</p> : null}

          <button type="submit" disabled={isBusy}>
            {isBusy ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className="admin-login-hint">
          После входа CRM покажет разделы по роли сотрудника.
        </p>
      </section>
    </main>
  );
}
