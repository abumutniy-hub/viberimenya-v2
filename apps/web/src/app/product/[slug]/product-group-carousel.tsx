"use client";

import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from "react";

type ProductGroupCarouselProps = {
  ariaLabel: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  linkHref?: string;
  linkLabel?: string;
  mobileHint?: string;
  autoplayDelayMs?: number;
};

const ITEMS_PER_PAGE = 4;
const INTERACTION_RESUME_DELAY_MS = 1800;

export function ProductGroupCarousel({
  ariaLabel,
  eyebrow,
  title,
  children,
  linkHref,
  linkLabel,
  mobileHint = "Проведите в сторону, чтобы посмотреть ещё",
  autoplayDelayMs = 5000
}: ProductGroupCarouselProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const slides = Children.toArray(children);

  const pages = useMemo(() => {
    const result: ReactNode[][] = [];

    for (let index = 0; index < slides.length; index += ITEMS_PER_PAGE) {
      result.push(slides.slice(index, index + ITEMS_PER_PAGE));
    }

    return result;
  }, [slides]);

  const totalPages = pages.length;
  const [activePage, setActivePage] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const [finePointer, setFinePointer] = useState(false);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const resumeAfterInteraction = useCallback(() => {
    clearResumeTimer();

    resumeTimerRef.current = window.setTimeout(() => {
      setInteractionPaused(false);
      resumeTimerRef.current = null;
    }, INTERACTION_RESUME_DELAY_MS);
  }, [clearResumeTimer]);

  const pauseForInteraction = useCallback(() => {
    clearResumeTimer();
    setInteractionPaused(true);
  }, [clearResumeTimer]);

  const scrollToPage = useCallback((
    requestedPage: number,
    behavior: ScrollBehavior = "smooth"
  ) => {
    const track = trackRef.current;

    if (!track || totalPages === 0) {
      return;
    }

    const normalizedPage = (
      (requestedPage % totalPages) + totalPages
    ) % totalPages;

    const page = track.querySelector<HTMLElement>(
      `[data-product-group-page="${normalizedPage}"]`
    );

    if (!page) {
      return;
    }

    track.scrollTo({
      left: page.offsetLeft,
      behavior
    });

    setActivePage(normalizedPage);
  }, [totalPages]);

  const move = useCallback((direction: -1 | 1) => {
    if (totalPages <= 1) {
      return;
    }

    scrollToPage(activePage + direction);
  }, [activePage, scrollToPage, totalPages]);

  useEffect(() => {
    const reducedMotionMedia = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const finePointerMedia = window.matchMedia(
      "(hover: hover) and (pointer: fine)"
    );

    const updatePreferences = () => {
      setReducedMotion(reducedMotionMedia.matches);
      setFinePointer(finePointerMedia.matches);
    };

    updatePreferences();

    reducedMotionMedia.addEventListener("change", updatePreferences);
    finePointerMedia.addEventListener("change", updatePreferences);

    return () => {
      reducedMotionMedia.removeEventListener("change", updatePreferences);
      finePointerMedia.removeEventListener("change", updatePreferences);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;

    if (!root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.35));
      },
      {
        threshold: [0, 0.35, 0.6]
      }
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    let animationFrame = 0;

    const updateActivePage = () => {
      window.cancelAnimationFrame(animationFrame);

      animationFrame = window.requestAnimationFrame(() => {
        const pageWidth = track.clientWidth;

        if (pageWidth <= 0) {
          return;
        }

        const nextPage = Math.max(
          0,
          Math.min(
            totalPages - 1,
            Math.round(track.scrollLeft / pageWidth)
          )
        );

        setActivePage(nextPage);
      });
    };

    track.addEventListener("scroll", updateActivePage, { passive: true });

    return () => {
      track.removeEventListener("scroll", updateActivePage);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [totalPages]);

  useEffect(() => {
    const handleResize = () => {
      scrollToPage(activePage, "auto");
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [activePage, scrollToPage]);

  useEffect(() => {
    if (
      hoverPaused
      || interactionPaused
      || reducedMotion
      || !visible
      || totalPages <= 1
      || autoplayDelayMs < 3000
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (!document.hidden) {
        scrollToPage(activePage + 1);
      }
    }, autoplayDelayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activePage,
    autoplayDelayMs,
    hoverPaused,
    interactionPaused,
    reducedMotion,
    scrollToPage,
    totalPages,
    visible
  ]);

  useEffect(() => {
    return () => {
      clearResumeTimer();
    };
  }, [clearResumeTimer]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      pauseForInteraction();
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      resumeAfterInteraction();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      pauseForInteraction();
      move(-1);
      resumeAfterInteraction();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      pauseForInteraction();
      move(1);
      resumeAfterInteraction();
    }
  };

  if (slides.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="product-group-carousel"
      onMouseEnter={() => {
        if (finePointer) {
          setHoverPaused(true);
        }
      }}
      onMouseLeave={() => {
        if (finePointer) {
          setHoverPaused(false);
        }
      }}
      onFocusCapture={() => {
        if (finePointer) {
          setHoverPaused(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!finePointer) {
          return;
        }

        const nextTarget = event.relatedTarget;

        if (
          !(nextTarget instanceof Node)
          || !event.currentTarget.contains(nextTarget)
        ) {
          setHoverPaused(false);
        }
      }}
    >
      <div className="product-section-heading product-group-carousel-heading">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>

        <div className="product-group-carousel-actions">
          {linkHref && linkLabel ? (
            <a href={linkHref}>{linkLabel}</a>
          ) : null}

          {totalPages > 1 ? (
            <div className="product-group-carousel-controls">
              <span
                className="product-group-carousel-counter"
                aria-hidden="true"
              >
                {activePage + 1}
                <i>/</i>
                {totalPages}
              </span>

              <button
                type="button"
                className="product-group-carousel-arrow"
                aria-label="Показать предыдущие товары"
                onClick={() => {
                  pauseForInteraction();
                  move(-1);
                  resumeAfterInteraction();
                }}
              >
                <span aria-hidden="true">←</span>
              </button>

              <button
                type="button"
                className="product-group-carousel-arrow"
                aria-label="Показать следующие товары"
                onClick={() => {
                  pauseForInteraction();
                  move(1);
                  resumeAfterInteraction();
                }}
              >
                <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div
        ref={trackRef}
        className="product-group-carousel-track"
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {pages.map((page, pageIndex) => (
          <div
            className="product-group-carousel-page"
            data-product-group-page={pageIndex}
            key={pageIndex}
          >
            {page.map((slide, itemIndex) => (
              <div
                className="product-group-carousel-item"
                key={`${pageIndex}-${itemIndex}`}
              >
                {slide}
              </div>
            ))}
          </div>
        ))}
      </div>

      {totalPages > 1 ? (
        <div
          className="product-group-carousel-dots"
          aria-label="Страницы товаров"
        >
          {pages.map((_, pageIndex) => (
            <button
              type="button"
              className={pageIndex === activePage ? "is-active" : ""}
              aria-label={`Показать группу ${pageIndex + 1} из ${totalPages}`}
              aria-current={pageIndex === activePage ? "true" : undefined}
              key={pageIndex}
              onClick={() => {
                pauseForInteraction();
                scrollToPage(pageIndex);
                resumeAfterInteraction();
              }}
            />
          ))}
        </div>
      ) : null}

      <p className="product-group-carousel-mobile-hint">
        {mobileHint}
      </p>
    </div>
  );
}
