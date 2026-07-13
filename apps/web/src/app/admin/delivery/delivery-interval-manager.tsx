"use client";

import {
  useRouter
} from "next/navigation";

import {
  useMemo,
  useState,
  type FormEvent
} from "react";

export type DeliveryIntervalManagerItem = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  sortOrder: number;
  ordersCount: number;
  updatedAt: string;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
};

function intervalName(
  startsAt: string,
  endsAt: string
) {
  if (
    !startsAt
    || !endsAt
  ) {
    return "Выберите время";
  }

  return `${startsAt}–${endsAt}`;
}

function numberFromForm(
  form: FormData,
  name: string
) {
  const value =
    Number(form.get(name) ?? 0);

  return Number.isFinite(value)
    ? Math.round(value)
    : 0;
}

async function readResponse(
  response: Response
) {
  return (
    await response
      .json()
      .catch(() => null)
  ) as ApiResponse | null;
}

function IntervalEditor({
  interval
}: {
  interval: DeliveryIntervalManagerItem;
}) {
  const router = useRouter();

  const [startsAt, setStartsAt] =
    useState(interval.startsAt);

  const [endsAt, setEndsAt] =
    useState(interval.endsAt);

  const [isSaving, setIsSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const preview = useMemo(
    () =>
      intervalName(
        startsAt,
        endsAt
      ),
    [
      startsAt,
      endsAt
    ]
  );

  async function saveInterval(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setIsSaving(true);
    setMessage("");

    const form =
      new FormData(event.currentTarget);

    try {
      const response = await fetch(
        `/api/admin/delivery/intervals/manage/${interval.id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            startsAt,
            endsAt,

            isActive:
              form.get("isActive")
              === "on",

            sortOrder:
              numberFromForm(
                form,
                "sortOrder"
              )
          })
        }
      );

      const data =
        await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось сохранить интервал"
        );
      }

      setMessage("Изменения сохранены");
      router.refresh();

      window.setTimeout(
        () => setMessage(""),
        1800
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить интервал"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteInterval() {
    const confirmed =
      window.confirm(
        `Удалить интервал «${interval.name}»?`
      );

    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/delivery/intervals/manage/${interval.id}`,
        {
          method: "DELETE"
        }
      );

      const data =
        await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось удалить интервал"
        );
      }

      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось удалить интервал"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="admin-delivery-interval-card">
      <div className="admin-delivery-interval-card-head">
        <div className="admin-delivery-interval-time">
          <span>Интервал доставки</span>
          <h3>{preview}</h3>
        </div>

        <div className="admin-delivery-interval-badges">
          <span
            className={
              interval.isActive
                ? "admin-delivery-zone-status active"
                : "admin-delivery-zone-status inactive"
            }
          >
            {interval.isActive
              ? "Активен"
              : "Отключён"}
          </span>

          {interval.ordersCount > 0 ? (
            <span className="admin-delivery-interval-orders">
              Заказов: {interval.ordersCount}
            </span>
          ) : null}
        </div>
      </div>

      <form
        className="admin-delivery-interval-form"
        onSubmit={saveInterval}
      >
        <div className="admin-delivery-interval-fields">
          <label>
            <span>Начало</span>

            <input
              name="startsAt"
              type="time"
              value={startsAt}
              onChange={(event) => {
                setStartsAt(
                  event.target.value
                );
              }}
              required
            />
          </label>

          <label>
            <span>Окончание</span>

            <input
              name="endsAt"
              type="time"
              value={endsAt}
              onChange={(event) => {
                setEndsAt(
                  event.target.value
                );
              }}
              required
            />
          </label>

          <label>
            <span>Сортировка</span>

            <input
              name="sortOrder"
              type="number"
              min="0"
              defaultValue={
                interval.sortOrder
              }
              required
            />
          </label>

          <label className="admin-delivery-check">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={
                interval.isActive
              }
            />

            <span>
              Доступен клиентам
            </span>
          </label>
        </div>

        <div className="admin-delivery-interval-preview">
          <span>
            Название формируется автоматически
          </span>

          <strong>{preview}</strong>
        </div>

        <div className="admin-delivery-zone-actions">
          <button
            type="submit"
            disabled={isSaving}
          >
            {isSaving
              ? "Сохраняем..."
              : "Сохранить изменения"}
          </button>

          <button
            className="danger"
            type="button"
            disabled={
              isSaving
              || interval.ordersCount > 0
            }
            onClick={deleteInterval}
            title={
              interval.ordersCount > 0
                ? "Интервал используется в заказах"
                : "Удалить интервал"
            }
          >
            {interval.ordersCount > 0
              ? "Используется в заказах"
              : "Удалить"}
          </button>

          {message ? (
            <span
              className={
                message
                  === "Изменения сохранены"
                  ? "success"
                  : "error"
              }
            >
              {message}
            </span>
          ) : null}
        </div>
      </form>
    </article>
  );
}

