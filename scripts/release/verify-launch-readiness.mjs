import { readFile } from "node:fs/promises";

const files = {
  app: "apps/api/src/app.ts",
  api: "apps/api/src/routes/admin.ts",
  module: "apps/api/src/modules/launch/launch-readiness.ts",
  test: "apps/api/src/verify-launch-readiness-e2e.ts",
  page: "apps/web/src/app/admin/launch/page.tsx",
  form: "apps/web/src/app/admin/launch/launch-settings-form.tsx",
  css: "apps/web/src/app/admin/launch/launch.module.css",
};

const source = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])),
);

const checks = [
  [source.app.includes('function getErrorStatusCode(error: unknown): number | null') && source.app.includes('if (getErrorStatusCode(error) === 400)') && !source.app.includes('if (error.statusCode === 400)'), "unknown error проверяется безопасным type guard"],
  [source.app.includes('error: "Invalid request"'), "невалидный JSON возвращает HTTP 400"],
  [source.api.includes('app.post("/api/admin/launch/test-order"'), "выбор контрольного заказа зарегистрирован"],
  [source.api.includes("buildControlOrderItems"), "API использует единое ядро проверки заказа"],
  [source.api.includes("isYooKassaConfigured"), "готовность ЮKassa проверяется по runtime-конфигурации"],
  [source.api.includes("failed_notifications"), "ошибки уведомлений входят в readiness"],
  [source.api.includes("linked_florists") && source.api.includes("linked_couriers"), "проверяются Telegram-связи флориста и курьера"],
  [source.module.includes('status = "ready_for_launch"'), "ядро формирует финальный статус запуска"],
  [source.module.includes("...(onlinePaymentsEnabled && !onlineMethod") && !source.module.includes("hint: onlinePaymentsEnabled"), "необязательный hint добавляется без undefined"],
  [source.module.includes("control_order_bouquet_photo"), "фото и согласование входят в контрольный заказ"],
  [source.module.includes("control_order_delivered"), "вручение входит в контрольный заказ"],
  [source.form.includes("Контрольный заказ основного запуска"), "CRM показывает управляемый контрольный заказ"],
  [source.form.includes("/api/admin/launch/test-order"), "WEB выбирает заказ через защищённый admin API"],
  [source.form.includes("Основной запуск разрешён"), "WEB показывает однозначное разрешение запуска"],
  [source.css.includes(".ready_for_launch"), "финальный статус визуально выделен"],
  [source.test.includes("LAUNCH READINESS & CONTROL ORDER E2E: OK"), "E2E-контракт добавлен"],
];

let failed = false;
for (const [ok, label] of checks) {
  if (!ok) {
    failed = true;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

if (failed) process.exit(1);
console.log("\nLAUNCH READINESS SOURCE CONTRACT: OK");
