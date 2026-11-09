'use client';

// The hotel's own facts for the guest (decision 71, D4): check-in and check-out times, the address with a map link, the phone, the email and the Google review
// link, read from the hotel's public website answer (/api/v1/public/hotels/<slug>/site, no session). It needs the hotel's slug from /guest/hotels: without it
// (or when the site is not live) the card and every time line quietly disappear. No time or address is ever made up. The mock answers for its two demo hotels.
import { useEffect, useState } from 'react';

import { apiMode } from '@/lib/api/mode';
import { Bi } from '@/dashboards/pallav/ui';

import { pickHotel, useGuestHotels } from './hotels';
import { GgRow } from './rows';
import { phoneText, telHref } from './contact';

import { tr } from '@/lib/i18n/language';
export interface HotelSite {
  name: string;
  /** "12:00 pm" (null = not set). */
  checkInTime: string | null;
  checkOutTime: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** https link to the map (from the pin, else the address); null = none. */
  mapUrl: string | null;
  /** https link to leave a Google review; null = none. */
  reviewUrl: string | null;
}

/** "14:00" -> "2:00 pm"; anything else is shown as the hotel wrote it. */
export function clockText(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
  if (!m) return v.trim().slice(0, 20);
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const phoneOf = (v: string | null): string | null => (v ? phoneText(v) : null);
const https = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);

function fromSite(d: Record<string, unknown>): HotelSite | null {
  const name = text(d.name, 120);
  if (!name) return null;
  const lat = typeof d.mapLat === 'number' ? d.mapLat : Number(d.mapLat);
  const lng = typeof d.mapLng === 'number' ? d.mapLng : Number(d.mapLng);
  const address = [text(d.address), text(d.city, 60)].filter(Boolean).join(', ') || null;
  const pin = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? `${lat},${lng}` : null;
  const placeId = text(d.googlePlaceId, 200);
  return {
    name,
    checkInTime: clockText(d.checkinTime),
    checkOutTime: clockText(d.checkoutTime),
    address,
    phone: phoneOf(text(d.receptionPhone, 30)),
    email: text(d.email, 120),
    mapUrl: pin || address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pin ?? address ?? '')}` : null,
    reviewUrl: placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : https(d.gbpLink),
  };
}

/** The demo hotels' public answers (mock mode only). */
const MOCK_SITES: Record<string, Record<string, unknown>> = {
  'hotel-sunrise-rajkot': {
    name: 'Hotel Sunrise, Rajkot', city: 'Rajkot', address: '150 Ring Road', receptionPhone: '9876500001', email: 'stay@hotelsunriserajkot.in',
    checkinTime: '12:00', checkoutTime: '11:00', mapLat: 22.2916, mapLng: 70.7932, googlePlaceId: 'ChIJ-demo-sunrise-rajkot',
  },
  'sunrise-residency-surat': {
    name: 'Sunrise Residency, Surat', city: 'Surat', address: '22 Ghod Dod Road', receptionPhone: '9876500002', email: 'stay@sunriseresidency.in',
    checkinTime: '13:00', checkoutTime: '11:00', mapLat: null, mapLng: null, gbpLink: null,
  },
};

const cache = new Map<string, HotelSite | null>();

async function readSite(slug: string): Promise<HotelSite | null> {
  if (apiMode() === 'mock') {
    const d = MOCK_SITES[slug];
    return d ? fromSite(d) : null;
  }
  try {
    const res = await fetch(`/api/v1/public/hotels/${encodeURIComponent(slug)}/site`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
    return fromSite((body.data ?? body) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** The hotel's public facts (`hotelId`, else the only linked hotel); null while loading, without a slug or when the site does not answer. */
export function useHotelSite(hotelId?: string | null): HotelSite | null {
  const { hotels } = useGuestHotels();
  const slug = pickHotel(hotels, hotelId)?.slug ?? null;
  const [site, setSite] = useState<{ slug: string; value: HotelSite | null } | null>(null);
  useEffect(() => {
    if (!slug || cache.has(slug)) return undefined;
    let live = true;
    void readSite(slug).then((value) => {
      cache.set(slug, value);
      if (live) setSite({ slug, value });
    });
    return () => {
      live = false;
    };
  }, [slug]);
  if (!slug) return null;
  if (cache.has(slug)) return cache.get(slug) ?? null;
  return site?.slug === slug ? site.value : null;
}

/** The hotel card: check-in and check-out times, the address (opens the map), Call and Email. Draws nothing without the hotel's public facts. */
export function HotelInfoCard({ hotelId, title = 'Your hotel' }: { hotelId?: string | null; title?: string }) {
  const site = useHotelSite(hotelId);
  if (!site) return null;
  const times = [site.checkInTime ? `Check-in from ${site.checkInTime}` : null, site.checkOutTime ? `Check-out by ${site.checkOutTime}` : null].filter(Boolean).join(' · ');
  return (
    <section className="gg-card gg-hotelinfo" aria-label={title}>
      <div className="gg-card-head">
        <h2>{site.name}</h2>
        {times ? (
          <span className="gg-card-sub">
            <Bi name="clock" /> {times}
          </span>
        ) : null}
      </div>
      <div className="gg-list">
        {site.address ? <GgRow icon="geo-alt" title={site.address} sub={site.mapUrl ? 'Open the map' : undefined} href={site.mapUrl ?? undefined} external /> : null}
        {site.phone ? <GgRow icon="telephone" title={tr("Call the hotel")} sub={site.phone} href={telHref(site.phone)} /> : null}
        {site.email ? <GgRow icon="envelope" title={tr("Email the hotel")} sub={site.email} href={`mailto:${site.email}`} /> : null}
      </div>
    </section>
  );
}
