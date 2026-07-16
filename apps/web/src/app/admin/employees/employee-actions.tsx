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
  telegramLinkCode: string;
  linkedTelegramText: string;
  lastLoginAt: string;
  activeSessions: number;
  hasPassword: boolean;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  telegramLinkCode?: string;
  revokedSessions?: number;
  accessChanged?: boolean;
};

async function readApiResponse(
  response: Response
): Promise<ApiResponse | null> {
  return (
    await response
      .json()
      .catch(() => null)
  ) as ApiResponse | null;
}

const roleOptions = [
  {
    value: "admin",
    label: "Администратор"
  },
  {
    value: "manager",
    label: "Менеджер"
  },
  {
    value: "florist",
    label: "Флорист"
  },
  {
    value: "courier",
    label: "Курьер"
  }
];

function generatePassword() {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%"
  ];
  const alphabet = groups.join("");
  const values = new Uint32Array(16);

  crypto.getRandomValues(values);

  const characters = groups.map(
    (group, index) =>
      group[(values[index] ?? 0) % group.length] ?? "A"
  );

  for (let index = groups.length; index < values.length; index += 1) {
    characters.push(
      alphabet[(values[index] ?? 0) % alphabet.length] ?? "B"
    );
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = (values[index] ?? 0) % (index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex] ?? "A",
      characters[index] ?? "B"
    ];
  }

  return characters.join("");
}

function isStrongPassword(value: string) {
  return (
    value.length >= 10
    && /[A-Za-zА-Яа-я]/.test(value)
    && /\d/.test(value)
  );
}

function lastLoginText(value: string) {
  if (!value) {
    return "Никогда не входил";
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return value;
  }

  return date.toLocaleString(
    "ru-RU",
    {
      timeZone: "Europe/Moscow",
      dateStyle: "short",
      timeStyle: "short"
    }
  );
}

async function copyText(
  value: string,
  label: string
) {
  try {
    await navigator.clipboard.writeText(
      value
    );

    alert(`${label} скопирован`);
  } catch {
    window.prompt(
      `Скопируйте ${label.toLowerCase()}:`,
      value
    );
  }
}

