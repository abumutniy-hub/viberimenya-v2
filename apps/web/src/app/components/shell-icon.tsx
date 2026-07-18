export type ShellIconName =
  | "home"
  | "catalog"
  | "cart"
  | "orders"
  | "profile"
  | "menu"
  | "search";

type ShellIconProps = {
  name: ShellIconName;
};

export function ShellIcon({
  name
}: ShellIconProps) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap:
      "round" as const,
    strokeLinejoin:
      "round" as const,
    "aria-hidden": true
  };

  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M3.5 10.8 12 3.8l8.5 7" />
        <path d="M5.5 9.7v10h13v-10" />
        <path d="M9.3 19.7v-6.2h5.4v6.2" />
      </svg>
    );
  }

  if (name === "catalog") {
    return (
      <svg {...common}>
        <path d="M12 21v-8" />
        <path d="M12 13c-3.8 0-6.5-2.1-6.5-5.3 3.3-.5 6.5 1.2 6.5 5.3Z" />
        <path d="M12 13c3.8 0 6.5-2.1 6.5-5.3-3.3-.5-6.5 1.2-6.5 5.3Z" />
        <path d="M12 9c-2.4-1.1-3.3-3.5-2-6 2.5.7 4.1 3.2 2 6Z" />
        <path d="M12 9c2.4-1.1 3.3-3.5 2-6-2.5.7-4.1 3.2-2 6Z" />
      </svg>
    );
  }

  if (name === "cart") {
    return (
      <svg {...common}>
        <path d="M3 4h2.2l1.7 9.2h10.6l2-6.3H6.1" />
        <circle cx="9" cy="18.5" r="1.2" />
        <circle cx="17" cy="18.5" r="1.2" />
      </svg>
    );
  }

  if (name === "orders") {
    return (
      <svg {...common}>
        <path d="m4.5 7.4 7.5-4 7.5 4v9.2l-7.5 4-7.5-4Z" />
        <path d="m4.8 7.5 7.2 4 7.2-4" />
        <path d="M12 11.5v9" />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6" />
      </svg>
    );
  }

  if (name === "menu") {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.2 15.2 4.3 4.3" />
    </svg>
  );
}
