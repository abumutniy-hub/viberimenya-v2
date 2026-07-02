import { AddToCartButton } from "../components/add-to-cart-button";
export const dynamic = "force-dynamic";

type Category = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
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
};

type CategoriesResponse = {
  items: Category[];
};

type ProductsResponse = {
  items: Product[];
};

type CatalogPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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

function getFirstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = (await searchParams) ?? {};
  const selectedCategory = getFirstParam(params.category);

  const [categoriesData, productsData] = await Promise.all([
    fetchJson<CategoriesResponse>("/api/public/categories"),
    fetchJson<ProductsResponse>("/api/public/products")
  ]);

  const categories = categoriesData?.items ?? [];
  const products = productsData?.items ?? [];

  const activeCategory = categories.find((category) => category.slug === selectedCategory);
  const visibleProducts = activeCategory
    ? products.filter((product) => product.categoryId === activeCategory.id)
    : products;

  return (
    <main className="catalog-page">
      <section className="catalog-hero">
        <div>
          <a className="back-link" href="/">← Главная</a>
          <span>Каталог</span>
          <h1>Букеты и подарки</h1>
          <p>
            Выберите композицию под повод, настроение и получателя. Выберите композицию под повод, настроение и получателя.
          </p>
        </div>
      </section>

      <section className="catalog-layout">
        <aside className="catalog-filter">
          <a className={!activeCategory ? "active" : ""} href="/catalog">
            Все разделы
          </a>

          {categories.map((category) => (
            <a
              key={category.id}
              className={activeCategory?.id === category.id ? "active" : ""}
              href={`/catalog?category=${category.slug}`}
            >
              <strong>{category.name}</strong>
              {category.description ? <small>{category.description}</small> : null}
            </a>
          ))}
        </aside>

        <section className="catalog-content">
          <div className="catalog-head">
            <div>
              <span>{activeCategory ? activeCategory.name : "Все товары"}</span>
              <h2>{activeCategory ? activeCategory.name : "Витрина"}</h2>
            </div>
            <p>{visibleProducts.length} позиций</p>
          </div>

          {visibleProducts.length > 0 ? (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <a className="product-image" href={`/product/${product.slug}`} aria-label={product.name}>
                    <span>ВМ</span>
                  </a>

                  <div className="product-body">
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.shortDescription || product.description || "Свежая композиция для красивого повода."}</p>
                    </div>

                    <div className="product-bottom">
                      <strong>{money(product.price)}</strong>
                      <AddToCartButton className="product-cart-button" product={{ id: product.id, slug: product.slug, name: product.name, price: product.price }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="catalog-empty">
              <h3>В этом разделе скоро появятся товары</h3>
              <p>Скоро здесь появятся новые композиции и подарочные позиции.</p>
              <a href="/">Вернуться на главную</a>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
