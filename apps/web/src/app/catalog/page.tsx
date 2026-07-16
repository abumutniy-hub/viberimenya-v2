import type { Metadata } from "next";

import {
  AddToCartButton,
  FavoriteButton
} from "../components/add-to-cart-button";

import {
  ProductTileImage
} from "../components/product-tile-image";

import {
  CategoryIcon,
  categoryIconKeyFromImageUrl
} from "../../components/category-icon";

import {
  CatalogLiveSearch
} from "./catalog-live-search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Каталог цветов и подарков",
  description:
    "Букеты и композиции с актуальными ценами, фото перед доставкой и удобным оформлением заказа.",
  alternates: { canonical: "/catalog" },
  openGraph: {
    title: "Каталог цветов и подарков",
    description:
      "Выберите букет или композицию. Покажем готовую работу перед доставкой.",
    url: "/catalog"
  }
};

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
  categoryName?: string | null;
  categorySlug?: string | null;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  oldPrice?: number | null;
  availability?: "available" | "unavailable" | null;
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

  meta: {
    total: number;
    page: number;
    pageSize: number;
    pages: number;
  };

  catalogTotal: number;

  categoryCounts: Record<
    string,
    number
  >;
};

type CatalogPageProps = {
  searchParams?: Promise<
    Record<
      string,
      string | string[] | undefined
    >
  >;
};

const sortValues = [
  "recommended",
  "newest",
  "price-asc",
  "price-desc",
  "name"
] as const;

type SortValue =
  typeof sortValues[number];

const availabilityValues = [
  "all",
  "available",
  "unavailable"
] as const;

type AvailabilityValue =
  typeof availabilityValues[number];

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

function numberParam(
  value: string | undefined
) {
  if (!value?.trim()) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number)
    || number < 0
  ) {
    return null;
  }

  return Math.trunc(number);
}

function positivePage(
  value: string | undefined
) {
  const number =
    Number(value ?? 1);

  if (
    !Number.isFinite(number)
    || number < 1
  ) {
    return 1;
  }

  return Math.trunc(number);
}

