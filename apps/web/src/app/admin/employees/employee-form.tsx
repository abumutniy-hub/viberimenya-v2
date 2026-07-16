"use client";

import {
  useState,
  type FormEvent
} from "react";

type ApiResponse = {
  ok?: boolean;
  message?: string;
  telegramLinkCode?: string | null;
  login?: string;
};

type Credentials = {
  login: string;
  password: string;
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

export function EmployeeForm() {
  const [isSaving, setIsSaving] =
    useState(false);

  const [password, setPassword] =
    useState("");

  const [
    showPassword,
    setShowPassword
  ] = useState(false);

  const [
    credentials,
    setCredentials
  ] =
    useState<Credentials | null>(
      null
    );

  const [
    telegramCode,
    setTelegramCode
  ] = useState("");

  async function onSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const formData =
      new FormData(form);

    const payload = {
      name:
        String(
          formData.get("name") || ""
        ).trim(),

      phone:
        String(
          formData.get("phone") || ""
        ).trim(),

      email:
        String(
          formData.get("email") || ""
        ).trim(),

      role:
        String(
          formData.get("role")
          || "florist"
        ),

      telegramUsername: "",

      password:
        password.trim(),

      isActive: true
    };

    if (
      !payload.name
      || !payload.phone
    ) {
      alert(
        "Укажите имя и телефон сотрудника"
      );

      return;
    }

    if (
      !isStrongPassword(payload.password)
    ) {
      alert(
        "Пароль должен содержать минимум 10 символов, букву и цифру"
      );

      return;
    }

    setIsSaving(true);
    setCredentials(null);
    setTelegramCode("");

    try {
      const response =
        await fetch(
          "/api/admin/employees",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify(payload)
          }
        );

      const data =
        await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось создать сотрудника"
        );
      }

      setCredentials({
        login:
          data?.login
          || payload.email
          || payload.phone,

        password:
          payload.password
      });

      setTelegramCode(
        data?.telegramLinkCode || ""
      );

      form.reset();
      setPassword("");
      setShowPassword(false);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Не удалось создать сотрудника"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-employee-form-wrap">
      <form
        className="admin-employee-form"
        onSubmit={onSubmit}
      >
        <div>
          <label>Имя</label>
          <input
            name="name"
            placeholder="Например: Анна"
            required
          />
        </div>

        <div>
          <label>
            Телефон для входа
          </label>
          <input
            name="phone"
            placeholder="+79990000002"
            autoComplete="tel"
            required
          />
        </div>

        <div>
          <label>
            Email для входа
          </label>
          <input
            name="email"
            type="email"
            placeholder="employee@example.com"
            autoComplete="email"
          />
        </div>

        <div>
          <label>Роль</label>
          <select
            name="role"
            defaultValue="florist"
          >
            <option value="manager">
              Менеджер
            </option>
            <option value="florist">
              Флорист
            </option>
            <option value="courier">
              Курьер
            </option>
            <option value="admin">
              Администратор
            </option>
          </select>
        </div>

        <div>
          <label>
            Временный пароль CRM
          </label>

          <input
            type={
              showPassword
                ? "text"
                : "password"
            }
            value={password}
            onChange={event =>
              setPassword(
                event.target.value
              )
            }
            placeholder="Минимум 10 символов, буква и цифра"
            autoComplete="new-password"
            required
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
              Сгенерировать
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
        </div>

        <button
          type="submit"
          disabled={isSaving}
        >
          {isSaving
            ? "Добавляем..."
            : "Добавить сотрудника"}
        </button>
      </form>

      {credentials ? (
        <div className="admin-employee-telegram-link">
          <div>
            <strong>
              Данные для входа в CRM
            </strong>

            <span>
              Логин:{" "}
              {credentials.login}
            </span>

            <span>
              Пароль:{" "}
              {credentials.password}
            </span>

            <span>
              viberimenya.ru/admin/login
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              void copyText(
                [
                  "Вход в CRM:",
                  "https://viberimenya.ru/admin/login",
                  `Логин: ${credentials.login}`,
                  `Пароль: ${credentials.password}`
                ].join("\n"),
                "Данные для входа"
              )
            }
          >
            Скопировать доступ
          </button>
        </div>
      ) : null}

      {telegramCode ? (
        <div className="admin-employee-telegram-link">
          <div>
            <strong>
              Код привязки Telegram
            </strong>

            <span>
              Код действует 10 минут.
            </span>

            <span>
              Код: {telegramCode}
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              void copyText(
                telegramCode,
                "Telegram-код"
              )
            }
          >
            Скопировать код
          </button>
        </div>
      ) : null}
    </div>
  );
}
