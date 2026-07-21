import { createHash } from "node:crypto";
import { env } from "../../lib/env";

const DADATA_ADDRESS_SUGGEST_URL =
  "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address";

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

type FetchLike = typeof fetch;

type DaDataSuggestion = {
  value?: unknown;
  unrestricted_value?: unknown;
  data?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum)
    : "";
}

function suggestionId(parts: unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}

export function normalizeDaDataAddressSuggestion(
  value: unknown,
): DeliveryAddressSuggestion | null {
  const raw = record(value) as DaDataSuggestion;
  const data = record(raw.data);
  const displayValue = text(raw.value, 1000);
  const unrestrictedValue = text(raw.unrestricted_value, 1200) || displayValue;
  const countryIsoCode = text(data.country_iso_code, 8).toUpperCase();

  if (!displayValue || (countryIsoCode && countryIsoCode !== "RU")) {
    return null;
  }

  const fiasId = text(data.fias_id, 64);
  const kladrId = text(data.kladr_id, 32);
  const house = text(data.house, 60);
  const block = text(data.block, 60);
  const apartment = text(data.flat, 60);

  return {
    id: suggestionId([
      fiasId,
      kladrId,
      house,
      block,
      apartment,
      unrestrictedValue,
    ]),
    provider: "dadata",
    value: displayValue,
    unrestrictedValue,
    postalCode: text(data.postal_code, 16),
    countryIsoCode: countryIsoCode || "RU",
    region: text(data.region, 160),
    regionWithType: text(data.region_with_type, 200),
    city: text(data.city, 160),
    cityWithType: text(data.city_with_type, 200),
    settlement: text(data.settlement, 160),
    settlementWithType: text(data.settlement_with_type, 200),
    street: text(data.street, 255),
    streetWithType: text(data.street_with_type, 300),
    house,
    houseType: text(data.house_type, 20),
    block,
    blockType: text(data.block_type, 20),
    apartment,
    apartmentType: text(data.flat_type, 20),
    fiasId,
    fiasLevel: text(data.fias_level, 8),
    kladrId,
    geoLat: text(data.geo_lat, 32),
    geoLon: text(data.geo_lon, 32),
    geoQuality: text(data.qc_geo, 8),
    hasHouse: Boolean(house || text(data.stead, 60)),
  };
}

export class AddressSuggestionProviderError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "AddressSuggestionProviderError";
    this.statusCode = statusCode;
  }
}

export async function suggestDeliveryAddresses(
  params: {
    query: string;
    count?: number;
    fetcher?: FetchLike;
  },
) {
  const token = env.DADATA_API_TOKEN.trim();
  const query = params.query.trim().replace(/\s+/g, " ").slice(0, 300);
  const count = Math.max(1, Math.min(10, Math.trunc(params.count ?? 7)));

  if (!token) {
    return {
      configured: false,
      suggestions: [] as DeliveryAddressSuggestion[],
    };
  }

  if (query.length < 3) {
    return {
      configured: true,
      suggestions: [] as DeliveryAddressSuggestion[],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.DADATA_REQUEST_TIMEOUT_MS,
  );
  const fetcher = params.fetcher ?? fetch;
  const requestBody: Record<string, unknown> = {
    query,
    count,
    language: "ru",
    division: "administrative",
    from_bound: { value: "city" },
    to_bound: { value: "house" },
  };

  if (env.DADATA_LOCATION_BOOST_KLADR_ID) {
    requestBody.locations_boost = [{
      kladr_id: env.DADATA_LOCATION_BOOST_KLADR_ID,
    }];
  }

  try {
    const response = await fetcher(DADATA_ADDRESS_SUGGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const providerMessage = response.status === 401 || response.status === 403
        ? "Проверьте API-ключ DaData и дневной лимит"
        : response.status === 429
          ? "Сервис адресов временно ограничил частоту запросов"
          : "Сервис адресов временно недоступен";

      throw new AddressSuggestionProviderError(providerMessage, 502);
    }

    const payload = await response.json() as { suggestions?: unknown };
    const suggestions = (Array.isArray(payload.suggestions)
      ? payload.suggestions
      : [])
      .map(normalizeDaDataAddressSuggestion)
      .filter((item): item is DeliveryAddressSuggestion => Boolean(item))
      .filter((item) => item.countryIsoCode === "RU")
      .slice(0, count);

    return { configured: true, suggestions };
  } catch (error) {
    if (error instanceof AddressSuggestionProviderError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new AddressSuggestionProviderError(
        "Сервис адресов не ответил вовремя",
        504,
      );
    }

    throw new AddressSuggestionProviderError(
      "Не удалось получить подсказки адреса",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
