import type { MetadataRoute } from "next";
import { sitePages, siteCopy } from "@shared/site/copy";

// Only the public website is for search engines (MJ, 2 Nov 2026): the home page and its own pages. The hotel screens, the sign-in page and the API are for signed-in people.
// "/$" is the home page alone; the longer rules win over "/", so everything else stays closed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/$", ...sitePages.map((p) => `${p}$`)], disallow: "/" }, sitemap: `${siteCopy.url}/sitemap.xml` };
}
