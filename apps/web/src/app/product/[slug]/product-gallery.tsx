"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent
} from "react";

import {
  FavoriteButton
} from "../../components/add-to-cart-button";

type GalleryImage = {
  id: string;
  url: string;
  alt?: string | null;
};

type ProductGalleryProps = {
  images: GalleryImage[];
  productName: string;
  productId: string;
};

export function ProductGallery({
  images,
  productName,
  productId
}: ProductGalleryProps) {
  const safeImages = useMemo(
    () => images.filter((image) => Boolean(image.url?.trim())),
    [images]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);

  const visibleImages = safeImages.filter(
    (image) => !failedIds.includes(image.id)
  );

  const activeImage = visibleImages[
    Math.min(activeIndex, Math.max(visibleImages.length - 1, 0))
  ] ?? null;

  useEffect(() => {
    if (!lightboxOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      }

      if (event.key === "ArrowRight" && visibleImages.length > 1) {
        setActiveIndex((index) => (index + 1) % visibleImages.length);
      }

      if (event.key === "ArrowLeft" && visibleImages.length > 1) {
        setActiveIndex((index) => (
          index - 1 + visibleImages.length
        ) % visibleImages.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen, visibleImages.length]);

  useEffect(() => {
    if (activeIndex >= visibleImages.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, visibleImages.length]);


  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
    swipedRef.current = false;
  }

  function handleTouchEnd(event: TouchEvent) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;

    if (!start || !touch || visibleImages.length < 2) {
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

    swipedRef.current = true;

    if (deltaX < 0) {
      nextImage();
    } else {
      previousImage();
    }
  }

  function previousImage() {
    if (visibleImages.length < 2) {
      return;
    }

    setActiveIndex((index) => (
      index - 1 + visibleImages.length
    ) % visibleImages.length);
  }

  function nextImage() {
    if (visibleImages.length < 2) {
      return;
    }

    setActiveIndex((index) => (index + 1) % visibleImages.length);
  }

  return (
    <div className="product-gallery">
      <div
        className="product-gallery-main-card"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeImage ? (
          <button
            type="button"
            className="product-gallery-main-button"
            onClick={() => {
              if (swipedRef.current) {
                swipedRef.current = false;
                return;
              }

              setLightboxOpen(true);
            }}
            aria-label="Увеличить фотографию"
          >
            <img
              src={activeImage.url}
              alt={activeImage.alt || productName}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              onError={() => {
                setFailedIds((items) => (
                  items.includes(activeImage.id)
                    ? items
                    : [...items, activeImage.id]
                ));
              }}
            />

            <span className="product-gallery-zoom" aria-hidden="true">
              ↗
            </span>
          </button>
        ) : (
          <div className="product-gallery-placeholder">
            <strong>Выбери Меня</strong>
            <span>Фотография композиции скоро появится</span>
          </div>
        )}

        <FavoriteButton
          productId={productId}
          className="product-favorite-button"
        />

        {visibleImages.length > 1 ? (
          <>
            <button
              type="button"
              className="product-gallery-arrow is-previous"
              onClick={previousImage}
              aria-label="Предыдущая фотография"
            >
              ‹
            </button>

            <button
              type="button"
              className="product-gallery-arrow is-next"
              onClick={nextImage}
              aria-label="Следующая фотография"
            >
              ›
            </button>

            <span className="product-gallery-counter">
              {activeIndex + 1} / {visibleImages.length}
            </span>
          </>
        ) : null}
      </div>

      {visibleImages.length > 1 ? (
        <div className="product-gallery-thumbnails" aria-label="Фотографии товара">
          {visibleImages.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              onClick={() => setActiveIndex(index)}
              aria-label={`Показать фотографию ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <img
                src={image.url}
                alt={image.alt || `${productName}, фото ${index + 1}`}
                loading="lazy"
                decoding="async"
                onError={() => {
                  setFailedIds((items) => (
                    items.includes(image.id)
                      ? items
                      : [...items, image.id]
                  ));
                }}
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="product-gallery-caption">
        <strong>Собираем вручную</strong>
        <span>Сохраняем стиль, объём и ценность выбранной композиции.</span>
      </div>

      {lightboxOpen && activeImage ? (
        <div
          className="product-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Фотографии товара ${productName}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setLightboxOpen(false);
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            className="product-lightbox-close"
            onClick={() => setLightboxOpen(false)}
            aria-label="Закрыть"
          >
            ×
          </button>

          {visibleImages.length > 1 ? (
            <button
              type="button"
              className="product-lightbox-arrow is-previous"
              onClick={previousImage}
              aria-label="Предыдущая фотография"
            >
              ‹
            </button>
          ) : null}

          <img
            src={activeImage.url}
            alt={activeImage.alt || productName}
          />

          {visibleImages.length > 1 ? (
            <button
              type="button"
              className="product-lightbox-arrow is-next"
              onClick={nextImage}
              aria-label="Следующая фотография"
            >
              ›
            </button>
          ) : null}

          <span className="product-lightbox-counter">
            {activeIndex + 1} / {visibleImages.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}
