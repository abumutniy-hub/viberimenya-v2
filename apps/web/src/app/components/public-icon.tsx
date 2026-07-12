export type PublicIconName =
  | "home"
  | "catalog"
  | "cart"
  | "orders"
  | "profile";

export function PublicIcon({
  name,
  className
}: {
  name: PublicIconName;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="m3 11 9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );

    case "catalog":
      return (
        <svg {...common}>
          <circle cx="12" cy="11" r="2" />
          <path d="M12 8c-2.2-4.2 2.2-6 3.2-3.2C16 7 14 8 12 8Z" />
          <path d="M15 11c4.2-2.2 6 2.2 3.2 3.2C16 15 15 13 15 11Z" />
          <path d="M12 14c2.2 4.2-2.2 6-3.2 3.2C8 15 10 14 12 14Z" />
          <path d="M9 11c-4.2 2.2-6-2.2-3.2-3.2C8 7 9 9 9 11Z" />
          <path d="M12 17v4" />
        </svg>
      );

    case "cart":
      return (
        <svg {...common}>
          <path d="M3 4h2l2 11h10l2-7H7" />
          <circle cx="9" cy="19" r="1.4" />
          <circle cx="17" cy="19" r="1.4" />
        </svg>
      );

    case "orders":
      return (
        <svg {...common}>
          <path d="m4 7 8-4 8 4-8 4-8-4Z" />
          <path d="M4 7v10l8 4 8-4V7" />
          <path d="M12 11v10" />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21c.8-4.2 3.3-6.5 7.5-6.5s6.7 2.3 7.5 6.5" />
        </svg>
      );
  }
}
