"use client";

import {
  useState
} from "react";

type ProductImageProps = {
  src: string | null;
  alt: string;
};

export function ProductImage({
  src,
  alt
}: ProductImageProps) {
  const [hasError, setHasError] =
    useState(false);

  const showImage =
    Boolean(src?.trim())
    && !hasError;

  return (
    <div
      className={
        `product-detail-image ${
          showImage
            ? "has-image"
            : "product-image-placeholder"
        }`
      }
    >
      {showImage ? (
        <img
          src={src ?? ""}
          alt={alt}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onError={() => {
            setHasError(true);
          }}
        />
      ) : (
        <div className="product-image-fallback">
          <strong>Выбери Меня</strong>

          <span>
            Фотография композиции
            скоро появится
          </span>
        </div>
      )}
    </div>
  );
}
