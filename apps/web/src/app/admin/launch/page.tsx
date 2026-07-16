import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import {
  LaunchSettingsForm,
  type LaunchSettings,
  type ReadinessItem,
} from "./launch-settings-form";

export const dynamic = "force-dynamic";

type LaunchResponse = {
  settings?: AdminRow;
  readiness?: ReadinessItem[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function buildInitial(value: unknown): LaunchSettings {
  const root = record(value);
  const launch = record(root.launch);
  const seo = record(root.seo);
  const analytics = record(root.analytics);
  const legal = record(root.legal);

  return {
    launch: {
      acceptingOrders: bool(launch.acceptingOrders, true),
      maintenanceMode: bool(launch.maintenanceMode, false),
      maintenanceTitle: text(launch.maintenanceTitle, "Магазин скоро вернётся"),
      maintenanceMessage: text(launch.maintenanceMessage, "Мы обновляем витрину. Уже оформленные заказы продолжают работать."),
      ordersPausedMessage: text(launch.ordersPausedMessage, "Приём новых заказов временно приостановлен. Каталог доступен для просмотра."),
    },
    seo: {
      siteTitle: text(seo.siteTitle, "Выбери Меня — цветы с доставкой"),
      siteDescription: text(seo.siteDescription, "Стильные букеты, фото перед доставкой и бережная доставка получателю."),
      ogImageUrl: text(seo.ogImageUrl),
      yandexVerification: text(seo.yandexVerification),
      indexingEnabled: bool(seo.indexingEnabled, false),
    },
    analytics: {
      enabled: bool(analytics.enabled, false),
      yandexMetrikaId: text(analytics.yandexMetrikaId),
    },
    legal: {
      privacyText: text(legal.privacyText),
      consentText: text(legal.consentText),
      offerText: text(legal.offerText),
      deliveryText: text(legal.deliveryText),
      returnsText: text(legal.returnsText),
    },
  };
}

export default async function AdminLaunchPage() {
  const data = await fetchAdmin<LaunchResponse>("/api/admin/launch");
  const settings = record(data?.settings?.settings);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Подготовка магазина</span>
          <h1>Запуск сайта</h1>
          <p>Приём заказов, технический режим, SEO, аналитика и юридические документы.</p>
        </div>
      </div>

      <LaunchSettingsForm
        initial={buildInitial(settings)}
        readiness={data?.readiness ?? []}
      />
    </div>
  );
}
