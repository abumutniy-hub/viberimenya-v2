"use client";

import { useState, type FormEvent } from "react";
import styles from "./launch.module.css";

export type LaunchSettings = {
  launch: {
    acceptingOrders: boolean;
    maintenanceMode: boolean;
    maintenanceTitle: string;
    maintenanceMessage: string;
    ordersPausedMessage: string;
  };
  seo: {
    siteTitle: string;
    siteDescription: string;
    ogImageUrl: string;
    yandexVerification: string;
    indexingEnabled: boolean;
  };
  analytics: {
    enabled: boolean;
    yandexMetrikaId: string;
  };
  legal: {
    privacyText: string;
    consentText: string;
    offerText: string;
    deliveryText: string;
    returnsText: string;
  };
};

export type ReadinessSection =
  | "store"
  | "operations"
  | "payments"
  | "communications"
  | "legal"
  | "control_order";

export type ReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  value: string;
  critical: boolean;
  section: ReadinessSection;
  hint?: string;
};

export type LaunchSummary = {
  score: number;
  total: number;
  passed: number;
  criticalBlockers: number;
  warnings: number;
  configurationReady: boolean;
  controlOrderReady: boolean;
  readyForLaunch: boolean;
  status: "blocked" | "ready_for_control_order" | "control_order_in_progress" | "ready_for_launch";
};

export type RecentOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  customerName: string | null;
  createdAt: string;
  selected: boolean;
};

export type ControlOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentProvider: string | null;
  trackingToken: string | null;
};

type ApiMessage = { message?: string; error?: string };

const sectionLabels: Record<Exclude<ReadinessSection, "control_order">, string> = {
  store: "Витрина и оформление",
  operations: "Команда и доставка",
  payments: "Оплата",
  communications: "Telegram и уведомления",
  legal: "Реквизиты и документы",
};

const statusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  assembling: "Собирается",
  ready: "Готов",
  assigned_courier: "Курьер назначен",
  delivering: "Доставляется",
  delivered: "Доставлен",
  cancelled: "Отменён",
  problem: "Проблема",
};

