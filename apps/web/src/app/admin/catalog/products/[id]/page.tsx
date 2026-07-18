import type { ReactNode } from "react";
import { ProductEditForm } from "./product-edit-form";
import { ProductGalleryManager } from "./product-gallery-manager";
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

type CatalogResponse = {
  categories: AdminRow[];
};


type ProductAvailability = "available" | "preorder" | "unavailable";
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

const productTypeLabels: Record<ProductType, string> = {
  bouquet: "Букет",
  arrangement: "Композиция / корзина / коробка",
  flowers: "Цветы / монобукет",
  card: "Открытка / конверт",
  gift: "Подарок",
  sweets: "Конфеты / сладости",
  toy: "Мягкая игрушка",
  vase: "Ваза",
  balloon: "Воздушные шары",
  perfume: "Парфюм",
  other: "Другое"
};

const availabilityLabels: Record<ProductAvailability, string> = {
  available: "Есть в наличии",
  preorder: "Под заказ",
  unavailable: "Нет в наличии"
};

function metadataCatalog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  const root = value as Record<string, unknown>;
  const catalog = root.catalog;

  return catalog && typeof catalog === "object" && !Array.isArray(catalog)
    ? catalog as Record<string, unknown>
    : {} as Record<string, unknown>;
}

function productTypeFromProduct(product: AdminRow): ProductType {
  const raw = String(metadataCatalog(product.metadata).productType ?? "").trim();
  const allowed = Object.keys(productTypeLabels) as ProductType[];

  if (allowed.includes(raw as ProductType)) {
    return raw as ProductType;
  }

  const haystack = [
    product.category_name,
    product.name
  ].map((item) => String(item ?? "").toLowerCase()).join(" ");

  if (/открытк|конверт/.test(haystack)) return "card";
  if (/конфет|шоколад|сладост/.test(haystack)) return "sweets";
  if (/игруш/.test(haystack)) return "toy";
  if (/шар/.test(haystack)) return "balloon";
  if (/ваз/.test(haystack)) return "vase";
  if (/парфюм|духи/.test(haystack)) return "perfume";
  if (/подар/.test(haystack)) return "gift";
  if (/корзин|короб|композиц/.test(haystack)) return "arrangement";
  if (/монобукет|поштуч/.test(haystack)) return "flowers";
  if (/букет/.test(haystack)) return "bouquet";
  if (/цветы|роза|розы|пион|тюльпан|гортенз|гвоздик|эустом|ирис|хризант/.test(haystack)) return "flowers";
  return "other";
}

function availabilityFromProduct(product: AdminRow): ProductAvailability {
  const raw = String(metadataCatalog(product.metadata).availability ?? "").trim();

  if (raw === "available" || raw === "preorder" || raw === "unavailable") {
    return raw;
  }

  return Number(product.stock_quantity ?? 0) > 0
    ? "available"
    : "unavailable";
}

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
  const prefix = "/uploads/products/";

  if (
    !url.startsWith(prefix)
    || url.includes("..")
    || url.includes("\\")
    || url.includes("?")
    || url.includes("#")
  ) {
    return "";
  }

  const relativePath = url.slice(prefix.length);
  const segments = relativePath.split("/");

  if (
    !relativePath
    || segments.some(
      (segment) =>
        !segment
        || !/^[a-zA-Z0-9._-]+$/.test(segment)
    )
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

  const [
    data,
    catalogData
  ] = await Promise.all([
    fetchAdmin<Response>(
      `/api/admin/products/${id}`
    ),
    fetchAdmin<CatalogResponse>(
      "/api/admin/catalog"
    )
  ]);

  const product = data?.product;
  const rawImages = data?.images ?? [];

  const categoryOptions = (
    catalogData?.categories ?? []
  )
    .filter(
      (category) =>
        typeof category.id === "string"
        && typeof category.name === "string"
    )
    .map((category) => ({
      id: String(category.id),
      name: String(category.name)
    }));

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
  const productType = productTypeFromProduct(product);
  const availability = availabilityFromProduct(product);
  const flowerLike = [
    "bouquet",
    "arrangement",
    "flowers"
  ].includes(productType);

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

  if (
    flowerLike
    && !String(product.composition ?? "").trim()
  ) {
    issues.push("Не заполнен состав.");
  }

  if (
    flowerLike
    && !String(product.care_text ?? "").trim()
  ) {
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
          <a
            className="admin-product-edit-link"
            href="#product-edit-form"
          >
            Редактировать
          </a>

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
        <ProductGalleryManager
          productId={String(product.id)}
          productName={name}
          images={images.map((image) => ({
            id: String(image.id ?? ""),
            url: image.safeUrl,
            alt: text(image.alt, name),
            isMain: Boolean(image.is_main),
            sortOrder: Number(
              image.sort_order ?? 100
            )
          }))}
        />

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
            label="Тип товара"
            value={productTypeLabels[productType]}
          />

          <InfoRow
            label="Наличие"
            value={availabilityLabels[availability]}
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
            label="Внутренний остаток"
            value={text(product.stock_quantity, "0")}
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

      <section
        id="product-edit-form"
        className="admin-panel admin-product-edit-card"
      >
        <div className="admin-panel-head">
          <div>
            <span>Управление товаром</span>
            <h2>Редактирование</h2>
          </div>
        </div>

        <ProductEditForm
          categories={categoryOptions}
          product={{
            id: String(product.id),
            categoryId: String(
              product.category_id ?? ""
            ),
            name,
            slug,
            shortDescription: String(
              product.short_description ?? ""
            ),
            description: String(
              product.description ?? ""
            ),
            composition: String(
              product.composition ?? ""
            ),
            careText: String(
              product.care_text ?? ""
            ),
            price: Number(product.price ?? 0),
            oldPrice:
              product.old_price === null
              || product.old_price === undefined
                ? null
                : Number(product.old_price),
            costPrice:
              product.cost_price === null
              || product.cost_price === undefined
                ? null
                : Number(product.cost_price),
            stockQuantity: Number(
              product.stock_quantity ?? 0
            ),
            availability,
            productType,
            status:
              status === "active"
              || status === "hidden"
              || status === "archived"
                ? status
                : "draft",
            isFeatured: Boolean(
              product.is_featured
            ),
            sortOrder: Number(
              product.sort_order ?? 100
            )
          }}
        />
      </section>
    </div>
  );
}
