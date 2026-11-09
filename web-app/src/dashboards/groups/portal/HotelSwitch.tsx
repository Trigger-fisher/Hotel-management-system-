'use client';

// The hotel selector at the top of the Company and Guest portals' sidebar (decision 48), the same idea as the Payroll company switch: "All hotels" by default,
// then the hotels the login is linked to. The choice is one shared value for the whole session (portalHotelStore); the adapters send it as `?hotel=` and the
// shell re-opens the current page when it changes, so every page reloads for that hotel only. A login linked to one hotel only sees its name, nothing to pick.
// The list is a popover drawn in the page body (never cut by the sidebar, always on top, solid, scrolls when long). In the portals' top bar it opens centred under its button on every screen size (MJ, 26 Oct 2026: the same drop-down as the desktop); the staff dashboards' phone keeps the bottom sheet.
// Keyboard: Enter or Space opens, arrows move, Home and End jump, Enter picks, Escape closes and gives the focus back. One component for both portals.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { formatINR } from '@shared/dashboards/format';
import { PORTAL_ALL_HOTELS, portalHotelStore } from '@shared/dashboards/portalHotel';
import { portalHotelCopyByLanguage } from '@shared/dashboards/portalHotel.lang';
import type { GuestHotelsSummary, PortalHotelsSummary } from '@shared/dashboards/portalHotels';

import { useAsync } from '@/components/ui';
import { Bi } from '@/dashboards/pallav/ui';
import { corporateApi } from '../corporate/api';
import { guestApi } from '../guest/api';
import { guestHotelsApi, portalHotelsApi } from './hotelsApi';
import { initials } from '../payrollCore/pms';
import { useCopy, tr, trf } from '@/lib/i18n/language';

export function usePortalHotel(): string {
  return useSyncExternalStore(portalHotelStore.subscribe, portalHotelStore.get, portalHotelStore.get);
}

/** The product's name: the sidebar brand of a portal looking at all its hotels at once. */
export const PRODUCT_BRAND = 'EasyHotelSolutions';

/** The line under a guest's brand (decision 71). */
const GUEST_BRAND_LINE = 'Guest';

/**
 * The hotel of the guest's stay going on, else of the most recent stay (the newest bill of every hotel), as a hotel id; null when there is none. Reads every
 * hotel whatever the sidebar chose (`hotel: "all"`).
 */
async function guestStayHotel(): Promise<{ ok: true; data: string | null }> {
  const summary = await guestHotelsApi.summary();
  const inHouse = summary.ok ? summary.data.hotels.find((h) => h.inHouse) : undefined;
  if (inHouse) return { ok: true, data: inHouse.hotelId };
  const bills = await guestApi.listBills({ tab: 'all', limit: 10, hotel: PORTAL_ALL_HOTELS });
  const newest = bills.ok ? [...bills.data.items].filter((b) => b.status !== 'cancelled').sort((a, b) => b.stayTo.localeCompare(a.stayTo))[0] : undefined;
  return { ok: true, data: newest?.hotelId ?? null };
}

/**
 * The sidebar brand of the Guest and Company portals (PM, 18 Oct): under "All hotels" never one hotel's name but the product's mark with "All hotels · N"
 * (N = the linked hotels; just "All hotels" while the list loads); with one hotel chosen, that hotel's name. Null = the shell's usual brand (other roles,
 * a login with one hotel only, or a chosen hotel not in the list yet).
 */
export function usePortalBrand(kind: 'guest' | 'corporate' | null): { name: string; line: string; mark?: string } | null {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  const list = useAsync(() => (kind === 'guest' ? guestApi.listHotels() : kind === 'corporate' ? corporateApi.listHotels() : Promise.resolve({ ok: true as const, data: [] as { hotelId: string; name: string }[] })), [kind]);
  const choice = usePortalHotel();
  // Decision 71: a guest's brand is the hotel of the stay going on (or of the most recent stay), with "Guest" under it; never the product's mark.
  const stayHotel = useAsync(() => (kind === 'guest' ? guestStayHotel() : Promise.resolve({ ok: true as const, data: null })), [kind]);
  if (!kind) return null;
  const hotels = list.state.status === 'ready' ? list.state.data : null;
  if (kind === 'guest') {
    const chosen = choice !== PORTAL_ALL_HOTELS ? hotels?.find((h) => h.hotelId === choice) : undefined;
    const stayId = stayHotel.state.status === 'ready' ? stayHotel.state.data : null;
    const hotel = chosen ?? hotels?.find((h) => h.hotelId === stayId) ?? (hotels && hotels.length === 1 ? hotels[0] : undefined);
    return hotel ? { name: hotel.name, line: GUEST_BRAND_LINE } : null;
  }
  if (choice === PORTAL_ALL_HOTELS) {
    if (hotels && hotels.length < 2) return null;
    return { name: PRODUCT_BRAND, line: hotels ? `${portalHotelCopy.all} · ${hotels.length}` : portalHotelCopy.all, mark: 'EH' };
  }
  const chosen = hotels?.find((h) => h.hotelId === choice);
  return chosen ? { name: chosen.name, line: 'Management Suite' } : null;
}

