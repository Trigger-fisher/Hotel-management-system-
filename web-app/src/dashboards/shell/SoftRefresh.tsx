'use client';

// The soft refresh (R48, MJ): a normal reload key (F5, Ctrl+R, Cmd+R) does NOT reload the document. It brings every loader of the screen up to date behind its old data
// (components/ui/softRefresh.ts), checks the session again in the background, and keeps everything else: sidebar, top bar, scroll, open rows, typed text, tab, filters.
// A HARD reload (Ctrl+Shift+R, Ctrl+F5, Shift+F5, Cmd+Shift+R), the browser's own reload button and its pull-to-refresh stay native. Escapes: a second reload key press
// within 3 seconds while the first has not finished, or after it failed or ran longer than 15 seconds, does a real reload; a new deployment (the build id the server reports
// differs from this page's) does one real reload so the new code loads. One handler, mounted once, removed on unmount.
import { useEffect, useRef, useState } from 'react';

import { markRefreshed, softRefreshAll } from '@/components/ui/softRefresh';

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
const DEBOUNCE_MS = 600;
const SECOND_PRESS_MS = 3000;
const SLOW_MS = 15000;
// The content shimmers for at least this long, so a refresh that changes nothing is still seen (a calm sign, not a flash).
const SHOW_MS = 700;
const RELOADED_FOR_BUILD = 'hms-reloaded-for-build';

type Phase = 'idle' | 'refreshing' | 'failed';

/** A new deployment is out when the server's build id is not the one this page was built with (cheap: one tiny request). */
async function buildChanged(): Promise<boolean> {
  if (!BUILD_ID) return false;
  try {
    const res = await fetch('/api/v1/health', { cache: 'no-store' });
    const server = res.headers.get('x-hms-build');
    return Boolean(server) && server !== BUILD_ID;
  } catch {
    return false;
  }
}

/** True for a plain reload key press; a hard-reload combination is NOT one (it stays native). */
export function isSoftReloadKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key === 'f5') return !e.ctrlKey && !e.metaKey; // Ctrl+F5 is a hard reload
  return key === 'r' && (e.ctrlKey || e.metaKey);
}

export function SoftRefresh() {
  const [message, setMessage] = useState('');
  const phase = useRef<Phase>('idle');
  const startedAt = useRef(0);
  const lastPress = useRef(0);

  useEffect(() => {
    let alive = true;
    const onKey = async (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSoftReloadKey(e)) return;
      // Inside a native dialog (a modal the browser manages) the key keeps its normal meaning.
      if (document.querySelector('dialog[open]')) return;
      const now = Date.now();
      const sinceLast = now - lastPress.current;
      lastPress.current = now;
      // Escape: pressed again while the first refresh is still running, or after it failed or ran too long: a real reload.
      const slow = phase.current === 'refreshing' && now - startedAt.current > SLOW_MS;
      if (phase.current === 'failed' || slow || (phase.current === 'refreshing' && sinceLast > DEBOUNCE_MS && sinceLast <= SECOND_PRESS_MS)) return;
      e.preventDefault();
      if (phase.current === 'refreshing' || sinceLast <= DEBOUNCE_MS) return; // a held key or a double tap: one refresh
      phase.current = 'refreshing';
      startedAt.current = now;
      // The session is checked again in the background (the same check as the periodic one): an ended session goes to sign-in by itself.
      window.dispatchEvent(new Event('hms:check-session'));
      document.body.classList.add('hms-softing');
      const outcome = await softRefreshAll(SLOW_MS);
      const shown = SHOW_MS - (Date.now() - now);
      if (shown > 0) await new Promise((r) => window.setTimeout(r, shown));
      document.body.classList.remove('hms-softing');
      if (!alive) return;
      if (outcome === 'ok' || outcome === 'nothing') markRefreshed();
      if (await buildChanged()) {
        // A new deployment: one real reload so the new code loads; the remembered page and tab come back (decision 49).
        try {
          if (sessionStorage.getItem(RELOADED_FOR_BUILD) !== BUILD_ID) {
            sessionStorage.setItem(RELOADED_FOR_BUILD, BUILD_ID);
            window.location.reload();
            return;
          }
        } catch {
          /* storage blocked: stay on this page */
        }
      }
      phase.current = outcome === 'failed' || outcome === 'timeout' ? 'failed' : 'idle';
      if (phase.current === 'failed') {
        // After a failure the person may press again for a real reload (escape); the flag clears after the escape window.
        window.setTimeout(() => { if (alive && phase.current === 'failed') phase.current = 'idle'; }, SECOND_PRESS_MS);
      }
      setMessage('Refreshed');
      window.setTimeout(() => alive && setMessage(''), 1500);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      alive = false;
      document.body.classList.remove('hms-softing');
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Screen readers hear "Refreshed" once a soft refresh is done; nothing is drawn.
  return <div className="sr-only" role="status" aria-live="polite">{message}</div>;
}
