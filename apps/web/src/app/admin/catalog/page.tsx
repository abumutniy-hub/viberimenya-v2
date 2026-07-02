import { AdminTable } from "../components/admin-table";
import { CategoryForm, ProductForm } from "../components/admin-forms";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  categories: AdminRow[];
  products: AdminRow[];
};

export default async function AdminCatalogPage() {
  const data = await fetchAdmin<Response>("/api/admin/catalog");
  const categories = data?.categories ?? [];
  const productCategories = categories
    .filter((category) => typeof category.id === "string" && typeof category.name === "string")
    .map((category) => ({
      id: String(category.id),
      name: String(category.name)
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
          rows={data?.products ?? []}
          emptyText="Товары пока не добавлены."
          columns={[
            { key: "name", label: "Название" },
            { key: "slug", label: "Slug" },
            { key: "status", label: "Статус" },
            { key: "price", label: "Цена" },
            { key: "stock_quantity", label: "Остаток" },
            { key: "is_featured", label: "Хит" }
          ]}
        />
      </section>
    </div>
  );
}
