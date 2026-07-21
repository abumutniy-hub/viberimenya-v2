import {
  buildWebCheckoutCustomerRecipientPatch,
  normalizeWebCheckoutPhone,
  preserveWebCheckoutProgressStep,
  validateWebCheckoutCustomerRecipient,
  webCheckoutContactFingerprint,
} from "./checkout-customer-recipient";

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
  normalizeWebCheckoutPhone("8 (999) 111-22-33") === "+79991112233",
  "Российский телефон не нормализован",
);
pass("телефон нормализуется одинаково для сайта и API");

const invalid = validateWebCheckoutCustomerRecipient({
  customerName: "A",
  customerPhone: "123",
  customerEmail: "wrong",
  contactPreference: "call_or_message",
  recipientSameAsCustomer: false,
  recipientName: "",
  recipientPhone: "",
  isSurprise: false,
  doNotCallRecipient: false,
});
assertCondition(!invalid.valid, "Неполные контакты приняты");
assertCondition(invalid.issues.length === 5, "Ожидалось пять ошибок контактов");
pass("клиентская проверка находит все обязательные ошибки");

const self = validateWebCheckoutCustomerRecipient({
  customerName: "Анна",
  customerPhone: "89991112233",
  customerEmail: "anna@example.test",
  contactPreference: "messenger_only",
  recipientSameAsCustomer: true,
  recipientName: "Старое имя",
  recipientPhone: "123",
  isSurprise: true,
  doNotCallRecipient: true,
});
assertCondition(self.valid, "Режим «Получатель — я» не прошёл проверку");
assertCondition(
  self.normalized.recipientName === "Анна"
    && self.normalized.recipientPhone === "+79991112233",
  "Данные покупателя не перенесены получателю",
);
assertCondition(
  self.normalized.isSurprise === false
    && self.normalized.doNotCallRecipient === false,
  "Несовместимые флаги получателя не сброшены",
);
pass("режим «Получатель — я» создаёт согласованный patch");

const patch = buildWebCheckoutCustomerRecipientPatch({
  customerName: "  Анна  ",
  customerPhone: "8 999 111 22 33",
  customerEmail: " anna@example.test ",
  contactPreference: "phone_call",
  recipientSameAsCustomer: false,
  recipientName: "  Мария  ",
  recipientPhone: "8 999 444 55 66",
  isSurprise: true,
  doNotCallRecipient: true,
});
assertCondition(
  patch.customerName === "Анна"
    && patch.customerPhone === "+79991112233"
    && patch.customerEmail === "anna@example.test"
    && patch.recipientName === "Мария"
    && patch.recipientPhone === "+79994445566",
  "Patch не нормализован",
);
pass("server patch не содержит пробелов и ненормализованных телефонов");

assertCondition(
  preserveWebCheckoutProgressStep("recipient_phone") === "delivery_type",
  "Ранний шаг не переведён к доставке",
);
assertCondition(
  preserveWebCheckoutProgressStep("payment_method") === "payment_method",
  "Более поздний Telegram progress ошибочно отброшен назад",
);
pass("редактирование контактов не откатывает более поздний progress");

const firstFingerprint = webCheckoutContactFingerprint({
  customerName: "Анна",
  customerPhone: "+79991112233",
  customerEmail: "",
  contactPreference: "call_or_message",
  recipientSameAsCustomer: true,
  recipientName: "Анна",
  recipientPhone: "+79991112233",
  isSurprise: false,
  doNotCallRecipient: false,
});
const secondFingerprint = webCheckoutContactFingerprint({
  customerName: " Анна ",
  customerPhone: "8 999 111-22-33",
  customerEmail: "",
  contactPreference: "call_or_message",
  recipientSameAsCustomer: true,
  recipientName: "Игнорируется",
  recipientPhone: "Игнорируется",
  isSurprise: true,
  doNotCallRecipient: true,
});
assertCondition(
  firstFingerprint === secondFingerprint,
  "Эквивалентные данные создают разные fingerprints",
);
pass("автосохранение не дублирует эквивалентные изменения");

console.log("\nWEB CHECKOUT CLIENT CONTACTS E2E: OK");
console.log(
  "Проверены нормализация, validation, recipient mode, progress и autosave fingerprint.",
);
