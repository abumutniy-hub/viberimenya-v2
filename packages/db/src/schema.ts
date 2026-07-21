import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const shopStatusEnum = pgEnum("shop_status", ["active", "paused", "disabled"]);
export const userStatusEnum = pgEnum("user_status", ["active", "blocked", "deleted"]);
export const shopUserRoleEnum = pgEnum("shop_user_role", ["owner", "admin", "manager", "florist", "courier"]);
export const productStatusEnum = pgEnum("product_status", ["draft", "active", "hidden", "archived"]);
export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "confirmed",
  "assembling",
  "ready",
  "assigned_courier",
  "delivering",
  "delivered",
  "cancelled",
  "problem"
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "not_required",
  "created",
  "pending",
  "waiting_for_capture",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "cancelled",
  "expired"
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash_on_delivery",
  "transfer_after_confirm",
  "online_card",
  "sbp"
]);
export const deliveryTypeEnum = pgEnum("delivery_type", ["delivery", "pickup"]);
export const bonusTransactionTypeEnum = pgEnum("bonus_transaction_type", [
  "earn",
  "spend",
  "manual_add",
  "manual_remove",
  "expire"
]);
export const chatMessageAuthorTypeEnum = pgEnum("chat_message_author_type", [
  "customer",
  "staff",
  "system"
]);

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legal_name", { length: 255 }),
    status: shopStatusEnum("status").notNull().default("active"),
    timezone: varchar("timezone", { length: 80 }).notNull().default("Europe/Moscow"),
    currency: varchar("currency", { length: 8 }).notNull().default("RUB"),
    ...timestamps
  },
  (table) => [uniqueIndex("shops_slug_uidx").on(table.slug)]
);

export const shopSettings = pgTable(
  "shop_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    logoUrl: text("logo_url"),
    primaryColor: varchar("primary_color", { length: 32 }).notNull().default("#7c3aed"),
    accentColor: varchar("accent_color", { length: 32 }).notNull().default("#f43f5e"),
    phone: varchar("phone", { length: 32 }),
    whatsapp: varchar("whatsapp", { length: 80 }),
    telegram: varchar("telegram", { length: 80 }),
    instagram: text("instagram"),
    address: text("address"),
    workHours: varchar("work_hours", { length: 160 }),
    heroTitle: varchar("hero_title", { length: 255 }).notNull().default("Цветы, которые говорят за вас"),
    heroSubtitle: text("hero_subtitle"),
    heroImageUrl: text("hero_image_url"),
    isOnlinePaymentEnabled: boolean("is_online_payment_enabled").notNull().default(false),
    isCashPaymentEnabled: boolean("is_cash_payment_enabled").notNull().default(true),
    isTransferPaymentEnabled: boolean("is_transfer_payment_enabled").notNull().default(true),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [uniqueIndex("shop_settings_shop_uidx").on(table.shopId)]
);

export const shopDomains = pgTable(
  "shop_domains",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps
  },
  (table) => [
    uniqueIndex("shop_domains_domain_uidx").on(table.domain),
    index("shop_domains_shop_idx").on(table.shopId)
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 160 }),
    passwordHash: text("password_hash"),
    status: userStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("users_phone_uidx").on(table.phone),
    uniqueIndex("users_email_uidx").on(table.email)
  ]
);

