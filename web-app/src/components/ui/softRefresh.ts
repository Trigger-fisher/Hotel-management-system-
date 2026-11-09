'use client';

// The SOFT REFRESH bus (R48): every `useAsync` registers its `reload` here while it is on screen, so one call can bring every loader of the current screen up to date
// behind its old data (nothing blanks; changed parts update; the slim progress line runs). Used by the F5 / Ctrl+R / Cmd+R handler of the shell (shell/SoftRefresh.tsx)
// and available to any "Refresh" button that should refresh the whole screen.
import { useSyncExternalStore } from 'react';

import { clearGetCache } from '../../lib/api/getCache';
import { refreshActivity } from './refreshActivity';

const loaders = new Set<() => void>();
let run: { failed: boolean } | null = null;

/** Called by `useAsync` while mounted. Returns the unregister function. */
export function registerLoader(reload: () => void): () => void {
  loaders.add(reload);
  return () => {
    loaders.delete(reload);
  };
}

/** Called by `useAsync` when a load ends in an error: a soft refresh that meets one counts as failed. */
export function noteLoadError(): void {
  if (run) run.failed = true;
}

export type SoftRefreshResult = 'ok' | 'failed' | 'timeout' | 'nothing';

/** Reloads every loader that is on screen and resolves when they are all done (or after `timeoutMs`). The old data stays on screen the whole time. */
export function softRefreshAll(timeoutMs = 15000): Promise<SoftRefreshResult> {
  // F5 / Refresh always reads the server, never the 20 s memory of GET answers
  clearGetCache();
  const mine = { failed: false };
  run = mine;
  const count = loaders.size;
  if (count === 0) {
    run = null;
    return Promise.resolve('nothing');
  }
  for (const reload of [...loaders]) reload();
  return new Promise((resolve) => {
    const finish = (r: SoftRefreshResult) => {
      off();
      clearTimeout(timer);
      if (run === mine) run = null;
      resolve(r);
    };
    // the reloads start in the next render; wait for the activity count to rise and fall back to zero
    let seenBusy = refreshActivity.isActive();
    const off = refreshActivity.subscribe(() => {
      if (refreshActivity.isActive()) seenBusy = true;
      else if (seenBusy) finish(mine.failed ? 'failed' : 'ok');
    });
    const timer = setTimeout(() => finish(refreshActivity.isActive() ? 'timeout' : mine.failed ? 'failed' : 'ok'), timeoutMs);
    // a screen with nothing to reload behind (all loaders still on their first load) never turns busy: do not wait for it
    setTimeout(() => { if (!seenBusy && !refreshActivity.isActive()) finish(mine.failed ? 'failed' : 'ok'); }, 800);
  });
}

// When the screen was last brought up to date by a soft refresh (F5): the shell writes "Updated just now" next to the page title, so a refresh that changed nothing still shows it happened.
let refreshedAt = 0;
const stampListeners = new Set<() => void>();

export function markRefreshed(): void {
  refreshedAt = Date.now();
  stampListeners.forEach((l) => l());
}

/** The time of the last soft refresh (0 = none yet, and always 0 on the server). */
export function useRefreshedAt(): number {
  return useSyncExternalStore(
    (l) => {
      stampListeners.add(l);
      return () => {
        stampListeners.delete(l);
      };
    },
    () => refreshedAt,
    () => 0,
  );
}