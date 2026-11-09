"use client";

import { useEffect, useState } from "react";

import { entryHotelFromAddress } from "@/lib/auth/httpApi";

/** What the sign-in page shows for a hotel's website visitor (decision 55): the hotel's name, its logo and the address of its own website. */
export interface EntryBrand {
  name: string;
  slug: string;
  /** Same-origin or https only, else null. */
  logoUrl: string | null;
  /** https only, the hotel's first registered website address, else null (no "Back to website" link). */
  websiteUrl: string | null;
}

const safeUrl = (v: unknown, allowRelative: boolean): string | null => {
  if (typeof v !== "string" || v === "") return null;
  if (v.startsWith("https://")) return v;
  return allowRelative && v.startsWith("/") && !v.startsWith("//") ? v : null;
};

const cache = new Map<string, EntryBrand | null>();

/**
 * Opened with `?hotel=<slug>` from a hotel's website: asks the public brand route (no session) for the hotel's name. A hotel that is unknown or whose website is
 * not live answers 404 and the plain sign-in page stays; nothing is stored. The slug is only a hint, so a failure of any kind shows the normal page.
 */
export function useEntryBrand(): EntryBrand | null {
  const slug = typeof window === "undefined" ? undefined : entryHotelFromAddress();
  const [brand, setBrand] = useState<EntryBrand | null>(() => (slug ? (cache.get(slug) ?? null) : null));
  useEffect(() => {
    if (!slug || cache.has(slug)) return;
    let live = true;
    void (async () => {
      let found: EntryBrand | null = null;
      try {
        const res = await fetch(`/api/v1/public/hotels/${encodeURIComponent(slug)}/brand`, { headers: { Accept: "application/json" } });
        if (res.ok) {
          const body = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
          const d = (body.data ?? body) as Record<string, unknown>;
          if (typeof d.name === "string" && d.name.trim() !== "") {
            found = { name: d.name.trim().slice(0, 120), slug, logoUrl: safeUrl(d.logoUrl, true), websiteUrl: safeUrl(d.websiteUrl, false) };
          }
        }
      } catch {
        found = null;
      }
      cache.set(slug, found);
      if (live) setBrand(found);
    })();
    return () => {
      live = false;
    };
  }, [slug]);
  return brand;
}
