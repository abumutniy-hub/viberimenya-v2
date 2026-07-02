import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  categories: AdminRow[];
  products: AdminRow[];
};

export default async function AdminCatalogPage() {
  const data = await fetchAdmin<Response>("/api/admin/catalog");

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
          <h2>Категории</h2>
        </div>
        <AdminTable
          rows={data?.categories ?? []}
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
            { key: "stock_quantity", label: "Остаток" }
          ]}
        />
      </section>
    </div>
  );
}