export const shopUsers = pgTable(
  "shop_users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: shopUserRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps
  },
  (table) => [
    uniqueIndex("shop_users_shop_user_uidx").on(table.shopId, table.userId),
    index("shop_users_shop_role_idx").on(table.shopId, table.role)
  ]
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps
  },
  (table) => [
    uniqueIndex("categories_shop_slug_uidx").on(table.shopId, table.slug),
    index("categories_shop_idx").on(table.shopId)
  ]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    shortDescription: text("short_description"),
    description: text("description"),
    composition: text("composition"),
    careText: text("care_text"),
    price: integer("price").notNull().default(0),
    oldPrice: integer("old_price"),
    costPrice: integer("cost_price"),
    stockQuantity: integer("stock_quantity"),
    isStockVisible: boolean("is_stock_visible").notNull().default(false),
    status: productStatusEnum("status").notNull().default("draft"),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(100),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    uniqueIndex("products_shop_slug_uidx").on(table.shopId, table.slug),
    index("products_shop_status_idx").on(table.shopId, table.status),
    index("products_shop_category_idx").on(table.shopId, table.categoryId)
  ]
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: varchar("alt", { length: 255 }),
    sortOrder: integer("sort_order").notNull().default(100),
    isMain: boolean("is_main").notNull().default(false),
    ...timestamps
  },
  (table) => [index("product_images_product_idx").on(table.productId)]
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    phone: varchar("phone", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }),
    email: varchar("email", { length: 255 }),
    telegramUsername: varchar("telegram_username", { length: 120 }),
    bonusBalance: integer("bonus_balance").notNull().default(0),
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpent: integer("total_spent").notNull().default(0),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("customers_shop_phone_uidx").on(table.shopId, table.phone),
    index("customers_shop_idx").on(table.shopId)
  ]
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    city: varchar("city", { length: 120 }),
    street: varchar("street", { length: 255 }),
    house: varchar("house", { length: 60 }),
    apartment: varchar("apartment", { length: 60 }),
    entrance: varchar("entrance", { length: 60 }),
    floor: varchar("floor", { length: 60 }),
    comment: text("comment"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps
  },
  (table) => [index("customer_addresses_customer_idx").on(table.customerId)]
);

export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    price: integer("price").notNull().default(0),
    freeFromAmount: integer("free_from_amount"),
    isExpressAvailable: boolean("is_express_available").notNull().default(false),
    expressPrice: integer("express_price"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    ...timestamps
  },
  (table) => [index("delivery_zones_shop_idx").on(table.shopId)]
);

export const deliveryIntervals = pgTable(
  "delivery_intervals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    startsAt: varchar("starts_at", { length: 8 }).notNull(),
    endsAt: varchar("ends_at", { length: 8 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    ...timestamps
  },
  (table) => [index("delivery_intervals_shop_idx").on(table.shopId)]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    orderNumber: varchar("order_number", { length: 40 }).notNull(),
    status: orderStatusEnum("status").notNull().default("new"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("transfer_after_confirm"),
    deliveryType: deliveryTypeEnum("delivery_type").notNull().default("delivery"),
    deliveryZoneId: uuid("delivery_zone_id").references(() => deliveryZones.id, { onDelete: "set null" }),
    deliveryIntervalId: uuid("delivery_interval_id").references(() => deliveryIntervals.id, { onDelete: "set null" }),
    deliveryDate: timestamp("delivery_date", { withTimezone: true }),
    deliveryAddressText: text("delivery_address_text"),
    deliveryComment: text("delivery_comment"),
    recipientName: varchar("recipient_name", { length: 160 }),
    recipientPhone: varchar("recipient_phone", { length: 32 }),
    customerComment: text("customer_comment"),
    internalComment: text("internal_comment"),
    contactPreference: varchar("contact_preference", { length: 80 }).notNull().default("call_or_message"),
    subtotal: integer("subtotal").notNull().default(0),
    discountTotal: integer("discount_total").notNull().default(0),
    deliveryPrice: integer("delivery_price").notNull().default(0),
    bonusSpent: integer("bonus_spent").notNull().default(0),
    bonusEarned: integer("bonus_earned").notNull().default(0),
    total: integer("total").notNull().default(0),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    floristId: uuid("florist_id").references(() => users.id, { onDelete: "set null" }),
    courierId: uuid("courier_id").references(() => users.id, { onDelete: "set null" }),
    trackingToken: varchar("tracking_token", { length: 120 }).notNull(),
    bouquetPhotoUrl: text("bouquet_photo_url"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    uniqueIndex("orders_shop_order_number_uidx").on(table.shopId, table.orderNumber),
    uniqueIndex("orders_tracking_token_uidx").on(table.trackingToken),
    index("orders_shop_status_idx").on(table.shopId, table.status),
    index("orders_shop_delivery_date_idx").on(table.shopId, table.deliveryDate),
    index("orders_customer_idx").on(table.customerId),
    index("orders_courier_idx").on(table.courierId)
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: varchar("product_name", { length: 255 }).notNull(),
    productSnapshot: jsonb("product_snapshot").notNull().default(sql`'{}'::jsonb`),
    quantity: integer("quantity").notNull().default(1),
    price: integer("price").notNull().default(0),
    total: integer("total").notNull().default(0),
    ...timestamps
  },
  (table) => [index("order_items_order_idx").on(table.orderId)]
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("order_status_history_order_idx").on(table.orderId)]
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 80 }).notNull().default("manual"),
    providerPaymentId: varchar("provider_payment_id", { length: 255 }),
    attemptNo: integer("attempt_no").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("RUB"),
    paymentUrl: text("payment_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 120 }),
    lastProviderStatus: varchar("last_provider_status", { length: 80 }),
    rawPayload: jsonb("raw_payload").notNull().default(sql`'{}'::jsonb`),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("payments_order_idx").on(table.orderId),
    index("payments_shop_status_idx").on(table.shopId, table.status),
    index("payments_expiry_idx").on(table.status, table.expiresAt),
    uniqueIndex("payments_provider_payment_uidx").on(
      table.provider,
      table.providerPaymentId
    ),
    uniqueIndex("payments_provider_idempotency_uidx").on(
      table.provider,
      table.idempotencyKey
    ),
    uniqueIndex("payments_order_attempt_uidx").on(
      table.shopId,
      table.orderId,
      table.provider,
      table.attemptNo
    ),
    check("payments_amount_check", sql`${table.amount} >= 0`),
    check("payments_attempt_no_check", sql`${table.attemptNo} > 0`)
  ]
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 80 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    previousStatus: paymentStatusEnum("previous_status"),
    nextStatus: paymentStatusEnum("next_status"),
    providerEventId: varchar("provider_event_id", { length: 255 }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("payment_events_payment_idem_uidx").on(
      table.paymentId,
      table.idempotencyKey
    ),
    index("payment_events_order_idx").on(table.orderId, table.occurredAt),
    index("payment_events_provider_event_idx").on(
      table.provider,
      table.providerEventId
    )
  ]
);

