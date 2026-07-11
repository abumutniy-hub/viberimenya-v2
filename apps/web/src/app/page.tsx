import { ProcessCarousel } from "./components/process-carousel";

export const dynamic = "force-dynamic";

type Shop = {
  name: string;
};

type ShopSettings = {
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  instagram?: string | null;
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
  shop: Shop;
  settings: ShopSettings | null;
  sections: {
    hero: {
      title: string;
      subtitle: string;
    };
    occasions: string[];
    categories: Category[];
    featuredProducts: unknown[];
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

const fallbackCategories: Category[] = [
  { slug: "bukety", name: "Букеты", description: "Готовые композиции для любого повода" },
  { slug: "tsvety-po-shtuchno", name: "Цветы поштучно", description: "Соберите свой букет из любимых цветов" },
  { slug: "korziny", name: "Корзины", description: "Объёмные композиции для особенных случаев" },
  { slug: "podarki", name: "Подарки", description: "Дополнения к букету и приятные мелочи" },
  { slug: "otkrytki", name: "Открытки", description: "Добавьте тёплые слова к заказу" },
  { slug: "aktsii", name: "Акции", description: "Выгодные предложения и сезонные подборки" }
];

const heroImageUrl = "/uploads/bouquets/bouquet-66d8b881-c6f7-424c-b1f6-e14fca6408e8-1783641459234-e7918769-753e-4ad6-87b1-d4ffdd67c880.jpg";

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [home, delivery] = await Promise.all([
    fetchJson<HomeResponse>("/api/public/home"),
    fetchJson<DeliveryResponse>("/api/public/delivery")
  ]);

  const settings = home?.settings ?? null;
  const title = home?.sections.hero.title ?? "Цветы, которые говорят за вас";
  const subtitle =
    home?.sections.hero.subtitle ??
    "Собираем стильные букеты, отправляем фото перед доставкой и бережно доставляем получателю.";
  const categories =
    home?.sections.categories && home.sections.categories.length > 0
      ? home.sections.categories
      : fallbackCategories;
  const occasions =
    home?.sections.occasions && home.sections.occasions.length > 0
      ? home.sections.occasions.slice(0, 8)
      : ["Любимой", "Маме", "День рождения", "Без повода", "Свадьба", "Учителю"];

  const deliveryZones = delivery?.zones ?? [];
  const intervals = delivery?.intervals ?? [];
  const firstZone = deliveryZones[0];
  const firstInterval = intervals[0];

  return (
    <main className="page-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="ВЫБЕРИ МЕНЯ">
          <span className="brand-mark">ВМ</span>
          <span>
            <strong>ВЫБЕРИ МЕНЯ</strong>
            <small>цветы с доставкой</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Основное меню">
          <a href="#catalog">Каталог</a>
          <a href="#delivery">Доставка</a>
          <a href="#process">Как заказать</a>
          <a href="#contacts">Контакты</a>
        </nav>

        <a className="topbar-cta" href="/catalog">
          Выбрать букет
        </a>
      </header>

      <section className="hero hero-compact">
        <div className="hero-copy">
          <div className="eyebrow">Цветочная мастерская</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>

          <div className="hero-actions">
            <a className="primary-button" href="/catalog">
              Выбрать букет
            </a>
            <a className="secondary-button" href="/cart">
              Оформить заказ
            </a>
          </div>

          <div className="hero-points" aria-label="Преимущества">
            <span>Фото перед доставкой</span>
            <span>{firstInterval ? `Ближайший интервал: ${firstInterval.name}` : "Удобные интервалы"}</span>
            <span>{firstZone ? `Доставка от ${firstZone.price.toLocaleString("ru-RU")} ₽` : "Доставка по городу"}</span>
          </div>
        </div>

        <div className="hero-card hero-photo-card" aria-label="Букет ВЫБЕРИ МЕНЯ">
          <img src={heroImageUrl} alt="Букет ВЫБЕРИ МЕНЯ" />
          <div className="hero-card-info">
            <strong>Соберём сегодня</strong>
            <span>Под повод, адресата и бюджет</span>
          </div>
        </div>
      </section>

      <section className="home-quick-panel" aria-label="Быстрые действия">
        <a href="/catalog">
          <span>01</span>
          <strong>Открыть каталог</strong>
          <small>Готовые букеты и подарки</small>
        </a>
        <a href="/cart">
          <span>02</span>
          <strong>Оформить доставку</strong>
          <small>Телефон сохранится после заказа</small>
        </a>
        <a href="/account">
          <span>03</span>
          <strong>Личный кабинет</strong>
          <small>Статусы, бонусы и Telegram</small>
        </a>
      </section>

      <section className="section compact-section">
        <div className="section-heading compact-heading">
          <span>Быстрый выбор</span>
          <h2>По поводу</h2>
        </div>

        <div className="occasion-grid compact-occasion-grid">
          {occasions.map((occasion) => (
            <a key={occasion} href={`/catalog?occasion=${encodeURIComponent(occasion)}`}>
              {occasion}
            </a>
          ))}
        </div>
      </section>

      <section id="catalog" className="section compact-section">
        <div className="section-heading compact-heading">
          <span>Каталог</span>
          <h2>Разделы</h2>
          <p>Букеты, цветы поштучно, подарки и сезонные подборки.</p>
        </div>

        <div className="category-grid compact-category-grid">
          {categories.slice(0, 6).map((category) => (
            <a className="category-card" key={category.slug} href={`/catalog?category=${category.slug}`}>
              <span className="category-icon">✦</span>
              <strong>{category.name}</strong>
              <small>{category.description ?? "Подборка букетов и композиций"}</small>
            </a>
          ))}
        </div>
      </section>

      <section id="delivery" className="section split-section compact-section">
        <div>
          <div className="section-heading compact-heading">
            <span>Доставка</span>
            <h2>Привезём аккуратно</h2>
            <p>Выберите зону и интервал при оформлении заказа.</p>
          </div>
        </div>

        <div className="delivery-panel compact-delivery-panel">
          {deliveryZones.slice(0, 5).map((zone) => (
            <div className="delivery-row" key={zone.name}>
              <div>
                <strong>{zone.name}</strong>
                <small>{zone.description}</small>
              </div>
              <span>{zone.price === 0 ? "0 ₽" : `${zone.price.toLocaleString("ru-RU")} ₽`}</span>
            </div>
          ))}

          <div className="intervals">
            {intervals.slice(0, 6).map((interval) => (
              <span key={interval.name}>{interval.name}</span>
            ))}
          </div>
        </div>
      </section>

      <ProcessCarousel />

      <footer id="contacts" className="footer compact-footer">
        <div>
          <strong>ВЫБЕРИ МЕНЯ</strong>
          <p>Цветы с доставкой и заботой о каждом заказе.</p>
        </div>

        <div className="footer-contacts">
          <span>Онлайн-заказ на сайте</span>
          {settings?.phone ? <span>{settings.phone}</span> : null}
          {settings?.address ? <span>{settings.address}</span> : null}
          {settings?.workHours ? <span>{settings.workHours}</span> : null}
        </div>
      </footer>
    </main>
  );
}
