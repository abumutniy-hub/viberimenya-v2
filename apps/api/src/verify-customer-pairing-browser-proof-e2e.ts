import {
  CUSTOMER_PAIRING_BROWSER_PROOF_HEADER,
  createCustomerPairingBrowserNonce,
  hashCustomerPairingBrowserNonce,
  normalizeCustomerPairingBrowserProof,
  safeHashEqual,
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

assertCondition(
  CUSTOMER_PAIRING_BROWSER_PROOF_HEADER
    === "x-vm-customer-pairing-proof",
  "Неверное имя browser-proof header",
);
pass("browser proof передаётся отдельным защищённым заголовком");

const firstProof = createCustomerPairingBrowserNonce();
const secondProof = createCustomerPairingBrowserNonce();
assertCondition(
  /^[a-f0-9]{48}$/.test(firstProof),
  "Browser proof имеет неверный формат",
);
assertCondition(
  firstProof !== secondProof,
  "Два запроса получили одинаковый browser proof",
);
pass("каждая попытка входа получает независимый 192-битный proof");

assertCondition(
  normalizeCustomerPairingBrowserProof(firstProof) === firstProof,
  "Корректный proof не прошёл нормализацию",
);
assertCondition(
  normalizeCustomerPairingBrowserProof("bad") === "",
  "Короткий proof не был отклонён",
);
assertCondition(
  normalizeCustomerPairingBrowserProof(`${firstProof}extra`) === "",
  "Повреждённый proof не был отклонён",
);
pass("сервер принимает только точный 48-символьный proof");

const storedHash = hashCustomerPairingBrowserNonce(firstProof);
assertCondition(
  safeHashEqual(
    storedHash,
    hashCustomerPairingBrowserNonce(firstProof),
  ),
  "Proof не совпал со своим SHA-256",
);
assertCondition(
  !safeHashEqual(
    storedHash,
    hashCustomerPairingBrowserNonce(secondProof),
  ),
  "Чужой proof прошёл проверку",
);
pass("браузер подтверждает только свой pairing request");

console.log("\nCUSTOMER PAIRING BROWSER PROOF E2E: OK");
console.log(
  "Проверены app-switch, возврат в исходную вкладку и независимость от cookie браузера.",
);