const paymentStatusLabels: Record<string, string> = {
  not_required: "Не требуется",
  created: "Создана",
  pending: "Ожидается",
  waiting_for_capture: "Ожидает подтверждения",
  paid: "Оплачено",
  failed: "Ошибка",
  refunded: "Возвращено",
  partially_refunded: "Частичный возврат",
  cancelled: "Отменено",
  expired: "Истекло",
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

async function responseJson(response: Response) {
  try {
    return (await response.json()) as ApiMessage;
  } catch {
    return null;
  }
}

function summaryCopy(summary: LaunchSummary) {
  if (summary.status === "ready_for_launch") {
    return {
      title: "Основной запуск разрешён",
      text: "Критические настройки и контрольный заказ прошли проверку. Магазин готов принимать реальные заказы.",
    };
  }

  if (summary.status === "control_order_in_progress") {
    return {
      title: "Контрольный заказ выполняется",
      text: "Основные настройки готовы. Проведите выбранный заказ через оплату, сборку, фото и доставку.",
    };
  }

  if (summary.status === "ready_for_control_order") {
    return {
      title: "Можно проводить контрольный заказ",
      text: "Критические настройки готовы. Оформите один заказ как обычный покупатель и выберите его ниже.",
    };
  }

  return {
    title: "Есть блокеры запуска",
    text: "Исправьте критические пункты ниже. Предупреждения не блокируют запуск, но их желательно проверить.",
  };
}

function ReadinessRow({ item }: { item: ReadinessItem }) {
  return (
    <div className={`${styles.readinessRow} ${item.ok ? styles.ok : item.critical ? styles.blocker : styles.warning}`}>
      <div>
        <span className={styles.readinessLabel}>
          <b>{item.ok ? "✓" : item.critical ? "!" : "•"}</b>
          {item.label}
        </span>
        {item.hint ? <small>{item.hint}</small> : null}
      </div>
      <strong>{item.value}</strong>
    </div>
  );
}

export function LaunchSettingsForm({
  initial,
  readiness,
  summary,
  recentOrders,
  controlOrder,
}: {
  initial: LaunchSettings;
  readiness: ReadinessItem[];
  summary: LaunchSummary;
  recentOrders: RecentOrder[];
  controlOrder: ControlOrder | null;
}) {
  const [saving, setSaving] = useState(false);
  const [selectingOrder, setSelectingOrder] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const summaryText = summaryCopy(summary);
  const configItems = readiness.filter((item) => item.section !== "control_order");
  const controlItems = readiness.filter((item) => item.section === "control_order");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const body: LaunchSettings = {
      launch: {
        acceptingOrders: form.get("acceptingOrders") === "on",
        maintenanceMode: form.get("maintenanceMode") === "on",
        maintenanceTitle: String(form.get("maintenanceTitle") ?? ""),
        maintenanceMessage: String(form.get("maintenanceMessage") ?? ""),
        ordersPausedMessage: String(form.get("ordersPausedMessage") ?? ""),
      },
      seo: {
        siteTitle: String(form.get("siteTitle") ?? ""),
        siteDescription: String(form.get("siteDescription") ?? ""),
        ogImageUrl: String(form.get("ogImageUrl") ?? ""),
        yandexVerification: String(form.get("yandexVerification") ?? ""),
        indexingEnabled: form.get("indexingEnabled") === "on",
      },
      analytics: {
        enabled: form.get("analyticsEnabled") === "on",
        yandexMetrikaId: String(form.get("yandexMetrikaId") ?? ""),
      },
      legal: {
        privacyText: String(form.get("privacyText") ?? ""),
        consentText: String(form.get("consentText") ?? ""),
        offerText: String(form.get("offerText") ?? ""),
        deliveryText: String(form.get("deliveryText") ?? ""),
        returnsText: String(form.get("returnsText") ?? ""),
      },
    };

    if (body.analytics.enabled && !/^\d{4,12}$/.test(body.analytics.yandexMetrikaId)) {
      setMessage("Для аналитики укажите корректный номер счётчика Яндекс Метрики.");
      setSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/launch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await responseJson(response);

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Не удалось сохранить настройки");
      }

      setMessage("Настройки запуска сохранены.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function selectControlOrder(orderId: string | null) {
    setSelectingOrder(orderId ?? "clear");
    setMessage("");

    try {
      const response = await fetch("/api/admin/launch/test-order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await responseJson(response);

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Не удалось выбрать заказ");
      }

      setMessage(orderId ? "Контрольный заказ выбран." : "Контрольный заказ сброшен.");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выбрать заказ");
      setSelectingOrder(null);
    }
  }

  return (
    <form className={styles.page} onSubmit={submit}>
      <section className={`${styles.launchHero} ${styles[summary.status]}`}>
        <div>
          <span className={styles.eyebrow}>Готовность {summary.score}%</span>
          <h2>{summaryText.title}</h2>
          <p>{summaryText.text}</p>
          <div className={styles.heroMetrics}>
            <span><b>{summary.passed}</b> из {summary.total} пройдено</span>
            <span><b>{summary.criticalBlockers}</b> критических блокеров</span>
            <span><b>{summary.warnings}</b> предупреждений</span>
          </div>
        </div>
        <div className={styles.scoreRing} aria-label={`Готовность ${summary.score}%`}>
          <strong>{summary.score}%</strong>
          <span>готовность</span>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Приём заказов</h2>
          <p>Остановите новые заказы без отключения каталога, отслеживания и CRM.</p>
          <div className={styles.fields}>
            <label className={styles.switchRow}>
              <input type="checkbox" name="acceptingOrders" defaultChecked={initial.launch.acceptingOrders} />
              <span><strong>Принимать новые заказы</strong><small>При выключении каталог остаётся доступным, но оформление блокируется на сайте, в Telegram и API.</small></span>
            </label>
            <label>
              <span>Сообщение при паузе</span>
              <textarea name="ordersPausedMessage" maxLength={500} defaultValue={initial.launch.ordersPausedMessage} />
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Технический режим</h2>
          <p>Скрывает витрину, но оставляет клиентам отслеживание и юридические документы.</p>
          <div className={styles.fields}>
            <label className={styles.switchRow}>
              <input type="checkbox" name="maintenanceMode" defaultChecked={initial.launch.maintenanceMode} />
              <span><strong>Включить технические работы</strong><small>CRM продолжит работать. Уже оформленные заказы останутся доступны.</small></span>
            </label>
            <label><span>Заголовок</span><input name="maintenanceTitle" maxLength={160} defaultValue={initial.launch.maintenanceTitle} /></label>
            <label><span>Описание</span><textarea name="maintenanceMessage" maxLength={1000} defaultValue={initial.launch.maintenanceMessage} /></label>
          </div>
        </section>

        <section className={`${styles.card} ${styles.cardWide}`}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Автоматическая проверка магазина</h2>
              <p>Критические пункты должны быть зелёными до запуска рекламы и массовых заказов.</p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => window.location.reload()}>
              Обновить проверку
            </button>
          </div>
          <div className={styles.readinessSections}>
            {(Object.keys(sectionLabels) as Array<Exclude<ReadinessSection, "control_order">>).map((section) => {
              const sectionItems = configItems.filter((item) => item.section === section);
              if (!sectionItems.length) return null;
              return (
                <div className={styles.readinessGroup} key={section}>
                  <h3>{sectionLabels[section]}</h3>
                  <div className={styles.readinessList}>
                    {sectionItems.map((item) => <ReadinessRow key={item.key} item={item} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`${styles.card} ${styles.cardWide}`}>
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>17B-2C.3</span>
              <h2>Контрольный заказ основного запуска</h2>
              <p>Оформите заказ с телефона как обычный клиент. Затем выберите его и проведите через всю рабочую цепочку.</p>
            </div>
            {controlOrder ? (
              <div className={styles.controlLinks}>
                <a href={`/admin/orders/${controlOrder.id}`}>Открыть в CRM</a>
                {controlOrder.trackingToken ? (
                  <a href={`/order/track/${controlOrder.trackingToken}`} target="_blank" rel="noreferrer">Страница клиента</a>
                ) : null}
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={selectingOrder !== null}
                  onClick={() => selectControlOrder(null)}
                >
                  Сбросить
                </button>
              </div>
            ) : null}
          </div>

          <div className={styles.controlGrid}>
            <div>
              <h3>{controlOrder ? `Заказ ${controlOrder.orderNumber}` : "Заказ ещё не выбран"}</h3>
              {controlOrder ? (
                <p className={styles.controlMeta}>
                  {statusLabels[controlOrder.status] || controlOrder.status} · {paymentStatusLabels[controlOrder.paymentStatus] || controlOrder.paymentStatus}
                </p>
              ) : (
                <p className={styles.controlMeta}>После создания заказа он появится справа в списке последних заказов.</p>
              )}
              <div className={styles.readinessList}>
                {controlItems.map((item) => <ReadinessRow key={item.key} item={item} />)}
              </div>
            </div>

            <div>
              <h3>Последние заказы</h3>
              <div className={styles.ordersList}>
                {recentOrders.length ? recentOrders.map((order) => (
                  <div key={order.id} className={`${styles.orderRow} ${order.selected ? styles.selectedOrder : ""}`}>
                    <div>
                      <strong>{order.orderNumber}</strong>
                      <span>{order.customerName || "Покупатель"} · {dateTime(order.createdAt)}</span>
                      <small>{statusLabels[order.status] || order.status} · {paymentStatusLabels[order.paymentStatus] || order.paymentStatus} · {money(order.total)}</small>
                    </div>
                    <button
                      type="button"
                      disabled={order.selected || selectingOrder !== null}
                      onClick={() => selectControlOrder(order.id)}
                    >
                      {order.selected ? "Выбран" : selectingOrder === order.id ? "Выбираем…" : "Проверять"}
                    </button>
                  </div>
                )) : <div className={styles.emptyState}>Заказов пока нет.</div>}
              </div>
            </div>
          </div>

          <div className={styles.launchSteps}>
            <span>1. Клиент оформляет и оплачивает</span>
            <span>2. Менеджер подтверждает</span>
            <span>3. Флорист собирает и загружает фото</span>
            <span>4. Клиент согласовывает</span>
            <span>5. Курьер доставляет</span>
            <span>6. Страница покажет «Основной запуск разрешён»</span>
          </div>
        </section>

        <section className={styles.card}>
          <h2>SEO и поисковые системы</h2>
          <p>Заголовок и описание используются в поиске и при отправке ссылки в мессенджеры.</p>
          <div className={styles.fields}>
            <label><span>Название сайта</span><input name="siteTitle" maxLength={160} defaultValue={initial.seo.siteTitle} /></label>
            <label><span>Описание сайта</span><textarea name="siteDescription" maxLength={500} defaultValue={initial.seo.siteDescription} /></label>
            <label><span>Изображение Open Graph</span><input name="ogImageUrl" maxLength={500} placeholder="/uploads/products/..." defaultValue={initial.seo.ogImageUrl} /></label>
            <label><span>Код подтверждения Яндекс Вебмастера</span><input name="yandexVerification" maxLength={200} defaultValue={initial.seo.yandexVerification} /></label>
            <label className={styles.switchRow}>
              <input type="checkbox" name="indexingEnabled" defaultChecked={initial.seo.indexingEnabled} />
              <span><strong>Разрешить индексацию</strong><small>Включайте после контрольного заказа и финальной проверки документов.</small></span>
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Аналитика</h2>
          <p>Яндекс Метрика включается только после согласия посетителя на необязательные cookies.</p>
          <div className={styles.fields}>
            <label><span>Номер счётчика</span><input name="yandexMetrikaId" inputMode="numeric" maxLength={12} defaultValue={initial.analytics.yandexMetrikaId} /></label>
            <label className={styles.switchRow}>
              <input type="checkbox" name="analyticsEnabled" defaultChecked={initial.analytics.enabled} />
              <span><strong>Включить аналитику после согласия</strong><small>Персональные данные заказа в Метрику не передаются.</small></span>
            </label>
            <div className={styles.note}>Страницы CRM, личного кабинета и заказов не включаются в sitemap и закрыты от индексации.</div>
          </div>
        </section>

        <section className={`${styles.card} ${styles.cardWide}`}>
          <h2>Юридические документы</h2>
          <p>Если поле пустое, сайт использует базовый шаблон. Для запуска лучше сохранить окончательные тексты под фактические условия магазина.</p>
          <div className={styles.fields}>
            <label><span>Политика конфиденциальности</span><textarea name="privacyText" maxLength={30000} defaultValue={initial.legal.privacyText} /></label>
            <label><span>Согласие на обработку данных</span><textarea name="consentText" maxLength={30000} defaultValue={initial.legal.consentText} /></label>
            <label><span>Публичная оферта</span><textarea name="offerText" maxLength={30000} defaultValue={initial.legal.offerText} /></label>
            <label><span>Условия доставки</span><textarea name="deliveryText" maxLength={30000} defaultValue={initial.legal.deliveryText} /></label>
            <label><span>Возврат и претензии</span><textarea name="returnsText" maxLength={30000} defaultValue={initial.legal.returnsText} /></label>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <span className={styles.message}>{message || "Изменения применяются сразу после сохранения."}</span>
        <button type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить настройки запуска"}</button>
      </div>
    </form>
  );
}
