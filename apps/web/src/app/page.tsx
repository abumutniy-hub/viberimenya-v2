import styles from "./home-redesign.module.css";

import {
  ProcessCarousel
} from "./components/process-carousel";

export const dynamic =
  "force-dynamic";

type ShopSettings = {
  phone?: string | null;
  address?: string | null;
  workHours?: string | null;
};

type Category = {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
};

type HomeResponse = {
  settings: ShopSettings | null;
  sections: {
    hero: {
      title: string;
      subtitle: string;
    };
    occasions: string[];
    categories: Category[];
  };
};

type DeliveryResponse = {
  zones: Array<{
    name: string;
    description?: string | null;
    price: number;
    freeFromAmount?: number | null;
    isExpressAvailable: boolean;
    expressPrice?: number | null;
  }>;
  intervals: Array<{
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
};

type FeatureIconName =
  | "flower"
  | "camera"
  | "delivery"
  | "fresh"
  | "personal"
  | "time"
  | "support";

const fallbackCategories:
  Category[] = [
    {
      slug: "bukety",
      name: "Букеты",
      description:
        "Готовые композиции для важных событий и тёплых слов."
    },
    {
      slug: "tsvety-po-shtuchno",
      name: "Цветы поштучно",
      description:
        "Соберите индивидуальный букет из любимых цветов."
    },
    {
      slug: "korziny",
      name: "Корзины",
      description:
        "Объёмные цветочные композиции для особенных случаев."
    },
    {
      slug: "podarki",
      name: "Подарки",
      description:
        "Красивые дополнения к букету и приятные детали."
    },
    {
      slug: "otkrytki",
      name: "Открытки",
      description:
        "Добавьте к заказу личное пожелание."
    },
    {
      slug: "aktsii",
      name: "Акции",
      description:
        "Сезонные подборки и специальные предложения."
    }
  ];

const heroImageUrl =
  "/uploads/products/"
  + "product-6ba05e24-075c-4217-b448-eb96aa0c49b3-"
  + "728ad608-1e78-43e8-b0e0-ebb0ec0813dc.webp";

async function fetchJson<T>(
  path: string
): Promise<T | null> {
  const baseUrl =
    process.env.API_INTERNAL_URL
    ?? "http://127.0.0.1:4001";

  try {
    const response =
      await fetch(
        `${baseUrl}${path}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      return null;
    }

    return (
      await response.json()
    ) as T;
  } catch {
    return null;
  }
}

function FeatureIcon({
  name
}: {
  name: FeatureIconName;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap:
      "round" as const,
    strokeLinejoin:
      "round" as const,
    "aria-hidden": true
  };

  if (name === "camera") {
    return (
      <svg {...common}>
        <path d="M4 7.5h3l1.3-2h7.4l1.3 2h3v11H4Z" />
        <circle cx="12" cy="13" r="3.4" />
      </svg>
    );
  }

  if (name === "delivery") {
    return (
      <svg {...common}>
        <path d="M3 6h11v10H3Z" />
        <path d="M14 9h3.5l3 3v4H14Z" />
        <circle cx="7" cy="18" r="1.4" />
        <circle cx="17.5" cy="18" r="1.4" />
      </svg>
    );
  }

  if (name === "fresh") {
    return (
      <svg {...common}>
        <path d="M12 21V9" />
        <path d="M12 11C8 11 5.2 8.9 5.2 5.6 8.7 5.1 12 7 12 11Z" />
        <path d="M12 15c4 0 6.8-2.1 6.8-5.4-3.5-.5-6.8 1.4-6.8 5.4Z" />
      </svg>
    );
  }

  if (name === "personal") {
    return (
      <svg {...common}>
        <path d="M6 19c1-4 3.1-6 6-6s5 2 6 6" />
        <circle cx="12" cy="7.5" r="3" />
        <path d="m17.5 4 .8 1.6L20 6.4l-1.7.8-.8 1.6-.8-1.6-1.7-.8 1.7-.8Z" />
      </svg>
    );
  }

  if (name === "time") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    );
  }

  if (name === "support") {
    return (
      <svg {...common}>
        <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
        <path d="M4 13h3v6H5.5A1.5 1.5 0 0 1 4 17.5Z" />
        <path d="M20 13h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5Z" />
        <path d="M17 19c-1 1.3-2.7 2-5 2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 21v-8" />
      <path d="M12 13c-4 0-6.8-2.2-6.8-5.5C8.7 7 12 9 12 13Z" />
      <path d="M12 13c4 0 6.8-2.2 6.8-5.5C15.3 7 12 9 12 13Z" />
      <path d="M12 9c-2.5-1.2-3.4-3.7-2-6.2 2.6.8 4.2 3.4 2 6.2Z" />
    </svg>
  );
}

function formatMoney(
  value: number
) {
  return value.toLocaleString(
    "ru-RU"
  );
}

export default async function HomePage() {
  const [
    home,
    delivery
  ] = await Promise.all([
    fetchJson<HomeResponse>(
      "/api/public/home"
    ),
    fetchJson<DeliveryResponse>(
      "/api/public/delivery"
    )
  ]);

  const title =
    home?.sections.hero.title
    ?? "Цветы, которые говорят за вас";

  const subtitle =
    home?.sections.hero.subtitle
    ?? (
      "Собираем стильные букеты, "
      + "отправляем фото перед доставкой "
      + "и бережно доставляем получателю."
    );

  const categories =
    home?.sections.categories
    && home.sections.categories.length > 0
      ? home.sections.categories
      : fallbackCategories;

  const occasions =
    home?.sections.occasions
    && home.sections.occasions.length > 0
      ? home.sections.occasions.slice(
          0,
          8
        )
      : [
          "Любимой",
          "Маме",
          "День рождения",
          "Извиниться",
          "Без повода",
          "Свадьба",
          "Выписка",
          "Учителю"
        ];

  const zones =
    delivery?.zones ?? [];

  const intervals =
    delivery?.intervals ?? [];

  const firstZone =
    zones[0];

  const firstInterval =
    intervals[0];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            Цветочная мастерская
          </span>

          <h1>{title}</h1>

          <p>
            {subtitle}
          </p>

          <div className={styles.heroActions}>
            <a
              href="/catalog"
              className={styles.primaryButton}
            >
              Выбрать букет
            </a>

            <a
              href="/cart"
              className={styles.secondaryButton}
            >
              Оформить заказ
            </a>
          </div>

          <div
            className={styles.heroFacts}
            aria-label="Условия заказа"
          >
            <span>
              <FeatureIcon name="camera" />
              Фото перед доставкой
            </span>

            <span>
              <FeatureIcon name="time" />

              {firstInterval
                ? (
                  `Ближайший интервал: ${
                    firstInterval.name
                  }`
                )
                : "Удобные интервалы"}
            </span>

            <span>
              <FeatureIcon name="delivery" />

              {firstZone
                ? (
                  `Доставка от ${
                    formatMoney(
                      firstZone.price
                    )
                  } ₽`
                )
                : "Доставка по городу"}
            </span>
          </div>
        </div>

        <a
          href="/product/n1"
          className={styles.heroVisual}
          aria-label="Посмотреть букет Нежные розы"
        >
          <img
            src={heroImageUrl}
            alt="Нежный букет роз"
          />

          <span className={styles.heroOverlay}>
            <strong>
              Нежные розы
            </strong>

            <em>
              Смотреть
            </em>
          </span>
        </a>
      </section>

      <section
        className={styles.primaryBenefits}
        aria-label="Преимущества магазина"
      >
        <article>
          <span className={styles.benefitIcon}>
            <FeatureIcon name="flower" />
          </span>

          <div>
            <strong>
              Стильные букеты
            </strong>

            <p>
              Авторские композиции
              из свежих цветов
              на любой случай.
            </p>
          </div>
        </article>

        <article>
          <span className={styles.benefitIcon}>
            <FeatureIcon name="camera" />
          </span>

          <div>
            <strong>
              Фото перед доставкой
            </strong>

            <p>
              Покажем готовый букет,
              чтобы вы были уверены
              в результате.
            </p>
          </div>
        </article>

        <article>
          <span className={styles.benefitIcon}>
            <FeatureIcon name="delivery" />
          </span>

          <div>
            <strong>
              Бережная доставка
            </strong>

            <p>
              Аккуратно упакуем
              и доставим в выбранный
              интервал.
            </p>
          </div>
        </article>
      </section>

      <section
        className={styles.serviceStrip}
        aria-label="Наш сервис"
      >
        <article>
          <FeatureIcon name="fresh" />

          <div>
            <strong>
              Свежие цветы
            </strong>

            <span>
              Бережно отбираем
              каждую композицию
            </span>
          </div>
        </article>

        <article>
          <FeatureIcon name="personal" />

          <div>
            <strong>
              Индивидуальный подход
            </strong>

            <span>
              Учитываем пожелания
              и бюджет
            </span>
          </div>
        </article>

        <article>
          <FeatureIcon name="time" />

          <div>
            <strong>
              Удобное время
            </strong>

            <span>
              Выбирайте подходящий
              интервал доставки
            </span>
          </div>
        </article>

        <article>
          <FeatureIcon name="support" />

          <div>
            <strong>
              Всегда на связи
            </strong>

            <span>
              Поможем с выбором
              и заказом
            </span>
          </div>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <span>
            Быстрый выбор
          </span>

          <h2>
            По поводу
          </h2>
        </div>

        <div className={styles.occasionGrid}>
          {occasions.map(
            occasion => (
              <a
                key={occasion}
                href={
                  "/catalog?occasion="
                  + encodeURIComponent(
                    occasion
                  )
                }
              >
                {occasion}
              </a>
            )
          )}
        </div>
      </section>

      <section
        className={styles.section}
        id="catalog"
      >
        <div className={styles.sectionHeading}>
          <span>
            Каталог
          </span>

          <h2>
            Разделы
          </h2>

          <p>
            Букеты, цветы поштучно,
            подарки и сезонные подборки.
          </p>
        </div>

        <div className={styles.categoryGrid}>
          {categories
            .slice(0, 6)
            .map(
              (
                category,
                index
              ) => (
                <a
                  key={category.slug}
                  href={
                    "/catalog?category="
                    + category.slug
                  }
                  className={
                    index === 0
                      ? styles.categoryPrimary
                      : undefined
                  }
                >
                  <span>
                    {String(
                      index + 1
                    ).padStart(
                      2,
                      "0"
                    )}
                  </span>

                  <strong>
                    {category.name}
                  </strong>

                  <p>
                    {category.description
                      ?? (
                        "Подборка цветов "
                        + "и композиций"
                      )}
                  </p>

                  <em>
                    Смотреть
                  </em>
                </a>
              )
            )}
        </div>
      </section>

      <section
        className={styles.deliverySection}
        id="delivery"
      >
        <div className={styles.sectionHeading}>
          <span>
            Доставка
          </span>

          <h2>
            Привезём аккуратно
          </h2>

          <p>
            Выберите зону и подходящий
            интервал при оформлении заказа.
          </p>
        </div>

        <div className={styles.deliveryPanel}>
          {zones
            .slice(0, 3)
            .map(
              zone => (
                <div
                  className={styles.deliveryRow}
                  key={zone.name}
                >
                  <div>
                    <strong>
                      {zone.name}
                    </strong>

                    <span>
                      {zone.description
                        ?? "Доступная зона доставки"}
                    </span>
                  </div>

                  <b>
                    {zone.price === 0
                      ? "Бесплатно"
                      : (
                        `${formatMoney(
                          zone.price
                        )} ₽`
                      )}
                  </b>
                </div>
              )
            )}

          <div className={styles.intervalGrid}>
            {intervals
              .slice(0, 6)
              .map(
                interval => (
                  <span key={interval.name}>
                    {interval.name}
                  </span>
                )
              )}
          </div>
        </div>
      </section>

      <div className={styles.processSection}>
        <ProcessCarousel />
      </div>

      <section className={styles.closingBanner}>
        <div>
          <span>
            Выбери Меня
          </span>

          <h2>
            Букет, который
            запомнится
          </h2>

          <p>
            Выберите композицию,
            укажите получателя
            и удобное время доставки.
          </p>
        </div>

        <a href="/catalog">
          Перейти в каталог
        </a>
      </section>
    </div>
  );
}
