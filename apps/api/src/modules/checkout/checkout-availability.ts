export type CheckoutPaymentAvailability = {
  online: boolean;
  cash: boolean;
  transfer: boolean;
  transferFallback: boolean;
};

export function resolveCheckoutPaymentAvailability(params: {
  onlineEnabled: boolean | null | undefined;
  cashEnabled: boolean | null | undefined;
  transferEnabled: boolean | null | undefined;
  yooKassaConfigured: boolean;
}): CheckoutPaymentAvailability {
  const online = params.onlineEnabled === true && params.yooKassaConfigured;
  const cash = params.cashEnabled !== false;
  const configuredTransfer = params.transferEnabled !== false;
  const transferFallback = !online && !cash && !configuredTransfer;

  return {
    online,
    cash,
    transfer: configuredTransfer || transferFallback,
    transferFallback,
  };
}

export function checkoutPaymentMethodAvailable(
  method: string,
  availability: CheckoutPaymentAvailability,
) {
  if (method === "cash_on_delivery") return availability.cash;
  if (method === "transfer_after_confirm") return availability.transfer;
  if (method === "online_card" || method === "sbp") return availability.online;
  return false;
}

export function resolveCheckoutPickupAddress(
  configuredPickupAddress: unknown,
  shopAddress: unknown,
) {
  const pickup = typeof configuredPickupAddress === "string"
    ? configuredPickupAddress.trim()
    : "";
  const store = typeof shopAddress === "string" ? shopAddress.trim() : "";
  return pickup || store;
}

function moscowParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function timeMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

export function checkoutIntervalAvailableForDate(params: {
  deliveryDate: string;
  intervalEndsAt: string;
  now?: Date;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.deliveryDate)) return false;
  const now = moscowParts(params.now || new Date());
  if (params.deliveryDate > now.date) return true;
  if (params.deliveryDate < now.date) return false;
  const end = timeMinutes(params.intervalEndsAt);
  if (end === null) return false;
  return now.minutes < end;
}
