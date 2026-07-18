import type { SVGProps } from "react";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  decorative?: boolean;
};

export function BrandMark({
  decorative = true,
  ...props
}: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      {...props}
    >
      {!decorative ? <title>Цветочный знак Выбери Меня</title> : null}
      <circle cx="48" cy="48" r="43" stroke="currentColor" strokeWidth="1.6" opacity="0.68" />
      <path d="M25 58c9-3 14-10 18-21" stroke="#738064" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M71 58c-9-3-14-10-18-21" stroke="#738064" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M31 50c-7 1-11-1-14-5 7-2 12 0 14 5Z" fill="#8d9a77" />
      <path d="M65 50c7 1 11-1 14-5-7-2-12 0-14 5Z" fill="#8d9a77" />
      <path d="M36 41c-6-2-9-6-9-11 7 1 10 5 9 11Z" fill="#a2ad8e" />
      <path d="M60 41c6-2 9-6 9-11-7 1-10 5-9 11Z" fill="#a2ad8e" />
      <ellipse cx="48" cy="32.5" rx="10" ry="15" fill="#f5d9df" stroke="#b56b80" strokeWidth="1.3" />
      <ellipse cx="62.5" cy="45" rx="10" ry="15" transform="rotate(72 62.5 45)" fill="#efd0d8" stroke="#b56b80" strokeWidth="1.3" />
      <ellipse cx="57" cy="62" rx="10" ry="15" transform="rotate(144 57 62)" fill="#f7e1e5" stroke="#b56b80" strokeWidth="1.3" />
      <ellipse cx="39" cy="62" rx="10" ry="15" transform="rotate(-144 39 62)" fill="#efd0d8" stroke="#b56b80" strokeWidth="1.3" />
      <ellipse cx="33.5" cy="45" rx="10" ry="15" transform="rotate(-72 33.5 45)" fill="#f7e1e5" stroke="#b56b80" strokeWidth="1.3" />
      <circle cx="48" cy="48" r="8.2" fill="#c6a45f" />
      <circle cx="48" cy="48" r="3.2" fill="#fff9f2" />
      <circle cx="45" cy="45.5" r="0.9" fill="#8b6234" />
      <circle cx="51" cy="45.5" r="0.9" fill="#8b6234" />
      <circle cx="48" cy="51.5" r="0.9" fill="#8b6234" />
    </svg>
  );
}

export function BrandLogo({
  brandName,
  brandSubtitle,
  compact = false
}: {
  brandName: string;
  brandSubtitle?: string;
  compact?: boolean;
}) {
  return (
    <span className={compact ? "vm-brand-logo is-compact" : "vm-brand-logo"}>
      <span className="vm-brand-logo-mark" aria-hidden="true"><BrandMark /></span>
      <span className="vm-brand-logo-copy">
        <span className="vm-brand-logo-name">{brandName}</span>
        {brandSubtitle ? <small className="vm-brand-logo-subtitle">{brandSubtitle}</small> : null}
      </span>
    </span>
  );
}
