import type { MetadataRoute } from "next";
import { productName } from "@shared/auth/copy";
import { auth, color } from "@shared/tokens";

// The installable app (Add to Home Screen): no service worker and no offline cache on purpose, the app always shows live data.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: productName,
    short_name: productName,
    description: "Reservations, GST billing, cash, companies and payroll.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "en-IN",
    theme_color: auth.background.stops[0],
    background_color: color.bg,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
