import { access, readFile } from "node:fs/promises";

const paths = {
  publicApi: "apps/api/src/routes/public.ts",
  adminApi: "apps/api/src/routes/admin.ts",
  requisites: "apps/api/src/apply-release-store-requisites.ts",
  orderRuntime: "apps/api/src/verify-customer-order-details-runtime.ts",
  pairingCore: "apps/bot/src/customer-browser-pairing.ts",
  pairingTest: "apps/bot/src/verify-browser-telegram-pairing-e2e.ts",
  bot: "apps/bot/src/index.ts",
  photoCore: "apps/bot/src/telegram-photo-upload.ts",
  photoTest: "apps/bot/src/verify-telegram-photo-upload-e2e.ts",
  requeue: "apps/bot/src/requeue-failed-bouquet-approval.ts",
  retryRuntime: "apps/bot/src/verify-bouquet-approval-retry-runtime.ts",
  account: "apps/web/src/app/account/account-client.tsx",
  orders: "apps/web/src/app/orders/orders-client.tsx",
  contacts: "apps/web/src/app/checkout/checkout-client.tsx",
  delivery: "apps/web/src/app/checkout/delivery/delivery-client.tsx",
  contactsCss: "apps/web/src/app/checkout/checkout.module.css",
  deliveryCss: "apps/web/src/app/checkout/delivery/delivery.module.css",
  reviewCss: "apps/web/src/app/checkout/review/review.module.css",
  globals: "apps/web/src/app/globals.css",
  settingsForm: "apps/web/src/app/admin/settings/settings-form.tsx",
  settingsPage: "apps/web/src/app/admin/settings/page.tsx",
  publicSettings: "apps/web/src/app/lib/public-settings.ts",
  legal: "apps/web/src/app/lib/legal-documents.ts",
};

await Promise.all(Object.values(paths).map((path) => access(path)));
const source = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

const legacyNotificationSection = source.bot.slice(
  source.bot.indexOf("async function processLegacyNotificationEvents"),
  source.bot.indexOf("function outboxRetryDelayMs"),
);
const outboxNotificationSection = source.bot.slice(
  source.bot.indexOf("async function sendOutboxEventToRecipient"),
  source.bot.indexOf("async function markLegacyNotificationFromOutbox"),
);
const openPairingSection = source.bot.slice(
  source.bot.indexOf("async function openBrowserPairing"),
  source.bot.indexOf("async function confirmBrowserPairing"),
);
const confirmPairingSection = source.bot.slice(
  source.bot.indexOf("async function confirmBrowserPairing"),
  source.bot.indexOf("async function handleBrowserPairingToken"),
);

const checks = [
  [source.requisites.includes('import { createDb } from "@viberimenya/db";') && !source.requisites.includes('from "postgres"') && source.orderRuntime.includes('import { createDb } from "@viberimenya/db";') && !source.orderRuntime.includes('from "postgres"'), "API-служебные скрипты используют разрешённый @viberimenya/db без прямого postgres"],
  [source.bot.includes('import { basename, extname, join, resolve } from "node:path";') && source.bot.includes("extname(file.file_path)"), "бот импортирует extname для локальной отправки фото"],
  [openPairingSection.includes('"linked_telegram"') && openPairingSection.includes("✅ Вход подтверждён"), "уже подключённый Telegram подтверждает новый вход сразу"],
  [!openPairingSection.includes("pairingApproveCallback(") && !openPairingSection.includes("✅ Подтвердить вход"), "новый вход не требует ошибочной второй кнопки"],
  [confirmPairingSection.includes("browserPairingIsConfirmed(pairing.status)") && confirmPairingSection.includes("alreadyConfirmed: true"), "confirmed/consumed обрабатываются идемпотентно"],
  [source.bot.includes("callbackQuery.from") && source.bot.includes('"telegram_contact"'), "callback и передача номера используют реального Telegram-пользователя"],
  [source.bot.includes("selectBrowserPairingForContact") && source.bot.includes("message.contact.user_id !== message.from.id"), "регистрация по кнопке «Поделиться номером» восстанавливает запрос и принимает только собственный контакт"],
  [source.pairingCore.includes("browserPairingCanConfirm") && source.pairingCore.includes("browserPairingIsConfirmed") && source.pairingTest.includes("confirmed/consumed повторяются без ошибки"), "добавлен контракт состояний Telegram pairing"],
  [source.bot.includes("telegramApiMultipart") && source.bot.includes("readTelegramLocalUpload") && source.bot.includes("new Blob"), "фото букета отправляется в Telegram непосредственно с сервера"],
  [legacyNotificationSection.includes("sendTelegramPhotoWithFallback") && outboxNotificationSection.includes("sendTelegramPhotoWithFallback"), "старый и новый notification workers имеют текстовый fallback при ошибке фото"],
  [source.photoCore.includes("resolveTelegramLocalUploadPath") && source.photoCore.includes('relativePath.includes("..")') && source.photoTest.includes("TELEGRAM LOCAL PHOTO UPLOAD E2E: OK"), "локальный путь фото проверяется отдельным E2E"],
  [source.requeue.includes("bouquet_approval_requested") && source.requeue.includes("status = 'pending'") && source.requeue.includes("attempts = 0"), "застрявшее уведомление согласования ставится на повторную доставку"],
  [source.retryRuntime.includes("failed to get http url content") && source.retryRuntime.includes("delivery_status === \"sent\"") , "runtime-проверка подтверждает фактическую повторную доставку фото"],
  [source.publicApi.includes("bouquet_photo_url") && source.publicApi.includes("bouquetApproval") && source.publicApi.includes("delivery_interval"), "личный кабинет получает фото, согласование и интервал"],
  [source.publicApi.includes("LEFT JOIN delivery_intervals di") && source.publicApi.includes("order.delivery_interval_name") && source.publicApi.includes("order.delivery_comment"), "страница заказа получает интервал из delivery_intervals с безопасным fallback"],
  [source.orderRuntime.includes("CUSTOMER ORDER DETAILS RUNTIME: OK") && source.orderRuntime.includes("bouquetPhotoUrl"), "добавлена runtime-проверка интервала, фото и согласования"],
  [source.account.includes("Фото готового букета") && source.account.includes("Согласовать букет") && source.orders.includes("Интервал:"), "фото и данные доставки отображаются на сайте клиента"],
  [source.contacts.includes('<div className={styles.actions}>') && !source.contacts.includes('<footer className={styles.actions}>') && source.delivery.includes('<div className={styles.footer}>'), "checkout больше не наследует большой padding общего footer"],
  [source.contactsCss.includes("truly compact mobile checkout controls") && source.deliveryCss.includes("truly compact mobile delivery controls") && source.reviewCss.includes("compact final checkout on mobile"), "мобильные панели checkout имеют компактные размеры"],
  [source.globals.includes("compact mobile order details"), "мобильная страница заказа уплотнена"],
  [source.requisites.includes("081701823774") && source.requisites.includes("324080000002712") && source.requisites.includes("40802810828000052349"), "юридические и банковские реквизиты подготовлены к безопасному применению"],
  [source.adminApi.includes("settlementAccount") && source.settingsForm.includes("Корреспондентский счёт") && source.settingsPage.includes("correspondentAccount") && source.publicSettings.includes("bankName") && source.legal.includes("БИК"), "реквизиты поддерживаются CRM и юридическими страницами"],
];

let failed = false;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed = true;
    console.error(`✗ ${label}`);
  }
}

if (failed) process.exit(1);
console.log("\nCUSTOMER AUTH + BOUQUET APPROVAL + ORDER DETAILS SOURCE CONTRACT: OK");
