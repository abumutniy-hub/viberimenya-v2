export const dynamic = "force-dynamic";

type Product = {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  oldPrice?: number | null;
  stockQuantity?: number | null;
  status: string;
};

type ProductResponse = {
  product: Product;
  images: Array<{
    id: string;
    url: string;
    alt?: string | null;
  }>;
};

type ProductPageProps = {
  params: Promise<{
    slug: string;
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

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const data = await fetchJson<ProductResponse>(`/api/public/products/${slug}`);

  if (!data?.product) {
    return (
      <main className="simple-page">
        <section className="simple-card">
          <h1>Товар не найден</h1>
          <p>Возможно, позиция была скрыта или удалена из каталога.</p>
          <a href="/catalog">Вернуться в каталог</a>
        </section>
      </main>
    );
  }

  const product = data.product;

  return (
    <main className="product-page">
      <a className="back-link" href="/catalog">← Каталог</a>

      <section className="product-detail">
        <div className="product-detail-image">
          <span>ВМ</span>
        </div>

        <div className="product-detail-info">
          <span>Букет / композиция</span>
          <h1>{product.name}</h1>
          <p>{product.description || product.shortDescription || "Свежая композиция для красивого повода."}</p>

          <div className="product-price">{money(product.price)}</div>

          <div className="product-actions">
            <a href="/cart" className="dark-button">Добавить в корзину</a>
            <a href="/catalog" className="light-button">Продолжить выбор</a>
          </div>

          <div className="product-notes">
            <div>
              <strong>Фото перед доставкой</strong>
              <small>Перед отправкой клиент сможет получить фото готового букета.</small>
            </div>
            <div>
              <strong>Свежая сборка</strong>
              <small>Композиция собирается под заказ и выбранный интервал.</small>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
