'use client';
// Front Office pieces shared by its screens: the row of tabs every page carries (pms/_nav.blade.php) and links that move inside the app.
import { useEffect, useRef, type ReactNode } from 'react';

import type { ScreenProps } from '../../types';
import { ListTabs, TextAction } from '../../pallav/ui';

import { tr } from '@/lib/i18n/language';
export type FoTab = 'board' | 'reservations' | 'inHouse' | 'requests' | 'roomOrders' | 'rooms';

const tabs: { id: FoTab; view: string; label: string; icon: string }[] = [
  { id: 'board', view: 'hotel.fo.board', label: 'Room board', icon: 'grid-3x3-gap' },
  { id: 'reservations', view: 'hotel.fo.reservations', label: 'Reservations', icon: 'calendar-plus' },
  { id: 'inHouse', view: 'hotel.fo.inHouse', label: 'In-house guests', icon: 'house-heart' },
  { id: 'roomOrders', view: 'hotel.fo.roomOrders', label: 'Dining orders', icon: 'cup-straw' },
  { id: 'requests', view: 'hotel.fo.requests', label: 'Guest requests', icon: 'hand-index' },
  { id: 'rooms', view: 'hotel.fo.rooms', label: 'Rooms', icon: 'door-open' },
];

/** A link that opens another screen without leaving the page (Pallav's plain `<a href>`). */
export function GoLink({ to, params, navigate, className, title, children }: { to: string; params?: Record<string, string>; navigate: ScreenProps['navigate']; className?: string; title?: string; children: ReactNode }) {
  return (
    <a
      href="#"
      className={className}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        navigate(to, params);
      }}
    >
      {children}
    </a>
  );
}

/** `<nav class="wa-nav">`: the four parts of the Front Office, and the two quick buttons at the right. */
export function FoNav({ active, navigate, quick = true }: { active: FoTab; navigate: ScreenProps['navigate']; quick?: boolean }) {
  // On a phone the strip scrolls sideways: bring the current tab into view, so a tab far to the right (Requests, Messages) shows where you are
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = strip.current;
    const tab = nav?.querySelector<HTMLElement>('.wa-tab.active');
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2);
  }, [active]);
  return (
    <nav ref={strip} className="wa-nav reveal" aria-label={tr("Front office sections")}>
      {tabs.map((t) => (
        <GoLink key={t.id} to={t.view} navigate={navigate} className={`wa-tab ${active === t.id ? 'active' : ''}`}>
          <i className={`bi bi-${t.icon}`} /> <span>{t.label}</span>
        </GoLink>
      ))}
      {quick && (
        <span className="ms-auto d-flex gap-2 fo-nav-actions">
          <GoLink to="hotel.fo.reservationForm" navigate={navigate} className="btn btn-sm btn-outline-p"><i className="bi bi-plus-lg" /> {tr("Reservation")}</GoLink>
          <GoLink to="hotel.fo.checkIn" params={{ walkIn: '1' }} navigate={navigate} className="btn btn-sm btn-p"><i className="bi bi-box-arrow-in-right" /> {tr("Walk-in check-in")}</GoLink>
        </span>
      )}
    </nav>
  );
}

/** `<x-filter-bar tabs-label="Show">`: plain tabs (no counts), a summary and a Reset. */
export function FoFilterBar({ tabs: items, active, onTab, summary, onReset }: { tabs: { id: string; label: string; count?: number }[]; active: string; onTab: (id: string) => void; summary: string; onReset?: () => void }) {
  return (
    <div className="bm-fbar" role="search">
      <div className="bm-fbar-top">
        <div className="bm-tabs-wrap">
          <ListTabs label={tr("Show")} active={active} onChange={onTab} tabs={items.map((t) => ({ id: t.id, label: t.label, count: t.count }))} />
        </div>
        <div className="bm-fbar-summary">
          <span aria-live="polite">{summary}</span>
          {onReset && (
            <TextAction kind="reset" onClick={onReset}>{tr("Reset")}</TextAction>
          )}
        </div>
      </div>
    </div>
  );
}

const snake: Record<string, string> = { checkedIn: 'checked_in', checkedOut: 'checked_out', noShow: 'no_show', inHouse: 'checked_in' };
/** The status chip (`.fo-status confirmed | checked_in | checked_out | cancelled | no_show`). */
export const foStatusClass = (s: string): string => snake[s] ?? s;