export const promocodes = pgTable(
  "promocodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }).notNull(),
    description: text("description"),
    discountType: varchar("discount_type", { length: 40 }).notNull().default("percent"),
    discountValue: integer("discount_value").notNull().default(0),
    minOrderAmount: integer("min_order_amount"),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps
  },
  (table) => [
    uniqueIndex("promocodes_shop_code_uidx").on(table.shopId, table.code),
    index("promocodes_shop_idx").on(table.shopId)
  ]
);

export const bonusTransactions = pgTable(
  "bonus_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    type: bonusTransactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("bonus_transactions_customer_idx").on(table.customerId)]
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    text: text("text"),
    authorName: varchar("author_name", { length: 160 }),
    isPublished: boolean("is_published").notNull().default(false),
    ...timestamps
  },
  (table) => [index("reviews_shop_published_idx").on(table.shopId, table.isPublished)]
);

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    telegramId: varchar("telegram_id", { length: 80 }).notNull(),
    username: varchar("username", { length: 120 }),
    firstName: varchar("first_name", { length: 160 }),
    lastName: varchar("last_name", { length: 160 }),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("telegram_accounts_shop_telegram_uidx").on(table.shopId, table.telegramId),
    index("telegram_accounts_user_idx").on(table.userId),
    index("telegram_accounts_customer_idx").on(table.customerId)
  ]
);

