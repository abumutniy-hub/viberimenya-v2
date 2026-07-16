import type { MetadataRoute } from "next";
import { loadPublicSettings } from "./lib/public-settings";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await loadPublicSettings();

  if (!settings.seo.indexingEnabled) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      sitemap: "https://viberimenya.ru/sitemap.xml",
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/account", "/orders"],
      },
    ],
    sitemap: "https://viberimenya.ru/sitemap.xml",
    host: "https://viberimenya.ru",
  };
}
