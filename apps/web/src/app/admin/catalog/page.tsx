import {
  CategoryForm,
  ProductForm
} from "../components/admin-forms";
import {
  CategoryManager,
  type CategoryManagerItem
} from "./category-manager";
import {
  fetchAdmin,
  type AdminRow
} from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  categories: AdminRow[];
  products: AdminRow[];
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

function booleanValue(value: unknown) {
  return (
    value === true
    || value === "true"
    || value === "t"
    || value === 1
    || value === "1"
  );
}

function money(value: unknown) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return "0 ₽";
  }

  return `${Math.round(amount).toLocaleString("ru-RU")} ₽`;
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

export default async function AdminCatalogPage() {
  const data = await fetchAdmin<Response>(
    "/api/admin/catalog"
  );

  const categories = data?.categories ?? [];
  const products = data?.products ?? [];

  const categoryManagerItems: CategoryManagerItem[] =
    categories
      .filter(
        (category) =>
          typeof category.id === "string"
          && typeof category.name === "string"
      )
      .map((category) => ({
        id: String(category.id),
        name: String(category.name),
        slug: String(category.slug ?? ""),
        description: String(
          category.description ?? ""
        ),
        sortOrder: Number(
          category.sort_order ?? 100
        ),
        isActive: booleanValue(
          category.is_active
        ),
        productsTotal: Number(
          category.products_total ?? 0
        ),
        activeProducts: Number(
          category.active_products ?? 0
        ),
        draftProducts: Number(
          category.draft_products ?? 0
        ),
        hiddenProducts: Number(
          category.hidden_products ?? 0
        ),
        archivedProducts: Number(
          category.archived_products ?? 0
        )
      }));

  const productCategories = categories
    .filter(
      (category) =>
        typeof category.id === "string"
        && typeof category.name === "string"
    )
    .map((category) => ({
      id: String(category.id),
      name: String(category.name)
    }));

  const categoryNames = new Map(
    productCategories.map((category) => [
      category.id,
      category.name
    ])
  );

  const activeCount = products.filter(
    (product) => String(product.status) === "active"
  ).length;

  const draftCount = products.filter(
    (product) => String(product.status) === "draft"
  ).length;

  const hiddenCount = products.filter(
    (product) =>
      String(product.status) === "hidden"
      || String(product.status) === "archived"
  ).length;

  const withoutPhotoCount = products.filter(
    (product) =>
      !safeProductImageUrl(product.primary_image_url)
  ).length;

  return (
    <div className="admin-page admin-catalog-page">
      <div className="admin-page-head">
        <div>
          <span>Витрина</span>
          <h1>Каталог</h1>
          <p>
            Управление товарами, категориями и фотографиями.
          </p>
        </div>
      </div>

      <section className="admin-catalog-metrics">
        <article className="admin-catalog-metric">
          <span>Всего товаров</span>
          <strong>{products.length}</strong>
        </article>

        <article className="admin-catalog-metric">
          <span>Опубликовано</span>
          <strong>{activeCount}</strong>
        </article>

        <article className="admin-catalog-metric">
          <span>Черновики</span>
          <strong>{draftCount}</strong>
        </article>

        <article className="admin-catalog-metric">
          <span>Скрыто и архив</span>
          <strong>{hiddenCount}</strong>
        </article>

        <article
          className={
            withoutPhotoCount > 0
              ? "admin-catalog-metric warning"
              : "admin-catalog-metric"
          }
        >
          <span>Без фотографии</span>
          <strong>{withoutPhotoCount}</strong>
        </article>
      </section>

      <section className="admin-panel admin-catalog-products-panel">
        <div className="admin-panel-head">
          <div>
            <span>Ассортимент</span>
            <h2>Товары</h2>
          </div>

          <span className="admin-catalog-count">
            {products.length}
          </span>
        </div>

        {products.length ? (
          <div className="admin-catalog-product-grid">
            {products.map((product) => {
              const id = String(product.id ?? "");
              const name = text(product.name);
              const status = String(
                product.status ?? "draft"
              );

              const categoryId = String(
                product.category_id ?? ""
              );

              const categoryName = (
                categoryNames.get(categoryId)
                || "Без категории"
              );

              const imageUrl = safeProductImageUrl(
                product.primary_image_url
              );

              const imagesCount = Number(
                product.images_count ?? 0
              );

              const stock = Number(
                product.stock_quantity ?? 0
              );

              return (
                <article
                  className="admin-catalog-product-card"
                  key={id}
                >
                  <a
                    className={
                      imageUrl
                        ? "admin-catalog-product-image has-image"
                        : "admin-catalog-product-image"
                    }
                    href={`/admin/catalog/products/${id}`}
                    aria-label={`Открыть товар ${name}`}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={name}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div>
                        <strong>Фото не загружено</strong>
                        <span>
                          Добавьте изображение товара
                        </span>
                      </div>
                    )}
                  </a>

                  <div className="admin-catalog-product-body">
                    <div className="admin-catalog-product-heading">
                      <div>
                        <span>{categoryName}</span>
                        <h3>{name}</h3>
                      </div>

                      <span
                        className={
                          `admin-catalog-status status-${status}`
                        }
                      >
                        {statusLabels[status] || status}
                      </span>
                    </div>

                    <p>
                      {text(
                        product.short_description,
                        "Короткое описание не заполнено."
                      )}
                    </p>

                    <dl className="admin-catalog-product-facts">
                      <div>
                        <dt>Цена</dt>
                        <dd>{money(product.price)}</dd>
                      </div>

                      <div>
                        <dt>Остаток</dt>
                        <dd>{stock}</dd>
                      </div>

                      <div>
                        <dt>Фотографии</dt>
                        <dd>{imagesCount}</dd>
                      </div>
                    </dl>

                    <div className="admin-catalog-product-tags">
                      {Boolean(product.is_featured) ? (
                        <span>Хит продаж</span>
                      ) : null}

                      {!imageUrl ? (
                        <span className="warning">
                          Нужна фотография
                        </span>
                      ) : null}
                    </div>

                    <a
                      className="admin-catalog-open-link"
                      href={`/admin/catalog/products/${id}`}
                    >
                      Открыть карточку
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-catalog-empty">
            <strong>Товаров пока нет</strong>
            <p>
              Добавьте первый товар через форму ниже.
            </p>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <span>Новая позиция</span>
            <h2>Добавить товар</h2>
          </div>
        </div>

        <ProductForm categories={productCategories} />
      </section>

      <section
        className="admin-panel admin-category-manager-panel"
        id="catalog-categories"
      >
        <div className="admin-panel-head">
          <div>
            <span>Структура витрины</span>
            <h2>Управление категориями</h2>
          </div>

          <span className="admin-catalog-count">
            {categoryManagerItems.length}
          </span>
        </div>

        <CategoryManager
          categories={categoryManagerItems}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <span>Новый раздел</span>
            <h2>Добавить категорию</h2>
          </div>
        </div>

        <CategoryForm />
      </section>
    </div>
  );
}