export function EmployeeActions(
  props: Props
) {
  const [
    isEditing,
    setIsEditing
  ] = useState(false);

  const [
    isBusy,
    setIsBusy
  ] = useState(false);

  const [
    linkCode,
    setLinkCode
  ] = useState(
    props.telegramLinkCode
  );

  const [name, setName] =
    useState(props.name);

  const [phone, setPhone] =
    useState(props.phone);

  const [email, setEmail] =
    useState(props.email);

  const [password, setPassword] =
    useState("");

  const [
    showPassword,
    setShowPassword
  ] = useState(false);

  const [role, setRole] =
    useState(
      props.role === "owner"
        ? "admin"
        : props.role
    );

  const [
    isActive,
    setIsActive
  ] = useState(
    props.isActive
  );

  async function createTelegramCode() {
    setIsBusy(true);

    try {
      const response =
        await fetch(
          `/api/admin/employees/${props.employeeId}/telegram-link`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: "{}"
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось создать Telegram-код"
        );
      }

      setLinkCode(
        data?.telegramLinkCode || ""
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось создать Telegram-код"
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function disconnectTelegram() {
    const confirmed =
      window.confirm(
        "Отключить Telegram у сотрудника?"
      );

    if (!confirmed) return;

    setIsBusy(true);

    try {
      const response =
        await fetch(
          `/api/admin/employees/${props.employeeId}/telegram-link`,
          {
            method: "DELETE"
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось отключить Telegram"
        );
      }

      window.location.reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось отключить Telegram"
      );

      setIsBusy(false);
    }
  }

  async function revokeSessions() {
    const confirmed =
      window.confirm(
        "Завершить все активные сеансы CRM сотрудника?"
      );

    if (!confirmed) return;

    setIsBusy(true);

    try {
      const response =
        await fetch(
          `/api/admin/employees/${props.employeeId}/revoke-sessions`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: "{}"
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось завершить сеансы"
        );
      }

      alert(
        `Завершено сеансов: ${
          Number(
            data?.revokedSessions || 0
          )
        }`
      );

      window.location.reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось завершить сеансы"
      );

      setIsBusy(false);
    }
  }

  async function saveEmployee() {
    if (
      !name.trim()
      || !phone.trim()
    ) {
      alert(
        "Укажите имя и телефон сотрудника"
      );

      return;
    }

    if (
      password.trim()
      && !isStrongPassword(password.trim())
    ) {
      alert(
        "Новый пароль должен содержать минимум 10 символов, букву и цифру"
      );

      return;
    }

    setIsBusy(true);

    try {
      const response =
        await fetch(
          `/api/admin/employees/${props.employeeId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              name: name.trim(),
              phone: phone.trim(),
              email: email.trim(),
              telegramUsername: "",
              password:
                password.trim(),
              role,
              isActive
            })
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось сохранить сотрудника"
        );
      }

      if (
        Number(
          data?.revokedSessions || 0
        ) > 0
      ) {
        alert(
          "Данные сохранены. Старые сеансы сотрудника завершены."
        );
      }

      window.location.reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить сотрудника"
      );

      setIsBusy(false);
    }
  }

  async function disableEmployee() {
    const confirmed =
      window.confirm(
        "Отключить сотрудника? CRM-сессии и Telegram будут отключены."
      );

    if (!confirmed) return;

    setIsBusy(true);

    try {
      const response =
        await fetch(
          `/api/admin/employees/${props.employeeId}`,
          {
            method: "DELETE"
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось отключить сотрудника"
        );
      }

      window.location.reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось отключить сотрудника"
      );

      setIsBusy(false);
    }
  }

  return (
    <div className="admin-employee-actions">
      <div className="admin-employee-telegram-status">
        <span>
          Пароль:{" "}
          {props.hasPassword
            ? "установлен"
            : "не установлен"}
        </span>

        <span>
          Последний вход:{" "}
          {lastLoginText(
            props.lastLoginAt
          )}
        </span>

        <span>
          Активных сеансов:{" "}
          {props.activeSessions}
        </span>

        <span>
          Telegram:{" "}
          {props.linkedTelegramText
            || "не привязан"}
        </span>
      </div>

      {linkCode ? (
        <div className="admin-employee-link-box">
          <input
            value={linkCode}
            readOnly
            onFocus={event =>
              event.currentTarget.select()
            }
          />

          <button
            type="button"
            onClick={() =>
              void copyText(
                linkCode,
                "Telegram-код"
              )
            }
          >
            Скопировать код
          </button>
        </div>
      ) : null}

      {props.canManage ? (
        <>
          <div className="admin-employee-action-row">
            <button
              type="button"
              onClick={
                createTelegramCode
              }
              disabled={
                isBusy
                || !props.isActive
              }
            >
              Новый Telegram-код
            </button>

            {props.linkedTelegramText ? (
              <button
                type="button"
                className="danger"
                onClick={
                  disconnectTelegram
                }
                disabled={isBusy}
              >
                Отключить Telegram
              </button>
            ) : null}

            {props.activeSessions > 0 ? (
              <button
                type="button"
                onClick={revokeSessions}
                disabled={isBusy}
              >
                Завершить сеансы
              </button>
            ) : null}

            <button
              type="button"
              onClick={() =>
                setIsEditing(
                  value => !value
                )
              }
              disabled={isBusy}
            >
              {isEditing
                ? "Закрыть"
                : "Редактировать"}
            </button>

            <button
              type="button"
              className="danger"
              onClick={
                disableEmployee
              }
              disabled={isBusy}
            >
              Отключить
            </button>
          </div>

          {isEditing ? (
            <div className="admin-employee-edit">
              <input
                value={name}
                onChange={event =>
                  setName(
                    event.target.value
                  )
                }
                placeholder="Имя"
              />

              <input
                value={phone}
                onChange={event =>
                  setPhone(
                    event.target.value
                  )
                }
                placeholder="Телефон для входа"
              />

              <input
                value={email}
                onChange={event =>
                  setEmail(
                    event.target.value
                  )
                }
                placeholder="Email для входа"
                type="email"
              />

              <input
                value={password}
                onChange={event =>
                  setPassword(
                    event.target.value
                  )
                }
                placeholder="Новый пароль — минимум 8 символов"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                autoComplete="new-password"
              />

              <div className="admin-employee-action-row">
                <button
                  type="button"
                  onClick={() => {
                    const generated =
                      generatePassword();

                    setPassword(generated);
                    setShowPassword(true);
                  }}
                >
                  Сгенерировать пароль
                </button>

                <button
                  type="button"
                  disabled={!password}
                  onClick={() =>
                    void copyText(
                      password,
                      "Пароль"
                    )
                  }
                >
                  Скопировать
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      value => !value
                    )
                  }
                >
                  {showPassword
                    ? "Скрыть"
                    : "Показать"}
                </button>
              </div>

              <select
                value={role}
                onChange={event =>
                  setRole(
                    event.target.value
                  )
                }
              >
                {roleOptions.map(
                  option => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>

              <label>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={event =>
                    setIsActive(
                      event.target.checked
                    )
                  }
                />
                Активен
              </label>

              <button
                type="button"
                onClick={saveEmployee}
                disabled={isBusy}
              >
                {isBusy
                  ? "Сохраняем..."
                  : "Сохранить"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
