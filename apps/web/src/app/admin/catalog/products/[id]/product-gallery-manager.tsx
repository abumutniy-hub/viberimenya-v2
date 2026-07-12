"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

type GalleryImage = {
  id: string;
  url: string;
  alt: string;
  isMain: boolean;
  sortOrder: number;
};

type ProductGalleryManagerProps = {
  productId: string;
  productName: string;
  images: GalleryImage[];
};

const MAX_SOURCE_SIZE = 20 * 1024 * 1024;
const TARGET_SIZE = 3.5 * 1024 * 1024;
const MAX_IMAGES = 12;
const MAX_DIMENSION = 2400;

async function readError(response: Response) {
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
    // Сервер мог вернуть не JSON.
  }

  return `Ошибка: HTTP ${response.status}`;
}

function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(
          new Error("Не удалось прочитать фотографию")
        );
      }
    };

    reader.onerror = () => {
      reject(
        new Error("Не удалось прочитать фотографию")
      );
    };

    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>(
    (resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);

      image.onerror = () => {
        reject(
          new Error(
            "Браузер не смог открыть выбранное изображение"
          )
        );
      };

      image.src = dataUrl;
    }
  );
}

function canvasToBlob(
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

async function prepareImage(file: File) {
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp"
    ].includes(file.type)
  ) {
    throw new Error(
      "Выберите фотографию JPG, PNG или WebP"
    );
  }

  if (file.size > MAX_SOURCE_SIZE) {
    throw new Error(
      "Исходный файл должен быть не больше 20 МБ"
    );
  }

  const originalDataUrl =
    await readFileAsDataUrl(file);

  const image = await loadImage(originalDataUrl);

  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(
      "Не удалось определить размер фотографии"
    );
  }

  const initialScale = Math.min(
    1,
    MAX_DIMENSION / Math.max(
      image.naturalWidth,
      image.naturalHeight
    )
  );

  let width = Math.max(
    1,
    Math.round(image.naturalWidth * initialScale)
  );

  let height = Math.max(
    1,
    Math.round(image.naturalHeight * initialScale)
  );

  let quality = 0.88;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "Браузер не поддерживает обработку фотографии"
      );
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    try {
      lastBlob = await canvasToBlob(
        canvas,
        "image/webp",
        quality
      );
    } catch {
      lastBlob = await canvasToBlob(
        canvas,
        "image/jpeg",
        quality
      );
    }

    if (lastBlob.size <= TARGET_SIZE) {
      return {
        imageData: await readFileAsDataUrl(lastBlob),
        processedSize: lastBlob.size,
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

  if (!lastBlob || lastBlob.size > 5 * 1024 * 1024) {
    throw new Error(
      "Фотографию не удалось уменьшить до допустимого размера"
    );
  }

  return {
    imageData: await readFileAsDataUrl(lastBlob),
    processedSize: lastBlob.size,
    width,
    height
  };
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} КБ`;
  }

  return `${(
    bytes / 1024 / 1024
  ).toFixed(1)} МБ`;
}

export function ProductGalleryManager({
  productId,
  productName,
  images
}: ProductGalleryManagerProps) {
  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState("");

  const [isMain, setIsMain] = useState(
    images.length === 0
  );

  const [actionId, setActionId] = useState("");
  const [message, setMessage] = useState("");

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const mainImage = useMemo(
    () =>
      images.find((image) => image.isMain)
      ?? images[0]
      ?? null,
    [images]
  );

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(
      selectedFile
    );

    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile]);

  async function handleUpload(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    if (!selectedFile) {
      setMessage("Выберите фотографию");
      return;
    }

    if (images.length >= MAX_IMAGES) {
      setMessage(
        "Достигнут лимит: 12 фотографий"
      );
      return;
    }

    setActionId("upload");
    setMessage("Подготавливаем фотографию...");

    try {
      const prepared = await prepareImage(
        selectedFile
      );

      setMessage(
        `Загружаем ${formatSize(
          prepared.processedSize
        )}, ${prepared.width}×${prepared.height}`
      );

      const response = await fetch(
        `/api/admin/products/${productId}/images`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            imageData: prepared.imageData,
            fileName: selectedFile.name,
            alt: String(form.get("alt") ?? ""),
            isMain
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      setMessage("Фотография загружена");

      window.setTimeout(() => {
        window.location.reload();
      }, 300);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить фотографию"
      );
    } finally {
      setActionId("");
    }
  }

  async function updateImage(
    imageId: string,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setActionId(imageId);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/product-images/${imageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      setMessage(successMessage);

      window.setTimeout(() => {
        window.location.reload();
      }, 250);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить фотографию"
      );
    } finally {
      setActionId("");
    }
  }

  async function handleImageSubmit(
    event: FormEvent<HTMLFormElement>,
    imageId: string
  ) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const sortOrder = Number(
      form.get("sortOrder")
    );

    if (
      !Number.isInteger(sortOrder)
      || sortOrder < 0
    ) {
      setMessage(
        "Порядок фотографии должен быть целым числом"
      );
      return;
    }

    await updateImage(
      imageId,
      {
        alt: String(form.get("alt") ?? ""),
        sortOrder
      },
      "Параметры фотографии сохранены"
    );
  }

  async function deleteImage(image: GalleryImage) {
    const confirmed = window.confirm(
      image.isMain
        ? "Удалить главное фото? Следующая фотография станет главной автоматически."
        : "Удалить эту фотографию?"
    );

    if (!confirmed) {
      return;
    }

    setActionId(image.id);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/product-images/${image.id}`,
        {
          method: "DELETE"
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      setMessage("Фотография удалена");

      window.setTimeout(() => {
        window.location.reload();
      }, 250);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось удалить фотографию"
      );
    } finally {
      setActionId("");
    }
  }

  return (
    <article className="admin-panel admin-product-gallery-card">
      <div className="admin-panel-head">
        <div>
          <span>Витрина</span>
          <h2>Фотографии товара</h2>
        </div>

        <span className="admin-catalog-count">
          {images.length}/{MAX_IMAGES}
        </span>
      </div>

      {mainImage ? (
        <a
          className="admin-product-main-image"
          href={mainImage.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть оригинал"
        >
          <img
            src={mainImage.url}
            alt={mainImage.alt || productName}
          />

          <span>Главное фото</span>
        </a>
      ) : (
        <div className="admin-product-photo-empty">
          <strong>Фотографии не загружены</strong>
          <p>
            Добавьте первое фото товара в форме ниже.
            Оно автоматически станет главным.
          </p>
        </div>
      )}

      <form
        className="admin-product-photo-upload"
        onSubmit={handleUpload}
      >
        <div className="admin-product-photo-upload-head">
          <div>
            <span>Добавить фотографию</span>
            <strong>
              JPG, PNG или WebP
            </strong>
          </div>

          <small>
            Большие изображения автоматически
            уменьшаются перед загрузкой.
          </small>
        </div>

        <div className="admin-product-photo-upload-grid">
          <label className="admin-product-file-field">
            <span>Файл</span>
            <input
              ref={fileInputRef}
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={
                actionId === "upload"
                || images.length >= MAX_IMAGES
              }
              onChange={(event) => {
                const file =
                  event.target.files?.[0] ?? null;

                setSelectedFile(file);
                setMessage("");
              }}
            />
          </label>

          <label>
            <span>Описание изображения</span>
            <input
              name="alt"
              defaultValue={productName}
              maxLength={255}
              placeholder="Например: букет красных роз"
            />
          </label>

          <label className="admin-product-photo-main-check">
            <input
              type="checkbox"
              checked={isMain}
              onChange={(event) => {
                setIsMain(event.target.checked);
              }}
            />
            <span>Сделать главным</span>
          </label>
        </div>

        {previewUrl ? (
          <div className="admin-product-upload-preview">
            <img
              src={previewUrl}
              alt="Предварительный просмотр"
            />

            <div>
              <strong>{selectedFile?.name}</strong>
              <span>
                Исходный размер:{" "}
                {selectedFile
                  ? formatSize(selectedFile.size)
                  : "—"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="admin-product-photo-upload-footer">
          <span>
            {message || (
              images.length >= MAX_IMAGES
                ? "Достигнут лимит фотографий"
                : selectedFile
                  ? "Фото готово к загрузке"
                  : "Фото ещё не выбрано"
            )}
          </span>

          <button
            type="submit"
            disabled={
              !selectedFile
              || actionId === "upload"
              || images.length >= MAX_IMAGES
            }
          >
            {actionId === "upload"
              ? "Загружаем..."
              : "Загрузить фотографию"}
          </button>
        </div>
      </form>

      {images.length ? (
        <div className="admin-product-gallery-list">
          {images.map((image) => (
            <form
              className={
                image.isMain
                  ? "admin-product-gallery-item main"
                  : "admin-product-gallery-item"
              }
              key={image.id}
              onSubmit={(event) => {
                void handleImageSubmit(
                  event,
                  image.id
                );
              }}
            >
              <div className="admin-product-gallery-thumb">
                <img
                  src={image.url}
                  alt={image.alt || productName}
                  loading="lazy"
                  decoding="async"
                />

                {image.isMain ? (
                  <span>Главное</span>
                ) : null}
              </div>

              <div className="admin-product-gallery-fields">
                <label>
                  <span>Alt-текст</span>
                  <input
                    name="alt"
                    defaultValue={image.alt}
                    maxLength={255}
                  />
                </label>

                <label>
                  <span>Порядок</span>
                  <input
                    name="sortOrder"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={image.sortOrder}
                  />
                </label>
              </div>

              <div className="admin-product-gallery-actions">
                <button
                  type="submit"
                  disabled={actionId === image.id}
                >
                  Сохранить
                </button>

                {!image.isMain ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={actionId === image.id}
                    onClick={() => {
                      void updateImage(
                        image.id,
                        {
                          isMain: true
                        },
                        "Главное фото изменено"
                      );
                    }}
                  >
                    Сделать главным
                  </button>
                ) : null}

                <button
                  type="button"
                  className="danger"
                  disabled={actionId === image.id}
                  onClick={() => {
                    void deleteImage(image);
                  }}
                >
                  Удалить
                </button>
              </div>
            </form>
          ))}
        </div>
      ) : null}
    </article>
  );
}
