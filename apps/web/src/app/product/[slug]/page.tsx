import { ProductGroupCarousel } from "./product-group-carousel";
import type { Metadata } from "next";

import {
  AddToCartButton
} from "../../components/add-to-cart-button";
import {
  ProductGallery
} from "./product-gallery";
import {
  RecentlyViewed
} from "./recently-viewed";
import {
  MobileProductBar
} from "./mobile-product-bar";

export const dynamic = "force-dynamic";

type Product = {
  id: string;
  categoryId?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  composition?: string | null;
  careText?: string | null;
  price: number;
  oldPrice?: number | null;
  availability: "available" | "preorder" | "unavailable";
  productType?: string | null;
  isFeatured?: boolean | null;
  primaryImage?: {
    url: string;
    alt?: string | null;
  } | null;
  secondaryImage?: {
    url: string;
    alt?: string | null;
  } | null;
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

type ProductsResponse = {
  items: Product[];
};

type ProductPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function hasOldPrice(product: Product) {
  return (
    product.oldPrice !== null
    && product.oldPrice !== undefined
    && Number(product.oldPrice) > Number(product.price)
  );
}

function isProductAvailable(product: Product) {
  return product.availability === "available";
}

function productAvailabilityLabel(product: Product) {
  if (product.availability === "available") {
    return "Доступен для заказа";
  }

  if (product.availability === "preorder") {
    return "Доступен под заказ";
  }

  return "Сейчас нет в наличии";
}

function productTypeLabel(product: Product) {
  const labels: Record<string, string> = {
    bouquet: "Букет",
    arrangement: "Цветочная композиция",
    flowers: "Цветы",
    card: "Открытка / дополнение",
    gift: "Подарок",
    sweets: "Сладости / дополнение",
    toy: "Мягкая игрушка",
    vase: "Ваза / дополнение",
    balloon: "Воздушные шары",
    perfume: "Парфюм",
    other: "Товар"
  };

  return labels[String(product.productType ?? "")]
    || product.categoryName
    || "Товар";
}

function isFlowerLike(product: Product) {
  return ["bouquet", "arrangement", "flowers"]
    .includes(String(product.productType ?? ""));
}

function productDescription(product: Product) {
  const candidates = [product.shortDescription, product.description];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();

    if (!value || /^\d+([.,]\d+)?$/.test(value) || value.length < 8) {
      continue;
    }

    if (value.toLowerCase() === product.name.trim().toLowerCase()) {
      continue;
    }

    return value;
  }

  return "Авторская композиция из свежих цветов, собранная специально к выбранной дате.";
}

function isAddonProduct(product: Product) {
  const productType = String(
    product.productType ?? ""
  ).trim();

  if (productType) {
    return [
      "card",
      "gift",
      "sweets",
      "toy",
      "vase",
      "balloon",
      "perfume"
    ].includes(productType);
  }

  const category = String(
    product.categoryName ?? ""
  ).trim();

  return /^(открытки(?: и конверты)?|подарки|конфеты|сладости|мягкие игрушки|воздушные шары|вазы|парфюм)$/i.test(category);
}

function RecommendationCard({
  product,
  addLabel = "В корзину"
}: {
  product: Product;
  addLabel?: string;
}) {
  const imageUrl = product.primaryImage?.url ?? "";
  const imageAlt = product.primaryImage?.alt || product.name;

  return (
    <article className="product-merch-card">
      <a href={`/product/${product.slug}`} className="product-merch-image">
        {imageUrl ? (
          <img src={imageUrl} alt={imageAlt} loading="lazy" />
        ) : (
          <span>Фото скоро появится</span>
        )}
      </a>

      <div>
        <a href={`/product/${product.slug}`}>
          <h3>{product.name}</h3>
        </a>

        <div className="product-merch-price">
          <strong>{money(product.price)}</strong>
          {hasOldPrice(product) ? (
            <span>{money(Number(product.oldPrice))}</span>
          ) : null}
        </div>
      </div>

      {isProductAvailable(product) ? (
        <AddToCartButton
          className="product-merch-add-button"
          label={addLabel}
          product={{
            id: product.id,
            slug: product.slug,
            name: product.name,
            price: product.price,
            imageUrl,
            imageAlt
          }}
        />
      ) : (
        <button type="button" className="product-merch-add-button is-disabled" disabled>
          Нет в наличии
        </button>
      )}
    </article>
  );
}

