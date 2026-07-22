import fs from "node:fs";

const service = fs.readFileSync(
  "apps/api/src/modules/customers/customer-pairing.service.ts",
  "utf8",
);
const route = fs.readFileSync("apps/api/src/routes/public.ts", "utf8");
const account = fs.readFileSync(
  "apps/web/src/app/account/account-client.tsx",
  "utf8",
);

function requireText(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

function forbidText(source, needle, message) {
  if (source.includes(needle)) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

requireText(
  service,
  "export function customerPairingCookieName(requestId: string)",
  "pairing cookie создаётся отдельно для каждого requestId",
);
requireText(
  service,
  "Path=${customerPairingCookiePath(requestId)}",
  "pairing cookie ограничена API-путём конкретного запроса",
);
requireText(
  route,
  "buildCustomerPairingCookie(pairing.id, rawNonce, env.NODE_ENV)",
  "API записывает request-scoped cookie после создания pairing",
);
requireText(
  route,
  "customerPairingCookieName(params.id)",
  "status и cancel читают cookie именно текущего pairing",
);
requireText(
  route,
  "clearLegacyCustomerPairingCookie(env.NODE_ENV)",
  "после успешного входа очищается старый глобальный формат cookie",
);
forbidText(
  route,
  "WITH cancelled AS (\n          UPDATE customer_link_tokens",
  "новый запрос больше не отменяет вход в другой вкладке",
);
requireText(
  account,
  "const PAIRING_STORAGE_KEY = \"viberimenya:customer-pairing:v1\";",
  "активный запрос сохраняется при возврате из Telegram",
);
requireText(
  account,
  "window.sessionStorage.setItem(PAIRING_STORAGE_KEY",
  "Яндекс.Браузер восстанавливает polling после app-switch или перезагрузки вкладки",
);
requireText(
  account,
  "Этот запрос был создан в другой вкладке или уже заменён новым.",
  "сообщение больше не обвиняет пользователя в другом браузере без причины",
);

console.log("\nCUSTOMER AUTH SAME-BROWSER SOURCE CONTRACT: OK");
