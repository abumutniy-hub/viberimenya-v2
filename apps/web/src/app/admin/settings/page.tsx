import {
  SettingsForm,
  type HeroImageOption,
  type StoreSettingsFormData
} from "./settings-form";

import {
  fetchAdmin,
  type AdminRow
} from "../lib/admin-api";

export const dynamic = "force-dynamic";

type Response = {
  settings: AdminRow | null;
  domains: AdminRow[];
  heroImages: AdminRow[];
};

const defaultOccasions = [
  "Любимой",
  "Маме",
  "День рождения",
  "Извиниться",
  "Без повода",
  "Свадьба",
  "Выписка",
  "Учителю"
];

const defaultBenefits = [
  {
    title: "Стильные букеты",
    text:
      "Авторские композиции из свежих цветов на любой случай."
  },
  {
    title: "Фото перед доставкой",
    text:
      "Покажем готовый букет, чтобы вы были уверены в результате."
  },
  {
    title: "Бережная доставка",
    text:
      "Аккуратно упакуем и доставим в выбранный интервал."
  }
];

function recordValue(
  value: unknown
): Record<string, unknown> {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
}

function text(
  value: unknown,
  fallback = ""
) {
  const result = String(
    value ?? ""
  ).trim();

  return result || fallback;
}

function booleanValue(
  value: unknown,
  fallback: boolean
) {
  if (
    value === true
    || value === "true"
    || value === "t"
    || value === 1
    || value === "1"
  ) {
    return true;
  }

  if (
    value === false
    || value === "false"
    || value === "f"
    || value === 0
    || value === "0"
  ) {
    return false;
  }

  return fallback;
}

function numberValue(
  value: unknown,
  fallback: number
) {
  const result = Number(value);

  return Number.isFinite(result)
    ? Math.max(0, Math.round(result))
    : fallback;
}

function stringArray(
  value: unknown,
  fallback: string[]
) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 12);

  return items.length > 0
    ? items
    : fallback;
}

function benefitArray(
  value: unknown
) {
  if (!Array.isArray(value)) {
    return defaultBenefits;
  }

  const items = value
    .map((item) => {
      const row = recordValue(item);

      return {
        title: text(row.title),
        text: text(row.text)
      };
    })
    .filter(
      (item) => item.title && item.text
    )
    .slice(0, 3);

  return items.length === 3
    ? items
    : defaultBenefits;
}

function buildInitialSettings(
  row: AdminRow | null
): StoreSettingsFormData {
  const content = recordValue(
    row?.settings
  );

  const site = recordValue(
    content.site
  );

  const homepage = recordValue(
    content.homepage
  );

  const delivery = recordValue(
    content.delivery
  );

  return {
    phone: text(row?.phone),
    whatsapp: text(row?.whatsapp),
    telegram: text(row?.telegram),
    instagram: text(row?.instagram),
    address: text(row?.address),
    workHours: text(row?.work_hours),
    heroTitle: text(
      row?.hero_title,
      "Цветы, которые говорят за вас"
    ),
    heroSubtitle: text(
      row?.hero_subtitle,
      "Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю."
    ),
    heroImageUrl: text(
      row?.hero_image_url
    ),
    isOnlinePaymentEnabled:
      booleanValue(
        row?.is_online_payment_enabled,
        false
      ),
    isCashPaymentEnabled:
      booleanValue(
        row?.is_cash_payment_enabled,
        true
      ),
    isTransferPaymentEnabled:
      booleanValue(
        row?.is_transfer_payment_enabled,
        true
      ),
    site: {
      brandName: text(
        site.brandName,
        "Выбери Меня"
      ),
      brandSubtitle: text(
        site.brandSubtitle,
        "ЦВЕТЫ И ПОДАРКИ"
      ),
      footerDescription: text(
        site.footerDescription,
        "Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю."
      ),
      email: text(site.email),
      legalName: text(site.legalName),
      inn: text(site.inn),
      ogrn: text(site.ogrn),
      policyUrl: text(site.policyUrl),
      offerUrl: text(site.offerUrl),
      deliveryTermsUrl: text(
        site.deliveryTermsUrl
      ),
      returnsUrl: text(site.returnsUrl)
    },
    homepage: {
      eyebrow: text(
        homepage.eyebrow,
        "Цветочная мастерская"
      ),
      primaryCtaLabel: text(
        homepage.primaryCtaLabel,
        "Выбрать букет"
      ),
      secondaryCtaLabel: text(
        homepage.secondaryCtaLabel,
        "Условия доставки"
      ),
      occasions: stringArray(
        homepage.occasions,
        defaultOccasions
      ),
      benefits: benefitArray(
        homepage.benefits
      )
    },
    delivery: {
      pickupEnabled: booleanValue(
        delivery.pickupEnabled,
        true
      ),
      pickupAddress: text(
        delivery.pickupAddress
      ),
      pickupNote: text(
        delivery.pickupNote,
        "После оформления менеджер подтвердит время готовности заказа."
      ),
      minimumOrderAmount: numberValue(
        delivery.minimumOrderAmount,
        0
      ),
      orderLeadTimeMinutes: numberValue(
        delivery.orderLeadTimeMinutes,
        120
      ),
      expressLeadTimeMinutes: numberValue(
        delivery.expressLeadTimeMinutes,
        60
      ),
      notice: text(delivery.notice)
    }
  };
}

