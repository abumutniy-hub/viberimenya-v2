"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent
} from "react";
import { createPortal } from "react-dom";

import {
  AddToCartButton,
  FavoriteButton
} from "../components/add-to-cart-button";

type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  price: number;
  oldPrice?: number | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  available: boolean;
};

type ProductDetail = {
  product: {
    id: string;
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
  };
  images: Array<{
    id: string;
    url: string;
    alt?: string | null;
  }>;
};

type QuickViewStyle = CSSProperties & {
  "--product-quick-view-height"?: string;
  "--product-quick-view-offset-top"?: string;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export function ProductQuickView({
  product
}: {
  product: ProductSummary;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [viewport, setViewport] = useState({
    height: 0,
    offsetTop: 0
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<Promise<ProductDetail> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadDetail = useCallback(async () => {
    if (detail) {
      return detail;
    }

    if (requestRef.current) {
      return requestRef.current;
    }

    setLoading(true);
    setError("");

    const request = fetch(
      `/api/public/products/${encodeURIComponent(product.slug)}`,
      { cache: "no-store" }
    ).then(async (response) => {
      if (!response.ok) {
        throw new Error("Не удалось загрузить подробности товара");
      }

      return await response.json() as ProductDetail;
    });

    requestRef.current = request;

    try {
      const data = await request;
      setDetail(data);
      return data;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить подробности товара"
      );
      throw requestError;
    } finally {
      requestRef.current = null;
      setLoading(false);
    }
  }, [detail, product.slug]);

  function closeQuickView() {
    setOpen(false);
  }

  function showQuickView() {
    setActiveImageIndex(0);
    setOpen(true);
    void loadDetail().catch(() => undefined);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollY = window.scrollY;
    const body = document.body;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width
    };

    const updateViewport = () => {
      const visualViewport = window.visualViewport;

      setViewport({
        height: Math.max(
          320,
          Math.round(
            visualViewport?.height
            ?? window.innerHeight
          )
        ),
        offsetTop: Math.max(
          0,
          Math.round(
            visualViewport?.offsetTop
            ?? 0
          )
        )
      });
    };

    const resetScroll = () => {
      scrollRef.current?.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto"
      });
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    updateViewport();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeQuickView();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);

    const focusTimer = window.setTimeout(() => {
      resetScroll();
      closeRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);

      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;

      window.scrollTo(0, scrollY);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
  }, [open]);

  const resolvedProduct: ProductDetail["product"] = detail?.product ?? {
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortDescription: null,
    description: null,
    composition: null,
    careText: null,
    price: product.price,
    oldPrice: product.oldPrice ?? null,
    availability: product.available ? "available" : "unavailable",
    productType: null
  };

  const images = detail?.images?.filter((image) => Boolean(image.url?.trim())) ?? [];
  const safeImageIndex = images.length
    ? Math.min(activeImageIndex, images.length - 1)
    : 0;
  const activeImage = images[safeImageIndex] ?? null;
  const imageUrl = activeImage?.url || product.imageUrl || "";
  const imageAlt = activeImage?.alt || product.imageAlt || product.name;
  const available = resolvedProduct.availability === "available";
  const oldPrice = resolvedProduct.oldPrice;
  const flowerLike = !resolvedProduct.productType || [
    "bouquet",
    "arrangement",
    "flowers"
  ].includes(resolvedProduct.productType);

  function previousImage() {
    if (images.length < 2) {
      return;
    }

    setActiveImageIndex((index) => (
      index - 1 + images.length
    ) % images.length);
  }

  function nextImage() {
    if (images.length < 2) {
      return;
    }

    setActiveImageIndex((index) => (
      index + 1
    ) % images.length);
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];

    if (touch) {
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY
      };
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;

    if (!start || !touch || images.length < 2) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (
      Math.abs(deltaX) < 45
      || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    if (deltaX < 0) {
      nextImage();
    } else {
      previousImage();
    }
  }

  const backdropStyle: QuickViewStyle = viewport.height > 0
    ? {
        "--product-quick-view-height": `${viewport.height}px`,
        "--product-quick-view-offset-top": `${viewport.offsetTop}px`
      }
    : {};

  const modal = open ? (
    <div
      className="product-quick-view-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Быстрый просмотр: ${product.name}`}
      style={backdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeQuickView();
        }
      }}
    >
      <div
        className="product-quick-view-modal"
        aria-busy={loading}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="product-quick-view-close"
          onClick={closeQuickView}
          aria-label="Закрыть"
        >
          ×
        </button>

        <div
          ref={scrollRef}
          className="product-quick-view-content"
        >
          <div
            className="product-quick-view-media"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {imageUrl ? (
              <img src={imageUrl} alt={imageAlt} />
            ) : (
              <div className="product-quick-view-placeholder">
                Фото скоро появится
              </div>
            )}

            <FavoriteButton productId={product.id} />

            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  className="product-quick-view-arrow is-previous"
                  onClick={previousImage}
                  aria-label="Предыдущая фотография"
                >
                  ‹
                </button>

                <button
                  type="button"
                  className="product-quick-view-arrow is-next"
                  onClick={nextImage}
                  aria-label="Следующая фотография"
                >
                  ›
                </button>
              </>
            ) : null}

            {images.length > 1 ? (
              <div className="product-quick-view-thumbnails">
                {images.slice(0, 6).map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className={index === safeImageIndex ? "is-active" : ""}
                    onClick={() => setActiveImageIndex(index)}
                    aria-label={`Показать фотографию ${index + 1}`}
                  >
                    <img src={image.url} alt={image.alt || product.name} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="product-quick-view-info">
            <span className={available ? "is-available" : "is-unavailable"}>
              {available
                ? "Доступен для заказа"
                : resolvedProduct.availability === "preorder"
                  ? "Под заказ"
                  : "Сейчас нет в наличии"}
            </span>

            <h2>{resolvedProduct.name}</h2>

            <p>
              {resolvedProduct.shortDescription
                || resolvedProduct.description
                || "Свежая композиция, собранная специально к выбранной дате."}
            </p>

            {loading ? (
              <small className="product-quick-view-loading-note">
                Загружаем фотографии и состав…
              </small>
            ) : null}

            {error ? (
              <small className="product-quick-view-loading-note is-error">
                {error}. Полную карточку товара можно открыть кнопкой ниже.
              </small>
            ) : null}

            {resolvedProduct.composition ? (
              <div className="product-quick-view-composition">
                <strong>Состав</strong>
                <span>{resolvedProduct.composition}</span>
              </div>
            ) : null}

            <div className="product-quick-view-price">
              <strong>{money(resolvedProduct.price)}</strong>
              {oldPrice !== null
                && oldPrice !== undefined
                && Number(oldPrice) > Number(resolvedProduct.price) ? (
                  <span>{money(Number(oldPrice))}</span>
                ) : null}
            </div>

            <div className="product-quick-view-actions">
              {available ? (
                <AddToCartButton
                  className="dark-button"
                  product={{
                    id: resolvedProduct.id,
                    slug: resolvedProduct.slug,
                    name: resolvedProduct.name,
                    price: resolvedProduct.price,
                    imageUrl,
                    imageAlt
                  }}
                />
              ) : (
                <button type="button" className="dark-button is-disabled" disabled>
                  {resolvedProduct.availability === "preorder"
                    ? "Под заказ"
                    : "Нет в наличии"}
                </button>
              )}

              <a href={`/product/${resolvedProduct.slug}`} className="product-quick-view-details-button">
                Подробнее о товаре
              </a>
            </div>

            <small className="product-quick-view-trust">
              {flowerLike
                ? "Фото готового букета перед отправкой · Бережная упаковка"
                : "Проверим товар перед отправкой · Аккуратно упакуем"}
            </small>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="product-quick-view-trigger"
        onClick={showQuickView}
      >
        Быстрый просмотр
      </button>

      {mounted && modal
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
