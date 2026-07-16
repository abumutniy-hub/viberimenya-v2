import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq, asc, desc } from "drizzle-orm";
import {
  categories,
  createDb,
  deliveryIntervals,
  deliveryZones,
  productImages,
  products,
  shopDomains,
  shops,
  shopSettings,
} from "@viberimenya/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http-error";

type UnknownRecord = Record<string, unknown>;

const LOCAL_TELEGRAM_ORDER_SOURCE = "telegram-bot";
const TELEGRAM_ORDER_TOKEN_CONTEXT = "viberimenya:telegram-order-create:v1";

function telegramOrderInternalToken() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";

  if (!botToken) return "";

  return createHash("sha256")
    .update(`${TELEGRAM_ORDER_TOKEN_CONTEXT}:${botToken}`)
    .digest("hex");
}

function safeTokenEqual(left: string, right: string) {
  if (!left || !right) return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function telegramOrderSourceRequested(request: FastifyRequest) {
  const sourceHeader = request.headers["x-vm-order-source"];
  const source = Array.isArray(sourceHeader) ? sourceHeader[0] : sourceHeader;

  return source === LOCAL_TELEGRAM_ORDER_SOURCE;
}

function localTelegramChatId(request: FastifyRequest): string | null {
  const sourceHeader = request.headers["x-vm-order-source"];
  const chatHeader = request.headers["x-vm-telegram-chat-id"];
  const tokenHeader = request.headers["x-vm-internal-token"];
  const source = Array.isArray(sourceHeader) ? sourceHeader[0] : sourceHeader;
  const rawChatId = Array.isArray(chatHeader) ? chatHeader[0] : chatHeader;
  const suppliedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const expectedToken = telegramOrderInternalToken();
  const remoteAddress = request.socket.remoteAddress || "";
  const isLoopback = [
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ].includes(remoteAddress);

  if (
    !isLoopback
    || source !== LOCAL_TELEGRAM_ORDER_SOURCE
    || typeof rawChatId !== "string"
    || !/^\d{1,20}$/.test(rawChatId)
    || typeof suppliedToken !== "string"
    || !safeTokenEqual(suppliedToken, expectedToken)
  ) {
    return null;
  }

  return rawChatId;
}

type ContentSettings = {
  site: {
    brandName: string;
    brandSubtitle: string;
    footerDescription: string;
    email: string;
    legalName: string;
    inn: string;
    ogrn: string;
    policyUrl: string;
    offerUrl: string;
    deliveryTermsUrl: string;
    returnsUrl: string;
  };
  homepage: {
    eyebrow: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
    occasions: string[];
    benefits: Array<{
      title: string;
      text: string;
    }>;
  };
  delivery: {
    pickupEnabled: boolean;
    pickupAddress: string;
    pickupNote: string;
    minimumOrderAmount: number;
    orderLeadTimeMinutes: number;
    expressLeadTimeMinutes: number;
    notice: string;
  };
};

const defaultContentSettings: ContentSettings = {
  site: {
    brandName: "Выбери Меня",
    brandSubtitle: "ЦВЕТЫ И ПОДАРКИ",
    footerDescription:
      "Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю.",
    email: "",
    legalName: "",
    inn: "",
    ogrn: "",
    policyUrl: "",
    offerUrl: "",
    deliveryTermsUrl: "",
    returnsUrl: "",
  },
  homepage: {
    eyebrow: "Цветочная мастерская",
    primaryCtaLabel: "Выбрать букет",
    secondaryCtaLabel: "Условия доставки",
    occasions: [
      "Любимой",
      "Маме",
      "День рождения",
      "Извиниться",
      "Без повода",
      "Свадьба",
      "Выписка",
      "Учителю",
    ],
    benefits: [
      {
        title: "Стильные букеты",
        text: "Авторские композиции из свежих цветов на любой случай.",
      },
      {
        title: "Фото перед доставкой",
        text: "Покажем готовый букет, чтобы вы были уверены в результате.",
      },
      {
        title: "Бережная доставка",
        text: "Аккуратно упакуем и доставим в выбранный интервал.",
      },
    ],
  },
  delivery: {
    pickupEnabled: true,
    pickupAddress: "",
    pickupNote:
      "После оформления менеджер подтвердит время готовности заказа.",
    minimumOrderAmount: 0,
    orderLeadTimeMinutes: 120,
    expressLeadTimeMinutes: 60,
    notice: "",
  },
};

function asRecord(value: unknown): UnknownRecord {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  ) {
    return value as UnknownRecord;
  }

  return {};
}

function textSetting(
  record: UnknownRecord,
  key: string,
  fallback: string,
  maximumLength = 1000,
) {
  const value = String(record[key] ?? "").trim();

  return value
    ? value.slice(0, maximumLength)
    : fallback;
}

function optionalTextSetting(
  record: UnknownRecord,
  key: string,
  maximumLength = 1000,
) {
  return String(record[key] ?? "")
    .trim()
    .slice(0, maximumLength);
}

function booleanSetting(
  record: UnknownRecord,
  key: string,
  fallback: boolean,
) {
  const value = record[key];

  return typeof value === "boolean"
    ? value
    : fallback;
}

function numberSetting(
  record: UnknownRecord,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(record[key]);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, Math.round(value)),
  );
}

function safePublicLink(value: string) {
  if (
    value.startsWith("/")
    || /^https:\/\/[a-z0-9.-]+(?:[/:?#].*)?$/i.test(value)
  ) {
    return value;
  }

  return "";
}

function safeProductImage(value: string) {
  return /^\/uploads\/products\/[a-zA-Z0-9._-]+$/.test(value)
    ? value
    : "";
}

function readContentSettings(value: unknown): ContentSettings {
  const root = asRecord(value);
  const site = asRecord(root.site);
  const homepage = asRecord(root.homepage);
  const delivery = asRecord(root.delivery);

  const rawOccasions = Array.isArray(homepage.occasions)
    ? homepage.occasions
    : [];

  const occasions = rawOccasions
    .map((item) => String(item ?? "").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);

  const rawBenefits = Array.isArray(homepage.benefits)
    ? homepage.benefits
    : [];

  const benefits = rawBenefits
    .map((item) => {
      const benefit = asRecord(item);

      return {
        title: optionalTextSetting(benefit, "title", 100),
        text: optionalTextSetting(benefit, "text", 260),
      };
    })
    .filter((item) => item.title && item.text)
    .slice(0, 3);

  return {
    site: {
      brandName: textSetting(
        site,
        "brandName",
        defaultContentSettings.site.brandName,
        120,
      ),
      brandSubtitle: textSetting(
        site,
        "brandSubtitle",
        defaultContentSettings.site.brandSubtitle,
        120,
      ),
      footerDescription: textSetting(
        site,
        "footerDescription",
        defaultContentSettings.site.footerDescription,
        1000,
      ),
      email: optionalTextSetting(site, "email", 255),
      legalName: optionalTextSetting(site, "legalName", 255),
      inn: optionalTextSetting(site, "inn", 20),
      ogrn: optionalTextSetting(site, "ogrn", 20),
      policyUrl: safePublicLink(
        optionalTextSetting(site, "policyUrl", 500),
      ),
      offerUrl: safePublicLink(
        optionalTextSetting(site, "offerUrl", 500),
      ),
      deliveryTermsUrl: safePublicLink(
        optionalTextSetting(site, "deliveryTermsUrl", 500),
      ),
      returnsUrl: safePublicLink(
        optionalTextSetting(site, "returnsUrl", 500),
      ),
    },
    homepage: {
      eyebrow: textSetting(
        homepage,
        "eyebrow",
        defaultContentSettings.homepage.eyebrow,
        120,
      ),
      primaryCtaLabel: textSetting(
        homepage,
        "primaryCtaLabel",
        defaultContentSettings.homepage.primaryCtaLabel,
        80,
      ),
      secondaryCtaLabel: textSetting(
        homepage,
        "secondaryCtaLabel",
        defaultContentSettings.homepage.secondaryCtaLabel,
        80,
      ),
      occasions:
        occasions.length > 0
          ? occasions
          : defaultContentSettings.homepage.occasions,
      benefits:
        benefits.length === 3
          ? benefits
          : defaultContentSettings.homepage.benefits,
    },
    delivery: {
      pickupEnabled: booleanSetting(
        delivery,
        "pickupEnabled",
        defaultContentSettings.delivery.pickupEnabled,
      ),
      pickupAddress: optionalTextSetting(
        delivery,
        "pickupAddress",
        1000,
      ),
      pickupNote: textSetting(
        delivery,
        "pickupNote",
        defaultContentSettings.delivery.pickupNote,
        1000,
      ),
      minimumOrderAmount: numberSetting(
        delivery,
        "minimumOrderAmount",
        defaultContentSettings.delivery.minimumOrderAmount,
        0,
        10000000,
      ),
      orderLeadTimeMinutes: numberSetting(
        delivery,
        "orderLeadTimeMinutes",
        defaultContentSettings.delivery.orderLeadTimeMinutes,
        0,
        10080,
      ),
      expressLeadTimeMinutes: numberSetting(
        delivery,
        "expressLeadTimeMinutes",
        defaultContentSettings.delivery.expressLeadTimeMinutes,
        0,
        1440,
      ),
      notice: optionalTextSetting(delivery, "notice", 1000),
    },
  };
}

const bouquetApprovalResponseSchema = z.object({
  action: z.enum(["approve", "revision"]),
  note: z.string().trim().max(500).optional().default(""),
});

const createOrderSchema = z.object({
  clientRequestId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(160),
  customerPhone: z.string().trim().min(5).max(32),
  customerEmail: z
    .union([z.string().trim().email().max(255), z.literal("")])
    .optional()
    .default(""),
  recipientSameAsCustomer: z.boolean().optional().default(false),
  recipientName: z.string().trim().max(160).optional().default(""),
  recipientPhone: z.string().trim().max(32).optional().default(""),
  isSurprise: z.boolean().optional().default(false),
  doNotCallRecipient: z.boolean().optional().default(false),
  cardText: z.string().trim().max(500).optional().default(""),
  contactPreference: z
    .enum(["call_or_message", "phone_call", "messenger_only"])
    .optional()
    .default("call_or_message"),
  deliveryType: z.enum(["delivery", "pickup"]).default("delivery"),
  deliveryService: z
    .enum(["standard", "express"])
    .optional()
    .default("standard"),
  deliveryAddress: z.string().trim().max(1000).optional().default(""),
  deliveryComment: z.string().trim().max(1000).optional().default(""),
  deliveryDate: z.string().trim().max(10).optional().default(""),
  deliveryIntervalId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .default(""),
  deliveryIntervalText: z.string().trim().max(80).optional().default(""),
  deliveryZoneId: z.string().uuid().optional().or(z.literal("")).default(""),
  paymentMethod: z
    .enum(["cash_on_delivery", "transfer_after_confirm", "online_card", "sbp"])
    .default("transfer_after_confirm"),
  customerComment: z.string().trim().max(2000).optional().default(""),
  promoCode: z.string().trim().max(80).optional().default(""),
  bonusToSpend: z.coerce.number().int().min(0).optional().default(0),
  privacyAccepted: z.literal(true),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(100),
});

function createOrderNumber() {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);

  return `VM-${Date.now()}${randomSuffix}`;
}

function createTrackingToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

function normalizePromoCode(code: string) {
  return code.trim().toUpperCase();
}

function calculateDiscount(params: {
  subtotal: number;
  discountType: string;
  discountValue: number;
}) {
  if (params.subtotal <= 0) return 0;

  if (params.discountType === "percent") {
    return Math.min(
      params.subtotal,
      Math.floor((params.subtotal * params.discountValue) / 100),
    );
  }

  return Math.min(params.subtotal, params.discountValue);
}

const CUSTOMER_SESSION_COOKIE = "vm_customer_session";

function createLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function phoneDigitCandidates(value: string) {
  const digits = value.replace(/\D/g, "");
  const candidates = new Set<string>();

  if (digits) {
    candidates.add(digits);
  }

  if (digits.length === 11 && digits.startsWith("8")) {
    candidates.add(`7${digits.slice(1)}`);
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    candidates.add(`8${digits.slice(1)}`);
  }

  if (digits.length === 10) {
    candidates.add(`7${digits}`);
    candidates.add(`8${digits}`);
  }

  return Array.from(candidates);
}

function normalizeRussianPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  return value.trim();
}

function isValidContactPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function getMoscowDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateCreateOrderBody(body: z.infer<typeof createOrderSchema>) {
  if (!isValidContactPhone(body.customerPhone)) {
    throw new HttpError(400, "Укажите корректный телефон покупателя");
  }

  if (!body.recipientSameAsCustomer && body.recipientName.trim().length < 2) {
    throw new HttpError(400, "Укажите имя получателя");
  }

  if (
    !body.recipientSameAsCustomer &&
    !isValidContactPhone(body.recipientPhone)
  ) {
    throw new HttpError(400, "Укажите корректный телефон получателя");
  }

  if (body.deliveryType === "delivery") {
    if (body.deliveryAddress.trim().length < 5) {
      throw new HttpError(400, "Укажите полный адрес доставки");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate)) {
      throw new HttpError(400, "Выберите дату доставки");
    }

    const today = getMoscowDateString();
    const latestDate = addDaysToIsoDate(today, 180);

    if (body.deliveryDate < today) {
      throw new HttpError(400, "Дата доставки не может быть в прошлом");
    }

    if (body.deliveryDate > latestDate) {
      throw new HttpError(
        400,
        "Дату доставки можно выбрать не более чем на 180 дней вперёд",
      );
    }
  }
}

function createSessionToken() {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

function createTelegramLinkCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return "";

  const parts = cookieHeader.split(";").map((item) => item.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");

    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

function customerCookieSecuritySuffix() {
  return env.NODE_ENV === "production" ? "; Secure" : "";
}

function buildCustomerSessionCookie(token: string) {
  return `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${customerCookieSecuritySuffix()}`;
}

function clearCustomerSessionCookie() {
  return `${CUSTOMER_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${customerCookieSecuritySuffix()}`;
}

type PublicSqlClient = ReturnType<typeof createDb>["client"];

type ActiveCustomerSession = {
  shop_id: string;
  customer_id: string;
};

async function getActiveCustomerSession(
  client: PublicSqlClient,
  cookieHeader: string | undefined,
): Promise<ActiveCustomerSession | null> {
  const token = getCookieValue(cookieHeader, CUSTOMER_SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const rows = await client<ActiveCustomerSession[]>`
    SELECT shop_id, customer_id
    FROM customer_sessions
    WHERE token = ${token}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] ?? null;
}

const customerAddressSchema = z.object({
  city: z.string().trim().min(2).max(120),
  street: z.string().trim().min(2).max(255),
  house: z.string().trim().min(1).max(60),
  apartment: z.string().trim().max(60).optional().default(""),
  entrance: z.string().trim().max(60).optional().default(""),
  floor: z.string().trim().max(60).optional().default(""),
  comment: z.string().trim().max(500).optional().default(""),
  isDefault: z.boolean().optional().default(false),
});

async function getShopContext() {
  const { db, client } = createDb();

  try {
    const shopRows = await db
      .select()
      .from(shops)
      .where(eq(shops.slug, env.DEFAULT_SHOP_SLUG))
      .limit(1);

    const shop = shopRows[0];

    if (!shop) {
      throw new HttpError(404, "Shop not found");
    }

    return { db, client, shop };
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function publicRoutes(app: FastifyInstance) {
  // PUBLIC CATALOG SECURITY 1.0
  app.get("/api/public/shop", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const settingsRows = await db
        .select()
        .from(shopSettings)
        .where(eq(shopSettings.shopId, shop.id))
        .limit(1);

      const domains = await db
        .select()
        .from(shopDomains)
        .where(eq(shopDomains.shopId, shop.id));

      const settings = settingsRows[0] ?? null;
      const content = readContentSettings(settings?.settings);

      return {
        shop: {
          slug: shop.slug,
          name: shop.name,
          timezone: shop.timezone,
          currency: shop.currency,
        },
        settings: {
          phone: settings?.phone ?? "",
          whatsapp: settings?.whatsapp ?? "",
          telegram: settings?.telegram ?? "",
          instagram: settings?.instagram ?? "",
          address: settings?.address ?? "",
          workHours: settings?.workHours ?? "",
          heroTitle:
            settings?.heroTitle
            ?? "Цветы, которые говорят за вас",
          heroSubtitle:
            settings?.heroSubtitle
            ?? "Собираем стильные букеты и бережно доставляем получателю.",
          heroImageUrl: safeProductImage(
            settings?.heroImageUrl ?? "",
          ),
          site: content.site,
          delivery: content.delivery,
          paymentMethods: {
            online: settings?.isOnlinePaymentEnabled === true,
            cash: settings?.isCashPaymentEnabled !== false,
            transfer: settings?.isTransferPaymentEnabled !== false,
          },
        },
        domains: domains.map((domain) => ({
          domain: domain.domain,
          isPrimary: domain.isPrimary,
        })),
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/home", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const settingsRows = await db
        .select()
        .from(shopSettings)
        .where(eq(shopSettings.shopId, shop.id))
        .limit(1);

      const settings = settingsRows[0] ?? null;
      const content = readContentSettings(settings?.settings);

      const categoryRows = await client<
        {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          image_url: string | null;
          product_count: number;
        }[]
      >`
        SELECT
          c.id,
          c.slug,
          c.name,
          c.description,
          c.image_url,
          COUNT(p.id)::int AS product_count
        FROM categories c
        INNER JOIN products p
          ON p.category_id = c.id
          AND p.shop_id = c.shop_id
          AND p.status = 'active'
        WHERE c.shop_id = ${shop.id}
          AND c.is_active = true
        GROUP BY
          c.id,
          c.slug,
          c.name,
          c.description,
          c.image_url,
          c.sort_order
        ORDER BY
          c.sort_order ASC,
          c.name ASC
        LIMIT 6
      `;

      const productRows = await client<
        {
          id: string;
          category_id: string | null;
          category_name: string | null;
          category_slug: string | null;
          slug: string;
          name: string;
          short_description: string | null;
          description: string | null;
          price: number;
          old_price: number | null;
          is_featured: boolean;
          image_url: string | null;
          image_alt: string | null;
        }[]
      >`
        SELECT
          p.id,
          p.category_id,
          c.name AS category_name,
          c.slug AS category_slug,
          p.slug,
          p.name,
          p.short_description,
          p.description,
          p.price,
          p.old_price,
          p.is_featured,
          image.url AS image_url,
          image.alt AS image_alt
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
          AND c.is_active = true
        LEFT JOIN LATERAL (
          SELECT
            pi.url,
            pi.alt
          FROM product_images pi
          WHERE pi.shop_id = p.shop_id
            AND pi.product_id = p.id
          ORDER BY
            pi.is_main DESC,
            pi.sort_order ASC,
            pi.created_at ASC
          LIMIT 1
        ) image ON true
        WHERE p.shop_id = ${shop.id}
          AND p.status = 'active'
          AND COALESCE(p.stock_quantity, 0) > 0
          AND (
            p.category_id IS NULL
            OR c.id IS NOT NULL
          )
        ORDER BY
          p.is_featured DESC,
          p.sort_order ASC,
          p.created_at DESC
        LIMIT 8
      `;

      const featuredProducts = productRows.map((product) => ({
        id: product.id,
        categoryId: product.category_id,
        categoryName: product.category_name,
        categorySlug: product.category_slug,
        slug: product.slug,
        name: product.name,
        shortDescription: product.short_description,
        description: product.description,
        price: Number(product.price),
        oldPrice: product.old_price === null ? null : Number(product.old_price),
        isFeatured: product.is_featured,
        availability: "available" as const,
        primaryImage: product.image_url
          ? {
              url: product.image_url,
              alt: product.image_alt,
            }
          : null,
      }));

      return {
        shop: {
          slug: shop.slug,
          name: shop.name,
        },
        settings: {
          phone: settings?.phone ?? "",
          address: settings?.address ?? "",
          workHours: settings?.workHours ?? "",
        },
        sections: {
          hero: {
            eyebrow: content.homepage.eyebrow,
            title:
              settings?.heroTitle
              ?? "Цветы, которые говорят за вас",
            subtitle:
              settings?.heroSubtitle
              ?? "Собираем стильные букеты и бережно доставляем получателю.",
            imageUrl: safeProductImage(
              settings?.heroImageUrl ?? "",
            ),
            primaryCtaLabel:
              content.homepage.primaryCtaLabel,
            secondaryCtaLabel:
              content.homepage.secondaryCtaLabel,
            benefits: content.homepage.benefits,
          },
          occasions: content.homepage.occasions,
          categories: categoryRows.map((category) => ({
            id: category.id,
            slug: category.slug,
            name: category.name,
            description: category.description,
            imageUrl: category.image_url,
            productCount: Number(category.product_count),
          })),
          featuredProducts,
        },
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/categories", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const result = await db
        .select()
        .from(categories)
        .where(
          and(eq(categories.shopId, shop.id), eq(categories.isActive, true)),
        )
        .orderBy(asc(categories.sortOrder), asc(categories.name));

      return {
        items: result,
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/products", async (request) => {
    const optionalPriceSchema = z.preprocess((value) => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }

      return value;
    }, z.coerce.number().int().min(0).max(100_000_000).optional());

    const query = z
      .object({
        q: z.string().trim().max(120).optional().default(""),

        category: z.string().trim().max(120).optional().default(""),

        availability: z
          .enum(["all", "available", "unavailable"])
          .optional()
          .default("all"),

        sort: z
          .enum(["recommended", "newest", "price-asc", "price-desc", "name"])
          .optional()
          .default("recommended"),

        minPrice: optionalPriceSchema,
        maxPrice: optionalPriceSchema,

        featured: z.enum(["true"]).optional(),

        sale: z.enum(["true"]).optional(),

        page: z.coerce.number().int().min(1).max(100_000).optional().default(1),

        pageSize: z.coerce.number().int().min(1).max(48).optional().default(24),
      })
      .parse(request.query ?? {});

    const { client, shop } = await getShopContext();

    try {
      const searchText = query.q.trim();

      const searchPattern = `%${searchText}%`;

      const categorySlug = query.category === "all" ? "" : query.category;

      const minPrice = query.minPrice ?? null;

      const maxPrice = query.maxPrice ?? null;

      const featuredOnly = query.featured === "true";

      const saleOnly = query.sale === "true";

      const page = query.page;

      const pageSize = query.pageSize;

      const offset = (page - 1) * pageSize;

      type PublicProductRow = {
        id: string;
        categoryId: string | null;
        categoryName: string | null;
        categorySlug: string | null;
        slug: string;
        name: string;
        shortDescription: string | null;
        description: string | null;
        composition: string | null;
        careText: string | null;
        price: number;
        oldPrice: number | null;
        availability: "available" | "unavailable";
        isFeatured: boolean;
      };

      const rows = await client<PublicProductRow[]>`
        SELECT
          p.id::text AS id,
          p.category_id::text AS "categoryId",
          c.name AS "categoryName",
          c.slug AS "categorySlug",
          p.slug,
          p.name,
          p.short_description
            AS "shortDescription",
          p.description,
          p.composition,
          p.care_text AS "careText",
          p.price,
          p.old_price AS "oldPrice",
          CASE
            WHEN COALESCE(
              p.stock_quantity,
              0
            ) > 0
            THEN 'available'
            ELSE 'unavailable'
          END AS "availability",
          p.is_featured AS "isFeatured"
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
          AND c.is_active = true
        WHERE p.shop_id = ${shop.id}
          AND p.status = 'active'
          AND (
            p.category_id IS NULL
            OR c.id IS NOT NULL
          )
          AND (
            ${searchText} = ''
            OR p.name ILIKE ${searchPattern}
            OR p.slug ILIKE ${searchPattern}
            OR COALESCE(
              p.short_description,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              p.description,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              p.composition,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              c.name,
              ''
            ) ILIKE ${searchPattern}
          )
          AND (
            ${categorySlug} = ''
            OR c.slug = ${categorySlug}
          )
          AND (
            ${query.availability} = 'all'
            OR (
              ${query.availability}
                = 'available'
              AND COALESCE(
                p.stock_quantity,
                0
              ) > 0
            )
            OR (
              ${query.availability}
                = 'unavailable'
              AND COALESCE(
                p.stock_quantity,
                0
              ) <= 0
            )
          )
          AND (
            ${minPrice}::integer IS NULL
            OR p.price >= ${minPrice}
          )
          AND (
            ${maxPrice}::integer IS NULL
            OR p.price <= ${maxPrice}
          )
          AND (
            ${featuredOnly} = false
            OR p.is_featured = true
          )
          AND (
            ${saleOnly} = false
            OR (
              p.old_price IS NOT NULL
              AND p.old_price > p.price
            )
          )
        ORDER BY
          CASE
            WHEN ${query.sort}
              = 'recommended'
            THEN p.is_featured
          END DESC NULLS LAST,

          CASE
            WHEN ${query.sort}
              = 'recommended'
            THEN p.sort_order
          END ASC NULLS LAST,

          CASE
            WHEN ${query.sort}
              = 'newest'
            THEN p.created_at
          END DESC NULLS LAST,

          CASE
            WHEN ${query.sort}
              = 'price-asc'
            THEN p.price
          END ASC NULLS LAST,

          CASE
            WHEN ${query.sort}
              = 'price-desc'
            THEN p.price
          END DESC NULLS LAST,

          CASE
            WHEN ${query.sort}
              = 'name'
            THEN LOWER(p.name)
          END ASC NULLS LAST,

          p.sort_order ASC,
          p.created_at DESC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `;

      const countRows = await client<
        {
          total: number;
        }[]
      >`
        SELECT COUNT(*)::int AS total
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
          AND c.is_active = true
        WHERE p.shop_id = ${shop.id}
          AND p.status = 'active'
          AND (
            p.category_id IS NULL
            OR c.id IS NOT NULL
          )
          AND (
            ${searchText} = ''
            OR p.name ILIKE ${searchPattern}
            OR p.slug ILIKE ${searchPattern}
            OR COALESCE(
              p.short_description,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              p.description,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              p.composition,
              ''
            ) ILIKE ${searchPattern}
            OR COALESCE(
              c.name,
              ''
            ) ILIKE ${searchPattern}
          )
          AND (
            ${categorySlug} = ''
            OR c.slug = ${categorySlug}
          )
          AND (
            ${query.availability} = 'all'
            OR (
              ${query.availability}
                = 'available'
              AND COALESCE(
                p.stock_quantity,
                0
              ) > 0
            )
            OR (
              ${query.availability}
                = 'unavailable'
              AND COALESCE(
                p.stock_quantity,
                0
              ) <= 0
            )
          )
          AND (
            ${minPrice}::integer IS NULL
            OR p.price >= ${minPrice}
          )
          AND (
            ${maxPrice}::integer IS NULL
            OR p.price <= ${maxPrice}
          )
          AND (
            ${featuredOnly} = false
            OR p.is_featured = true
          )
          AND (
            ${saleOnly} = false
            OR (
              p.old_price IS NOT NULL
              AND p.old_price > p.price
            )
          )
      `;

      const globalCountRows = await client<
        {
          total: number;
        }[]
      >`
        SELECT COUNT(*)::int AS total
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
          AND c.is_active = true
        WHERE p.shop_id = ${shop.id}
          AND p.status = 'active'
          AND (
            p.category_id IS NULL
            OR c.id IS NOT NULL
          )
      `;

      const categoryCountRows = await client<
        {
          category_id: string;
          products_count: number;
        }[]
      >`
        SELECT
          p.category_id,
          COUNT(*)::int AS products_count
        FROM products p
        INNER JOIN categories c
          ON c.id = p.category_id
          AND c.shop_id = p.shop_id
          AND c.is_active = true
        WHERE p.shop_id = ${shop.id}
          AND p.status = 'active'
        GROUP BY p.category_id
      `;

      const productIds = rows.map((product) => product.id);

      const imageRows =
        productIds.length > 0
          ? await client<
              {
                product_id: string;
                url: string;
                alt: string | null;
              }[]
            >`
              SELECT DISTINCT ON (product_id)
                product_id,
                url,
                alt
              FROM product_images
              WHERE shop_id = ${shop.id}
                AND product_id = ANY(
                  ${productIds}::uuid[]
                )
              ORDER BY
                product_id,
                is_main DESC,
                sort_order ASC,
                created_at ASC
            `
          : [];

      const imagesByProductId = new Map(
        imageRows.map((image) => [
          image.product_id,
          {
            url: image.url,
            alt: image.alt,
          },
        ]),
      );

      const total = Number(countRows[0]?.total ?? 0);

      const catalogTotal = Number(globalCountRows[0]?.total ?? 0);

      const categoryCounts = Object.fromEntries(
        categoryCountRows.map((row) => [
          row.category_id,
          Number(row.products_count),
        ]),
      );

      return {
        items: rows.map((product) => ({
          ...product,
          price: Number(product.price),
          oldPrice: product.oldPrice === null ? null : Number(product.oldPrice),
          primaryImage: imagesByProductId.get(product.id) ?? null,
        })),

        meta: {
          total,
          page,
          pageSize,
          pages: Math.ceil(total / pageSize),
        },

        catalogTotal,
        categoryCounts,
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/cart-products", async (request) => {
    const body = z
      .object({
        productIds: z
          .array(z.string().trim().min(1).max(100))
          .max(100)
          .optional()
          .default([]),

        slugs: z
          .array(z.string().trim().min(1).max(160))
          .max(100)
          .optional()
          .default([]),
      })
      .parse(request.body ?? {});

    const productIds = [
      ...new Set(body.productIds.map((value) => value.trim()).filter(Boolean)),
    ];

    const slugs = [
      ...new Set(body.slugs.map((value) => value.trim()).filter(Boolean)),
    ];

    if (productIds.length === 0 && slugs.length === 0) {
      return {
        items: [],
      };
    }

    const { client, shop } = await getShopContext();

    try {
      type CartProductRow = {
        id: string;
        slug: string;
        name: string;
        price: number;
        availability: "available" | "unavailable";
        imageUrl: string | null;
        imageAlt: string | null;
      };

      const rows = await client<CartProductRow[]>`
          SELECT
            p.id::text AS id,
            p.slug,
            p.name,
            p.price,
            CASE
              WHEN COALESCE(p.stock_quantity, 0) > 0
              THEN 'available'
              ELSE 'unavailable'
            END AS availability,
            image.url AS "imageUrl",
            image.alt AS "imageAlt"
          FROM products p
          LEFT JOIN categories c
            ON c.id = p.category_id
            AND c.shop_id = p.shop_id
            AND c.is_active = true
          LEFT JOIN LATERAL (
            SELECT
              pi.url,
              pi.alt
            FROM product_images pi
            WHERE pi.shop_id = p.shop_id
              AND pi.product_id = p.id
            ORDER BY
              pi.is_main DESC,
              pi.sort_order ASC,
              pi.created_at ASC
            LIMIT 1
          ) image ON true
          WHERE p.shop_id = ${shop.id}
            AND p.status = 'active'
            AND (
              p.category_id IS NULL
              OR c.id IS NOT NULL
            )
            AND (
              p.id::text = ANY(
                ${productIds}::text[]
              )
              OR p.slug = ANY(
                ${slugs}::text[]
              )
            )
          ORDER BY
            p.sort_order ASC,
            p.created_at DESC
        `;

      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          price: Number(row.price),
          availability: row.availability,
          primaryImage: row.imageUrl
            ? {
                url: row.imageUrl,
                alt: row.imageAlt || row.name,
              }
            : null,
        })),
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/products/:slug", async (request) => {
    const params = z
      .object({
        slug: z.string().trim().min(1).max(160),
      })
      .parse(request.params);

    const { db, client, shop } = await getShopContext();

    try {
      const productRows = await db
        .select({
          id: products.id,
          categoryId: products.categoryId,
          slug: products.slug,
          name: products.name,
          shortDescription: products.shortDescription,
          description: products.description,
          composition: products.composition,
          careText: products.careText,
          price: products.price,
          oldPrice: products.oldPrice,
          stockQuantity: products.stockQuantity,
        })
        .from(products)
        .where(
          and(
            eq(products.shopId, shop.id),
            eq(products.slug, params.slug),
            eq(products.status, "active"),
          ),
        )
        .limit(1);

      const product = productRows[0];

      if (!product) {
        throw new HttpError(404, "Product not found");
      }

      const images = await db
        .select({
          id: productImages.id,
          url: productImages.url,
          alt: productImages.alt,
        })
        .from(productImages)
        .where(
          and(
            eq(productImages.shopId, shop.id),
            eq(productImages.productId, product.id),
          ),
        )
        .orderBy(asc(productImages.sortOrder));

      return {
        product: {
          id: product.id,
          categoryId: product.categoryId,
          slug: product.slug,
          name: product.name,
          shortDescription: product.shortDescription,
          description: product.description,
          composition: product.composition,
          careText: product.careText,
          price: Number(product.price),
          oldPrice: product.oldPrice === null ? null : Number(product.oldPrice),
          availability:
            product.stockQuantity !== null && Number(product.stockQuantity) > 0
              ? "available"
              : "unavailable",
        },
        images,
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/request-code", async (request, reply) => {
    const body = z
      .object({
        phone: z.string().trim().min(5).max(32),
      })
      .parse(request.body ?? {});

    const phone = body.phone;
    const phoneCandidates = phoneDigitCandidates(phone);
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const customerRows = await client<{ id: string }[]>`
        SELECT id
        FROM customers
        WHERE shop_id = ${shop.id}
          AND (
            phone = ${phone}
            OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY(${phoneCandidates}::text[])
          )
        LIMIT 1
      `;

      const customer = customerRows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message:
            "Клиент с таким телефоном не найден. Оформите первый заказ или проверьте номер.",
        });
      }

      const telegramRows = await client<{ telegram_id: string }[]>`
        SELECT telegram_id
        FROM telegram_accounts
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
          AND is_active = true
        ORDER BY linked_at DESC
        LIMIT 1
      `;

      const telegramAccount = telegramRows[0];

      if (!telegramAccount?.telegram_id) {
        return reply.status(409).send({
          ok: false,
          code: "telegram_not_connected",
          message:
            "Telegram к этому номеру пока не подключён. Для входа оформите заказ на сайте и подключите Telegram по коду после оформления.",
        });
      }

      const recentCodeRows = await client<
        {
          seconds_since_last: number | null;
          codes_last_hour: number;
        }[]
      >`
        SELECT
          EXTRACT(
            EPOCH FROM (NOW() - MAX(created_at))
          )::int AS seconds_since_last,
          COUNT(*) FILTER (
            WHERE created_at > NOW() - INTERVAL '1 hour'
          )::int AS codes_last_hour
        FROM customer_login_codes
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
      `;

      const recentCodes = recentCodeRows[0];
      const secondsSinceLast = Number(recentCodes?.seconds_since_last ?? 9999);
      const codesLastHour = Number(recentCodes?.codes_last_hour ?? 0);

      if (secondsSinceLast < 60) {
        return reply.status(429).send({
          ok: false,
          message: `Новый код можно запросить через ${60 - secondsSinceLast} сек.`,
        });
      }

      if (codesLastHour >= 10) {
        return reply.status(429).send({
          ok: false,
          message: "Слишком много запросов кода. Повторите попытку через час.",
        });
      }

      await client`
        UPDATE customer_login_codes
        SET consumed_at = NOW()
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
          AND consumed_at IS NULL
      `;

      const code = createLoginCode();

      await client`
        INSERT INTO customer_login_codes (
          shop_id,
          customer_id,
          phone,
          code,
          expires_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${phone},
          ${code},
          NOW() + INTERVAL '10 minutes',
          NOW()
        )
      `;

      await client`
        INSERT INTO notification_events (
          shop_id,
          order_id,
          type,
          channel,
          recipient_type,
          recipient_telegram_id,
          payload,
          attempts,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          NULL,
          'customer_login_code',
          'telegram',
          'customer',
          ${telegramAccount.telegram_id},
          ${JSON.stringify({ code, phone })},
          0,
          NOW(),
          NOW()
        )
      `;

      return {
        ok: true,
        message: "Код входа отправлен в Telegram",
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/verify-code", async (request, reply) => {
    const schema = z.object({
      phone: z.string().min(5),
      code: z.string().min(4).max(12),
    });

    const body = schema.parse(request.body ?? {});
    const phone = body.phone.trim();
    const phoneCandidates = phoneDigitCandidates(phone);
    const code = body.code.trim();
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const loginRows = await client<
        {
          id: string;
          customer_id: string;
          code: string;
          attempts: number;
        }[]
      >`
        SELECT id, customer_id, code, attempts
        FROM customer_login_codes
        WHERE shop_id = ${shop.id}
          AND (
            phone = ${phone}
            OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY(${phoneCandidates}::text[])
          )
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const login = loginRows[0];

      if (!login) {
        return reply.status(400).send({
          ok: false,
          message: "Код не найден или срок действия истёк",
        });
      }

      if (Number(login.attempts) >= 5) {
        return reply.status(400).send({
          ok: false,
          message: "Слишком много попыток. Запросите новый код.",
        });
      }

      if (login.code !== code) {
        await client`
          UPDATE customer_login_codes
          SET attempts = attempts + 1
          WHERE id = ${login.id}
        `;

        return reply.status(400).send({
          ok: false,
          message: "Неверный код",
        });
      }

      const token = createSessionToken();

      await client`
        UPDATE customer_login_codes
        SET consumed_at = NOW()
        WHERE id = ${login.id}
      `;

      await client`
        INSERT INTO customer_sessions (
          shop_id,
          customer_id,
          token,
          user_agent,
          expires_at,
          last_seen_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${login.customer_id},
          ${token},
          ${String(request.headers["user-agent"] ?? "")},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

      const customerRows = await client`
        SELECT id, phone, name, email, GREATEST(bonus_balance, 0) AS bonus_balance, total_orders, total_spent, last_order_at
        FROM customers
        WHERE id = ${login.customer_id}
        LIMIT 1
      `;

      reply.header("Set-Cookie", buildCustomerSessionCookie(token));

      return {
        ok: true,
        customer: customerRows[0],
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/account/me", async (request, reply) => {
    const { client } = createDb();

    try {
      const session = await getActiveCustomerSession(
        client,
        request.headers.cookie,
      );

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход",
        });
      }

      const token = getCookieValue(
        request.headers.cookie,
        CUSTOMER_SESSION_COOKIE,
      );

      await client`
        UPDATE customer_sessions
        SET last_seen_at = NOW()
        WHERE token = ${token}
      `;

      const customerRows = await client<
        {
          id: string;
          phone: string;
          name: string | null;
          email: string | null;
          telegram_username: string | null;
          bonus_balance: number;
          total_orders: number;
          total_spent: number;
          last_order_at: string | null;
        }[]
      >`
        SELECT
          id,
          phone,
          name,
          email,
          telegram_username,
          GREATEST(bonus_balance, 0) AS bonus_balance,
          total_orders,
          total_spent,
          last_order_at
        FROM customers
        WHERE id = ${session.customer_id}
          AND shop_id = ${session.shop_id}
        LIMIT 1
      `;

      const customer = customerRows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message: "Профиль клиента не найден",
        });
      }

      const orders = await client<
        {
          order_number: string;
          status: string;
          payment_status: string;
          total: number;
          bonus_spent: number;
          bonus_earned: number;
          tracking_token: string | null;
          created_at: string;
          items_count: number;
          item_names: string[] | null;
        }[]
      >`
        SELECT
          o.order_number,
          o.status,
          o.payment_status,
          o.total,
          o.bonus_spent,
          o.bonus_earned,
          o.tracking_token,
          o.created_at,
          COUNT(oi.id)::int AS items_count,
          COALESCE(
            ARRAY_AGG(oi.product_name ORDER BY oi.created_at)
              FILTER (WHERE oi.id IS NOT NULL),
            ARRAY[]::text[]
          ) AS item_names
        FROM orders o
        LEFT JOIN order_items oi
          ON oi.order_id = o.id
        WHERE o.customer_id = ${session.customer_id}
          AND o.shop_id = ${session.shop_id}
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT 50
      `;

      const bonuses = await client`
        SELECT type, amount, balance_after, comment, created_at
        FROM bonus_transactions
        WHERE customer_id = ${session.customer_id}
          AND shop_id = ${session.shop_id}
        ORDER BY created_at DESC
        LIMIT 30
      `;

      const addresses = await client`
        SELECT
          id,
          city,
          street,
          house,
          apartment,
          entrance,
          floor,
          comment,
          is_default
        FROM customer_addresses
        WHERE customer_id = ${session.customer_id}
          AND shop_id = ${session.shop_id}
        ORDER BY is_default DESC, updated_at DESC, created_at DESC
        LIMIT 20
      `;

      const telegramRows = await client<
        {
          telegram_id: string;
          notifications_enabled: boolean;
        }[]
      >`
        SELECT telegram_id, notifications_enabled
        FROM telegram_accounts
        WHERE shop_id = ${session.shop_id}
          AND customer_id = ${session.customer_id}
          AND is_active = true
        ORDER BY linked_at DESC
        LIMIT 1
      `;

      const telegramAccount = telegramRows[0] ?? null;

      return {
        ok: true,
        customer,
        orders: orders.map((order) => ({
          ...order,
          total: Number(order.total || 0),
          bonus_spent: Number(order.bonus_spent || 0),
          bonus_earned: Number(order.bonus_earned || 0),
          items_count: Number(order.items_count || 0),
          item_names: order.item_names ?? [],
        })),
        bonuses,
        addresses,
        telegram: {
          connected: Boolean(telegramAccount?.telegram_id),
          notificationsEnabled: telegramAccount?.notifications_enabled ?? false,
        },
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/public/account/profile", async (request, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(160),
        email: z
          .union([z.string().trim().email().max(255), z.literal("")])
          .optional()
          .default(""),
      })
      .parse(request.body ?? {});

    const { client } = createDb();

    try {
      const session = await getActiveCustomerSession(
        client,
        request.headers.cookie,
      );

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход",
        });
      }

      const rows = await client<
        {
          id: string;
          phone: string;
          name: string | null;
          email: string | null;
          bonus_balance: number;
          total_orders: number;
          total_spent: number;
          last_order_at: string | null;
        }[]
      >`
        UPDATE customers
        SET
          name = ${body.name},
          email = ${body.email || null},
          updated_at = NOW()
        WHERE id = ${session.customer_id}
          AND shop_id = ${session.shop_id}
        RETURNING
          id,
          phone,
          name,
          email,
          GREATEST(bonus_balance, 0) AS bonus_balance,
          total_orders,
          total_spent,
          last_order_at
      `;

      const customer = rows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message: "Профиль клиента не найден",
        });
      }

      return {
        ok: true,
        customer,
      };
    } finally {
      await client.end();
    }
  });

  app.patch(
    "/api/public/account/telegram-notifications",
    async (request, reply) => {
      const body = z
        .object({
          enabled: z.boolean(),
        })
        .parse(request.body ?? {});

      const { client } = createDb();

      try {
        const session = await getActiveCustomerSession(
          client,
          request.headers.cookie,
        );

        if (!session) {
          return reply.status(401).send({
            ok: false,
            message: "Требуется вход",
          });
        }

        const rows = await client<
          {
            telegram_id: string;
            notifications_enabled: boolean;
          }[]
        >`
        UPDATE telegram_accounts
        SET
          notifications_enabled = ${body.enabled},
          updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM telegram_accounts
          WHERE shop_id = ${session.shop_id}
            AND customer_id = ${session.customer_id}
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        )
        RETURNING telegram_id, notifications_enabled
      `;

        const account = rows[0];

        if (!account) {
          return reply.status(409).send({
            ok: false,
            message: "Сначала подключите Telegram",
          });
        }

        return {
          ok: true,
          notificationsEnabled: account.notifications_enabled,
        };
      } finally {
        await client.end();
      }
    },
  );

  app.post("/api/public/account/addresses", async (request, reply) => {
    const body = customerAddressSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const session = await getActiveCustomerSession(
        client,
        request.headers.cookie,
      );

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход",
        });
      }

      const result = await client.begin(async (transaction) => {
        const countRows = await transaction<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM customer_addresses
          WHERE shop_id = ${session.shop_id}
            AND customer_id = ${session.customer_id}
        `;

        const total = Number(countRows[0]?.total ?? 0);

        if (total >= 20) {
          throw new HttpError(409, "Можно сохранить не более 20 адресов");
        }

        const isDefault = body.isDefault || total === 0;

        if (isDefault) {
          await transaction`
            UPDATE customer_addresses
            SET is_default = false, updated_at = NOW()
            WHERE shop_id = ${session.shop_id}
              AND customer_id = ${session.customer_id}
          `;
        }

        const rows = await transaction`
          INSERT INTO customer_addresses (
            shop_id,
            customer_id,
            city,
            street,
            house,
            apartment,
            entrance,
            floor,
            comment,
            is_default,
            created_at,
            updated_at
          )
          VALUES (
            ${session.shop_id},
            ${session.customer_id},
            ${body.city},
            ${body.street},
            ${body.house},
            ${body.apartment || null},
            ${body.entrance || null},
            ${body.floor || null},
            ${body.comment || null},
            ${isDefault},
            NOW(),
            NOW()
          )
          RETURNING *
        `;

        return rows[0];
      });

      return {
        ok: true,
        address: result,
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/public/account/addresses/:id", async (request, reply) => {
    const params = z
      .object({
        id: z.string().uuid(),
      })
      .parse(request.params ?? {});

    const body = customerAddressSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const session = await getActiveCustomerSession(
        client,
        request.headers.cookie,
      );

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход",
        });
      }

      const result = await client.begin(async (transaction) => {
        const existingRows = await transaction<
          {
            id: string;
            is_default: boolean;
          }[]
        >`
          SELECT id, is_default
          FROM customer_addresses
          WHERE id = ${params.id}
            AND shop_id = ${session.shop_id}
            AND customer_id = ${session.customer_id}
          LIMIT 1
          FOR UPDATE
        `;

        const existing = existingRows[0];

        if (!existing) {
          throw new HttpError(404, "Адрес не найден");
        }

        const isDefault = body.isDefault || existing.is_default;

        if (body.isDefault) {
          await transaction`
            UPDATE customer_addresses
            SET is_default = false, updated_at = NOW()
            WHERE shop_id = ${session.shop_id}
              AND customer_id = ${session.customer_id}
              AND id <> ${params.id}
          `;
        }

        const rows = await transaction`
          UPDATE customer_addresses
          SET
            city = ${body.city},
            street = ${body.street},
            house = ${body.house},
            apartment = ${body.apartment || null},
            entrance = ${body.entrance || null},
            floor = ${body.floor || null},
            comment = ${body.comment || null},
            is_default = ${isDefault},
            updated_at = NOW()
          WHERE id = ${params.id}
            AND shop_id = ${session.shop_id}
            AND customer_id = ${session.customer_id}
          RETURNING *
        `;

        return rows[0];
      });

      return {
        ok: true,
        address: result,
      };
    } finally {
      await client.end();
    }
  });

  app.delete("/api/public/account/addresses/:id", async (request, reply) => {
    const params = z
      .object({
        id: z.string().uuid(),
      })
      .parse(request.params ?? {});

    const { client } = createDb();

    try {
      const session = await getActiveCustomerSession(
        client,
        request.headers.cookie,
      );

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход",
        });
      }

      const deleted = await client.begin(async (transaction) => {
        const rows = await transaction<
          {
            id: string;
            is_default: boolean;
          }[]
        >`
          DELETE FROM customer_addresses
          WHERE id = ${params.id}
            AND shop_id = ${session.shop_id}
            AND customer_id = ${session.customer_id}
          RETURNING id, is_default
        `;

        const address = rows[0];

        if (!address) {
          throw new HttpError(404, "Адрес не найден");
        }

        if (address.is_default) {
          await transaction`
            UPDATE customer_addresses
            SET is_default = true, updated_at = NOW()
            WHERE id = (
              SELECT id
              FROM customer_addresses
              WHERE shop_id = ${session.shop_id}
                AND customer_id = ${session.customer_id}
              ORDER BY updated_at DESC, created_at DESC
              LIMIT 1
            )
          `;
        }

        return address;
      });

      return {
        ok: true,
        deletedId: deleted.id,
      };
    } finally {
      await client.end();
    }
  });

  app.post(
    "/api/public/account/orders/:orderNumber/repeat",
    async (request, reply) => {
      const params = z
        .object({
          orderNumber: z.string().trim().min(3).max(80),
        })
        .parse(request.params ?? {});

      const { client } = createDb();

      try {
        const session = await getActiveCustomerSession(
          client,
          request.headers.cookie,
        );

        if (!session) {
          return reply.status(401).send({
            ok: false,
            message: "Требуется вход",
          });
        }

        const orderRows = await client<{ id: string }[]>`
        SELECT id
        FROM orders
        WHERE order_number = ${params.orderNumber}
          AND shop_id = ${session.shop_id}
          AND customer_id = ${session.customer_id}
        LIMIT 1
      `;

        const order = orderRows[0];

        if (!order) {
          return reply.status(404).send({
            ok: false,
            message: "Заказ не найден",
          });
        }

        const rows = await client<
          {
            product_id: string;
            slug: string | null;
            current_name: string | null;
            ordered_name: string;
            current_price: number | null;
            ordered_price: number;
            quantity: number;
            availability: "available" | "unavailable";
            image_url: string | null;
            image_alt: string | null;
          }[]
        >`
        SELECT
          COALESCE(oi.product_id::text, '') AS product_id,
          p.slug,
          p.name AS current_name,
          oi.product_name AS ordered_name,
          p.price AS current_price,
          oi.price AS ordered_price,
          oi.quantity,
          CASE
            WHEN p.id IS NOT NULL
              AND p.status = 'active'
              AND COALESCE(p.stock_quantity, 0) >= oi.quantity
            THEN 'available'
            ELSE 'unavailable'
          END AS availability,
          image.url AS image_url,
          image.alt AS image_alt
        FROM order_items oi
        LEFT JOIN products p
          ON p.id = oi.product_id
          AND p.shop_id = ${session.shop_id}
        LEFT JOIN LATERAL (
          SELECT pi.url, pi.alt
          FROM product_images pi
          WHERE pi.product_id = p.id
            AND pi.shop_id = ${session.shop_id}
          ORDER BY pi.is_main DESC, pi.sort_order ASC, pi.created_at ASC
          LIMIT 1
        ) image ON true
        WHERE oi.order_id = ${order.id}
        ORDER BY oi.created_at ASC
      `;

        if (rows.length === 0) {
          return reply.status(409).send({
            ok: false,
            message: "В заказе нет товаров для повторения",
          });
        }

        return {
          ok: true,
          products: rows.map((row) => ({
            productId: row.product_id,
            slug: row.slug ?? "",
            name: row.current_name ?? row.ordered_name,
            price: Number(row.current_price ?? row.ordered_price ?? 0),
            quantity: Number(row.quantity || 1),
            imageUrl: row.image_url ?? "",
            imageAlt: row.image_alt ?? row.current_name ?? row.ordered_name,
            availability: row.availability,
          })),
        };
      } finally {
        await client.end();
      }
    },
  );

  app.get("/api/public/auth/magic/:token", async (request, reply) => {
    const params = z
      .object({
        token: z.string().min(24),
      })
      .parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        return reply.redirect("/account");
      }

      const tokenRows = await client<
        {
          id: string;
          customer_id: string;
          order_id: string | null;
        }[]
      >`
        SELECT id, customer_id, order_id
        FROM customer_link_tokens
        WHERE shop_id = ${shop.id}
          AND provider = 'site'
          AND purpose = 'magic_login'
          AND token = ${params.token}
          AND status = 'pending'
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const loginToken = tokenRows[0];

      if (!loginToken) {
        return reply.redirect("/account");
      }

      const sessionToken = createSessionToken();

      await client`
        INSERT INTO customer_sessions (
          shop_id,
          customer_id,
          token,
          user_agent,
          expires_at,
          last_seen_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${loginToken.customer_id},
          ${sessionToken},
          ${String(request.headers["user-agent"] ?? "")},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

      await client`
        UPDATE customer_link_tokens
        SET status = 'consumed',
            consumed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${loginToken.id}
      `;

      let redirectUrl = "/account";

      if (loginToken.order_id) {
        const orderRows = await client<{ tracking_token: string | null }[]>`
          SELECT tracking_token
          FROM orders
          WHERE id = ${loginToken.order_id}
            AND customer_id = ${loginToken.customer_id}
          LIMIT 1
        `;

        const order = orderRows[0];

        if (order?.tracking_token) {
          redirectUrl = `/order/track/${order.tracking_token}`;
        }
      }

      reply.header("Set-Cookie", buildCustomerSessionCookie(sessionToken));
      return reply.redirect(redirectUrl);
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/telegram-code", async (request, reply) => {
    const token = getCookieValue(
      request.headers.cookie,
      CUSTOMER_SESSION_COOKIE,
    );

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход",
      });
    }

    const { client } = createDb();

    try {
      const sessionRows = await client<
        { shop_id: string; customer_id: string }[]
      >`
        SELECT shop_id, customer_id
        FROM customer_sessions
        WHERE token = ${token}
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const session = sessionRows[0];

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Сессия истекла",
        });
      }

      const existingTelegramRows = await client<
        {
          telegram_id: string;
        }[]
      >`
          SELECT telegram_id
          FROM telegram_accounts
          WHERE shop_id =
              ${session.shop_id}
            AND customer_id =
              ${session.customer_id}
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        `;

      if (existingTelegramRows[0]?.telegram_id) {
        await client`
          UPDATE customer_link_tokens
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE shop_id =
              ${session.shop_id}
            AND customer_id =
              ${session.customer_id}
            AND provider = 'telegram'
            AND purpose =
              'connect_channel'
            AND status = 'pending'
            AND consumed_at IS NULL
        `;

        return reply.status(409).send({
          ok: false,
          code: "telegram_already_connected",
          message: "Telegram уже подключён",
        });
      }

      await client`
        UPDATE customer_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${session.shop_id}
          AND customer_id = ${session.customer_id}
          AND provider = 'telegram'
          AND purpose = 'connect_channel'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      const telegramLinkCode = createTelegramLinkCode();

      await client`
        INSERT INTO customer_link_tokens (
          shop_id, customer_id, order_id, provider, purpose,
          token, status, expires_at, metadata, created_at, updated_at
        )
        VALUES (
          ${session.shop_id}, ${session.customer_id}, NULL, 'telegram', 'connect_channel',
          ${telegramLinkCode}, 'pending', NOW() + INTERVAL '30 minutes',
          ${JSON.stringify({ source: "account_telegram_code", mode: "code" })},
          NOW(), NOW()
        )
      `;

      return {
        ok: true,
        telegramLinkCode,
        expiresInMinutes: 30,
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/account/logout", async (request, reply) => {
    const token = getCookieValue(
      request.headers.cookie,
      CUSTOMER_SESSION_COOKIE,
    );

    if (token) {
      const { client } = createDb();

      try {
        await client`
          UPDATE customer_sessions
          SET revoked_at = NOW()
          WHERE token = ${token}
        `;
      } finally {
        await client.end();
      }
    }

    reply.header("Set-Cookie", clearCustomerSessionCookie());

    return {
      ok: true,
    };
  });

  app.post("/api/public/bonus/check", async (request, reply) => {
    const schema = z.object({
      amount: z.coerce.number().int().min(0),
    });

    const body = schema.parse(request.body ?? {});
    const token = getCookieValue(
      request.headers.cookie,
      CUSTOMER_SESSION_COOKIE,
    );

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Войдите в личный кабинет, чтобы использовать бонусы",
      });
    }

    const { client } = createDb();

    try {
      const sessionRows = await client<{ customer_id: string }[]>`
        SELECT customer_id
        FROM customer_sessions
        WHERE token = ${token}
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      const session = sessionRows[0];

      if (!session) {
        return reply.status(401).send({
          ok: false,
          message: "Сессия истекла. Войдите снова.",
        });
      }

      const customerRows = await client<
        {
          id: string;
          phone: string;
          name: string | null;
          bonus_balance: number;
        }[]
      >`
        SELECT id, phone, name, GREATEST(bonus_balance, 0) AS bonus_balance
        FROM customers
        WHERE id = ${session.customer_id}
        LIMIT 1
      `;

      const customer = customerRows[0];

      if (!customer) {
        return reply.status(404).send({
          ok: false,
          message: "Покупатель не найден",
        });
      }

      const balance = Math.max(0, Number(customer.bonus_balance || 0));
      const maxSpend = Math.min(
        balance,
        Math.floor(body.amount * 0.3),
        body.amount,
      );

      return {
        ok: true,
        customer: {
          id: customer.id,
          phone: customer.phone,
          name: customer.name,
        },
        bonus: {
          balance,
          maxSpend,
        },
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/public/promocodes/check", async (request, reply) => {
    const schema = z.object({
      code: z.string().min(1),
      subtotal: z.coerce.number().int().min(0),
    });

    const body = schema.parse(request.body ?? {});
    const code = normalizePromoCode(body.code);
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

      const shop = shopRows[0];

      if (!shop) {
        throw new HttpError(404, "Shop not found");
      }

      const rows = await client<
        {
          id: string;
          code: string;
          discount_type: string;
          discount_value: number;
          min_order_amount: number | null;
          usage_limit: number | null;
          used_count: number;
        }[]
      >`
        SELECT id, code, discount_type, discount_value, min_order_amount, usage_limit, used_count
        FROM promocodes
        WHERE shop_id = ${shop.id}
          AND UPPER(code) = ${code}
          AND is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        LIMIT 1
      `;

      const promo = rows[0];

      if (!promo) {
        return reply.status(404).send({
          ok: false,
          message: "Промокод не найден или уже не действует",
        });
      }

      if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
        return reply.status(400).send({
          ok: false,
          message: "Лимит использования промокода исчерпан",
        });
      }

      if (
        promo.min_order_amount !== null &&
        body.subtotal < promo.min_order_amount
      ) {
        return reply.status(400).send({
          ok: false,
          message: `Минимальная сумма заказа для промокода — ${promo.min_order_amount} ₽`,
        });
      }

      const discountTotal = calculateDiscount({
        subtotal: body.subtotal,
        discountType: promo.discount_type,
        discountValue: Number(promo.discount_value),
      });

      return {
        ok: true,
        promo: {
          id: promo.id,
          code: promo.code,
          discountType: promo.discount_type,
          discountValue: promo.discount_value,
          discountTotal,
        },
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/orders/track/:token", async (request, reply) => {
    const params = z
      .object({
        token: z.string().min(16),
      })
      .parse(request.params ?? {});

    const { client } = createDb();

    try {
      const orderRows = await client<
        {
          id: string;
          order_number: string;
          status: string;
          payment_status: string;
          payment_method: string;
          delivery_type: string;
          delivery_date: string | null;
          delivery_address_text: string | null;
          delivery_comment: string | null;
          subtotal: number;
          discount_total: number;
          delivery_price: number;
          bonus_spent: number;
          bonus_earned: number;
          total: number;
          tracking_token: string;
          bouquet_photo_url: string | null;
          bouquet_approval_status: string | null;
          bouquet_approval_requested_at: string | null;
          bouquet_approval_decided_at: string | null;
          bouquet_approval_note: string | null;
          bouquet_approval_source: string | null;
          bouquet_approval_revision_count: number | null;
          bouquet_approval_photo_version: number | null;
          delivery_proof_photo_url: string | null;
          delivery_proof_uploaded_at: string | null;
          delivered_at: string | null;
          created_at: string;
          updated_at: string;
        }[]
      >`
        SELECT
          o.id,
          o.order_number,
          o.status,
          o.payment_status,
          o.payment_method,
          o.delivery_type,
          o.delivery_date,
          o.delivery_address_text,
          o.delivery_comment,
          o.subtotal,
          o.discount_total,
          o.delivery_price,
          o.bonus_spent,
          o.bonus_earned,
          o.total,
          o.tracking_token,
          o.bouquet_photo_url,
          o.metadata #>> '{bouquetApproval,status}'
            AS bouquet_approval_status,
          o.metadata #>> '{bouquetApproval,requestedAt}'
            AS bouquet_approval_requested_at,
          o.metadata #>> '{bouquetApproval,decidedAt}'
            AS bouquet_approval_decided_at,
          o.metadata #>> '{bouquetApproval,note}'
            AS bouquet_approval_note,
          o.metadata #>> '{bouquetApproval,source}'
            AS bouquet_approval_source,
          NULLIF(
            o.metadata #>> '{bouquetApproval,revisionCount}',
            ''
          )::int AS bouquet_approval_revision_count,
          NULLIF(
            o.metadata #>> '{bouquetApproval,photoVersion}',
            ''
          )::int AS bouquet_approval_photo_version,
          o.metadata #>> '{delivery,proofPhotoUrl}'
            AS delivery_proof_photo_url,
          o.metadata #>> '{delivery,proofUploadedAt}'
            AS delivery_proof_uploaded_at,
          o.delivered_at,
          o.created_at,
          o.updated_at
        FROM orders o
        WHERE o.tracking_token = ${params.token}
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден",
        });
      }

      const deliveryProofPhotoUrlRaw = String(
        order.delivery_proof_photo_url || ""
      );

      const deliveryProofPhotoUrl =
        /^\/uploads\/deliveries\/[a-zA-Z0-9._/-]+$/.test(
          deliveryProofPhotoUrlRaw
        )
        && !deliveryProofPhotoUrlRaw.includes("..")
          ? deliveryProofPhotoUrlRaw
          : null;

      const items = await client`
        SELECT
          product_id,
          product_name,
          quantity,
          price,
          total
        FROM order_items
        WHERE order_id = ${order.id}
        ORDER BY created_at ASC
      `;

      const payments = await client`
        SELECT
          provider,
          method,
          status,
          amount,
          currency,
          payment_url,
          paid_at,
          created_at
        FROM payments
        WHERE order_id = ${order.id}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      return {
        ok: true,
        order: {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status,
          paymentStatus: order.payment_status,
          paymentMethod: order.payment_method,
          deliveryType: order.delivery_type,
          deliveryDate: order.delivery_date,
          deliveryInterval: order.delivery_comment,
          deliveryAddress: order.delivery_address_text,
          subtotal: Number(order.subtotal || 0),
          discountTotal: Number(order.discount_total || 0),
          deliveryPrice: Number(order.delivery_price || 0),
          bonusSpent: Number(order.bonus_spent || 0),
          bonusEarned: Number(order.bonus_earned || 0),
          total: Number(order.total || 0),
          trackingToken: order.tracking_token,
          bouquetPhotoUrl: order.bouquet_photo_url,
          bouquetApproval: {
            status: [
              "pending",
              "approved",
              "revision_requested",
              "waived",
            ].includes(String(order.bouquet_approval_status || ""))
              ? String(order.bouquet_approval_status)
              : "not_required",
            requestedAt: order.bouquet_approval_requested_at,
            decidedAt: order.bouquet_approval_decided_at,
            note: order.bouquet_approval_note,
            source: order.bouquet_approval_source,
            revisionCount: Number(
              order.bouquet_approval_revision_count || 0,
            ),
            photoVersion: Number(
              order.bouquet_approval_photo_version || 0,
            ),
            canRespond:
              order.status === "assembling"
              && Boolean(order.bouquet_photo_url)
              && order.bouquet_approval_status === "pending",
          },
          deliveryProofPhotoUrl,
          deliveryProofUploadedAt: order.delivery_proof_uploaded_at,
          deliveredAt: order.delivered_at,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
        items: items.map((item: any) => ({
          productId: item.product_id,
          name: item.product_name,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          total: Number(item.total || 0),
        })),
        payment: payments[0] || null,
      };
    } finally {
      await client.end();
    }
  });

  app.post(
    "/api/public/orders/track/:token/bouquet-approval",
    async (request, reply) => {
      const params = z
        .object({
          token: z.string().min(16),
        })
        .parse(request.params ?? {});
      const body = bouquetApprovalResponseSchema.parse(request.body ?? {});
      const note = body.note.trim();

      if (body.action === "revision" && note.length < 3) {
        return reply.status(400).send({
          ok: false,
          message: "Опишите, что нужно изменить, минимум тремя символами",
        });
      }

      const { client } = createDb();

      try {
        const result = await client.begin(async (transaction) => {
          const orderRows = await transaction<
            {
              id: string;
              shop_id: string;
              order_number: string;
              status: string;
              bouquet_photo_url: string | null;
              approval_status: string | null;
            }[]
          >`
            SELECT
              id,
              shop_id,
              order_number,
              status::text AS status,
              bouquet_photo_url,
              metadata #>> '{bouquetApproval,status}' AS approval_status
            FROM orders
            WHERE tracking_token = ${params.token}
            FOR UPDATE
          `;

          const order = orderRows[0];

          if (!order) {
            return { kind: "not_found" as const };
          }

          if (body.action === "approve" && order.approval_status === "approved") {
            return {
              kind: "already_approved" as const,
              orderNumber: order.order_number,
            };
          }

          if (
            order.status !== "assembling"
            || !order.bouquet_photo_url
            || order.approval_status !== "pending"
          ) {
            return {
              kind: "unavailable" as const,
              orderNumber: order.order_number,
            };
          }

          const nextStatus =
            body.action === "approve"
              ? "approved"
              : "revision_requested";
          const historyComment =
            body.action === "approve"
              ? "Покупатель одобрил фото готового букета на странице отслеживания"
              : `Покупатель запросил правку букета: ${note}`;

          await transaction`
            UPDATE orders
            SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{bouquetApproval}',
                  COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
                    || jsonb_build_object(
                      'status', ${nextStatus},
                      'decidedAt', NOW(),
                      'note', ${body.action === "revision" ? note : null},
                      'source', 'tracking_page',
                      'revisionCount', CASE
                        WHEN ${body.action}::text = 'revision'
                        THEN COALESCE(
                          NULLIF(
                            metadata #>> '{bouquetApproval,revisionCount}',
                            ''
                          )::int,
                          0
                        ) + 1
                        ELSE COALESCE(
                          NULLIF(
                            metadata #>> '{bouquetApproval,revisionCount}',
                            ''
                          )::int,
                          0
                        )
                      END
                    ),
                  true
                ),
                updated_at = NOW()
            WHERE id = ${order.id}
              AND shop_id = ${order.shop_id}
          `;

          await transaction`
            INSERT INTO order_status_history (
              shop_id,
              order_id,
              from_status,
              to_status,
              comment,
              created_at
            )
            VALUES (
              ${order.shop_id},
              ${order.id},
              'assembling',
              'assembling',
              ${historyComment},
              NOW()
            )
          `;

          await transaction`
            INSERT INTO notification_events (
              shop_id,
              order_id,
              type,
              channel,
              recipient_type,
              recipient_telegram_id,
              status,
              payload,
              created_at,
              updated_at
            )
            SELECT DISTINCT
              o.shop_id,
              o.id,
              ${
                body.action === "approve"
                  ? "bouquet_approved"
                  : "bouquet_revision_requested"
              },
              'telegram',
              'staff',
              ta.telegram_id,
              'pending',
              jsonb_build_object(
                'orderId', o.id,
                'orderNumber', o.order_number,
                'note', ${body.action === "revision" ? note : null},
                'bouquetPhotoUrl', o.bouquet_photo_url,
                'crmUrl', '/admin/orders/' || o.id::text
              ),
              NOW(),
              NOW()
            FROM orders o
            JOIN telegram_accounts ta
              ON ta.shop_id = o.shop_id
             AND ta.is_active = true
             AND ta.user_id IS NOT NULL
            JOIN shop_users su
              ON su.shop_id = ta.shop_id
             AND su.user_id = ta.user_id
             AND su.is_active = true
            WHERE o.id = ${order.id}
              AND o.shop_id = ${order.shop_id}
              AND (
                ta.user_id = o.florist_id
                OR (
                  ${body.action}::text = 'revision'
                  AND su.role IN ('owner', 'admin', 'manager')
                )
              )
          `;

          return {
            kind: "updated" as const,
            orderNumber: order.order_number,
            status: nextStatus,
          };
        });

        if (result.kind === "not_found") {
          return reply.status(404).send({
            ok: false,
            message: "Заказ не найден",
          });
        }

        if (result.kind === "unavailable") {
          return reply.status(409).send({
            ok: false,
            message: "Согласование уже завершено или фото было обновлено",
          });
        }

        return {
          ok: true,
          orderNumber: result.orderNumber,
          status:
            result.kind === "already_approved"
              ? "approved"
              : result.status,
          message:
            result.kind === "already_approved"
              ? "Фото уже одобрено"
              : body.action === "approve"
                ? "Спасибо, фото букета одобрено"
                : "Комментарий передан флористу",
        };
      } finally {
        await client.end();
      }
    },
  );

  app.post("/api/public/orders", async (request, reply) => {
    // ORDER TRANSACTION CORE 1.0
    // INVENTORY RESERVATION 1.0
    const body = createOrderSchema.parse(request.body ?? {});
    const telegramChatId = localTelegramChatId(request);

    if (telegramOrderSourceRequested(request) && !telegramChatId) {
      throw new HttpError(401, "Недействительный внутренний запрос Telegram-бота");
    }

    const orderSource = telegramChatId ? "telegram" : "site";

    validateCreateOrderBody(body);

    const quantityByProductId = new Map<string, number>();

    for (const item of body.items) {
      const nextQuantity =
        (quantityByProductId.get(item.productId) ?? 0) + item.quantity;

      if (nextQuantity > 99) {
        throw new HttpError(
          400,
          "Количество одного товара не может превышать 99",
        );
      }

      quantityByProductId.set(item.productId, nextQuantity);
    }

    const requestedItems = Array.from(
      quantityByProductId,
      ([productId, quantity]) => ({
        productId,
        quantity,
      }),
    ).sort((left, right) => left.productId.localeCompare(right.productId));

    const { client } = createDb();

    try {
      const transactionResult = await client.begin(async (transaction) => {
        const shopRows = await transaction<
          {
            id: string;
          }[]
        >`
        SELECT id
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;

        const shop = shopRows[0];

        if (!shop) {
          throw new HttpError(404, "Shop not found");
        }

        const checkoutSettingsRows = await transaction<
          {
            settings: unknown;
            is_online_payment_enabled: boolean;
            is_cash_payment_enabled: boolean;
            is_transfer_payment_enabled: boolean;
          }[]
        >`
          SELECT
            settings,
            is_online_payment_enabled,
            is_cash_payment_enabled,
            is_transfer_payment_enabled
          FROM shop_settings
          WHERE shop_id = ${shop.id}
          LIMIT 1
        `;

        const checkoutSettings = checkoutSettingsRows[0];
        const checkoutContent = readContentSettings(
          checkoutSettings?.settings,
        );

        if (
          body.deliveryType === "pickup"
          && !checkoutContent.delivery.pickupEnabled
        ) {
          throw new HttpError(
            400,
            "Самовывоз временно недоступен. Выберите доставку.",
          );
        }

        if (
          body.paymentMethod === "cash_on_delivery"
          && checkoutSettings?.is_cash_payment_enabled === false
        ) {
          throw new HttpError(
            400,
            "Оплата при получении временно недоступна",
          );
        }

        if (
          body.paymentMethod === "transfer_after_confirm"
          && checkoutSettings?.is_transfer_payment_enabled === false
        ) {
          throw new HttpError(
            400,
            "Оплата переводом временно недоступна",
          );
        }

        if (
          (body.paymentMethod === "online_card" || body.paymentMethod === "sbp")
          && checkoutSettings?.is_online_payment_enabled !== true
        ) {
          throw new HttpError(
            400,
            "Онлайн-оплата пока не подключена",
          );
        }

        await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext(
            ${`public-order:${body.clientRequestId}`}
          )
        )
      `;

        const existingOrderRows = await transaction<
          {
            id: string;
            customer_id: string;
            order_number: string;
            status: string;
            total: number;
            discount_total: number;
            bonus_spent: number;
            delivery_price: number;
            tracking_token: string;
            metadata: {
              promoCode?: string | null;
              delivery?: {
                tariffName?: string;
                isExpress?: boolean;
              };
            } | null;
          }[]
        >`
          SELECT
            id,
            customer_id,
            order_number,
            status,
            total,
            discount_total,
            bonus_spent,
            delivery_price,
            tracking_token,
            metadata
          FROM orders
          WHERE shop_id = ${shop.id}
            AND metadata ->> 'clientRequestId'
              = ${body.clientRequestId}
          ORDER BY created_at DESC
          LIMIT 1
        `;

        const existingOrder = existingOrderRows[0];

        if (existingOrder) {
          if (telegramChatId) {
            const telegramRows = await transaction<
              {
                customer_id: string | null;
              }[]
            >`
              SELECT customer_id
              FROM telegram_accounts
              WHERE shop_id = ${shop.id}
                AND telegram_id = ${telegramChatId}
              LIMIT 1
              FOR UPDATE
            `;

            const linkedCustomerId = telegramRows[0]?.customer_id ?? null;

            if (
              linkedCustomerId
              && linkedCustomerId !== existingOrder.customer_id
            ) {
              throw new HttpError(
                409,
                "Этот Telegram уже связан с другим профилем. Используйте телефон связанного профиля или обратитесь к менеджеру",
              );
            }

            await transaction`
              INSERT INTO telegram_accounts (
                shop_id,
                telegram_id,
                customer_id,
                notifications_enabled,
                is_active,
                linked_at,
                created_at,
                updated_at
              )
              VALUES (
                ${shop.id},
                ${telegramChatId},
                ${existingOrder.customer_id},
                true,
                true,
                NOW(),
                NOW(),
                NOW()
              )
              ON CONFLICT (shop_id, telegram_id)
              DO UPDATE SET
                customer_id = EXCLUDED.customer_id,
                is_active = true,
                linked_at = COALESCE(telegram_accounts.linked_at, NOW()),
                updated_at = NOW()
            `;
          }

          const linkRows = await transaction<
            {
              token: string;
            }[]
          >`
            SELECT token
            FROM customer_link_tokens
            WHERE shop_id = ${shop.id}
              AND order_id = ${existingOrder.id}
              AND provider = 'telegram'
              AND purpose = 'connect_channel'
              AND status = 'pending'
              AND consumed_at IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
          `;

          const customerSessionToken = createSessionToken();

          await transaction`
          INSERT INTO customer_sessions (
            shop_id,
            customer_id,
            token,
            user_agent,
            expires_at,
            last_seen_at,
            created_at
          )
          VALUES (
            ${shop.id},
            ${existingOrder.customer_id},
            ${customerSessionToken},
            ${String(request.headers["user-agent"] ?? "")},
            NOW() + INTERVAL '30 days',
            NOW(),
            NOW()
          )
        `;

          return {
            customerSessionToken,
            response: {
              ok: true,
              order: {
                id: existingOrder.id,
                orderNumber: existingOrder.order_number,
                status: existingOrder.status,
                totalAmount: Number(existingOrder.total),
                discountTotal: Number(existingOrder.discount_total),
                bonusSpent: Number(existingOrder.bonus_spent),
                promoCode: existingOrder.metadata?.promoCode ?? "",
                deliveryPrice: Number(existingOrder.delivery_price),
                deliveryTariffName:
                  existingOrder.metadata?.delivery?.tariffName ?? "Доставка",
                deliveryIsExpress:
                  existingOrder.metadata?.delivery?.isExpress === true,
                trackingToken: existingOrder.tracking_token,
                telegramLinkCode: linkRows[0]?.token ?? null,
                reused: true,
              },
            },
          };
        }

        const productsMap = new Map<
          string,
          {
            id: string;
            name: string;
            price: number;
          }
        >();

        for (const item of requestedItems) {
          const rows = await transaction<
            {
              id: string;
              name: string;
              price: number;
              stock_quantity: number | null;
            }[]
          >`
            SELECT
              id,
              name,
              price,
              stock_quantity
            FROM products
            WHERE shop_id = ${shop.id}
              AND id = ${item.productId}
              AND status = 'active'
            LIMIT 1
            FOR UPDATE
          `;

          const product = rows[0];

          if (!product) {
            throw new HttpError(400, "Product not found or inactive");
          }

          const availableQuantity = Number(product.stock_quantity ?? 0);

          if (availableQuantity < item.quantity) {
            throw new HttpError(
              409,
              `Товар «${product.name}» сейчас недоступен в выбранном количестве`,
            );
          }

          productsMap.set(product.id, {
            id: product.id,
            name: product.name,
            price: Number(product.price),
          });
        }

        const subtotalAmount = requestedItems.reduce((sum, item) => {
          const product = productsMap.get(item.productId);

          return sum + Number(product?.price ?? 0) * item.quantity;
        }, 0);

        const minimumOrderAmount =
          checkoutContent.delivery.minimumOrderAmount;

        if (
          minimumOrderAmount > 0
          && subtotalAmount < minimumOrderAmount
        ) {
          throw new HttpError(
            400,
            `Минимальная сумма заказа — ${minimumOrderAmount} ₽`,
          );
        }

        type DeliveryZoneSnapshot = {
          id: string;
          name: string;
          price: number;
          free_from_amount: number | null;
          is_express_available: boolean;
          express_price: number | null;
        };

        let selectedDeliveryZone: DeliveryZoneSnapshot | null = null;

        let deliveryPrice = 0;

        let deliveryTariffName =
          body.deliveryType === "pickup" ? "Самовывоз" : "Обычная доставка";

        let deliveryIsExpress = false;

        let deliveryFreeThresholdApplied = false;

        if (body.deliveryType === "delivery") {
          if (!body.deliveryZoneId) {
            throw new HttpError(400, "Выберите зону доставки");
          }

          const zoneRows = await transaction<DeliveryZoneSnapshot[]>`
            SELECT
              id,
              name,
              price,
              free_from_amount,
              is_express_available,
              express_price
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND id =
                ${body.deliveryZoneId}
              AND is_active = true
              AND LOWER(BTRIM(name))
                <> 'самовывоз'
            LIMIT 1
          `;

          const zone = zoneRows[0];

          if (!zone) {
            throw new HttpError(400, "Зона доставки недоступна");
          }

          selectedDeliveryZone = zone;

          const basePrice = Math.max(0, Number(zone.price || 0));

          const freeFromAmount = Math.max(
            0,
            Number(zone.free_from_amount || 0),
          );

          const expressPrice = Math.max(0, Number(zone.express_price || 0));

          deliveryIsExpress = body.deliveryService === "express";

          if (deliveryIsExpress) {
            if (!zone.is_express_available || expressPrice <= 0) {
              throw new HttpError(
                400,
                "Срочная доставка недоступна для выбранной зоны",
              );
            }

            deliveryPrice = expressPrice;

            deliveryTariffName = "Срочная доставка";
          } else if (freeFromAmount > 0 && subtotalAmount >= freeFromAmount) {
            deliveryPrice = 0;

            deliveryTariffName = "Бесплатная доставка";

            deliveryFreeThresholdApplied = true;
          } else {
            deliveryPrice = basePrice;

            deliveryTariffName = "Обычная доставка";
          }
        }

        let selectedDeliveryInterval: {
          id: string;
          name: string;
        } | null = null;

        if (body.deliveryType === "delivery") {
          const intervalRows = body.deliveryIntervalId
            ? await transaction<
                {
                  id: string;
                  name: string;
                }[]
              >`
                SELECT
                  id,
                  name
                FROM delivery_intervals
                WHERE shop_id = ${shop.id}
                  AND id =
                    ${body.deliveryIntervalId}
                  AND is_active = true
                LIMIT 1
              `
            : body.deliveryIntervalText.trim()
              ? await transaction<
                  {
                    id: string;
                    name: string;
                  }[]
                >`
                  SELECT
                    id,
                    name
                  FROM delivery_intervals
                  WHERE shop_id = ${shop.id}
                    AND name =
                      ${body.deliveryIntervalText.trim()}
                    AND is_active = true
                  LIMIT 1
                `
              : [];

          const interval = intervalRows[0];

          if (!interval) {
            throw new HttpError(400, "Выберите доступный интервал доставки");
          }

          selectedDeliveryInterval = {
            id: interval.id,
            name: interval.name,
          };
        }

        let discountTotal = 0;
        let promoId: string | null = null;
        const promoCode = normalizePromoCode(body.promoCode || "");

        if (promoCode) {
          const promoRows = await transaction<
            {
              id: string;
              discount_type: string;
              discount_value: number;
              min_order_amount: number | null;
              usage_limit: number | null;
              used_count: number;
            }[]
          >`
          SELECT id, discount_type, discount_value, min_order_amount, usage_limit, used_count
          FROM promocodes
          WHERE shop_id = ${shop.id}
            AND UPPER(code) = ${promoCode}
            AND is_active = true
            AND (starts_at IS NULL OR starts_at <= NOW())
            AND (ends_at IS NULL OR ends_at >= NOW())
          LIMIT 1
          FOR UPDATE
        `;

          const promo = promoRows[0];

          if (!promo) {
            throw new HttpError(400, "Промокод не найден или уже не действует");
          }

          if (
            promo.usage_limit !== null &&
            promo.used_count >= promo.usage_limit
          ) {
            throw new HttpError(400, "Лимит использования промокода исчерпан");
          }

          if (
            promo.min_order_amount !== null &&
            subtotalAmount < promo.min_order_amount
          ) {
            throw new HttpError(
              400,
              `Минимальная сумма заказа для промокода — ${promo.min_order_amount} ₽`,
            );
          }

          promoId = promo.id;
          discountTotal = calculateDiscount({
            subtotal: subtotalAmount,
            discountType: promo.discount_type,
            discountValue: Number(promo.discount_value),
          });
        }

        const amountBeforeBonus = Math.max(
          0,
          subtotalAmount + deliveryPrice - discountTotal,
        );
        let bonusSpent = 0;
        let totalAmount = amountBeforeBonus;
        const orderNumber = createOrderNumber();
        const trackingToken = createTrackingToken();
        const customerPhone = normalizeRussianPhone(body.customerPhone);

        const customerEmail = body.customerEmail.trim() || null;

        const recipientName = body.recipientSameAsCustomer
          ? body.customerName
          : body.recipientName;

        const recipientPhone = body.recipientSameAsCustomer
          ? customerPhone
          : normalizeRussianPhone(body.recipientPhone);

        const customerPhoneCandidates = phoneDigitCandidates(customerPhone);

        const existingCustomerRows = await transaction<
          {
            id: string;
            bonus_balance: number;
          }[]
        >`
          SELECT id, bonus_balance
          FROM customers
          WHERE shop_id = ${shop.id}
            AND (
              phone = ${customerPhone}
              OR regexp_replace(
                phone,
                '[^0-9]',
                '',
                'g'
              ) = ANY(
                ${customerPhoneCandidates}::text[]
              )
            )
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        `;

        let customer = existingCustomerRows[0];

        if (customer) {
          await transaction`
          UPDATE customers
          SET
            name = COALESCE(
              NULLIF(${body.customerName}, ''),
              name
            ),
            email = COALESCE(
              ${customerEmail},
              email
            ),
            updated_at = NOW()
          WHERE id = ${customer.id}
        `;
        } else {
          const customerRows = await transaction<
            {
              id: string;
              bonus_balance: number;
            }[]
          >`
            INSERT INTO customers (
              shop_id,
              phone,
              name,
              email,
              total_orders,
              total_spent,
              last_order_at,
              created_at,
              updated_at
            )
            VALUES (
              ${shop.id},
              ${customerPhone},
              ${body.customerName},
              ${customerEmail},
              0,
              0,
              NOW(),
              NOW(),
              NOW()
            )
            ON CONFLICT (shop_id, phone)
            DO UPDATE SET
              name = COALESCE(
                NULLIF(EXCLUDED.name, ''),
                customers.name
              ),
              email = COALESCE(
                EXCLUDED.email,
                customers.email
              ),
              updated_at = NOW()
            RETURNING id, bonus_balance
          `;

          customer = customerRows[0];
        }

        if (!customer?.id) {
          throw new HttpError(500, "Customer was not created");
        }

        const requestedBonusSpend = Math.max(
          0,
          Math.floor(Number(body.bonusToSpend || 0)),
        );

        if (requestedBonusSpend > 0) {
          const token = getCookieValue(
            request.headers.cookie,
            CUSTOMER_SESSION_COOKIE,
          );

          if (!token) {
            throw new HttpError(
              401,
              "Войдите в личный кабинет, чтобы использовать бонусы",
            );
          }

          const sessionRows = await transaction<{ customer_id: string }[]>`
          SELECT customer_id
          FROM customer_sessions
          WHERE token = ${token}
            AND revoked_at IS NULL
            AND expires_at > NOW()
          LIMIT 1
        `;

          const session = sessionRows[0];

          if (!session || session.customer_id !== customer.id) {
            throw new HttpError(
              403,
              "Бонусы можно списать только со своего профиля",
            );
          }

          const freshCustomerRows = await transaction<
            { bonus_balance: number }[]
          >`
          SELECT bonus_balance
          FROM customers
          WHERE id = ${customer.id}
          LIMIT 1
          FOR UPDATE
        `;

          const balance = Math.max(0, Number(freshCustomerRows[0]?.bonus_balance || 0));
          const maxBonusSpend = Math.min(
            balance,
            Math.floor(amountBeforeBonus * 0.3),
            amountBeforeBonus,
          );

          bonusSpent = Math.min(requestedBonusSpend, maxBonusSpend);
          totalAmount = Math.max(0, amountBeforeBonus - bonusSpent);
        }

        const orderRows = await transaction<{ id: string }[]>`
        INSERT INTO orders (
          shop_id,
          customer_id,
          order_number,
          status,
          payment_status,
          payment_method,
          delivery_type,
          delivery_zone_id,
          delivery_interval_id,
          delivery_date,
          delivery_address_text,
          delivery_comment,
          recipient_name,
          recipient_phone,
          customer_comment,
          contact_preference,
          subtotal,
          discount_total,
          delivery_price,
          bonus_spent,
          bonus_earned,
          total,
          tracking_token,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${orderNumber},
          'new',
          'pending',
          ${body.paymentMethod},
          ${body.deliveryType},
          ${
            body.deliveryType === "delivery"
              ? (selectedDeliveryZone?.id ?? null)
              : null
          },
          ${
            body.deliveryType === "delivery"
              ? (selectedDeliveryInterval?.id ?? null)
              : null
          },
          ${body.deliveryType === "delivery" ? body.deliveryDate : null},
          ${
            body.deliveryType === "delivery"
              ? body.deliveryAddress
              : checkoutContent.delivery.pickupAddress || null
          },
          ${body.deliveryComment || null},
          ${recipientName},
          ${recipientPhone},
          ${body.customerComment || null},
          ${body.contactPreference},
          ${subtotalAmount},
          ${discountTotal},
          ${deliveryPrice},
          ${bonusSpent},
          0,
          ${totalAmount},
          ${trackingToken},
          ${JSON.stringify({
            clientRequestId: body.clientRequestId,

            source: orderSource,

            telegramChatId: telegramChatId || null,

            promoCode: promoCode || null,

            customer: {
              name: body.customerName,

              phone: customerPhone,

              email: customerEmail,

              contactPreference: body.contactPreference,
            },

            recipient: {
              sameAsCustomer: body.recipientSameAsCustomer,

              isSurprise: body.isSurprise,

              doNotCall: body.doNotCallRecipient,

              cardText: body.cardText || null,
            },

            delivery: {
              calculationVersion: 2,

              service:
                body.deliveryType === "pickup"
                  ? "pickup"
                  : deliveryIsExpress
                    ? "express"
                    : "standard",

              isExpress: deliveryIsExpress,

              tariffName: deliveryTariffName,

              zoneId: selectedDeliveryZone?.id ?? null,

              zoneName: selectedDeliveryZone?.name ?? null,

              intervalId: selectedDeliveryInterval?.id ?? null,

              intervalName: selectedDeliveryInterval?.name ?? null,

              date: body.deliveryType === "delivery" ? body.deliveryDate : null,

              address:
                body.deliveryType === "delivery"
                  ? body.deliveryAddress
                  : checkoutContent.delivery.pickupAddress || null,

              pickupNote:
                body.deliveryType === "pickup"
                  ? checkoutContent.delivery.pickupNote
                  : null,

              courierComment: body.deliveryComment || null,

              basePrice: selectedDeliveryZone
                ? Number(selectedDeliveryZone.price || 0)
                : 0,

              expressPrice: selectedDeliveryZone
                ? Number(selectedDeliveryZone.express_price || 0)
                : 0,

              freeFromAmount: selectedDeliveryZone
                ? Number(selectedDeliveryZone.free_from_amount || 0)
                : 0,

              freeThresholdApplied: deliveryFreeThresholdApplied,

              appliedPrice: deliveryPrice,

              calculatedFromSubtotal: subtotalAmount,
            },
          })},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

        const order = orderRows[0];

        if (!order?.id) {
          throw new HttpError(500, "Order was not created");
        }

        if (telegramChatId) {
          const telegramRows = await transaction<
            {
              customer_id: string | null;
            }[]
          >`
            SELECT customer_id
            FROM telegram_accounts
            WHERE shop_id = ${shop.id}
              AND telegram_id = ${telegramChatId}
            LIMIT 1
            FOR UPDATE
          `;

          const linkedCustomerId = telegramRows[0]?.customer_id ?? null;

          if (linkedCustomerId && linkedCustomerId !== customer.id) {
            throw new HttpError(
              409,
              "Этот Telegram уже связан с другим профилем. Используйте телефон связанного профиля или обратитесь к менеджеру",
            );
          }

          await transaction`
            INSERT INTO telegram_accounts (
              shop_id,
              telegram_id,
              customer_id,
              notifications_enabled,
              is_active,
              linked_at,
              created_at,
              updated_at
            )
            VALUES (
              ${shop.id},
              ${telegramChatId},
              ${customer.id},
              true,
              true,
              NOW(),
              NOW(),
              NOW()
            )
            ON CONFLICT (shop_id, telegram_id)
            DO UPDATE SET
              customer_id = EXCLUDED.customer_id,
              is_active = true,
              linked_at = COALESCE(telegram_accounts.linked_at, NOW()),
              updated_at = NOW()
          `;
        }

        for (const item of requestedItems) {
          const product = productsMap.get(item.productId);

          if (!product) continue;

          const quantity = item.quantity;
          const unitPrice = Number(product.price);
          const itemTotal = unitPrice * quantity;

          const reservedProductRows = await transaction<
            {
              stock_quantity: number;
            }[]
          >`
            UPDATE products
            SET
              stock_quantity =
                stock_quantity
                - ${quantity},
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${product.id}
              AND status = 'active'
              AND stock_quantity
                IS NOT NULL
              AND stock_quantity
                >= ${quantity}
            RETURNING stock_quantity
          `;

          if (!reservedProductRows[0]) {
            throw new HttpError(
              409,
              `Остаток товара «${product.name}» изменился. Обновите корзину и повторите заказ`,
            );
          }

          await transaction`
          INSERT INTO order_items (
            shop_id,
            order_id,
            product_id,
            product_name,
            product_snapshot,
            quantity,
            price,
            total,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${order.id},
            ${product.id},
            ${product.name},
            ${JSON.stringify({ id: product.id, name: product.name, price: unitPrice })},
            ${quantity},
            ${unitPrice},
            ${itemTotal},
            NOW(),
            NOW()
          )
        `;
        }

        const inventoryReservation = {
          version: 1,
          state: "reserved",
          reservedAt: new Date().toISOString(),
          items: requestedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        };

        await transaction`
        UPDATE orders
        SET
          metadata =
            jsonb_set(
              COALESCE(
                metadata,
                '{}'::jsonb
              ),
              '{inventoryReservation}',
              CAST(
                ${JSON.stringify(inventoryReservation)}
                AS jsonb
              ),
              true
            ),
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${order.id}
      `;

        if (promoId) {
          const updatedPromoRows = await transaction<
            {
              used_count: number;
            }[]
          >`
            UPDATE promocodes
            SET
              used_count =
                used_count + 1,
              updated_at = NOW()
            WHERE id = ${promoId}
              AND (
                usage_limit IS NULL
                OR used_count
                  < usage_limit
              )
            RETURNING used_count
          `;

          if (!updatedPromoRows[0]) {
            throw new HttpError(409, "Лимит использования промокода исчерпан");
          }
        }

        const updatedCustomerRows = await transaction<
          {
            bonus_balance: number;
          }[]
        >`
          UPDATE customers
          SET
            total_orders =
              total_orders + 1,
            total_spent =
              total_spent
              + ${totalAmount},
            bonus_balance =
              bonus_balance
              - ${bonusSpent},
            last_order_at = NOW(),
            updated_at = NOW()
          WHERE id = ${customer.id}
            AND bonus_balance
              >= ${bonusSpent}
          RETURNING bonus_balance
        `;

        if (!updatedCustomerRows[0]) {
          throw new HttpError(
            409,
            "Бонусный баланс изменился. Обновите страницу и повторите заказ",
          );
        }

        if (bonusSpent > 0) {
          await transaction`
          INSERT INTO bonus_transactions (
            shop_id,
            customer_id,
            order_id,
            type,
            amount,
            balance_after,
            comment,
            created_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            ${order.id},
            'spend',
            ${-bonusSpent},
            ${Number(updatedCustomerRows[0]?.bonus_balance ?? 0)},
            ${`Списание бонусов в заказе ${orderNumber}`},
            NOW()
          )
        `;
        }

        await transaction`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            status,
            payload,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${order.id},
            'order_created',
            'telegram',
            'staff',
            'pending',
            ${JSON.stringify({
              orderId: order.id,
              orderNumber,
              status: "new",
              customerName: body.customerName,
              customerPhone,
              recipientName,
              recipientPhone,
              isSurprise: body.isSurprise,
              doNotCallRecipient: body.doNotCallRecipient,
              cardText: body.cardText || null,
              contactPreference: body.contactPreference,
              totalAmount,
              discountTotal,
              bonusSpent,
              deliveryType: body.deliveryType,

              deliveryService:
                body.deliveryType === "pickup"
                  ? "pickup"
                  : deliveryIsExpress
                    ? "express"
                    : "standard",

              deliveryIsExpress,
              deliveryTariffName,
              deliveryPrice,

              deliveryZoneName: selectedDeliveryZone?.name ?? null,

              deliveryIntervalName: selectedDeliveryInterval?.name ?? null,

              deliveryDate: body.deliveryDate || null,
              trackingToken,
              trackingUrl: `/order/track/${trackingToken}`,
              source: orderSource,
            })},
            NOW(),
            NOW()
          )
        `;

        await transaction`
          INSERT INTO notification_events (
            shop_id,
            order_id,
            type,
            channel,
            recipient_type,
            status,
            payload,
            created_at,
            updated_at
          )
          SELECT
            ${shop.id},
            ${order.id},
            'order_created',
            'telegram',
            'customer',
            'pending',
            CAST(${JSON.stringify({
              orderId: order.id,
              orderNumber,
              status: "new",
              customerName: body.customerName,
              customerPhone,
              recipientName,
              recipientPhone,
              isSurprise: body.isSurprise,
              doNotCallRecipient: body.doNotCallRecipient,
              cardText: body.cardText || null,
              contactPreference: body.contactPreference,
              totalAmount,
              discountTotal,
              bonusSpent,
              deliveryType: body.deliveryType,

              deliveryService:
                body.deliveryType === "pickup"
                  ? "pickup"
                  : deliveryIsExpress
                    ? "express"
                    : "standard",

              deliveryIsExpress,
              deliveryTariffName,
              deliveryPrice,

              deliveryZoneName: selectedDeliveryZone?.name ?? null,

              deliveryIntervalName: selectedDeliveryInterval?.name ?? null,

              deliveryDate: body.deliveryDate || null,
              trackingToken,
              trackingUrl: `/order/track/${trackingToken}`,
              source: orderSource,
            })} AS jsonb),
            NOW(),
            NOW()
          WHERE ${orderSource}::text <> 'telegram'
            AND EXISTS (
            SELECT 1
            FROM telegram_accounts ta
            WHERE ta.shop_id = ${shop.id}
              AND ta.customer_id = ${customer.id}
              AND ta.is_active = true
              AND ta.notifications_enabled = true
          )
        `;

        await transaction`
        UPDATE customer_link_tokens
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND customer_id =
            ${customer.id}
          AND provider = 'telegram'
          AND purpose =
            'connect_channel'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

        const linkedTelegramRows = await transaction<
          {
            telegram_id: string;
          }[]
        >`
          SELECT telegram_id
          FROM telegram_accounts
          WHERE shop_id = ${shop.id}
            AND customer_id =
              ${customer.id}
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        `;

        const telegramAlreadyConnected = Boolean(
          linkedTelegramRows[0]?.telegram_id,
        );

        let telegramLinkCode: string | null = null;

        if (!telegramAlreadyConnected) {
          telegramLinkCode = createTelegramLinkCode();

          await transaction`
          INSERT INTO customer_link_tokens (
            shop_id,
            customer_id,
            order_id,
            provider,
            purpose,
            token,
            status,
            expires_at,
            metadata,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            ${order.id},
            'telegram',
            'connect_channel',
            ${telegramLinkCode},
            'pending',
            NOW() + INTERVAL '30 minutes',
            ${JSON.stringify({
              source: "site_order_success",
              orderNumber,
              mode: "code",
            })},
            NOW(),
            NOW()
          )
        `;
        }

        const customerSessionToken = createSessionToken();

        await transaction`
        INSERT INTO customer_sessions (
          shop_id,
          customer_id,
          token,
          user_agent,
          expires_at,
          last_seen_at,
          created_at
        )
        VALUES (
          ${shop.id},
          ${customer.id},
          ${customerSessionToken},
          ${String(request.headers["user-agent"] ?? "")},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

        return {
          customerSessionToken,
          response: {
            ok: true,
            order: {
              id: order.id,
              orderNumber,
              status: "new",
              totalAmount,
              discountTotal,
              bonusSpent,
              promoCode,
              deliveryPrice,
              deliveryTariffName,
              deliveryIsExpress,
              trackingToken,
              telegramLinkCode,
              reused: false,
            },
          },
        };
      });

      reply.header(
        "Set-Cookie",
        buildCustomerSessionCookie(transactionResult.customerSessionToken),
      );

      return reply.status(201).send(transactionResult.response);
    } catch (error) {
      throw error;
    } finally {
      await client.end();
    }
  });

  app.get("/api/public/delivery", async () => {
    const { db, client, shop } = await getShopContext();

    try {
      const [allZones, intervals, settingsRows] = await Promise.all([
        db
          .select()
          .from(deliveryZones)
          .where(
            and(
              eq(deliveryZones.shopId, shop.id),
              eq(deliveryZones.isActive, true),
            ),
          )
          .orderBy(asc(deliveryZones.sortOrder)),
        db
          .select()
          .from(deliveryIntervals)
          .where(
            and(
              eq(deliveryIntervals.shopId, shop.id),
              eq(deliveryIntervals.isActive, true),
            ),
          )
          .orderBy(asc(deliveryIntervals.sortOrder)),
        db
          .select()
          .from(shopSettings)
          .where(eq(shopSettings.shopId, shop.id))
          .limit(1),
      ]);

      const zones = allZones.filter(
        (zone) => zone.name.trim().toLowerCase() !== "самовывоз",
      );

      const settings = settingsRows[0] ?? null;
      const content = readContentSettings(settings?.settings);

      return {
        zones,
        intervals,
        pickup: {
          enabled: content.delivery.pickupEnabled,
          address: content.delivery.pickupAddress,
          note: content.delivery.pickupNote,
        },
        minimumOrderAmount:
          content.delivery.minimumOrderAmount,
        orderLeadTimeMinutes:
          content.delivery.orderLeadTimeMinutes,
        expressLeadTimeMinutes:
          content.delivery.expressLeadTimeMinutes,
        notice: content.delivery.notice,
        paymentMethods: {
          online: settings?.isOnlinePaymentEnabled === true,
          cash: settings?.isCashPaymentEnabled !== false,
          transfer: settings?.isTransferPaymentEnabled !== false,
        },
      };
    } finally {
      await client.end();
    }
  });
}