interface Place {
  left: number;
  width: number;
  maxHeight: number;
  /** `top` when the list opens below the button, `bottom` when it opens above it. */
  edge: { top: number } | { bottom: number };
}

export function HotelSwitch({ kind }: { kind: 'guest' | 'corporate' }) {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  const list = useAsync(() => (kind === 'guest' ? guestApi.listHotels() : corporateApi.listHotels()), [kind]);
  const choice = usePortalHotel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hotels = useMemo(() => (list.state.status === 'ready' ? list.state.data : []), [list.state]);
  // What is owed at each hotel and what waits there (unread notices for a company; the room and open requests for a guest), for the open list.
  // A failed read just leaves the numbers out.
  const [summary, setSummary] = useState<PortalHotelsSummary | GuestHotelsSummary | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    void (kind === 'corporate' ? portalHotelsApi.summary() : guestHotelsApi.summary()).then((r) => live && setSummary(r.ok ? r.data : null));
    return () => {
      live = false;
    };
  }, [open, kind]);
  const facts = (id: string): string | null => {
    if (!summary) return null;
    if (id === PORTAL_ALL_HOTELS) return portalHotelCopy.allTotals(formatINR(summary.totals.outstandingPaise), summary.totals.openBills);
    const h = summary.hotels.find((x) => x.hotelId === id);
    if (!h) return null;
    const parts = [
      'roomNumber' in h && h.inHouse && h.roomNumber ? portalHotelCopy.room(h.roomNumber) : null,
      h.outstandingPaise > 0 ? portalHotelCopy.owes(formatINR(h.outstandingPaise)) : null,
      'unreadNotifications' in h && h.unreadNotifications > 0 ? portalHotelCopy.unread(h.unreadNotifications) : null,
      'openRequests' in h && h.openRequests > 0 ? portalHotelCopy.requests(h.openRequests) : null,
    ];
    return parts.filter(Boolean).join(' · ') || null;
  };

  // a remembered hotel this login is not linked to (any more) is forgotten
  useEffect(() => {
    if (list.state.status === 'ready' && choice !== PORTAL_ALL_HOTELS && !hotels.some((h) => h.hotelId === choice)) portalHotelStore.set(PORTAL_ALL_HOTELS);
  }, [list.state.status, hotels, choice]);

  // where the list goes: under the button, or above it when there is no room below; at least as wide as the button
  const measure = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const gap = 8;
    // the collapsed rail opens sideways; a narrow button in the top bar (MJ, 26 Oct 2026: the hotel can be changed from the top bar) opens downwards
    if (r.width < 120 && !btnRef.current?.closest('.topbar')) {
      // the collapsed rail: the list opens to the right of the icon, level with it
      const width = Math.min(280, window.innerWidth - r.right - 16);
      const maxHeight = Math.max(160, Math.min(440, window.innerHeight - 24));
      setPlace({ left: r.right + gap, width, maxHeight, edge: { top: Math.min(Math.max(12, r.top), window.innerHeight - maxHeight - 12) } });
      return;
    }
    const below = window.innerHeight - r.bottom - gap - 12;
    const above = r.top - gap - 12;
    const up = below < 240 && above > below;
    // in the top bar the list opens centred under its own button, kept on the screen (MJ, 26 Oct 2026); elsewhere under its button's left edge
    const inBar = Boolean(btnRef.current?.closest('.topbar'));
    const width = inBar ? Math.min(320, window.innerWidth - 24) : Math.min(Math.max(r.width, 264), window.innerWidth - 16);
    const centred = Math.round(r.left + r.width / 2 - width / 2);
    setPlace({
      left: inBar ? Math.min(Math.max(12, centred), window.innerWidth - width - 12) : Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
      width,
      maxHeight: Math.max(160, Math.min(up ? above : below, 440)),
      // in the top bar: the same top edge as the other top-bar drop-downs (guest-glass.css: --pt-m-top + 8px)
      edge: inBar ? { top: r.bottom + 10 } : up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap },
    });
  }, []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    measure();
    const outside = (e: Event) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !btnRef.current?.contains(n)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure, close]);

  // the focus goes to the current choice when the list opens
  useEffect(() => {
    if (!open || !place) return;
    const items = popRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const selected = popRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? items?.[0])?.focus({ preventScroll: true });
    // only when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place === null]);

  // A failed list says so, with Try again, in the card's own box (it was an invisible card before: a switcher that seemed not to work)
  if (list.state.status === 'error') {
    return (
      <div className="hotel-switch single hs-failed" role="alert">
        <span className="hs-mark"><Bi name="exclamation-triangle" /></span>
        <span className="hs-text">
          <span className="hs-hint">{portalHotelCopy.rowHotel}</span>
          <span className="hs-name">{tr("Hotels could not be loaded")}</span>
        </span>
        {/* check-shared-ignore: the card's own small retry button */}
        <button type="button" className="hs-retry" onClick={list.reload} aria-label={tr("Try loading the hotels again")} title={tr("Try again")}>
          <Bi name="arrow-clockwise" />
        </button>
      </div>
    );
  }
  // While the list is on its way, and when no hotel is linked, the card keeps its place (same box, invisible): the page under it never moves.
  if (list.state.status === 'loading' || hotels.length === 0) {
    return (
      <div className="hotel-switch single" aria-hidden="true" style={{ visibility: 'hidden' }}>
        <span className="hs-mark"><Bi name="building" /></span>
        <span className="hs-text">
          <span className="hs-hint">{portalHotelCopy.rowHotel}</span>
          <span className="hs-name">{tr(" ")}</span>
        </span>
      </div>
    );
  }
  const current = hotels.find((h) => h.hotelId === choice) ?? (hotels.length === 1 ? hotels[0] : undefined);
  const label = current?.name ?? portalHotelCopy.all;

  // One linked hotel: the card opens too (MJ: a card that does nothing looked broken) and shows that hotel with its details and how to get another one linked
  const single = hotels.length === 1;

  const pick = (value: string) => {
    close(true);
    portalHotelStore.set(value);
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(popRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    // inside the search box Home and End move the text cursor
    else if (e.key === 'Home' && !(e.target instanceof HTMLInputElement)) go(0);
    else if (e.key === 'End' && !(e.target instanceof HTMLInputElement)) go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const words = q.trim().toLowerCase();
  const options = single ? hotels : [{ hotelId: PORTAL_ALL_HOTELS, name: portalHotelCopy.all }, ...hotels.filter((h) => !words || h.name.toLowerCase().includes(words))];
  const style: CSSProperties | undefined = place
    ? ({ '--hp-left': `${place.left}px`, '--hp-w': `${place.width}px`, '--hp-max': `${place.maxHeight}px`, ...('top' in place.edge ? { '--hp-top': `${place.edge.top}px` } : { '--hp-bottom': `${place.edge.bottom}px` }) } as unknown as CSSProperties)
    : undefined;

  return (
    <div className={`hotel-switch ${open ? 'open' : ''}`}>
      {/* check-shared-ignore: the hotel switcher is a bespoke dropdown trigger (hotel-switch-btn), like the Payroll company switch */}
      <button
        ref={btnRef}
        type="button"
        className="hotel-switch-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={trf("Showing {0}. Choose another hotel", [label])}
        aria-label={trf("Showing {0}. Choose another hotel", [label])}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={`hs-mark ${current ? 'hs-initials' : ''}`}>{current ? initials(current.name) : <Bi name="buildings" />}</span>
        <span className="hs-text">
          <span className="hs-hint">{portalHotelCopy.current}</span>
          <span className="hs-name">{label}</span>
        </span>
        <Bi name="chevron-expand" className="hs-caret" />
      </button>
      {open && place && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="hotel-pop-scrim" aria-hidden="true" onClick={() => close(false)} />
              <div ref={popRef} className="hotel-pop" style={style} role="listbox" aria-label={portalHotelCopy.menuLabel} onKeyDown={onListKey}>
                <div className="hp-label">{portalHotelCopy.menuLabel}</div>
                {hotels.length > 4 ? (
                  <div className="hp-search">
                    <Bi name="search" />
                    <input type="search" placeholder={tr("Find a hotel…")} aria-label={tr("Find a hotel")} value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                ) : null}
                {options.map((h, n) => (
                  <Fragment key={h.hotelId}>
                  {n === 1 && !single ? <div className="hp-divider"><span>{tr("Switch to one hotel")}</span></div> : null}
                  {/* check-shared-ignore: an option of the hotel popover (role=option), not a page action */}
                  <button type="button" role="option" aria-selected={single || h.hotelId === choice} className={`hp-item ${single || h.hotelId === choice ? 'selected' : ''}`} onClick={() => pick(h.hotelId)}>
                    <span className={`hp-mark ${h.hotelId === PORTAL_ALL_HOTELS ? 'all' : ''}`} aria-hidden="true">{h.hotelId === PORTAL_ALL_HOTELS ? <Bi name="buildings" /> : initials(h.name)}</span>
                    <span className="hp-name-col">
                      {h.name}
                      {facts(h.hotelId) ? <small className="hp-sub">{facts(h.hotelId)}</small> : null}
                    </span>
                    {single || h.hotelId === choice ? <Bi name="check-lg" className="hp-check" /> : null}
                  </button>
                  </Fragment>
                ))}
                {options.length === 1 && words ? <div className="hp-empty">{tr("No hotel matches that name.")}</div> : null}
                {summary && summary.unavailable.length > 0 ? (
                  <div className="hp-warn" role="status">
                    <strong>{portalHotelCopy.unavailableTitle(summary.unavailable.length)}.</strong> {portalHotelCopy.unavailableBody(summary.unavailable.map((u) => u.hotelName))}
                  </div>
                ) : null}
                <div className="hp-hint">{single ? tr("Your account is linked to this hotel only. Ask the hotel to link another one.") : portalHotelCopy.hint}</div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
