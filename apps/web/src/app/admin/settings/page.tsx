import { AdminTable } from "../components/admin-table";
import { SettingsForm } from "../components/admin-forms";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  settings: AdminRow | null;
  domains: AdminRow[];
};

export default async function AdminSettingsPage() {
  const data = await fetchAdmin<Response>("/api/admin/settings");
  const settingsRows = data?.settings ? [data.settings] : [];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Магазин</span>
          <h1>Настройки</h1>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Редактирование</h2>
        </div>
        <SettingsForm settings={data?.settings ?? null} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Основные настройки</h2>
        </div>
        <AdminTable
          rows={settingsRows}
          emptyText="Настройки магазина пока не заполнены."
          columns={[
            { key: "phone", label: "Телефон" },
            { key: "whatsapp", label: "WhatsApp" },
            { key: "telegram", label: "Telegram" },
            { key: "instagram", label: "Instagram" },
            { key: "address", label: "Адрес" },
            { key: "work_hours", label: "График" }
          ]}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Домены</h2>
        </div>
        <AdminTable
          rows={data?.domains ?? []}
          emptyText="Домены пока не добавлены."
          columns={[
            { key: "domain", label: "Домен" },
            { key: "is_primary", label: "Основной" },
            { key: "created_at", label: "Создан", type: "date" }
          ]}
        />
      </section>
    </div>
  );
}
