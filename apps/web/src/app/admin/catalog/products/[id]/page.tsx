import type { ReactNode } from "react";
import {
  fetchAdmin,
  type AdminRow
} from "../../../lib/admin-api";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type ProductImage = AdminRow & {
  id?: unknown;
  url?: unknown;
  alt?: unknown;
  is_main?: unknown;
  sort_order?: unknown;
};

type Response = {
  product: AdminRow | null;
  images: ProductImage[];
};

const statusLabels: Record<string, string> = {
  active: "Опубликован",
  draft: "Черновик",
  hidden: "Скрыт",
  archived: "Архив"
};

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function money(value: unknown) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return "0 ₽";
  }

  return `${Math.round(amount).toLocaleString("ru-RU")} ₽`;
}

function dateTime(value: unknown) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return "—";
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function yesNo(value: unknown) {
  return Boolean(value) ? "Да" : "Нет";
}

function safeProductImageUrl(value: unknown) {
  const url = String(value ?? "").trim();

  if (
    !url.startsWith("/uploads/products/")
    || url.includes("..")
    || !/^\/uploads\/products\/[a-zA-Z0-9._-]+$/.test(url)
  ) {
    return "";
  }

  return url;
}

function InfoRow({
  label,
  value
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="admin-product-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function AdminProductDetailPage({
  params
}: PageProps) {
  const { id } = await params;

  const data = await fetchAdmin<Response>(
    `/api/admin/products/${id}`
  );

  const product = data?.product;
  const rawImages = data?.images ?? [];

  if (!product) {
    return (
      <div className="admin-page">
        <div className="admin-page-head">
          <div>
            <span>CRM / каталог</span>
            <h1>Товар не найден</h1>
            <p>
              Проверьте ссылку или вернитесь в каталог.
            </p>
          </div>

          <a
            className="admin-small-link"
            href="/admin/catalog"
          >
            ← К каталогу
          </a>
        </div>
      </div>
    );
  }

  const status = String(product.status ?? "draft");
  const slug = text(product.slug, "");
  const name = text(product.name);

  const images = rawImages
    .map((image) => ({
      ...image,
      safeUrl: safeProductImageUrl(image.url)
    }))
    .filter((image) => image.safeUrl);

  const mainImage = (
    images.find((image) => Boolean(image.is_main))
    ?? images[0]
    ?? null
  );

  const issues: string[] = [];

  if (!images.length) {
    issues.push("Не загружена фотография товара.");
  }

  if (!String(product.category_name ?? "").trim()) {
    issues.push("Не выбрана категория.");
  }

  if (!String(product.short_description ?? "").trim()) {
    issues.push("Не заполнено короткое описание.");
  }

  if (!String(product.description ?? "").trim()) {
    issues.push("Не заполнено полное описание.");
  }

  if (!String(product.composition ?? "").trim()) {
    issues.push("Не заполнен состав.");
  }

  if (!String(product.care_text ?? "").trim()) {
    issues.push("Не заполнены рекомендации по уходу.");
  }

  if (Number(product.price ?? 0) <= 0) {
    issues.push("Цена товара не указана.");
  }

  if (status === "active" && !images.length) {
    issues.push(
      "Опубликованный товар показывается клиентам без фотографии."
    );
  }

  return (
    <div className="admin-page admin-product-detail-page">
      <div className="admin-page-head">
        <div>
          <span>CRM / каталог / товар</span>
          <h1>{name}</h1>
          <p>
            Создан: {dateTime(product.created_at)}
          </p>
        </div>

        <div className="admin-product-head-actions">
          {status === "active" && slug ? (
            <a
              className="admin-product-public-link"
              href={`/product/${encodeURIComponent(slug)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть на сайте
            </a>
          ) : null}

          <a
            className="admin-small-link"
            href="/admin/catalog"
          >
            ← К каталогу
          </a>
        </div>
      </div>

      <section className="admin-panel admin-product-hero">
        <div>
          <span
            className={
              `admin-catalog-status status-${status}`
            }
          >
            {statusLabels[status] || status}
          </span>

          {Boolean(product.is_featured) ? (
            <span className="admin-product-featured">
              Хит продаж
            </span>
          ) : null}
        </div>

        <div className="admin-product-hero-price">
          <span>Цена</span>
          <strong>{money(product.price)}</strong>

          {Number(product.old_price ?? 0)
            > Number(product.price ?? 0) ? (
            <del>{money(product.old_price)}</del>
          ) : null}
        </div>
      </section>

      {issues.length ? (
        <section className="admin-product-quality">
          <div>
            <span>Проверка заполнения</span>
            <strong>
              Найдено замечаний: {issues.length}
            </strong>
          </div>

          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="admin-product-quality complete">
          <div>
            <span>Проверка заполнения</span>
            <strong>Карточка заполнена полностью</strong>
          </div>
        </section>
      )}

      <section className="admin-product-detail-grid">
        <article className="admin-panel admin-product-gallery-card">
          <div className="admin-panel-head">
            <div>
              <span>Витрина</span>
              <h2>Фотографии</h2>
            </div>

            <span className="admin-catalog-count">
              {images.length}
            </span>
          </div>

          {mainImage ? (
            <>
              <a
                className="admin-product-main-image"
                href={mainImage.safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Открыть оригинал"
              >
                <img
                  src={mainImage.safeUrl}
                  alt={text(mainImage.alt, name)}
                />
              </a>

              {images.length > 1 ? (
                <div className="admin-product-thumbnail-grid">
                  {images.map((image) => (
                    <a
                      key={String(image.id)}
                      href={image.safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        Boolean(image.is_main)
                          ? "admin-product-thumbnail main"
                          : "admin-product-thumbnail"
                      }
                    >
                      <img
                        src={image.safeUrl}
                        alt={text(image.alt, name)}
                        loading="lazy"
                        decoding="async"
                      />

                      {Boolean(image.is_main) ? (
                        <span>Главное</span>
                      ) : null}
                    </a>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="admin-product-photo-empty">
              <strong>Фотографии не загружены</strong>
              <p>
                Изображение можно добавить на основной
                странице каталога.
              </p>
            </div>
          )}
        </article>

        <article className="admin-panel admin-product-data-card">
          <div className="admin-panel-head">
            <div>
              <span>Основные данные</span>
              <h2>Информация о товаре</h2>
            </div>
          </div>

          <InfoRow
            label="Название"
            value={name}
          />

          <InfoRow
            label="Категория"
            value={text(
              product.category_name,
              "Без категории"
            )}
          />

          <InfoRow
            label="Slug"
            value={text(product.slug)}
          />

          <InfoRow
            label="Статус"
            value={statusLabels[status] || status}
          />

          <InfoRow
            label="Цена"
            value={money(product.price)}
          />

          <InfoRow
            label="Старая цена"
            value={
              product.old_price === null
              || product.old_price === undefined
                ? "—"
                : money(product.old_price)
            }
          />

          <InfoRow
            label="Себестоимость"
            value={
              product.cost_price === null
              || product.cost_price === undefined
                ? "—"
                : money(product.cost_price)
            }
          />

          <InfoRow
            label="Остаток"
            value={text(product.stock_quantity, "0")}
          />

          <InfoRow
            label="Показывать остаток"
            value={yesNo(product.is_stock_visible)}
          />

          <InfoRow
            label="Хит продаж"
            value={yesNo(product.is_featured)}
          />

          <InfoRow
            label="Сортировка"
            value={text(product.sort_order)}
          />

          <InfoRow
            label="Обновлён"
            value={dateTime(product.updated_at)}
          />
        </article>
      </section>

      <section className="admin-product-text-grid">
        <article className="admin-panel admin-product-text-card">
          <div className="admin-panel-head">
            <h2>Короткое описание</h2>
          </div>

          <p>
            {text(
              product.short_description,
              "Не заполнено"
            )}
          </p>
        </article>

        <article className="admin-panel admin-product-text-card">
          <div className="admin-panel-head">
            <h2>Полное описание</h2>
          </div>

          <p>
            {text(
              product.description,
              "Не заполнено"
            )}
          </p>
        </article>

        <article className="admin-panel admin-product-text-card">
          <div className="admin-panel-head">
            <h2>Состав</h2>
          </div>

          <p>
            {text(
              product.composition,
              "Не заполнено"
            )}
          </p>
        </article>

        <article className="admin-panel admin-product-text-card">
          <div className="admin-panel-head">
            <h2>Рекомендации по уходу</h2>
          </div>

          <p>
            {text(
              product.care_text,
              "Не заполнено"
            )}
          </p>
        </article>
      </section>
    </div>
  );
}
