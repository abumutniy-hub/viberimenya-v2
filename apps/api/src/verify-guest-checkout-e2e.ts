import {
  createGuestCheckoutToken,
  GUEST_CHECKOUT_COOKIE,
  GUEST_CHECKOUT_TTL_SECONDS,
  guestCheckoutScopeId,
  validGuestCheckoutToken,
} from "./modules/customers/customer-guest-checkout.service";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

const firstToken = createGuestCheckoutToken();
const secondToken = createGuestCheckoutToken();

check(GUEST_CHECKOUT_COOKIE === "vm_guest_checkout", "гостевой checkout использует отдельную cookie");
check(GUEST_CHECKOUT_TTL_SECONDS === 24 * 60 * 60, "гостевой checkout живёт 24 часа");
check(validGuestCheckoutToken(firstToken), "создаётся криптографический токен из 64 hex-символов");
check(firstToken !== secondToken, "два гостя получают разные токены");
check(!validGuestCheckoutToken("123456"), "короткий и повреждённый токен отклоняется");

const firstScope = guestCheckoutScopeId(firstToken);
const repeatedScope = guestCheckoutScopeId(firstToken.toUpperCase());
const secondScope = guestCheckoutScopeId(secondToken);

check(firstScope === repeatedScope, "одна cookie получает стабильную серверную область корзины и черновика");
check(firstScope !== secondScope, "разные гости не разделяют корзину и черновик");
check(/^-[1-9][0-9]*$/.test(firstScope), "гостевая область хранится как отрицательный bigint");
check(BigInt(firstScope) < 0n, "гостевая область не пересекается с положительными Telegram ID");

let invalidRejected = false;
try {
  guestCheckoutScopeId("not-a-token");
} catch {
  invalidRejected = true;
}
check(invalidRejected, "сервер не создаёт область из неподписанного произвольного значения");

console.log("\nGUEST CHECKOUT IDENTITY E2E: OK");
console.log("Проверены cookie, TTL, изоляция гостей и отсутствие коллизий с Telegram ID.");
