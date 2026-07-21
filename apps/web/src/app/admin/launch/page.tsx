import { fetchAdmin, type AdminRow } from "../lib/admin-api";
import {
  LaunchSettingsForm,
  type ControlOrder,
  type LaunchSettings,
  type LaunchSummary,
  type ReadinessItem,
  type RecentOrder,
} from "./launch-settings-form";

export const dynamic = "force-dynamic";

type LaunchResponse = {
  settings?: AdminRow;
  readiness?: ReadinessItem[];
  summary?: LaunchSummary;
  recentOrders?: RecentOrder[];
  controlOrder?: ControlOrder | null;
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

const emptySummary: LaunchSummary = {
  score: 0,
  total: 0,
  passed: 0,
  criticalBlockers: 1,
  warnings: 0,
  configurationReady: false,
  controlOrderReady: false,
  readyForLaunch: false,
  status: "blocked",
};

export default async function AdminLaunchPage() {
  const data = await fetchAdmin<LaunchResponse>("/api/admin/launch");
  const settings = record(data?.settings?.settings);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <span>Контроль основного запуска</span>
          <h1>Запуск сайта</h1>
          <p>Автоматические блокеры, контрольный заказ, приём заказов, SEO и юридические документы.</p>
        </div>
      </div>

      <LaunchSettingsForm
        initial={buildInitial(settings)}
        readiness={data?.readiness ?? []}
        summary={data?.summary ?? emptySummary}
        recentOrders={data?.recentOrders ?? []}
        controlOrder={data?.controlOrder ?? null}
      />
    </div>
  );
}
