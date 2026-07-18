"use client";

import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode
} from "react";

type HomeFeaturedCarouselProps = {
  children: ReactNode;
  className?: string | undefined;
  pageClassName?: string | undefined;
  controlsClassName?: string | undefined;
  arrowClassName?: string | undefined;
  dotsClassName?: string | undefined;
  hintClassName?: string | undefined;
  autoplayDelayMs?: number;
};

const ITEMS_PER_PAGE = 4;
const RESUME_DELAY_MS = 1700;

export function HomeFeaturedCarousel({
  children,
  className,
  pageClassName,
  controlsClassName,
  arrowClassName,
  dotsClassName,
  hintClassName,
  autoplayDelayMs = 5000
}: HomeFeaturedCarouselProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const pointerStartXRef = useRef<number | null>(null);

  const items = Children.toArray(children);
  const pages = useMemo(() => {
    const result: ReactNode[][] = [];

    for (let index = 0; index < items.length; index += ITEMS_PER_PAGE) {
      result.push(items.slice(index, index + ITEMS_PER_PAGE));
    }

    return result;
  }, [items]);

  const totalPages = pages.length;
  const [activePage, setActivePage] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [finePointer, setFinePointer] = useState(false);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const resumeSoon = useCallback(() => {
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => {
      setPaused(false);
      resumeTimerRef.current = null;
    }, RESUME_DELAY_MS);
  }, [clearResumeTimer]);

  const scrollToPage = useCallback((requestedPage: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current;

    if (!track || totalPages === 0) {
      return;
    }

    const normalizedPage = ((requestedPage % totalPages) + totalPages) % totalPages;
    const page = track.querySelector<HTMLElement>(`[data-home-featured-page="${normalizedPage}"]`);

    if (!page) {
      return;
    }

    track.scrollTo({ left: page.offsetLeft, behavior });
    setActivePage(normalizedPage);
  }, [totalPages]);

  const move = useCallback((direction: -1 | 1) => {
    scrollToPage(activePage + direction);
  }, [activePage, scrollToPage]);

  useEffect(() => {
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointerMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => {
      setReducedMotion(reducedMotionMedia.matches);
      setFinePointer(finePointerMedia.matches);
    };

    update();
    reducedMotionMedia.addEventListener("change", update);
    finePointerMedia.addEventListener("change", update);

    return () => {
      reducedMotionMedia.removeEventListener("change", update);
      finePointerMedia.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;

    if (!root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.3)),
      { threshold: [0, 0.3, 0.6] }
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    let frame = 0;

    const handleScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = track.clientWidth;

        if (width <= 0) {
          return;
        }

        setActivePage(Math.max(0, Math.min(totalPages - 1, Math.round(track.scrollLeft / width))));
      });
    };

    track.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      track.removeEventListener("scroll", handleScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [totalPages]);

  useEffect(() => {
    if (paused || reducedMotion || !visible || totalPages <= 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!document.hidden) {
        scrollToPage(activePage + 1);
      }
    }, autoplayDelayMs);

    return () => window.clearTimeout(timer);
  }, [activePage, autoplayDelayMs, paused, reducedMotion, scrollToPage, totalPages, visible]);

  useEffect(() => {
    const handleResize = () => scrollToPage(activePage, "auto");
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activePage, scrollToPage]);

  useEffect(() => () => clearResumeTimer(), [clearResumeTimer]);

  const startInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      pointerStartXRef.current = event.clientX;
      clearResumeTimer();
      setPaused(true);
    }
  };

  const finishInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }

    const startX = pointerStartXRef.current;
    pointerStartXRef.current = null;

    if (startX !== null && Math.abs(event.clientX - startX) < 8) {
      resumeSoon();
      return;
    }

    resumeSoon();
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef}>
      <div
        ref={trackRef}
        className={className}
        role="region"
        aria-label="Популярные товары"
        tabIndex={0}
        onPointerDown={startInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={finishInteraction}
        onMouseEnter={() => {
          if (finePointer) {
            setPaused(true);
          }
        }}
        onMouseLeave={() => {
          if (finePointer) {
            setPaused(false);
          }
        }}
        onFocusCapture={() => {
          if (finePointer) {
            setPaused(true);
          }
        }}
        onBlurCapture={(event) => {
          if (!finePointer) {
            return;
          }

          const nextTarget = event.relatedTarget;

          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setPaused(false);
          }
        }}
      >
        {pages.map((page, pageIndex) => (
          <div
            className={pageClassName}
            data-home-featured-page={pageIndex}
            key={pageIndex}
          >
            {page}
          </div>
        ))}
      </div>

      {totalPages > 1 ? (
        <div className={controlsClassName}>
          <button
            type="button"
            className={arrowClassName}
            aria-label="Предыдущая группа товаров"
            onClick={() => {
              setPaused(true);
              move(-1);
              resumeSoon();
            }}
          >
            ←
          </button>

          <div className={dotsClassName} aria-label="Группы популярных товаров">
            {pages.map((_, pageIndex) => (
              <button
                type="button"
                className={pageIndex === activePage ? "is-active" : ""}
                aria-label={`Показать группу ${pageIndex + 1} из ${totalPages}`}
                aria-current={pageIndex === activePage ? "true" : undefined}
                key={pageIndex}
                onClick={() => {
                  setPaused(true);
                  scrollToPage(pageIndex);
                  resumeSoon();
                }}
              />
            ))}
          </div>

          <button
            type="button"
            className={arrowClassName}
            aria-label="Следующая группа товаров"
            onClick={() => {
              setPaused(true);
              move(1);
              resumeSoon();
            }}
          >
            →
          </button>
        </div>
      ) : null}

      {totalPages > 1 ? <p className={hintClassName}>Смахните в сторону, чтобы посмотреть ещё</p> : null}
    </div>
  );
}
