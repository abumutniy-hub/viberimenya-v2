import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MobileTabbar } from "./components/mobile-tabbar";

export const metadata: Metadata = {
  title: "ВЫБЕРИ МЕНЯ — цветы с доставкой",
  description: "Стильные букеты, фото перед доставкой и бережная доставка получателю."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf7f2"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}<MobileTabbar /></body>
    </html>
  );
}
