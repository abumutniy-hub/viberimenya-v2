export const CATEGORY_ICON_OPTIONS = [
  {
    key: "bouquet",
    label: "Букет"
  },
  {
    key: "flower",
    label: "Цветок"
  },
  {
    key: "basket",
    label: "Корзина"
  },
  {
    key: "gift",
    label: "Подарок"
  },
  {
    key: "card",
    label: "Открытка"
  },
  {
    key: "sale",
    label: "Акция"
  },
  {
    key: "subscription",
    label: "Подписка"
  },
  {
    key: "perfume",
    label: "Парфюм"
  },
  {
    key: "other",
    label: "Другое"
  }
] as const;

export type CategoryIconKey =
  typeof CATEGORY_ICON_OPTIONS[number]["key"];

export function isCategoryIconKey(
  value: string
): value is CategoryIconKey {
  return CATEGORY_ICON_OPTIONS.some(
    (option) => option.key === value
  );
}

export function defaultCategoryIconKeyForSlug(
  value: string
): CategoryIconKey {
  const slug = value
    .trim()
    .toLocaleLowerCase("ru-RU");

  if (
    slug.includes("buket")
    || slug.includes("bouquet")
  ) {
    return "bouquet";
  }

  if (
    slug.includes("tsvet")
    || slug.includes("flower")
    || slug.includes("rose")
  ) {
    return "flower";
  }

  if (
    slug.includes("korzin")
    || slug.includes("basket")
  ) {
    return "basket";
  }

  if (
    slug.includes("podar")
    || slug.includes("gift")
  ) {
    return "gift";
  }

  if (
    slug.includes("otkryt")
    || slug.includes("card")
  ) {
    return "card";
  }

  if (
    slug.includes("akts")
    || slug.includes("sale")
    || slug.includes("skid")
  ) {
    return "sale";
  }

  if (
    slug.includes("podpisk")
    || slug.includes("subscription")
  ) {
    return "subscription";
  }

  if (
    slug.includes("parfy")
    || slug.includes("perfume")
    || slug.includes("aromat")
  ) {
    return "perfume";
  }

  return "other";
}

export function categoryIconKeyFromImageUrl(
  value: string,
  slug = ""
): CategoryIconKey {
  const storedValue = value.trim();

  if (storedValue.startsWith("icon:")) {
    const key = storedValue.slice(5);

    if (isCategoryIconKey(key)) {
      return key;
    }
  }

  return defaultCategoryIconKeyForSlug(slug);
}

export function CategoryIcon({
  iconKey,
  className
}: {
  iconKey: CategoryIconKey;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (iconKey) {
    case "bouquet":
      return (
        <svg {...common}>
          <path d="M8 20 11 12" />
          <path d="m16 20-3-8" />
          <path d="m10 20 2-8" />
          <circle cx="8" cy="8" r="3" />
          <circle cx="13" cy="6" r="3" />
          <circle cx="16" cy="10" r="3" />
          <path d="M8 20h8" />
        </svg>
      );

    case "flower":
      return (
        <svg {...common}>
          <circle cx="12" cy="11" r="2.2" />
          <path d="M12 8c-2-4 2-6 3-3 1 2-1 3-3 3Z" />
          <path d="M15 11c4-2 6 2 3 3-2 1-3-1-3-3Z" />
          <path d="M12 14c2 4-2 6-3 3-1-2 1-3 3-3Z" />
          <path d="M9 11c-4 2-6-2-3-3 2-1 3 1 3 3Z" />
          <path d="M12 17v4" />
        </svg>
      );

    case "basket":
      return (
        <svg {...common}>
          <path d="M4 10h16l-2 10H6L4 10Z" />
          <path d="M8 10c0-4 2-6 4-6s4 2 4 6" />
          <path d="M8 14v3" />
          <path d="M12 14v3" />
          <path d="M16 14v3" />
        </svg>
      );

    case "gift":
      return (
        <svg {...common}>
          <path d="M4 10h16v10H4V10Z" />
          <path d="M3 7h18v4H3V7Z" />
          <path d="M12 7v13" />
          <path d="M12 7H8.5C6 7 6 3 8.5 3 10.5 3 12 7 12 7Z" />
          <path d="M12 7h3.5C18 7 18 3 15.5 3 13.5 3 12 7 12 7Z" />
        </svg>
      );

    case "card":
      return (
        <svg {...common}>
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2"
          />
          <path d="m7 9 5 4 5-4" />
          <path d="M8 16h8" />
        </svg>
      );

    case "sale":
      return (
        <svg {...common}>
          <path d="M3 12 12 3h7v7l-9 9-7-7Z" />
          <circle cx="16" cy="7" r="1" />
          <path d="m8 14 6-6" />
          <circle cx="8.5" cy="9.5" r=".8" />
          <circle cx="13.5" cy="14.5" r=".8" />
        </svg>
      );

    case "subscription":
      return (
        <svg {...common}>
          <path d="M7 7a7 7 0 0 1 11 2" />
          <path d="m18 5 .5 4-4-.5" />
          <path d="M17 17a7 7 0 0 1-11-2" />
          <path d="m6 19-.5-4 4 .5" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );

    case "perfume":
      return (
        <svg {...common}>
          <path d="M9 3h6" />
          <path d="M10 3v4h4V3" />
          <path d="M9 7h6l2 3v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l2-3Z" />
          <path d="M7 13h10" />
          <path d="M15 5h3" />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
          <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z" />
          <path d="m6 14 .8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14Z" />
        </svg>
      );
  }
}
