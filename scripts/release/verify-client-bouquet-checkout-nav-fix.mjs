import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function requireText(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`Не найден контракт: ${label}`);
  }
  console.log(`✓ ${label}`);
}

const shell = read("apps/web/src/app/components/public-shell.tsx");
const mobileTabbar = read("apps/web/src/app/components/mobile-tabbar.tsx");
const account = read("apps/web/src/app/account/account-client.tsx");
const orders = read("apps/web/src/app/orders/orders-client.tsx");
const controls = read("apps/web/src/app/components/customer-bouquet-approval.tsx");
const checkout = read("apps/web/src/app/checkout/checkout.module.css");
const delivery = read("apps/web/src/app/checkout/delivery/delivery.module.css");
const review = read("apps/web/src/app/checkout/review/review.module.css");
const photoRuntime = read("apps/api/src/verify-client-bouquet-photo-runtime.ts");
const bot = read("apps/bot/src/index.ts");

requireText(shell, "<MobileTabbar settings={settings} />", "нижнее меню включено и на checkout");
if (shell.includes("!checkoutActive ? <MobileTabbar")) {
  throw new Error("MobileTabbar всё ещё отключается на checkout");
}
console.log("✓ checkout больше не скрывает MobileTabbar");
requireText(mobileTabbar, 'pathname.startsWith("/checkout")', "checkout отмечает корзину активной в нижнем меню");
requireText(account, "CustomerBouquetApproval", "согласование добавлено в профиль");
requireText(orders, "CustomerBouquetApproval", "согласование добавлено в Мои заказы");
requireText(controls, "✓ Одобряю", "кнопка одобрения существует");
requireText(controls, "Нужна правка", "кнопка правки существует");
requireText(controls, "/bouquet-approval", "используется существующий защищённый endpoint заказа");
requireText(checkout, "bottom: calc(84px + env(safe-area-inset-bottom))", "checkout action bar поднят над меню");
requireText(delivery, "bottom: calc(84px + env(safe-area-inset-bottom))", "delivery action bar поднят над меню");
requireText(review, "padding-bottom: calc(104px + env(safe-area-inset-bottom))", "review имеет отступ под меню");
requireText(photoRuntime, 'contentTypeHeader.split(";", 1)[0] ?? ""', "runtime photo MIME parser совместим со strict TypeScript");
requireText(bot, 'import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";', "бот импортирует chmod для публичных загрузок");
requireText(bot, 'await mkdir(uploadDir, { recursive: true, mode: 0o755 });', "бот создаёт каталог фото с mode 0755");
requireText(bot, 'await chmod(uploadDir, 0o755);', "бот исправляет права существующего каталога фото");
requireText(bot, 'await writeFile(fullPath, Buffer.from(arrayBuffer), { mode: 0o644 });', "бот сохраняет публичное фото с mode 0644");
requireText(bot, 'await chmod(fullPath, 0o644);', "бот закрепляет права чтения публичного фото");

console.log("CLIENT BOUQUET + CHECKOUT NAV + UPLOAD PERMISSIONS SOURCE CONTRACT: OK");
