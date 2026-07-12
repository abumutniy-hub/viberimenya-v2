"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from "react";

export type ProductCatalogCategory = {
  id: string;
  name: string;
};

export type ProductCatalogItem = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  status: string;
  statusLabel: string;
  shortDescription: string;
  imageUrl: string;
  imagesCount: number;
  stock: number;
  price: number;
  priceLabel: string;
  isFeatured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const PAGE_SIZE = 12;

function normalized(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function timestamp(value: string) {
  const result = Date.parse(value);

  return Number.isFinite(result)
    ? result
    : 0;
}

export function ProductCatalogManager({
  categories,
  products
}: {
  categories: ProductCatalogCategory[];
  products: ProductCatalogItem[];
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] =
    useState("all");
  const [status, setStatus] =
    useState("all");
  const [availability, setAvailability] =
    useState("all");
  const [photo, setPhoto] =
    useState("all");
  const [featured, setFeatured] =
    useState("all");
  const [sort, setSort] =
    useState("manual");
  const [page, setPage] =
    useState(1);

  const deferredSearch =
    useDeferredValue(search);

  const filteredProducts = useMemo(() => {
    const query = normalized(deferredSearch);

    const result = products.filter((product) => {
      if (query) {
        const searchable = normalized(
          [
            product.name,
            product.slug,
            product.categoryName
          ].join(" ")
        );

        if (!searchable.includes(query)) {
          return false;
        }
      }

      if (
        category !== "all"
        && (
          category === "without-category"
            ? Boolean(product.categoryId)
            : product.categoryId !== category
        )
      ) {
        return false;
      }

      if (
        status !== "all"
        && product.status !== status
      ) {
        return false;
      }

      if (
        availability === "in-stock"
        && product.stock <= 0
      ) {
        return false;
      }

      if (
        availability === "out-of-stock"
        && product.stock > 0
      ) {
        return false;
      }

      if (
        photo === "with-photo"
        && !product.imageUrl
      ) {
        return false;
      }

      if (
        photo === "without-photo"
        && product.imageUrl
      ) {
        return false;
      }

      if (
        featured === "featured"
        && !product.isFeatured
      ) {
        return false;
      }

      if (
        featured === "not-featured"
        && product.isFeatured
      ) {
        return false;
      }

      return true;
    });

    return [...result].sort((left, right) => {
      switch (sort) {
        case "name-asc":
          return left.name.localeCompare(
            right.name,
            "ru"
          );

        case "name-desc":
          return right.name.localeCompare(
            left.name,
            "ru"
          );

        case "price-asc":
          return left.price - right.price;

        case "price-desc":
          return right.price - left.price;

        case "created-newest":
          return (
            timestamp(right.createdAt)
            - timestamp(left.createdAt)
          );

        case "created-oldest":
          return (
            timestamp(left.createdAt)
            - timestamp(right.createdAt)
          );

        case "updated-newest":
          return (
            timestamp(right.updatedAt)
            - timestamp(left.updatedAt)
          );

        default:
          return (
            left.sortOrder - right.sortOrder
            || left.name.localeCompare(
              right.name,
              "ru"
            )
          );
      }
    });
  }, [
    availability,
    category,
    deferredSearch,
    featured,
    photo,
    products,
    sort,
    status
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    availability,
    category,
    deferredSearch,
    featured,
    photo,
    sort,
    status
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredProducts.length / PAGE_SIZE
    )
  );

  const safePage = Math.min(
    page,
    totalPages
  );

  const visibleProducts =
    filteredProducts.slice(
      (safePage - 1) * PAGE_SIZE,
      safePage * PAGE_SIZE
    );

  const hasFilters = (
    search !== ""
    || category !== "all"
    || status !== "all"
    || availability !== "all"
    || photo !== "all"
    || featured !== "all"
    || sort !== "manual"
  );

  function resetFilters() {
    setSearch("");
    setCategory("all");
    setStatus("all");
    setAvailability("all");
    setPhoto("all");
    setFeatured("all");
    setSort("manual");
    setPage(1);
  }

  return (
    <section className="admin-panel admin-product-browser">
      <div className="admin-panel-head">
        <div>
          <span>Ассортимент</span>
          <h2>Товары</h2>
        </div>

        <span className="admin-catalog-count">
          {filteredProducts.length}
        </span>
      </div>

      <div className="admin-product-browser-controls">
        <label className="admin-product-browser-search">
          <span>Поиск</span>
          <input
            type="search"
            value={search}
            placeholder="Название, slug или категория"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>

        <label>
          <span>Категория</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            <option value="all">
              Все категории
            </option>

            <option value="without-category">
              Без категории
            </option>

            {categories.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Статус</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            <option value="all">
              Все статусы
            </option>
            <option value="active">
              Опубликован
            </option>
            <option value="draft">
              Черновик
            </option>
            <option value="hidden">
              Скрыт
            </option>
            <option value="archived">
              Архив
            </option>
          </select>
        </label>

        <label>
          <span>Наличие</span>
          <select
            value={availability}
            onChange={(event) => {
              setAvailability(
                event.target.value
              );
            }}
          >
            <option value="all">
              Любое
            </option>
            <option value="in-stock">
              В наличии
            </option>
            <option value="out-of-stock">
              Нет в наличии
            </option>
          </select>
        </label>

        <label>
          <span>Фотография</span>
          <select
            value={photo}
            onChange={(event) => {
              setPhoto(event.target.value);
            }}
          >
            <option value="all">
              Любая
            </option>
            <option value="with-photo">
              Есть фото
            </option>
            <option value="without-photo">
              Без фото
            </option>
          </select>
        </label>

        <label>
          <span>Хит продаж</span>
          <select
            value={featured}
            onChange={(event) => {
              setFeatured(event.target.value);
            }}
          >
            <option value="all">
              Все товары
            </option>
            <option value="featured">
              Только хиты
            </option>
            <option value="not-featured">
              Не в хитах
            </option>
          </select>
        </label>

        <label>
          <span>Сортировка</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
            }}
          >
            <option value="manual">
              Ручной порядок
            </option>
            <option value="name-asc">
              Название: А–Я
            </option>
            <option value="name-desc">
              Название: Я–А
            </option>
            <option value="price-asc">
              Цена: сначала дешевле
            </option>
            <option value="price-desc">
              Цена: сначала дороже
            </option>
            <option value="created-newest">
              Сначала новые
            </option>
            <option value="created-oldest">
              Сначала старые
            </option>
            <option value="updated-newest">
              Недавно обновлённые
            </option>
          </select>
        </label>

        <button
          className="admin-product-browser-reset"
          type="button"
          disabled={!hasFilters}
          onClick={resetFilters}
        >
          Сбросить
        </button>
      </div>

      <div className="admin-product-browser-summary">
        <span>
          Найдено:{" "}
          <strong>
            {filteredProducts.length}
          </strong>
          {" "}из {products.length}
        </span>

        {totalPages > 1 ? (
          <span>
            Страница {safePage} из {totalPages}
          </span>
        ) : null}
      </div>

      {visibleProducts.length ? (
        <div className="admin-product-browser-grid">
          {visibleProducts.map((product) => (
            <article
              className="admin-product-browser-card"
              key={product.id}
            >
              <a
                className={
                  product.imageUrl
                    ? "admin-product-browser-image has-image"
                    : "admin-product-browser-image"
                }
                href={
                  `/admin/catalog/products/${product.id}`
                }
                aria-label={
                  `Открыть товар ${product.name}`
                }
              >
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div>
                    <strong>
                      Фото не загружено
                    </strong>
                    <span>
                      Добавьте изображение
                    </span>
                  </div>
                )}
              </a>

              <div className="admin-product-browser-body">
                <div className="admin-product-browser-heading">
                  <div>
                    <span>
                      {product.categoryName}
                    </span>
                    <h3>{product.name}</h3>
                    <small>{product.slug}</small>
                  </div>

                  <span
                    className={
                      `admin-catalog-status status-${product.status}`
                    }
                  >
                    {product.statusLabel}
                  </span>
                </div>

                <p>
                  {product.shortDescription}
                </p>

                <dl className="admin-product-browser-facts">
                  <div>
                    <dt>Цена</dt>
                    <dd>{product.priceLabel}</dd>
                  </div>

                  <div>
                    <dt>Остаток</dt>
                    <dd>{product.stock}</dd>
                  </div>

                  <div>
                    <dt>Фото</dt>
                    <dd>{product.imagesCount}</dd>
                  </div>

                  <div>
                    <dt>Порядок</dt>
                    <dd>{product.sortOrder}</dd>
                  </div>
                </dl>

                <div className="admin-product-browser-tags">
                  {product.isFeatured ? (
                    <span>Хит продаж</span>
                  ) : null}

                  {product.stock <= 0 ? (
                    <span className="warning">
                      Нет в наличии
                    </span>
                  ) : null}

                  {!product.imageUrl ? (
                    <span className="warning">
                      Нужна фотография
                    </span>
                  ) : null}
                </div>

                <a
                  className="admin-product-browser-open"
                  href={
                    `/admin/catalog/products/${product.id}`
                  }
                >
                  Открыть карточку
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-product-browser-empty">
          <strong>
            Товары не найдены
          </strong>
          <p>
            Измените параметры поиска или сбросьте фильтры.
          </p>

          {hasFilters ? (
            <button
              type="button"
              onClick={resetFilters}
            >
              Сбросить фильтры
            </button>
          ) : null}
        </div>
      )}

      {totalPages > 1 ? (
        <nav
          className="admin-product-browser-pagination"
          aria-label="Страницы каталога"
        >
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => {
              setPage((current) =>
                Math.max(1, current - 1)
              );
            }}
          >
            ← Назад
          </button>

          <span>
            {safePage} / {totalPages}
          </span>

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => {
              setPage((current) =>
                Math.min(
                  totalPages,
                  current + 1
                )
              );
            }}
          >
            Вперёд →
          </button>
        </nav>
      ) : null}
    </section>
  );
}
