import type { Metadata, Viewport } from "next";

import "./globals.css";
import "./public-shell.css";

import { PublicShell } from "./components/public-shell";
import { loadPublicSettings } from "./lib/public-settings";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadPublicSettings();
  const title = settings.seo.siteTitle || "Выбери Меня — цветы с доставкой";
  const description = settings.seo.siteDescription;
  const image = settings.seo.ogImageUrl || settings.heroImageUrl;

  return {
    metadataBase: new URL("https://viberimenya.ru"),
    title: {
      default: title,
      template: `%s | ${settings.site.brandName || "Выбери Меня"}`,
    },
    description,
    alternates: { canonical: "/" },
    applicationName: settings.site.brandName || "Выбери Меня",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/brand-icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/brand-icon-512.png", sizes: "512x512", type: "image/png" }
      ],
      shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }]
    },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      url: "https://viberimenya.ru",
      siteName: settings.site.brandName,
      title,
      description,
      images: image ? [{ url: image, alt: settings.site.brandName }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
    verification: settings.seo.yandexVerification
      ? { yandex: settings.seo.yandexVerification }
      : undefined,
    robots: settings.seo.indexingEnabled
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fffaf6",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await loadPublicSettings();

  return (
    <html lang="ru">
      <body>
        <PublicShell settings={settings}>{children}</PublicShell>
      </body>
    </html>
  );
}
