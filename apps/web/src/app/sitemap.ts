import type { MetadataRoute } from "next";
import { loadPublicSettings } from "./lib/public-settings";

type ProductResponse = {
  items?: Array<{ slug?: string; updatedAt?: string }>;
  meta?: { pages?: number };
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await loadPublicSettings();
  const base = "https://viberimenya.ru";
  const now = new Date();

  if (!settings.seo.indexingEnabled) {
    return [{ url: base, lastModified: now }];
  }

  const routes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/catalog`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/consent`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/offer`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/delivery`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/returns`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  for (let page = 1; page <= 20; page += 1) {
    const products = await fetchJson<ProductResponse>(
      `/api/public/products?page=${page}&pageSize=48&sort=newest`,
    );

    for (const product of products?.items ?? []) {
      if (!product.slug) continue;
      routes.push({
        url: `${base}/product/${encodeURIComponent(product.slug)}`,
        lastModified: product.updatedAt ? new Date(product.updatedAt) : now,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }

    const pages = Number(products?.meta?.pages ?? 0);
    if (!pages || page >= pages) break;
  }

  return routes;
}
