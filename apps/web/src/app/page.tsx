import styles from "./home-redesign.module.css";

import { ProcessCarousel } from "./components/process-carousel";
import {
  AddToCartButton,
  FavoriteButton
} from "./components/add-to-cart-button";
import { ProductTileImage } from "./components/product-tile-image";
import { HomeFeaturedCarousel } from "./components/home-featured-carousel";

export const dynamic = "force-dynamic";

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
  imageUrl?: string | null;
  productCount?: number;
};

type HomeProduct = {
  id: string;
  categoryId?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  oldPrice?: number | null;
  availability: "available" | "preorder" | "unavailable";
  productType?: string | null;
  isFeatured?: boolean;
  primaryImage?: {
    url: string;
    alt?: string | null;
  } | null;
};

type HomeResponse = {
  settings: ShopSettings | null;
  sections: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
      imageUrl?: string | null;
      primaryCtaLabel: string;
      secondaryCtaLabel: string;
      benefits: Array<{
        title: string;
        text: string;
      }>;
    };
    categories: Category[];
    quickCollections?: {
      under5000?: number;
      between5000And10000?: number;
      over10000?: number;
      featured?: number;
      sale?: number;
      newest?: number;
    };
    featuredProducts: HomeProduct[];
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
  pickup?: {
    enabled: boolean;
    address: string;
    note: string;
  };
  minimumOrderAmount?: number;
  notice?: string;
};

type FeatureIconName =
  | "flower"
  | "camera"
  | "delivery"
  | "fresh"
  | "personal"
  | "time"
  | "support";

const fallbackCategories: Category[] = [
  {
    slug: "bukety",
    name: "Букеты",
    description: "Готовые композиции для важных событий и тёплых слов."
  },
  {
    slug: "avtorskie-bukety",
    name: "Авторские букеты",
    description: "Уникальные композиции, собранные флористами вручную."
  },
  {
    slug: "rozy",
    name: "Розы",
    description: "Классические и необычные букеты из роз."
  },
  {
    slug: "bukety-v-korobkakh",
    name: "Букеты в коробках",
    description: "Композиции в декоративных коробках и формах."
  },
  {
    slug: "podarki",
    name: "Подарки",
    description: "Дополнения к букету и приятные детали."
  },
  {
    slug: "vozdushnye-shary",
    name: "Воздушные шары",
    description: "Яркое дополнение к поздравлению и празднику."
  }
];

const fallbackHeroImage =
  "/uploads/products/"
  + "product-6ba05e24-075c-4217-b448-eb96aa0c49b3-"
  + "728ad608-1e78-43e8-b0e0-ebb0ec0813dc.webp";

