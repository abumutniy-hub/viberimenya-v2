import { AdminTable } from "../components/admin-table";
import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import { OrderActions } from "./order-actions";
import { AdminPresenceHeartbeat } from "../components/admin-presence-heartbeat";

export const dynamic = "force-dynamic";

type Response = {
  items: AdminRow[];
};

export default async function AdminOrdersPage() {
  const data = await fetchAdmin<Response>("/api/admin/orders");

  return (
    <div className="admin-page">
      <AdminPresenceHeartbeat />
      <div className="admin-page-head">
        <div>
          <span>CRM</span>
          <h1>Заказы</h1>
        </div>
      </div>

      <section className="admin-panel">
        <AdminTable
          rows={data?.items ?? []}
          emptyText="Заказов пока нет."
          columns={[
            { key: "order_number", label: "Номер" },
            { key: "status", label: "Статус" },
            { key: "customer_phone", label: "Телефон" },
            { key: "delivery_date", label: "Дата доставки" },
            { key: "payment_status", label: "Оплата" },
            { key: "total_amount", label: "Сумма" },
            { key: "created_at", label: "Создан", type: "date" },
            {
              key: "actions",
              label: "Действия",
              render: (row) => (
                <OrderActions
                  orderId={String(row.id)}
                  status={String(row.status)}
                  paymentStatus={String(row.payment_status)}
                  paymentUrl={String(row.payment_url || "")}
                  trackingToken={String(row.tracking_token || "")}
                  internalChatCount={Number(row.internal_chat_unread_count || 0)}
                  internalChatPreview={String(row.internal_chat_last_message || "")}
                />
              )
            }
          ]}
        />
      </section>
    </div>
  );
}
