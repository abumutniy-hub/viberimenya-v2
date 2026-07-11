import { AdminTable } from "../components/admin-table";
import { CategoryForm, ProductForm, ProductImageForm } from "../components/admin-forms";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  categories: AdminRow[];
  products: AdminRow[];
};

export default async function AdminCatalogPage() {
  const data = await fetchAdmin<Response>("/api/admin/catalog");
  const categories = data?.categories ?? [];
  const products = data?.products ?? [];
  const productCategories = categories
    .filter((category) => typeof category.id === "string" && typeof category.name === "string")
    .map((category) => ({
      id: String(category.id),
      name: String(category.name)
    }));
  const productOptions = products
    .filter((product) => typeof product.id === "string" && typeof product.name === "string")
    .map((product) => ({
      id: String(product.id),
      name: String(product.name),
      primaryImageUrl: typeof product.primary_image_url === "string" ? product.primary_image_url : "",
      imagesCount: Number(product.images_count ?? 0)
    }));

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Витрина</span>
          <h1>Каталог</h1>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Добавить категорию</h2>
        </div>
        <CategoryForm />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Добавить товар</h2>
        </div>
        <ProductForm categories={productCategories} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Фото товара</h2>
        </div>
        <ProductImageForm products={productOptions} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Категории</h2>
        </div>
        <AdminTable
          rows={categories}
          emptyText="Категории пока не добавлены."
          columns={[
            { key: "name", label: "Название" },
            { key: "slug", label: "Slug" },
            { key: "is_active", label: "Активна" },
            { key: "sort_order", label: "Сортировка" }
          ]}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Товары</h2>
        </div>
        <AdminTable
          rows={products}
          emptyText="Товары пока не добавлены."
          columns={[
            { key: "name", label: "Название" },
            { key: "slug", label: "Slug" },
            { key: "status", label: "Статус" },
            { key: "price", label: "Цена" },
            { key: "stock_quantity", label: "Остаток" },
            { key: "primary_image_url", label: "Главное фото" },
            { key: "images_count", label: "Фото" },
            { key: "is_featured", label: "Хит" }
          ]}
        />
      </section>
    </div>
  );
}
