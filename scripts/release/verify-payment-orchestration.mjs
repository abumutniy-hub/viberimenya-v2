#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const checks = [
  [
    "apps/web/src/app/checkout/review/checkout-review.ts",
    [
      'if (options.online) methods.push("online_card", "sbp")',
      'methods.push("transfer_after_confirm")',
    ],
  ],
  [
    "apps/web/src/app/checkout/review/review-client.tsx",
    [
      "Картой после подтверждения",
      "Перевод по реквизитам вручную",
      "кнопка оплаты появится автоматически",
    ],
  ],
  [
    "apps/api/src/routes/admin.ts",
    [
      '/api/admin/orders/:id/payment/yookassa',
      "createOrReuseYooKassaPayment",
      "У заказа уже есть активная ручная ссылка оплаты",
      'const channels: Array<"telegram" | "max">',
    ],
  ],
  [
    "apps/web/src/app/admin/orders/order-actions.tsx",
    [
      "prepareYooKassaPayment",
      "Создать оплату ЮKassa",
      "paymentMethod === \"transfer_after_confirm\"",
    ],
  ],
  [
    "apps/web/src/app/order/track/[token]/track-client.tsx",
    [
      "const intervalMs = waitingForOnlinePayment ? 5000 : 30000",
      "Перейти к оплате",
    ],
  ],
  [
    "apps/bot/src/index.ts",
    [
      "Картой после подтверждения",
      "💳 Оплатить заказ",
      "https://platform-api2.max.ru",
      "processMaxNotificationEvents",
      'type: "inline_keyboard"',
    ],
  ],
  [
    "apps/api/src/routes/payments.ts",
    [
      "payment_link_added",
      "channel = 'max'",
      "maxNotificationsEnabled",
    ],
  ],
  [
    "apps/api/src/modules/orders/order-payment.service.ts",
    [
      'import { env } from "../../lib/env"',
      "'order_paid'",
      "'max'",
      "maxNotificationsEnabled",
    ],
  ],
];

for (const [file, fragments] of checks) {
  const content = await readFile(file, "utf8");

  for (const fragment of fragments) {
    if (!content.includes(fragment)) {
      throw new Error(`${file}: missing contract fragment: ${fragment}`);
    }
  }
}

const admin = await readFile("apps/api/src/routes/admin.ts", "utf8");
const confirmGuard = /result\.changed\s*&&\s*\(result\.paymentMethod/.test(admin);
if (confirmGuard) {
  throw new Error("Admin confirm still blocks idempotent payment retry behind result.changed");
}

console.log("PAYMENT ORCHESTRATION SOURCE CONTRACT: OK");
