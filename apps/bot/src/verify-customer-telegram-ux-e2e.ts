import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CUSTOMER_MENU_TEXT,
  clientMainKeyboard,
  customerLinkInstructions,
  isCustomerMenuCommand,
  unlinkedMainKeyboard,
} from "./customer-telegram-ux";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const linked = clientMainKeyboard();
const unlinked = unlinkedMainKeyboard();

assertCondition(linked.keyboard.length === 2, "Меню клиента занимает больше двух рядов");
assertCondition(
  linked.keyboard.every((row) => row.length === 3),
  "Компактное меню должно содержать три кнопки в каждом ряду",
);
assertCondition(linked.resize_keyboard === true, "resize_keyboard не включён");
assertCondition(linked.one_time_keyboard === true, "one_time_keyboard не включён");
assertCondition(linked.is_persistent === false, "Меню ошибочно сделано постоянным");
assertCondition(
  !linked.keyboard.flat().some((button) => String(button.text) === CUSTOMER_MENU_TEXT.link),
  "Кнопка привязки не должна постоянно занимать главное меню",
);
assertCondition(
  JSON.stringify(linked) === JSON.stringify(unlinked),
  "Непривязанный клиент должен получать такое же компактное меню",
);
pass("главное клиентское меню компактное и автоматически сворачивается");

for (const command of Object.values(CUSTOMER_MENU_TEXT)) {
  assertCondition(
    isCustomerMenuCommand(command),
    `Команда меню не распознана: ${command}`,
  );
}
assertCondition(isCustomerMenuCommand("/menu"), "Команда /menu не распознана");
assertCondition(!isCustomerMenuCommand("Иван"), "Произвольное имя распознано как команда меню");
assertCondition(!isCustomerMenuCommand("+79991234567"), "Телефон распознан как команда меню");
pass("команды меню отделены от текстовых полей оформления");

const instructions = customerLinkInstructions();
assertCondition(instructions.includes("показан на сайте"), "Нет клиентской инструкции с сайта");
assertCondition(!/crm|сотрудник|администратор/i.test(instructions), "Клиенту показана внутренняя CRM-инструкция");
pass("текст привязки не раскрывает внутренние инструкции сотрудников");

const indexPath = resolve(process.cwd(), "src/index.ts");
const source = await readFile(indexPath, "utf8");
const menuRouterPosition = source.indexOf("const customerMenuHandled = await handleCustomerMenuCommand");
const checkoutRouterPosition = source.indexOf("const checkoutHandled = await handleCheckoutMessage(message, text)");

assertCondition(menuRouterPosition >= 0, "Глобальный router меню не найден");
assertCondition(checkoutRouterPosition >= 0, "Router оформления не найден");
assertCondition(
  menuRouterPosition < checkoutRouterPosition,
  "Оформление обрабатывает текст раньше глобального меню",
);
assertCondition(
  source.includes("Черновик оформления сохранён."),
  "Нет сохранения и восстановления checkout draft",
);
assertCondition(
  source.includes('callback_data: "checkout:resume"'),
  "Нет кнопки продолжения оформления",
);
assertCondition(
  source.includes('request_contact: true'),
  "Нет безопасной кнопки передачи собственного телефона",
);
pass("кнопки меню не могут стать именем или телефоном в checkout");

assertCondition(
  source.includes("/api/public/categories"),
  "Telegram не использует единый публичный сервис категорий",
);
assertCondition(
  source.includes("Раздел больше недоступен. Каталог обновлён."),
  "Старые кнопки категорий не обновляют каталог",
);
assertCondition(
  source.includes("Товар больше недоступен. Каталог обновлён."),
  "Старые кнопки товаров не обрабатываются безопасно",
);
pass("Telegram-каталог использует API сайта и обновляет устаревшие кнопки");

console.log("\nCUSTOMER TELEGRAM UX E2E: OK");
console.log("Проверены компактное меню, checkout router, клиентские тексты и catalog parity.");
console.log("Реальные Telegram-сообщения не отправлялись.");
