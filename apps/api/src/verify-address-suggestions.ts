import {
  normalizeDaDataAddressSuggestion,
} from "./modules/delivery/address-suggestions.service";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const normalized = normalizeDaDataAddressSuggestion({
  value: "г Москва, ул Тверская, д 10",
  unrestricted_value: "101000, г Москва, ул Тверская, д 10",
  data: {
    postal_code: "101000",
    country_iso_code: "RU",
    region: "Москва",
    region_with_type: "г Москва",
    city: "Москва",
    city_with_type: "г Москва",
    street: "Тверская",
    street_with_type: "ул Тверская",
    house: "10",
    house_type: "д",
    fias_id: "test-fias-id",
    fias_level: "8",
    kladr_id: "7700000000000",
    geo_lat: "55.757",
    geo_lon: "37.615",
    qc_geo: "0",
  },
});

assertCondition(normalized, "Российский адрес не нормализован");
assertCondition(
  normalized.house === "10"
    && normalized.hasHouse
    && normalized.fiasId === "test-fias-id"
    && normalized.geoLat === "55.757",
  "Структурированные поля адреса потеряны",
);
pass("ответ провайдера нормализуется без передачи лишних данных");

const foreign = normalizeDaDataAddressSuggestion({
  value: "Berlin",
  data: { country_iso_code: "DE" },
});
assertCondition(foreign === null, "Иностранный адрес не отфильтрован");
pass("подсказки ограничены российскими адресами");

const first = normalizeDaDataAddressSuggestion({
  value: "г Москва, ул Тверская, д 10",
  data: { country_iso_code: "RU", fias_id: "same", house: "10" },
});
const second = normalizeDaDataAddressSuggestion({
  value: "г Москва, ул Тверская, д 10",
  data: { country_iso_code: "RU", fias_id: "same", house: "10" },
});
assertCondition(first?.id === second?.id, "ID подсказки нестабилен");
pass("одинаковая подсказка получает стабильный безопасный ID");

console.log("\nADDRESS SUGGESTIONS NORMALIZATION E2E: OK");
