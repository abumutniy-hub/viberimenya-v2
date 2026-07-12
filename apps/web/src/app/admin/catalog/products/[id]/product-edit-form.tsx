"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

type CategoryOption = {
  id: string;
  name: string;
};

type EditableProduct = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  composition: string;
  careText: string;
  price: number;
  oldPrice: number | null;
  costPrice: number | null;
  stockQuantity: number;
  status: "draft" | "active" | "hidden" | "archived";
  isFeatured: boolean;
  sortOrder: number;
};

type ProductEditFormProps = {
  product: EditableProduct;
  categories: CategoryOption[];
};

function nullableNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const number = Number(raw);

  if (!Number.isFinite(number)) {
    throw new Error("Введите корректное числовое значение");
  }

  return Math.round(number);
}

async function readError(response: Response) {
  try {
    const data = await response.json() as {
      message?: unknown;
      error?: unknown;
    };

    const message = String(
      data.message
      ?? data.error
      ?? ""
    ).trim();

    if (message) {
      return message;
    }
  } catch {
    // Сервер мог вернуть не JSON.
  }

  return `Ошибка сохранения: HTTP ${response.status}`;
}

export function ProductEditForm({
  product,
  categories
}: ProductEditFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [stockValue, setStockValue] = useState(
    String(product.stockQuantity)
  );
  const [message, setMessage] = useState("");

  const customerAvailability = useMemo(() => {
    const stock = Number(stockValue);

    return Number.isFinite(stock) && stock > 0
      ? "В наличии"
      : "Нет в наличии";
  }, [stockValue]);

  useEffect(() => {
    const handleBeforeUnload = (
      event: BeforeUnloadEvent
    ) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
    };
  }, [isDirty]);

  function markDirty() {
    setIsDirty(true);
    setMessage("");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const nextStatus = String(
      form.get("status") ?? "draft"
    ) as EditableProduct["status"];

    if (
      nextStatus === "archived"
      && product.status !== "archived"
    ) {
      const confirmed = window.confirm(
        "Архивный товар исчезнет из публичного каталога. Продолжить?"
      );

      if (!confirmed) {
        return;
      }
    }

    setIsSaving(true);
    setMessage("");

    try {
      const price = nullableNumber(form.get("price"));
      const oldPrice = nullableNumber(
        form.get("oldPrice")
      );
      const costPrice = nullableNumber(
        form.get("costPrice")
      );
      const stockQuantity = nullableNumber(
        form.get("stockQuantity")
      );
      const sortOrder = nullableNumber(
        form.get("sortOrder")
      );

      if (price === null || price < 0) {
        throw new Error("Укажите корректную цену");
      }

      if (
        stockQuantity === null
        || stockQuantity < 0
      ) {
        throw new Error(
          "Внутренний остаток не может быть отрицательным"
        );
      }

      if (sortOrder === null) {
        throw new Error(
          "Укажите порядок сортировки"
        );
      }

      if (
        oldPrice !== null
        && oldPrice <= price
      ) {
        throw new Error(
          "Старая цена должна быть выше текущей"
        );
      }

      const response = await fetch(
        `/api/admin/products/${product.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            categoryId: String(
              form.get("categoryId") ?? ""
            ),
            name: String(
              form.get("name") ?? ""
            ),
            slug: String(
              form.get("slug") ?? ""
            ),
            shortDescription: String(
              form.get("shortDescription") ?? ""
            ),
            description: String(
              form.get("description") ?? ""
            ),
            composition: String(
              form.get("composition") ?? ""
            ),
            careText: String(
              form.get("careText") ?? ""
            ),
            price,
            oldPrice,
            costPrice,
            stockQuantity,
            status: nextStatus,
            isFeatured:
              form.get("isFeatured") === "on",
            sortOrder
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      setIsDirty(false);
      setMessage("Изменения сохранены");

      window.setTimeout(() => {
        window.location.reload();
      }, 350);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить товар"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="admin-product-edit-form"
      onSubmit={handleSubmit}
      onChange={markDirty}
    >
      <div className="admin-product-edit-grid">
        <label className="wide">
          <span>Название товара</span>
          <input
            name="name"
            defaultValue={product.name}
            minLength={2}
            maxLength={255}
            required
          />
        </label>

        <label>
          <span>Slug</span>
          <input
            name="slug"
            defaultValue={product.slug}
            placeholder="korolevskiy-buket"
            maxLength={160}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            title="Латинские буквы, цифры и дефисы"
          />
          <small>
            Используется в адресе публичной карточки.
          </small>
        </label>

        <label>
          <span>Категория</span>
          <select
            name="categoryId"
            defaultValue={product.categoryId}
          >
            <option value="">Без категории</option>

            {categories.map((category) => (
              <option
                key={category.id}
                value={category.id}
              >
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Статус товара</span>
          <select
            name="status"
            defaultValue={product.status}
          >
            <option value="active">
              Опубликован
            </option>
            <option value="draft">
              Черновик
            </option>
            <option value="hidden">
              Скрыт
            </option>
            <option value="archived">
              Архив
            </option>
          </select>
        </label>

        <label>
          <span>Цена, ₽</span>
          <input
            name="price"
            type="number"
            min="0"
            step="1"
            defaultValue={product.price}
            required
          />
        </label>

        <label>
          <span>Старая цена, ₽</span>
          <input
            name="oldPrice"
            type="number"
            min="0"
            step="1"
            defaultValue={
              product.oldPrice ?? ""
            }
            placeholder="Не указана"
          />
          <small>
            Заполняется только для отображения скидки.
          </small>
        </label>

        <label>
          <span>Себестоимость, ₽</span>
          <input
            name="costPrice"
            type="number"
            min="0"
            step="1"
            defaultValue={
              product.costPrice ?? ""
            }
            placeholder="Только для CRM"
          />
          <small>
            Покупателю не показывается.
          </small>
        </label>

        <label>
          <span>Внутренний остаток</span>
          <input
            name="stockQuantity"
            type="number"
            min="0"
            step="1"
            value={stockValue}
            onChange={(event) => {
              setStockValue(event.target.value);
              markDirty();
            }}
            required
          />
          <small>
            Клиент видит только наличие, без количества.
            Установите 0 для статуса «Нет в наличии».
          </small>
        </label>

        <div className="admin-product-availability-preview">
          <span>Клиент увидит</span>
          <strong
            className={
              customerAvailability === "В наличии"
                ? "available"
                : "unavailable"
            }
          >
            {customerAvailability}
          </strong>
        </div>

        <label>
          <span>Порядок сортировки</span>
          <input
            name="sortOrder"
            type="number"
            step="1"
            defaultValue={product.sortOrder}
            required
          />
          <small>
            Меньшее число отображается раньше.
          </small>
        </label>

        <label className="admin-product-edit-checkbox">
          <input
            name="isFeatured"
            type="checkbox"
            defaultChecked={product.isFeatured}
          />
          <span>Показывать в блоке «Хиты продаж»</span>
        </label>

        <label className="wide">
          <span>Короткое описание</span>
          <textarea
            name="shortDescription"
            defaultValue={product.shortDescription}
            maxLength={2000}
            rows={3}
          />
        </label>

        <label className="wide">
          <span>Полное описание</span>
          <textarea
            name="description"
            defaultValue={product.description}
            maxLength={20000}
            rows={6}
          />
        </label>

        <label className="wide">
          <span>Состав</span>
          <textarea
            name="composition"
            defaultValue={product.composition}
            maxLength={10000}
            rows={4}
          />
        </label>

        <label className="wide">
          <span>Рекомендации по уходу</span>
          <textarea
            name="careText"
            defaultValue={product.careText}
            maxLength={10000}
            rows={4}
          />
        </label>
      </div>

      <div className="admin-product-edit-footer">
        <div>
          {isDirty ? (
            <span className="unsaved">
              Есть несохранённые изменения
            </span>
          ) : (
            <span>
              Все изменения сохранены
            </span>
          )}

          {message ? (
            <strong>{message}</strong>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isSaving || !isDirty}
        >
          {isSaving
            ? "Сохраняем..."
            : "Сохранить изменения"}
        </button>
      </div>
    </form>
  );
}
