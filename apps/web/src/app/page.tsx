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
      ? home.sections.occasions
      : ["Любимой", "Маме", "День рождения", "Без повода", "Свадьба", "Учителю"];

  const deliveryZones = delivery?.zones ?? [];
  const intervals = delivery?.intervals ?? [];

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

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Цветочная мастерская</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>

          <div className="hero-actions">
            <a className="primary-button" href="/catalog">
              Перейти в каталог
            </a>
            <a className="secondary-button" href="#delivery">
              Условия доставки
            </a>
          </div>

          <div className="hero-points" aria-label="Преимущества">
            <span>Фото букета перед доставкой</span>
            <span>Свежая сборка</span>
            <span>Удобные интервалы</span>
          </div>
        </div>

        <div className="hero-card" aria-label="Витрина букета">
          <div className="bouquet-visual">
            <span className="flower flower-one" />
            <span className="flower flower-two" />
            <span className="flower flower-three" />
            <span className="flower flower-four" />
            <span className="flower flower-five" />
          </div>
          <div className="hero-card-info">
            <strong>Букет дня</strong>
            <span>Нежная сезонная композиция</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <span>Быстрый выбор</span>
          <h2>Подберите букет по поводу</h2>
        </div>

        <div className="occasion-grid">
          {occasions.map((occasion) => (
            <a key={occasion} href={`/catalog?occasion=${encodeURIComponent(occasion)}`}>
              {occasion}
            </a>
          ))}
        </div>
      </section>

      <section id="catalog" className="section">
        <div className="section-heading">
          <span>Каталог</span>
          <h2>Основные разделы</h2>
          <p>Подберите формат букета под повод, настроение и адресата.</p>
        </div>

        <div className="category-grid">
          {categories.map((category) => (
            <a className="category-card" key={category.slug} href={`/catalog?category=${category.slug}`}>
              <span className="category-icon">✦</span>
              <strong>{category.name}</strong>
              <small>{category.description ?? "Подборка букетов и композиций"}</small>
            </a>
          ))}
        </div>
      </section>

      <section className="section product-preview">
        <div className="section-heading">
          <span>Витрина</span>
          <h2>Букеты для особенных моментов</h2>
          <p>
            Сейчас мы подготовили место для карточек товаров. После добавления букетов в CRM они появятся
            здесь автоматически.
          </p>
        </div>

        <div className="empty-product-card">
          <div>
            <strong>Индивидуальная сборка</strong>
            <p>Соберём букет под настроение, повод и пожелания к цветам.</p>
          </div>
          <a href="/catalog">Выбрать букет</a>
        </div>
      </section>

      <section id="delivery" className="section split-section">
        <div>
          <div className="section-heading">
            <span>Доставка</span>
            <h2>Удобные зоны и интервалы</h2>
            <p>
              Доставка уже заложена в базе: зоны, стоимость, бесплатная доставка от суммы и срочный тариф.
            </p>
          </div>
        </div>

        <div className="delivery-panel">
          {deliveryZones.map((zone) => (
            <div className="delivery-row" key={zone.name}>
              <div>
                <strong>{zone.name}</strong>
                <small>{zone.description}</small>
              </div>
              <span>{zone.price === 0 ? "0 ₽" : `${zone.price.toLocaleString("ru-RU")} ₽`}</span>
            </div>
          ))}

          <div className="intervals">
            {intervals.map((interval) => (
              <span key={interval.name}>{interval.name}</span>
            ))}
          </div>
        </div>
      </section>

      <ProcessCarousel />

      <section className="section trust-section">
        <div>
          <span>CRM-ready</span>
          <h2>Каждый заказ проходит аккуратный путь</h2>
        </div>
        <p>
          Главная, каталог, доставка, заказы, сотрудники, бонусы, отзывы и Telegram-бот будут работать на
          одной базе данных.
        </p>
      </section>

      <footer id="contacts" className="footer">
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

      <nav className="mobile-tabbar" aria-label="Мобильное меню">
        <a href="/">
          <span>🏠</span>
          Главная
        </a>
        <a href="/catalog">
          <span>🌸</span>
          Каталог
        </a>
        <a href="/cart">
          <span>🛒</span>
          Корзина
        </a>
        <a href="/orders">
          <span>📦</span>
          Заказы
        </a>
        <a href="/account">
          <span>👤</span>
          Профиль
        </a>
      </nav>
    </main>
  );
}