export const orderChats = pgTable(
  "order_chats",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    isClosed: boolean("is_closed").notNull().default(false),
    ...timestamps
  },
  (table) => [uniqueIndex("order_chats_order_uidx").on(table.orderId)]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").notNull().references(() => orderChats.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    authorType: chatMessageAuthorTypeEnum("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorCustomerId: uuid("author_customer_id").references(() => customers.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    attachmentUrl: text("attachment_url"),
    isReadByStaff: boolean("is_read_by_staff").notNull().default(false),
    isReadByCustomer: boolean("is_read_by_customer").notNull().default(false),
    messageScope: varchar("message_scope", { length: 40 }).notNull().default("customer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("chat_messages_chat_idx").on(table.chatId),
    index("chat_messages_order_idx").on(table.orderId),
    index("chat_messages_order_scope_idx").on(
      table.orderId,
      table.messageScope,
      table.createdAt
    )
  ]
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: varchar("actor_role", { length: 32 }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: text("entity_id"),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    ip: varchar("ip", { length: 80 }),
    userAgent: text("user_agent"),
    summary: varchar("summary", { length: 500 }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("admin_audit_log_actor_idx").on(
      table.shopId,
      table.actorUserId,
      table.createdAt.desc()
    ),
    index("admin_audit_log_severity_idx").on(
      table.shopId,
      table.severity,
      table.createdAt.desc()
    ),
    index("admin_audit_log_shop_created_idx").on(
      table.shopId,
      table.createdAt.desc()
    ),
    index("admin_audit_log_shop_event_idx").on(
      table.shopId,
      table.eventType,
      table.createdAt.desc()
    ),
    check(
      "admin_audit_log_severity_check",
      sql`${table.severity} in ('info', 'warning', 'critical')`
    )
  ]
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    token: text("token").primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_admin_sessions_expires_at").on(table.expiresAt),
    index("idx_admin_sessions_shop_user_active")
      .on(table.shopId, table.userId)
      .where(sql`${table.revokedAt} is null`),
    index("idx_admin_sessions_user_id").on(table.userId)
  ]
);

export const customerChannelLinks = pgTable(
  "customer_channel_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerUserId: varchar("provider_user_id", { length: 160 }).notNull(),
    providerUsername: varchar("provider_username", { length: 160 }),
    providerDisplayName: varchar("provider_display_name", { length: 220 }),
    isActive: boolean("is_active").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("customer_channel_links_provider_uidx").on(
      table.shopId,
      table.provider,
      table.providerUserId
    ),
    index("customer_channel_links_customer_idx").on(
      table.shopId,
      table.customerId
    )
  ]
);

export const customerLinkTokens = pgTable(
  "customer_link_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    purpose: varchar("purpose", { length: 80 }).notNull(),
    token: varchar("token", { length: 180 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    unique("customer_link_tokens_token_key").on(table.token),
    index("customer_link_tokens_lookup_idx").on(
      table.provider,
      table.purpose,
      table.token,
      table.status,
      table.expiresAt
    ),
    index("customer_link_tokens_customer_idx").on(
      table.shopId,
      table.customerId
    )
  ]
);

export const customerLoginCodes = pgTable(
  "customer_login_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    phone: varchar("phone", { length: 32 }).notNull(),
    code: varchar("code", { length: 12 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("customer_login_codes_phone_idx").on(
      table.shopId,
      table.phone,
      table.createdAt.desc()
    ),
    index("customer_login_codes_customer_idx").on(table.customerId)
  ]
);

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("customer_sessions_token_key").on(table.token),
    index("customer_sessions_customer_idx").on(table.customerId),
    index("customer_sessions_token_idx").on(table.token)
  ]
);

