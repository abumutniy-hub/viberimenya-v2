import type {
  Metadata,
  Viewport
} from "next";

import {
  Manrope,
  Playfair_Display
} from "next/font/google";

import "./globals.css";
import "./public-shell.css";

import {
  PublicShell
} from "./components/public-shell";

const manrope = Manrope({
  subsets: [
    "latin",
    "cyrillic"
  ],
  variable: "--font-public-sans",
  display: "swap"
});

const playfair =
  Playfair_Display({
    subsets: [
      "latin",
      "cyrillic"
    ],
    variable:
      "--font-public-display",
    display: "swap"
  });

export const metadata: Metadata = {
  metadataBase:
    new URL(
      "https://viberimenya.ru"
    ),

  title: {
    default:
      "Выбери Меня — "
      + "цветы с доставкой",

    template:
      "%s | Выбери Меня"
  },

  description:
    "Стильные букеты, "
    + "фото перед доставкой "
    + "и бережная доставка "
    + "получателю.",

  icons: {
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml"
      }
    ]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fff9f4",
  colorScheme: "light"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={
          `${manrope.variable} `
          + `${playfair.variable}`
        }
      >
        <PublicShell>
          {children}
        </PublicShell>
      </body>
    </html>
  );
}
