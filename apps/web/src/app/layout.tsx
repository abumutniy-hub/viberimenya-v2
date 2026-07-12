import type {
  Metadata,
  Viewport
} from "next";

import {
  Manrope,
  Playfair_Display
} from "next/font/google";

import "./globals.css";

import {
  MobileTabbar
} from "./components/mobile-tabbar";

import {
  DesktopCartIndicator
} from "./components/cart-indicator";

const manrope = Manrope({
  subsets: [
    "latin",
    "cyrillic"
  ],
  variable: "--font-public-sans",
  display: "swap"
});

const playfair = Playfair_Display({
  subsets: [
    "latin",
    "cyrillic"
  ],
  variable: "--font-public-display",
  display: "swap"
});

export const metadata: Metadata = {
  title:
    "ВЫБЕРИ МЕНЯ — цветы с доставкой",
  description:
    "Стильные букеты, фото перед доставкой и бережная доставка получателю."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf6ef"
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
          `${manrope.variable} ${playfair.variable}`
        }
      >
        <DesktopCartIndicator />

        {children}

        <MobileTabbar />
      </body>
    </html>
  );
}