export const employeeLinkTokens = pgTable(
  "employee_link_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull().default("telegram"),
    purpose: varchar("purpose", { length: 80 }).notNull().default("connect_staff"),
    token: varchar("token", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    unique("employee_link_tokens_token_key").on(table.token),
    index("employee_link_tokens_shop_user_idx").on(
      table.shopId,
      table.userId
    ),
    index("employee_link_tokens_token_idx").on(table.token)
  ]
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull().default("telegram"),
    recipientType: varchar("recipient_type", { length: 40 }).notNull().default("staff"),
    recipientTelegramId: varchar("recipient_telegram_id", { length: 80 }),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("notification_events_shop_status_idx").on(
      table.shopId,
      table.status,
      table.createdAt
    ),
    index("notification_events_order_idx").on(table.orderId),
    index("notification_events_type_idx").on(table.type)
  ]
);

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id"),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    actorType: varchar("actor_type", { length: 40 }).notNull().default("system"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorCustomerId: uuid("actor_customer_id").references(() => customers.id, { onDelete: "set null" }),
    correlationId: uuid("correlation_id"),
    causationId: uuid("causation_id"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("domain_events_shop_idem_uidx").on(
      table.shopId,
      table.idempotencyKey
    ),
    index("domain_events_shop_type_idx").on(
      table.shopId,
      table.eventType,
      table.occurredAt
    ),
    index("domain_events_aggregate_idx").on(
      table.shopId,
      table.aggregateType,
      table.aggregateId,
      table.occurredAt
    ),
    index("domain_events_correlation_idx").on(table.correlationId),
    check(
      "domain_events_version_check",
      sql`${table.eventVersion} > 0`
    )
  ]
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    domainEventId: uuid("domain_event_id").references(() => domainEvents.id, { onDelete: "set null" }),
    sourceNotificationEventId: uuid("source_notification_event_id").references(
      () => notificationEvents.id,
      { onDelete: "cascade" }
    ),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 40 }).notNull().default("telegram"),
    templateKey: varchar("template_key", { length: 120 }).notNull(),
    recipientType: varchar("recipient_type", { length: 40 }).notNull(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    recipientCustomerId: uuid("recipient_customer_id").references(() => customers.id, { onDelete: "set null" }),
    recipientRole: varchar("recipient_role", { length: 40 }),
    recipientAddress: varchar("recipient_address", { length: 180 }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deadAt: timestamp("dead_at", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("notification_outbox_source_uidx").on(
      table.sourceNotificationEventId
    ),
    uniqueIndex("notification_outbox_shop_idem_uidx").on(
      table.shopId,
      table.idempotencyKey
    ),
    index("notification_outbox_ready_idx").on(
      table.channel,
      table.status,
      table.nextAttemptAt,
      table.priority,
      table.createdAt
    ),
    index("notification_outbox_order_idx").on(table.orderId),
    index("notification_outbox_user_idx").on(table.recipientUserId),
    index("notification_outbox_customer_idx").on(table.recipientCustomerId),
    check(
      "notification_outbox_status_check",
      sql`${table.status} in ('pending', 'processing', 'sent', 'partial', 'skipped', 'dead')`
    ),
    check(
      "notification_outbox_attempts_check",
      sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`
    ),
    check(
      "notification_outbox_priority_check",
      sql`${table.priority} between 0 and 1000`
    )
  ]
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    outboxId: uuid("outbox_id").notNull().references(() => notificationOutbox.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 40 }).notNull(),
    recipientType: varchar("recipient_type", { length: 40 }).notNull(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    recipientCustomerId: uuid("recipient_customer_id").references(() => customers.id, { onDelete: "set null" }),
    recipientRole: varchar("recipient_role", { length: 40 }),
    recipientAddress: varchar("recipient_address", { length: 180 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    providerMessageId: varchar("provider_message_id", { length: 180 }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    uniqueIndex("notification_deliveries_target_uidx").on(
      table.outboxId,
      table.channel,
      table.recipientAddress
    ),
    index("notification_deliveries_ready_idx").on(
      table.channel,
      table.status,
      table.nextAttemptAt,
      table.createdAt
    ),
    index("notification_deliveries_outbox_idx").on(table.outboxId),
    index("notification_deliveries_user_idx").on(table.recipientUserId),
    index("notification_deliveries_customer_idx").on(table.recipientCustomerId),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} in ('pending', 'processing', 'sent', 'skipped', 'failed')`
    ),
    check(
      "notification_deliveries_attempts_check",
      sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`
    )
  ]
);

export const telegramCartItems = pgTable(
  "telegram_cart_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    ...timestamps
  },
  (table) => [
    unique("telegram_cart_items_shop_id_telegram_chat_id_product_id_key").on(
      table.shopId,
      table.telegramChatId,
      table.productId
    ),
    index("idx_telegram_cart_items_chat").on(
      table.shopId,
      table.telegramChatId
    ),
    check(
      "telegram_cart_items_quantity_check",
      sql`${table.quantity} > 0`
    )
  ]
);

export const telegramCheckoutSessions = pgTable(
  "telegram_checkout_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull(),
    step: varchar("step", { length: 80 }).notNull(),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    ...timestamps
  },
  (table) => [
    unique("telegram_checkout_sessions_shop_id_telegram_chat_id_key").on(
      table.shopId,
      table.telegramChatId
    ),
    index("idx_telegram_checkout_sessions_chat").on(
      table.shopId,
      table.telegramChatId
    )
  ]
);
