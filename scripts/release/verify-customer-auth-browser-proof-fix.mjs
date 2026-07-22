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
  '"x-vm-customer-pairing-proof"',
  "browser proof использует стабильный header",
);
requireText(
  service,
  "normalizeCustomerPairingBrowserProof",
  "browser proof валидируется до хеширования",
);
requireText(
  route,
  "browserProof: rawNonce",
  "API возвращает proof только создавшей запрос вкладке",
);
requireText(
  route,
  "request.headers[CUSTOMER_PAIRING_BROWSER_PROOF_HEADER]",
  "status и cancel принимают proof независимо от cookie",
);
requireText(
  account,
  "browserProof: string;",
  "вкладка хранит proof вместе с pairing requestId",
);
requireText(
  account,
  '"x-vm-customer-pairing-proof": pairing.browserProof',
  "polling отправляет proof исходной вкладки",
);
requireText(
  account,
  '"x-vm-customer-pairing-proof": current.browserProof',
  "отмена использует proof текущего запроса",
);
requireText(
  account,
  "!/^[a-f0-9]{48}$/i.test(value.browserProof)",
  "старые sessionStorage-запросы без proof автоматически очищаются",
);
forbidText(
  account,
  "Этот запрос был создан в другой вкладке или уже заменён новым.",
  "ложное сообщение о другой вкладке удалено",
);
forbidText(
  route,
  "Запрос входа открыт в другом браузере",
  "ложное сообщение о другом браузере удалено",
);

console.log("\nCUSTOMER AUTH BROWSER PROOF SOURCE CONTRACT: OK");