export async function generateMetadata({
  params
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchJson<ProductResponse>(
    `/api/public/products/${encodeURIComponent(slug)}`
  );

  if (!data?.product) {
    return {
      title: "Товар не найден",
      robots: { index: false, follow: false }
    };
  }

  const product = data.product;
  const description = productDescription(product).slice(0, 220);
  const image = data.images?.find((item) => Boolean(item.url?.trim()))?.url;

  return {
    title: product.name,
    description,
    alternates: { canonical: `/product/${encodeURIComponent(product.slug)}` },
    openGraph: {
      type: "website",
      title: product.name,
      description,
      url: `/product/${encodeURIComponent(product.slug)}`,
      images: image ? [{ url: image, alt: product.name }] : undefined
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: product.name,
      description,
      images: image ? [image] : undefined
    }
  };
}

export default async function ProductPage({
  params
}: ProductPageProps) {
  const { slug } = await params;

  const [
    data,
    catalogData,
    cardProductsData,
    giftProductsData,
    sweetsProductsData,
    toyProductsData,
    vaseProductsData,
    balloonProductsData,
    perfumeProductsData
  ] = await Promise.all([
    fetchJson<ProductResponse>(
      `/api/public/products/${encodeURIComponent(slug)}`
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&sort=recommended&page=1&pageSize=48"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=card&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=gift&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=sweets&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=toy&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=vase&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=balloon&sort=recommended&page=1&pageSize=12"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products?availability=available&productType=perfume&sort=recommended&page=1&pageSize=12"
    )
  ]);

  if (!data?.product) {
    return (
      <main className="simple-page">
        <section className="simple-card">
          <span className="product-not-found-label">Каталог</span>
          <h1>Товар не найден</h1>
          <p>Возможно, позиция временно скрыта или больше не представлена в каталоге.</p>
          <a href="/catalog">Вернуться в каталог</a>
        </section>
      </main>
    );
  }

  const product = data.product;
  const images = (data.images ?? []).filter((image) => Boolean(image.url?.trim()));
  const primaryImage = images[0] ?? null;
  const available = isProductAvailable(product);
  const description = productDescription(product);
  const catalogProducts = (catalogData?.items ?? []).filter(
    (item) => item.id !== product.id
  );

  const sameCategoryProducts = catalogProducts.filter((item) => (
    isFlowerLike(item)
    && product.categoryId
    && item.categoryId === product.categoryId
  ));

  const otherFlowerProducts = catalogProducts.filter((item) => (
    isFlowerLike(item)
    && !sameCategoryProducts.some((candidate) => candidate.id === item.id)
  ));

  const relatedProducts = [
    ...sameCategoryProducts,
    ...otherFlowerProducts
  ].slice(0, 12);

  const addonGroups: Product[][] = [
    cardProductsData?.items ?? [],
    giftProductsData?.items ?? [],
    sweetsProductsData?.items ?? [],
    toyProductsData?.items ?? [],
    vaseProductsData?.items ?? [],
    balloonProductsData?.items ?? [],
    perfumeProductsData?.items ?? []
  ];

  const addonProducts: Product[] = [];
  const addonProductIds = new Set<string>();

  for (let index = 0; addonProducts.length < 12; index += 1) {
    let foundAtIndex = false;

    for (const group of addonGroups) {
      const item = group[index];

      if (!item) {
        continue;
      }

      foundAtIndex = true;

      if (
        item.id === product.id
        || !isAddonProduct(item)
        || addonProductIds.has(item.id)
      ) {
        continue;
      }

      addonProductIds.add(item.id);
      addonProducts.push(item);

      if (addonProducts.length >= 12) {
        break;
      }
    }

    if (!foundAtIndex) {
      break;
    }
  }

  const cartProduct = {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    imageUrl: primaryImage?.url ?? "",
    imageAlt: primaryImage?.alt || product.name
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: images.length
      ? images.map((image) => `https://viberimenya.ru${image.url}`)
      : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "RUB",
      price: Number(product.price),
      availability: available
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `https://viberimenya.ru/product/${encodeURIComponent(product.slug)}`
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
        }}
      />

      <main className="product-page product-page-v2">
        <nav className="product-breadcrumbs" aria-label="Навигация">
          <a href="/">Главная</a>
          <span aria-hidden="true">/</span>
          <a href="/catalog">Каталог</a>
          <span aria-hidden="true">/</span>
          <span>{product.name}</span>
        </nav>

        <section className="product-detail product-detail-v2" aria-labelledby="product-title">
          <div className="product-media">
            <ProductGallery
              images={images}
              productName={product.name}
              productId={product.id}
            />
          </div>

          <div className="product-detail-info">
            <div className="product-detail-meta-row">
              <span>{productTypeLabel(product)}</span>
              <em className={available ? "is-available" : "is-unavailable"}>
                {productAvailabilityLabel(product)}
              </em>
            </div>

            <h1 id="product-title">{product.name}</h1>

            <p className="product-description">{description}</p>

            <div className="product-price product-price-detail">
              <strong>{money(product.price)}</strong>
              {hasOldPrice(product) ? (
                <span>{money(Number(product.oldPrice))}</span>
              ) : null}
            </div>

            <div className="product-delivery-callout">
              <strong>
                {available
                  ? "Можно выбрать дату и удобный интервал"
                  : product.availability === "preorder"
                    ? "Товар доступен по предварительному заказу"
                    : "Товар временно недоступен"}
              </strong>
              <span>
                {available
                  ? "Стоимость доставки рассчитаем после адреса в корзине."
                  : product.availability === "preorder"
                    ? "Срок подготовки подтвердит менеджер после заявки."
                    : "Мы вернём возможность заказа после обновления наличия."}
              </span>
              <a href="/delivery">Условия доставки</a>
            </div>

            <div className="product-actions product-actions-two">
              {available ? (
                <AddToCartButton
                  className="dark-button product-main-cart-button"
                  label="Добавить в корзину"
                  product={cartProduct}
                />
              ) : (
                <button
                  type="button"
                  className="dark-button product-main-cart-button is-disabled"
                  disabled
                >
                  {product.availability === "preorder"
                    ? "Под заказ"
                    : "Сейчас нет в наличии"}
                </button>
              )}

              <a href="/catalog" className="light-button product-secondary-button">
                Продолжить выбор
              </a>
            </div>

            <div className="product-trust-strip" aria-label="Преимущества заказа">
              {isFlowerLike(product) ? (
                <>
                  <span>Свежая сборка</span>
                  <span>Фото перед отправкой</span>
                  <span>Бережная упаковка</span>
                </>
              ) : (
                <>
                  <span>Добавим к заказу</span>
                  <span>Аккуратно упакуем</span>
                  <span>Проверим перед отправкой</span>
                </>
              )}
            </div>

            <div className="product-detail-accordions">
              {product.composition ? (
                <details open>
                  <summary>{isFlowerLike(product) ? "Состав" : "Характеристики"}</summary>
                  <p>{product.composition}</p>
                </details>
              ) : null}

              {isFlowerLike(product) ? (
                <details>
                  <summary>Важная информация о цветах</summary>
                  <p>
                    Каждый букет собирается вручную. Оттенок и расположение отдельных цветов
                    могут немного отличаться, при этом стиль, объём и ценность композиции сохраняются.
                  </p>
                </details>
              ) : null}

              {product.careText && isFlowerLike(product) ? (
                <details>
                  <summary>Как ухаживать</summary>
                  <p>{product.careText}</p>
                </details>
              ) : null}

              <details>
                <summary>Оплата, доставка и возврат</summary>
                <p>
                  Способ оплаты и интервал выбираются при оформлении. Условия доставки,
                  возврата и претензий доступны в нижней части сайта.
                </p>
              </details>
            </div>
          </div>
        </section>

        {isFlowerLike(product) && addonProducts.length > 0 ? (
          <section className="product-merch-section product-addon-section">
            <ProductGroupCarousel
              ariaLabel="Подарки и дополнения"
              eyebrow="Дополните заказ"
              title="Подарки и дополнения"
              mobileHint="Смахните в сторону, чтобы увидеть другие дополнения"
            >
              {addonProducts.map((item) => (
                <RecommendationCard
                  key={item.id}
                  product={item}
                  addLabel="+ Добавить"
                />
              ))}
            </ProductGroupCarousel>
          </section>
        ) : null}

        {relatedProducts.length > 0 ? (
          <section className="product-merch-section product-related-section">
            <ProductGroupCarousel
              ariaLabel="Похожие букеты"
              eyebrow="Ещё варианты"
              title="Похожие букеты"
              linkHref="/catalog"
              linkLabel="Смотреть каталог"
              mobileHint="Смахните в сторону, чтобы посмотреть ещё букеты"
            >
              {relatedProducts.map((item) => (
                <RecommendationCard key={item.id} product={item} />
              ))}
            </ProductGroupCarousel>
          </section>
        ) : null}

        <RecentlyViewed current={cartProduct} />
      </main>

      <MobileProductBar
        available={available}
        unavailableLabel={
          product.availability === "preorder"
            ? "Под заказ"
            : "Нет в наличии"
        }
        product={cartProduct}
      />
    </>
  );
}
