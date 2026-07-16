import type { FastifyInstance, FastifyRequest } from "fastify";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http-error";
import { markOrderPaid } from "../modules/orders/order-payment.service";
import {
  recordFullOrderRefund,
  rollbackOrderFinancialsOnCancellation
} from "../modules/orders/order-finance.service";

type ShopRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

type AdminRole = "owner" | "admin" | "manager" | "florist" | "courier";

type AdminSessionContext = {
  userId: string;
  shopId: string;
  role: AdminRole;
};

type AdminRequest = FastifyRequest & {
  adminContext?: AdminSessionContext;
};

function numberFromCount(value: unknown) {
  return Number(value ?? 0);
}

function createEmployeeLinkToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function createTelegramLinkCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const ADMIN_SESSION_COOKIE = "vm_admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function createAdminSessionToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function hashPassword(password: string) {
  const iterations = 210000;
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
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

function buildAdminSessionCookie(token: string) {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`;
}

function clearAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/* ROLE ACCESS 7.2.1 */
const ALL_ADMIN_ROLES: AdminRole[] = [
  "owner",
  "admin",
  "manager",
  "florist",
  "courier"
];

const OWNER_ADMIN_ROLES: AdminRole[] = [
  "owner",
  "admin"
];

const MANAGEMENT_ROLES: AdminRole[] = [
  "owner",
  "admin",
  "manager"
];

function adminHomeForRole(
  role: string
) {
  if (
    role === "florist"
    || role === "courier"
  ) {
    return "/admin/orders";
  }

  return "/admin";
}

function getRequiredAdminRoles(
  path: string,
  method: string
): AdminRole[] {
  const normalizedMethod =
    method.toUpperCase();

  if (
    path.startsWith(
      "/api/admin/auth/"
    )
  ) {
    return ALL_ADMIN_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/dashboard"
    )
  ) {
    return MANAGEMENT_ROLES;
  }

  /*
   * Страница заказов использует heartbeat.
   * Доступ разрешён всем рабочим ролям,
   * а endpoint обновляет именно текущего
   * сотрудника.
   */
  if (
    path.startsWith(
      "/api/admin/presence"
    )
  ) {
    return ALL_ADMIN_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/finance"
    )
  ) {
    return normalizedMethod === "GET"
      ? MANAGEMENT_ROLES
      : OWNER_ADMIN_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/orders"
    )
  ) {
    if (
      path.endsWith(
        "/refund"
      )
    ) {
      return OWNER_ADMIN_ROLES;
    }
    if (
      normalizedMethod === "GET"
    ) {
      return ALL_ADMIN_ROLES;
    }

    if (
      path.includes(
        "/internal-chat"
      )
    ) {
      return ALL_ADMIN_ROLES;
    }

    /*
     * Смена статусов флористом и курьером
     * будет ограничена назначением и
     * допустимыми переходами в 7.2.2.
     */
    if (
      path.endsWith("/status")
    ) {
      return ALL_ADMIN_ROLES;
    }

    return MANAGEMENT_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/customers"
    )
  ) {
    return MANAGEMENT_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/notifications"
    )
  ) {
    return MANAGEMENT_ROLES;
  }

  /*
   * Каталог и тарифы изменяют структуру
   * магазина. Менеджер заказов не имеет
   * к ним доступа.
   */
  if (
    path.startsWith(
      "/api/admin/catalog"
    )
    || path.startsWith(
      "/api/admin/categories"
    )
    || path.startsWith(
      "/api/admin/products"
    )
    || path.startsWith(
      "/api/admin/product-images"
    )
    || path.startsWith(
      "/api/admin/delivery"
    )
  ) {
    return OWNER_ADMIN_ROLES;
  }

  if (
    path.startsWith(
      "/api/admin/employees"
    )
    || path.startsWith(
      "/api/admin/settings"
    )
  ) {
    return OWNER_ADMIN_ROLES;
  }

  return OWNER_ADMIN_ROLES;
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeContactPhone(value: string) {
  const digits = normalizePhoneDigits(value);

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

const contactPhoneSchema = z.string()
  .trim()
  .max(32)
  .refine(
    (value) => {
      const digits = normalizePhoneDigits(value);
      return digits.length >= 10 && digits.length <= 15;
    },
    "Укажите корректный номер телефона"
  );

function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;

  const parts = storedHash.split("$");

  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expectedHash = parts[3];

  if (!iterations || !salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}



const safePublicLinkSchema = z.string()
  .trim()
  .max(500)
  .refine(
    (value) => (
      value === ""
      || value.startsWith("/")
      || /^https:\/\/[a-z0-9.-]+(?:[/:?#].*)?$/i.test(value)
    ),
    "Используйте внутреннюю ссылку /... или безопасную ссылку https://..."
  );

const safeHeroImageSchema = z.string()
  .trim()
  .max(500)
  .refine(
    (value) => (
      value === ""
      || /^\/uploads\/products\/[a-zA-Z0-9._-]+$/.test(value)
    ),
    "Главное изображение должно быть выбрано из фотографий товаров"
  );

const homeBenefitSchema = z.object({
  title: z.string().trim().min(2).max(100),
  text: z.string().trim().min(2).max(260)
});

const settingsSchema = z.object({
  phone: z.string().trim().max(32).optional().default(""),
  whatsapp: z.string().trim().max(120).optional().default(""),
  telegram: z.string().trim().max(120).optional().default(""),
  instagram: z.string().trim().max(500).optional().default(""),
  address: z.string().trim().max(1000).optional().default(""),
  workHours: z.string().trim().max(160).optional().default(""),
  heroTitle: z.string().trim().min(3).max(255)
    .optional()
    .default("Цветы, которые говорят за вас"),
  heroSubtitle: z.string().trim().min(3).max(1200)
    .optional()
    .default("Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю."),
  heroImageUrl: safeHeroImageSchema.optional().default(""),
  isOnlinePaymentEnabled: z.coerce.boolean().optional().default(false),
  isCashPaymentEnabled: z.coerce.boolean().optional().default(true),
  isTransferPaymentEnabled: z.coerce.boolean().optional().default(true),
  site: z.object({
    brandName: z.string().trim().min(2).max(120)
      .optional()
      .default("Выбери Меня"),
    brandSubtitle: z.string().trim().max(120)
      .optional()
      .default("ЦВЕТЫ И ПОДАРКИ"),
    footerDescription: z.string().trim().max(1000)
      .optional()
      .default("Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю."),
    email: z.union([
      z.string().trim().email().max(255),
      z.literal("")
    ]).optional().default(""),
    legalName: z.string().trim().max(255).optional().default(""),
    inn: z.string().trim().max(20).optional().default(""),
    ogrn: z.string().trim().max(20).optional().default(""),
    policyUrl: safePublicLinkSchema.optional().default(""),
    offerUrl: safePublicLinkSchema.optional().default(""),
    deliveryTermsUrl: safePublicLinkSchema.optional().default(""),
    returnsUrl: safePublicLinkSchema.optional().default("")
  }).optional().default({
    brandName: "Выбери Меня",
    brandSubtitle: "ЦВЕТЫ И ПОДАРКИ",
    footerDescription: "Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю.",
    email: "",
    legalName: "",
    inn: "",
    ogrn: "",
    policyUrl: "",
    offerUrl: "",
    deliveryTermsUrl: "",
    returnsUrl: ""
  }),
  homepage: z.object({
    eyebrow: z.string().trim().max(120)
      .optional()
      .default("Цветочная мастерская"),
    primaryCtaLabel: z.string().trim().min(2).max(80)
      .optional()
      .default("Выбрать букет"),
    secondaryCtaLabel: z.string().trim().min(2).max(80)
      .optional()
      .default("Условия доставки"),
    occasions: z.array(
      z.string().trim().min(2).max(80)
    ).max(12).optional().default([]),
    benefits: z.array(homeBenefitSchema)
      .length(3)
      .optional()
      .default([
        {
          title: "Стильные букеты",
          text: "Авторские композиции из свежих цветов на любой случай."
        },
        {
          title: "Фото перед доставкой",
          text: "Покажем готовый букет, чтобы вы были уверены в результате."
        },
        {
          title: "Бережная доставка",
          text: "Аккуратно упакуем и доставим в выбранный интервал."
        }
      ])
  }).optional().default({
    eyebrow: "Цветочная мастерская",
    primaryCtaLabel: "Выбрать букет",
    secondaryCtaLabel: "Условия доставки",
    occasions: [],
    benefits: [
      {
        title: "Стильные букеты",
        text: "Авторские композиции из свежих цветов на любой случай."
      },
      {
        title: "Фото перед доставкой",
        text: "Покажем готовый букет, чтобы вы были уверены в результате."
      },
      {
        title: "Бережная доставка",
        text: "Аккуратно упакуем и доставим в выбранный интервал."
      }
    ]
  }),
  delivery: z.object({
    pickupEnabled: z.coerce.boolean().optional().default(true),
    pickupAddress: z.string().trim().max(1000).optional().default(""),
    pickupNote: z.string().trim().max(1000)
      .optional()
      .default("После оформления менеджер подтвердит время готовности заказа."),
    minimumOrderAmount: z.coerce.number().int().min(0).max(10000000)
      .optional()
      .default(0),
    orderLeadTimeMinutes: z.coerce.number().int().min(0).max(10080)
      .optional()
      .default(120),
    expressLeadTimeMinutes: z.coerce.number().int().min(0).max(1440)
      .optional()
      .default(60),
    notice: z.string().trim().max(1000).optional().default("")
  }).optional().default({
    pickupEnabled: true,
    pickupAddress: "",
    pickupNote: "После оформления менеджер подтвердит время готовности заказа.",
    minimumOrderAmount: 0,
    orderLeadTimeMinutes: 120,
    expressLeadTimeMinutes: 60,
    notice: ""
  })
}).refine(
  (value) => (
    value.isOnlinePaymentEnabled
    || value.isCashPaymentEnabled
    || value.isTransferPaymentEnabled
  ),
  {
    message: "Оставьте включённым хотя бы один способ оплаты",
    path: ["isTransferPaymentEnabled"]
  }
);

const categoryIconKeys = [
  "bouquet",
  "flower",
  "basket",
  "gift",
  "card",
  "sale",
  "subscription",
  "perfume",
  "other"
] as const;

const categoryIconKeySchema =
  z.enum(categoryIconKeys);

type CategoryIconKey =
  z.infer<typeof categoryIconKeySchema>;

function defaultCategoryIconKeyForSlug(
  value: string
): CategoryIconKey {
  const slug = value
    .trim()
    .toLowerCase();

  if (
    slug.includes("buket")
    || slug.includes("bouquet")
  ) {
    return "bouquet";
  }

  if (
    slug.includes("tsvet")
    || slug.includes("flower")
    || slug.includes("rose")
  ) {
    return "flower";
  }

  if (
    slug.includes("korzin")
    || slug.includes("basket")
  ) {
    return "basket";
  }

  if (
    slug.includes("podar")
    || slug.includes("gift")
  ) {
    return "gift";
  }

  if (
    slug.includes("otkryt")
    || slug.includes("card")
  ) {
    return "card";
  }

  if (
    slug.includes("akts")
    || slug.includes("sale")
    || slug.includes("skid")
  ) {
    return "sale";
  }

  if (
    slug.includes("podpisk")
    || slug.includes("subscription")
  ) {
    return "subscription";
  }

  if (
    slug.includes("parfy")
    || slug.includes("perfume")
    || slug.includes("aromat")
  ) {
    return "perfume";
  }

  return "other";
}

function categoryImageUrl(
  iconKey: CategoryIconKey
) {
  return `icon:${iconKey}`;
}

const categorySchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(120)
    .optional()
    .default(""),
  description: z.string().trim().max(5000)
    .optional()
    .default(""),
  sortOrder: z.coerce.number().int()
    .min(0)
    .max(100000)
    .optional()
    .default(100),
  isActive: z.boolean()
    .optional()
    .default(true),
  iconKey: categoryIconKeySchema
    .optional()
});

const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(120)
    .optional()
    .default(""),
  description: z.string().trim().max(5000)
    .optional()
    .default(""),
  sortOrder: z.coerce.number().int()
    .min(0)
    .max(100000),
  isActive: z.boolean(),
  iconKey: categoryIconKeySchema
    .optional()
});

const productImageUploadSchema = z.object({
  imageData: z.string().min(40),
  fileName: z.string().max(255).optional().default(""),
  alt: z.string().max(255).optional().default(""),
  isMain: z.coerce.boolean().optional().default(true)
});

const productImageUpdateSchema = z.object({
  alt: z.string().max(255).optional(),
  sortOrder: z.coerce.number()
    .int()
    .min(0)
    .max(100000)
    .optional(),
  isMain: z.boolean().optional()
}).refine(
  (value) =>
    value.alt !== undefined
    || value.sortOrder !== undefined
    || value.isMain !== undefined,
  {
    message: "Не указаны изменения фотографии"
  }
);

const productSchema = z.object({
  categoryId: z.string().uuid().optional().or(z.literal("")).default(""),
  name: z.string().trim().min(2).max(255),
  slug: z.string().trim().max(160).optional().default(""),
  shortDescription: z.string().trim().max(2000).optional().default(""),
  description: z.string().trim().max(20000).optional().default(""),
  composition: z.string().trim().max(10000).optional().default(""),
  careText: z.string().trim().max(10000).optional().default(""),
  price: z.coerce.number().int().min(0),
  oldPrice: z.union([
    z.coerce.number().int().min(0),
    z.null()
  ]).optional().default(null),
  costPrice: z.union([
    z.coerce.number().int().min(0),
    z.null()
  ]).optional().default(null),
  stockQuantity: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(["draft", "active", "hidden", "archived"]).optional().default("active"),
  isFeatured: z.coerce.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional().default(100)
});

const productUpdateSchema = z.object({
  categoryId: z.string().uuid()
    .optional()
    .or(z.literal(""))
    .default(""),
  name: z.string().trim().min(2).max(255),
  slug: z.string().trim().max(160)
    .optional()
    .default(""),
  shortDescription: z.string().max(2000)
    .optional()
    .default(""),
  description: z.string().max(20000)
    .optional()
    .default(""),
  composition: z.string().max(10000)
    .optional()
    .default(""),
  careText: z.string().max(10000)
    .optional()
    .default(""),
  price: z.coerce.number().int().min(0),
  oldPrice: z.union([
    z.coerce.number().int().min(0),
    z.null()
  ]).optional().default(null),
  costPrice: z.union([
    z.coerce.number().int().min(0),
    z.null()
  ]).optional().default(null),
  stockQuantity: z.coerce.number().int().min(0)
    .optional()
    .default(0),
  status: z.enum([
    "draft",
    "active",
    "hidden",
    "archived"
  ]).optional().default("draft"),
  isFeatured: z.coerce.boolean()
    .optional()
    .default(false),
  sortOrder: z.coerce.number().int()
    .optional()
    .default(100)
});

const deliveryZoneSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().default(""),
  price: z.coerce.number().int().min(0).optional().default(0),
  freeFromAmount: z.coerce.number().int().min(0).optional().default(0),
  isExpressAvailable: z.coerce.boolean().optional().default(false),
  expressPrice: z.coerce.number().int().min(0).optional().default(0),
  isActive: z.coerce.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().optional().default(100)
});

const deliveryTimeSchema = z.string()
  .trim()
  .regex(
    /^([01]\\d|2[0-3]):[0-5]\\d$/,
    "Время должно быть в формате ЧЧ:ММ"
  );

const deliveryIntervalSchema = z.object({
  startsAt: deliveryTimeSchema,
  endsAt: deliveryTimeSchema,
  isActive: z.coerce.boolean()
    .optional()
    .default(true),
  sortOrder: z.coerce.number()
    .int()
    .min(0)
    .max(100000)
    .optional()
    .default(100)
});

function deliveryTimeToMinutes(
  value: string
) {
  const [
    hours,
    minutes
  ] = value.split(":").map(Number);

  return (
    Number(hours || 0) * 60
    + Number(minutes || 0)
  );
}

function deliveryIntervalName(
  startsAt: string,
  endsAt: string
) {
  return `${startsAt}–${endsAt}`;
}


const adminLoginSchema = z.object({
  login: z.string().min(3),
  password: z.string().min(6)
});

/* EMPLOYEE ACCESS SECURITY 7.1 */
const employeeSchema = z.object({
  name: z.string()
    .trim()
    .min(2)
    .max(120),

  phone: z.string()
    .trim()
    .min(5)
    .max(40),

  email: z.union([
    z.string()
      .trim()
      .email()
      .max(255),
    z.literal("")
  ])
    .optional()
    .default(""),

  telegramUsername: z.string()
    .trim()
    .max(100)
    .optional()
    .default(""),

  role: z.enum([
    "admin",
    "manager",
    "florist",
    "courier"
  ]),

  password: z.string()
    .max(128)
    .optional()
    .default(""),

  isActive: z.coerce.boolean()
    .optional()
    .default(true)
});

const orderAssigneesSchema = z.object({
  managerId: z.string().uuid().optional().or(z.literal("")).default(""),
  floristId: z.string().uuid().optional().or(z.literal("")).default(""),
  courierId: z.string().uuid().optional().or(z.literal("")).default("")
});

const orderInternalCommentSchema = z.object({
  internalComment: z.string().max(3000).optional().default("")
});

const bouquetApprovalAdminSchema = z.object({
  action: z.enum(["approve", "waive", "revision", "resend"]),
  note: z.string().trim().max(500).optional().default(""),
});

const orderOperationsSchema = z.object({
  customerName: z.string().trim().min(2).max(160),
  customerPhone: contactPhoneSchema,
  customerEmail: z.union([
    z.string().trim().email().max(255),
    z.literal("")
  ]).optional().default(""),
  recipientName: z.string().trim().min(2).max(160),
  recipientPhone: contactPhoneSchema,
  contactPreference: z.enum([
    "call_or_message",
    "phone_call",
    "messenger_only"
  ]).optional().default("call_or_message"),
  isSurprise: z.coerce.boolean().optional().default(false),
  doNotCallRecipient: z.coerce.boolean().optional().default(false),
  cardText: z.string().trim().max(500).optional().default(""),
  customerComment: z.string().trim().max(2000).optional().default(""),
  deliveryType: z.enum(["delivery", "pickup"]),
  deliveryService: z.enum(["standard", "express"]).optional().default("standard"),
  deliveryZoneId: z.string().uuid().optional().or(z.literal("")).default(""),
  deliveryIntervalId: z.string().uuid().optional().or(z.literal("")).default(""),
  deliveryDate: z.string().trim().max(10).optional().default(""),
  deliveryAddress: z.string().trim().max(1000).optional().default(""),
  deliveryComment: z.string().trim().max(1000).optional().default("")
});

function slugify(value: string) {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };

  return value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}


async function getShop(client: ReturnType<typeof createDb>["client"]) {
  const rows = await client<ShopRow[]>`
    SELECT id, slug, name, status
    FROM shops
    WHERE slug = ${env.DEFAULT_SHOP_SLUG}
    LIMIT 1
  `;

  const shop = rows[0];

  if (!shop) {
    throw new HttpError(404, "Shop not found");
  }

  return shop;
}

type CustomerNotificationType =
  | "order_confirmed"
  | "payment_link_added"
  | "order_paid"
  | "order_ready"
  | "order_courier_assigned"
  | "order_delivering"
  | "order_delivered"
  | "order_problem"
  | "order_cancelled"
  | "order_refunded";

async function queueCustomerOrderNotification(
  client: any,
  params: {
    shopId: string;
    orderId: string;
    type: CustomerNotificationType;
    status?: string;
    extraPayload?: Record<string, unknown>;
  }
) {
  await client`
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
      o.shop_id,
      o.id,
      ${params.type},
      'telegram',
      'customer',
      'pending',
      jsonb_build_object(
        'orderId', o.id,
        'orderNumber', o.order_number,
        'status', COALESCE(${params.status || null}, o.status::text),
        'paymentStatus', o.payment_status,
        'totalAmount', o.total,
        'customerName', c.name,
        'customerPhone', c.phone,
        'recipientName', o.recipient_name,
        'recipientPhone', o.recipient_phone,
        'deliveryAddressText', o.delivery_address_text,
        'deliveryComment', o.delivery_comment,
        'bouquetPhotoUrl', o.bouquet_photo_url,
        'deliveryProofPhotoUrl', o.metadata #>> '{delivery,proofPhotoUrl}',
        'trackingToken', o.tracking_token,
        'trackingUrl', CASE
          WHEN o.tracking_token IS NULL OR o.tracking_token = '' THEN NULL
          ELSE '/order/track/' || o.tracking_token
        END
      ) || CAST(${JSON.stringify(params.extraPayload ?? {})} AS jsonb),
      NOW(),
      NOW()
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${params.orderId}
      AND o.shop_id = ${params.shopId}
      AND o.customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM notification_events existing
        WHERE existing.shop_id = o.shop_id
          AND existing.order_id = o.id
          AND existing.type = ${params.type}
          AND existing.channel = 'telegram'
          AND existing.recipient_type = 'customer'
          AND existing.status IN ('pending', 'processing', 'sent')
      )
  `;
}

async function addOrderOperationalHistory(
  client: any,
  params: {
    shopId: string;
    orderId: string;
    status: string;
    userId: string;
    comment: string;
  }
) {
  await client`
    INSERT INTO order_status_history (
      shop_id,
      order_id,
      from_status,
      to_status,
      changed_by_user_id,
      comment,
      created_at
    )
    VALUES (
      ${params.shopId},
      ${params.orderId},
      ${params.status}::order_status,
      ${params.status}::order_status,
      ${params.userId},
      ${params.comment.slice(0, 1000)},
      NOW()
    )
  `;
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] || request.url;

    if (!path.startsWith("/api/admin/") || path.startsWith("/api/admin/auth/") || request.method === "OPTIONS") {
      return;
    }

    const token = getCookieValue(request.headers.cookie, ADMIN_SESSION_COOKIE);

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const rows = await client<{
        user_id: string;
        shop_id: string;
        role: string;
      }[]>`
        SELECT
          s.user_id,
          s.shop_id,
          su.role::text AS role
        FROM admin_sessions s
        JOIN shops sh ON sh.id = s.shop_id
        JOIN users u ON u.id = s.user_id
        JOIN shop_users su
          ON su.shop_id = s.shop_id
         AND su.user_id = s.user_id
        WHERE s.token = ${token}
          AND sh.slug = ${env.DEFAULT_SHOP_SLUG}
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND su.is_active = true
          AND u.status = 'active'
        LIMIT 1
      `;

      const session = rows[0];

      if (!session || !ALL_ADMIN_ROLES.includes(session.role as AdminRole)) {
        reply.header("Set-Cookie", clearAdminSessionCookie());

        return reply.status(401).send({
          ok: false,
          message: "Сессия CRM истекла"
        });
      }

      const role = session.role as AdminRole;
      const requiredRoles = getRequiredAdminRoles(path, request.method);

      if (!requiredRoles.includes(role)) {
        return reply.status(403).send({
          ok: false,
          message: "Недостаточно прав для этого раздела"
        });
      }

      (request as AdminRequest).adminContext = {
        userId: session.user_id,
        shopId: session.shop_id,
        role
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/auth/login", async (request, reply) => {
    const body = adminLoginSchema.parse(request.body ?? {});
    const login = body.login.trim();
    const loginDigits = normalizePhoneDigits(login);
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const rows = await client<{
        id: string;
        shop_id: string;
        phone: string | null;
        email: string | null;
        name: string | null;
        password_hash: string | null;
        role: string;
      }[]>`
        SELECT
          u.id,
          su.shop_id,
          u.phone,
          u.email,
          u.name,
          u.password_hash,
          su.role
        FROM users u
        JOIN shop_users su ON su.user_id = u.id
        WHERE su.shop_id = ${shop.id}
          AND su.is_active = true
          AND u.status = 'active'
          AND su.role IN ('owner', 'admin', 'manager', 'florist', 'courier')
          AND (
            LOWER(COALESCE(u.email, '')) = LOWER(${login})
            OR COALESCE(u.phone, '') = ${login}
            OR regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') = ${loginDigits}
          )
        ORDER BY
          CASE su.role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'manager' THEN 3
            WHEN 'florist' THEN 4
            WHEN 'courier' THEN 5
            ELSE 10
          END,
          u.created_at ASC
        LIMIT 1
      `;

      const user = rows[0];

      if (!user || !verifyPassword(body.password, user.password_hash)) {
        return reply.status(401).send({
          ok: false,
          message: "Неверный логин или пароль"
        });
      }

      const sessionToken = createAdminSessionToken();

      await client`
        INSERT INTO admin_sessions (
          token,
          shop_id,
          user_id,
          ip,
          user_agent,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (
          ${sessionToken},
          ${shop.id},
          ${user.id},
          ${request.ip || null},
          ${request.headers["user-agent"] || null},
          NOW() + INTERVAL '30 days',
          NOW(),
          NOW()
        )
      `;

      await client`
        UPDATE users
        SET last_login_at = NOW(),
            updated_at = NOW()
        WHERE id = ${user.id}
      `;

      reply.header("Set-Cookie", buildAdminSessionCookie(sessionToken));

      return {
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
          home:
            adminHomeForRole(
              user.role
            )
        }
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/auth/me", async (request, reply) => {
    const token = getCookieValue(request.headers.cookie, ADMIN_SESSION_COOKIE);

    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход"
      });
    }

    const { client } = createDb();

    try {
      const rows = await client<{
        id: string;
        phone: string | null;
        email: string | null;
        name: string | null;
        role: string;
      }[]>`
        SELECT
          u.id,
          u.phone,
          u.email,
          u.name,
          su.role
        FROM admin_sessions s
        JOIN users u ON u.id = s.user_id
        JOIN shop_users su
          ON su.shop_id = s.shop_id
         AND su.user_id = s.user_id
        WHERE s.token = ${token}
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND su.is_active = true
          AND u.status = 'active'
        LIMIT 1
      `;

      const user = rows[0];

      if (!user) {
        reply.header("Set-Cookie", clearAdminSessionCookie());

        return reply.status(401).send({
          ok: false,
          message: "Сессия истекла"
        });
      }

      return {
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
          home:
            adminHomeForRole(
              user.role
            )
        }
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/auth/logout", async (request, reply) => {
    const token = getCookieValue(request.headers.cookie, ADMIN_SESSION_COOKIE);

    if (token) {
      const { client } = createDb();

      try {
        await client`
          UPDATE admin_sessions
          SET revoked_at = NOW(),
              updated_at = NOW()
          WHERE token = ${token}
            AND revoked_at IS NULL
        `;
      } finally {
        await client.end();
      }
    }

    reply.header("Set-Cookie", clearAdminSessionCookie());

    return { ok: true };
  });

  app.get("/api/admin/dashboard", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [
        orderMetricsRows,
        catalogMetricsRows,
        customerMetricsRows,
        statusRows,
        latestOrders,
        lowStockProducts,
        notificationMetricsRows
      ] = await Promise.all([
        client<{
          orders_total: number;
          orders_today: number;
          active_orders: number;
          problem_orders: number;
          pending_payments: number;
          paid_revenue: number;
          paid_revenue_today: number;
          average_check: number;
        }[]>`
          SELECT
            COUNT(*)::int AS orders_total,
            COUNT(*) FILTER (
              WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date
                = (NOW() AT TIME ZONE 'Europe/Moscow')::date
            )::int AS orders_today,
            COUNT(*) FILTER (
              WHERE status NOT IN ('delivered', 'cancelled')
            )::int AS active_orders,
            COUNT(*) FILTER (
              WHERE status = 'problem'
            )::int AS problem_orders,
            COUNT(*) FILTER (
              WHERE payment_status = 'pending'
                AND status <> 'cancelled'
            )::int AS pending_payments,
            COALESCE(
              (
                SELECT SUM(payment.amount)
                FROM payments payment
                WHERE payment.shop_id = ${shop.id}
                  AND payment.status = 'paid'
              ),
              0
            )::bigint AS paid_revenue,
            COALESCE(
              (
                SELECT SUM(payment.amount)
                FROM payments payment
                WHERE payment.shop_id = ${shop.id}
                  AND payment.status = 'paid'
                  AND (payment.paid_at AT TIME ZONE 'Europe/Moscow')::date
                    = (NOW() AT TIME ZONE 'Europe/Moscow')::date
              ),
              0
            )::bigint AS paid_revenue_today,
            COALESCE(
              ROUND(
                AVG(total) FILTER (
                  WHERE payment_status = 'paid'
                )
              ),
              0
            )::bigint AS average_check
          FROM orders
          WHERE shop_id = ${shop.id}
        `,
        client<{
          products_total: number;
          active_products: number;
          low_stock_products: number;
          out_of_stock_products: number;
          categories_total: number;
          delivery_zones_total: number;
        }[]>`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM products
              WHERE shop_id = ${shop.id}
            ) AS products_total,
            (
              SELECT COUNT(*)::int
              FROM products
              WHERE shop_id = ${shop.id}
                AND status = 'active'
            ) AS active_products,
            (
              SELECT COUNT(*)::int
              FROM products
              WHERE shop_id = ${shop.id}
                AND status = 'active'
                AND COALESCE(stock_quantity, 0) BETWEEN 1 AND 3
            ) AS low_stock_products,
            (
              SELECT COUNT(*)::int
              FROM products
              WHERE shop_id = ${shop.id}
                AND status = 'active'
                AND COALESCE(stock_quantity, 0) <= 0
            ) AS out_of_stock_products,
            (
              SELECT COUNT(*)::int
              FROM categories
              WHERE shop_id = ${shop.id}
            ) AS categories_total,
            (
              SELECT COUNT(*)::int
              FROM delivery_zones
              WHERE shop_id = ${shop.id}
                AND is_active = true
            ) AS delivery_zones_total
        `,
        client<{ customers_total: number }[]>`
          SELECT COUNT(*)::int AS customers_total
          FROM customers
          WHERE shop_id = ${shop.id}
        `,
        client<{
          status: string;
          count: number;
        }[]>`
          SELECT
            status::text AS status,
            COUNT(*)::int AS count
          FROM orders
          WHERE shop_id = ${shop.id}
          GROUP BY status
          ORDER BY status
        `,
        client`
          SELECT
            o.id,
            o.order_number,
            o.status,
            o.payment_status,
            o.payment_method,
            o.delivery_type,
            o.delivery_date,
            o.total AS total_amount,
            o.created_at,
            o.metadata,
            COALESCE(NULLIF(o.metadata #>> '{customer,name}', ''), c.name) AS customer_name,
            COALESCE(NULLIF(o.metadata #>> '{customer,phone}', ''), c.phone) AS customer_phone
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.shop_id = ${shop.id}
          ORDER BY
            CASE WHEN o.status = 'problem' THEN 0 ELSE 1 END,
            o.created_at DESC
          LIMIT 10
        `,
        client`
          SELECT
            p.id,
            p.name,
            p.slug,
            p.stock_quantity,
            p.status,
            p.updated_at,
            c.name AS category_name
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.shop_id = ${shop.id}
            AND p.status = 'active'
            AND COALESCE(p.stock_quantity, 0) <= 3
          ORDER BY
            COALESCE(p.stock_quantity, 0) ASC,
            p.updated_at DESC
          LIMIT 8
        `,
        client<{
          pending: number;
          processing: number;
          failed: number;
        }[]>`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM notification_events
          WHERE shop_id = ${shop.id}
            AND created_at > NOW() - INTERVAL '30 days'
        `
      ]);

      const orderMetrics = orderMetricsRows[0] ?? {
        orders_total: 0,
        orders_today: 0,
        active_orders: 0,
        problem_orders: 0,
        pending_payments: 0,
        paid_revenue: 0,
        paid_revenue_today: 0,
        average_check: 0
      };

      const catalogMetrics = catalogMetricsRows[0] ?? {
        products_total: 0,
        active_products: 0,
        low_stock_products: 0,
        out_of_stock_products: 0,
        categories_total: 0,
        delivery_zones_total: 0
      };

      const customerMetrics = customerMetricsRows[0] ?? {
        customers_total: 0
      };

      return {
        shop,
        metrics: {
          orders: numberFromCount(orderMetrics.orders_total),
          ordersToday: numberFromCount(orderMetrics.orders_today),
          activeOrders: numberFromCount(orderMetrics.active_orders),
          problemOrders: numberFromCount(orderMetrics.problem_orders),
          pendingPayments: numberFromCount(orderMetrics.pending_payments),
          paidRevenue: numberFromCount(orderMetrics.paid_revenue),
          paidRevenueToday: numberFromCount(orderMetrics.paid_revenue_today),
          averageCheck: numberFromCount(orderMetrics.average_check),
          products: numberFromCount(catalogMetrics.products_total),
          activeProducts: numberFromCount(catalogMetrics.active_products),
          lowStockProducts: numberFromCount(catalogMetrics.low_stock_products),
          outOfStockProducts: numberFromCount(catalogMetrics.out_of_stock_products),
          customers: numberFromCount(customerMetrics.customers_total),
          categories: numberFromCount(catalogMetrics.categories_total),
          deliveryZones: numberFromCount(catalogMetrics.delivery_zones_total),
          pendingNotifications: numberFromCount(notificationMetricsRows[0]?.pending),
          processingNotifications: numberFromCount(notificationMetricsRows[0]?.processing),
          failedNotifications: numberFromCount(notificationMetricsRows[0]?.failed)
        },
        statusBreakdown: statusRows,
        latestOrders,
        lowStockProducts
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/presence", async (request, reply) => {
    const adminContext =
      (request as AdminRequest)
        .adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message:
          "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const rows =
        await client<{
          id: string;
          name: string | null;
          last_login_at: string;
        }[]>`
          UPDATE users u
          SET
            last_login_at = NOW(),
            updated_at = NOW()
          WHERE u.id =
            ${adminContext.userId}

            AND EXISTS (
              SELECT 1
              FROM shop_users su
              WHERE su.shop_id =
                ${adminContext.shopId}
                AND su.user_id = u.id
                AND su.is_active = true
            )

          RETURNING
            u.id,
            u.name,
            u.last_login_at
        `;

      return {
        ok: true,
        staff:
          rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });

  /* ASSIGNED ORDER ACCESS 7.2.2A */
  app.get("/api/admin/finance", async (request, reply) => {
    const query = z.object({
      q: z.string().trim().max(120).optional().default(""),
      status: z.enum([
        "all",
        "pending",
        "paid",
        "failed",
        "refunded",
        "cancelled"
      ]).optional().default("all"),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.coerce.number().int().min(1).max(10000).optional().default(1)
    }).parse(request.query ?? {});

    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const pageSize = 50;
      const offset = (query.page - 1) * pageSize;
      const statusFilter = query.status === "all" ? null : query.status;
      const search = query.q ? `%${query.q}%` : null;
      const dateFrom = query.dateFrom || null;
      const dateTo = query.dateTo || null;

      const [metricsRows, countRows, paymentRows, debtRows] = await Promise.all([
        client<{
          paid_amount: number;
          paid_count: number;
          refunded_amount: number;
          refunded_count: number;
          pending_amount: number;
          pending_count: number;
          failed_count: number;
        }[]>`
          SELECT
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_amount,
            COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::bigint AS refunded_amount,
            COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_amount,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
          FROM payments
          WHERE shop_id = ${shop.id}
        `,
        client<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM payments p
          JOIN orders o ON o.id = p.order_id AND o.shop_id = p.shop_id
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE p.shop_id = ${shop.id}
            AND (${statusFilter}::text IS NULL OR p.status::text = ${statusFilter})
            AND (${dateFrom}::text IS NULL OR p.created_at >= ${dateFrom}::date)
            AND (${dateTo}::text IS NULL OR p.created_at < (${dateTo}::date + INTERVAL '1 day'))
            AND (
              ${search}::text IS NULL
              OR o.order_number ILIKE ${search}
              OR COALESCE(c.name, '') ILIKE ${search}
              OR COALESCE(c.phone, '') ILIKE ${search}
              OR COALESCE(p.provider_payment_id, '') ILIKE ${search}
            )
        `,
        client`
          SELECT
            p.id,
            p.order_id,
            p.provider,
            p.provider_payment_id,
            p.method,
            p.status,
            p.amount,
            p.currency,
            p.payment_url,
            p.paid_at,
            p.created_at,
            p.updated_at,
            o.order_number,
            o.status AS order_status,
            o.payment_status AS order_payment_status,
            c.name AS customer_name,
            c.phone AS customer_phone,
            p.raw_payload #>> '{reason}' AS refund_reason,
            p.raw_payload #>> '{refundedAt}' AS refunded_at
          FROM payments p
          JOIN orders o ON o.id = p.order_id AND o.shop_id = p.shop_id
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE p.shop_id = ${shop.id}
            AND (${statusFilter}::text IS NULL OR p.status::text = ${statusFilter})
            AND (${dateFrom}::text IS NULL OR p.created_at >= ${dateFrom}::date)
            AND (${dateTo}::text IS NULL OR p.created_at < (${dateTo}::date + INTERVAL '1 day'))
            AND (
              ${search}::text IS NULL
              OR o.order_number ILIKE ${search}
              OR COALESCE(c.name, '') ILIKE ${search}
              OR COALESCE(c.phone, '') ILIKE ${search}
              OR COALESCE(p.provider_payment_id, '') ILIKE ${search}
            )
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        client<{
          customers_with_debt: number;
          total_bonus_debt: number;
        }[]>`
          SELECT
            COUNT(*) FILTER (WHERE bonus_balance < 0)::int AS customers_with_debt,
            COALESCE(SUM(ABS(bonus_balance)) FILTER (WHERE bonus_balance < 0), 0)::bigint AS total_bonus_debt
          FROM customers
          WHERE shop_id = ${shop.id}
        `
      ]);

      const total = Number(countRows[0]?.total || 0);

      return {
        ok: true,
        metrics: {
          ...(metricsRows[0] ?? {
            paid_amount: 0,
            paid_count: 0,
            refunded_amount: 0,
            refunded_count: 0,
            pending_amount: 0,
            pending_count: 0,
            failed_count: 0
          }),
          ...(debtRows[0] ?? {
            customers_with_debt: 0,
            total_bonus_debt: 0
          })
        },
        payments: paymentRows,
        pagination: {
          page: query.page,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize))
        },
        viewer: {
          role: adminContext.role,
          canRefund: OWNER_ADMIN_ROLES.includes(adminContext.role)
        }
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/orders", async (request, reply) => {
    const query = z.object({
      q: z.string().trim().max(120).optional().default(""),
      status: z.enum([
        "all",
        "new",
        "confirmed",
        "assembling",
        "ready",
        "assigned_courier",
        "delivering",
        "delivered",
        "cancelled",
        "problem"
      ]).optional().default("all"),
      payment: z.enum([
        "all",
        "not_required",
        "pending",
        "paid",
        "failed",
        "refunded",
        "cancelled"
      ]).optional().default("all"),
      delivery: z.enum([
        "all",
        "delivery",
        "pickup",
        "express"
      ]).optional().default("all"),
      attention: z.enum([
        "all",
        "active",
        "problem",
        "pending_payment"
      ]).optional().default("all"),
      dateFrom: z.string().trim().max(10).optional().default(""),
      dateTo: z.string().trim().max(10).optional().default(""),
      page: z.coerce.number().int().min(1).max(10000).optional().default(1),
      limit: z.coerce.number().int().min(10).max(100).optional().default(30)
    }).parse(request.query ?? {});

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const dateFrom = datePattern.test(query.dateFrom) ? query.dateFrom : "";
    const dateTo = datePattern.test(query.dateTo) ? query.dateTo : "";
    const offset = (query.page - 1) * query.limit;

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const adminContext =
        (request as AdminRequest)
          .adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message:
            "Требуется вход в CRM"
        });
      }

      if (
        adminContext.shopId
        !== shop.id
      ) {
        return reply.status(403).send({
          ok: false,
          message:
            "Нет доступа к этому магазину"
        });
      }

      const isFieldRole =
        adminContext.role === "florist"
        || adminContext.role === "courier";

      const effectivePayment =
        isFieldRole ? "all" : query.payment;

      const effectiveAttention =
        isFieldRole
          && query.attention === "pending_payment"
          ? "all"
          : query.attention;

      const countRows = await client<{
        filtered_count: number;
      }[]>`
        SELECT COUNT(*)::int AS filtered_count
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.shop_id = ${shop.id}
          AND (
            ${adminContext.role}::text NOT IN ('florist', 'courier')
            OR (
              ${adminContext.role}::text = 'florist'
              AND o.florist_id = ${adminContext.userId}
            )
            OR (
              ${adminContext.role}::text = 'courier'
              AND o.courier_id = ${adminContext.userId}
            )
          )
          AND (
            ${query.q} = ''
            OR o.order_number ILIKE ${`%${query.q}%`}
            OR COALESCE(c.name, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(c.phone, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.recipient_name, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.recipient_phone, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.delivery_address_text, '') ILIKE ${`%${query.q}%`}
          )
          AND (
            ${query.status} = 'all'
            OR o.status::text = ${query.status}
          )
          AND (
            ${effectivePayment} = 'all'
            OR o.payment_status::text = ${effectivePayment}
          )
          AND (
            ${query.delivery} = 'all'
            OR (
              ${query.delivery} IN ('delivery', 'pickup')
              AND o.delivery_type::text = ${query.delivery}
            )
            OR (
              ${query.delivery} = 'express'
              AND LOWER(COALESCE(o.metadata #>> '{delivery,isExpress}', 'false')) = 'true'
            )
          )
          AND (
            ${effectiveAttention} = 'all'
            OR (
              ${effectiveAttention} = 'active'
              AND o.status NOT IN ('delivered', 'cancelled')
            )
            OR (
              ${effectiveAttention} = 'problem'
              AND o.status = 'problem'
            )
            OR (
              ${effectiveAttention} = 'pending_payment'
              AND o.payment_status = 'pending'
              AND o.status <> 'cancelled'
            )
          )
          AND (
            ${dateFrom} = ''
            OR o.created_at >= NULLIF(${dateFrom}, '')::date
          )
          AND (
            ${dateTo} = ''
            OR o.created_at < (NULLIF(${dateTo}, '')::date + INTERVAL '1 day')
          )
      `;

      const summaryRows = await client<{
        total: number;
        active: number;
        new_orders: number;
        problem: number;
        pending_payment: number;
        delivered_today: number;
      }[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE o.status NOT IN ('delivered', 'cancelled')
          )::int AS active,
          COUNT(*) FILTER (
            WHERE o.status = 'new'
          )::int AS new_orders,
          COUNT(*) FILTER (
            WHERE o.status = 'problem'
          )::int AS problem,
          COUNT(*) FILTER (
            WHERE o.payment_status = 'pending'
              AND o.status <> 'cancelled'
          )::int AS pending_payment,
          COUNT(*) FILTER (
            WHERE o.status = 'delivered'
              AND (o.delivered_at AT TIME ZONE 'Europe/Moscow')::date
                = (NOW() AT TIME ZONE 'Europe/Moscow')::date
          )::int AS delivered_today
        FROM orders o
        WHERE o.shop_id = ${shop.id}
          AND (
            ${adminContext.role}::text NOT IN ('florist', 'courier')
            OR (
              ${adminContext.role}::text = 'florist'
              AND o.florist_id = ${adminContext.userId}
            )
            OR (
              ${adminContext.role}::text = 'courier'
              AND o.courier_id = ${adminContext.userId}
            )
          )
      `;

      const items = await client`
        SELECT
          o.*,
          COALESCE(NULLIF(o.metadata #>> '{customer,phone}', ''), c.phone) AS customer_phone,
          COALESCE(NULLIF(o.metadata #>> '{customer,name}', ''), c.name) AS customer_name,
          o.total AS total_amount,
          p.payment_url AS payment_url,
          COALESCE(ic.messages_count, 0) AS internal_chat_messages_count,
          COALESCE(ic.unread_count, 0) AS internal_chat_unread_count,
          ic.last_message AS internal_chat_last_message,
          ic.last_at AS internal_chat_last_at
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN LATERAL (
          SELECT payment_url
          FROM payments
          WHERE order_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS messages_count,
            COUNT(*) FILTER (WHERE cm.is_read_by_staff = false)::int AS unread_count,
            (ARRAY_AGG(cm.text ORDER BY cm.created_at DESC))[1] AS last_message,
            MAX(cm.created_at) AS last_at
          FROM chat_messages cm
          WHERE cm.order_id = o.id
            AND cm.message_scope = 'internal'
        ) ic ON true
        WHERE o.shop_id = ${shop.id}
          AND (
            ${adminContext.role}::text NOT IN ('florist', 'courier')
            OR (
              ${adminContext.role}::text = 'florist'
              AND o.florist_id = ${adminContext.userId}
            )
            OR (
              ${adminContext.role}::text = 'courier'
              AND o.courier_id = ${adminContext.userId}
            )
          )
          AND (
            ${query.q} = ''
            OR o.order_number ILIKE ${`%${query.q}%`}
            OR COALESCE(c.name, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(c.phone, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.recipient_name, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.recipient_phone, '') ILIKE ${`%${query.q}%`}
            OR COALESCE(o.delivery_address_text, '') ILIKE ${`%${query.q}%`}
          )
          AND (
            ${query.status} = 'all'
            OR o.status::text = ${query.status}
          )
          AND (
            ${effectivePayment} = 'all'
            OR o.payment_status::text = ${effectivePayment}
          )
          AND (
            ${query.delivery} = 'all'
            OR (
              ${query.delivery} IN ('delivery', 'pickup')
              AND o.delivery_type::text = ${query.delivery}
            )
            OR (
              ${query.delivery} = 'express'
              AND LOWER(COALESCE(o.metadata #>> '{delivery,isExpress}', 'false')) = 'true'
            )
          )
          AND (
            ${effectiveAttention} = 'all'
            OR (
              ${effectiveAttention} = 'active'
              AND o.status NOT IN ('delivered', 'cancelled')
            )
            OR (
              ${effectiveAttention} = 'problem'
              AND o.status = 'problem'
            )
            OR (
              ${effectiveAttention} = 'pending_payment'
              AND o.payment_status = 'pending'
              AND o.status <> 'cancelled'
            )
          )
          AND (
            ${dateFrom} = ''
            OR o.created_at >= NULLIF(${dateFrom}, '')::date
          )
          AND (
            ${dateTo} = ''
            OR o.created_at < (NULLIF(${dateTo}, '')::date + INTERVAL '1 day')
          )
        ORDER BY
          CASE
            WHEN o.status = 'problem' THEN 0
            WHEN LOWER(COALESCE(o.metadata #>> '{delivery,isExpress}', 'false')) = 'true'
              AND o.status NOT IN ('delivered', 'cancelled') THEN 1
            ELSE 2
          END,
          o.created_at DESC
        LIMIT ${query.limit}
        OFFSET ${offset}
      `;

      const visibleItems =
        isFieldRole
          ? items.map((rawItem) => {
              const item = rawItem as Record<string, unknown>;

              return {
                ...item,

                customer_name:
                  adminContext.role === "courier"
                    ? item.recipient_name ?? null
                    : null,

                customer_phone:
                  adminContext.role === "courier"
                    ? item.recipient_phone ?? null
                    : null,

                customer_email: null,
                subtotal: null,
                discount_amount: null,
                delivery_price: null,
                total: null,
                total_amount: null,
                payment_status: null,
                payment_method: null,
                payment_url: null,
                tracking_token: null
              };
            })
          : items;

      const filteredCount = numberFromCount(
        countRows[0]?.filtered_count
      );
      const totalPages = Math.max(
        1,
        Math.ceil(filteredCount / query.limit)
      );

      const rawSummary = summaryRows[0] ?? {
        total: 0,
        active: 0,
        new_orders: 0,
        problem: 0,
        pending_payment: 0,
        delivered_today: 0
      };

      const visibleSummary = isFieldRole
        ? {
            ...rawSummary,
            pending_payment: 0
          }
        : rawSummary;

      return {
        shop,
        items: visibleItems,
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems: filteredCount,
          totalPages
        },
        filters: {
          q: query.q,
          status: query.status,
          payment: query.payment,
          delivery: query.delivery,
          attention: query.attention,
          dateFrom,
          dateTo
        },
        summary: visibleSummary,
        viewer: {
          userId: adminContext.userId,
          role: adminContext.role,
          scope:
            adminContext.role === "florist"
              ? "assigned_florist"
              : adminContext.role === "courier"
                ? "assigned_courier"
                : "all_orders"
        }
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/orders/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const adminContext =
        (request as AdminRequest)
          .adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message:
            "Требуется вход в CRM"
        });
      }

      if (
        adminContext.shopId
        !== shop.id
      ) {
        return reply.status(403).send({
          ok: false,
          message:
            "Нет доступа к этому магазину"
        });
      }

      const orderRows = await client`
        SELECT
          o.*,
          COALESCE(NULLIF(o.metadata #>> '{customer,phone}', ''), c.phone) AS customer_phone,
          COALESCE(NULLIF(o.metadata #>> '{customer,name}', ''), c.name) AS customer_name,
          COALESCE(NULLIF(o.metadata #>> '{customer,email}', ''), c.email) AS customer_email,
          di.name AS delivery_interval_name,
          dz.name AS delivery_zone_current_name,
          manager_user.name AS manager_name,
          florist_user.name AS florist_name,
          courier_user.name AS courier_name,
          p.payment_url AS payment_url,
          p.status AS latest_payment_status,
          p.method AS latest_payment_method,
          p.provider AS latest_payment_provider,
          p.created_at AS latest_payment_created_at,
          p.paid_at AS latest_payment_paid_at
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN delivery_intervals di
          ON di.id = o.delivery_interval_id
         AND di.shop_id = o.shop_id
        LEFT JOIN delivery_zones dz
          ON dz.id = o.delivery_zone_id
         AND dz.shop_id = o.shop_id
        LEFT JOIN users manager_user ON manager_user.id = o.manager_id
        LEFT JOIN users florist_user ON florist_user.id = o.florist_id
        LEFT JOIN users courier_user ON courier_user.id = o.courier_id
        LEFT JOIN LATERAL (
          SELECT provider, method, status, payment_url, created_at, paid_at
          FROM payments
          WHERE order_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) p ON true
        WHERE o.shop_id = ${shop.id}
          AND o.id = ${params.id}
          AND (
            ${adminContext.role}::text
              NOT IN (
                'florist',
                'courier'
              )

            OR (
              ${adminContext.role}::text
                = 'florist'
              AND o.florist_id =
                ${adminContext.userId}
            )

            OR (
              ${adminContext.role}::text
                = 'courier'
              AND o.courier_id =
                ${adminContext.userId}
            )
          )
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const chatSummaryRows = await client<{
        internal_chat_messages_count: number;
        internal_chat_unread_count: number;
        internal_chat_last_message: string | null;
        internal_chat_last_at: string | null;
      }[]>`
        SELECT
          COUNT(*)::int AS internal_chat_messages_count,
          COUNT(*) FILTER (
            WHERE is_read_by_staff = false
          )::int AS internal_chat_unread_count,
          (
            ARRAY_AGG(
              text
              ORDER BY created_at DESC
            )
          )[1] AS internal_chat_last_message,
          MAX(created_at) AS internal_chat_last_at
        FROM chat_messages
        WHERE shop_id = ${shop.id}
          AND order_id = ${params.id}
          AND message_scope = 'internal'
      `;

      const chatSummary = chatSummaryRows[0] ?? {
        internal_chat_messages_count: 0,
        internal_chat_unread_count: 0,
        internal_chat_last_message: null,
        internal_chat_last_at: null
      };

      const problemReturnRows = await client<{
        problem_return_status: string | null;
      }[]>`
        SELECT from_status::text AS problem_return_status
        FROM order_status_history
        WHERE shop_id = ${shop.id}
          AND order_id = ${params.id}
          AND to_status = 'problem'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const problemReturnStatus =
        problemReturnRows[0]?.problem_return_status ?? null;

      const orderWithChat = {
        ...order,
        ...chatSummary,
        problem_return_status: problemReturnStatus
      };

      /*
       * ROLE ORDER DETAIL DATA 7.2.2B-3A
       *
       * Полевые роли получают только данные,
       * необходимые для своей рабочей задачи.
       */
      const isFieldRole =
        adminContext.role === "florist"
        || adminContext.role === "courier";

      const orderRecord =
        orderWithChat as Record<string, unknown>;

      const visibleOrder =
        isFieldRole
          ? {
              ...orderRecord,

              customer_name: null,
              customer_phone: null,
              customer_email: null,

              recipient_name:
                adminContext.role === "courier"
                  ? orderRecord.recipient_name ?? null
                  : null,

              recipient_phone:
                adminContext.role === "courier"
                  ? orderRecord.recipient_phone ?? null
                  : null,

              delivery_address_text:
                adminContext.role === "courier"
                  ? orderRecord.delivery_address_text ?? null
                  : null,

              subtotal: null,
              delivery_price: null,
              delivery_cost: null,
              discount_total: null,
              discount_amount: null,
              promo_discount: null,
              bonus_discount: null,
              bonus_spent: null,
              total: null,
              total_amount: null,

              payment_status: null,
              payment_method: null,
              payment_url: null,
              latest_payment_status: null,
              latest_payment_method: null,
              latest_payment_provider: null,
              latest_payment_created_at: null,
              latest_payment_paid_at: null,

              tracking_token: null,
              internal_comment: null,

              manager_id: null,
              florist_id: null,
              courier_id: null
            }
          : orderWithChat;

      const items = await client`
        SELECT
          oi.product_id,
          oi.product_name,
          oi.quantity,
          oi.price,
          oi.total,
          oi.created_at,
          pi.url AS image_url
        FROM order_items oi
        LEFT JOIN LATERAL (
          SELECT url
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND product_id = oi.product_id
          ORDER BY is_main DESC, sort_order ASC, created_at ASC
          LIMIT 1
        ) pi ON true
        WHERE oi.order_id = ${params.id}
        ORDER BY oi.created_at ASC
      `;

      const visibleItems =
        isFieldRole
          ? items.map((rawItem) => {
              const item = rawItem as Record<string, unknown>;

              return {
                ...item,
                price: null,
                total: null
              };
            })
          : items;

      const history = await client`
        SELECT
          h.id,
          h.from_status,
          h.to_status,
          h.changed_by_user_id,
          u.name AS changed_by_name,
          h.comment,
          h.created_at
        FROM order_status_history h
        LEFT JOIN users u
          ON u.id = h.changed_by_user_id
        WHERE h.shop_id = ${shop.id}
          AND h.order_id = ${params.id}
        ORDER BY h.created_at DESC
        LIMIT 50
      `;

      const payments =
        isFieldRole
          ? []
          : await client`
              SELECT
                id,
                provider,
                provider_payment_id,
                method,
                status,
                amount,
                currency,
                payment_url,
                raw_payload,
                paid_at,
                created_at,
                updated_at
              FROM payments
              WHERE shop_id = ${shop.id}
                AND order_id = ${params.id}
              ORDER BY created_at DESC, id DESC
              LIMIT 30
            `;

      const staff =
        MANAGEMENT_ROLES.includes(
          adminContext.role
        )
          ? await client`
        SELECT
          su.user_id,
          su.role,
          su.is_active,
          u.name,
          u.phone,
          u.email,
          ta.telegram_id AS telegram_id,
          ta.username AS telegram_username
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        LEFT JOIN LATERAL (
          SELECT telegram_id, username
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        ) ta ON true
        WHERE su.shop_id = ${shop.id}
          AND su.is_active = true
          AND su.role IN ('manager', 'florist', 'courier')
        ORDER BY
          CASE su.role
            WHEN 'manager' THEN 1
            WHEN 'florist' THEN 2
            WHEN 'courier' THEN 3
            ELSE 99
          END,
          u.name ASC NULLS LAST
      `
          : [];

      const currentDeliveryZoneId =
        typeof orderRecord.delivery_zone_id === "string"
          ? orderRecord.delivery_zone_id
          : null;

      const currentDeliveryIntervalId =
        typeof orderRecord.delivery_interval_id === "string"
          ? orderRecord.delivery_interval_id
          : null;

      const deliveryOptions =
        MANAGEMENT_ROLES.includes(
          adminContext.role
        )
          ? {
              zones: await client`
                SELECT
                  id,
                  name,
                  price,
                  free_from_amount,
                  is_express_available,
                  express_price,
                  is_active
                FROM delivery_zones
                WHERE shop_id = ${shop.id}
                  AND LOWER(BTRIM(name)) <> 'самовывоз'
                  AND (
                    is_active = true
                    OR id = ${currentDeliveryZoneId}
                  )
                ORDER BY is_active DESC, sort_order ASC, name ASC
              `,
              intervals: await client`
                SELECT
                  id,
                  name,
                  starts_at,
                  ends_at,
                  is_active
                FROM delivery_intervals
                WHERE shop_id = ${shop.id}
                  AND (
                    is_active = true
                    OR id = ${currentDeliveryIntervalId}
                  )
                ORDER BY is_active DESC, sort_order ASC, starts_at ASC
              `,
              settings: (await client`
                SELECT
                  CASE
                    WHEN jsonb_typeof(settings #> '{delivery,pickupEnabled}') = 'boolean'
                    THEN (settings #>> '{delivery,pickupEnabled}')::boolean
                    ELSE true
                  END AS pickup_enabled,
                  COALESCE(settings #>> '{delivery,pickupAddress}', '') AS pickup_address
                FROM shop_settings
                WHERE shop_id = ${shop.id}
                LIMIT 1
              `)[0] ?? {
                pickup_enabled: true,
                pickup_address: ''
              }
            }
          : {
              zones: [],
              intervals: [],
              settings: {
                pickup_enabled: false,
                pickup_address: ''
              }
            };

      return {
        ok: true,
        order: visibleOrder,
        items: visibleItems,
        history,
        payments,
        staff,
        deliveryOptions,
        viewer: {
          userId:
            adminContext.userId,
          role:
            adminContext.role,
          canManage:
            MANAGEMENT_ROLES.includes(
              adminContext.role
            ),
          canChangeStatus:
            true,
          canUseInternalChat:
            true,
          canRefund:
            OWNER_ADMIN_ROLES.includes(
              adminContext.role
            )
        }
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/orders/:id/internal-comment", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = orderInternalCommentSchema.parse(request.body ?? {});
    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const internalComment = body.internalComment.trim() || null;

      const result = await client.begin(async (transaction) => {
        const currentRows = await transaction<{
          id: string;
          order_number: string;
          status: string;
          internal_comment: string | null;
        }[]>`
          SELECT id, order_number, status::text AS status, internal_comment
          FROM orders
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
          FOR UPDATE
        `;

        const current = currentRows[0];

        if (!current) {
          throw new HttpError(404, "Заказ не найден");
        }

        if ((current.internal_comment || "") === (internalComment || "")) {
          return { changed: false, order: current };
        }

        const updatedRows = await transaction`
          UPDATE orders
          SET internal_comment = ${internalComment},
              updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${current.id}
          RETURNING id, order_number, internal_comment, updated_at
        `;

        await addOrderOperationalHistory(transaction, {
          shopId: shop.id,
          orderId: current.id,
          status: current.status,
          userId: adminContext.userId,
          comment: internalComment
            ? "Обновлён внутренний комментарий заказа"
            : "Внутренний комментарий заказа очищен"
        });

        return { changed: true, order: updatedRows[0] };
      });

      return {
        ok: true,
        changed: result.changed,
        order: result.order
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/orders/:id/assignees", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = orderAssigneesSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const managerId = body.managerId.trim() || null;
      const floristId = body.floristId.trim() || null;
      const courierId = body.courierId.trim() || null;

      const adminContext = (request as AdminRequest).adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход в CRM"
        });
      }

      const assignmentResult = await client.begin(async (transaction) => {
        const orderRows = await transaction<{
          id: string;
          order_number: string;
          manager_id: string | null;
          florist_id: string | null;
          courier_id: string | null;
          status: string;
          total: number | null;
          delivery_date: string | null;
          delivery_address_text: string | null;
          delivery_comment: string | null;
          recipient_name: string | null;
          recipient_phone: string | null;
          delivery_interval_name: string | null;
          tracking_token: string | null;
        }[]>`
          SELECT
            o.id,
            o.order_number,
            o.manager_id,
            o.florist_id,
            o.courier_id,
            o.status::text AS status,
            o.total,
            o.delivery_date,
            o.delivery_address_text,
            o.delivery_comment,
            o.recipient_name,
            o.recipient_phone,
            di.name AS delivery_interval_name,
            o.tracking_token
          FROM orders o
          LEFT JOIN delivery_intervals di
            ON di.id = o.delivery_interval_id
           AND di.shop_id = o.shop_id
          WHERE o.shop_id = ${shop.id}
            AND o.id = ${params.id}
          LIMIT 1
          FOR UPDATE OF o
        `;

        const order = orderRows[0];

        if (!order) {
          throw new HttpError(404, "Заказ не найден");
        }

        async function ensureAssignee(
          userId: string | null,
          role: "manager" | "florist" | "courier",
          label: string
        ) {
          if (!userId) return;

          const rows = await transaction<{ id: string }[]>`
            SELECT su.id
            FROM shop_users su
            WHERE su.shop_id = ${shop.id}
              AND su.user_id = ${userId}
              AND su.role = ${role}::shop_user_role
              AND su.is_active = true
            LIMIT 1
          `;

          if (!rows[0]) {
            throw new HttpError(400, `${label} не найден или не активен`);
          }
        }

        await ensureAssignee(managerId, "manager", "Менеджер");
        await ensureAssignee(floristId, "florist", "Флорист");
        await ensureAssignee(courierId, "courier", "Курьер");

        const assignmentsChanged =
          managerId !== order.manager_id
          || floristId !== order.florist_id
          || courierId !== order.courier_id;

        if (!assignmentsChanged) {
          return {
            order,
            changed: false,
            updatedOrder: {
              id: order.id,
              manager_id: order.manager_id,
              florist_id: order.florist_id,
              courier_id: order.courier_id
            }
          };
        }

        const updatedRows = await transaction`
          UPDATE orders
          SET manager_id = ${managerId},
              florist_id = ${floristId},
              courier_id = ${courierId},
              updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${order.id}
          RETURNING id, manager_id, florist_id, courier_id, updated_at
        `;

        const changedParts = [
          managerId !== order.manager_id ? "менеджер" : "",
          floristId !== order.florist_id ? "флорист" : "",
          courierId !== order.courier_id ? "курьер" : ""
        ].filter(Boolean);

        await addOrderOperationalHistory(transaction, {
          shopId: shop.id,
          orderId: order.id,
          status: order.status,
          userId: adminContext.userId,
          comment: `Обновлены ответственные: ${changedParts.join(", ")}`
        });

        return {
          order,
          changed: true,
          updatedOrder: updatedRows[0]
        };
      });

      const order = assignmentResult.order;

      if (floristId && floristId !== order.florist_id) {
        const floristRows = await client<{ telegram_id: string; name: string | null }[]>`
          SELECT ta.telegram_id, u.name
          FROM shop_users su
          JOIN users u ON u.id = su.user_id
          JOIN telegram_accounts ta
            ON ta.shop_id = su.shop_id
           AND ta.user_id = su.user_id
           AND ta.is_active = true
          WHERE su.shop_id = ${shop.id}
            AND su.user_id = ${floristId}
            AND su.role = 'florist'
            AND su.is_active = true
          ORDER BY ta.linked_at DESC
          LIMIT 1
        `;

        const florist = floristRows[0];

        if (florist?.telegram_id) {
          const itemRows = await client<{
            product_name: string | null;
            product_image_url: string | null;
          }[]>`
            SELECT
              oi.product_name,
              pi.url AS product_image_url
            FROM order_items oi
            LEFT JOIN LATERAL (
              SELECT url
              FROM product_images
              WHERE product_id = oi.product_id
                AND shop_id = ${shop.id}
              ORDER BY is_main DESC, sort_order ASC, created_at ASC
              LIMIT 1
            ) pi ON true
            WHERE oi.order_id = ${order.id}
            ORDER BY oi.created_at ASC
            LIMIT 1
          `;

          const firstItem = itemRows[0];

          const notificationPayload = {
            orderId: order.id,
            orderNumber: order.order_number,
            floristId,
            floristName: florist.name,
            productName: firstItem?.product_name ?? null,
            productImageUrl: firstItem?.product_image_url ?? null,
            deliveryDate: order.delivery_date,
            trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
            crmUrl: `/admin/orders/${order.id}`
          };

          await client`
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
            VALUES (
              ${shop.id},
              ${order.id},
              'florist_order_assigned',
              'telegram',
              'staff',
              ${florist.telegram_id},
              'pending',
              CAST(${JSON.stringify(notificationPayload)} AS jsonb),
              NOW(),
              NOW()
            )
          `;
        }
      }

      if (courierId && courierId !== order.courier_id) {
        const courierRows = await client<{ telegram_id: string; name: string | null }[]>`
          SELECT ta.telegram_id, u.name
          FROM shop_users su
          JOIN users u ON u.id = su.user_id
          JOIN telegram_accounts ta
            ON ta.shop_id = su.shop_id
           AND ta.user_id = su.user_id
           AND ta.is_active = true
          WHERE su.shop_id = ${shop.id}
            AND su.user_id = ${courierId}
            AND su.role = 'courier'
            AND su.is_active = true
          ORDER BY ta.linked_at DESC
          LIMIT 1
        `;

        const courier = courierRows[0];

        if (courier?.telegram_id) {
          const notificationPayload = {
            orderId: order.id,
            orderNumber: order.order_number,
            courierId,
            courierName: courier.name,
            deliveryDate: order.delivery_date,
            deliveryIntervalName: order.delivery_interval_name,
            deliveryAddressText: order.delivery_address_text,
            deliveryComment: order.delivery_comment,
            recipientName: order.recipient_name,
            recipientPhone: order.recipient_phone,
            trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
            crmUrl: `/admin/orders/${order.id}`
          };

          await client`
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
            VALUES (
              ${shop.id},
              ${order.id},
              'courier_order_assigned',
              'telegram',
              'staff',
              ${courier.telegram_id},
              'pending',
              CAST(${JSON.stringify(notificationPayload)} AS jsonb),
              NOW(),
              NOW()
            )
          `;
        }
      }

      return {
        ok: true,
        changed: assignmentResult.changed,
        order: assignmentResult.updatedOrder ?? null
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/orders/:id/operations", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = orderOperationsSchema.parse(request.body ?? {});
    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const result = await client.begin(async (transaction) => {
        const orderRows = await transaction<{
          id: string;
          customer_id: string | null;
          order_number: string;
          courier_id: string | null;
          tracking_token: string | null;
          status: string;
          payment_status: string;
          delivery_type: string;
          delivery_zone_id: string | null;
          delivery_interval_id: string | null;
          delivery_date_value: string | null;
          delivery_address_text: string | null;
          delivery_comment: string | null;
          recipient_name: string | null;
          recipient_phone: string | null;
          customer_comment: string | null;
          contact_preference: string;
          subtotal: number;
          discount_total: number;
          delivery_price: number;
          bonus_spent: number;
          total: number;
          metadata: Record<string, unknown> | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
        }[]>`
          SELECT
            o.id,
            o.customer_id,
            o.order_number,
            o.courier_id,
            o.tracking_token,
            o.status::text AS status,
            o.payment_status::text AS payment_status,
            o.delivery_type::text AS delivery_type,
            o.delivery_zone_id,
            o.delivery_interval_id,
            o.delivery_date::date::text AS delivery_date_value,
            o.delivery_address_text,
            o.delivery_comment,
            o.recipient_name,
            o.recipient_phone,
            o.customer_comment,
            o.contact_preference,
            o.subtotal,
            o.discount_total,
            o.delivery_price,
            o.bonus_spent,
            o.total,
            o.metadata,
            COALESCE(NULLIF(o.metadata #>> '{customer,name}', ''), c.name) AS customer_name,
            COALESCE(NULLIF(o.metadata #>> '{customer,phone}', ''), c.phone) AS customer_phone,
            COALESCE(NULLIF(o.metadata #>> '{customer,email}', ''), c.email) AS customer_email
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.shop_id = ${shop.id}
            AND o.id = ${params.id}
          LIMIT 1
          FOR UPDATE OF o
        `;

        const order = orderRows[0];

        if (!order) {
          throw new HttpError(404, "Заказ не найден");
        }

        if (["delivered", "cancelled"].includes(order.status)) {
          throw new HttpError(409, "Завершённый заказ нельзя редактировать");
        }

        const normalizedCustomerPhone = normalizeContactPhone(body.customerPhone);
        const normalizedRecipientPhone = normalizeContactPhone(body.recipientPhone);

        let deliveryZoneId: string | null = null;
        let deliveryIntervalId: string | null = null;
        let deliveryDate: string | null = null;
        let deliveryAddress: string | null = null;
        let deliveryPrice = 0;
        let deliveryTariffName = "Самовывоз";
        let deliveryZoneName: string | null = null;
        let deliveryIntervalName: string | null = null;
        let deliveryIsExpress = false;
        let deliveryFreeThresholdApplied = false;
        let deliveryBasePrice = 0;
        let deliveryExpressPrice = 0;
        let deliveryFreeFromAmount = 0;

        if (body.deliveryType === "pickup") {
          const settingsRows = await transaction<{
            pickup_enabled: boolean;
            pickup_address: string;
          }[]>`
            SELECT
              CASE
                WHEN jsonb_typeof(settings #> '{delivery,pickupEnabled}') = 'boolean'
                THEN (settings #>> '{delivery,pickupEnabled}')::boolean
                ELSE true
              END AS pickup_enabled,
              COALESCE(settings #>> '{delivery,pickupAddress}', '') AS pickup_address
            FROM shop_settings
            WHERE shop_id = ${shop.id}
            LIMIT 1
          `;

          const pickup = settingsRows[0] ?? {
            pickup_enabled: true,
            pickup_address: ""
          };

          if (!pickup.pickup_enabled) {
            throw new HttpError(400, "Самовывоз сейчас отключён в настройках магазина");
          }

          deliveryAddress = pickup.pickup_address.trim() || null;
        } else {
          if (!body.deliveryZoneId) {
            throw new HttpError(400, "Выберите зону доставки");
          }

          if (!body.deliveryIntervalId) {
            throw new HttpError(400, "Выберите интервал доставки");
          }

          if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate)) {
            throw new HttpError(400, "Укажите дату доставки");
          }

          if (body.deliveryAddress.length < 5) {
            throw new HttpError(400, "Укажите полный адрес доставки");
          }

          const dateRows = await transaction<{
            is_past: boolean;
            is_too_far: boolean;
          }[]>`
            SELECT
              ${body.deliveryDate}::date < (NOW() AT TIME ZONE 'Europe/Moscow')::date AS is_past,
              ${body.deliveryDate}::date > (NOW() AT TIME ZONE 'Europe/Moscow')::date + 90 AS is_too_far
          `;

          if (dateRows[0]?.is_past) {
            throw new HttpError(400, "Дата доставки не может быть в прошлом");
          }

          if (dateRows[0]?.is_too_far) {
            throw new HttpError(400, "Дату доставки можно выбрать не более чем на 90 дней вперёд");
          }

          const zoneRows = await transaction<{
            id: string;
            name: string;
            price: number;
            free_from_amount: number | null;
            is_express_available: boolean;
            express_price: number | null;
          }[]>`
            SELECT id, name, price, free_from_amount, is_express_available, express_price
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND id = ${body.deliveryZoneId}
              AND (
                is_active = true
                OR id = ${order.delivery_zone_id}
              )
              AND LOWER(BTRIM(name)) <> 'самовывоз'
            LIMIT 1
          `;

          const zone = zoneRows[0];

          if (!zone) {
            throw new HttpError(400, "Выбранная зона доставки недоступна");
          }

          const intervalRows = await transaction<{
            id: string;
            name: string;
          }[]>`
            SELECT id, name
            FROM delivery_intervals
            WHERE shop_id = ${shop.id}
              AND id = ${body.deliveryIntervalId}
              AND (
                is_active = true
                OR id = ${order.delivery_interval_id}
              )
            LIMIT 1
          `;

          const interval = intervalRows[0];

          if (!interval) {
            throw new HttpError(400, "Выбранный интервал доставки недоступен");
          }

          deliveryZoneId = zone.id;
          deliveryIntervalId = interval.id;
          deliveryDate = body.deliveryDate;
          deliveryAddress = body.deliveryAddress;
          deliveryZoneName = zone.name;
          deliveryIntervalName = interval.name;
          deliveryBasePrice = Math.max(0, Number(zone.price || 0));
          deliveryExpressPrice = Math.max(0, Number(zone.express_price || 0));
          deliveryFreeFromAmount = Math.max(0, Number(zone.free_from_amount || 0));
          deliveryIsExpress = body.deliveryService === "express";

          if (deliveryIsExpress) {
            if (!zone.is_express_available || deliveryExpressPrice <= 0) {
              throw new HttpError(400, "Срочная доставка недоступна для выбранной зоны");
            }

            deliveryPrice = deliveryExpressPrice;
            deliveryTariffName = "Срочная доставка";
          } else if (
            deliveryFreeFromAmount > 0
            && Number(order.subtotal || 0) >= deliveryFreeFromAmount
          ) {
            deliveryPrice = 0;
            deliveryTariffName = "Бесплатная доставка";
            deliveryFreeThresholdApplied = true;
          } else {
            deliveryPrice = deliveryBasePrice;
            deliveryTariffName = zone.name;
          }
        }

        const nextTotal = Math.max(
          0,
          Number(order.subtotal || 0)
          - Number(order.discount_total || 0)
          - Number(order.bonus_spent || 0)
          + deliveryPrice
        );

        if (order.payment_status === "paid" && nextTotal !== Number(order.total || 0)) {
          throw new HttpError(409, "Нельзя изменить итоговую сумму уже оплаченного заказа");
        }

        const existingMetadata =
          order.metadata && typeof order.metadata === "object"
            ? order.metadata
            : {};

        const existingCustomer =
          existingMetadata.customer
          && typeof existingMetadata.customer === "object"
          && !Array.isArray(existingMetadata.customer)
            ? existingMetadata.customer as Record<string, unknown>
            : {};

        const existingRecipient =
          existingMetadata.recipient
          && typeof existingMetadata.recipient === "object"
          && !Array.isArray(existingMetadata.recipient)
            ? existingMetadata.recipient as Record<string, unknown>
            : {};

        const existingDelivery =
          existingMetadata.delivery
          && typeof existingMetadata.delivery === "object"
          && !Array.isArray(existingMetadata.delivery)
            ? existingMetadata.delivery as Record<string, unknown>
            : {};

        const customerPhoneDigits = normalizePhoneDigits(normalizedCustomerPhone);
        const recipientPhoneDigits = normalizePhoneDigits(normalizedRecipientPhone);
        const sameAsCustomer =
          body.customerName.trim().toLowerCase() === body.recipientName.trim().toLowerCase()
          && customerPhoneDigits === recipientPhoneDigits;

        const customerMetadata = {
          ...existingCustomer,
          name: body.customerName,
          phone: normalizedCustomerPhone,
          email: body.customerEmail || null,
          contactPreference: body.contactPreference
        };

        const recipientMetadata = {
          ...existingRecipient,
          sameAsCustomer,
          isSurprise: body.isSurprise,
          doNotCall: body.doNotCallRecipient,
          cardText: body.cardText || null
        };

        const nextDeliveryService = body.deliveryType === "pickup"
          ? "pickup"
          : deliveryIsExpress
            ? "express"
            : "standard";

        const existingDeliveryService =
          typeof existingDelivery.service === "string"
            ? existingDelivery.service
            : order.delivery_type === "pickup"
              ? "pickup"
              : existingDelivery.isExpress === true
                ? "express"
                : "standard";

        const deliveryMetadata = {
          calculationVersion: 3,
          service: nextDeliveryService,
          isExpress: deliveryIsExpress,
          tariffName: deliveryTariffName,
          zoneId: deliveryZoneId,
          zoneName: deliveryZoneName,
          intervalId: deliveryIntervalId,
          intervalName: deliveryIntervalName,
          date: deliveryDate,
          address: deliveryAddress,
          courierComment: body.deliveryComment || null,
          basePrice: deliveryBasePrice,
          expressPrice: deliveryExpressPrice,
          freeFromAmount: deliveryFreeFromAmount,
          freeThresholdApplied: deliveryFreeThresholdApplied,
          appliedPrice: deliveryPrice,
          calculatedFromSubtotal: Number(order.subtotal || 0),
          updatedByUserId: adminContext.userId,
          updatedAt: new Date().toISOString()
        };

        const changedParts: string[] = [];

        if (
          body.customerName !== String(order.customer_name || "")
          || normalizedCustomerPhone !== String(order.customer_phone || "")
          || body.customerEmail !== String(order.customer_email || "")
        ) changedParts.push("контакты покупателя");

        if (
          body.recipientName !== String(order.recipient_name || "")
          || normalizedRecipientPhone !== String(order.recipient_phone || "")
          || JSON.stringify(recipientMetadata) !== JSON.stringify(existingRecipient)
        ) changedParts.push("получатель");

        if (
          body.deliveryType !== order.delivery_type
          || deliveryZoneId !== order.delivery_zone_id
          || deliveryIntervalId !== order.delivery_interval_id
          || deliveryDate !== order.delivery_date_value
          || (deliveryAddress || "") !== (order.delivery_address_text || "")
          || body.deliveryComment !== (order.delivery_comment || "")
          || deliveryPrice !== Number(order.delivery_price || 0)
          || nextDeliveryService !== existingDeliveryService
        ) changedParts.push("доставка");

        if (body.customerComment !== (order.customer_comment || "")) {
          changedParts.push("комментарий клиента");
        }

        if (body.contactPreference !== order.contact_preference) {
          changedParts.push("способ связи");
        }

        if (changedParts.length === 0) {
          return { changed: false, total: order.total };
        }

        const matchingCustomerRows = await transaction<{ id: string }[]>`
          SELECT id
          FROM customers
          WHERE shop_id = ${shop.id}
            AND phone = ${normalizedCustomerPhone}
          LIMIT 1
          FOR UPDATE
        `;

        const matchingCustomer = matchingCustomerRows[0];
        let nextCustomerId = order.customer_id;

        if (
          matchingCustomer
          && order.customer_id
          && matchingCustomer.id !== order.customer_id
        ) {
          throw new HttpError(
            409,
            "Этот телефон уже принадлежит другому клиенту. Объединение клиентов выполняется отдельно, чтобы не потерять бонусы и историю заказов."
          );
        }

        if (matchingCustomer) {
          nextCustomerId = matchingCustomer.id;

          await transaction`
            UPDATE customers
            SET name = ${body.customerName},
                email = ${body.customerEmail || null},
                updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${matchingCustomer.id}
          `;
        } else if (order.customer_id) {
          await transaction`
            UPDATE customers
            SET name = ${body.customerName},
                phone = ${normalizedCustomerPhone},
                email = ${body.customerEmail || null},
                updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${order.customer_id}
          `;
        } else {
          const insertedCustomers = await transaction<{ id: string }[]>`
            INSERT INTO customers (
              shop_id,
              phone,
              name,
              email,
              bonus_balance,
              total_orders,
              total_spent,
              created_at,
              updated_at
            )
            VALUES (
              ${shop.id},
              ${normalizedCustomerPhone},
              ${body.customerName},
              ${body.customerEmail || null},
              0,
              0,
              0,
              NOW(),
              NOW()
            )
            RETURNING id
          `;

          nextCustomerId = insertedCustomers[0]?.id ?? null;
        }

        await transaction`
          UPDATE orders
          SET
            customer_id = ${nextCustomerId},
            delivery_type = ${body.deliveryType}::delivery_type,
            delivery_zone_id = ${deliveryZoneId},
            delivery_interval_id = ${deliveryIntervalId},
            delivery_date = ${deliveryDate},
            delivery_address_text = ${deliveryAddress},
            delivery_comment = ${body.deliveryComment || null},
            recipient_name = ${body.recipientName},
            recipient_phone = ${normalizedRecipientPhone},
            customer_comment = ${body.customerComment || null},
            contact_preference = ${body.contactPreference},
            delivery_price = ${deliveryPrice},
            total = ${nextTotal},
            metadata = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{customer}',
                  CAST(${JSON.stringify(customerMetadata)} AS jsonb),
                  true
                ),
                '{recipient}',
                CAST(${JSON.stringify(recipientMetadata)} AS jsonb),
                true
              ),
              '{delivery}',
              CAST(${JSON.stringify(deliveryMetadata)} AS jsonb),
              true
            ),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${order.id}
        `;

        if (nextTotal !== Number(order.total || 0)) {
          await transaction`
            UPDATE payments
            SET amount = ${nextTotal},
                updated_at = NOW()
            WHERE id = (
              SELECT id
              FROM payments
              WHERE shop_id = ${shop.id}
                AND order_id = ${order.id}
                AND status = 'pending'
              ORDER BY created_at DESC
              LIMIT 1
            )
          `;
        }

        await addOrderOperationalHistory(transaction, {
          shopId: shop.id,
          orderId: order.id,
          status: order.status,
          userId: adminContext.userId,
          comment: `Обновлены данные заказа: ${changedParts.join(", ")}`
        });

        const courierNeedsUpdate =
          Boolean(order.courier_id)
          && body.deliveryType === "delivery"
          && (
            changedParts.includes("получатель")
            || changedParts.includes("доставка")
          );

        if (courierNeedsUpdate && order.courier_id) {
          const courierRows = await transaction<{
            telegram_id: string;
            name: string | null;
          }[]>`
            SELECT ta.telegram_id, u.name
            FROM shop_users su
            JOIN users u ON u.id = su.user_id
            JOIN telegram_accounts ta
              ON ta.shop_id = su.shop_id
             AND ta.user_id = su.user_id
             AND ta.is_active = true
            WHERE su.shop_id = ${shop.id}
              AND su.user_id = ${order.courier_id}
              AND su.role = 'courier'
              AND su.is_active = true
            ORDER BY ta.linked_at DESC
            LIMIT 1
          `;

          const courier = courierRows[0];

          if (courier?.telegram_id) {
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
              VALUES (
                ${shop.id},
                ${order.id},
                'courier_order_assigned',
                'telegram',
                'staff',
                ${courier.telegram_id},
                'pending',
                CAST(${JSON.stringify({
                  orderId: order.id,
                  orderNumber: order.order_number,
                  courierId: order.courier_id,
                  courierName: courier.name,
                  deliveryDate,
                  deliveryIntervalName,
                  deliveryAddressText: deliveryAddress,
                  deliveryComment: body.deliveryComment || null,
                  recipientName: body.recipientName,
                  recipientPhone: normalizedRecipientPhone,
                  trackingUrl: order.tracking_token
                    ? `/order/track/${order.tracking_token}`
                    : null,
                  crmUrl: `/admin/orders/${order.id}`,
                  isOperationalUpdate: true
                })} AS jsonb),
                NOW(),
                NOW()
              )
            `;
          }
        }

        return { changed: true, total: nextTotal };
      });

      return {
        ok: true,
        changed: result.changed,
        total: result.total
      };
    } finally {
      await client.end();
    }
  });

  app.post(
    "/api/admin/orders/:id/bouquet-approval",
    async (request, reply) => {
      const params = z
        .object({
          id: z.string().uuid(),
        })
        .parse(request.params ?? {});
      const body = bouquetApprovalAdminSchema.parse(request.body ?? {});
      const adminContext = (request as AdminRequest).adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход в CRM",
        });
      }

      if (!MANAGEMENT_ROLES.includes(adminContext.role)) {
        return reply.status(403).send({
          ok: false,
          message: "Недостаточно прав",
        });
      }

      const note = body.note.trim();

      if (body.action === "revision" && note.length < 3) {
        return reply.status(400).send({
          ok: false,
          message: "Опишите правку минимум тремя символами",
        });
      }

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        if (adminContext.shopId !== shop.id) {
          return reply.status(403).send({
            ok: false,
            message: "Нет доступа к этому магазину",
          });
        }

        const result = await client.begin(async (transaction) => {
          const orderRows = await transaction<
            {
              id: string;
              order_number: string;
              status: string;
              customer_id: string | null;
              florist_id: string | null;
              bouquet_photo_url: string | null;
              tracking_token: string;
              approval_status: string | null;
            }[]
          >`
            SELECT
              id,
              order_number,
              status::text AS status,
              customer_id,
              florist_id,
              bouquet_photo_url,
              tracking_token,
              metadata #>> '{bouquetApproval,status}' AS approval_status
            FROM orders
            WHERE id = ${params.id}
              AND shop_id = ${shop.id}
            FOR UPDATE
          `;

          const order = orderRows[0];

          if (!order) {
            return { kind: "not_found" as const };
          }

          if (order.status !== "assembling" || !order.bouquet_photo_url) {
            return {
              kind: "unavailable" as const,
              orderNumber: order.order_number,
            };
          }

          if (body.action === "resend") {
            const telegramRows = await transaction<
              { telegram_id: string }[]
            >`
              SELECT ta.telegram_id
              FROM telegram_accounts ta
              WHERE ta.shop_id = ${shop.id}
                AND ta.customer_id = ${order.customer_id}
                AND ta.is_active = true
                AND ta.notifications_enabled = true
              ORDER BY ta.linked_at DESC NULLS LAST
              LIMIT 1
            `;

            const telegramId = telegramRows[0]?.telegram_id;

            if (!telegramId) {
              return {
                kind: "no_telegram" as const,
                orderNumber: order.order_number,
              };
            }

            await transaction`
              UPDATE orders
              SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{bouquetApproval}',
                    COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
                      || jsonb_build_object(
                        'status', 'pending',
                        'requestedAt', NOW(),
                        'decidedAt', NULL,
                        'note', NULL,
                        'source', 'crm_resend'
                      ),
                    true
                  ),
                  updated_at = NOW()
              WHERE id = ${order.id}
                AND shop_id = ${shop.id}
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
              VALUES (
                ${shop.id},
                ${order.id},
                'bouquet_approval_requested',
                'telegram',
                'customer',
                ${telegramId},
                'pending',
                jsonb_build_object(
                  'orderId', ${order.id},
                  'orderNumber', ${order.order_number},
                  'bouquetPhotoUrl', ${order.bouquet_photo_url},
                  'trackingUrl', '/order/track/' || ${order.tracking_token}
                ),
                NOW(),
                NOW()
              )
            `;

            await transaction`
              INSERT INTO order_status_history (
                shop_id,
                order_id,
                from_status,
                to_status,
                changed_by_user_id,
                comment,
                created_at
              )
              VALUES (
                ${shop.id},
                ${order.id},
                'assembling',
                'assembling',
                ${adminContext.userId},
                'Менеджер повторно отправил фото букета покупателю на согласование',
                NOW()
              )
            `;

            return {
              kind: "updated" as const,
              orderNumber: order.order_number,
              status: "pending",
              message: "Фото повторно отправлено покупателю в Telegram",
            };
          }

          const nextStatus =
            body.action === "approve"
              ? "approved"
              : body.action === "waive"
                ? "waived"
                : "revision_requested";
          const defaultNote =
            body.action === "approve"
              ? "Одобрено менеджером после связи с покупателем"
              : body.action === "waive"
                ? "Согласование не требуется по решению менеджера"
                : note;
          const savedNote = note || defaultNote;
          const historyComment =
            body.action === "revision"
              ? `Менеджер запросил правку букета: ${savedNote}`
              : body.action === "waive"
                ? `Менеджер разрешил продолжить без согласования: ${savedNote}`
                : `Менеджер зафиксировал одобрение букета: ${savedNote}`;

          if (order.approval_status === nextStatus) {
            return {
              kind: "updated" as const,
              orderNumber: order.order_number,
              status: nextStatus,
              message: "Статус согласования уже установлен",
            };
          }

          await transaction`
            UPDATE orders
            SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{bouquetApproval}',
                  COALESCE(metadata -> 'bouquetApproval', '{}'::jsonb)
                    || jsonb_build_object(
                      'status', ${nextStatus},
                      'decidedAt', NOW(),
                      'note', ${savedNote},
                      'source', 'crm',
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
              AND shop_id = ${shop.id}
          `;

          await transaction`
            INSERT INTO order_status_history (
              shop_id,
              order_id,
              from_status,
              to_status,
              changed_by_user_id,
              comment,
              created_at
            )
            VALUES (
              ${shop.id},
              ${order.id},
              'assembling',
              'assembling',
              ${adminContext.userId},
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
            SELECT
              o.shop_id,
              o.id,
              ${
                body.action === "revision"
                  ? "bouquet_revision_requested"
                  : "bouquet_approved"
              },
              'telegram',
              'staff',
              ta.telegram_id,
              'pending',
              jsonb_build_object(
                'orderId', o.id,
                'orderNumber', o.order_number,
                'note', ${savedNote},
                'bouquetPhotoUrl', o.bouquet_photo_url,
                'crmUrl', '/admin/orders/' || o.id::text
              ),
              NOW(),
              NOW()
            FROM orders o
            JOIN telegram_accounts ta
              ON ta.shop_id = o.shop_id
             AND ta.user_id = o.florist_id
             AND ta.is_active = true
            JOIN shop_users su
              ON su.shop_id = ta.shop_id
             AND su.user_id = ta.user_id
             AND su.role = 'florist'
             AND su.is_active = true
            WHERE o.id = ${order.id}
              AND o.shop_id = ${shop.id}
            ORDER BY ta.linked_at DESC NULLS LAST
            LIMIT 1
          `;

          return {
            kind: "updated" as const,
            orderNumber: order.order_number,
            status: nextStatus,
            message:
              body.action === "revision"
                ? "Правка передана флористу"
                : body.action === "waive"
                  ? "Согласование пропущено, флорист может завершить сборку"
                  : "Одобрение зафиксировано",
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
            message: "Согласование доступно только для заказа в сборке с фото",
          });
        }

        if (result.kind === "no_telegram") {
          return reply.status(422).send({
            ok: false,
            message:
              "Telegram покупателя не подключён. Отправьте ему ссылку отслеживания вручную.",
          });
        }

        return {
          ok: true,
          orderNumber: result.orderNumber,
          status: result.status,
          message: result.message,
        };
      } finally {
        await client.end();
      }
    },
  );

  app.get("/api/admin/orders/:id/internal-chat", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const adminContext =
        (request as AdminRequest)
          .adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message:
            "Требуется вход в CRM"
        });
      }

      if (
        adminContext.shopId
        !== shop.id
      ) {
        return reply.status(403).send({
          ok: false,
          message:
            "Нет доступа к этому магазину"
        });
      }

      const orderRows = await client<{ id: string; order_number: string; tracking_token: string }[]>`
        SELECT id, order_number, tracking_token
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
          AND (
            ${adminContext.role}::text
              NOT IN (
                'florist',
                'courier'
              )

            OR (
              ${adminContext.role}::text
                = 'florist'
              AND florist_id =
                ${adminContext.userId}
            )

            OR (
              ${adminContext.role}::text
                = 'courier'
              AND courier_id =
                ${adminContext.userId}
            )
          )
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const chatRows = await client<{ id: string }[]>`
        INSERT INTO order_chats (
          shop_id,
          order_id,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          NOW(),
          NOW()
        )
        ON CONFLICT (order_id)
        DO UPDATE SET updated_at = order_chats.updated_at
        RETURNING id
      `;

      const chat = chatRows[0];

      const messages = chat?.id
        ? await client`
            SELECT
              cm.id,
              cm.author_type,
              cm.author_user_id,
              cm.text,
              cm.attachment_url,
              cm.created_at,
              u.name AS author_name
            FROM chat_messages cm
            LEFT JOIN users u ON u.id = cm.author_user_id
            WHERE cm.shop_id = ${shop.id}
              AND cm.order_id = ${order.id}
              AND cm.chat_id = ${chat.id}
              AND cm.message_scope = 'internal'
            ORDER BY cm.created_at ASC
            LIMIT 100
          `
        : [];

      await client`
        UPDATE chat_messages
        SET is_read_by_staff = true
        WHERE shop_id = ${shop.id}
          AND order_id = ${order.id}
          AND message_scope = 'internal'
          AND is_read_by_staff = false
      `;

      const staffPresence = await client`
        SELECT
          u.id,
          u.name,
          su.role,
          GREATEST(
            COALESCE(u.last_login_at, '1970-01-01'::timestamptz),
            COALESCE(ta.last_telegram_seen_at, '1970-01-01'::timestamptz)
          ) AS last_seen_at,
          CASE
            WHEN GREATEST(
              COALESCE(u.last_login_at, '1970-01-01'::timestamptz),
              COALESCE(ta.last_telegram_seen_at, '1970-01-01'::timestamptz)
            ) > NOW() - INTERVAL '3 minutes'
            THEN true
            ELSE false
          END AS is_online
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        LEFT JOIN LATERAL (
          SELECT MAX(updated_at) AS last_telegram_seen_at
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
        ) ta ON true
        WHERE su.shop_id = ${shop.id}
          AND su.is_active = true
          AND u.status = 'active'
        ORDER BY is_online DESC, u.name ASC NULLS LAST
        LIMIT 12
      `;

      return {
        ok: true,
        order,
        chat,
        messages,
        staffPresence,
        viewer: {
          userId:
            adminContext.userId,
          role:
            adminContext.role
        }
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/internal-chat", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      text: z.string().trim().min(1).max(2000)
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const adminContext = (request as AdminRequest).adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход в CRM"
        });
      }

      if (adminContext.shopId !== shop.id) {
        return reply.status(403).send({
          ok: false,
          message: "Нет доступа к этому магазину"
        });
      }

      const orderRows = await client<{ id: string; order_number: string; tracking_token: string }[]>`
        SELECT id, order_number, tracking_token
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
          AND (
            ${adminContext.role}::text
              NOT IN (
                'florist',
                'courier'
              )

            OR (
              ${adminContext.role}::text
                = 'florist'
              AND florist_id =
                ${adminContext.userId}
            )

            OR (
              ${adminContext.role}::text
                = 'courier'
              AND courier_id =
                ${adminContext.userId}
            )
          )
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      const chatRows = await client<{ id: string }[]>`
        INSERT INTO order_chats (
          shop_id,
          order_id,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${order.id},
          NOW(),
          NOW()
        )
        ON CONFLICT (order_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      const chat = chatRows[0];

      if (!chat?.id) {
        return reply.status(500).send({
          ok: false,
          message: "Не удалось открыть чат заказа"
        });
      }

      const messageRows = await client`
        INSERT INTO chat_messages (
          shop_id,
          chat_id,
          order_id,
          author_type,
          author_user_id,
          author_customer_id,
          message_scope,
          text,
          attachment_url,
          is_read_by_staff,
          is_read_by_customer,
          created_at
        )
        VALUES (
          ${shop.id},
          ${chat.id},
          ${order.id},
          'staff',
          ${adminContext.userId},
          NULL,
          'internal',
          ${body.text},
          NULL,
          false,
          false,
          NOW()
        )
        RETURNING id, author_type, author_user_id, text, attachment_url, created_at
      `;

      const message = messageRows[0] as Record<string, unknown> | undefined;

      if (message?.id) {
        const notificationPayload = {
          orderId: order.id,
          orderNumber: order.order_number,
          messageText: body.text,
          trackingUrl: order.tracking_token ? `/order/track/${order.tracking_token}` : null,
          source: "crm_internal_chat"
        };

        await client`
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
            'internal_chat_message',
            'telegram',
            'staff',
            'pending',
            CAST(${JSON.stringify(notificationPayload)} AS jsonb),
            NOW(),
            NOW()
          )
        `;
      }

      return {
        ok: true,
        message: messageRows[0]
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/status", async (request, reply) => {
    // INVENTORY RESERVATION 1.0
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      status: z.enum([
        "new",
        "confirmed",
        "assembling",
        "ready",
        "assigned_courier",
        "delivering",
        "delivered",
        "cancelled",
        "problem"
      ]),
      reason: z.string()
        .trim()
        .max(500)
        .optional()
        .default("")
    }).parse(request.body ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const adminContext =
        (request as AdminRequest).adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход в CRM"
        });
      }

      if (adminContext.shopId !== shop.id) {
        return reply.status(403).send({
          ok: false,
          message: "Нет доступа к этому магазину"
        });
      }

      const orderRows = await client<{
        id: string;
        status: string;
        payment_status: string;
        florist_id: string | null;
        courier_id: string | null;
        delivery_proof_photo_url: string | null;
      }[]>`
        SELECT
          id,
          status,
          payment_status::text AS payment_status,
          florist_id,
          courier_id,
          metadata #>> '{delivery,proofPhotoUrl}'
            AS delivery_proof_photo_url
        FROM orders
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
          AND (
            ${adminContext.role}::text
              NOT IN (
                'florist',
                'courier'
              )

            OR (
              ${adminContext.role}::text
                = 'florist'
              AND florist_id =
                ${adminContext.userId}
            )

            OR (
              ${adminContext.role}::text
                = 'courier'
              AND courier_id =
                ${adminContext.userId}
            )
          )
        LIMIT 1
      `;

      const order = orderRows[0];

      if (!order) {
        return reply.status(404).send({
          ok: false,
          message: "Заказ не найден"
        });
      }

      if (order.status === body.status) {
        return {
          ok: true,
          message: "Статус уже установлен"
        };
      }

      if (
        body.status === "cancelled"
        && order.payment_status === "paid"
      ) {
        return reply.status(409).send({
          ok: false,
          message:
            "Оплаченный заказ нельзя отменить до фиксации полного возврата. Возврат доступен владельцу или администратору в карточке заказа."
        });
      }

      if (
        adminContext.role === "courier"
        && body.status === "delivered"
        && !String(order.delivery_proof_photo_url || "").startsWith(
          "/uploads/deliveries/"
        )
      ) {
        return reply.status(409).send({
          ok: false,
          message:
            "Сначала загрузите фото вручения через Telegram. После сохранения фото заказ завершится автоматически."
        });
      }

      const forwardStatusByCurrent: Partial<Record<string, string>> = {
        confirmed: "assembling",
        assembling: "ready",
        ready: "assigned_courier",
        assigned_courier: "delivering",
        delivering: "delivered"
      };

      const problemEligibleStatuses = new Set([
        "confirmed",
        "assembling",
        "ready",
        "assigned_courier",
        "delivering"
      ]);

      const terminalStatuses = new Set([
        "delivered",
        "cancelled"
      ]);

      const allowedStatuses = new Set<string>();

      if (order.status === "problem") {
        const problemReturnRows = await client<{
          from_status: string | null;
        }[]>`
          SELECT from_status::text AS from_status
          FROM order_status_history
          WHERE shop_id = ${shop.id}
            AND order_id = ${order.id}
            AND to_status = 'problem'
          ORDER BY created_at DESC
          LIMIT 1
        `;

        const problemReturnStatus = String(
          problemReturnRows[0]?.from_status || ""
        );

        if (problemEligibleStatuses.has(problemReturnStatus)) {
          allowedStatuses.add(problemReturnStatus);
        }
      } else {
        const forwardStatus = forwardStatusByCurrent[order.status];

        if (forwardStatus) {
          allowedStatuses.add(forwardStatus);
        }

        if (problemEligibleStatuses.has(order.status)) {
          allowedStatuses.add("problem");
        }
      }

      if (!terminalStatuses.has(order.status)) {
        allowedStatuses.add("cancelled");
      }

      /*
       * Флорист управляет только этапами
       * сборки назначенного ему заказа.
       *
       * Курьер управляет только этапами
       * доставки назначенного ему заказа.
       *
       * Отмена заказа остаётся действием
       * владельца, администратора или
       * менеджера.
       */
      if (
        adminContext.role === "florist"
      ) {
        const floristStatuses =
          new Set([
            "confirmed",
            "assembling",
            "ready",
            "problem"
          ]);

        for (
          const candidate
          of Array.from(
            allowedStatuses
          )
        ) {
          if (
            !floristStatuses.has(
              candidate
            )
          ) {
            allowedStatuses.delete(
              candidate
            );
          }
        }
      }

      if (
        adminContext.role === "courier"
      ) {
        const courierStatuses =
          new Set([
            "ready",
            "assigned_courier",
            "delivering",
            "delivered",
            "problem"
          ]);

        for (
          const candidate
          of Array.from(
            allowedStatuses
          )
        ) {
          if (
            !courierStatuses.has(
              candidate
            )
          ) {
            allowedStatuses.delete(
              candidate
            );
          }
        }
      }

      const statusLabels: Record<string, string> = {
        new: "Новый",
        confirmed: "Подтверждён",
        assembling: "Собирается",
        ready: "Готов",
        assigned_courier: "Передан курьеру",
        delivering: "В доставке",
        delivered: "Доставлен",
        cancelled: "Отменён",
        problem: "Проблема"
      };

      if (!allowedStatuses.has(body.status)) {


        const allowedText = Array.from(allowedStatuses)
          .map((item) => statusLabels[item] || item)
          .join(", ");

        return reply.status(409).send({
          ok: false,
          message: allowedText
            ? `Из статуса «${statusLabels[order.status] || order.status}» доступны только: ${allowedText}`
            : `Статус «${statusLabels[order.status] || order.status}» является завершённым`
        });
      }

      const reasonRequiredStatuses = new Set([
        "problem",
        "cancelled"
      ]);

      if (
        reasonRequiredStatuses.has(body.status)
        && body.reason.length < 3
      ) {
        return reply.status(400).send({
          ok: false,
          message: body.status === "problem"
            ? "Укажите причину проблемы не короче 3 символов"
            : "Укажите причину отмены не короче 3 символов"
        });
      }

      const roleActorText =
        adminContext.role === "florist"
          ? "флористом"
          : adminContext.role === "courier"
            ? "курьером"
            : "в CRM";

      const historyComment =
        body.status === "problem"
          ? `Проблема отмечена ${roleActorText}: ${body.reason}`
          : body.status === "cancelled"
            ? `Заказ отменён в CRM: ${body.reason}`
            : `Статус изменён ${roleActorText}: ${
                statusLabels[body.status]
                || body.status
              }`;

      const statusChangeResult =
        await client.begin(
          async (transaction) => {
            const lockedOrderRows =
              await transaction<{
                id: string;
                status: string;
                reservation_state:
                  string | null;
                reservation_count:
                  number;
              }[]>`
                SELECT
                  id,
                  status::text
                    AS status,
                  metadata #>>
                    '{inventoryReservation,state}'
                    AS reservation_state,
                  CASE
                    WHEN jsonb_typeof(
                      metadata #>
                        '{inventoryReservation,items}'
                    ) = 'array'
                    THEN jsonb_array_length(
                      metadata #>
                        '{inventoryReservation,items}'
                    )
                    ELSE 0
                  END::int
                    AS reservation_count
                FROM orders
                WHERE shop_id =
                    ${shop.id}
                  AND id =
                    ${order.id}
                LIMIT 1
                FOR UPDATE
              `;

            const lockedOrder =
              lockedOrderRows[0];

            if (
              !lockedOrder
              || lockedOrder.status
                !== order.status
            ) {
              return {
                changed: false,
                releasedUnits: 0
              };
            }

            let releasedUnits = 0;

            let finalHistoryComment =
              historyComment;

            if (
              body.status === "cancelled"
            ) {
              const rollback =
                await rollbackOrderFinancialsOnCancellation({
                  transaction,
                  shopId: shop.id,
                  orderId: order.id,
                  actorUserId: adminContext.userId
                });

              const rollbackParts = [
                rollback.bonusReturned > 0
                  ? `возвращено бонусов: ${rollback.bonusReturned}`
                  : "",
                rollback.promoRestored
                  ? "лимит промокода восстановлен"
                  : ""
              ].filter(Boolean);

              if (rollbackParts.length > 0) {
                finalHistoryComment += `. ${rollbackParts.join("; ")}`;
              }
            }

            if (
              body.status
                === "cancelled"
              && lockedOrder
                .reservation_state
                === "reserved"
            ) {
              if (
                lockedOrder
                  .reservation_count
                < 1
              ) {
                throw new HttpError(
                  500,
                  "Повреждён журнал резервирования заказа"
                );
              }

              const restoredRows =
                await transaction<{
                  product_id: string;
                  quantity: number;
                }[]>`
                  WITH reservation_items
                    AS (
                      SELECT
                        (
                          item
                          ->> 'productId'
                        )::uuid
                          AS product_id,
                        (
                          item
                          ->> 'quantity'
                        )::int
                          AS quantity
                      FROM orders
                        source_order
                      CROSS JOIN LATERAL
                        jsonb_array_elements(
                          source_order.metadata
                          #>
                          '{inventoryReservation,items}'
                        ) AS item
                      WHERE
                        source_order.shop_id =
                          ${shop.id}
                        AND source_order.id =
                          ${order.id}
                        AND source_order.metadata
                          #>>
                          '{inventoryReservation,state}'
                          = 'reserved'
                        AND jsonb_typeof(
                          item
                        ) = 'object'
                        AND item
                          ? 'productId'
                        AND item
                          ? 'quantity'
                        AND (
                          item
                          ->> 'productId'
                        ) ~*
                          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        AND (
                          item
                          ->> 'quantity'
                        ) ~
                          '^[1-9][0-9]*$'
                        AND (
                          item
                          ->> 'quantity'
                        )::int
                          BETWEEN 1 AND 99
                    ),
                  unique_items AS (
                    SELECT
                      product_id,
                      SUM(
                        quantity
                      )::int
                        AS quantity
                    FROM reservation_items
                    GROUP BY product_id
                  )
                  UPDATE products
                    product
                  SET
                    stock_quantity =
                      COALESCE(
                        product
                          .stock_quantity,
                        0
                      )
                      + unique_items
                        .quantity,
                    updated_at =
                      NOW()
                  FROM unique_items
                  WHERE product.shop_id =
                      ${shop.id}
                    AND product.id =
                      unique_items
                        .product_id
                  RETURNING
                    product.id
                      AS product_id,
                    unique_items.quantity
                `;

              if (
                restoredRows.length
                !== lockedOrder
                  .reservation_count
              ) {
                throw new HttpError(
                  409,
                  "Не удалось вернуть все товары из резерва. Проверьте каталог."
                );
              }

              releasedUnits =
                restoredRows.reduce(
                  (sum, row) =>
                    sum
                    + Number(
                      row.quantity
                    ),
                  0
                );

              const releasePatch = {
                state: "released",
                releasedAt:
                  new Date()
                    .toISOString(),
                releasedByUserId:
                  adminContext
                    .userId
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
                      COALESCE(
                        metadata
                        ->
                        'inventoryReservation',
                        '{}'::jsonb
                      )
                      || CAST(
                        ${JSON.stringify(
                          releasePatch
                        )}
                        AS jsonb
                      ),
                      true
                    ),
                  updated_at =
                    NOW()
                WHERE shop_id =
                    ${shop.id}
                  AND id =
                    ${order.id}
              `;

              finalHistoryComment =
                `${historyComment}. Возвращено на склад: ${releasedUnits} шт.`;
            }

            const updatedRows =
              await transaction<{
                id: string;
              }[]>`
                UPDATE orders
                SET
                  status =
                    ${body.status}::order_status,
                  delivered_at =
                    CASE
                      WHEN ${body.status}
                        = 'delivered'
                      THEN NOW()
                      ELSE delivered_at
                    END,
                  cancelled_at =
                    CASE
                      WHEN ${body.status}
                        = 'cancelled'
                      THEN NOW()
                      ELSE cancelled_at
                    END,
                  updated_at =
                    NOW()
                WHERE id =
                    ${order.id}
                  AND status =
                    ${order.status}::order_status
                RETURNING id
              `;

            if (!updatedRows[0]) {
              return {
                changed: false,
                releasedUnits: 0
              };
            }

            await transaction`
              INSERT INTO order_status_history (
                shop_id,
                order_id,
                from_status,
                to_status,
                changed_by_user_id,
                comment,
                created_at
              )
              VALUES (
                ${shop.id},
                ${order.id},
                ${order.status}::order_status,
                ${body.status}::order_status,
                ${adminContext.userId},
                ${finalHistoryComment},
                NOW()
              )
            `;

            return {
              changed: true,
              releasedUnits
            };
          }
        );

      if (
        !statusChangeResult
          .changed
      ) {
        return reply
          .status(409)
          .send({
            ok: false,
            message:
              "Статус заказа уже изменился. Обновите страницу."
          });
      }

      const customerEventByStatus: Partial<Record<string, CustomerNotificationType>> = {
        ready: "order_ready",
        assigned_courier: "order_courier_assigned",
        delivering: "order_delivering",
        delivered: "order_delivered",
        problem: "order_problem",
        cancelled: "order_cancelled"
      };
      const customerEventType = customerEventByStatus[body.status];

      if (customerEventType) {
        await queueCustomerOrderNotification(client, {
          shopId: shop.id,
          orderId: order.id,
          type: customerEventType,
          status: body.status
        });
      }

      return {
        ok: true,
        status: body.status
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/orders/:id/confirm", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const result = await client.begin(async (transaction) => {
        const orderRows = await transaction<{
          id: string;
          order_number: string;
          status: string;
        }[]>`
          SELECT id, order_number, status::text AS status
          FROM orders
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
          FOR UPDATE
        `;

        const order = orderRows[0];

        if (!order) {
          throw new HttpError(404, "Заказ не найден");
        }

        if (order.status === "cancelled") {
          throw new HttpError(400, "Отменённый заказ нельзя подтвердить");
        }

        if (order.status !== "new") {
          return { changed: false, orderId: order.id };
        }

        await transaction`
          UPDATE orders
          SET status = 'confirmed',
              manager_id = COALESCE(manager_id, ${adminContext.userId}),
              updated_at = NOW()
          WHERE id = ${order.id}
            AND status = 'new'
        `;

        await transaction`
          INSERT INTO order_status_history (
            shop_id, order_id, from_status, to_status, changed_by_user_id, comment, created_at
          )
          VALUES (
            ${shop.id}, ${order.id}, 'new', 'confirmed', ${adminContext.userId},
            'Заказ подтверждён менеджером', NOW()
          )
        `;

        await queueCustomerOrderNotification(transaction, {
          shopId: shop.id,
          orderId: order.id,
          type: "order_confirmed",
          status: "confirmed"
        });

        return { changed: true, orderId: order.id };
      });

      const updatedRows = await client`
        SELECT
          o.*,
          COALESCE(NULLIF(o.metadata #>> '{customer,phone}', ''), c.phone) AS customer_phone,
          COALESCE(NULLIF(o.metadata #>> '{customer,name}', ''), c.name) AS customer_name,
          o.total AS total_amount
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${result.orderId}
        LIMIT 1
      `;

      return {
        ok: true,
        changed: result.changed,
        order: updatedRows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });


  app.post("/api/admin/orders/:id/payment-link", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = z.object({
      paymentUrl: z.string().trim().url().refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" || url.protocol === "http:";
        } catch {
          return false;
        }
      }, {
        message: "Ссылка оплаты должна начинаться с http:// или https://"
      })
    }).parse(request.body ?? {});

    const adminContext = (request as AdminRequest).adminContext;

    if (!adminContext?.userId) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const result = await client.begin(async (transaction) => {
        const orderRows = await transaction<{
          id: string;
          order_number: string;
          status: string;
          payment_status: string;
          payment_method: string;
          total: number;
        }[]>`
          SELECT id, order_number, status::text AS status,
                 payment_status::text AS payment_status,
                 payment_method::text AS payment_method, total
          FROM orders
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
          FOR UPDATE
        `;

        const order = orderRows[0];

        if (!order) {
          throw new HttpError(404, "Заказ не найден");
        }

        if (order.status === "new") {
          throw new HttpError(400, "Сначала подтвердите заказ");
        }

        if (order.status === "cancelled") {
          throw new HttpError(400, "Для отменённого заказа ссылка оплаты недоступна");
        }

        if (order.payment_status === "paid") {
          throw new HttpError(400, "Заказ уже оплачен");
        }

        if (order.payment_status === "refunded") {
          throw new HttpError(400, "Для заказа с возвратом нельзя создавать новую ссылку оплаты");
        }

        if (order.payment_status === "cancelled") {
          throw new HttpError(400, "Оплата заказа отменена");
        }

        const existingRows = await transaction<{ id: string; payment_url: string | null }[]>`
          SELECT id, payment_url
          FROM payments
          WHERE shop_id = ${shop.id}
            AND order_id = ${order.id}
            AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `;

        const existing = existingRows[0];
        let paymentRows;

        if (existing) {
          paymentRows = await transaction`
            UPDATE payments
            SET method = ${order.payment_method}::payment_method,
                amount = ${Number(order.total || 0)},
                payment_url = ${body.paymentUrl},
                raw_payload = COALESCE(raw_payload, '{}'::jsonb)
                  || ${JSON.stringify({ source: "admin_manual_link", updatedByUserId: adminContext.userId })}::jsonb,
                updated_at = NOW()
            WHERE id = ${existing.id}
            RETURNING *
          `;
        } else {
          paymentRows = await transaction`
            INSERT INTO payments (
              shop_id, order_id, provider, method, status, amount, currency,
              payment_url, raw_payload, created_at, updated_at
            )
            VALUES (
              ${shop.id}, ${order.id}, 'manual', ${order.payment_method}::payment_method,
              'pending', ${Number(order.total || 0)}, 'RUB', ${body.paymentUrl},
              ${JSON.stringify({ source: "admin_manual_link", createdByUserId: adminContext.userId })}::jsonb,
              NOW(), NOW()
            )
            RETURNING *
          `;
        }

        await transaction`
          UPDATE orders
          SET payment_status = 'pending', updated_at = NOW()
          WHERE id = ${order.id}
        `;

        const linkChanged = !existing || existing.payment_url !== body.paymentUrl;

        if (linkChanged) {
          await addOrderOperationalHistory(transaction, {
            shopId: shop.id,
            orderId: order.id,
            status: order.status,
            userId: adminContext.userId,
            comment: existing ? "Обновлена ссылка на оплату" : "Добавлена ссылка на оплату"
          });

          await queueCustomerOrderNotification(transaction, {
            shopId: shop.id,
            orderId: order.id,
            type: "payment_link_added",
            status: order.status,
            extraPayload: {
              amount: order.total,
              paymentUrl: body.paymentUrl,
              paymentId: (paymentRows[0] as Record<string, unknown> | undefined)?.id ?? null
            }
          });
        }

        return {
          order,
          payment: paymentRows[0],
          isNew: !existing,
          linkChanged
        };
      });

      return {
        ok: true,
        created: result.isNew,
        changed: result.linkChanged,
        payment: result.payment
      };
    } finally {
      await client.end();
    }
  });


  app.post(
    "/api/admin/orders/:id/mark-paid",
    async (request) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(
        request.params ?? {}
      );

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const result =
          await markOrderPaid({
            client,
            shopId:
              shop.id,
            orderId:
              params.id
          });

        return {
          ok: true,
          order:
            result.order,
          bonus: {
            earnedNow:
              result.earnedNow,
            balanceAfter:
              result.balanceAfter
          },
          payment: {
            wasAlreadyPaid:
              result.wasAlreadyPaid,
            created:
              result.paymentCreated,
            repaired:
              result.paymentRepaired
          }
        };
      } finally {
        await client.end();
      }
    }
  );


  app.post(
    "/api/admin/orders/:id/refund",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body = z.object({
        reason: z.string().trim().min(5).max(500),
        cancelOrder: z.boolean().optional().default(true)
      }).parse(request.body ?? {});

      const adminContext = (request as AdminRequest).adminContext;

      if (!adminContext?.userId) {
        return reply.status(401).send({
          ok: false,
          message: "Требуется вход в CRM"
        });
      }

      if (!OWNER_ADMIN_ROLES.includes(adminContext.role)) {
        return reply.status(403).send({
          ok: false,
          message: "Возврат доступен только владельцу или администратору"
        });
      }

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        const result = await recordFullOrderRefund({
          client,
          shopId: shop.id,
          orderId: params.id,
          actorUserId: adminContext.userId,
          reason: body.reason,
          cancelOrder: body.cancelOrder
        });

        return {
          ok: true,
          refund: result
        };
      } finally {
        await client.end();
      }
    }
  );

  app.get("/api/admin/catalog", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [categories, products] = await Promise.all([
        client`
            SELECT
              c.*,
              COALESCE(pc.products_total, 0)
                AS products_total,
              COALESCE(pc.active_products, 0)
                AS active_products,
              COALESCE(pc.draft_products, 0)
                AS draft_products,
              COALESCE(pc.hidden_products, 0)
                AS hidden_products,
              COALESCE(pc.archived_products, 0)
                AS archived_products
            FROM categories c
            LEFT JOIN LATERAL (
              SELECT
                COUNT(*)::int AS products_total,
                COUNT(*) FILTER (
                  WHERE p.status = 'active'
                )::int AS active_products,
                COUNT(*) FILTER (
                  WHERE p.status = 'draft'
                )::int AS draft_products,
                COUNT(*) FILTER (
                  WHERE p.status = 'hidden'
                )::int AS hidden_products,
                COUNT(*) FILTER (
                  WHERE p.status = 'archived'
                )::int AS archived_products
              FROM products p
              WHERE p.shop_id = c.shop_id
                AND p.category_id = c.id
            ) pc ON true
            WHERE c.shop_id = ${shop.id}
            ORDER BY
              c.sort_order ASC,
              c.name ASC
          `,
        client`
          SELECT
            p.*,
            pi.url AS primary_image_url,
            COALESCE(pic.images_count, 0) AS images_count
          FROM products p
          LEFT JOIN LATERAL (
            SELECT url
            FROM product_images
            WHERE shop_id = p.shop_id
              AND product_id = p.id
            ORDER BY is_main DESC, sort_order ASC, created_at ASC
            LIMIT 1
          ) pi ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS images_count
            FROM product_images
            WHERE shop_id = p.shop_id
              AND product_id = p.id
          ) pic ON true
          WHERE p.shop_id = ${shop.id}
          ORDER BY p.created_at DESC
          LIMIT 500
        `
      ]);

      return { shop, categories, products };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/delivery", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [zones, intervals] = await Promise.all([
        client`
          SELECT *
          FROM delivery_zones
          WHERE shop_id = ${shop.id}
          ORDER BY sort_order ASC
        `,
        client`
          SELECT
            di.*,
            COUNT(o.id)::int AS orders_count
          FROM delivery_intervals di
          LEFT JOIN orders o
            ON o.shop_id = di.shop_id
           AND o.delivery_interval_id = di.id
          WHERE di.shop_id = ${shop.id}
          GROUP BY di.id
          ORDER BY
            di.sort_order ASC,
            di.starts_at ASC
        `
      ]);

      return { shop, zones, intervals };
    } finally {
      await client.end();
    }
  });

  app.post(
    "/api/admin/delivery/zones/manage",
    async (request, reply) => {
      const body =
        deliveryZoneSchema.parse(
          request.body ?? {}
        );

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const name =
          body.name.trim();

        const normalizedName =
          name.toLowerCase();

        if (
          name.length < 2
          || name.length > 160
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Название зоны должно содержать от 2 до 160 символов"
          });
        }

        if (
          normalizedName === "самовывоз"
        ) {
          return reply.status(409).send({
            ok: false,
            message:
              "Самовывоз является отдельным способом получения заказа"
          });
        }

        if (body.sortOrder < 0) {
          return reply.status(400).send({
            ok: false,
            message:
              "Порядок сортировки не может быть отрицательным"
          });
        }

        if (
          body.isExpressAvailable
          && body.expressPrice <= 0
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Укажите стоимость срочной доставки"
          });
        }

        const duplicateRows =
          await client<{ id: string }[]>`
            SELECT id
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND LOWER(BTRIM(name))
                = LOWER(BTRIM(${name}::text))
            LIMIT 1
          `;

        if (duplicateRows[0]) {
          return reply.status(409).send({
            ok: false,
            message:
              "Зона с таким названием уже существует"
          });
        }

        const freeFromAmount =
          body.freeFromAmount > 0
            ? body.freeFromAmount
            : null;

        const expressPrice =
          body.isExpressAvailable
            ? body.expressPrice
            : null;

        const rows = await client`
          INSERT INTO delivery_zones (
            shop_id,
            name,
            description,
            price,
            free_from_amount,
            is_express_available,
            express_price,
            is_active,
            sort_order,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${name},
            ${body.description.trim()},
            ${body.price},
            ${freeFromAmount},
            ${body.isExpressAvailable},
            ${expressPrice},
            ${body.isActive},
            ${body.sortOrder},
            NOW(),
            NOW()
          )
          RETURNING *
        `;

        return reply.status(201).send({
          ok: true,
          zone: rows[0] ?? null
        });
      } finally {
        await client.end();
      }
    }
  );

  app.patch(
    "/api/admin/delivery/zones/manage/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body =
        deliveryZoneSchema.parse(
          request.body ?? {}
        );

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const existingRows =
          await client<{
            id: string;
            name: string;
            is_active: boolean;
          }[]>`
            SELECT
              id,
              name,
              is_active
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
            LIMIT 1
          `;

        const existing =
          existingRows[0];

        if (!existing) {
          return reply.status(404).send({
            ok: false,
            message:
              "Зона доставки не найдена"
          });
        }

        if (
          existing.name
            .trim()
            .toLowerCase()
          === "самовывоз"
        ) {
          return reply.status(409).send({
            ok: false,
            message:
              "Служебная зона самовывоза настраивается отдельно"
          });
        }

        const name =
          body.name.trim();

        if (
          name.length < 2
          || name.length > 160
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Название зоны должно содержать от 2 до 160 символов"
          });
        }

        if (
          name.toLowerCase()
          === "самовывоз"
        ) {
          return reply.status(409).send({
            ok: false,
            message:
              "Название «Самовывоз» зарезервировано"
          });
        }

        if (body.sortOrder < 0) {
          return reply.status(400).send({
            ok: false,
            message:
              "Порядок сортировки не может быть отрицательным"
          });
        }

        if (
          body.isExpressAvailable
          && body.expressPrice <= 0
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Укажите стоимость срочной доставки"
          });
        }

        const duplicateRows =
          await client<{ id: string }[]>`
            SELECT id
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND id <> ${existing.id}
              AND LOWER(BTRIM(name))
                = LOWER(BTRIM(${name}::text))
            LIMIT 1
          `;

        if (duplicateRows[0]) {
          return reply.status(409).send({
            ok: false,
            message:
              "Зона с таким названием уже существует"
          });
        }

        if (
          existing.is_active
          && !body.isActive
        ) {
          const otherActiveRows =
            await client<{
              count: number;
            }[]>`
              SELECT COUNT(*)::int AS count
              FROM delivery_zones
              WHERE shop_id = ${shop.id}
                AND id <> ${existing.id}
                AND is_active = true
                AND LOWER(BTRIM(name))
                  <> 'самовывоз'
            `;

          const otherActive =
            Number(
              otherActiveRows[0]?.count
              ?? 0
            );

          if (otherActive === 0) {
            return reply.status(409).send({
              ok: false,
              message:
                "Нельзя отключить последнюю активную зону доставки"
            });
          }
        }

        const freeFromAmount =
          body.freeFromAmount > 0
            ? body.freeFromAmount
            : null;

        const expressPrice =
          body.isExpressAvailable
            ? body.expressPrice
            : null;

        const rows = await client`
          UPDATE delivery_zones
          SET
            name = ${name},
            description =
              ${body.description.trim()},
            price = ${body.price},
            free_from_amount =
              ${freeFromAmount},
            is_express_available =
              ${body.isExpressAvailable},
            express_price =
              ${expressPrice},
            is_active =
              ${body.isActive},
            sort_order =
              ${body.sortOrder},
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${existing.id}
          RETURNING *
        `;

        return {
          ok: true,
          zone: rows[0] ?? null
        };
      } finally {
        await client.end();
      }
    }
  );

  app.delete(
    "/api/admin/delivery/zones/manage/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const existingRows =
          await client<{
            id: string;
            name: string;
            is_active: boolean;
          }[]>`
            SELECT
              id,
              name,
              is_active
            FROM delivery_zones
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
            LIMIT 1
          `;

        const existing =
          existingRows[0];

        if (!existing) {
          return reply.status(404).send({
            ok: false,
            message:
              "Зона доставки не найдена"
          });
        }

        if (
          existing.name
            .trim()
            .toLowerCase()
          === "самовывоз"
        ) {
          return reply.status(409).send({
            ok: false,
            message:
              "Служебную зону самовывоза удалить нельзя"
          });
        }

        const orderRows =
          await client<{
            count: number;
          }[]>`
            SELECT COUNT(*)::int AS count
            FROM orders
            WHERE shop_id = ${shop.id}
              AND delivery_zone_id =
                ${existing.id}
          `;

        const ordersCount =
          Number(
            orderRows[0]?.count
            ?? 0
          );

        if (ordersCount > 0) {
          return reply.status(409).send({
            ok: false,
            message:
              `Зона используется в ${ordersCount} заказах. Отключите её вместо удаления.`
          });
        }

        if (existing.is_active) {
          const otherActiveRows =
            await client<{
              count: number;
            }[]>`
              SELECT COUNT(*)::int AS count
              FROM delivery_zones
              WHERE shop_id = ${shop.id}
                AND id <> ${existing.id}
                AND is_active = true
                AND LOWER(BTRIM(name))
                  <> 'самовывоз'
            `;

          const otherActive =
            Number(
              otherActiveRows[0]?.count
              ?? 0
            );

          if (otherActive === 0) {
            return reply.status(409).send({
              ok: false,
              message:
                "Нельзя удалить последнюю активную зону доставки"
            });
          }
        }

        await client`
          DELETE FROM delivery_zones
          WHERE shop_id = ${shop.id}
            AND id = ${existing.id}
        `;

        return {
          ok: true
        };
      } finally {
        await client.end();
      }
    }
  );

  app.post(
    "/api/admin/delivery/intervals/manage",
    async (request, reply) => {
      const body =
        deliveryIntervalSchema.parse(
          request.body ?? {}
        );

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const startsAt =
          body.startsAt.trim();

        const endsAt =
          body.endsAt.trim();

        const startMinutes =
          deliveryTimeToMinutes(
            startsAt
          );

        const endMinutes =
          deliveryTimeToMinutes(
            endsAt
          );

        if (
          startMinutes >= endMinutes
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Время окончания должно быть позже времени начала"
          });
        }

        const duplicateRows =
          await client<{
            id: string;
          }[]>`
            SELECT id
            FROM delivery_intervals
            WHERE shop_id = ${shop.id}
              AND starts_at = ${startsAt}
              AND ends_at = ${endsAt}
            LIMIT 1
          `;

        if (duplicateRows[0]) {
          return reply.status(409).send({
            ok: false,
            message:
              "Такой интервал уже существует"
          });
        }

        if (body.isActive) {
          const overlapRows =
            await client<{
              id: string;
              name: string;
            }[]>`
              SELECT
                id,
                name
              FROM delivery_intervals
              WHERE shop_id = ${shop.id}
                AND is_active = true
                AND starts_at < ${endsAt}
                AND ends_at > ${startsAt}
              ORDER BY starts_at
              LIMIT 1
            `;

          const overlap =
            overlapRows[0];

          if (overlap) {
            return reply.status(409).send({
              ok: false,
              message:
                `Интервал пересекается с «${overlap.name}»`
            });
          }
        }

        const name =
          deliveryIntervalName(
            startsAt,
            endsAt
          );

        const rows = await client`
          INSERT INTO delivery_intervals (
            shop_id,
            name,
            starts_at,
            ends_at,
            is_active,
            sort_order,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${name},
            ${startsAt},
            ${endsAt},
            ${body.isActive},
            ${body.sortOrder},
            NOW(),
            NOW()
          )
          RETURNING *
        `;

        return reply.status(201).send({
          ok: true,
          interval: rows[0] ?? null
        });
      } finally {
        await client.end();
      }
    }
  );

  app.patch(
    "/api/admin/delivery/intervals/manage/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body =
        deliveryIntervalSchema.parse(
          request.body ?? {}
        );

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const existingRows =
          await client<{
            id: string;
            name: string;
            starts_at: string;
            ends_at: string;
            is_active: boolean;
          }[]>`
            SELECT
              id,
              name,
              starts_at,
              ends_at,
              is_active
            FROM delivery_intervals
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
            LIMIT 1
          `;

        const existing =
          existingRows[0];

        if (!existing) {
          return reply.status(404).send({
            ok: false,
            message:
              "Интервал доставки не найден"
          });
        }

        const startsAt =
          body.startsAt.trim();

        const endsAt =
          body.endsAt.trim();

        const startMinutes =
          deliveryTimeToMinutes(
            startsAt
          );

        const endMinutes =
          deliveryTimeToMinutes(
            endsAt
          );

        if (
          startMinutes >= endMinutes
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Время окончания должно быть позже времени начала"
          });
        }

        const duplicateRows =
          await client<{
            id: string;
          }[]>`
            SELECT id
            FROM delivery_intervals
            WHERE shop_id = ${shop.id}
              AND id <> ${existing.id}
              AND starts_at = ${startsAt}
              AND ends_at = ${endsAt}
            LIMIT 1
          `;

        if (duplicateRows[0]) {
          return reply.status(409).send({
            ok: false,
            message:
              "Такой интервал уже существует"
          });
        }

        if (body.isActive) {
          const overlapRows =
            await client<{
              id: string;
              name: string;
            }[]>`
              SELECT
                id,
                name
              FROM delivery_intervals
              WHERE shop_id = ${shop.id}
                AND id <> ${existing.id}
                AND is_active = true
                AND starts_at < ${endsAt}
                AND ends_at > ${startsAt}
              ORDER BY starts_at
              LIMIT 1
            `;

          const overlap =
            overlapRows[0];

          if (overlap) {
            return reply.status(409).send({
              ok: false,
              message:
                `Интервал пересекается с «${overlap.name}»`
            });
          }
        }

        if (
          existing.is_active
          && !body.isActive
        ) {
          const activeRows =
            await client<{
              count: number;
            }[]>`
              SELECT COUNT(*)::int AS count
              FROM delivery_intervals
              WHERE shop_id = ${shop.id}
                AND id <> ${existing.id}
                AND is_active = true
            `;

          const activeCount =
            Number(
              activeRows[0]?.count
              ?? 0
            );

          if (activeCount === 0) {
            return reply.status(409).send({
              ok: false,
              message:
                "Нельзя отключить последний активный интервал"
            });
          }
        }

        const name =
          deliveryIntervalName(
            startsAt,
            endsAt
          );

        const rows = await client`
          UPDATE delivery_intervals
          SET
            name = ${name},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            is_active = ${body.isActive},
            sort_order = ${body.sortOrder},
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${existing.id}
          RETURNING *
        `;

        return {
          ok: true,
          interval: rows[0] ?? null
        };
      } finally {
        await client.end();
      }
    }
  );

  app.delete(
    "/api/admin/delivery/intervals/manage/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const { client } = createDb();

      try {
        const shop =
          await getShop(client);

        const existingRows =
          await client<{
            id: string;
            name: string;
            is_active: boolean;
          }[]>`
            SELECT
              id,
              name,
              is_active
            FROM delivery_intervals
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
            LIMIT 1
          `;

        const existing =
          existingRows[0];

        if (!existing) {
          return reply.status(404).send({
            ok: false,
            message:
              "Интервал доставки не найден"
          });
        }

        const ordersRows =
          await client<{
            count: number;
          }[]>`
            SELECT COUNT(*)::int AS count
            FROM orders
            WHERE shop_id = ${shop.id}
              AND delivery_interval_id =
                ${existing.id}
          `;

        const ordersCount =
          Number(
            ordersRows[0]?.count
            ?? 0
          );

        if (ordersCount > 0) {
          return reply.status(409).send({
            ok: false,
            message:
              `Интервал используется в ${ordersCount} заказах. Отключите его вместо удаления.`
          });
        }

        if (existing.is_active) {
          const activeRows =
            await client<{
              count: number;
            }[]>`
              SELECT COUNT(*)::int AS count
              FROM delivery_intervals
              WHERE shop_id = ${shop.id}
                AND id <> ${existing.id}
                AND is_active = true
            `;

          const activeCount =
            Number(
              activeRows[0]?.count
              ?? 0
            );

          if (activeCount === 0) {
            return reply.status(409).send({
              ok: false,
              message:
                "Нельзя удалить последний активный интервал"
            });
          }
        }

        await client`
          DELETE FROM delivery_intervals
          WHERE shop_id = ${shop.id}
            AND id = ${existing.id}
        `;

        return {
          ok: true
        };
      } finally {
        await client.end();
      }
    }
  );

  app.get("/api/admin/customers", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client`
        SELECT *
        FROM customers
        WHERE shop_id = ${shop.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return { shop, items };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/employees", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const items = await client<{
        id: string;
        user_id: string;
        role: string;
        is_active: boolean;
        created_at: string;
        updated_at: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        user_status: string;
        last_login_at: string | null;
        has_password: boolean;
        active_sessions: number;
        linked_telegram_id: string | null;
        linked_telegram_username: string | null;
        telegram_link_code: string | null;
        telegram_link_expires_at: string | null;
      }[]>`
        SELECT
          su.id,
          su.user_id,
          su.role,
          su.is_active,
          su.created_at,
          su.updated_at,
          u.name,
          u.phone,
          u.email,
          u.status AS user_status,
          u.last_login_at,

          CASE
            WHEN u.password_hash IS NULL
              OR u.password_hash = ''
              THEN false
            ELSE true
          END AS has_password,

          COALESCE(
            sessions.active_sessions,
            0
          )::int AS active_sessions,

          ta.telegram_id
            AS linked_telegram_id,

          ta.username
            AS linked_telegram_username,

          elt.token
            AS telegram_link_code,

          elt.expires_at
            AS telegram_link_expires_at

        FROM shop_users su

        JOIN users u
          ON u.id = su.user_id

        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int
              AS active_sessions
          FROM admin_sessions s
          WHERE s.shop_id = su.shop_id
            AND s.user_id = su.user_id
            AND s.revoked_at IS NULL
            AND s.expires_at > NOW()
        ) sessions ON true

        LEFT JOIN LATERAL (
          SELECT
            telegram_id,
            username
          FROM telegram_accounts
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND is_active = true
          ORDER BY linked_at DESC
          LIMIT 1
        ) ta ON true

        LEFT JOIN LATERAL (
          SELECT
            token,
            expires_at
          FROM employee_link_tokens
          WHERE shop_id = su.shop_id
            AND user_id = su.user_id
            AND provider = 'telegram'
            AND purpose = 'connect_staff'
            AND status = 'pending'
            AND consumed_at IS NULL
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
        ) elt ON true

        WHERE su.shop_id = ${shop.id}

        ORDER BY
          CASE su.role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'manager' THEN 3
            WHEN 'florist' THEN 4
            WHEN 'courier' THEN 5
            ELSE 99
          END,
          su.created_at DESC

        LIMIT 100
      `;

      return {
        shop,
        items: items.map((item) => ({
          ...item,
          telegram_link_code:
            item.telegram_link_code
              ? String(
                  item.telegram_link_code
                )
              : null
        }))
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/employees", async (request, reply) => {
    const body = employeeSchema.parse(
      request.body ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const name = body.name.trim();
      const phone = body.phone.trim();
      const phoneDigits =
        normalizePhoneDigits(phone);

      const email =
        body.email.trim()
          ? body.email
              .trim()
              .toLowerCase()
          : null;

      const password =
        body.password.trim();

      if (phoneDigits.length < 10) {
        return reply.status(400).send({
          ok: false,
          message:
            "Укажите корректный номер телефона сотрудника"
        });
      }

      if (password.length < 8) {
        return reply.status(400).send({
          ok: false,
          message:
            "Пароль сотрудника должен быть не короче 8 символов"
        });
      }

      const duplicateRows =
        await client<{
          id: string;
          phone: string | null;
          email: string | null;
        }[]>`
          SELECT
            id,
            phone,
            email
          FROM users
          WHERE
            regexp_replace(
              COALESCE(phone, ''),
              '[^0-9]',
              '',
              'g'
            ) = ${phoneDigits}

            OR (
              ${email}::text IS NOT NULL
              AND LOWER(
                TRIM(
                  COALESCE(email, '')
                )
              ) = ${email}
            )

          LIMIT 1
        `;

      const duplicate =
        duplicateRows[0];

      if (duplicate) {
        const duplicatePhone =
          normalizePhoneDigits(
            duplicate.phone || ""
          ) === phoneDigits;

        return reply.status(409).send({
          ok: false,
          message: duplicatePhone
            ? "Сотрудник с таким телефоном уже существует"
            : "Сотрудник с таким Email уже существует"
        });
      }

      const passwordHash =
        hashPassword(password);

      const userRows =
        await client<{ id: string }[]>`
          INSERT INTO users (
            phone,
            email,
            name,
            password_hash,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ${phone},
            ${email},
            ${name},
            ${passwordHash},
            'active',
            NOW(),
            NOW()
          )
          RETURNING id
        `;

      const userId =
        userRows[0]?.id;

      if (!userId) {
        return reply.status(500).send({
          ok: false,
          message:
            "Не удалось создать пользователя"
        });
      }

      const employeeRows = await client`
        INSERT INTO shop_users (
          shop_id,
          user_id,
          role,
          is_active,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${userId},
          ${body.role}::shop_user_role,
          ${body.isActive},
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      let telegramToken:
        string | null = null;

      if (body.isActive) {
        telegramToken =
          createTelegramLinkCode();

        const metadata = {
          source:
            "admin_employee_create",
          mode:
            "code",
          role:
            body.role,
          telegramUsername:
            body.telegramUsername
              .trim()
              .replace(/^@/, "")
              || null
        };

        await client`
          INSERT INTO employee_link_tokens (
            shop_id,
            user_id,
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
            ${userId},
            'telegram',
            'connect_staff',
            ${telegramToken},
            'pending',
            NOW() + INTERVAL '30 minutes',
            CAST(
              ${JSON.stringify(metadata)}
              AS jsonb
            ),
            NOW(),
            NOW()
          )
        `;
      }

      return {
        ok: true,
        employee:
          employeeRows[0] ?? null,
        telegramLinkCode:
          telegramToken,
        login:
          email || phone
      };
    } finally {
      await client.end();
    }
  });

  app.patch("/api/admin/employees/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(
      request.params ?? {}
    );

    const body = employeeSchema.parse(
      request.body ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows =
        await client<{
          user_id: string;
          role: string;
          is_active: boolean;
          phone: string | null;
          email: string | null;
        }[]>`
          SELECT
            su.user_id,
            su.role,
            su.is_active,
            u.phone,
            u.email
          FROM shop_users su
          JOIN users u
            ON u.id = su.user_id
          WHERE su.shop_id = ${shop.id}
            AND su.id = ${params.id}
          LIMIT 1
        `;

      const employee =
        employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message:
            "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message:
            "Владельца нельзя редактировать через эту форму"
        });
      }

      const name = body.name.trim();
      const phone = body.phone.trim();
      const phoneDigits =
        normalizePhoneDigits(phone);

      const email =
        body.email.trim()
          ? body.email
              .trim()
              .toLowerCase()
          : null;

      const password =
        body.password.trim();

      if (phoneDigits.length < 10) {
        return reply.status(400).send({
          ok: false,
          message:
            "Укажите корректный номер телефона сотрудника"
        });
      }

      if (
        password
        && password.length < 8
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Новый пароль должен быть не короче 8 символов"
        });
      }

      const duplicateRows =
        await client<{
          id: string;
          phone: string | null;
          email: string | null;
        }[]>`
          SELECT
            id,
            phone,
            email
          FROM users
          WHERE id <> ${employee.user_id}
            AND (
              regexp_replace(
                COALESCE(phone, ''),
                '[^0-9]',
                '',
                'g'
              ) = ${phoneDigits}

              OR (
                ${email}::text
                  IS NOT NULL
                AND LOWER(
                  TRIM(
                    COALESCE(email, '')
                  )
                ) = ${email}
              )
            )
          LIMIT 1
        `;

      const duplicate =
        duplicateRows[0];

      if (duplicate) {
        const duplicatePhone =
          normalizePhoneDigits(
            duplicate.phone || ""
          ) === phoneDigits;

        return reply.status(409).send({
          ok: false,
          message: duplicatePhone
            ? "Этот телефон уже используется другим пользователем"
            : "Этот Email уже используется другим пользователем"
        });
      }

      const roleChanged =
        employee.role !== body.role;

      const activeChanged =
        employee.is_active
          !== body.isActive;

      const credentialsChanged =
        normalizePhoneDigits(
          employee.phone || ""
        ) !== phoneDigits

        || String(
          employee.email || ""
        )
          .trim()
          .toLowerCase()
          !== String(email || "")

        || Boolean(password);

      if (
        roleChanged
        || !body.isActive
      ) {
        const assignmentRows =
          await client<{
            count: number;
          }[]>`
            SELECT
              COUNT(*)::int
                AS count
            FROM orders
            WHERE shop_id = ${shop.id}
              AND status NOT IN (
                'delivered',
                'cancelled'
              )
              AND (
                manager_id =
                  ${employee.user_id}
                OR florist_id =
                  ${employee.user_id}
                OR courier_id =
                  ${employee.user_id}
              )
          `;

        const activeAssignments =
          Number(
            assignmentRows[0]?.count
            || 0
          );

        if (activeAssignments > 0) {
          return reply.status(409).send({
            ok: false,
            message:
              `У сотрудника есть незавершённые заказы: ${activeAssignments}. Сначала переназначьте их.`
          });
        }
      }

      const passwordHash =
        password
          ? hashPassword(password)
          : null;

      await client`
        UPDATE users
        SET
          name = ${name},
          phone = ${phone},
          email = ${email},
          password_hash =
            COALESCE(
              ${passwordHash},
              password_hash
            ),
          status = 'active',
          updated_at = NOW()
        WHERE id =
          ${employee.user_id}
      `;

      await client`
        UPDATE shop_users
        SET
          role =
            ${body.role}
              ::shop_user_role,
          is_active =
            ${body.isActive},
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
      `;

      const accessChanged =
        credentialsChanged
        || roleChanged
        || activeChanged;

      let revokedSessions = 0;

      if (accessChanged) {
        const revokedRows =
          await client<{
            token: string;
          }[]>`
            UPDATE admin_sessions
            SET
              revoked_at = NOW(),
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND user_id =
                ${employee.user_id}
              AND revoked_at IS NULL
            RETURNING token
          `;

        revokedSessions =
          revokedRows.length;
      }

      if (!body.isActive) {
        await client`
          UPDATE telegram_accounts
          SET
            is_active = false,
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND user_id =
              ${employee.user_id}
            AND is_active = true
        `;

        await client`
          UPDATE employee_link_tokens
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND user_id =
              ${employee.user_id}
            AND status = 'pending'
            AND consumed_at IS NULL
        `;
      }

      return {
        ok: true,
        accessChanged,
        revokedSessions
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/employees/:id/revoke-sessions", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(
      request.params ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows =
        await client<{
          user_id: string;
          role: string;
        }[]>`
          SELECT
            user_id,
            role
          FROM shop_users
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

      const employee =
        employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message:
            "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message:
            "Сеансы владельца нельзя завершить через эту кнопку"
        });
      }

      const revokedRows =
        await client<{
          token: string;
        }[]>`
          UPDATE admin_sessions
          SET
            revoked_at = NOW(),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND user_id =
              ${employee.user_id}
            AND revoked_at IS NULL
          RETURNING token
        `;

      return {
        ok: true,
        revokedSessions:
          revokedRows.length
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/employees/:id/telegram-link", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows = await client<{ user_id: string; role: string; name: string | null }[]>`
        SELECT su.user_id, su.role, u.name
        FROM shop_users su
        JOIN users u ON u.id = su.user_id
        WHERE su.shop_id = ${shop.id}
          AND su.id = ${params.id}
          AND su.is_active = true
        LIMIT 1
      `;

      const employee = employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message: "Активный сотрудник не найден"
        });
      }

      await client`
        UPDATE employee_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
          AND provider = 'telegram'
          AND purpose = 'connect_staff'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      const telegramToken = createTelegramLinkCode();

      await client`
        INSERT INTO employee_link_tokens (
          shop_id,
          user_id,
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
          ${employee.user_id},
          'telegram',
          'connect_staff',
          ${telegramToken},
          'pending',
          NOW() + INTERVAL '30 minutes',
          CAST(${JSON.stringify({ source: "admin_employee_link_regenerate", mode: "code" })} AS jsonb),
          NOW(),
          NOW()
        )
      `;

      return {
        ok: true,
        telegramLinkCode: telegramToken
      };
    } finally {
      await client.end();
    }
  });

  app.delete("/api/admin/employees/:id/telegram-link", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows = await client<{ user_id: string; role: string }[]>`
        SELECT user_id, role
        FROM shop_users
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const employee = employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message: "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message: "Telegram владельца нельзя отключить через эту кнопку"
        });
      }

      await client`
        UPDATE telegram_accounts
        SET is_active = false,
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
          AND is_active = true
      `;

      await client`
        UPDATE employee_link_tokens
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id = ${employee.user_id}
          AND provider = 'telegram'
          AND purpose = 'connect_staff'
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.delete("/api/admin/employees/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(
      request.params ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const employeeRows =
        await client<{
          user_id: string;
          role: string;
        }[]>`
          SELECT
            user_id,
            role
          FROM shop_users
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

      const employee =
        employeeRows[0];

      if (!employee) {
        return reply.status(404).send({
          ok: false,
          message:
            "Сотрудник не найден"
        });
      }

      if (employee.role === "owner") {
        return reply.status(400).send({
          ok: false,
          message:
            "Владельца нельзя удалить из команды"
        });
      }

      const assignmentRows =
        await client<{
          count: number;
        }[]>`
          SELECT
            COUNT(*)::int AS count
          FROM orders
          WHERE shop_id = ${shop.id}
            AND status NOT IN (
              'delivered',
              'cancelled'
            )
            AND (
              manager_id =
                ${employee.user_id}
              OR florist_id =
                ${employee.user_id}
              OR courier_id =
                ${employee.user_id}
            )
        `;

      const activeAssignments =
        Number(
          assignmentRows[0]?.count
          || 0
        );

      if (activeAssignments > 0) {
        return reply.status(409).send({
          ok: false,
          message:
            `У сотрудника есть незавершённые заказы: ${activeAssignments}. Сначала переназначьте их.`
        });
      }

      await client`
        UPDATE shop_users
        SET
          is_active = false,
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
      `;

      const revokedRows =
        await client<{
          token: string;
        }[]>`
          UPDATE admin_sessions
          SET
            revoked_at = NOW(),
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND user_id =
              ${employee.user_id}
            AND revoked_at IS NULL
          RETURNING token
        `;

      await client`
        UPDATE telegram_accounts
        SET
          is_active = false,
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id =
            ${employee.user_id}
          AND is_active = true
      `;

      await client`
        UPDATE employee_link_tokens
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND user_id =
            ${employee.user_id}
          AND status = 'pending'
          AND consumed_at IS NULL
      `;

      return {
        ok: true,
        revokedSessions:
          revokedRows.length
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/settings", async (request) => {
    const body = settingsSchema.parse(request.body ?? {});
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const contentSettings = {
        site: body.site,
        homepage: body.homepage,
        delivery: body.delivery
      };

      const rows = await client`
        INSERT INTO shop_settings (
          shop_id,
          phone,
          whatsapp,
          telegram,
          instagram,
          address,
          work_hours,
          hero_title,
          hero_subtitle,
          hero_image_url,
          is_online_payment_enabled,
          is_cash_payment_enabled,
          is_transfer_payment_enabled,
          settings,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${body.phone || null},
          ${body.whatsapp || null},
          ${body.telegram || null},
          ${body.instagram || null},
          ${body.address || null},
          ${body.workHours || null},
          ${body.heroTitle},
          ${body.heroSubtitle},
          ${body.heroImageUrl || null},
          ${body.isOnlinePaymentEnabled},
          ${body.isCashPaymentEnabled},
          ${body.isTransferPaymentEnabled},
          ${JSON.stringify(contentSettings)}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id)
        DO UPDATE SET
          phone = EXCLUDED.phone,
          whatsapp = EXCLUDED.whatsapp,
          telegram = EXCLUDED.telegram,
          instagram = EXCLUDED.instagram,
          address = EXCLUDED.address,
          work_hours = EXCLUDED.work_hours,
          hero_title = EXCLUDED.hero_title,
          hero_subtitle = EXCLUDED.hero_subtitle,
          hero_image_url = EXCLUDED.hero_image_url,
          is_online_payment_enabled = EXCLUDED.is_online_payment_enabled,
          is_cash_payment_enabled = EXCLUDED.is_cash_payment_enabled,
          is_transfer_payment_enabled = EXCLUDED.is_transfer_payment_enabled,
          settings = EXCLUDED.settings,
          updated_at = NOW()
        RETURNING *
      `;

      return {
        ok: true,
        settings: rows[0] ?? null
      };
    } finally {
      await client.end();
    }
  });
  app.get("/api/admin/products/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const productRows = await client`
        SELECT
          p.*,
          c.name AS category_name
        FROM products p
        LEFT JOIN categories c
          ON c.shop_id = p.shop_id
         AND c.id = p.category_id
        WHERE p.shop_id = ${shop.id}
          AND p.id = ${params.id}
        LIMIT 1
      `;

      const product = productRows[0];

      if (!product) {
        return reply.status(404).send({
          ok: false,
          message: "Товар не найден"
        });
      }

      const images = await client`
        SELECT
          id,
          url,
          alt,
          is_main,
          sort_order,
          created_at,
          updated_at
        FROM product_images
        WHERE shop_id = ${shop.id}
          AND product_id = ${params.id}
        ORDER BY
          is_main DESC,
          sort_order ASC,
          created_at ASC
      `;

      return {
        ok: true,
        product,
        images
      };
    } finally {
      await client.end();
    }
  });
  app.patch("/api/admin/products/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const body = productUpdateSchema.parse(
      request.body ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const existingRows = await client`
        SELECT
          id,
          slug,
          status
        FROM products
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        LIMIT 1
      `;

      const existing = existingRows[0];

      if (!existing) {
        return reply.status(404).send({
          ok: false,
          message: "Товар не найден"
        });
      }

      const categoryId = body.categoryId || null;

      if (categoryId) {
        const categoryRows = await client`
          SELECT id
          FROM categories
          WHERE shop_id = ${shop.id}
            AND id = ${categoryId}
          LIMIT 1
        `;

        if (!categoryRows[0]) {
          return reply.status(400).send({
            ok: false,
            message: "Выбранная категория не найдена"
          });
        }
      }

      const slug = (
        body.slug.trim()
        || slugify(body.name)
      );

      if (!slug) {
        return reply.status(400).send({
          ok: false,
          message: "Не удалось сформировать slug товара"
        });
      }

      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Slug может содержать только латинские буквы, цифры и дефисы"
        });
      }

      const duplicateRows = await client`
        SELECT id
        FROM products
        WHERE shop_id = ${shop.id}
          AND slug = ${slug}
          AND id <> ${params.id}
        LIMIT 1
      `;

      if (duplicateRows[0]) {
        return reply.status(409).send({
          ok: false,
          message: "Товар с таким slug уже существует"
        });
      }

      if (
        body.oldPrice !== null
        && body.oldPrice <= body.price
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Старая цена должна быть выше текущей цены"
        });
      }

      const rows = await client`
        UPDATE products
        SET
          category_id = ${categoryId},
          slug = ${slug},
          name = ${body.name},
          short_description = ${body.shortDescription},
          description = ${body.description},
          composition = ${body.composition},
          care_text = ${body.careText},
          price = ${body.price},
          old_price = ${body.oldPrice},
          cost_price = ${body.costPrice},
          stock_quantity = ${body.stockQuantity},
          is_stock_visible = false,
          status = ${body.status},
          is_featured = ${body.isFeatured},
          sort_order = ${body.sortOrder},
          updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        RETURNING *
      `;

      return {
        ok: true,
        product: rows[0] ?? null,
        customerAvailability:
          body.stockQuantity > 0
            ? "В наличии"
            : "Нет в наличии"
      };
    } finally {
      await client.end();
    }
  });



  app.post("/api/admin/categories", async (request, reply) => {
    const body = categorySchema.parse(
      request.body ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const name = body.name.trim();

      const slug = (
        body.slug.trim()
        || slugify(name)
      );

      if (!slug) {
        return reply.status(400).send({
          ok: false,
          message:
            "Не удалось сформировать slug категории"
        });
      }

      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Slug может содержать только латинские буквы, цифры и дефисы"
        });
      }

      const iconKey = (
        body.iconKey
        ?? defaultCategoryIconKeyForSlug(slug)
      );

      const imageUrl =
        categoryImageUrl(iconKey);

      const duplicateRows = await client<{
        id: string;
      }[]>`
        SELECT id
        FROM categories
        WHERE shop_id = ${shop.id}
          AND (
            slug = ${slug}
            OR LOWER(BTRIM(name))
              = LOWER(BTRIM(${name}::text))
          )
        LIMIT 1
      `;

      if (duplicateRows[0]) {
        return reply.status(409).send({
          ok: false,
          message:
            "Категория с таким названием или slug уже существует"
        });
      }

      const rows = await client`
        INSERT INTO categories (
          shop_id,
          slug,
          name,
          description,
          image_url,
          is_active,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${slug},
          ${name},
          ${body.description},
          ${imageUrl},
          ${body.isActive},
          ${body.sortOrder},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, slug)
        DO NOTHING
        RETURNING *
      `;

      const category = rows[0];

      if (!category) {
        return reply.status(409).send({
          ok: false,
          message:
            "Категория с таким slug уже существует"
        });
      }

      return {
        ok: true,
        category
      };
    } finally {
      await client.end();
    }
  });

  app.patch(
    "/api/admin/categories/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body = categoryUpdateSchema.parse(
        request.body ?? {}
      );

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        const existingRows = await client<{
          id: string;
          image_url: string | null;
        }[]>`
          SELECT id, image_url
          FROM categories
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

        const existing = existingRows[0];

        if (!existing) {
          return reply.status(404).send({
            ok: false,
            message: "Категория не найдена"
          });
        }

        const name = body.name.trim();

        const slug = (
          body.slug.trim()
          || slugify(name)
        );

        if (!slug) {
          return reply.status(400).send({
            ok: false,
            message:
              "Не удалось сформировать slug категории"
          });
        }

        if (
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
        ) {
          return reply.status(400).send({
            ok: false,
            message:
              "Slug может содержать только латинские буквы, цифры и дефисы"
          });
        }

        const imageUrl = body.iconKey
          ? categoryImageUrl(body.iconKey)
          : (
              String(existing.image_url ?? "").trim()
              || categoryImageUrl(
                defaultCategoryIconKeyForSlug(slug)
              )
            );

        const duplicateRows = await client<{
          id: string;
        }[]>`
          SELECT id
          FROM categories
          WHERE shop_id = ${shop.id}
            AND id <> ${params.id}
            AND (
              slug = ${slug}
              OR LOWER(BTRIM(name))
                = LOWER(BTRIM(${name}::text))
            )
          LIMIT 1
        `;

        if (duplicateRows[0]) {
          return reply.status(409).send({
            ok: false,
            message:
              "Категория с таким названием или slug уже существует"
          });
        }

        const rows = await client`
          UPDATE categories
          SET
            name = ${name},
            slug = ${slug},
            description = ${body.description},
            image_url = ${imageUrl},
            sort_order = ${body.sortOrder},
            is_active = ${body.isActive},
            updated_at = NOW()
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          RETURNING *
        `;

        return {
          ok: true,
          category: rows[0] ?? null
        };
      } finally {
        await client.end();
      }
    }
  );

  app.delete(
    "/api/admin/categories/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        const categoryRows = await client<{
          id: string;
          name: string;
        }[]>`
          SELECT id, name
          FROM categories
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

        const category = categoryRows[0];

        if (!category) {
          return reply.status(404).send({
            ok: false,
            message: "Категория не найдена"
          });
        }

        const countRows = await client<{
          products_count: number;
        }[]>`
          SELECT COUNT(*)::int AS products_count
          FROM products
          WHERE shop_id = ${shop.id}
            AND category_id = ${category.id}
        `;

        const productsCount = Number(
          countRows[0]?.products_count ?? 0
        );

        if (productsCount > 0) {
          return reply.status(409).send({
            ok: false,
            message:
              `Нельзя удалить категорию «${category.name}»: `
              + `в ней ${productsCount} товар(ов). `
              + "Перенесите товары или отключите категорию."
          });
        }

        await client`
          DELETE FROM categories
          WHERE shop_id = ${shop.id}
            AND id = ${category.id}
        `;

        return {
          ok: true
        };
      } finally {
        await client.end();
      }
    }
  );

  app.post("/api/admin/products", async (request, reply) => {
    const body = productSchema.parse(
      request.body ?? {}
    );

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const name = body.name.trim();

      const slug = (
        body.slug.trim()
        || slugify(name)
      );

      const categoryId = body.categoryId || null;

      if (!name) {
        return reply.status(400).send({
          ok: false,
          message: "Укажите название товара"
        });
      }

      if (!slug) {
        return reply.status(400).send({
          ok: false,
          message: "Не удалось сформировать slug товара"
        });
      }

      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Slug может содержать только латинские буквы, цифры и дефисы"
        });
      }

      if (categoryId) {
        const categoryRows = await client<{
          id: string;
        }[]>`
          SELECT id
          FROM categories
          WHERE shop_id = ${shop.id}
            AND id = ${categoryId}
          LIMIT 1
        `;

        if (!categoryRows[0]) {
          return reply.status(400).send({
            ok: false,
            message: "Выбранная категория не найдена"
          });
        }
      }

      const duplicateRows = await client<{
        id: string;
      }[]>`
        SELECT id
        FROM products
        WHERE shop_id = ${shop.id}
          AND slug = ${slug}
        LIMIT 1
      `;

      if (duplicateRows[0]) {
        return reply.status(409).send({
          ok: false,
          message:
            "Товар с таким slug уже существует. Измените slug или откройте существующую карточку."
        });
      }

      if (
        body.oldPrice !== null
        && body.oldPrice <= body.price
      ) {
        return reply.status(400).send({
          ok: false,
          message:
            "Старая цена должна быть выше текущей цены"
        });
      }

      const rows = await client`
        INSERT INTO products (
          shop_id,
          category_id,
          slug,
          name,
          short_description,
          description,
          composition,
          care_text,
          price,
          old_price,
          cost_price,
          status,
          stock_quantity,
          is_stock_visible,
          is_featured,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${shop.id},
          ${categoryId},
          ${slug},
          ${name},
          ${body.shortDescription},
          ${body.description},
          ${body.composition},
          ${body.careText},
          ${body.price},
          ${body.oldPrice},
          ${body.costPrice},
          ${body.status},
          ${body.stockQuantity},
          false,
          ${body.isFeatured},
          ${body.sortOrder},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, slug)
        DO NOTHING
        RETURNING *
      `;

      const product = rows[0];

      if (!product) {
        return reply.status(409).send({
          ok: false,
          message:
            "Товар с таким slug уже существует"
        });
      }

      return {
        ok: true,
        product
      };
    } finally {
      await client.end();
    }
  });

  app.post(
    "/api/admin/products/:id/images",
    {
      bodyLimit: 8 * 1024 * 1024
    },
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body = productImageUploadSchema.parse(
        request.body ?? {}
      );

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        const productRows = await client<{
          id: string;
          name: string;
        }[]>`
          SELECT id, name
          FROM products
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

        const product = productRows[0];

        if (!product) {
          return reply.status(404).send({
            ok: false,
            message: "Товар не найден"
          });
        }

        const countRows = await client<{
          images_count: number;
        }[]>`
          SELECT COUNT(*)::int AS images_count
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND product_id = ${product.id}
        `;

        const imagesCount = Number(
          countRows[0]?.images_count ?? 0
        );

        if (imagesCount >= 12) {
          return reply.status(400).send({
            ok: false,
            message:
              "Для одного товара можно загрузить не больше 12 фотографий"
          });
        }

        const match =
          /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
            .exec(body.imageData.trim());

        if (!match) {
          return reply.status(400).send({
            ok: false,
            message:
              "Поддерживаются только изображения JPG, PNG или WebP"
          });
        }

        const mimeType = match[1] ?? "";
        const encoded = match[2] ?? "";

        const extensionByMime: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp"
        };

        const extension = extensionByMime[mimeType];

        if (!extension || !encoded) {
          return reply.status(400).send({
            ok: false,
            message: "Не удалось прочитать изображение"
          });
        }

        const buffer = Buffer.from(encoded, "base64");

        if (buffer.length < 32) {
          return reply.status(400).send({
            ok: false,
            message: "Файл изображения повреждён"
          });
        }

        if (buffer.length > 5 * 1024 * 1024) {
          return reply.status(400).send({
            ok: false,
            message:
              "После обработки фото должно быть не больше 5 МБ"
          });
        }

        const isJpeg =
          buffer.length >= 3
          && buffer[0] === 0xff
          && buffer[1] === 0xd8
          && buffer[2] === 0xff;

        const isPng =
          buffer.length >= 8
          && buffer[0] === 0x89
          && buffer[1] === 0x50
          && buffer[2] === 0x4e
          && buffer[3] === 0x47
          && buffer[4] === 0x0d
          && buffer[5] === 0x0a
          && buffer[6] === 0x1a
          && buffer[7] === 0x0a;

        const isWebp =
          buffer.length >= 12
          && buffer.toString("ascii", 0, 4) === "RIFF"
          && buffer.toString("ascii", 8, 12) === "WEBP";

        const signatureMatches =
          (mimeType === "image/jpeg" && isJpeg)
          || (mimeType === "image/png" && isPng)
          || (mimeType === "image/webp" && isWebp);

        if (!signatureMatches) {
          return reply.status(400).send({
            ok: false,
            message:
              "Содержимое файла не соответствует формату изображения"
          });
        }

        const sortRows = await client<{
          max_sort_order: number;
        }[]>`
          SELECT
            COALESCE(MAX(sort_order), 0)::int
              AS max_sort_order
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND product_id = ${product.id}
        `;

        const sortOrder =
          Number(sortRows[0]?.max_sort_order ?? 0) + 10;

        const shouldBeMain =
          body.isMain || imagesCount === 0;

        const uploadsRoot =
          process.env.UPLOADS_DIR
          || resolve(
            process.cwd(),
            "storage/uploads"
          );

        const productUploadsDir = join(
          uploadsRoot,
          "products"
        );

        await mkdir(
          productUploadsDir,
          {
            recursive: true
          }
        );

        const safeProductId = product.id.replace(
          /[^a-z0-9-]/gi,
          ""
        );

        const fileName =
          `product-${safeProductId}-${randomUUID()}.${extension}`;

        const filePath = join(
          productUploadsDir,
          fileName
        );

        const publicUrl =
          `/uploads/products/${fileName}`;

        await writeFile(filePath, buffer);

        let insertedId = "";

        try {
          const insertedRows = await client<{
            id: string;
          }[]>`
            INSERT INTO product_images (
              shop_id,
              product_id,
              url,
              alt,
              is_main,
              sort_order,
              created_at,
              updated_at
            )
            VALUES (
              ${shop.id},
              ${product.id},
              ${publicUrl},
              ${body.alt.trim() || product.name},
              false,
              ${sortOrder},
              NOW(),
              NOW()
            )
            RETURNING id
          `;

          insertedId = insertedRows[0]?.id ?? "";

          if (!insertedId) {
            throw new Error(
              "Не удалось создать запись фотографии"
            );
          }

          if (shouldBeMain) {
            await client`
              UPDATE product_images
              SET
                is_main = false,
                updated_at = NOW()
              WHERE shop_id = ${shop.id}
                AND product_id = ${product.id}
            `;

            await client`
              UPDATE product_images
              SET
                is_main = true,
                updated_at = NOW()
              WHERE shop_id = ${shop.id}
                AND id = ${insertedId}
            `;
          }

          const imageRows = await client`
            SELECT *
            FROM product_images
            WHERE shop_id = ${shop.id}
              AND id = ${insertedId}
            LIMIT 1
          `;

          return {
            ok: true,
            image: imageRows[0] ?? null
          };
        } catch (error) {
          if (insertedId) {
            await client`
              DELETE FROM product_images
              WHERE shop_id = ${shop.id}
                AND id = ${insertedId}
            `.catch(() => undefined);
          }

          await unlink(filePath).catch(
            () => undefined
          );

          throw error;
        }
      } finally {
        await client.end();
      }
    }
  );

  app.patch(
    "/api/admin/product-images/:id",
    async (request, reply) => {
      const params = z.object({
        id: z.string().uuid()
      }).parse(request.params ?? {});

      const body = productImageUpdateSchema.parse(
        request.body ?? {}
      );

      const { client } = createDb();

      try {
        const shop = await getShop(client);

        const imageRows = await client<{
          id: string;
          product_id: string;
        }[]>`
          SELECT
            id,
            product_id
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

        const image = imageRows[0];

        if (!image) {
          return reply.status(404).send({
            ok: false,
            message: "Фото не найдено"
          });
        }

        if (body.alt !== undefined) {
          await client`
            UPDATE product_images
            SET
              alt = ${body.alt.trim()},
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
          `;
        }

        if (body.sortOrder !== undefined) {
          await client`
            UPDATE product_images
            SET
              sort_order = ${body.sortOrder},
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
          `;
        }

        if (body.isMain === true) {
          await client`
            UPDATE product_images
            SET
              is_main = false,
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND product_id = ${image.product_id}
          `;

          await client`
            UPDATE product_images
            SET
              is_main = true,
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${params.id}
          `;
        }

        const updatedRows = await client`
          SELECT *
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND id = ${params.id}
          LIMIT 1
        `;

        return {
          ok: true,
          image: updatedRows[0] ?? null
        };
      } finally {
        await client.end();
      }
    }
  );

  app.delete("/api/admin/product-images/:id", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const rows = await client<{
        url: string;
        product_id: string;
        is_main: boolean;
      }[]>`
        DELETE FROM product_images
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
        RETURNING
          url,
          product_id,
          is_main
      `;

      const image = rows[0];

      if (!image) {
        return reply.status(404).send({
          ok: false,
          message: "Фото не найдено"
        });
      }

      if (image.is_main) {
        const nextRows = await client<{
          id: string;
        }[]>`
          SELECT id
          FROM product_images
          WHERE shop_id = ${shop.id}
            AND product_id = ${image.product_id}
          ORDER BY
            sort_order ASC,
            created_at ASC
          LIMIT 1
        `;

        const nextImage = nextRows[0];

        if (nextImage) {
          await client`
            UPDATE product_images
            SET
              is_main = true,
              updated_at = NOW()
            WHERE shop_id = ${shop.id}
              AND id = ${nextImage.id}
          `;
        }
      }

      if (
        image.url.startsWith(
          "/uploads/products/"
        )
      ) {
        const uploadsRoot =
          process.env.UPLOADS_DIR
          || resolve(
            process.cwd(),
            "storage/uploads"
          );

        const fileName =
          image.url.split("/").pop() || "";

        if (fileName) {
          await unlink(
            join(
              uploadsRoot,
              "products",
              fileName
            )
          ).catch(() => undefined);
        }
      }

      return {
        ok: true
      };
    } finally {
      await client.end();
    }
  });


  app.get("/api/admin/notifications", async (request) => {
    const query = z.object({
      status: z.enum([
        "all",
        "pending",
        "processing",
        "sent",
        "failed",
        "skipped"
      ]).optional().default("all"),
      recipientType: z.enum([
        "all",
        "customer",
        "staff"
      ]).optional().default("all"),
      type: z.string().trim().max(80).optional().default(""),
      q: z.string().trim().max(160).optional().default(""),
      page: z.coerce.number().int().min(1).max(100000).optional().default(1),
      pageSize: z.coerce.number().int().min(10).max(100).optional().default(30)
    }).parse(request.query ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const offset = (query.page - 1) * query.pageSize;
      const search = `%${query.q}%`;
      const typeFilter = query.type ? `%${query.type}%` : "%";

      const [metricsRows, totalRows, eventRows, typeRows] = await Promise.all([
        client<{
          pending: number;
          processing: number;
          sent: number;
          failed: number;
          skipped: number;
          sent_today: number;
        }[]>`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            COUNT(*) FILTER (
              WHERE status = 'sent'
                AND (sent_at AT TIME ZONE 'Europe/Moscow')::date
                  = (NOW() AT TIME ZONE 'Europe/Moscow')::date
            )::int AS sent_today
          FROM notification_events
          WHERE shop_id = ${shop.id}
            AND created_at > NOW() - INTERVAL '30 days'
        `,
        client<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM notification_events ne
          LEFT JOIN orders o ON o.id = ne.order_id
          WHERE ne.shop_id = ${shop.id}
            AND (${query.status} = 'all' OR ne.status = ${query.status})
            AND (${query.recipientType} = 'all' OR ne.recipient_type = ${query.recipientType})
            AND ne.type ILIKE ${typeFilter}
            AND (
              ${query.q} = ''
              OR ne.type ILIKE ${search}
              OR COALESCE(ne.error, '') ILIKE ${search}
              OR COALESCE(ne.recipient_telegram_id, '') ILIKE ${search}
              OR COALESCE(o.order_number, '') ILIKE ${search}
            )
        `,
        client<{
          id: string;
          order_id: string | null;
          order_number: string | null;
          type: string;
          channel: string;
          recipient_type: string;
          recipient_telegram_id: string | null;
          status: string;
          attempts: number;
          error: string | null;
          payload: unknown;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        }[]>`
          SELECT
            ne.id,
            ne.order_id,
            o.order_number,
            ne.type,
            ne.channel,
            ne.recipient_type,
            ne.recipient_telegram_id,
            ne.status,
            ne.attempts,
            ne.error,
            ne.payload,
            ne.sent_at::text,
            ne.created_at::text,
            ne.updated_at::text
          FROM notification_events ne
          LEFT JOIN orders o ON o.id = ne.order_id
          WHERE ne.shop_id = ${shop.id}
            AND (${query.status} = 'all' OR ne.status = ${query.status})
            AND (${query.recipientType} = 'all' OR ne.recipient_type = ${query.recipientType})
            AND ne.type ILIKE ${typeFilter}
            AND (
              ${query.q} = ''
              OR ne.type ILIKE ${search}
              OR COALESCE(ne.error, '') ILIKE ${search}
              OR COALESCE(ne.recipient_telegram_id, '') ILIKE ${search}
              OR COALESCE(o.order_number, '') ILIKE ${search}
            )
          ORDER BY
            CASE ne.status
              WHEN 'failed' THEN 1
              WHEN 'pending' THEN 2
              WHEN 'processing' THEN 3
              WHEN 'skipped' THEN 4
              ELSE 5
            END,
            ne.created_at DESC
          LIMIT ${query.pageSize}
          OFFSET ${offset}
        `,
        client<{ type: string; count: number }[]>`
          SELECT type, COUNT(*)::int AS count
          FROM notification_events
          WHERE shop_id = ${shop.id}
            AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY type
          ORDER BY count DESC, type ASC
          LIMIT 40
        `
      ]);

      return {
        ok: true,
        metrics: metricsRows[0] ?? {
          pending: 0,
          processing: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          sent_today: 0
        },
        events: eventRows,
        types: typeRows,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: Number(totalRows[0]?.count ?? 0),
          pages: Math.max(1, Math.ceil(Number(totalRows[0]?.count ?? 0) / query.pageSize))
        }
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/:id/retry", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const rows = await client<{ id: string }[]>`
        UPDATE notification_events
        SET status = 'pending',
            attempts = 0,
            error = NULL,
            sent_at = NULL,
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
          AND status IN ('failed', 'skipped')
        RETURNING id
      `;

      if (!rows[0]) {
        return reply.status(409).send({
          ok: false,
          message: "Повтор доступен только для пропущенного или неотправленного уведомления"
        });
      }

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/:id/skip", async (request, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(request.params ?? {});

    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const rows = await client<{ id: string }[]>`
        UPDATE notification_events
        SET status = 'skipped',
            error = COALESCE(error, 'Отменено сотрудником CRM'),
            updated_at = NOW()
        WHERE shop_id = ${shop.id}
          AND id = ${params.id}
          AND status IN ('pending', 'processing', 'failed')
        RETURNING id
      `;

      if (!rows[0]) {
        return reply.status(409).send({
          ok: false,
          message: "Это уведомление уже обработано"
        });
      }

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/notifications/retry-failed", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);
      const rows = await client<{ id: string }[]>`
        WITH failed_events AS (
          SELECT id
          FROM notification_events
          WHERE shop_id = ${shop.id}
            AND status = 'failed'
            AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at ASC
          LIMIT 100
        )
        UPDATE notification_events ne
        SET status = 'pending',
            attempts = 0,
            error = NULL,
            sent_at = NULL,
            updated_at = NOW()
        FROM failed_events
        WHERE ne.id = failed_events.id
        RETURNING ne.id
      `;

      return {
        ok: true,
        retried: rows.length
      };
    } finally {
      await client.end();
    }
  });

  app.get("/api/admin/settings", async () => {
    const { client } = createDb();

    try {
      const shop = await getShop(client);

      const [settings, domains, heroImages] = await Promise.all([
        client`
          SELECT *
          FROM shop_settings
          WHERE shop_id = ${shop.id}
          LIMIT 1
        `,
        client`
          SELECT *
          FROM shop_domains
          WHERE shop_id = ${shop.id}
          ORDER BY is_primary DESC, created_at ASC
        `,
        client`
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            image.url,
            image.alt
          FROM products p
          INNER JOIN LATERAL (
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
            AND p.status <> 'archived'
          ORDER BY
            p.is_featured DESC,
            p.sort_order ASC,
            p.name ASC
          LIMIT 200
        `
      ]);

      return {
        shop,
        settings: settings[0] ?? null,
        domains,
        heroImages
      };
    } finally {
      await client.end();
    }
  });
}
