'use client';

// The shared mobile kit's small pieces (docs/plans/MOBILE-APP-FEEL-PLAN-2026-10-18.md), used by the portals first and by every role later.
//   StickyActions: the bottom action bar of a detail or form page on a phone (Pay, Save, Download), one-hand reachable above the tab bar; nothing on wider screens.
//   useCursorList + LoadMore: a list read by cursor ("All hotels" lists, docs/BACKEND.md), shown page by page with numbers (MJ, 26 Oct 2026); a cursor the
//   server no longer accepts (422 on `cursor`) starts the list again from the top.
import { useState, type ReactNode } from 'react';

import type { DashError, DashResult } from '@shared/dashboards/common';

import { errorText, useAsync, useToast } from '@/components/ui';
import type { AsyncState } from '@/components/ui/useAsync';
import { openPdf, PortalButton } from '@/dashboards/pallav/ui';

import { tr, trf } from '@/lib/i18n/language';
export function StickyActions({ children, label = 'Actions' }: { children: ReactNode; label?: string }) {
  return (
    <div className="app-sticky" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/** How many rows a cursor page asks for. */
export const CURSOR_LIMIT = 25;

export interface CursorList<T, P> {
  state: AsyncState<P>;
  reload: () => void;
  /** The first page's answer (totals, summary, unavailable hotels); null before it arrives. */
  head: P | null;
  /** The rows of the page on screen (MJ, 26 Oct 2026: page by page, not "Load more"). */
  items: T[];
  /** The page on screen, from 1. */
  page: number;
  /** Opens page `n` (from 1); the cursors of the pages before it are read first when they are not known yet. */
  goPage: (n: number) => void;
  /** A later page exists. */
  next: string | null;
  /** The next page (kept for older callers). */
  loadMore: () => void;
  busy: boolean;
  failed: DashError | null;
}

/**
 * A list read by cursor, shown PAGE BY PAGE with numbers (MJ, 26 Oct 2026). `load(cursor)` reads one page: no cursor = the first. `deps` restart the list at
 * page 1 (search, hotel, period, tab). The cursor of each page is kept, so going back is instant and jumping ahead reads only the pages in between once.
 */
export function useCursorList<T, P extends { items: T[]; nextCursor?: string | null }>(load: (cursor?: string) => Promise<DashResult<P>>, deps: unknown[]): CursorList<T, P> {
  const first = useAsync(() => load(), deps, { keep: true });
  const head = first.state.status === 'ready' ? first.state.data : null;
  // the page on screen after the first; tied to the first page's answer, so a new search or a reload starts again at page 1
  const [view, setView] = useState<{ head: P; page: number; items: T[]; cursors: (string | undefined)[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<DashError | null>(null);
  const v = view && view.head === head ? view : null;
  const page = v?.page ?? 1;
  const items = v ? v.items : (head?.items ?? []);
  // cursors[k] reads page k + 1 (cursors[0] is the first page: no cursor)
  const cursors = v?.cursors ?? [undefined, head?.nextCursor ?? undefined];
  const next = cursors[page] ?? null;

  const goPage = (n: number) => {
    if (!head || busy || n === page || n < 1) return;
    const top = () => window.scrollTo?.({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (n === 1) {
      setView(null);
      setFailed(null);
      top();
      return;
    }
    setBusy(true);
    setFailed(null);
    void (async () => {
      const cs = [...cursors];
      // read the pages in between once, to learn the cursor of page n
      while (cs.length < n) {
        const at = cs[cs.length - 1];
        if (at === undefined) break;
        const res = await load(at);
        if (!res.ok) return fail(res.error);
        cs.push(res.data.nextCursor ?? undefined);
      }
      const at = cs[n - 1];
      if (at === undefined) {
        setBusy(false);
        return;
      }
      const res = await load(at);
      if (!res.ok) return fail(res.error);
      cs[n] = res.data.nextCursor ?? undefined;
      setBusy(false);
      setView({ head, page: n, items: res.data.items, cursors: cs });
      top();
    })();
  };
  function fail(error: DashError): void {
    setBusy(false);
    if (error.code === 'VALIDATION_FAILED' && error.details?.fields?.cursor) first.reload();
    else setFailed(error);
  }
  return { state: first.state, reload: first.reload, head, items, page, goPage, next, loadMore: () => goPage(page + 1), busy, failed };
}

/** The page numbers to show: the first, the last, and the pages around the current one, with gaps ("…") between. */
function pageWindow(page: number, pages: number): (number | 'gap')[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] ?? p) > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

/**
 * The list's pager, on every screen size (MJ, 26 Oct 2026: page-wise pagination): "Showing 26-50 of 60", Previous, the page numbers and Next. A failed page
 * says why. Nothing shows for a list of one page. (The name stays LoadMore for its callers.)
 */
export function LoadMore({ list, total, limit = CURSOR_LIMIT }: { list: Pick<CursorList<unknown, unknown>, 'items' | 'page' | 'goPage' | 'next' | 'busy' | 'failed'>; total: number; limit?: number }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (list.page - 1) * limit + 1;
  const to = Math.min(total, from + list.items.length - 1);
  if (pages <= 1 && !list.failed) return null;
  return (
    <nav className="pt-pager" aria-label={tr("Pages")}>
      <span className="pt-pager-info" aria-live="polite">
        {total === 0 ? tr("No records") : `Showing ${from}-${to} of ${total}`}
        {list.failed ? (
          <span className="pt-pager-err" role="alert">
            {` · ${errorText(list.failed)}`}
          </span>
        ) : null}
      </span>
      <span className="pt-pager-ctl">
        {/* check-shared-ignore: the pager's previous button (44px), part of the pager */}
        <button type="button" className="pt-pager-btn" aria-label={tr("Previous page")} disabled={list.page <= 1 || list.busy} onClick={() => list.goPage(list.page - 1)}>
          <i className="bi bi-chevron-left" aria-hidden="true" />
        </button>
        {pageWindow(list.page, pages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="pt-pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            // check-shared-ignore: a page number button (44px), part of the pager
            <button key={p} type="button" className={`pt-pager-btn${p === list.page ? ' on' : ''}`} aria-current={p === list.page ? 'page' : undefined} aria-label={trf("Page {0}", [p])} disabled={list.busy} onClick={() => list.goPage(p)}>
              {p}
            </button>
          ),
        )}
        {/* check-shared-ignore: the pager's next button (44px), part of the pager */}
        <button type="button" className="pt-pager-btn" aria-label={tr("Next page")} disabled={list.page >= pages || list.busy} onClick={() => list.goPage(list.page + 1)}>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>
      </span>
    </nav>
  );
}

/** A portal button that opens a server PDF in a new tab (a refusal, like the running stay bill, comes back as a toast with the server's sentence). */
export function PdfAction({ url, label, icon = 'download', variant = 'line' }: { url: string; label: string; icon?: string; variant?: 'line' | 'solid' }) {
  const toast = useToast();
  return (
    <PortalButton
      variant={variant}
      icon={icon}
      onClick={() => void openPdf(url, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }))}
    >
      {label}
    </PortalButton>
  );
}