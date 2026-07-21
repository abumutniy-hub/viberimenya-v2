export type WebCheckoutDraftStep =
  | "customer_name"
  | "customer_phone"
  | "recipient_mode"
  | "recipient_name"
  | "recipient_phone"
  | "delivery_type"
  | "delivery_service"
  | "delivery_zone"
  | "delivery_date"
  | "delivery_interval"
  | "delivery_address"
  | "card_text"
  | "surprise"
  | "contact_preference"
  | "payment_method"
  | "promo_code"
  | "bonus"
  | "comment"
  | "privacy"
  | "confirm";

export type WebCheckoutDeliveryProvider = "dadata" | "saved" | "manual";

export type WebCheckoutDeliveryData = {
  deliveryType: "delivery" | "pickup";
  deliveryService: "standard" | "express";
  deliveryZoneId: string;
  deliveryZoneName: string;
  deliveryDateText: string;
  deliveryIntervalId: string;
  deliveryInterval: string;
  deliveryAddress: string;
  deliveryAddressSelected: boolean;
  deliveryAddressProvider: WebCheckoutDeliveryProvider;
  deliveryAddressFiasId: string;
  deliveryAddressKladrId: string;
  deliveryAddressPostalCode: string;
  deliveryAddressRegion: string;
  deliveryAddressCity: string;
  deliveryAddressSettlement: string;
  deliveryAddressStreet: string;
  deliveryAddressHouse: string;
  deliveryAddressBlock: string;
  deliveryAddressLatitude: string;
  deliveryAddressLongitude: string;
  deliveryAddressGeoQuality: string;
  deliveryApartment: string;
  deliveryEntrance: string;
  deliveryFloor: string;
  deliveryIntercom: string;
  deliveryNoApartment: boolean;
  deliveryComment: string;
};

export type WebCheckoutDeliveryIssue = {
  field: keyof WebCheckoutDeliveryData | "delivery";
  message: string;
};

export type WebCheckoutDeliveryValidation = {
  valid: boolean;
  issues: WebCheckoutDeliveryIssue[];
};

export type CheckoutDeliveryZone = {
  id: string;
  name: string;
  price: number;
  freeFromAmount: number | null;
  expressAvailable: boolean;
  expressPrice: number | null;
};

export type CheckoutDeliveryInterval = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
};

export type CheckoutSavedAddress = {
  id: string;
  city: string;
  street: string;
  house: string;
  apartment: string;
  entrance: string;
  floor: string;
  comment: string;
  isDefault: boolean;
};

export type CheckoutDeliveryOptions = {
  pickup: {
    enabled: boolean;
    address: string;
  };
  acceptingOrders: boolean;
  ordersPausedMessage: string;
  zones: CheckoutDeliveryZone[];
  intervals: CheckoutDeliveryInterval[];
  addresses: CheckoutSavedAddress[];
  draftTtlHours: number;
};

export type DeliveryAddressSuggestion = {
  id: string;
  provider: "dadata";
  value: string;
  unrestrictedValue: string;
  postalCode: string;
  countryIsoCode: string;
  region: string;
  regionWithType: string;
  city: string;
  cityWithType: string;
  settlement: string;
  settlementWithType: string;
  street: string;
  streetWithType: string;
  house: string;
  houseType: string;
  block: string;
  blockType: string;
  apartment: string;
  apartmentType: string;
  fiasId: string;
  fiasLevel: string;
  kladrId: string;
  geoLat: string;
  geoLon: string;
  geoQuality: string;
  hasHouse: boolean;
};

const STEP_ORDER: WebCheckoutDraftStep[] = [
  "customer_name",
  "customer_phone",
  "recipient_mode",
  "recipient_name",
  "recipient_phone",
  "delivery_type",
  "delivery_zone",
  "delivery_service",
  "delivery_date",
  "delivery_interval",
  "delivery_address",
  "card_text",
  "surprise",
  "contact_preference",
  "payment_method",
  "promo_code",
  "bonus",
  "comment",
  "privacy",
  "confirm",
];

function text(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function bool(value: unknown) {
  return value === true;
}

function dateIsAllowed(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value >= today && value <= addDaysIso(today, 180);
}

export function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) return value;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function moscowTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}


