'use client';

// Loads Pallav's stylesheets while the dashboard is open and keeps the page's own sheets in step with the screen.
import { useEffect, useState, type ReactNode } from 'react';
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton';
import { loadPallavBase, pallavBaseReady, setPageSheets, unloadPallav } from './assets';

// How many frames are mounted: the sheets leave only when the last one has gone and no other took its place at once (the snapshot shell
// of a reload hands over to the real dashboard in the same tick: the sheets must not be removed and fetched again in between).
let frames = 0;
let leaving: number | undefined;

/** preloaded: the server already wrote the base stylesheets into the HTML (a signed-in first load, R48), so the page is drawn at once instead of after the sheets arrive. */
export function PallavFrame({ sheets, preloaded = false, children }: { sheets: string[]; preloaded?: boolean; children: ReactNode }) {
  // Sheets already on the page (the server wrote them, or an earlier frame loaded them): ready at once, nothing to wait for.
  const [ready, setReady] = useState(() => preloaded || (typeof document !== 'undefined' && pallavBaseReady()));
  useEffect(() => {
    frames += 1;
    if (leaving !== undefined) {
      window.clearTimeout(leaving);
      leaving = undefined;
    }
    let alive = true;
    // the first screen's own sheets too (the portals' glass look is one of them): the shell never paints in the plain hotel look first (MJ, 26 Oct 2026)
    void loadPallavBase()
      .then(() => setPageSheets(sheets))
      .then(() => alive && setReady(true));
    return () => {
      alive = false;
      frames -= 1;
      leaving = window.setTimeout(() => {
        leaving = undefined;
        if (frames === 0) unloadPallav();
      }, 80);
    };
    // the first screen's sheets only; later changes go through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const key = sheets.join('|');
  useEffect(() => {
    if (ready) void setPageSheets(sheets);
    // `key` stands for `sheets`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  // Before Pallav's sheets arrive: the same dashboard outline the reload painted (its theme comes from <html data-theme>, set by startTheme), so nothing changes
  // until the real shell is ready to replace it in one step.
  if (!ready) return <AppShellSkeleton always />;
  return <>{children}</>;
}
