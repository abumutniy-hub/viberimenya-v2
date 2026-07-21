export type PublicSiteSettings = {
  phone: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
  address: string;
  workHours: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string;
  site: {
    brandName: string;
    brandSubtitle: string;
    footerDescription: string;
    email: string;
    legalName: string;
    inn: string;
    ogrn: string;
    settlementAccount: string;
    bankName: string;
    bik: string;
    correspondentAccount: string;
    policyUrl: string;
    offerUrl: string;
    deliveryTermsUrl: string;
    returnsUrl: string;
  };
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

export const defaultPublicSettings: PublicSiteSettings = {
  phone: "",
  whatsapp: "",
  telegram: "",
  instagram: "",
  address: "",
  workHours: "",
  heroTitle: "Цветы, которые говорят за вас",
  heroSubtitle:
    "Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю.",
  heroImageUrl: "",
  site: {
    brandName: "Выбери Меня",
    brandSubtitle: "ЦВЕТЫ И ПОДАРКИ",
    footerDescription:
      "Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю.",
    email: "",
    legalName: "",
    inn: "",
    ogrn: "",
    settlementAccount: "",
    bankName: "",
    bik: "",
    correspondentAccount: "",
    policyUrl: "/privacy",
    offerUrl: "/offer",
    deliveryTermsUrl: "/delivery",
    returnsUrl: "/returns",
  },
  launch: {
    acceptingOrders: true,
    maintenanceMode: false,
    maintenanceTitle: "Магазин скоро вернётся",
    maintenanceMessage:
      "Мы обновляем витрину. Уже оформленные заказы и их отслеживание продолжают работать.",
    ordersPausedMessage:
      "Приём новых заказов временно приостановлен. Каталог доступен для просмотра.",
  },
  seo: {
    siteTitle: "Выбери Меня — цветы с доставкой",
    siteDescription:
      "Стильные букеты, фото перед доставкой и бережная доставка получателю.",
    ogImageUrl: "",
    yandexVerification: "",
    indexingEnabled: false,
  },
  analytics: {
    enabled: false,
    yandexMetrikaId: "",
  },
  legal: {
    privacyText: "",
    consentText: "",
    offerText: "",
    deliveryText: "",
    returnsText: "",
  },
};

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function loadPublicSettings(): Promise<PublicSiteSettings> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}/api/public/shop`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      return defaultPublicSettings;
    }

    const data = (await response.json()) as {
      settings?: Record<string, unknown>;
    };

    const settings = recordValue(data.settings);
    const site = recordValue(settings.site);
    const launch = recordValue(settings.launch);
    const seo = recordValue(settings.seo);
    const analytics = recordValue(settings.analytics);
    const legal = recordValue(settings.legal);

    return {
      phone: text(settings.phone),
      whatsapp: text(settings.whatsapp),
      telegram: text(settings.telegram),
      instagram: text(settings.instagram),
      address: text(settings.address),
      workHours: text(settings.workHours),
      heroTitle: text(settings.heroTitle, defaultPublicSettings.heroTitle),
      heroSubtitle: text(
        settings.heroSubtitle,
        defaultPublicSettings.heroSubtitle,
      ),
      heroImageUrl: text(settings.heroImageUrl),
      site: {
        brandName: text(site.brandName, defaultPublicSettings.site.brandName),
        brandSubtitle: text(
          site.brandSubtitle,
          defaultPublicSettings.site.brandSubtitle,
        ),
        footerDescription: text(
          site.footerDescription,
          defaultPublicSettings.site.footerDescription,
        ),
        email: text(site.email),
        legalName: text(site.legalName),
        inn: text(site.inn),
        ogrn: text(site.ogrn),
        settlementAccount: text(site.settlementAccount),
        bankName: text(site.bankName),
        bik: text(site.bik),
        correspondentAccount: text(site.correspondentAccount),
        policyUrl: text(site.policyUrl, "/privacy"),
        offerUrl: text(site.offerUrl, "/offer"),
        deliveryTermsUrl: text(site.deliveryTermsUrl, "/delivery"),
        returnsUrl: text(site.returnsUrl, "/returns"),
      },
      launch: {
        acceptingOrders: bool(
          launch.acceptingOrders,
          defaultPublicSettings.launch.acceptingOrders,
        ),
        maintenanceMode: bool(
          launch.maintenanceMode,
          defaultPublicSettings.launch.maintenanceMode,
        ),
        maintenanceTitle: text(
          launch.maintenanceTitle,
          defaultPublicSettings.launch.maintenanceTitle,
        ),
        maintenanceMessage: text(
          launch.maintenanceMessage,
          defaultPublicSettings.launch.maintenanceMessage,
        ),
        ordersPausedMessage: text(
          launch.ordersPausedMessage,
          defaultPublicSettings.launch.ordersPausedMessage,
        ),
      },
      seo: {
        siteTitle: text(seo.siteTitle, defaultPublicSettings.seo.siteTitle),
        siteDescription: text(
          seo.siteDescription,
          defaultPublicSettings.seo.siteDescription,
        ),
        ogImageUrl: text(seo.ogImageUrl),
        yandexVerification: text(seo.yandexVerification),
        indexingEnabled: bool(
          seo.indexingEnabled,
          defaultPublicSettings.seo.indexingEnabled,
        ),
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
  } catch {
    return defaultPublicSettings;
  }
}

export async function loadLegalSettings(): Promise<PublicSiteSettings> {
  const base = await loadPublicSettings();
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}/api/public/legal`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) return base;

    const data = (await response.json()) as { settings?: Record<string, unknown> };
    const settings = recordValue(data.settings);
    const site = recordValue(settings.site);
    const legal = recordValue(settings.legal);

    return {
      ...base,
      phone: text(settings.phone, base.phone),
      address: text(settings.address, base.address),
      workHours: text(settings.workHours, base.workHours),
      site: {
        ...base.site,
        brandName: text(site.brandName, base.site.brandName),
        email: text(site.email, base.site.email),
        legalName: text(site.legalName, base.site.legalName),
        inn: text(site.inn, base.site.inn),
        ogrn: text(site.ogrn, base.site.ogrn),
        settlementAccount: text(site.settlementAccount, base.site.settlementAccount),
        bankName: text(site.bankName, base.site.bankName),
        bik: text(site.bik, base.site.bik),
        correspondentAccount: text(site.correspondentAccount, base.site.correspondentAccount),
      },
      legal: {
        privacyText: text(legal.privacyText),
        consentText: text(legal.consentText),
        offerText: text(legal.offerText),
        deliveryText: text(legal.deliveryText),
        returnsText: text(legal.returnsText),
      },
    };
  } catch {
    return base;
  }
}
