"use client";

import { useEffect, useState } from "react";

type CategoryOption = {
  id: string;
  name: string;
};

type ProductOption = {
  id: string;
  name: string;
  primaryImageUrl?: string;
  imagesCount?: number;
};

type SettingsData = {
  phone?: unknown;
  whatsapp?: unknown;
  telegram?: unknown;
  instagram?: unknown;
  address?: unknown;
  work_hours?: unknown;
  hero_title?: unknown;
  hero_subtitle?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Не удалось прочитать файл"));
      }
    };

    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function loadCreateProductImage(
  dataUrl: string
) {
  return new Promise<HTMLImageElement>(
    (resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);

      image.onerror = () => {
        reject(
          new Error(
            "Браузер не смог открыть выбранную фотографию"
          )
        );
      };

      image.src = dataUrl;
    }
  );
}

function createProductCanvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(
            new Error(
              "Не удалось подготовить фотографию"
            )
          );
        }
      },
      type,
      quality
    );
  });
}

async function prepareCreateProductImage(
  file: File
) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      "Выберите фотографию JPG, PNG или WebP"
    );
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error(
      "Исходная фотография должна быть не больше 20 МБ"
    );
  }

  const sourceDataUrl =
    await readFileAsDataUrl(file);

  const image =
    await loadCreateProductImage(sourceDataUrl);

  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(
      "Не удалось определить размер фотографии"
    );
  }

  const maximumDimension = 2400;

  const initialScale = Math.min(
    1,
    maximumDimension / Math.max(
      image.naturalWidth,
      image.naturalHeight
    )
  );

  let width = Math.max(
    1,
    Math.round(
      image.naturalWidth * initialScale
    )
  );

  let height = Math.max(
    1,
    Math.round(
      image.naturalHeight * initialScale
    )
  );

  let quality = 0.88;
  let result: Blob | null = null;

  for (
    let attempt = 0;
    attempt < 8;
    attempt += 1
  ) {
    const canvas =
      document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "Браузер не поддерживает обработку фотографий"
      );
    }

    context.fillStyle = "#ffffff";
    context.fillRect(
      0,
      0,
      width,
      height
    );

    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    try {
      result = await createProductCanvasBlob(
        canvas,
        "image/webp",
        quality
      );
    } catch {
      result = await createProductCanvasBlob(
        canvas,
        "image/jpeg",
        quality
      );
    }

    if (result.size <= 3.5 * 1024 * 1024) {
      return {
        imageData:
          await readFileAsDataUrl(result),
        processedSize: result.size,
        width,
        height
      };
    }

    if (quality > 0.68) {
      quality -= 0.07;
    } else {
      width = Math.max(
        800,
        Math.round(width * 0.82)
      );

      height = Math.max(
        800,
        Math.round(height * 0.82)
      );

      quality = 0.82;
    }
  }

  if (
    !result
    || result.size > 5 * 1024 * 1024
  ) {
    throw new Error(
      "Фотографию не удалось уменьшить до допустимого размера"
    );
  }

  return {
    imageData:
      await readFileAsDataUrl(result),
    processedSize: result.size,
    width,
    height
  };
}

async function readCreateProductError(
  response: Response
) {
  try {
    const data = await response.json() as {
      message?: unknown;
      error?: unknown;
      code?: unknown;
    };

    const message = String(
      data.message
      ?? data.error
      ?? data.code
      ?? ""
    ).trim();

    if (message) {
      return message;
    }
  } catch {
    // Ответ мог быть не JSON.
  }

  return `Ошибка: HTTP ${response.status}`;
}