export default async function AdminSettingsPage() {
  const data = await fetchAdmin<Response>(
    "/api/admin/settings"
  );

  const initialSettings =
    buildInitialSettings(
      data?.settings ?? null
    );

  const heroImages: HeroImageOption[] =
    (data?.heroImages ?? [])
      .filter(
        (image) =>
          typeof image.product_id === "string"
          && typeof image.product_name === "string"
          && typeof image.url === "string"
      )
      .map((image) => ({
        productId: String(
          image.product_id
        ),
        productName: String(
          image.product_name
        ),
        url: String(image.url),
        alt: text(
          image.alt,
          String(image.product_name)
        )
      }));

  const primaryDomain =
    (data?.domains ?? []).find(
      (domain) =>
        booleanValue(
          domain.is_primary,
          false
        )
    )
    ?? data?.domains?.[0]
    ?? null;

  return (
    <div className="admin-page admin-settings-page">
      <div className="admin-page-head">
        <div>
          <span>Управление сайтом</span>
          <h1>Настройки магазина</h1>
          <p>
            Контакты, содержание главной,
            самовывоз, оплата и реквизиты
            без изменения кода.
          </p>
        </div>

        {primaryDomain ? (
          <a
            href={`https://${String(
              primaryDomain.domain
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть сайт
          </a>
        ) : null}
      </div>

      <section className="admin-settings-summary">
        <article>
          <span>Главное фото</span>
          <strong>
            {initialSettings.heroImageUrl
              ? "Выбрано вручную"
              : "Автоматически"}
          </strong>
        </article>

        <article>
          <span>Самовывоз</span>
          <strong>
            {initialSettings.delivery
              .pickupEnabled
              ? "Включён"
              : "Отключён"}
          </strong>
        </article>

        <article>
          <span>Минимальный заказ</span>
          <strong>
            {initialSettings.delivery
              .minimumOrderAmount > 0
              ? `${initialSettings.delivery.minimumOrderAmount.toLocaleString("ru-RU")} ₽`
              : "Без ограничения"}
          </strong>
        </article>

        <article>
          <span>Способы оплаты</span>
          <strong>
            {[
              initialSettings
                .isTransferPaymentEnabled,
              initialSettings
                .isCashPaymentEnabled,
              initialSettings
                .isOnlinePaymentEnabled
            ].filter(Boolean).length}
          </strong>
        </article>
      </section>

      <SettingsForm
        initialSettings={initialSettings}
        heroImages={heroImages}
      />
    </div>
  );
}
