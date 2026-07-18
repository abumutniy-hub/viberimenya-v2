"use client";

import {
  useState
} from "react";

type ProductTileImageProps = {
  src?: string | null;
  secondarySrc?: string | null;
  alt: string;
  secondaryAlt?: string | null;
  priority?: boolean;
};

export function ProductTileImage({
  src,
  secondarySrc,
  alt,
  secondaryAlt,
  priority = false
}: ProductTileImageProps) {
  const [failed, setFailed] = useState(false);
  const [secondaryFailed, setSecondaryFailed] = useState(false);
  const [secondaryLoaded, setSecondaryLoaded] = useState(false);

  const cleanSrc = String(src ?? "").trim();
  const cleanSecondarySrc = String(secondarySrc ?? "").trim();

  const showImage = Boolean(cleanSrc) && !failed;
  const canLoadSecondaryImage = (
    showImage
    && Boolean(cleanSecondarySrc)
    && cleanSecondarySrc !== cleanSrc
    && !secondaryFailed
  );
  const showSecondaryImage = canLoadSecondaryImage && secondaryLoaded;

  return (
    <span
      className={[
        "product-tile-image",
        showImage ? "has-image" : "is-placeholder",
        showSecondaryImage ? "has-secondary-image" : ""
      ].filter(Boolean).join(" ")}
    >
      {showImage ? (
        <>
          <img
            className="product-tile-primary-image"
            src={cleanSrc}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
            onError={() => setFailed(true)}
          />

          {canLoadSecondaryImage ? (
            <img
              className="product-tile-secondary-image"
              src={cleanSecondarySrc}
              alt={secondaryAlt || alt}
              loading="lazy"
              decoding="async"
              aria-hidden="true"
              onLoad={() => setSecondaryLoaded(true)}
              onError={() => {
                setSecondaryFailed(true);
                setSecondaryLoaded(false);
              }}
            />
          ) : null}
        </>
      ) : (
        <span className="product-tile-image-fallback">
          <strong>ВМ</strong>
          <small>Фото скоро появится</small>
        </span>
      )}
    </span>
  );
}
