import {
  checkoutIntervalAvailableForDate,
  checkoutPaymentMethodAvailable,
  resolveCheckoutPaymentAvailability,
  resolveCheckoutPickupAddress,
} from "./modules/checkout/checkout-availability";

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
  console.log(`✓ ${message}`);
}

const offline = resolveCheckoutPaymentAvailability({
  onlineEnabled: false,
  cashEnabled: false,
  transferEnabled: false,
  yooKassaConfigured: false,
});
assert(offline.transfer, "при отключённой ЮKassa остаётся оплата после подтверждения");
assert(!offline.online, "онлайн-оплата не показывается без ЮKassa");
assert(checkoutPaymentMethodAvailable("transfer_after_confirm", offline), "fallback оплаты принимается сервером");
assert(resolveCheckoutPickupAddress("", "Москва, ул. Тестовая, 1") === "Москва, ул. Тестовая, 1", "самовывоз использует адрес магазина");
const now = new Date("2026-07-21T17:00:00.000Z");
assert(!checkoutIntervalAvailableForDate({ deliveryDate: "2026-07-21", intervalEndsAt: "20:00", now }), "завершившийся интервал сегодня закрыт");
assert(checkoutIntervalAvailableForDate({ deliveryDate: "2026-07-21", intervalEndsAt: "22:00", now }), "будущий интервал сегодня доступен");
assert(checkoutIntervalAvailableForDate({ deliveryDate: "2026-07-22", intervalEndsAt: "13:00", now }), "интервалы будущей даты доступны");
console.log("\nCHECKOUT LAUNCH AVAILABILITY E2E: OK");
