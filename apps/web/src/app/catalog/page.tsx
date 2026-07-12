import {
  AddToCartButton,
  FavoriteButton
} from "../components/add-to-cart-button";

import {
  CategoryIcon,
  categoryIconKeyFromImageUrl
} from "../../components/category-icon";

export const dynamic = "force-dynamic";

type Category = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
};

type Product = {
  id: string;
  categoryId?: string | null;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  oldPrice?: number | null;
  stockQuantity?: number | null;
  status: string;
  isFeatured?: boolean | null;
  primaryImage?: {
    url: string;
    alt?: string | null;
  } | null;
};

type CategoriesResponse = {
  items: Category[];
};

type ProductsResponse = {
  items: Product[];
};

type CatalogPageProps = {
  searchParams?: Promise<
    Record<
      string,
      string | string[] | undefined
    >
  >;
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

function getFirstParam(
  value: string | string[] | undefined
) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function productAvailabilityText(
  product: Product
) {
  if (
    product.stockQuantity !== null
    && product.stockQuantity !== undefined
    && Number(product.stockQuantity) <= 0
  ) {
    return "Под заказ";
  }

  return "В наличии";
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

function productsCountLabel(
  count: number
) {
  if (count === 0) {
    return "Скоро";
  }

  const mod100 = count % 100;
  const mod10 = count % 10;

  if (
    mod100 >= 11
    && mod100 <= 14
  ) {
    return `${count} товаров`;
  }

  if (mod10 === 1) {
    return `${count} товар`;
  }

  if (
    mod10 >= 2
    && mod10 <= 4
  ) {
    return `${count} товара`;
  }

  return `${count} товаров`;
}

function ProductCard({
  product
}: {
  product: Product;
}) {
  return (
    <article
      className="product-card"
      key={product.id}
    >
      <div className="product-card-media">
        <a
          className={
            `product-image ${
              product.primaryImage
                ? "has-image"
                : "product-image-placeholder"
            }`
          }
          href={`/product/${product.slug}`}
          aria-label={product.name}
        >
          {product.primaryImage ? (
            <img
              src={product.primaryImage.url}
              alt={
                product.primaryImage.alt
                || product.name
              }
              loading="lazy"
              decoding="async"
            />
          ) : (
            <>
              <span>ВМ</span>
              <small>
                Индивидуальная сборка под заказ
              </small>
            </>
          )}
        </a>

        <FavoriteButton
          productId={product.id}
        />
      </div>

      <div className="product-body">
        <div>
          <div className="product-card-title-row">
            <h3>{product.name}</h3>

            <span className="product-status-badge">
              {productAvailabilityText(product)}
            </span>
          </div>

          <p>
            {product.shortDescription
              || product.description
              || "Свежая композиция для красивого повода."}
          </p>
        </div>

        <div className="product-bottom">
          <div className="product-price-row">
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

          <div className="product-card-actions">
            <a
              href={`/product/${product.slug}`}
              className="light-button product-open-button"
            >
              Открыть
            </a>

            <AddToCartButton
              className="product-cart-button"
              label="В корзину"
              product={{
                id: product.id,
                slug: product.slug,
                name: product.name,
                price: product.price
              }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function CatalogPage({
  searchParams
}: CatalogPageProps) {
  const params =
    (await searchParams) ?? {};

  const selectedCategory =
    getFirstParam(params.category);

  const [
    categoriesData,
    productsData
  ] = await Promise.all([
    fetchJson<CategoriesResponse>(
      "/api/public/categories"
    ),
    fetchJson<ProductsResponse>(
      "/api/public/products"
    )
  ]);

  const categories =
    categoriesData?.items ?? [];

  const products =
    productsData?.items ?? [];

  const activeCategory = (
    selectedCategory
    && selectedCategory !== "all"
  )
    ? categories.find(
        (category) =>
          category.slug === selectedCategory
      )
    : undefined;

  const showAllProducts =
    selectedCategory === "all";

  const showCategoryLanding = (
    !selectedCategory
    || (
      selectedCategory !== "all"
      && !activeCategory
    )
  );

  const productCounts =
    new Map<string, number>();

  for (const product of products) {
    const categoryId =
      String(product.categoryId ?? "");

    if (!categoryId) {
      continue;
    }

    productCounts.set(
      categoryId,
      (
        productCounts.get(categoryId)
        ?? 0
      ) + 1
    );
  }

  const visibleProducts =
    showAllProducts
      ? products
      : activeCategory
        ? products.filter(
            (product) =>
              product.categoryId
              === activeCategory.id
          )
        : [];

  const popularProducts =
    products
      .filter(
        (product) =>
          Boolean(product.isFeatured)
      )
      .slice(0, 4);

  return (
    <main className="catalog-page public-catalog-page">
      <section className="catalog-hero public-catalog-hero">
        <div>
          <a
            className="back-link"
            href="/"
          >
            ← Главная
          </a>

          <span>Каталог</span>

          <h1>
            {showCategoryLanding
              ? "Выберите раздел"
              : activeCategory
                ? activeCategory.name
                : "Все товары"}
          </h1>

          <p>
            {showCategoryLanding
              ? "Сначала выберите нужную категорию, а затем подходящий товар."
              : activeCategory?.description
                || "Все опубликованные товары нашего магазина."}
          </p>
        </div>
      </section>

      {showCategoryLanding ? (
        <div className="public-catalog-landing">
          <section className="public-catalog-categories">
            <div className="public-catalog-section-head">
              <div>
                <span>Разделы магазина</span>
                <h2>Категории товаров</h2>
              </div>

              <p>
                {categories.length} разделов
              </p>
            </div>

            <div className="public-category-grid">
              <a
                className="public-category-card all-products"
                href="/catalog?category=all"
              >
                <span className="public-category-icon">
                  <CategoryIcon
                    iconKey="other"
                  />
                </span>

                <div className="public-category-content">
                  <span>Вся витрина</span>
                  <h2>Все товары</h2>
                  <p>
                    Посмотрите все доступные букеты,
                    подарки и дополнительные позиции.
                  </p>
                </div>

                <div className="public-category-footer">
                  <strong>
                    {productsCountLabel(
                      products.length
                    )}
                  </strong>

                  <span>Открыть →</span>
                </div>
              </a>

              {categories.map((category) => {
                const productsCount = (
                  productCounts.get(category.id)
                  ?? 0
                );

                const iconKey =
                  categoryIconKeyFromImageUrl(
                    String(
                      category.imageUrl ?? ""
                    ),
                    category.slug
                  );

                return (
                  <a
                    className={[
                      "public-category-card",
                      `accent-${iconKey}`,
                      productsCount > 0
                        ? ""
                        : "is-empty",
                      category.slug === "bukety"
                        ? "is-primary"
                        : ""
                    ].filter(Boolean).join(" ")}
                    href={
                      `/catalog?category=${category.slug}`
                    }
                    key={category.id}
                    aria-disabled={
                      productsCount === 0
                    }
                    tabIndex={
                      productsCount > 0
                        ? 0
                        : -1
                    }
                  >
                    <span className="public-category-icon">
                      <CategoryIcon
                        iconKey={iconKey}
                      />
                    </span>

                    <div className="public-category-content">
                      <span>
                        {category.slug === "bukety"
                          ? "Основной раздел"
                          : productsCount > 0
                            ? "Раздел каталога"
                            : "Скоро в каталоге"}
                      </span>

                      <h2>
                        {category.name}
                      </h2>

                      <p>
                        {category.description
                          || "Товары и предложения этого раздела."}
                      </p>
                    </div>

                    <div className="public-category-footer">
                      <strong>
                        {productsCountLabel(
                          productsCount
                        )}
                      </strong>

                      <span>
                        {productsCount > 0
                          ? "Открыть →"
                          : "Готовим"}
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          {popularProducts.length > 0 ? (
            <section className="public-popular-section">
              <div className="public-catalog-section-head">
                <div>
                  <span>Выбор покупателей</span>
                  <h2>Популярное</h2>
                </div>

                <a href="/catalog?category=all">
                  Смотреть все →
                </a>
              </div>

              <div className="product-grid">
                {popularProducts.map(
                  (product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                    />
                  )
                )}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <section className="public-catalog-results">
          <nav className="public-catalog-results-nav">
            <a href="/catalog">
              ← Все категории
            </a>

            {!showAllProducts ? (
              <a href="/catalog?category=all">
                Все товары
              </a>
            ) : null}
          </nav>

          <div className="catalog-head">
            <div>
              <span>
                {activeCategory
                  ? "Категория"
                  : "Вся витрина"}
              </span>

              <h2>
                {activeCategory
                  ? activeCategory.name
                  : "Все товары"}
              </h2>
            </div>

            <p>
              {productsCountLabel(
                visibleProducts.length
              )}
            </p>
          </div>

          {visibleProducts.length > 0 ? (
            <div className="product-grid">
              {visibleProducts.map(
                (product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                )
              )}
            </div>
          ) : (
            <div className="catalog-empty">
              <h3>
                В этом разделе пока нет товаров
              </h3>

              <p>
                Категория уже создана. Новые позиции
                появятся здесь после публикации.
              </p>

              <a href="/catalog">
                Вернуться к категориям
              </a>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
