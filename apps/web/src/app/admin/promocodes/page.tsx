import { fetchAdmin } from "../lib/admin-api";
import { CreatePromocodeForm, EditPromocodeForm } from "./promocode-manager";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Promo = any;
type Response = {
  items: Promo[];
  metrics: { total: number; active_count: number; disabled_count: number; uses_total: number; discounts_total: number };
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const statusLabels: Record<string, string> = { active: "Действует", scheduled: "Запланирован", expired: "Истёк", exhausted: "Лимит исчерпан", disabled: "Отключён" };
function first(value: string | string[] | undefined, fallback = "") { return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback; }
function money(value: any) { return `${Number(value || 0).toLocaleString("ru-RU")} ₽`; }
function dateTime(value: any) { if (!value) return "Без ограничения"; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function queryString(params: Record<string, string | number | undefined>) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== "all") q.set(k, String(v)); return q.toString() ? `?${q}` : ""; }

export default async function PromocodesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const status = first(params.status, "all");
  const page = Math.max(1, Number(first(params.page, "1")) || 1);
  const data = await fetchAdmin<Response>(`/api/admin/promocodes${queryString({ q, status, page })}`);
  const metrics = data?.metrics ?? { total: 0, active_count: 0, disabled_count: 0, uses_total: 0, discounts_total: 0 };
  const pagination = data?.pagination ?? { page: 1, pageSize: 40, total: 0, pages: 1 };

  return (
    <div className="admin-page admin-promocodes-page">
      <div className="admin-page-head admin-growth-head"><div><span>Акции и скидки</span><h1>Промокоды</h1><p>Создавайте процентные и фиксированные скидки, задавайте сроки, минимальный заказ и общий лимит.</p></div><a className="admin-small-link" href="/admin/reports">Эффективность в отчётах</a></div>
      <section className="admin-growth-metrics promo"><article><span>Всего кодов</span><strong>{Number(metrics.total)}</strong><small>в базе</small></article><article className="success"><span>Действуют</span><strong>{Number(metrics.active_count)}</strong><small>доступны клиентам</small></article><article><span>Применений</span><strong>{Number(metrics.uses_total)}</strong><small>за всё время</small></article><article><span>Выдано скидок</span><strong>{money(metrics.discounts_total)}</strong><small>без отменённых заказов</small></article></section>

      <section className="admin-panel"><div className="admin-panel-head"><div><span>Новая акция</span><h2>Создать промокод</h2></div></div><CreatePromocodeForm /></section>

      <form className="admin-growth-filters" method="get"><label className="wide"><span>Поиск</span><input name="q" defaultValue={q} placeholder="Код или описание" /></label><label><span>Статус</span><select name="status" defaultValue={status}><option value="all">Все</option><option value="active">Действуют</option><option value="scheduled">Запланированы</option><option value="exhausted">Лимит исчерпан</option><option value="expired">Истекли</option><option value="disabled">Отключены</option></select></label><button type="submit">Применить</button><a href="/admin/promocodes">Сбросить</a></form>

      <section className="admin-panel"><div className="admin-panel-head"><div><span>По фильтру: {pagination.total}</span><h2>Список промокодов</h2></div></div>{(data?.items ?? []).length ? <div className="admin-promo-list">{(data?.items ?? []).map((item) => <article className="admin-promo-card" key={item.id}><div className="admin-promo-card-head"><div><span className={`admin-promo-status ${item.runtime_status}`}>{statusLabels[item.runtime_status] || item.runtime_status}</span><h3>{item.code}</h3><p>{item.description || "Без внутреннего описания"}</p></div><strong>{item.discount_type === "percent" ? `${item.discount_value}%` : money(item.discount_value)}</strong></div><div className="admin-promo-facts"><div><span>Минимальный заказ</span><strong>{item.min_order_amount === null ? "Нет" : money(item.min_order_amount)}</strong></div><div><span>Использовано</span><strong>{Number(item.used_count)}{item.usage_limit === null ? "" : ` из ${item.usage_limit}`}</strong></div><div><span>Начало</span><strong>{dateTime(item.starts_at)}</strong></div><div><span>Окончание</span><strong>{dateTime(item.ends_at)}</strong></div></div><EditPromocodeForm item={item} /></article>)}</div> : <div className="admin-empty">Промокоды не найдены.</div>}</section>

      <nav className="admin-notification-pagination" aria-label="Страницы промокодов">{pagination.page > 1 ? <a href={`/admin/promocodes${queryString({ q, status, page: pagination.page - 1 })}`}>← Назад</a> : <span />}<strong>Страница {pagination.page} из {pagination.pages}</strong>{pagination.page < pagination.pages ? <a href={`/admin/promocodes${queryString({ q, status, page: pagination.page + 1 })}`}>Дальше →</a> : <span />}</nav>
    </div>
  );
}
