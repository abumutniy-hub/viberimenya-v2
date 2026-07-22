"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";

type Props = {
  src: string;
  alt: string;
  previewClassName?: string;
  onError?: () => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function touchDistance(event: TouchEvent<HTMLDivElement>) {
  const first = event.touches[0];
  const second = event.touches[1];
  if (!first || !second) return null;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export function CustomerPhotoViewer({
  src,
  alt,
  previewClassName = "",
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef(MIN_ZOOM);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "+" || event.key === "=") {
        setZoom((current) => clampZoom(current + ZOOM_STEP));
      }
      if (event.key === "-") {
        setZoom((current) => clampZoom(current - ZOOM_STEP));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    setOpen(false);
    setZoom(MIN_ZOOM);
    pinchStartDistance.current = null;
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const distance = touchDistance(event);
    if (distance === null) return;
    pinchStartDistance.current = distance;
    pinchStartZoom.current = zoom;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    const distance = touchDistance(event);
    if (distance === null || pinchStartDistance.current === null) return;
    event.preventDefault();
    setZoom(
      clampZoom(
        pinchStartZoom.current * (distance / pinchStartDistance.current),
      ),
    );
  }

  return (
    <>
      <button
        type="button"
        className={`customer-photo-preview ${previewClassName}`.trim()}
        onClick={() => setOpen(true)}
        aria-label="Открыть фотографию крупнее"
      >
        <img src={src} alt={alt} onError={onError} />
        <span aria-hidden="true">⌕</span>
      </button>

      {open ? (
        <div
          className="customer-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фотографии"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="customer-photo-lightbox-toolbar">
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Уменьшить фотографию"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Увеличить фотографию"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoom(MIN_ZOOM)}
              disabled={zoom === MIN_ZOOM}
            >
              100%
            </button>
            <button type="button" className="is-close" onClick={close}>
              Закрыть ×
            </button>
          </div>

          <div
            className="customer-photo-lightbox-stage"
            onDoubleClick={() => setZoom((current) => current === 1 ? 2.5 : 1)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => {
              pinchStartDistance.current = null;
            }}
          >
            <img
              src={src}
              alt={alt}
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          </div>
          <p>Разведите два пальца или нажмите дважды для увеличения.</p>
        </div>
      ) : null}
    </>
  );
}
