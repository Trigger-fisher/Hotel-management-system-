import type { MetadataRoute } from "next";
import { sitePages, siteCopy } from "@shared/site/copy";

// The public website: the home page and its own pages.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteCopy.url, changeFrequency: "monthly", priority: 1 },
    ...sitePages.map((p) => ({ url: `${siteCopy.url}${p}`, changeFrequency: "monthly" as const, priority: p === "/privacy" || p === "/terms" ? 0.3 : 0.8 })),
  ];
}