function formatCreateProductFileSize(
  bytes: number
) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} КБ`;
  }

  return `${(
    bytes / 1024 / 1024
  ).toFixed(1)} МБ`;
}

type ProductCreateResponse = {
  product?: {
    id?: unknown;
    name?: unknown;
  } | null;
};

async function submitJson(path: string, data: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Ошибка сохранения");
  }

  return response.json();
}

export function SettingsForm({ settings }: { settings: SettingsData | null }) {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/settings", {
            phone: form.get("phone"),
            whatsapp: form.get("whatsapp"),
            telegram: form.get("telegram"),
            instagram: form.get("instagram"),
            address: form.get("address"),
            workHours: form.get("workHours"),
            heroTitle: form.get("heroTitle"),
            heroSubtitle: form.get("heroSubtitle")
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Телефон</span>
          <input name="phone" defaultValue={stringValue(settings?.phone)} />
        </label>

        <label>
          <span>WhatsApp</span>
          <input name="whatsapp" defaultValue={stringValue(settings?.whatsapp)} />
        </label>

        <label>
          <span>Telegram</span>
          <input name="telegram" defaultValue={stringValue(settings?.telegram)} />
        </label>

        <label>
          <span>Instagram</span>
          <input name="instagram" defaultValue={stringValue(settings?.instagram)} />
        </label>

        <label className="wide">
          <span>Адрес</span>
          <input name="address" defaultValue={stringValue(settings?.address)} />
        </label>

        <label>
          <span>График</span>
          <input name="workHours" defaultValue={stringValue(settings?.work_hours)} />
        </label>

        <label className="wide">
          <span>Заголовок главной</span>
          <input name="heroTitle" defaultValue={stringValue(settings?.hero_title)} />
        </label>

        <label className="wide">
          <span>Подзаголовок главной</span>
          <textarea name="heroSubtitle" defaultValue={stringValue(settings?.hero_subtitle)} />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Сохранить настройки"}
      </button>
    </form>
  );
}

export function CategoryForm() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/categories", {
            name: form.get("name"),
            slug: form.get("slug"),
            description: form.get("description"),
            sortOrder: form.get("sortOrder"),
            isActive: true
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название</span>
          <input name="name" required />
        </label>

        <label>
          <span>Slug</span>
          <input name="slug" placeholder="naprimer-bukety" />
        </label>

        <label>
          <span>Сортировка</span>
          <input name="sortOrder" type="number" defaultValue="100" />
        </label>

        <label className="wide">
          <span>Описание</span>
          <textarea name="description" />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Добавить категорию"}
      </button>
    </form>
  );
}

export function ProductForm({
  categories
}: {
  categories: CategoryOption[];
}) {
  const [isSaving, setIsSaving] =
    useState(false);

  const [selectedPhoto, setSelectedPhoto] =
    useState<File | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState("");

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    if (!selectedPhoto) {
      setPreviewUrl("");
      return;
    }

    const nextPreviewUrl =
      URL.createObjectURL(selectedPhoto);

    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [selectedPhoto]);

  return (
    <form
      className="admin-form admin-product-create-form"
      onSubmit={async (event) => {
        event.preventDefault();

        const formElement = event.currentTarget;
        const form = new FormData(formElement);

        setIsSaving(true);

        setMessage(
          selectedPhoto
            ? "Создаём товар и подготавливаем фото..."
            : "Создаём товар..."
        );

        try {
          const result = await submitJson(
            "/api/admin/products",
            {
              categoryId:
                form.get("categoryId"),
              name:
                form.get("name"),
              slug:
                form.get("slug"),
              shortDescription:
                form.get("shortDescription"),
              description:
                form.get("description"),
              price:
                form.get("price"),
              stockQuantity:
                form.get("stockQuantity"),
              status:
                form.get("status"),
              isFeatured:
                form.get("isFeatured") === "on",
              sortOrder:
                form.get("sortOrder")
            }
          ) as ProductCreateResponse;

          const productId = String(
            result.product?.id ?? ""
          ).trim();

          if (!productId) {
            throw new Error(
              "Сервер не вернул идентификатор созданного товара"
            );
          }

          const productName = String(
            result.product?.name
            ?? form.get("name")
            ?? "Товар"
          ).trim();

          const productUrl =
            `/admin/catalog/products/${productId}`;

          if (selectedPhoto) {
            setMessage(
              "Уменьшаем и загружаем главное фото..."
            );

            try {
              const prepared =
                await prepareCreateProductImage(
                  selectedPhoto
                );

              const alt = String(
                form.get("photoAlt") ?? ""
              ).trim() || productName;

              const photoResponse = await fetch(
                `/api/admin/products/${productId}/images`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/json"
                  },
                  body: JSON.stringify({
                    imageData:
                      prepared.imageData,
                    fileName:
                      selectedPhoto.name,
                    alt,
                    isMain:
                      true
                  })
                }
              );

              if (!photoResponse.ok) {
                throw new Error(
                  await readCreateProductError(
                    photoResponse
                  )
                );
              }
            } catch (photoError) {
              const photoMessage =
                photoError instanceof Error
                  ? photoError.message
                  : "Не удалось загрузить фотографию";

              window.alert(
                "Товар создан, но главное фото "
                + "не загрузилось:\n\n"
                + photoMessage
                + "\n\nТовар не потерян. "
                + "Добавьте фотографию в его карточке."
              );

              window.location.assign(
                productUrl
              );

              return;
            }
          }

          setMessage(
            selectedPhoto
              ? "Товар и главное фото созданы"
              : "Товар создан"
          );

          window.location.assign(productUrl);
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Не удалось создать товар"
          );
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название</span>
          <input
            name="name"
            minLength={2}
            required
          />
        </label>

        <label>
          <span>Slug</span>
          <input
            name="slug"
            placeholder="korolevskiy-buket"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            title="Латинские буквы, цифры и дефисы"
          />
          <small>
            Оставьте пустым для автоматического формирования.
          </small>
        </label>

        <label>
          <span>Категория</span>
          <select name="categoryId">
            <option value="">
              Без категории
            </option>

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
          <span>Цена, ₽</span>
          <input
            name="price"
            type="number"
            min="0"
            step="1"
            required
          />
        </label>

        <label>
          <span>Внутренний остаток</span>
          <input
            name="stockQuantity"
            type="number"
            min="0"
            step="1"
            defaultValue="0"
          />
          <small>
            Клиент увидит только «В наличии»
            или «Нет в наличии».
          </small>
        </label>

        <label>
          <span>Статус</span>
          <select
            name="status"
            defaultValue="active"
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
          <span>Сортировка</span>
          <input
            name="sortOrder"
            type="number"
            step="1"
            defaultValue="100"
          />
        </label>

        <label className="checkbox-label">
          <span>Показывать в хитах</span>
          <input
            name="isFeatured"
            type="checkbox"
          />
        </label>

        <label className="wide">
          <span>Короткое описание</span>
          <input
            name="shortDescription"
            maxLength={2000}
          />
        </label>

        <label className="wide">
          <span>Полное описание</span>
          <textarea
            name="description"
            maxLength={20000}
          />
        </label>

        <section className="wide admin-product-create-photo">
          <div className="admin-product-create-photo-head">
            <div>
              <span>Главное фото</span>
              <strong>
                Добавьте фотографию сразу
              </strong>
            </div>

            <small>
              Фото необязательно. JPG, PNG или WebP.
              Большие изображения будут уменьшены.
            </small>
          </div>

          <div className="admin-product-create-photo-fields">
            <label>
              <span>Файл</span>
              <input
                name="initialPhoto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={isSaving}
                onChange={(event) => {
                  const file =
                    event.target.files?.[0]
                    ?? null;

                  setSelectedPhoto(file);
                  setMessage("");
                }}
              />
            </label>

            <label>
              <span>Описание изображения</span>
              <input
                name="photoAlt"
                maxLength={255}
                placeholder="Например: букет красных роз"
              />
            </label>
          </div>

          {previewUrl ? (
            <div className="admin-product-create-preview">
              <img
                src={previewUrl}
                alt="Предварительный просмотр"
              />

              <div>
                <strong>
                  {selectedPhoto?.name}
                </strong>

                <span>
                  Исходный размер:{" "}
                  {selectedPhoto
                    ? formatCreateProductFileSize(
                        selectedPhoto.size
                      )
                    : "—"}
                </span>

                <span>
                  Фото готово к загрузке
                </span>
              </div>
            </div>
          ) : (
            <div className="admin-product-create-photo-empty">
              Фотографию также можно добавить позже
              внутри карточки товара.
            </div>
          )}
        </section>
      </div>

      <div className="admin-product-create-footer">
        <div>
          {message ? (
            <strong>{message}</strong>
          ) : (
            <span>
              После создания откроется карточка товара.
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSaving}
        >
          {isSaving
            ? "Создаём..."
            : selectedPhoto
              ? "Создать товар с фото"
              : "Создать товар"}
        </button>
      </div>
    </form>
  );
}

export function ProductImageForm({ products }: { products: ProductOption[] }) {
  const [isSaving, setIsSaving] = useState(false);
  const hasProducts = products.length > 0;

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();

        if (!hasProducts) {
          alert("Сначала добавьте товар");
          return;
        }

        const form = new FormData(event.currentTarget);
        const productId = String(form.get("productId") ?? "");
        const photoInput = event.currentTarget.elements.namedItem("photo");
        const file = photoInput instanceof HTMLInputElement ? photoInput.files?.[0] : null;

        if (!productId || !file) {
          alert("Выберите товар и фото");
          return;
        }

        setIsSaving(true);

        try {
          const imageData = await readFileAsDataUrl(file);

          await submitJson(`/api/admin/products/${productId}/images`, {
            imageData,
            fileName: file.name,
            alt: form.get("alt"),
            isMain: form.get("isMain") === "on"
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка загрузки фото");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Товар</span>
          <select name="productId" disabled={!hasProducts} required>
            {hasProducts ? (
              products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.imagesCount ? ` (${product.imagesCount} фото)` : ""}
                </option>
              ))
            ) : (
              <option value="">Нет товаров</option>
            )}
          </select>
        </label>

        <label>
          <span>Фото</span>
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
        </label>

        <label>
          <span>Alt-текст</span>
          <input name="alt" placeholder="Букет с пионами" />
        </label>

        <label className="checkbox-label">
          <span>Сделать главным</span>
          <input name="isMain" type="checkbox" defaultChecked />
        </label>
      </div>

      <button type="submit" disabled={isSaving || !hasProducts}>
        {isSaving ? "Загружаем..." : "Загрузить фото"}
      </button>
    </form>
  );
}

export function DeliveryZoneForm() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/delivery/zones", {
            name: form.get("name"),
            description: form.get("description"),
            price: form.get("price"),
            freeFromAmount: form.get("freeFromAmount"),
            isExpressAvailable: form.get("isExpressAvailable") === "on",
            expressPrice: form.get("expressPrice"),
            isActive: form.get("isActive") === "on",
            sortOrder: form.get("sortOrder")
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название зоны</span>
          <input name="name" placeholder="Центр" required />
        </label>

        <label>
          <span>Цена, ₽</span>
          <input name="price" type="number" min="0" defaultValue="0" />
        </label>

        <label>
          <span>Бесплатно от, ₽</span>
          <input name="freeFromAmount" type="number" min="0" defaultValue="0" />
        </label>

        <label>
          <span>Срочная, ₽</span>
          <input name="expressPrice" type="number" min="0" defaultValue="0" />
        </label>

        <label>
          <span>Сортировка</span>
          <input name="sortOrder" type="number" defaultValue="100" />
        </label>

        <label className="checkbox-label">
          <span>Активна</span>
          <input name="isActive" type="checkbox" defaultChecked />
        </label>

        <label className="checkbox-label">
          <span>Есть срочная</span>
          <input name="isExpressAvailable" type="checkbox" />
        </label>

        <label className="wide">
          <span>Описание</span>
          <textarea name="description" />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Добавить зону"}
      </button>
    </form>
  );
}

export function DeliveryIntervalForm() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/delivery/intervals", {
            name: form.get("name"),
            startsAt: form.get("startsAt"),
            endsAt: form.get("endsAt"),
            isActive: form.get("isActive") === "on",
            sortOrder: form.get("sortOrder")
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название</span>
          <input name="name" placeholder="10:00-12:00" required />
        </label>

        <label>
          <span>Начало</span>
          <input name="startsAt" type="time" required />
        </label>

        <label>
          <span>Окончание</span>
          <input name="endsAt" type="time" required />
        </label>

        <label>
          <span>Сортировка</span>
          <input name="sortOrder" type="number" defaultValue="100" />
        </label>

        <label className="checkbox-label">
          <span>Активен</span>
          <input name="isActive" type="checkbox" defaultChecked />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Добавить интервал"}
      </button>
    </form>
  );
}

