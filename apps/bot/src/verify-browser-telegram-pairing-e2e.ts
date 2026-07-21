import {
  hashBrowserPairingCode,
  hashBrowserPairingToken,
  isPairingManualCode,
  pairingApproveCallback,
  pairingCancelCallback,
  pairingPhoneMatches,
  parsePairingStartPayload,
  selectBrowserPairingForContact,
} from "./customer-browser-pairing";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const rawToken = "0123456789abcdef0123456789abcdef";
const rawCode = "482731";

assertCondition(
  hashBrowserPairingToken(rawToken)
    === "sha256:9add9e927d3f78767034ce01e8af3366f9bd6603c80f0503f0e03a015994c0ac",
  "Pairing token hash context changed",
);
assertCondition(
  hashBrowserPairingCode(rawCode)
    === "sha256:d8b3878faa7403f80e9a560c0210efcddfb6ab49c2dcc8b75d5185aefa2248c2",
  "Pairing code hash context changed",
);
pass("bot и API используют стабильные SHA-256 contexts");

assertCondition(
  parsePairingStartPayload(`pair_${rawToken}`) === rawToken,
  "Deep-link payload не разобран",
);
assertCondition(
  parsePairingStartPayload("pair_invalid") === "",
  "Некорректный deep-link принят",
);
assertCondition(
  isPairingManualCode("482 731"),
  "Резервный код не распознан",
);
assertCondition(
  !isPairingManualCode("48273"),
  "Короткий код принят",
);
pass("deep-link и шестизначный fallback-код валидируются");

assertCondition(
  pairingPhoneMatches("+7 999 123-45-67", "8 (999) 123-45-67"),
  "Эквивалентные российские номера не совпали",
);
assertCondition(
  !pairingPhoneMatches("+7 999 123-45-67", "+7 999 123-45-68"),
  "Разные номера были приняты",
);
pass("номер Telegram обязан совпасть с номером сайта");

const recoveredPairing = selectBrowserPairingForContact(
  [
    { phone: "+7 999 123-45-67", metadata: {} },
    {
      phone: "+7 999 123-45-67",
      metadata: { candidateTelegramId: "123456" },
    },
  ],
  "123456",
  "8 (999) 123-45-67",
);
assertCondition(
  recoveredPairing !== null,
  "Активный запрос не восстановлен после передачи контакта",
);
assertCondition(
  recoveredPairing?.metadata
    && typeof recoveredPairing.metadata === "object"
    && (recoveredPairing.metadata as Record<string, unknown>).candidateTelegramId === "123456",
  "Не выбран запрос, открытый этим Telegram",
);
const recoveredWithoutDeepLink = selectBrowserPairingForContact(
  [{ phone: "+7 999 123-45-67", metadata: {} }],
  "999999",
  "+7 999 123-45-67",
);
assertCondition(
  recoveredWithoutDeepLink !== null,
  "Запрос не восстановлен по совпавшему номеру после потери deep-link состояния",
);
pass("передача контакта восстанавливает активный запрос даже после сбоя deep-link");

const pairingId = "00000000-0000-4000-8000-000000000123";
assertCondition(
  pairingApproveCallback(pairingId)
    === `pair:approve:${pairingId}`,
  "Approve callback сформирован неверно",
);
assertCondition(
  pairingCancelCallback(pairingId)
    === `pair:cancel:${pairingId}`,
  "Cancel callback сформирован неверно",
);
assertCondition(
  pairingApproveCallback(pairingId).length <= 64,
  "Approve callback превышает лимит Telegram",
);
assertCondition(
  pairingCancelCallback(pairingId).length <= 64,
  "Cancel callback превышает лимит Telegram",
);
pass("callback data укладывается в лимит Telegram");

console.log("");
console.log("BROWSER TELEGRAM PAIRING BOT E2E: OK");
console.log(
  "Проверены hash compatibility, deep-link, код, телефон и callback limits.",
);
console.log("Реальные Telegram-сообщения не отправлялись.");
