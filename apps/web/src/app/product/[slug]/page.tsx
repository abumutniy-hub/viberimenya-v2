import { AddToCartButton, FavoriteButton } from "../../components/add-to-cart-button";
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

function productAvailabilityText(product: Product) {
  if (product.stockQuantity !== null && product.stockQuantity !== undefined && Number(product.stockQuantity) <= 0) {
    return "Под заказ";
  }

  return "В наличии";
}

function hasOldPrice(product: Product) {
  return product.oldPrice !== null && product.oldPrice !== undefined && Number(product.oldPrice) > Number(product.price);
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
  const primaryImage = data.images?.[0] ?? null;

  return (
    <main className="product-page">
      <a className="back-link" href="/catalog">← Каталог</a>

      <section className="product-detail">
        <div className="product-media">
          <div className="product-detail-media-card">
            <div className={`product-detail-image ${primaryImage ? "has-image" : "product-image-placeholder"}`}>
              {primaryImage ? (
                <img src={primaryImage.url} alt={primaryImage.alt || product.name} />
              ) : (
                <>
                  <span>ВМ</span>
                  <small>Букет будет собран индивидуально к вашему заказу</small>
                </>
              )}
            </div>
            <FavoriteButton productId={product.id} className="product-favorite-button" />
          </div>

          <div className="product-photo-caption">
            <strong>Индивидуальная сборка</strong>
            <p>
              Перед доставкой менеджер сможет согласовать детали заказа и при необходимости отправить фото готовой композиции.
            </p>
          </div>
        </div>

        <div className="product-detail-info">
          <div className="product-detail-meta-row">
            <span>Букет / композиция</span>
            <em>{productAvailabilityText(product)}</em>
          </div>
          <h1>{product.name}</h1>
          <p>{product.description || product.shortDescription || "Свежая композиция для красивого повода."}</p>
          <p className="product-short-note">
            Подойдёт для подарка, доставки на дом или приятного знака внимания.
          </p>

          <div className="product-price product-price-detail">
            <strong>{money(product.price)}</strong>
            {hasOldPrice(product) ? <span>{money(Number(product.oldPrice))}</span> : null}
          </div>

          <div className="product-actions product-actions-two">
            <AddToCartButton
              className="dark-button product-main-cart-button"
              label="Добавить в корзину"
              product={{
                id: product.id,
                slug: product.slug,
                name: product.name,
                price: product.price,
                imageUrl:
                  primaryImage?.url
                  ?? "",
                imageAlt:
                  primaryImage?.alt
                  || product.name
              }}
            />
            <a href="/catalog" className="light-button product-secondary-button">Продолжить выбор</a>
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
