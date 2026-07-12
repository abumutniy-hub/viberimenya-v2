"use client";

import {
  useRouter
} from "next/navigation";

import {
  useState,
  type FormEvent
} from "react";

export type DeliveryZoneManagerItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  freeFromAmount: number | null;
  isExpressAvailable: boolean;
  expressPrice: number | null;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
};

function money(value: number | null) {
  if (
    value === null
    || !Number.isFinite(value)
  ) {
    return "—";
  }

  return (
    `${Math.round(value)
      .toLocaleString("ru-RU")} ₽`
  );
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

function ZoneEditor({
  zone
}: {
  zone: DeliveryZoneManagerItem;
}) {
  const router = useRouter();

  const [isExpressAvailable, setIsExpressAvailable] =
    useState(zone.isExpressAvailable);

  const [isSaving, setIsSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const isPickupService =
    zone.name
      .trim()
      .toLowerCase()
    === "самовывоз";

  async function saveZone(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setIsSaving(true);
    setMessage("");

    const form =
      new FormData(event.currentTarget);

    try {
      const response = await fetch(
        `/api/admin/delivery/zones/manage/${zone.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name: form.get("name"),
            description:
              form.get("description"),
            price:
              numberFromForm(
                form,
                "price"
              ),
            freeFromAmount:
              numberFromForm(
                form,
                "freeFromAmount"
              ),
            isExpressAvailable,
            expressPrice:
              isExpressAvailable
                ? numberFromForm(
                    form,
                    "expressPrice"
                  )
                : 0,
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
          || "Не удалось сохранить зону"
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
          : "Не удалось сохранить зону"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteZone() {
    const confirmed =
      window.confirm(
        `Удалить зону «${zone.name}»?`
      );

    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/delivery/zones/manage/${zone.id}`,
        {
          method: "DELETE"
        }
      );

      const data =
        await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message
          || "Не удалось удалить зону"
        );
      }

      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось удалить зону"
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isPickupService) {
    return (
      <article className="admin-delivery-zone-card service">
        <div className="admin-delivery-zone-card-head">
          <div>
            <span>Служебный способ получения</span>
            <h3>{zone.name}</h3>
          </div>

          <span className="admin-delivery-zone-status active">
            Активен
          </span>
        </div>

        <p>
          {zone.description
            || "Получение заказа в магазине."}
        </p>

        <div className="admin-delivery-service-note">
          Самовывоз не показывается среди зон доставки.
          Для клиента он доступен отдельным способом
          получения заказа.
        </div>
      </article>
    );
  }

  return (
    <article className="admin-delivery-zone-card">
      <div className="admin-delivery-zone-card-head">
        <div>
          <span>Зона доставки</span>
          <h3>{zone.name}</h3>
        </div>

        <span
          className={
            zone.isActive
              ? "admin-delivery-zone-status active"
              : "admin-delivery-zone-status inactive"
          }
        >
          {zone.isActive
            ? "Активна"
            : "Отключена"}
        </span>
      </div>

      <div className="admin-delivery-zone-summary">
        <div>
          <span>Обычная доставка</span>
          <strong>{money(zone.price)}</strong>
        </div>

        <div>
          <span>Бесплатно от</span>
          <strong>
            {zone.freeFromAmount
              ? money(zone.freeFromAmount)
              : "Не задано"}
          </strong>
        </div>

        <div>
          <span>Срочная доставка</span>
          <strong>
            {zone.isExpressAvailable
              ? money(zone.expressPrice)
              : "Недоступна"}
          </strong>
        </div>
      </div>

      <form
        className="admin-delivery-zone-form"
        onSubmit={saveZone}
      >
        <div className="admin-delivery-zone-fields">
          <label>
            <span>Название зоны</span>
            <input
              name="name"
              maxLength={160}
              defaultValue={zone.name}
              required
            />
          </label>

          <label>
            <span>Цена, ₽</span>
            <input
              name="price"
              type="number"
              min="0"
              defaultValue={zone.price}
              required
            />
          </label>

          <label>
            <span>Бесплатно от, ₽</span>
            <input
              name="freeFromAmount"
              type="number"
              min="0"
              defaultValue={
                zone.freeFromAmount
                ?? 0
              }
            />
            <small>
              0 — бесплатный порог не задан
            </small>
          </label>

          <label>
            <span>Цена срочной, ₽</span>
            <input
              name="expressPrice"
              type="number"
              min="0"
              defaultValue={
                zone.expressPrice
                ?? 0
              }
              disabled={
                !isExpressAvailable
              }
              required={
                isExpressAvailable
              }
            />
          </label>

          <label>
            <span>Сортировка</span>
            <input
              name="sortOrder"
              type="number"
              min="0"
              defaultValue={
                zone.sortOrder
              }
            />
          </label>

          <label className="admin-delivery-check">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={
                zone.isActive
              }
            />
            <span>Зона активна</span>
          </label>

          <label className="admin-delivery-check">
            <input
              type="checkbox"
              checked={
                isExpressAvailable
              }
              onChange={(event) => {
                setIsExpressAvailable(
                  event.target.checked
                );
              }}
            />
            <span>
              Доступна срочная доставка
            </span>
          </label>

          <label className="wide">
            <span>Описание</span>
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={
                zone.description
              }
              placeholder="Например: доставка в пределах города"
            />
          </label>
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
            disabled={isSaving}
            onClick={deleteZone}
          >
            Удалить
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

export function DeliveryZoneManager({
  zones
}: {
  zones: DeliveryZoneManagerItem[];
}) {
  const router = useRouter();

  const [isCreating, setIsCreating] =
    useState(false);

  const [
    createExpressAvailable,
    setCreateExpressAvailable
  ] = useState(false);

  const [message, setMessage] =
    useState("");

  async function createZone(
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
        "/api/admin/delivery/zones/manage",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name: form.get("name"),
            description:
              form.get("description"),
            price:
              numberFromForm(
                form,
                "price"
              ),
            freeFromAmount:
              numberFromForm(
                form,
                "freeFromAmount"
              ),
            isExpressAvailable:
              createExpressAvailable,
            expressPrice:
              createExpressAvailable
                ? numberFromForm(
                    form,
                    "expressPrice"
                  )
                : 0,
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
          || "Не удалось добавить зону"
        );
      }

      target.reset();

      setCreateExpressAvailable(
        false
      );

      setMessage("Зона добавлена");

      router.refresh();

      window.setTimeout(
        () => setMessage(""),
        1800
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось добавить зону"
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="admin-delivery-zone-manager">
      <details className="admin-delivery-create">
        <summary>
          <span>Добавить новую зону</span>
          <small>
            Стоимость, бесплатный порог
            и срочная доставка
          </small>
        </summary>

        <form
          className="admin-delivery-create-form"
          onSubmit={createZone}
        >
          <div className="admin-delivery-zone-fields">
            <label>
              <span>Название зоны</span>
              <input
                name="name"
                maxLength={160}
                placeholder="Например: Люберцы"
                required
              />
            </label>

            <label>
              <span>Цена, ₽</span>
              <input
                name="price"
                type="number"
                min="0"
                defaultValue="0"
                required
              />
            </label>

            <label>
              <span>Бесплатно от, ₽</span>
              <input
                name="freeFromAmount"
                type="number"
                min="0"
                defaultValue="0"
              />
            </label>

            <label>
              <span>Цена срочной, ₽</span>
              <input
                name="expressPrice"
                type="number"
                min="0"
                defaultValue="0"
                disabled={
                  !createExpressAvailable
                }
                required={
                  createExpressAvailable
                }
              />
            </label>

            <label>
              <span>Сортировка</span>
              <input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue="100"
              />
            </label>

            <label className="admin-delivery-check">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked
              />
              <span>Сразу активировать</span>
            </label>

            <label className="admin-delivery-check">
              <input
                type="checkbox"
                checked={
                  createExpressAvailable
                }
                onChange={(event) => {
                  setCreateExpressAvailable(
                    event.target.checked
                  );
                }}
              />
              <span>
                Есть срочная доставка
              </span>
            </label>

            <label className="wide">
              <span>Описание</span>
              <textarea
                name="description"
                maxLength={2000}
                placeholder="Какие адреса входят в эту зону"
              />
            </label>
          </div>

          <div className="admin-delivery-zone-actions">
            <button
              type="submit"
              disabled={isCreating}
            >
              {isCreating
                ? "Добавляем..."
                : "Добавить зону"}
            </button>

            {message ? (
              <span
                className={
                  message === "Зона добавлена"
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

      <div className="admin-delivery-zone-list">
        {zones.map((zone) => (
          <ZoneEditor
            key={
              `${zone.id}-${zone.updatedAt}`
            }
            zone={zone}
          />
        ))}
      </div>
    </div>
  );
}
