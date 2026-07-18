export const productAvailabilityValues = [
  "available",
  "preorder",
  "unavailable"
] as const;

export type ProductAvailability =
  typeof productAvailabilityValues[number];

export const productTypeValues = [
  "bouquet",
  "arrangement",
  "flowers",
  "card",
  "gift",
  "sweets",
  "toy",
  "vase",
  "balloon",
  "perfume",
  "other"
] as const;

export type ProductType =
  typeof productTypeValues[number];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  )
    ? value as UnknownRecord
    : {};
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function inferAddonCategoryType(value: unknown): ProductType | null {
  const category = normalized(value);

  if (!category) {
    return null;
  }

  if (/открытк|конверт|card/.test(category)) {
    return "card";
  }

  if (/конфет|шоколад|сладост|candy|sweet/.test(category)) {
    return "sweets";
  }

  if (/игруш|toy/.test(category)) {
    return "toy";
  }

  if (/воздушн.*шар|шарик|^шары?$|balloon|^shary?$/.test(category)) {
    return "balloon";
  }

  if (/ваз|vase/.test(category)) {
    return "vase";
  }

  if (/парфюм|духи|perfume/.test(category)) {
    return "perfume";
  }

  if (/^подар|^podark|^gift/.test(category)) {
    return "gift";
  }

  return null;
}

function inferFlowerCategoryType(value: unknown): ProductType | null {
  const category = normalized(value);

  if (!category) {
    return null;
  }

  if (
    /композиц|корзин|короб|шляпн|composition|arrangement|korzin|korob|shlyap/.test(
      category
    )
  ) {
    return "arrangement";
  }

  if (/поштуч|срезанн|отдельн.*цвет|single|stem|srez|poштуч/.test(category)) {
    return "flowers";
  }

  if (
    /букет|цвет|роз|пион|тюльпан|гортенз|гвоздик|эустом|ирис|хризант|лили|орхиде|ромаш|альстромер|ранункул|buket|bouquet|flower|tsvet|cvet|roz|pion|tulip|gorten|gvozd|eustom|iris|hrizant|lili|orchid|romash|alstromer|ranunk/.test(
      category
    )
  ) {
    return "bouquet";
  }

  return null;
}

export function readCatalogMetadata(value: unknown) {
  const root = asRecord(value);
  const catalog = asRecord(root.catalog);

  const rawAvailability = String(
    catalog.availability ?? ""
  ).trim();

  const rawProductType = String(
    catalog.productType ?? ""
  ).trim();

  return {
    availability:
      productAvailabilityValues.includes(
        rawAvailability as ProductAvailability
      )
        ? rawAvailability as ProductAvailability
        : null,

    productType:
      productTypeValues.includes(
        rawProductType as ProductType
      )
        ? rawProductType as ProductType
        : null
  };
}

export function resolveProductAvailability(
  metadata: unknown,
  stockQuantity: unknown
): ProductAvailability {
  const explicit = readCatalogMetadata(
    metadata
  ).availability;

  if (explicit) {
    return explicit;
  }

  const stock = Number(stockQuantity ?? 0);

  return Number.isFinite(stock) && stock > 0
    ? "available"
    : "unavailable";
}

export function inferProductType(
  metadata: unknown,
  ...values: unknown[]
): ProductType {
  const addonCategoryType = inferAddonCategoryType(values[0]);

  if (addonCategoryType) {
    return addonCategoryType;
  }

  const flowerCategoryType = inferFlowerCategoryType(values[0]);

  if (flowerCategoryType) {
    return flowerCategoryType;
  }

  const explicit = readCatalogMetadata(
    metadata
  ).productType;

  if (explicit) {
    return explicit;
  }

  const haystack = values
    .map((value) => normalized(value))
    .join(" ");

  if (/открытк|конверт|card/.test(haystack)) {
    return "card";
  }

  if (/конфет|шоколад|сладост|candy|sweet/.test(haystack)) {
    return "sweets";
  }

  if (/игруш|toy/.test(haystack)) {
    return "toy";
  }

  if (/воздушн.*шар|шарик|balloon/.test(haystack)) {
    return "balloon";
  }

  if (/ваз|vase/.test(haystack)) {
    return "vase";
  }

  if (/парфюм|духи|perfume/.test(haystack)) {
    return "perfume";
  }

  if (/подар|gift/.test(haystack)) {
    return "gift";
  }

  if (/корзин|короб|композиц|arrangement/.test(haystack)) {
    return "arrangement";
  }

  if (/монобукет|поштуч/.test(haystack)) {
    return "flowers";
  }

  if (/букет|bouquet/.test(haystack)) {
    return "bouquet";
  }

  if (/цветы|роза|розы|пион|тюльпан|гортенз|гвоздик|эустом|ирис|хризант|flower/.test(haystack)) {
    return "flowers";
  }

  return "other";
}

export function mergeCatalogMetadata(
  metadata: unknown,
  values: {
    availability: ProductAvailability;
    productType: ProductType;
  }
) {
  const root = asRecord(metadata);

  return {
    ...root,
    catalog: {
      ...asRecord(root.catalog),
      availability: values.availability,
      productType: values.productType
    }
  };
}

export function isPubliclyAvailable(
  metadata: unknown,
  stockQuantity: unknown
) {
  return resolveProductAvailability(
    metadata,
    stockQuantity
  ) === "available";
}