const budgetLinks = [
  {
    key: "under5000",
    label: "До 5 000 ₽",
    text: "Небольшие букеты и приятные знаки внимания.",
    href: "/catalog?availability=available&maxPrice=5000&sort=recommended"
  },
  {
    key: "between5000And10000",
    label: "5 000–10 000 ₽",
    text: "Популярный диапазон для дня рождения и свидания.",
    href: "/catalog?availability=available&minPrice=5000&maxPrice=10000&sort=recommended"
  },
  {
    key: "over10000",
    label: "От 10 000 ₽",
    text: "Объёмные и премиальные композиции.",
    href: "/catalog?availability=available&minPrice=10000&sort=recommended"
  },
  {
    key: "featured",
    label: "Хиты",
    text: "Букеты, которые покупатели выбирают чаще всего.",
    href: "/catalog?availability=available&featured=true&sort=recommended"
  },
  {
    key: "sale",
    label: "Со скидкой",
    text: "Товары с действующей выгодной ценой.",
    href: "/catalog?availability=available&sale=true&sort=recommended"
  },
  {
    key: "newest",
    label: "Новинки",
    text: "Свежие позиции и новые сезонные композиции.",
    href: "/catalog?availability=available&sort=newest"
  }
] as const;

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function FeatureIcon({ name }: { name: FeatureIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
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

function formatMoney(value: number) {
  return value.toLocaleString("ru-RU");
}

function hasOldPrice(product: HomeProduct) {
  return (
    product.oldPrice !== null
    && product.oldPrice !== undefined
    && Number(product.oldPrice) > Number(product.price)
  );
}

function categoryCountLabel(count: number | undefined) {
  const value = Number(count ?? 0);

  if (value <= 0) {
    return "Смотреть подборку";
  }

  return `${value.toLocaleString("ru-RU")} ${value === 1 ? "товар" : "товаров"}`;
}

export default async function HomePage() {
  const [home, delivery] = await Promise.all([
    fetchJson<HomeResponse>("/api/public/home"),
    fetchJson<DeliveryResponse>("/api/public/delivery")
  ]);

  const title = home?.sections.hero.title ?? "Цветы, которые говорят за вас";
  const subtitle = home?.sections.hero.subtitle
    ?? "Собираем букеты вручную, показываем готовую работу и бережно доставляем получателю.";
  const eyebrow = home?.sections.hero.eyebrow ?? "Цветочная мастерская";
  const primaryCtaLabel = home?.sections.hero.primaryCtaLabel ?? "Выбрать букет";

  const benefits = home?.sections.hero.benefits?.length === 3
    ? home.sections.hero.benefits
    : [
        {
          title: "Свежая сборка",
          text: "Каждую композицию собираем к выбранной дате."
        },
        {
          title: "Фото перед доставкой",
          text: "Покажем готовый букет до передачи курьеру."
        },
        {
          title: "Бережная доставка",
          text: "Надёжно упакуем и привезём в выбранный интервал."
        }
      ];

  const categories = home
    ? home.sections.categories
    : fallbackCategories;
  const featuredProducts = home?.sections.featuredProducts ?? [];
  const visibleCategories = categories.slice(0, 5);
  const quickCollections = home?.sections.quickCollections ?? {};
  const visibleBudgetLinks = budgetLinks.filter((item) => (
    Number(quickCollections[item.key] ?? 0) > 0
  ));
  const showBudgetSelector = visibleBudgetLinks.length >= 2;
  const showFeaturedSection = featuredProducts.length >= 2;
  const heroProduct = featuredProducts[0] ?? null;
  const heroProductHref = heroProduct ? `/product/${heroProduct.slug}` : "/catalog";
  const heroProductName = heroProduct?.name ?? "Выбор флориста";
  const heroProductImage = home?.sections.hero.imageUrl
    || heroProduct?.primaryImage?.url
    || fallbackHeroImage;
  const zones = delivery?.zones ?? [];
  const intervals = delivery?.intervals ?? [];
  const firstZone = zones[0];
  const firstInterval = intervals[0];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>

          <div className={styles.heroActions}>
            <a href="/catalog?availability=available" className={styles.primaryButton}>
              {primaryCtaLabel}
            </a>
            <a href="#help" className={styles.secondaryButton}>
              Помощь с выбором
            </a>
          </div>

          <div className={styles.heroFacts} aria-label="Условия заказа">
            <span>
              <FeatureIcon name="camera" />
              Фото перед доставкой
            </span>
            <span>
              <FeatureIcon name="time" />
              {firstInterval ? `Ближайший интервал: ${firstInterval.name}` : "Удобные интервалы"}
            </span>
            <span>
              <FeatureIcon name="delivery" />
              {firstZone ? `Доставка от ${formatMoney(firstZone.price)} ₽` : "Доставка по городу"}
            </span>
          </div>
        </div>

        <a href={heroProductHref} className={styles.heroVisual} aria-label={`Посмотреть ${heroProductName}`}>
          <ProductTileImage src={heroProductImage} alt={heroProductName} priority />
          <span className={styles.heroOverlay}>
            <span>
              <small>Выбор флориста</small>
              <strong>{heroProductName}</strong>
            </span>
            <em>Смотреть</em>
          </span>
        </a>
      </section>

      <section className={styles.trustGrid} aria-label="Преимущества магазина">
        {benefits.map((benefit, index) => (
          <article key={`${benefit.title}-${index}`}>
            <span className={styles.trustIcon}>
              <FeatureIcon name={index === 0 ? "fresh" : index === 1 ? "camera" : "delivery"} />
            </span>
            <div>
              <strong>{benefit.title}</strong>
              <p>{benefit.text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.section} id="catalog">
        <div className={styles.sectionTopline}>
          <div className={styles.sectionHeading}>
            <span>Каталог</span>
            <h2>Выберите раздел</h2>
            <p>Показываем только разделы, в которых есть доступные товары.</p>
          </div>
          <a href="/catalog?availability=available" className={styles.textLink}>
            Весь каталог →
          </a>
        </div>

        <div
          className={`${styles.categoryGrid} ${
            visibleCategories.length === 1
              ? styles.categoryGridSingle
              : visibleCategories.length === 2
                ? styles.categoryGridDouble
                : ""
          }`}
        >
          {visibleCategories.map((category, index) => (
            <a
              key={category.slug}
              href={`/catalog?category=${encodeURIComponent(category.slug)}&availability=available`}
              className={index === 0 ? styles.categoryPrimary : styles.categoryCard}
            >
              {category.imageUrl ? (
                <ProductTileImage src={category.imageUrl} alt={category.name} />
              ) : null}
              <span className={styles.categoryShade} aria-hidden="true" />
              <span className={styles.categoryNumber}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.categoryBody}>
                <strong>{category.name}</strong>
                <p>{category.description || "Подборка цветов и композиций."}</p>
                <em>{categoryCountLabel(category.productCount)} →</em>
              </span>
            </a>
          ))}
        </div>
      </section>

      {showBudgetSelector ? (
        <section className={`${styles.section} ${styles.selectorSection}`} id="quick-selection">
        <div className={styles.selectorIntro}>
          <span>Быстрый выбор</span>
          <h2>Подберём по бюджету</h2>
          <p>Все кнопки открывают уже отфильтрованный каталог — без пустых переходов.</p>
        </div>
        <div className={styles.selectorGrid}>
          {visibleBudgetLinks.map((item) => (
            <a key={item.label} href={item.href}>
              <strong>{item.label}</strong>
              <span>{item.text}</span>
              <em>Показать товары →</em>
            </a>
          ))}
        </div>
        </section>
      ) : null}

      {showFeaturedSection ? (
        <section className={`${styles.section} ${styles.featuredSection}`} id="popular">
          <div className={styles.sectionTopline}>
            <div className={styles.sectionHeading}>
              <span>Выбор покупателей</span>
              <h2>Популярные товары</h2>
              <p>Доступные композиции, которые можно добавить в корзину сразу.</p>
            </div>
            <a href="/catalog?availability=available&sort=recommended" className={styles.textLink}>
              Смотреть все →
            </a>
          </div>

          <HomeFeaturedCarousel
            className={styles.featuredCarouselTrack}
            pageClassName={styles.featuredGrid}
            controlsClassName={styles.featuredCarouselControls}
            arrowClassName={styles.featuredCarouselArrow}
            dotsClassName={styles.featuredCarouselDots}
            hintClassName={styles.featuredCarouselHint}
          >
            {featuredProducts.slice(0, 8).map((product) => {
              const available = product.availability === "available";

              return (
                <article key={product.id} className={styles.featuredCard}>
                  <div className={styles.featuredMedia}>
                    <a href={`/product/${product.slug}`} aria-label={product.name}>
                      <ProductTileImage
                        src={product.primaryImage?.url ?? null}
                        alt={product.primaryImage?.alt || product.name}
                      />
                    </a>
                    <FavoriteButton productId={product.id} className={styles.featuredFavorite!} />
                    {hasOldPrice(product) ? <span className={styles.featuredSaleBadge}>Выгодно</span> : null}
                  </div>

                  <div className={styles.featuredBody}>
                    <div className={styles.featuredMeta}>
                      <span>{product.categoryName || "Товар"}</span>
                      <em className={available ? styles.available : styles.unavailable}>
                        {available ? "Доступен" : "Нет в наличии"}
                      </em>
                    </div>
                    <h3><a href={`/product/${product.slug}`}>{product.name}</a></h3>
                    <p>{product.shortDescription || "Композиция, собранная флористом к выбранной дате."}</p>
                    <div className={styles.featuredPriceRow}>
                      <strong>{formatMoney(product.price)} ₽</strong>
                      {hasOldPrice(product) ? <span>{formatMoney(Number(product.oldPrice))} ₽</span> : null}
                    </div>
                    <div className={styles.featuredActions}>
                      <a href={`/product/${product.slug}`} className={styles.featuredOpenButton}>Подробнее</a>
                      {available ? (
                        <AddToCartButton
                          className={styles.featuredCartButton!}
                          label="В корзину"
                          product={{
                            id: product.id,
                            slug: product.slug,
                            name: product.name,
                            price: product.price,
                            imageUrl: product.primaryImage?.url ?? "",
                            imageAlt: product.primaryImage?.alt || product.name
                          }}
                        />
                      ) : (
                        <button type="button" className={`${styles.featuredCartButton} ${styles.disabled}`} disabled>
                          Недоступно
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </HomeFeaturedCarousel>
        </section>
      ) : null}

      <section className={styles.assistanceSection} id="help">
        <div>
          <span>Нужна помощь?</span>
          <h2>Не знаете, что выбрать?</h2>
          <p>Выберите подходящий бюджет или откройте подборку популярных композиций — каталог сразу покажет доступные варианты.</p>
        </div>
        <div className={styles.assistanceActions}>
          <a href={showBudgetSelector ? "#quick-selection" : "/catalog?availability=available&sort=recommended"} className={styles.primaryButton}>Подобрать по бюджету</a>
          <a href={showFeaturedSection ? "#popular" : "/catalog?availability=available&featured=true"} className={styles.secondaryButton}>Посмотреть хиты</a>
        </div>
      </section>

      <section className={styles.deliverySection} id="delivery">
        <div className={styles.deliveryCopy}>
          <span>Доставка</span>
          <h2>Привезём аккуратно и в выбранный интервал</h2>
          <p>Стоимость рассчитывается по зоне после указания адреса. Доступные интервалы показываются при оформлении заказа.</p>
          {delivery?.notice ? <div className={styles.deliveryNotice}>{delivery.notice}</div> : null}
        </div>

        <div className={styles.deliveryPanel}>
          {zones.slice(0, 3).map((zone) => (
            <div className={styles.deliveryRow} key={zone.name}>
              <div>
                <strong>{zone.name}</strong>
                <span>{zone.description ?? "Доступная зона доставки"}</span>
              </div>
              <b>{zone.price === 0 ? "Бесплатно" : `${formatMoney(zone.price)} ₽`}</b>
            </div>
          ))}

          {Number(delivery?.minimumOrderAmount ?? 0) > 0 ? (
            <div className={styles.deliveryRule}>
              <span>Минимальная сумма заказа</span>
              <strong>{formatMoney(Number(delivery?.minimumOrderAmount ?? 0))} ₽</strong>
            </div>
          ) : null}

          {delivery?.pickup?.enabled && delivery.pickup.address ? (
            <div className={styles.deliveryRule}>
              <span>Самовывоз</span>
              <strong>{delivery.pickup.address}</strong>
            </div>
          ) : null}

          <div className={styles.intervalGrid}>
            {intervals.slice(0, 6).map((interval) => <span key={interval.name}>{interval.name}</span>)}
          </div>
        </div>
      </section>

      <div className={styles.processSection}>
        <ProcessCarousel />
      </div>

      <section className={styles.closingBanner}>
        <div>
          <span>Выбери Меня</span>
          <h2>Букет, который запомнится</h2>
          <p>Выберите композицию, укажите получателя и удобное время доставки.</p>
        </div>
        <a href="/catalog?availability=available">Перейти в каталог</a>
      </section>
    </div>
  );
}
