"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";

type CategoryOption = {
  id: string;
  name: string;
};

type ProductAvailability =
  | "available"
  | "preorder"
  | "unavailable";

type ProductType =
  | "bouquet"
  | "arrangement"
  | "flowers"
  | "card"
  | "gift"
  | "sweets"
  | "toy"
  | "vase"
  | "balloon"
  | "perfume"
  | "other";

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
  availability: ProductAvailability;
  productType: ProductType;
  status: "draft" | "active" | "hidden" | "archived";
  isFeatured: boolean;
  sortOrder: number;
};

type ProductEditFormProps = {
  product: EditableProduct;
  categories: CategoryOption[];
};

const availabilityLabels: Record<
  ProductAvailability,
  string
> = {
  available: "Есть в наличии",
  preorder: "Под заказ",
  unavailable: "Нет в наличии"
};

const productTypeOptions: Array<{
  value: ProductType;
  label: string;
}> = [
  { value: "bouquet", label: "Букет" },
  { value: "arrangement", label: "Композиция / корзина / коробка" },
  { value: "flowers", label: "Цветы / монобукет" },
  { value: "card", label: "Открытка / конверт" },
  { value: "gift", label: "Подарок" },
  { value: "sweets", label: "Конфеты / сладости" },
  { value: "toy", label: "Мягкая игрушка" },
  { value: "vase", label: "Ваза" },
  { value: "balloon", label: "Воздушные шары" },
  { value: "perfume", label: "Парфюм" },
  { value: "other", label: "Другое" }
];

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

function cleanImportedText(
  value: string,
  productName: string
) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;

  let result = textarea.value
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*/g, ". ")
    .trim();

  result = result
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !(
      /заказать цветы|доставка цветов|доставк[а-я]* недорого|по россии|бесплатн/i
        .test(sentence)
    ))
    .join(" ")
    .trim();

  const normalizedName = productName
    .trim()
    .toLocaleLowerCase("ru-RU");

  if (
    result.toLocaleLowerCase("ru-RU") === normalizedName
    || /^\d+(?:[.,]\d+)?$/.test(result)
  ) {
    return "";
  }

  return result
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?]){2,}/g, "$1")
    .trim();
}

export function ProductEditForm({
  product,
  categories
}: ProductEditFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [availability, setAvailability] =
    useState<ProductAvailability>(product.availability);
  const [productType, setProductType] =
    useState<ProductType>(product.productType);
  const [stockValue, setStockValue] = useState(
    String(product.stockQuantity)
  );
  const [message, setMessage] = useState("");

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

  function cleanDescriptions() {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const nameInput = form.elements.namedItem("name");
    const shortInput = form.elements.namedItem("shortDescription");
    const fullInput = form.elements.namedItem("description");

    if (!(nameInput instanceof HTMLInputElement)) {
      return;
    }

    const productName = nameInput.value.trim();

    if (shortInput instanceof HTMLTextAreaElement) {
      shortInput.value = cleanImportedText(
        shortInput.value,
        productName
      );
    }

    if (fullInput instanceof HTMLTextAreaElement) {
      fullInput.value = cleanImportedText(
        fullInput.value,
        productName
      );
    }

    markDirty();
    setMessage(
      "Импортированный рекламный текст очищен. Проверьте результат и сохраните."
    );
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
      const rawOldPrice = nullableNumber(form.get("oldPrice"));
      const oldPrice = (
        rawOldPrice !== null
        && rawOldPrice > 0
      )
        ? rawOldPrice
        : null;
      const costPrice = nullableNumber(form.get("costPrice"));
      const rawStockQuantity = nullableNumber(
        form.get("stockQuantity")
      );
      const stockQuantity = Math.max(
        0,
        rawStockQuantity ?? 0
      );
      const sortOrder = nullableNumber(
        form.get("sortOrder")
      );

      if (price === null || price < 0) {
        throw new Error("Укажите корректную цену");
      }

      if (sortOrder === null) {
        throw new Error("Укажите порядок сортировки");
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
            name: String(form.get("name") ?? ""),
            slug: String(form.get("slug") ?? ""),
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
            availability,
            productType,
            status: nextStatus,
            isFeatured:
              form.get("isFeatured") === "on",
            sortOrder
          })
        }
      );

      if (!response.ok) {
        throw new Error(await readError(response));
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
      ref={formRef}
      className="admin-product-edit-form"
      onSubmit={handleSubmit}
      onChange={markDirty}
    >
      <div className="admin-product-edit-tools">
        <div>
          <strong>Карточка товара</strong>
          <span>
            Основные параметры, видимость и текст витрины.
          </span>
        </div>

        <button
          type="button"
          onClick={cleanDescriptions}
        >
          Очистить импортированный текст
        </button>
      </div>

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
          <span>Тип товара</span>
          <select
            name="productType"
            value={productType}
            onChange={(event) => {
              setProductType(
                event.target.value as ProductType
              );
              markDirty();
            }}
          >
            {productTypeOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
          <small>
            Определяет подписи, состав и рекомендации на сайте.
          </small>
        </label>

        <label>
          <span>Наличие для покупателя</span>
          <select
            name="availability"
            value={availability}
            onChange={(event) => {
              setAvailability(
                event.target.value as ProductAvailability
              );
              markDirty();
            }}
          >
            <option value="available">
              Есть в наличии
            </option>
            <option value="preorder">
              Под заказ
            </option>
            <option value="unavailable">
              Нет в наличии
            </option>
          </select>
          <small>
            Покупатель не видит точное количество.
          </small>
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
            <option value="active">Опубликован</option>
            <option value="draft">Черновик</option>
            <option value="hidden">Скрыт</option>
            <option value="archived">Архив</option>
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
            defaultValue={product.oldPrice ?? ""}
            placeholder="Не указана"
          />
          <small>
            Необязательна. Оставьте пустой, если скидки нет.
          </small>
        </label>

        <label>
          <span>Себестоимость, ₽</span>
          <input
            name="costPrice"
            type="number"
            min="0"
            step="1"
            defaultValue={product.costPrice ?? ""}
            placeholder="Только для CRM"
          />
        </label>

        <div className="admin-product-availability-preview">
          <span>Клиент увидит</span>
          <strong className={availability}>
            {availabilityLabels[availability]}
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

        <details className="admin-product-stock-details wide">
          <summary>
            Расширенный складской учёт
          </summary>
          <div>
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
              />
              <small>
                Для обычных букетов достаточно переключателя наличия выше.
                Количество пригодится для штучных подарков и вариантов.
              </small>
            </label>
          </div>
        </details>

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
          <span>Состав / характеристики</span>
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
          <small>
            Для открыток, подарков и других дополнений поле можно оставить пустым.
          </small>
        </label>
      </div>

      <div className="admin-product-edit-footer">
        <div>
          {isDirty ? (
            <span className="unsaved">
              Есть несохранённые изменения
            </span>
          ) : (
            <span>Все изменения сохранены</span>
          )}

          {message ? <strong>{message}</strong> : null}
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
