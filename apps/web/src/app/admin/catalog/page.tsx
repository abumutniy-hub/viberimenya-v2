import {
  CategoryForm,
  ProductForm
} from "../components/admin-forms";
import {
  CategoryManager,
  type CategoryManagerItem
} from "./category-manager";
import {
  ProductCatalogManager,
  type ProductCatalogCategory,
  type ProductCatalogItem
} from "./product-catalog-manager";
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
        imageUrl: String(
          category.image_url ?? ""
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


  const productCatalogCategories:
    ProductCatalogCategory[] =
      productCategories.map((category) => ({
        id: category.id,
        name: category.name
      }));

  const productCatalogItems:
    ProductCatalogItem[] =
      products
        .filter(
          (product) =>
            typeof product.id === "string"
        )
        .map((product) => {
          const status = String(
            product.status ?? "draft"
          );

          const categoryId = String(
            product.category_id ?? ""
          );

          const numericPrice = Number(
            product.price ?? 0
          );

          return {
            id: String(product.id),
            name: text(product.name),
            slug: text(product.slug, ""),
            categoryId,
            categoryName:
              categoryNames.get(categoryId)
              || "Без категории",
            status,
            statusLabel:
              statusLabels[status] || status,
            shortDescription: text(
              product.short_description,
              "Короткое описание не заполнено."
            ),
            imageUrl: safeProductImageUrl(
              product.primary_image_url
            ),
            imagesCount: Number(
              product.images_count ?? 0
            ),
            stock: Number(
              product.stock_quantity ?? 0
            ),
            price: Number.isFinite(numericPrice)
              ? numericPrice
              : 0,
            priceLabel: money(product.price),
            isFeatured: booleanValue(
              product.is_featured
            ),
            sortOrder: Number(
              product.sort_order ?? 100
            ),
            createdAt: String(
              product.created_at ?? ""
            ),
            updatedAt: String(
              product.updated_at ?? ""
            )
          };
        });

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

  const outOfStockCount = products.filter(
    (product) =>
      String(product.status) === "active"
      && Number(product.stock_quantity ?? 0) <= 0
  ).length;

  const lowStockCount = products.filter(
    (product) => {
      const stock = Number(
        product.stock_quantity ?? 0
      );

      return (
        String(product.status) === "active"
        && stock > 0
        && stock <= 5
      );
    }
  ).length;

  const withoutCategoryCount = products.filter(
    (product) => !product.category_id
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

        <article
          className={
            outOfStockCount > 0
              ? "admin-catalog-metric danger"
              : "admin-catalog-metric"
          }
        >
          <span>Закончились</span>
          <strong>{outOfStockCount}</strong>
        </article>

        <article
          className={
            lowStockCount > 0
              ? "admin-catalog-metric warning"
              : "admin-catalog-metric"
          }
        >
          <span>Осталось 1–5</span>
          <strong>{lowStockCount}</strong>
        </article>

        <article
          className={
            withoutCategoryCount > 0
              ? "admin-catalog-metric warning"
              : "admin-catalog-metric"
          }
        >
          <span>Без категории</span>
          <strong>{withoutCategoryCount}</strong>
        </article>
      </section>

      <ProductCatalogManager
        categories={productCatalogCategories}
        products={productCatalogItems}
      />

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
