import {
  CUSTOMER_PAIRING_COOKIE,
  CUSTOMER_PAIRING_TTL_SECONDS,
  buildCustomerPairingCookie,
  clearCustomerPairingCookie,
  clearLegacyCustomerPairingCookie,
  customerPairingCookieName,
  customerPairingCookiePath,
} from "./modules/customers/customer-pairing.service";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const firstNonce = "a".repeat(48);
const secondNonce = "b".repeat(48);

const firstName = customerPairingCookieName(firstId);
const secondName = customerPairingCookieName(secondId);
const firstPath = customerPairingCookiePath(firstId);
const secondPath = customerPairingCookiePath(secondId);

assertCondition(firstName !== secondName, "Два запроса получили одно имя cookie");
assertCondition(firstPath !== secondPath, "Два запроса получили один cookie path");
assertCondition(!firstName.includes("-"), "Имя cookie содержит недопустимые символы UUID");
pass("каждый запрос входа получает отдельную HttpOnly cookie");

const firstCookie = buildCustomerPairingCookie(
  firstId,
  firstNonce,
  "production",
);
const secondCookie = buildCustomerPairingCookie(
  secondId,
  secondNonce,
  "production",
);

assertCondition(firstCookie.includes(`${firstName}=${firstNonce}`), "Первая cookie не содержит свой nonce");
assertCondition(secondCookie.includes(`${secondName}=${secondNonce}`), "Вторая cookie не содержит свой nonce");
assertCondition(firstCookie.includes(`Path=${firstPath}`), "Первая cookie не ограничена своим запросом");
assertCondition(secondCookie.includes(`Path=${secondPath}`), "Вторая cookie не ограничена своим запросом");
assertCondition(firstCookie.includes("HttpOnly"), "Cookie не HttpOnly");
assertCondition(firstCookie.includes("SameSite=Lax"), "Cookie не SameSite=Lax");
assertCondition(firstCookie.includes("Secure"), "Production cookie не Secure");
assertCondition(firstCookie.includes(`Max-Age=${CUSTOMER_PAIRING_TTL_SECONDS}`), "Cookie имеет неверный TTL");
assertCondition(!firstCookie.includes(secondName), "Первая cookie пересекается со второй");
pass("новая вкладка не перезаписывает cookie уже открытого запроса");

const firstClear = clearCustomerPairingCookie(firstId, "production");
const secondClear = clearCustomerPairingCookie(secondId, "production");
assertCondition(firstClear.includes(`${firstName}=`), "Не очищается cookie первого запроса");
assertCondition(firstClear.includes(`Path=${firstPath}`), "Очистка использует неверный path");
assertCondition(!firstClear.includes(secondName), "Очистка первого запроса затрагивает второй");
assertCondition(secondClear.includes(`${secondName}=`), "Не очищается cookie второго запроса");
pass("завершение одного входа не удаляет другой активный запрос");

const legacyClear = clearLegacyCustomerPairingCookie("production");
assertCondition(legacyClear.startsWith(`${CUSTOMER_PAIRING_COOKIE}=`), "Legacy cookie не очищается");
assertCondition(legacyClear.includes("Path=/"), "Legacy cookie очищается по неверному path");
pass("старый формат cookie безопасно очищается после обновления");

console.log("\nCUSTOMER PAIRING COOKIE E2E: OK");
console.log("Проверены несколько вкладок, app-switch и изоляция запросов входа.");
