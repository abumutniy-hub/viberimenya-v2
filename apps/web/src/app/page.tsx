export const dynamic = "force-dynamic";

type ShopSettings = {
  phone?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  instagram?: string | null;
  address?: string | null;
  workHours?: string | null;
};

type HomeResponse = {
  settings: ShopSettings | null;
  sections: {
    occasions: string[];
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
  }>;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store"
    });

    if (!response.ok) return null;

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const categories = [
  "Букеты",
  "Цветы поштучно",
  "Корзины",
  "Подарки",
  "Открытки",
  "Акции",
  "Подписка на цветы",
  "Подписка домой",
  "Подписка в офис",
  "Парфюм"
];

const previewCards = [
  {
    title: "Букеты",
    text: "Свежие композиции для свидания, дня рождения и важных событий."
  },
  {
    title: "Подарки",
    text: "Дополнения к букету: открытки, наборы и приятные детали."
  },
  {
    title: "Подписка",
    text: "Регулярная доставка цветов домой, в офис или в подарок."
  }
];

export default async function HomePage() {
  const [home, delivery] = await Promise.all([
    fetchJson<HomeResponse>("/api/public/home"),
    fetchJson<DeliveryResponse>("/api/public/delivery")
  ]);

  const settings = home?.settings ?? null;
  const occasions =
    home?.sections.occasions && home.sections.occasions.length > 0
      ? home.sections.occasions
      : ["Любимой", "Маме", "День рождения", "Без повода", "Свадьба", "Учителю"];

  const zones = delivery?.zones ?? [];
  const intervals = delivery?.intervals ?? [];

  return (
    <main className="site">
      <header className="header">
        <a href="/" className="logo" aria-label="Выбери Меня">
          <span className="logo-icon">🌿</span>
          <span>
            <strong>Выбери Меня</strong>
            <small>Flowers & Gifts</small>
          </span>
        </a>

        <nav className="nav" aria-label="Главное меню">
          <a href="#catalog">Каталог</a>
          <a href="#subscription">Подписка</a>
          <a href="#delivery">Доставка</a>
          <a href="#contacts">Контакты</a>
        </nav>

        <div className="header-actions">
          <a href="/cart" className="light-button">Корзина</a>
          <a href="/account" className="dark-button">Кабинет</a>
        </div>
      </header>

      <section className="hero">
        <div className="hero-text">
          <span className="pill">Москва и Московская область</span>
          <h1>Цветы, которые хочется выбрать</h1>
          <p>
            Премиальные букеты, подарки и цветочные подписки с доставкой в удобный день.
          </p>

          <div className="hero-actions">
            <a href="/catalog" className="dark-button big">Выбрать букет</a>
            <a href="#subscription" className="light-button big">Оформить подписку</a>
          </div>
        </div>

        <div className="hero-visual" aria-label="Букет">
          <div className="photo-badge top">Фото букета перед доставкой</div>
          <div className="flower-card">
            <span className="stem stem-one" />
            <span className="stem stem-two" />
            <span className="stem stem-three" />
            <span className="minimal-flower f1" />
            <span className="minimal-flower f2" />
            <span className="minimal-flower f3" />
            <span className="minimal-flower f4" />
            <span className="minimal-flower f5" />
          </div>
          <div className="photo-badge bottom">Доставка сегодня по Москве и МО</div>
        </div>
      </section>

      <section id="catalog" className="section">
        <div className="section-kicker">Popular</div>
        <div className="section-head">
          <h2>Популярные разделы</h2>
          <a href="/catalog">Открыть каталог</a>
        </div>

        <div className="category-pills">
          {categories.map((category) => (
            <a key={category} href={`/catalog?category=${encodeURIComponent(category)}`}>
              {category}
            </a>
          ))}
        </div>

        <div className="preview-grid">
          {previewCards.map((card) => (
            <article key={card.title} className="preview-card">
              <div className="preview-image" />
              <div className="preview-body">
                <span>Раздел</span>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
                <a href="/catalog">Открыть</a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="subscription" className="section split">
        <div>
          <div className="section-kicker">Subscription</div>
          <h2>Цветочная подписка без лишних действий</h2>
        </div>
        <div className="text-panel">
          <p>
            Клиент выбирает периодичность, стиль букета и адрес. CRM будет сама вести такие заказы:
            напоминания, даты, интервалы и статусы.
          </p>
          <a href="/catalog">Скоро подключим в CRM</a>
        </div>
      </section>

      <section id="delivery" className="section split">
        <div>
          <div className="section-kicker">Delivery</div>
          <h2>Доставка сегодня и удобные интервалы</h2>
        </div>

        <div className="delivery-box">
          {zones.map((zone) => (
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

      <section className="section process">
        <div className="section-kicker">Process</div>
        <h2>Как проходит заказ</h2>

        <div className="process-grid">
          <div>
            <span>01</span>
            <strong>Выбор</strong>
            <p>Клиент выбирает букет, дату, интервал и способ связи.</p>
          </div>
          <div>
            <span>02</span>
            <strong>Подтверждение</strong>
            <p>Менеджер проверяет детали и переводит заказ в работу.</p>
          </div>
          <div>
            <span>03</span>
            <strong>Сборка</strong>
            <p>Флорист собирает букет и добавляет фото перед доставкой.</p>
          </div>
          <div>
            <span>04</span>
            <strong>Доставка</strong>
            <p>Курьер видит маршрут, адрес, телефон и меняет статус.</p>
          </div>
        </div>
      </section>

      <footer id="contacts" className="footer">
        <div>
          <strong>Выбери Меня</strong>
          <p>Цветы, подарки и CRM для аккуратной работы с каждым заказом.</p>
        </div>

        <div className="footer-info">
          <span>{settings?.phone || "Телефон добавим в CRM"}</span>
          <span>{settings?.address || "Адрес добавим в CRM"}</span>
          <span>{settings?.workHours || "График добавим в CRM"}</span>
        </div>
      </footer>

      <nav className="mobile-tabbar" aria-label="Мобильное меню">
        <a href="/">Главная</a>
        <a href="/catalog">Каталог</a>
        <a href="/cart">Корзина</a>
        <a href="/orders">Заказы</a>
        <a href="/account">Профиль</a>
      </nav>
    </main>
  );
}
