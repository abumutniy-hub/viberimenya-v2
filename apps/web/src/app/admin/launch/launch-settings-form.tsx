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

export type ReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  value: string;
  critical: boolean;
};

async function responseJson(response: Response) {
  try {
    return (await response.json()) as { message?: string; error?: string };
  } catch {
    return null;
  }
}

export function LaunchSettingsForm({
  initial,
  readiness,
}: {
  initial: LaunchSettings;
  readiness: ReadinessItem[];
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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

  return (
    <form className={styles.page} onSubmit={submit}>
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
          <h2>Готовность к запуску</h2>
          <p>Автоматическая проверка данных, которые чаще всего забывают перед открытием магазина.</p>
          <div className={styles.readiness}>
            {readiness.map((item) => (
              <div key={item.key} className={item.ok ? styles.ok : styles.warning}>
                <span>{item.ok ? "✓" : item.critical ? "!" : "•"} {item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
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
              <span><strong>Разрешить индексацию</strong><small>До финального наполнения каталога можно оставить выключенным.</small></span>
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
          <p>Если поле пустое, сайт использует безопасный базовый шаблон с реквизитами из CRM. Для собственного текста: первая строка блока — заголовок, пустая строка разделяет блоки.</p>
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