function productAvailabilityText(
  product: Product
) {
  return product.availability === "available"
    ? "В наличии"
    : "Нет в наличии";
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
    return "Нет товаров";
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
  const available =
    product.availability === "available";

  return (
    <article className="product-card">
      <div className="product-card-media">
        <a
          className="product-image product-image-safe"
          href={`/product/${product.slug}`}
          aria-label={product.name}
        >
          <ProductTileImage
            src={
              product.primaryImage?.url
              ?? null
            }
            alt={
              product.primaryImage?.alt
              || product.name
            }
          />
        </a>

        <FavoriteButton
          productId={product.id}
        />
      </div>

      <div className="product-body">
        <div>
          <div className="product-card-title-row">
            <h3>{product.name}</h3>

            <span
              className={
                `product-status-badge ${
                  available
                    ? "is-available"
                    : "is-unavailable"
                }`
              }
            >
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

            {available ? (
              <AddToCartButton
                className="product-cart-button"
                label="В корзину"
                product={{
                  id: product.id,
                  slug: product.slug,
                  name: product.name,
                  price: product.price,
                  imageUrl:
                    product.primaryImage?.url
                    ?? "",
                  imageAlt:
                    product.primaryImage?.alt
                    || product.name
                }}
              />
            ) : (
              <button
                type="button"
                className="product-cart-button is-disabled"
                disabled
              >
                Нет в наличии
              </button>
            )}
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

  const q = (
    getFirstParam(params.q)
    ?? ""
  ).trim().slice(0, 120);

  const selectedCategory = (
    getFirstParam(params.category)
    ?? ""
  ).trim();

  const rawAvailability =
    getFirstParam(params.availability);

  const availability:
    AvailabilityValue =
      availabilityValues.includes(
        rawAvailability as AvailabilityValue
      )
        ? rawAvailability as AvailabilityValue
        : "all";

  const rawSort =
    getFirstParam(params.sort);

  const sort:
    SortValue =
      sortValues.includes(
        rawSort as SortValue
      )
        ? rawSort as SortValue
        : "recommended";

  const minPrice =
    numberParam(
      getFirstParam(params.minPrice)
    );

  const maxPrice =
    numberParam(
      getFirstParam(params.maxPrice)
    );

  const featuredOnly =
    getFirstParam(params.featured)
      === "true";

  const saleOnly =
    getFirstParam(params.sale)
      === "true";

  const page =
    positivePage(
      getFirstParam(params.page)
    );

  const categoriesData =
    await fetchJson<CategoriesResponse>(
      "/api/public/categories"
    );

  const categories =
    categoriesData?.items ?? [];

  const activeCategory = (
    selectedCategory
    && selectedCategory !== "all"
  )
    ? categories.find(
        (category) =>
          category.slug === selectedCategory
      )
    : undefined;

  const apiParams =
    new URLSearchParams();

  if (q) {
    apiParams.set("q", q);
  }

  if (selectedCategory) {
    apiParams.set(
      "category",
      selectedCategory
    );
  }

  if (availability !== "all") {
    apiParams.set(
      "availability",
      availability
    );
  }

  if (sort !== "recommended") {
    apiParams.set("sort", sort);
  }

  if (minPrice !== null) {
    apiParams.set(
      "minPrice",
      String(minPrice)
    );
  }

  if (maxPrice !== null) {
    apiParams.set(
      "maxPrice",
      String(maxPrice)
    );
  }

  if (featuredOnly) {
    apiParams.set("featured", "true");
  }

  if (saleOnly) {
    apiParams.set("sale", "true");
  }

  apiParams.set("page", String(page));
  apiParams.set("pageSize", "24");

  const productsData =
    await fetchJson<ProductsResponse>(
      `/api/public/products?${apiParams.toString()}`
    );

  const products =
    productsData?.items ?? [];

  const meta =
    productsData?.meta ?? {
      total: products.length,
      page,
      pageSize: 24,
      pages: products.length > 0
        ? 1
        : 0
    };

  const categoryCounts =
    productsData?.categoryCounts ?? {};

  const catalogTotal =
    productsData?.catalogTotal
    ?? products.length;

  const hasAdvancedFilters = (
    availability !== "all"
    || sort !== "recommended"
    || minPrice !== null
    || maxPrice !== null
    || featuredOnly
    || saleOnly
  );

  const hasActiveRequest = Boolean(
    q
    || selectedCategory
    || hasAdvancedFilters
    || page > 1
  );

  const showCategoryLanding =
    !hasActiveRequest;

  const popularProducts =
    showCategoryLanding
      ? products
          .filter(
            (product) =>
              Boolean(product.isFeatured)
          )
          .slice(0, 4)
      : [];

  const activeFilterLabels:
    string[] = [];

  if (q) {
    activeFilterLabels.push(
      `Поиск: «${q}»`
    );
  }

  if (activeCategory) {
    activeFilterLabels.push(
      activeCategory.name
    );
  }

  if (
    selectedCategory === "all"
  ) {
    activeFilterLabels.push(
      "Все категории"
    );
  }

  if (
    availability === "available"
  ) {
    activeFilterLabels.push(
      "В наличии"
    );
  }

  if (availability === "unavailable") {
    activeFilterLabels.push(
      "Нет в наличии"
    );
  }

  if (minPrice !== null) {
    activeFilterLabels.push(
      `От ${money(minPrice)}`
    );
  }

  if (maxPrice !== null) {
    activeFilterLabels.push(
      `До ${money(maxPrice)}`
    );
  }

  if (featuredOnly) {
    activeFilterLabels.push(
      "Только хиты"
    );
  }

  if (saleOnly) {
    activeFilterLabels.push(
      "Со скидкой"
    );
  }

  function pageHref(
    nextPage: number
  ) {
    const link =
      new URLSearchParams();

    if (q) {
      link.set("q", q);
    }

    if (selectedCategory) {
      link.set(
        "category",
        selectedCategory
      );
    }

    if (availability !== "all") {
      link.set(
        "availability",
        availability
      );
    }

    if (sort !== "recommended") {
      link.set("sort", sort);
    }

    if (minPrice !== null) {
      link.set(
        "minPrice",
        String(minPrice)
      );
    }

    if (maxPrice !== null) {
      link.set(
        "maxPrice",
        String(maxPrice)
      );
    }

    if (featuredOnly) {
      link.set("featured", "true");
    }

    if (saleOnly) {
      link.set("sale", "true");
    }

    if (nextPage > 1) {
      link.set(
        "page",
        String(nextPage)
      );
    }

    const queryString =
      link.toString();

    return queryString
      ? `/catalog?${queryString}`
      : "/catalog";
  }

  const resultsTitle = q
    ? "Результаты поиска"
    : activeCategory
      ? activeCategory.name
      : "Все товары";

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
              : resultsTitle}
          </h1>

          <p>
            {showCategoryLanding
              ? "Выберите категорию или найдите нужный букет по названию, цене и наличию."
              : activeCategory?.description
                || "Подберите подходящую позицию с помощью поиска и фильтров."}
          </p>
        </div>
      </section>

      <div className="public-catalog-toolbar-wrap">
        <form
          className="public-catalog-filter-form"
          action="/catalog"
          method="get"
        >
          <CatalogLiveSearch
            initialQuery={q}
          />

          <details
            className="public-filter-details"
            open={hasAdvancedFilters}
          >
            <summary>
              <span>
                Фильтры и сортировка
              </span>

              {activeFilterLabels.length > 0 ? (
                <em>
                  {activeFilterLabels.length}
                </em>
              ) : null}
            </summary>

            <div className="public-filter-body">
              <div className="public-filter-grid">
                <label>
                  <span>Категория</span>

                  <select
                    name="category"
                    defaultValue={
                      selectedCategory || "all"
                    }
                  >
                    <option value="all">
                      Все категории
                    </option>

                    {categories.map(
                      (category) => (
                        <option
                          key={category.id}
                          value={category.slug}
                        >
                          {category.name}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  <span>Наличие</span>

                  <select
                    name="availability"
                    defaultValue={availability}
                  >
                    <option value="all">
                      Любое
                    </option>

                    <option value="available">
                      В наличии
                    </option>

                    <option value="unavailable">
                      Нет в наличии
                    </option>
                  </select>
                </label>

                <label>
                  <span>Сортировка</span>

                  <select
                    name="sort"
                    defaultValue={sort}
                  >
                    <option value="recommended">
                      Рекомендуемые
                    </option>

                    <option value="newest">
                      Сначала новые
                    </option>

                    <option value="price-asc">
                      Сначала дешевле
                    </option>

                    <option value="price-desc">
                      Сначала дороже
                    </option>

                    <option value="name">
                      По названию
                    </option>
                  </select>
                </label>

                <div className="public-price-fields">
                  <label>
                    <span>Цена от</span>

                    <input
                      type="number"
                      name="minPrice"
                      min="0"
                      step="100"
                      defaultValue={
                        minPrice ?? ""
                      }
                      placeholder="0"
                    />
                  </label>

                  <label>
                    <span>Цена до</span>

                    <input
                      type="number"
                      name="maxPrice"
                      min="0"
                      step="100"
                      defaultValue={
                        maxPrice ?? ""
                      }
                      placeholder="Любая"
                    />
                  </label>
                </div>
              </div>

              <div className="public-filter-bottom">
                <div className="public-filter-checks">
                  <label>
                    <input
                      type="checkbox"
                      name="featured"
                      value="true"
                      defaultChecked={
                        featuredOnly
                      }
                    />

                    <span>Только хиты</span>
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      name="sale"
                      value="true"
                      defaultChecked={saleOnly}
                    />

                    <span>Со скидкой</span>
                  </label>
                </div>

                <div className="public-filter-actions">
                  <button type="submit">
                    Показать товары
                  </button>

                  <a href="/catalog">
                    Сбросить
                  </a>
                </div>
              </div>
            </div>
          </details>
        </form>

        {activeFilterLabels.length > 0 ? (
          <div className="public-active-filters">
            <div>
              {activeFilterLabels.map(
                (label) => (
                  <span key={label}>
                    {label}
                  </span>
                )
              )}
            </div>

            <a href="/catalog">
              Очистить всё
            </a>
          </div>
        ) : null}
      </div>

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
                  <CategoryIcon iconKey="other" />
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
                      catalogTotal
                    )}
                  </strong>

                  <span>Открыть →</span>
                </div>
              </a>

              {categories.map((category) => {
                const productsCount =
                  Number(
                    categoryCounts[
                      category.id
                    ] ?? 0
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

                      <h2>{category.name}</h2>

                      <p>
                        {category.description
                          || "Товары и предложения этого раздела."}
                      </p>
                    </div>

                    <div className="public-category-footer">
                      <strong>
                        {productsCount > 0
                          ? productsCountLabel(
                              productsCount
                            )
                          : "Скоро"}
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

            {selectedCategory !== "all" ? (
              <a href="/catalog?category=all">
                Все товары
              </a>
            ) : null}
          </nav>

          <div className="catalog-head">
            <div>
              <span>
                {q
                  ? "Результаты поиска"
                  : activeCategory
                    ? "Категория"
                    : "Вся витрина"}
              </span>

              <h2>{resultsTitle}</h2>
            </div>

            <p>
              {productsCountLabel(
                meta.total
              )}
            </p>
          </div>

          {products.length > 0 ? (
            <>
              <div className="product-grid">
                {products.map(
                  (product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                    />
                  )
                )}
              </div>

              {meta.pages > 1 ? (
                <nav
                  className="public-catalog-pagination"
                  aria-label="Страницы каталога"
                >
                  {meta.page > 1 ? (
                    <a
                      href={pageHref(
                        meta.page - 1
                      )}
                    >
                      ← Назад
                    </a>
                  ) : (
                    <span />
                  )}

                  <strong>
                    {meta.page} из {meta.pages}
                  </strong>

                  {meta.page < meta.pages ? (
                    <a
                      href={pageHref(
                        meta.page + 1
                      )}
                    >
                      Далее →
                    </a>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          ) : (
            <div className="catalog-empty">
              <h3>
                Ничего не найдено
              </h3>

              <p>
                Измените запрос, диапазон цены
                или выбранные фильтры.
              </p>

              <a href="/catalog">
                Сбросить фильтры
              </a>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
