import { notFound } from "next/navigation";
import { fetchAdmin } from "../../lib/admin-api";
import { BonusAdjustmentForm } from "./bonus-adjustment-form";
import { CustomerTelegramActions } from "./customer-telegram-actions";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type Response = {
  customer: Record<string, any>;
  stats: Record<string, any>;
  orders: Record<string, any>[];
  addresses: Record<string, any>[];
  bonuses: Record<string, any>[];
  topProducts: Record<string, any>[];
  permissions: {
    canAdjustBonus: boolean;
    canManageTelegram: boolean;
  };
};

const segmentLabels: Record<string, string> = { new: "Новый", regular: "Постоянный", vip: "VIP", inactive: "Неактивный" };
const orderLabels: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", assembling: "Собирается", ready: "Готов", assigned_courier: "Назначен курьер", delivering: "Доставляется", delivered: "Доставлен", cancelled: "Отменён", problem: "Проблема" };
const bonusLabels: Record<string, string> = { earn: "Начисление", spend: "Списание", manual_add: "Ручное начисление", manual_remove: "Ручное списание", expire: "Сгорание" };

function money(value: any) { return `${Number(value || 0).toLocaleString("ru-RU")} ₽`; }
function dateTime(value: any) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function addressText(item: Record<string, any>) {
  return [item.city, item.street, item.house ? `д. ${item.house}` : "", item.apartment ? `кв. ${item.apartment}` : ""].filter(Boolean).join(", ") || "Адрес не заполнен";
}

export default async function CustomerPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchAdmin<Response>(`/api/admin/customers/${id}`);
  if (!data?.customer) notFound();
  const c = data.customer;

  return (
    <div className="admin-page admin-customer-detail-page">
      <div className="admin-page-head admin-growth-head">
        <div>
          <span className={`admin-segment ${c.segment}`}>{segmentLabels[c.segment] || c.segment}</span>
          <h1>{c.name || "Клиент без имени"}</h1>
          <p>{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
        </div>
        <a className="admin-small-link" href="/admin/customers">← К клиентам</a>
      </div>

      <section className="admin-growth-metrics customer-detail">
        <article><span>Заказы</span><strong>{Number(c.total_orders || 0)}</strong><small>доставлено: {Number(data.stats.delivered_orders || 0)}</small></article>
        <article><span>Покупки</span><strong>{money(c.total_spent)}</strong><small>средний чек: {money(data.stats.average_check)}</small></article>
        <article className={Number(c.bonus_debt) ? "danger" : "success"}><span>Доступные бонусы</span><strong>{money(c.visible_bonus_balance)}</strong><small>{Number(c.bonus_debt) ? `внутренний долг ${money(c.bonus_debt)}` : "долга нет"}</small></article>
        <article><span>Последний заказ</span><strong>{c.last_order_at ? dateTime(c.last_order_at).split(",")[0] : "—"}</strong><small>клиент с {dateTime(c.created_at).split(",")[0]}</small></article>
        <article className={Number(data.stats.cancelled_orders) ? "warning" : ""}><span>Отмены</span><strong>{Number(data.stats.cancelled_orders || 0)}</strong><small>проблем: {Number(data.stats.problem_orders || 0)}</small></article>
        <article><span>Скидки</span><strong>{money(data.stats.discounts_total)}</strong><small>за всё время</small></article>
      </section>

      <div className="admin-growth-two-columns">
        <section className="admin-panel">
          <div className="admin-panel-head"><div><span>Связь</span><h2>Контакты и Telegram</h2></div></div>
          <dl className="admin-customer-data-list">
            <div><dt>Телефон</dt><dd>{c.phone}</dd></div>
            <div><dt>Email</dt><dd>{c.email || "—"}</dd></div>
            <div><dt>Telegram</dt><dd>{c.telegram_is_active ? c.linked_telegram_username ? `@${c.linked_telegram_username}` : "Подключён" : "Не подключён"}</dd></div>
            <div><dt>Уведомления</dt><dd>{c.telegram_is_active ? c.notifications_enabled ? "Включены" : "Выключены" : "—"}</dd></div>
          </dl>
          <CustomerTelegramActions
            customerId={id}
            connected={c.telegram_is_active === true}
            username={c.linked_telegram_username || null}
            canManage={data.permissions.canManageTelegram === true}
          />
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head"><div><span>Лояльность</span><h2>Ручная корректировка</h2></div></div>
          {data.permissions.canAdjustBonus ? <BonusAdjustmentForm customerId={id} balance={Math.max(0, Number(c.bonus_balance || 0))} /> : <div className="admin-growth-notice">Изменять бонусы может только владелец или администратор. Менеджеру доступна полная история.</div>}
        </section>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head"><div><span>До 100 последних операций</span><h2>История бонусов</h2></div></div>
        {data.bonuses.length ? <div className="admin-bonus-history">{data.bonuses.map((item) => <article key={item.id} className={Number(item.amount) < 0 ? "negative" : "positive"}><div><strong>{bonusLabels[item.type] || item.type}</strong><small>{item.comment || "Без комментария"}{item.order_number ? ` · ${item.order_number}` : ""}</small></div><div><strong>{Number(item.amount) > 0 ? "+" : ""}{money(item.amount)}</strong><small>баланс: {money(Math.max(0, Number(item.balance_after)))}</small></div><time>{dateTime(item.created_at)}</time></article>)}</div> : <div className="admin-empty">Операций с бонусами пока нет.</div>}
      </section>

      <div className="admin-growth-two-columns wide-left">
        <section className="admin-panel">
          <div className="admin-panel-head"><div><span>Последние 100</span><h2>Заказы клиента</h2></div></div>
          {data.orders.length ? <div className="admin-customer-orders">{data.orders.map((order) => <a href={`/admin/orders/${order.id}`} key={order.id}><div><strong>{order.order_number}</strong><small>{order.item_names || `${order.item_count || 0} позиций`}</small></div><span className={`admin-order-mini-status ${order.status}`}>{orderLabels[order.status] || order.status}</span><div><strong>{money(order.total)}</strong><small>{dateTime(order.created_at)}</small></div></a>)}</div> : <div className="admin-empty">Заказов пока нет.</div>}
        </section>

        <div className="admin-growth-stack">
          <section className="admin-panel">
            <div className="admin-panel-head"><div><span>Адресная книга</span><h2>Адреса</h2></div></div>
            {data.addresses.length ? <div className="admin-address-list">{data.addresses.map((item) => <article key={item.id}><strong>{addressText(item)}</strong><small>{item.is_default ? "Основной адрес" : "Сохранённый адрес"}{item.comment ? ` · ${item.comment}` : ""}</small></article>)}</div> : <div className="admin-empty">Адресов пока нет.</div>}
          </section>
          <section className="admin-panel">
            <div className="admin-panel-head"><div><span>Предпочтения</span><h2>Часто покупает</h2></div></div>
            {data.topProducts.length ? <div className="admin-top-product-list">{data.topProducts.map((item) => <div key={item.product_name}><strong>{item.product_name}</strong><span>{Number(item.quantity)} шт.</span><small>{money(item.revenue)}</small></div>)}</div> : <div className="admin-empty">Недостаточно данных.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
