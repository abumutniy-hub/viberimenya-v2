"use client";

import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";

type ProductRecommendationCarouselProps = {
  ariaLabel: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  autoplayDelayMs?: number;
};

export function ProductRecommendationCarousel({
  ariaLabel,
  eyebrow,
  title,
  children,
  autoplayDelayMs = 5200
}: ProductRecommendationCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slides = Children.toArray(children);
  const total = slides.length;

  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const scrollToIndex = useCallback(
    (requestedIndex: number, behavior: ScrollBehavior = "smooth") => {
      const track = trackRef.current;

      if (!track || total === 0) {
        return;
      }

      const items = Array.from(
        track.querySelectorAll<HTMLElement>("[data-carousel-item]")
      );

      if (items.length === 0) {
        return;
      }

      const normalizedIndex = (
        (requestedIndex % items.length) + items.length
      ) % items.length;

      const target = items[normalizedIndex];

      if (!target) {
        return;
      }

      track.scrollTo({
        left: target.offsetLeft,
        behavior
      });

      setActiveIndex(normalizedIndex);
    },
    [total]
  );

  const move = useCallback(
    (direction: -1 | 1) => {
      if (total <= 1) {
        return;
      }

      scrollToIndex(activeIndex + direction);
    },
    [activeIndex, scrollToIndex, total]
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updatePreference = () => {
      setReducedMotion(media.matches);
    };

    updatePreference();
    media.addEventListener("change", updatePreference);

    return () => {
      media.removeEventListener("change", updatePreference);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    let animationFrame = 0;

    const updateActiveIndex = () => {
      animationFrame = window.requestAnimationFrame(() => {
        const items = Array.from(
          track.querySelectorAll<HTMLElement>("[data-carousel-item]")
        );

        if (items.length === 0) {
          return;
        }

        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;

        items.forEach((item, index) => {
          const distance = Math.abs(item.offsetLeft - track.scrollLeft);

          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });

        setActiveIndex(nearestIndex);
      });
    };

    track.addEventListener("scroll", updateActiveIndex, { passive: true });

    return () => {
      track.removeEventListener("scroll", updateActiveIndex);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [total]);

  useEffect(() => {
    const handleResize = () => {
      scrollToIndex(activeIndex, "auto");
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [activeIndex, scrollToIndex]);

  useEffect(() => {
    if (
      paused
      || reducedMotion
      || total <= 1
      || autoplayDelayMs < 2500
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.hidden) {
        return;
      }

      move(1);
    }, autoplayDelayMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoplayDelayMs, move, paused, reducedMotion, total]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
  };

  return (
    <div
      className="product-addon-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;

        if (
          !(nextTarget instanceof Node)
          || !event.currentTarget.contains(nextTarget)
        ) {
          setPaused(false);
        }
      }}
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
    >
      <div className="product-section-heading product-addon-carousel-heading">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>

        <div className="product-addon-carousel-controls">
          <span
            className="product-addon-carousel-counter"
            aria-hidden="true"
          >
            {Math.min(activeIndex + 1, Math.max(total, 1))}
            <i>/</i>
            {total}
          </span>

          <button
            type="button"
            className="product-addon-carousel-arrow"
            aria-label="Показать предыдущий товар"
            onClick={() => move(-1)}
            disabled={total <= 1}
          >
            <span aria-hidden="true">←</span>
          </button>

          <button
            type="button"
            className="product-addon-carousel-arrow"
            aria-label="Показать следующий товар"
            onClick={() => move(1)}
            disabled={total <= 1}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="product-addon-carousel-track"
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {slides.map((slide, index) => (
          <div
            className="product-addon-carousel-item"
            data-carousel-item
            key={index}
          >
            {slide}
          </div>
        ))}
      </div>

      <p className="product-addon-carousel-mobile-hint">
        Проведите в сторону, чтобы посмотреть другие дополнения
      </p>
    </div>
  );
}
