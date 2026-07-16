import type {
  Metadata,
  Viewport
} from "next";

import "./globals.css";
import "./public-shell.css";

import {
  PublicShell,
  type PublicShellSettings
} from "./components/public-shell";

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

const defaultShellSettings:
  PublicShellSettings = {
    phone: "",
    whatsapp: "",
    telegram: "",
    instagram: "",
    address: "",
    workHours: "",
    site: {
      brandName: "Выбери Меня",
      brandSubtitle: "ЦВЕТЫ И ПОДАРКИ",
      footerDescription:
        "Собираем букеты под заказ, показываем готовую работу перед отправкой и бережно доставляем получателю.",
      email: "",
      legalName: "",
      inn: "",
      ogrn: "",
      policyUrl: "",
      offerUrl: "",
      deliveryTermsUrl: "",
      returnsUrl: ""
    }
  };

async function loadShellSettings():
  Promise<PublicShellSettings> {
  const baseUrl =
    process.env.API_INTERNAL_URL
    ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(
      `${baseUrl}/api/public/shop`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return defaultShellSettings;
    }

    const data = await response.json() as {
      settings?: Partial<
        PublicShellSettings
      > & {
        site?: Partial<
          PublicShellSettings["site"]
        >;
      };
    };

    return {
      ...defaultShellSettings,
      ...data.settings,
      site: {
        ...defaultShellSettings.site,
        ...data.settings?.site
      }
    };
  } catch {
    return defaultShellSettings;
  }
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shellSettings =
    await loadShellSettings();

  return (
    <html lang="ru">
      <body>
        <PublicShell
          settings={shellSettings}
        >
          {children}
        </PublicShell>
      </body>
    </html>
  );
}
