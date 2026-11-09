'use client';

// What the payroll and company screens share while data loads, fails or is offline, and the PDF link that works in mock mode.
// The blocks are Pallav's own (`.skel`, `.card`, `.empty-state`, `.alert`); nothing new is drawn.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { dashLabels, type DashError, type DashResult } from '@shared/dashboards/common';
import { formatDate } from '@shared/dashboards/format';
import { overviewCopy } from '@shared/dashboards/overview';
import { Bi, PageSkeleton, openPdf, Button } from '@/dashboards/pallav/ui';
import { errorText, useAsync, useToast } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';

import { tr } from '@/lib/i18n/language';
/**
 * `useAsync`, but the last rows stay on screen while a list reloads (after a save, a filter change or Try again), as Pallav keeps the
 * page until the next one arrives. `data` is null only before the first answer; `error` is the latest failure (null once a load works).
 */
export function useLoaded<T>(
  load: () => Promise<DashResult<T>>,
  deps: unknown[],
  /** Rows of another scope (another company, another account) are never shown while this one loads. */
  scope: unknown = null,
): { data: T | null; error: DashError | null; loading: boolean; reload: () => void } {
  const { state, reload } = useAsync(load, deps);
  const [kept, setKept] = useState<{ data: T; scope: unknown } | null>(null);
  if (state.status === 'ready' && (kept?.data !== state.data || kept.scope !== scope)) setKept({ data: state.data, scope });
  return {
    data: state.status === 'ready' ? state.data : kept && kept.scope === scope ? kept.data : null,
    error: state.status === 'error' ? state.error : null,
    loading: state.status === 'loading',
    reload,
  };
}

/** The first load of a page: still blocks while it runs, then the error card (or the offline card) with Try again. */
export function Wait({ error, onRetry, tiles = true, rows = 4 }: { error: DashError | null; onRetry: () => void; tiles?: boolean; rows?: number }) {
  if (!error) return <PageSkeleton tiles={tiles} rows={rows} />;
  const offline = error.code === 'NETWORK_OFFLINE';
  return (
    <div className="card">
      <div className="empty-state">
        <div className="es-icon">
          <Bi name={offline ? 'wifi-off' : 'exclamation-triangle'} />
        </div>
        <div className="es-title">{offline ? dashLabels.offlineTitle : tr("This page could not be loaded")}</div>
        <div className="es-text">{errorText(error)}</div>
        <Button variant="outline" icon="arrow-clockwise" onClick={onRetry} className="mt-3">{tr("Try again")}</Button>
      </div>
    </div>
  );
}

/** A reload that failed while older rows are still shown (offline after the page opened): say so, keep the rows. */
export function StaleNote({ error, onRetry }: { error: DashError | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
      <Bi name={error.code === 'NETWORK_OFFLINE' ? 'wifi-off' : 'exclamation-triangle'} />
      <span className="flex-grow-1">{errorText(error)} {tr("The list below may be out of date.")}</span>
      <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={onRetry}>{tr("Try again")}</Button>
    </div>
  );
}

/** PHP's `number_format($n)`: a whole count with commas (1,234), as Pallav prints counts. */
export function count(n: number): string {
  const whole = Math.trunc(n);
  return `${whole < 0 ? '-' : ''}${String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** PHP's `number_format($n, $places)` for days and hours (12.50, 3.0). */
export function fixed(n: number, places = 2): string {
  const f = 10 ** places;
  const r = Math.round(n * f);
  const abs = Math.abs(r);
  const whole = count(Math.floor(abs / f));
  return `${r < 0 ? '-' : ''}${whole}${places > 0 ? `.${String(abs % f).padStart(places, '0')}` : ''}`;
}

/**
 * IST wall clock "HH:mm:ss" of a stored moment (Pallav prints its local time). An ISO with a zone (Z / +hh:mm) is shifted to IST;
 * a plain "YYYY-MM-DDTHH:mm[:ss]" is already local and is shown as written.
 */
export function istClock(iso: string): string {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return `${iso.slice(11, 19)}${iso.length === 16 ? ':00' : ''}`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso.slice(11, 19) : new Date(t + 330 * 60_000).toISOString().slice(11, 19);
}

/** IST calendar date "YYYY-MM-DD" of a stored moment (for grouping by day). */
export function istDay(iso: string): string {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return iso.slice(0, 10);
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso.slice(0, 10) : new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DDTHH:mm" in IST, the value a date-and-time field edits. */
export function istLocal(iso: string): string {
  return `${istDay(iso)}T${istClock(iso).slice(0, 5)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Carbon `format('l, d M Y')` for a plain date: "Monday, 05 Oct 2026". */
export function longDay(iso: string): string {
  const d = iso.slice(0, 10);
  const day = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay();
  return `${WEEKDAYS[day]}, ${formatDate(d)}`;
}

/**
 * A PDF link in mock mode: the kit's `openPdf` (its mock toast, named after the document, then the print view). Real mode: nothing here,
 * the link opens the server's PDF as Pallav's `<a target="_blank">` does. `print: false` only explains (a stored file, not a document).
 */
export function useMockPdf(): (doc: string, opts?: { print?: boolean }) => (e: MouseEvent) => void {
  const toast = useToast();
  return (doc, opts = {}) =>
    (e) => {
      if (apiMode() !== 'mock') return;
      e.preventDefault();
      const info = (text: string) => toast.show({ tone: 'info', text: `${doc}: ${text}` });
      if (opts.print === false) {
        info(overviewCopy.reports.pdfMock);
        return;
      }
      void openPdf('', (text) => toast.show({ tone: 'error', text }), info);
    };
}

/** Pallav's `<a target="_blank" href="…pdf">` (same class, title and children as the Blade), with the mock behaviour of `useMockPdf`. */
export function PdfLink({ href, doc, className, title, children }: { href: string; doc: string; className: string; title?: string; children: ReactNode }) {
  const onPdf = useMockPdf();
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" title={title} onClick={onPdf(doc)}>
      {children}
    </a>
  );
}
