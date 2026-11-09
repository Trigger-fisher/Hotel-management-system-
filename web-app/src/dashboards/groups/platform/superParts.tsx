'use client';

// Pieces the Super Admin's own pages share (task A7: All users, Audit log, Sign-in history): the "Super Admin only" notice and the level badge.
// Pallav's classes only (`card`, `empty-state`, `role-pill`); colours are Pallav's variables, so night mode follows on its own.
import { useEffect, useRef, type CSSProperties } from 'react';

import { formatDate, formatDateTime, formatTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformUserLevel } from '@shared/dashboards/platform';

import { Bi, EmptyState } from '@/dashboards/pallav/ui';

/** Activity newest first: what happened in bold, then when and by whom (hotel and group pages). */
export function Timeline({ rows }: { rows: { id: string; at: string; actorName: string; text: string }[] }) {
  return (
    <ol className="pf-timeline">
      {rows.map((x) => (
        <li key={x.id}>
          <span className="pf-tl-dot" aria-hidden="true" />
          <div className="pf-tl-body">
            <b>{x.text}</b>
            <small>
              {formatDateTime(x.at)} · {platformCopy.hotelConsole.details.byWhom(x.actorName)}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A moment as the date over the time: the date never breaks across lines (it took three in a narrow cell) and the column stays narrow. */
export function When({ iso }: { iso: string }) {
  return (
    <>
      <span className="text-nowrap">{formatDate(iso)}</span>
      <div className="small text-muted text-nowrap">{formatTime(iso)}</div>
    </>
  );
}

const LEVEL_ICON: Record<PlatformUserLevel, string> = {
  super_admin: 'shield-fill-check',
  platform_admin: 'shield-check',
  group_admin: 'buildings',
  hotel_admin: 'person-badge',
  hotel_user: 'person',
};

/** Shown instead of the page to anybody whose account role is not super_admin. */
export function SuperOnly() {
  return (
    <div className="card reveal">
      <EmptyState icon="shield-lock" title={platformCopy.superOnly.title} text={platformCopy.superOnly.body} />
    </div>
  );
}

/**
 * An email address that may wrap in a narrow table cell: break points after the "@" and before each "." (never inside a word), so
 * "rohit.naik@bluelagoonresidency.in" takes two short lines instead of widening its column. Used by the Platform list tables.
 */
export function WrapEmail({ email }: { email: string }) {
  const at = email.indexOf('@');
  const local = at < 0 ? email : email.slice(0, at);
  const domain = at < 0 ? '' : email.slice(at + 1);
  const dots = (s: string) => s.split('.').flatMap((part, i) => (i === 0 ? [part] : [<wbr key={`${s}-${i}`} />, `.${part}`]));
  return (
    <span className="hms-wrap-any">
      {dots(local)}
      {at < 0 ? null : (
        <>
          @<wbr />
          {dots(domain)}
        </>
      )}
    </span>
  );
}

/**
 * The filter bar's status tabs on a phone (Platform Hotels, Invitations): the strip (`.bm-tabs`, Pallav already scrolls it sideways)
 * keeps the chosen tab and a keyboard-focused tab in view, and says which edge still has tabs behind it (`data-hms-more="start end"`),
 * which `hms-overrides.css` turns into an edge fade under 576px. Put the ref on a `d-contents` wrapper around the `FilterBar`; `shown`
 * is true once the bar is on the page (it waits for the list to load).
 */
export function useTabStrip(active: string, shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current?.querySelector<HTMLElement>('.bm-tabs');
    if (!strip) return;
    const mark = () => {
      const more = [strip.scrollLeft > 2 ? 'start' : '', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2 ? 'end' : ''].filter(Boolean).join(' ');
      if (more) strip.setAttribute('data-hms-more', more);
      else strip.removeAttribute('data-hms-more');
    };
    // Bring a tab fully into view, clear of the faded edge (32px), without moving the page itself.
    const show = (tab: Element | null) => {
      if (!tab || strip.scrollWidth <= strip.clientWidth) return;
      const s = strip.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      const pad = 32;
      if (t.left < s.left + pad) strip.scrollLeft += t.left - s.left - pad;
      else if (t.right > s.right - pad) strip.scrollLeft += t.right - s.right + pad;
    };
    const onFocus = (e: FocusEvent) => show((e.target as Element | null)?.closest('.bm-tab') ?? null);
    show(strip.querySelector('.bm-tab.active'));
    mark();
    strip.addEventListener('scroll', mark, { passive: true });
    strip.addEventListener('focusin', onFocus);
    // A new width (window turned, counts arrived) changes which edges hide tabs.
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    sized?.observe(strip);
    return () => {
      strip.removeEventListener('scroll', mark);
      strip.removeEventListener('focusin', onFocus);
      sized?.disconnect();
    };
  }, [active, shown]);
  return ref;
}

/** The account level as Pallav's role pill (users/index: `.role-pill` with --role / --role-bg). */
export function LevelPill({ level }: { level: PlatformUserLevel }) {
  const top = level === 'super_admin' || level === 'platform_admin';
  const style = { '--role': top ? 'var(--p800)' : 'var(--p700)', '--role-bg': top ? 'var(--p200)' : 'var(--p100)' } as CSSProperties;
  return (
    <span className="role-pill" style={style}>
      <Bi name={LEVEL_ICON[level]} />
      {platformCopy.status.level[level]}
    </span>
  );
}
