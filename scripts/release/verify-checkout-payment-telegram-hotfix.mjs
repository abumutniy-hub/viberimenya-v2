import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const availability = read("apps/api/src/modules/checkout/checkout-availability.ts");
const review = read("apps/web/src/app/checkout/review/checkout-review.ts");
const pairing = read("apps/bot/src/customer-browser-pairing.ts");
const bot = read("apps/bot/src/index.ts");

check(
  availability.includes("const transferFallback = !online && !configuredTransfer;"),
  "перевод после подтверждения включается как fallback при недоступной онлайн-оплате",
);
check(
  review.includes('if (options.transfer || !options.online) methods.push("transfer_after_confirm");'),
  "WEB всегда предлагает перевод после подтверждения, когда онлайн-оплата недоступна",
);
check(
  pairing.includes("^pair_([a-z0-9_-]{16,64})$"),
  "Telegram deep-link принимает совместимый безопасный payload",
);
check(
  bot.includes("tokens.token IN (${storedToken}, ${rawToken})"),
  "бот поддерживает хешированный и совместимый legacy token",
);
check(
  bot.includes("tokens.metadata ->> 'manualCodeHash' = ${codeHash}"),
  "бот поддерживает оба формата хеша резервного кода",
);
check(
  bot.includes("Ссылка входа не распознана, но активный запрос можно восстановить."),
  "при сбое deep-link бот предлагает восстановление через подтверждённый номер",
);
const earlyCode = bot.indexOf("const browserPairingHandled =\n      await handleBrowserPairingCode(message, text);");
const checkout = bot.indexOf("const checkoutHandled = await handleCheckoutMessage(message, text);");
check(earlyCode >= 0 && checkout >= 0 && earlyCode < checkout, "резервный код входа проверяется до активного Telegram-checkout");

console.log("\nCHECKOUT PAYMENT + TELEGRAM PAIRING HOTFIX SOURCE CONTRACT: OK");
