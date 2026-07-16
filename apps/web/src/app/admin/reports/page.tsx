import { fetchAdmin } from "../lib/admin-api";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Response = any;
function first(value: string | string[] | undefined, fallback = "") { return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback; }
function money(value: any) { return `${Number(value || 0).toLocaleString("ru-RU")} ₽`; }
function percent(part: any, total: any) { const t = Number(total || 0); return t ? `${Math.round(Number(part || 0) / t * 100)}%` : "0%"; }
function queryString(params: Record<string, string | undefined>) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); return q.toString() ? `?${q}` : ""; }
const paymentLabels: Record<string, string> = { cash_on_delivery: "Наличными", transfer_after_confirm: "Переводом", online_card: "Онлайн-картой", sbp: "СБП" };
const segmentLabels: Record<string, string> = { new: "Новые", regular: "Постоянные", vip: "VIP", inactive: "Неактивные" };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const period = first(params.period, "30");
  const dateFrom = first(params.dateFrom);
  const dateTo = first(params.dateTo);
  const apiQuery = queryString({ period, dateFrom, dateTo });
  const data = await fetchAdmin<Response>(`/api/admin/reports${apiQuery}`);
  const summary = data?.summary ?? {};
  const maxRevenue = Math.max(1, ...(data?.daily ?? []).map((item: any) => Number(item.revenue || 0)));
  const exportQuery = queryString({ period, dateFrom, dateTo });

  return (
    <div className="admin-page admin-reports-page">
      <div className="admin-page-head admin-growth-head"><div><span>Продажи, клиенты и эффективность</span><h1>Отчёты</h1><p>Показатели рассчитываются по заказам выбранного периода. Отменённые заказы не входят в продажи товаров и промокодов.</p></div><a className="admin-small-link" href={`/api/admin/reports/export.csv${exportQuery}`}>Скачать CSV</a></div>

      <form className="admin-report-period" method="get"><label><span>Период</span><select name="period" defaultValue={period}><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="365">365 дней</option><option value="custom">Свой период</option></select></label><label><span>С даты</span><input type="date" name="dateFrom" defaultValue={dateFrom} /></label><label><span>По дату</span><input type="date" name="dateTo" defaultValue={dateTo} /></label><button type="submit">Построить</button></form>
      <p className="admin-report-range">Период отчёта: <strong>{data?.range?.dateFrom || "—"}</strong> — <strong>{data?.range?.dateTo || "—"}</strong></p>

      <section className="admin-growth-metrics reports"><article><span>Оплаченная выручка</span><strong>{money(summary.paid_revenue)}</strong><small>{Number(summary.paid_orders || 0)} оплаченных</small></article><article><span>Заказы</span><strong>{Number(summary.orders_total || 0)}</strong><small>доставлено {Number(summary.delivered_orders || 0)}</small></article><article><span>Средний чек</span><strong>{money(summary.average_check)}</strong><small>по оплаченным</small></article><article><span>Конверсия в оплату</span><strong>{percent(summary.paid_orders, summary.orders_total)}</strong><small>от всех заказов</small></article><article className={Number(summary.cancelled_orders) ? "warning" : ""}><span>Отмены</span><strong>{Number(summary.cancelled_orders || 0)}</strong><small>{percent(summary.cancelled_orders, summary.orders_total)} заказов</small></article><article><span>Уникальные клиенты</span><strong>{Number(summary.unique_customers || 0)}</strong><small>новых: {Number(summary.new_customers || 0)}</small></article><article><span>Повторные клиенты</span><strong>{Number(summary.repeat_customers || 0)}</strong><small>в выбранном периоде</small></article><article><span>Скидки</span><strong>{money(summary.discounts_total)}</strong><small>доставка: {money(summary.delivery_revenue)}</small></article></section>

      <section className="admin-panel"><div className="admin-panel-head"><div><span>Оплаченная выручка по дням</span><h2>Динамика</h2></div></div><div className="admin-report-chart">{(data?.daily ?? []).map((item: any) => <div className="admin-report-bar" key={item.date} title={`${item.date}: ${money(item.revenue)}, заказов ${item.orders}`}><div><span style={{ height: `${Math.max(4, Number(item.revenue || 0) / maxRevenue * 100)}%` }} /></div><small>{String(item.date).slice(5)}</small></div>)}</div></section>

      <div className="admin-growth-two-columns reports-grid">
        <section className="admin-panel"><div className="admin-panel-head"><div><span>Количество и выручка</span><h2>Популярные товары</h2></div></div>{(data?.topProducts ?? []).length ? <div className="admin-report-list">{data.topProducts.map((item: any, index: number) => <div key={item.product_name}><span>{index + 1}</span><div><strong>{item.product_name}</strong><small>{Number(item.orders)} заказов</small></div><b>{Number(item.quantity)} шт.</b><em>{money(item.revenue)}</em></div>)}</div> : <div className="admin-empty">Нет данных.</div>}</section>
        <section className="admin-panel"><div className="admin-panel-head"><div><span>Способы расчёта</span><h2>Оплата</h2></div></div>{(data?.paymentMethods ?? []).length ? <div className="admin-report-list compact">{data.paymentMethods.map((item: any) => <div key={item.method}><div><strong>{paymentLabels[item.method] || item.method}</strong><small>{Number(item.orders)} заказов</small></div><em>{money(item.revenue)}</em></div>)}</div> : <div className="admin-empty">Нет данных.</div>}</section>
      </div>

      <div className="admin-growth-two-columns reports-grid">
        <section className="admin-panel"><div className="admin-panel-head"><div><span>Скидка и оплаченная выручка</span><h2>Промокоды</h2></div></div>{(data?.promoUsage ?? []).length ? <div className="admin-report-list">{data.promoUsage.map((item: any) => <div key={item.code}><div><strong>{item.code}</strong><small>{Number(item.uses)} применений</small></div><b>−{money(item.discount_total)}</b><em>{money(item.paid_revenue)}</em></div>)}</div> : <div className="admin-empty">Промокоды в этом периоде не применялись.</div>}</section>
        <section className="admin-panel"><div className="admin-panel-head"><div><span>Текущая клиентская база</span><h2>Сегменты</h2></div></div><div className="admin-report-list compact">{(data?.customerSegments ?? []).map((item: any) => <div key={item.segment}><div><strong>{segmentLabels[item.segment] || item.segment}</strong><small>клиентов</small></div><em>{Number(item.customers)}</em></div>)}</div><div className="admin-report-bonus-summary"><span>Начислено бонусов</span><strong>{money(summary.added)}</strong><span>Списано бонусов</span><strong>{money(summary.removed)}</strong></div></section>
      </div>
    </div>
  );
}
