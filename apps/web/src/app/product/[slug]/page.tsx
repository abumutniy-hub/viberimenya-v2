import {
  AddToCartButton,
  FavoriteButton
} from "../../components/add-to-cart-button";
import {
  ProductImage
} from "./product-image";

export const dynamic = "force-dynamic";

type Product = {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  oldPrice?: number | null;
  availability: "available" | "unavailable";
};

type ProductImage = {
  id: string;
  url: string;
  alt?: string | null;
};

type ProductResponse = {
  product: Product;
  images: ProductImage[];
};

type ProductPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

async function fetchJson<T>(
  path: string
): Promise<T | null> {
  const baseUrl =
    process.env.API_INTERNAL_URL
    ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(
      `${baseUrl}${path}`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

function money(value: number) {
  return (
    `${Number(value || 0)
      .toLocaleString("ru-RU")} ₽`
  );
}

function hasOldPrice(
  product: Product
) {
  return (
    product.oldPrice !== null
    && product.oldPrice !== undefined
    && Number(product.oldPrice)
      > Number(product.price)
  );
}

function isProductAvailable(
  product: Product
) {
  const value =
    String(
      product.availability ?? ""
    )
      .trim()
      .toLowerCase();

  return value === "available";
}

function productDescription(
  product: Product
) {
  const candidates = [
    product.description,
    product.shortDescription
  ];

  for (const candidate of candidates) {
    const value =
      String(candidate ?? "")
        .trim();

    if (!value) {
      continue;
    }

    if (/^\d+([.,]\d+)?$/.test(value)) {
      continue;
    }

    if (value.length < 8) {
      continue;
    }

    if (
      value.toLowerCase()
      === product.name.trim().toLowerCase()
    ) {
      continue;
    }

    return value;
  }

  return (
    "Авторская композиция из свежих цветов, "
    + "собранная специально к выбранной дате."
  );
}

export default async function ProductPage({
  params
}: ProductPageProps) {
  const { slug } = await params;

  const data =
    await fetchJson<ProductResponse>(
      `/api/public/products/${encodeURIComponent(slug)}`
    );

  if (!data?.product) {
    return (
      <main className="simple-page">
        <section className="simple-card">
          <span className="product-not-found-label">
            Каталог
          </span>

          <h1>Товар не найден</h1>

          <p>
            Возможно, позиция временно скрыта
            или больше не представлена в каталоге.
          </p>

          <a href="/catalog">
            Вернуться в каталог
          </a>
        </section>
      </main>
    );
  }

  const product = data.product;

  const primaryImage =
    data.images?.find(
      (image) =>
        Boolean(image.url?.trim())
    ) ?? null;

  const available =
    isProductAvailable(product);

  const description =
    productDescription(product);

  return (
    <main className="product-page">
      <nav
        className="product-breadcrumbs"
        aria-label="Навигация"
      >
        <a href="/">Главная</a>
        <span aria-hidden="true">/</span>
        <a href="/catalog">Каталог</a>
        <span aria-hidden="true">/</span>
        <span>{product.name}</span>
      </nav>

      <section
        className="product-detail"
        aria-labelledby="product-title"
      >
        <div className="product-media">
          <div className="product-detail-media-card">
            <ProductImage
              src={primaryImage?.url ?? null}
              alt={
                primaryImage?.alt
                || product.name
              }
            />

            <FavoriteButton
              productId={product.id}
              className="product-favorite-button"
            />
          </div>

          <div className="product-photo-caption">
            <strong>
              Индивидуальная сборка
            </strong>

            <p>
              Учтём ваши пожелания и покажем
              готовую композицию перед отправкой.
            </p>
          </div>
        </div>

        <div className="product-detail-info">
          <div className="product-detail-meta-row">
            <span>
              Букет / композиция
            </span>

            <em
              className={
                available
                  ? "is-available"
                  : "is-unavailable"
              }
            >
              {available
                ? "В наличии"
                : "Нет в наличии"}
            </em>
          </div>

          <h1 id="product-title">
            {product.name}
          </h1>

          <p className="product-description">
            {description}
          </p>

          <div className="product-benefit-row">
            <span>Свежая сборка</span>
            <span>Фото перед доставкой</span>
            <span>Бережная упаковка</span>
          </div>

          <div className="product-price product-price-detail">
            <strong>
              {money(product.price)}
            </strong>

            {hasOldPrice(product) ? (
              <span>
                {money(
                  Number(product.oldPrice)
                )}
              </span>
            ) : null}
          </div>

          <div className="product-actions product-actions-two">
            {available ? (
              <AddToCartButton
                className={
                  "dark-button "
                  + "product-main-cart-button"
                }
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
            ) : (
              <button
                type="button"
                className={
                  "dark-button "
                  + "product-main-cart-button "
                  + "is-disabled"
                }
                disabled
              >
                Сейчас нет в наличии
              </button>
            )}

            <a
              href="/catalog"
              className={
                "light-button "
                + "product-secondary-button"
              }
            >
              Продолжить выбор
            </a>
          </div>

          <div className="product-notes">
            <article>
              <span aria-hidden="true">01</span>

              <div>
                <strong>
                  Фото перед доставкой
                </strong>

                <small>
                  Покажем готовый букет
                  перед отправкой получателю.
                </small>
              </div>
            </article>

            <article>
              <span aria-hidden="true">02</span>

              <div>
                <strong>
                  Удобный интервал
                </strong>

                <small>
                  Выберите подходящее время
                  при оформлении заказа.
                </small>
              </div>
            </article>

            <article>
              <span aria-hidden="true">03</span>

              <div>
                <strong>
                  Бережная доставка
                </strong>

                <small>
                  Надёжно упакуем композицию
                  и передадим курьеру.
                </small>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