export function DeliveryIntervalManager({
  intervals
}: {
  intervals: DeliveryIntervalManagerItem[];
}) {
  const router = useRouter();

  const [startsAt, setStartsAt] =
    useState("");

  const [endsAt, setEndsAt] =
    useState("");

  const [isCreating, setIsCreating] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const preview = useMemo(
    () =>
      intervalName(
        startsAt,
        endsAt
      ),
    [
      startsAt,
      endsAt
    ]
  );

  async function createInterval(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setIsCreating(true);
    setMessage("");

    const target =
      event.currentTarget;

    const form =
      new FormData(target);

    try {
      const response = await fetch(
        "/api/admin/delivery/intervals/manage",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            startsAt,
            endsAt,

            isActive:
              form.get("isActive")
              === "on",

            sortOrder:
              numberFromForm(
                form,
                "sortOrder"
              )
          })
        }
      );

      const data =
        await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось добавить интервал"
        );
      }

      target.reset();

      setStartsAt("");
      setEndsAt("");
      setMessage("Интервал добавлен");

      router.refresh();

      window.setTimeout(
        () => setMessage(""),
        1800
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось добавить интервал"
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="admin-delivery-interval-manager">
      <details className="admin-delivery-create">
        <summary>
          <span>Добавить новый интервал</span>

          <small>
            Название будет создано автоматически
          </small>
        </summary>

        <form
          className="admin-delivery-interval-create"
          onSubmit={createInterval}
        >
          <div className="admin-delivery-interval-fields">
            <label>
              <span>Начало</span>

              <input
                name="startsAt"
                type="time"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(
                    event.target.value
                  );
                }}
                required
              />
            </label>

            <label>
              <span>Окончание</span>

              <input
                name="endsAt"
                type="time"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(
                    event.target.value
                  );
                }}
                required
              />
            </label>

            <label>
              <span>Сортировка</span>

              <input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue="100"
                required
              />
            </label>

            <label className="admin-delivery-check">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked
              />

              <span>
                Сразу активировать
              </span>
            </label>
          </div>

          <div className="admin-delivery-interval-preview">
            <span>Будет создан интервал</span>
            <strong>{preview}</strong>
          </div>

          <div className="admin-delivery-zone-actions">
            <button
              type="submit"
              disabled={isCreating}
            >
              {isCreating
                ? "Добавляем..."
                : "Добавить интервал"}
            </button>

            {message ? (
              <span
                className={
                  message
                    === "Интервал добавлен"
                    ? "success"
                    : "error"
                }
              >
                {message}
              </span>
            ) : null}
          </div>
        </form>
      </details>

      <div className="admin-delivery-interval-list">
        {intervals.length > 0 ? (
          intervals.map((interval) => (
            <IntervalEditor
              key={
                `${interval.id}-${interval.updatedAt}`
              }
              interval={interval}
            />
          ))
        ) : (
          <div className="admin-delivery-interval-empty">
            Интервалы пока не добавлены.
          </div>
        )}
      </div>
    </div>
  );
}
