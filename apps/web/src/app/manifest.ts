import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Выбери Меня — цветы и подарки",
    short_name: "Выбери Меня",
    description: "Интернет-магазин цветов, подарков и бережной доставки.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf6",
    theme_color: "#842844",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/brand-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/brand-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/brand-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/brand-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