function moscowClock(now = new Date()) {
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

function intervalEndMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

export function checkoutIntervalAvailableForDate(
  interval: CheckoutDeliveryInterval,
  deliveryDate: string,
  now = new Date(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return false;
  const clock = moscowClock(now);
  if (deliveryDate > clock.date) return true;
  if (deliveryDate < clock.date) return false;
  const end = intervalEndMinutes(interval.endsAt);
  return end !== null && clock.minutes < end;
}

export function availableCheckoutIntervals(
  intervals: CheckoutDeliveryInterval[],
  deliveryDate: string,
  now = new Date(),
) {
  return intervals.filter((interval) =>
    checkoutIntervalAvailableForDate(interval, deliveryDate, now));
}

export function emptyWebCheckoutDeliveryData(): WebCheckoutDeliveryData {
  return {
    deliveryType: "delivery",
    deliveryService: "standard",
    deliveryZoneId: "",
    deliveryZoneName: "",
    deliveryDateText: "",
    deliveryIntervalId: "",
    deliveryInterval: "",
    deliveryAddress: "",
    deliveryAddressSelected: false,
    deliveryAddressProvider: "manual",
    deliveryAddressFiasId: "",
    deliveryAddressKladrId: "",
    deliveryAddressPostalCode: "",
    deliveryAddressRegion: "",
    deliveryAddressCity: "",
    deliveryAddressSettlement: "",
    deliveryAddressStreet: "",
    deliveryAddressHouse: "",
    deliveryAddressBlock: "",
    deliveryAddressLatitude: "",
    deliveryAddressLongitude: "",
    deliveryAddressGeoQuality: "",
    deliveryApartment: "",
    deliveryEntrance: "",
    deliveryFloor: "",
    deliveryIntercom: "",
    deliveryNoApartment: false,
    deliveryComment: "",
  };
}

export function normalizeWebCheckoutDeliveryData(
  value: unknown,
): WebCheckoutDeliveryData {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const empty = emptyWebCheckoutDeliveryData();
  const provider = raw.deliveryAddressProvider === "dadata"
    || raw.deliveryAddressProvider === "saved"
    || raw.deliveryAddressProvider === "manual"
      ? raw.deliveryAddressProvider
      : empty.deliveryAddressProvider;

  return {
    deliveryType: raw.deliveryType === "pickup" ? "pickup" : "delivery",
    deliveryService: raw.deliveryService === "express" ? "express" : "standard",
    deliveryZoneId: text(raw.deliveryZoneId, 80),
    deliveryZoneName: text(raw.deliveryZoneName, 160),
    deliveryDateText: text(raw.deliveryDateText, 10),
    deliveryIntervalId: text(raw.deliveryIntervalId, 80),
    deliveryInterval: text(raw.deliveryInterval, 80),
    deliveryAddress: text(raw.deliveryAddress, 1000),
    deliveryAddressSelected: bool(raw.deliveryAddressSelected),
    deliveryAddressProvider: provider,
    deliveryAddressFiasId: text(raw.deliveryAddressFiasId, 64),
    deliveryAddressKladrId: text(raw.deliveryAddressKladrId, 32),
    deliveryAddressPostalCode: text(raw.deliveryAddressPostalCode, 16),
    deliveryAddressRegion: text(raw.deliveryAddressRegion, 160),
    deliveryAddressCity: text(raw.deliveryAddressCity, 160),
    deliveryAddressSettlement: text(raw.deliveryAddressSettlement, 160),
    deliveryAddressStreet: text(raw.deliveryAddressStreet, 255),
    deliveryAddressHouse: text(raw.deliveryAddressHouse, 60),
    deliveryAddressBlock: text(raw.deliveryAddressBlock, 60),
    deliveryAddressLatitude: text(raw.deliveryAddressLatitude, 32),
    deliveryAddressLongitude: text(raw.deliveryAddressLongitude, 32),
    deliveryAddressGeoQuality: text(raw.deliveryAddressGeoQuality, 8),
    deliveryApartment: text(raw.deliveryApartment, 60),
    deliveryEntrance: text(raw.deliveryEntrance, 60),
    deliveryFloor: text(raw.deliveryFloor, 60),
    deliveryIntercom: text(raw.deliveryIntercom, 120),
    deliveryNoApartment: bool(raw.deliveryNoApartment),
    deliveryComment: text(raw.deliveryComment, 1000),
  };
}

export function savedAddressToDeliveryData(
  address: CheckoutSavedAddress,
): Partial<WebCheckoutDeliveryData> {
  return {
    deliveryAddress: [
      address.city,
      address.street,
      address.house ? `д. ${address.house}` : "",
    ].filter(Boolean).join(", "),
    deliveryAddressSelected: true,
    deliveryAddressProvider: "saved",
    deliveryAddressCity: address.city,
    deliveryAddressStreet: address.street,
    deliveryAddressHouse: address.house,
    deliveryApartment: address.apartment,
    deliveryEntrance: address.entrance,
    deliveryFloor: address.floor,
    deliveryNoApartment: !address.apartment,
    deliveryComment: address.comment,
  };
}

export function suggestionToDeliveryData(
  suggestion: DeliveryAddressSuggestion,
): Partial<WebCheckoutDeliveryData> {
  return {
    deliveryAddress: suggestion.value,
    deliveryAddressSelected: true,
    deliveryAddressProvider: "dadata",
    deliveryAddressFiasId: suggestion.fiasId,
    deliveryAddressKladrId: suggestion.kladrId,
    deliveryAddressPostalCode: suggestion.postalCode,
    deliveryAddressRegion: suggestion.regionWithType || suggestion.region,
    deliveryAddressCity: suggestion.cityWithType || suggestion.city,
    deliveryAddressSettlement:
      suggestion.settlementWithType || suggestion.settlement,
    deliveryAddressStreet: suggestion.streetWithType || suggestion.street,
    deliveryAddressHouse: suggestion.house,
    deliveryAddressBlock: suggestion.block,
    deliveryAddressLatitude: suggestion.geoLat,
    deliveryAddressLongitude: suggestion.geoLon,
    deliveryAddressGeoQuality: suggestion.geoQuality,
    deliveryApartment: suggestion.apartment,
    deliveryNoApartment: false,
  };
}

export function clearStructuredDeliveryAddress(
  addressText: string,
): Partial<WebCheckoutDeliveryData> {
  return {
    deliveryAddress: text(addressText, 1000),
    deliveryAddressSelected: false,
    deliveryAddressProvider: "manual",
    deliveryAddressFiasId: "",
    deliveryAddressKladrId: "",
    deliveryAddressPostalCode: "",
    deliveryAddressRegion: "",
    deliveryAddressCity: "",
    deliveryAddressSettlement: "",
    deliveryAddressStreet: "",
    deliveryAddressHouse: "",
    deliveryAddressBlock: "",
    deliveryAddressLatitude: "",
    deliveryAddressLongitude: "",
    deliveryAddressGeoQuality: "",
    deliveryApartment: "",
    deliveryEntrance: "",
    deliveryFloor: "",
    deliveryIntercom: "",
    deliveryNoApartment: false,
  };
}

export function deliveryAddressDetailsText(
  value: WebCheckoutDeliveryData,
) {
  return [
    !value.deliveryNoApartment && value.deliveryApartment
      ? `кв./офис ${value.deliveryApartment}`
      : value.deliveryNoApartment
        ? "без квартиры"
        : "",
    value.deliveryEntrance ? `подъезд ${value.deliveryEntrance}` : "",
    value.deliveryFloor ? `этаж ${value.deliveryFloor}` : "",
    value.deliveryIntercom ? `домофон ${value.deliveryIntercom}` : "",
  ].filter(Boolean).join(", ");
}

export function validateWebCheckoutDelivery(
  value: WebCheckoutDeliveryData,
  options: CheckoutDeliveryOptions,
  today = moscowTodayIso(),
): WebCheckoutDeliveryValidation {
  const issues: WebCheckoutDeliveryIssue[] = [];

  if (value.deliveryType === "pickup") {
    if (!options.pickup.enabled) {
      issues.push({
        field: "deliveryType",
        message: "Самовывоз сейчас недоступен",
      });
    }

    return { valid: issues.length === 0, issues };
  }

  if (!options.zones.some((zone) => zone.id === value.deliveryZoneId)) {
    issues.push({
      field: "deliveryZoneId",
      message: "Выберите доступную зону доставки",
    });
  }

  const zone = options.zones.find((item) => item.id === value.deliveryZoneId);
  if (
    value.deliveryService === "express"
    && (!zone?.expressAvailable || Number(zone.expressPrice || 0) <= 0)
  ) {
    issues.push({
      field: "deliveryService",
      message: "Срочная доставка недоступна для выбранной зоны",
    });
  }

  if (!dateIsAllowed(value.deliveryDateText, today)) {
    issues.push({
      field: "deliveryDateText",
      message: "Выберите дату от сегодняшнего дня до 180 дней вперёд",
    });
  }

  const selectedInterval = options.intervals.find(
    (interval) => interval.id === value.deliveryIntervalId,
  );
  if (!selectedInterval) {
    issues.push({
      field: "deliveryIntervalId",
      message: "Выберите доступный интервал доставки",
    });
  } else if (!checkoutIntervalAvailableForDate(
    selectedInterval,
    value.deliveryDateText,
  )) {
    issues.push({
      field: "deliveryIntervalId",
      message: "Этот интервал уже закончился. Выберите другое время",
    });
  }

  if (value.deliveryAddress.length < 5) {
    issues.push({
      field: "deliveryAddress",
      message: "Введите город, улицу и дом",
    });
  } else if (!value.deliveryAddressSelected) {
    issues.push({
      field: "deliveryAddress",
      message: "Выберите адрес из подсказок или подтвердите ручной ввод",
    });
  }

  if (
    value.deliveryAddressProvider === "dadata"
    && !value.deliveryAddressHouse
  ) {
    issues.push({
      field: "deliveryAddress",
      message: "Выберите подсказку с номером дома",
    });
  }

  if (!value.deliveryNoApartment && !value.deliveryApartment) {
    issues.push({
      field: "deliveryApartment",
      message: "Укажите квартиру/офис или отметьте, что квартиры нет",
    });
  }

  return { valid: issues.length === 0, issues };
}

export function buildWebCheckoutDeliveryPatch(
  value: WebCheckoutDeliveryData,
  options: CheckoutDeliveryOptions,
) {
  const zone = options.zones.find((item) => item.id === value.deliveryZoneId);
  const interval = options.intervals.find(
    (item) => item.id === value.deliveryIntervalId,
  );

  if (value.deliveryType === "pickup") {
    return {
      deliveryType: "pickup" as const,
      deliveryService: "standard" as const,
      deliveryZoneId: "",
      deliveryZoneName: "",
      deliveryDateText: "",
      deliveryIntervalId: "",
      deliveryInterval: "",
      deliveryAddress: options.pickup.address,
      deliveryAddressSelected: true,
      deliveryAddressProvider: "manual" as const,
      deliveryAddressFiasId: "",
      deliveryAddressKladrId: "",
      deliveryAddressPostalCode: "",
      deliveryAddressRegion: "",
      deliveryAddressCity: "",
      deliveryAddressSettlement: "",
      deliveryAddressStreet: "",
      deliveryAddressHouse: "",
      deliveryAddressBlock: "",
      deliveryAddressLatitude: "",
      deliveryAddressLongitude: "",
      deliveryAddressGeoQuality: "",
      deliveryApartment: "",
      deliveryEntrance: "",
      deliveryFloor: "",
      deliveryIntercom: "",
      deliveryNoApartment: true,
      deliveryComment: value.deliveryComment,
    };
  }

  return {
    ...value,
    deliveryZoneName: zone?.name || value.deliveryZoneName,
    deliveryInterval: interval?.name || value.deliveryInterval,
    deliveryApartment: value.deliveryNoApartment ? "" : value.deliveryApartment,
  };
}

export function webCheckoutDeliveryFingerprint(
  value: WebCheckoutDeliveryData,
  options: CheckoutDeliveryOptions,
) {
  return JSON.stringify(buildWebCheckoutDeliveryPatch(value, options));
}

export function nextWebCheckoutDeliveryStep(
  value: WebCheckoutDeliveryData,
  options: CheckoutDeliveryOptions,
): WebCheckoutDraftStep {
  if (value.deliveryType === "pickup") return "card_text";
  if (!value.deliveryZoneId) return "delivery_zone";
  if (!value.deliveryDateText) return "delivery_date";
  if (!value.deliveryIntervalId) return "delivery_interval";

  const validation = validateWebCheckoutDelivery(value, options);
  return validation.valid ? "card_text" : "delivery_address";
}

export function preserveWebCheckoutDeliveryStep(
  current: WebCheckoutDraftStep | null | undefined,
  desired: WebCheckoutDraftStep,
): WebCheckoutDraftStep {
  if (!current) return desired;

  const currentIndex = STEP_ORDER.indexOf(current);
  const desiredIndex = STEP_ORDER.indexOf(desired);

  if (currentIndex < 0) return desired;
  if (desiredIndex < 0) return current;
  return currentIndex > desiredIndex ? current : desired;
}
