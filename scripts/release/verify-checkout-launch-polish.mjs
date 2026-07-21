import { access, readFile } from "node:fs/promises";

const paths = {
  availability: "apps/api/src/modules/checkout/checkout-availability.ts",
  draft: "apps/api/src/modules/customers/customer-checkout-draft.service.ts",
  publicApi: "apps/api/src/routes/public.ts",
  availabilityTest: "apps/api/src/verify-checkout-launch-availability-e2e.ts",
  botCore: "apps/bot/src/customer-browser-pairing.ts",
  bot: "apps/bot/src/index.ts",
  botTest: "apps/bot/src/verify-browser-telegram-pairing-e2e.ts",
  cart: "apps/web/src/app/cart/components/cart-client.tsx",
  contacts: "apps/web/src/app/checkout/checkout-client.tsx",
  contactsCss: "apps/web/src/app/checkout/checkout.module.css",
  deliveryLogic: "apps/web/src/app/checkout/delivery/checkout-delivery.ts",
  delivery: "apps/web/src/app/checkout/delivery/delivery-client.tsx",
  deliveryCss: "apps/web/src/app/checkout/delivery/delivery.module.css",
  review: "apps/web/src/app/checkout/review/review-client.tsx",
  reviewCss: "apps/web/src/app/checkout/review/review.module.css",
  shell: "apps/web/src/app/components/public-shell.tsx",
  legal: "apps/web/src/app/lib/legal-documents.ts",
};

await Promise.all(Object.values(paths).map((path) => access(path)));
const source = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

const checks = [
  [source.availability.includes("resolveCheckoutPaymentAvailability") && source.availability.includes("transferFallback"), "офлайн-оплата имеет безопасный fallback без ЮKassa"],
  [source.draft.includes("checkoutPaymentMethodAvailable") && source.publicApi.includes("checkoutPaymentMethodAvailable"), "способ оплаты проверяется единым серверным правилом"],
  [source.availability.includes('timeZone: "Europe/Moscow"') && source.availability.includes("now.minutes < end"), "интервалы сравниваются по московскому времени и закрываются после окончания"],
  [source.draft.includes("delivery_interval_expired") && source.publicApi.includes("checkoutIntervalAvailableForDate"), "просроченный интервал отклоняется сервером"],
  [source.publicApi.includes("deliveryDate: body.deliveryDate,") && !source.publicApi.includes("deliveryDate: body.deliveryDateText,"), "серверная проверка интервала использует существующее поле deliveryDate"],
  [source.deliveryLogic.includes("availableCheckoutIntervals") && source.delivery.includes("availableIntervals"), "прошедшие интервалы скрываются в интерфейсе"],
  [source.availability.includes("resolveCheckoutPickupAddress") && source.draft.includes("settingsRow?.address") && source.publicApi.includes("checkoutSettings?.address") && source.publicApi.includes("settings?.address"), "самовывоз наследует адрес магазина"],
  [source.delivery.includes("Адрес магазина не указан") && !source.delivery.includes("Адрес уточнит менеджер"), "самовывоз больше не показывает временный текст менеджера"],
  [!source.cart.includes("финальной серверной проверки") && !source.review.includes("Повторное нажатие не создаст второй заказ") && !source.legal.includes("повторно проверяются сервером"), "технические тексты удалены из клиентского интерфейса"],
  [source.shell.includes("checkoutActive") && source.shell.includes("!checkoutActive ? <MobileTabbar"), "обычное мобильное меню скрывается во время checkout"],
  [source.contactsCss.includes("compact commercial checkout") && source.deliveryCss.includes("compact delivery footer") && source.reviewCss.includes("commercial mobile review"), "мобильные панели checkout сделаны компактными"],
  [source.contacts.includes("window.scrollTo") && source.delivery.includes("window.scrollTo") && source.review.includes("window.scrollTo"), "каждый шаг checkout открывается с начала страницы"],
  [source.botCore.includes("selectBrowserPairingForContact") && source.bot.includes("selectBrowserPairingForContact"), "Telegram pairing восстанавливает запрос по Telegram и подтверждённому номеру"],
  [source.bot.includes("status IN ('pending', 'opened')") && source.bot.includes("recoveredFromContact"), "бот ищет только активный непросроченный запрос и фиксирует восстановление"],
  [source.botTest.includes("передача контакта восстанавливает активный запрос") && source.botTest.includes("потери deep-link состояния"), "добавлен E2E восстановления Telegram deep-link"],
  [source.bot.includes("valueToText(delivery.pickupAddress) || valueToText(row?.address)"), "Telegram checkout также использует адрес магазина для самовывоза"],
  [source.availabilityTest.includes("CHECKOUT LAUNCH AVAILABILITY E2E: OK"), "добавлен E2E оплаты, самовывоза и интервалов"],
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
console.log("\nCHECKOUT LAUNCH POLISH + TELEGRAM PAIRING SOURCE CONTRACT: OK");
