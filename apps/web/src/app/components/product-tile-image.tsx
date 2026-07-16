"use client";

import {
  useState
} from "react";

type ProductTileImageProps = {
  src?: string | null;
  alt: string;
  priority?: boolean;
};

export function ProductTileImage({
  src,
  alt,
  priority = false
}: ProductTileImageProps) {
  const [failed, setFailed] =
    useState(false);

  const cleanSrc =
    String(src ?? "").trim();

  const showImage =
    Boolean(cleanSrc)
    && !failed;

  return (
    <span
      className={[
        "product-tile-image",
        showImage
          ? "has-image"
          : "is-placeholder"
      ].join(" ")}
    >
      {showImage ? (
        <img
          src={cleanSrc}
          alt={alt}
          loading={
            priority
              ? "eager"
              : "lazy"
          }
          decoding="async"
          fetchPriority={
            priority
              ? "high"
              : "auto"
          }
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <span className="product-tile-image-fallback">
          <strong>ВМ</strong>

          <small>
            Фото скоро появится
          </small>
        </span>
      )}
    </span>
  );
}
