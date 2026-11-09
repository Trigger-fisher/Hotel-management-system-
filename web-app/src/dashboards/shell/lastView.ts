// Where each signed-in person was in the dashboard, so a screen lock / unlock (which unmounts the dashboard) and a page RELOAD bring them back to the same page
// (decision 49). Kept in memory, and mirrored to this tab's sessionStorage (never localStorage: a new tab or a new visit starts on the dashboard); forgotten when the
// session ends. Only page ids and their small params are stored, no session, token, code or personal text. Every storage access is guarded: blocked storage just
// means the page is remembered in memory only. Tiny on purpose: the sign-in app imports it without pulling in the dashboard.
export interface LastView {
  viewId: string;
  params: Record<string, string>;
  rootId: string;
}

const PREFIX = 'hms-last-views:';
const stacks = new Map<string, LastView[]>();

/**
 * True when this page load is a reload (F5, the refresh button, a hard refresh: the browser does not tell the page which) or a back/forward move: the remembered
 * page is then restored. A fresh visit (a new tab, a typed address, a bookmark) is a "navigate" and starts on the dashboard.
 */
const keepsPage: boolean = (() => {
  try {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === 'reload' || entry?.type === 'back_forward';
  } catch {
    return false;
  }
})();

function readStored(userKey: string): LastView[] | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + userKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const ok = parsed.every((v) => v && typeof v === 'object' && typeof (v as LastView).viewId === 'string' && typeof (v as LastView).rootId === 'string' && typeof (v as LastView).params === 'object');
    return ok && parsed.length > 0 ? (parsed as LastView[]) : undefined;
  } catch {
    return undefined;
  }
}

export const lastViews = {
  get: (userId: string): LastView[] | undefined => {
    const kept = stacks.get(userId);
    if (kept) return kept;
    // After a reload the memory is empty: ask the tab's own copy once, and only when the browser says this load is a reload.
    if (!keepsPage) return undefined;
    const stored = readStored(userId);
    if (stored) stacks.set(userId, stored);
    return stored;
  },
  set: (userId: string, stack: LastView[]): void => {
    stacks.set(userId, stack);
    try {
      sessionStorage.setItem(PREFIX + userId, JSON.stringify(stack.map((v) => ({ viewId: v.viewId, params: v.params, rootId: v.rootId }))));
    } catch {
      // private window, storage full or blocked: remembered in memory only
    }
  },
  /** Called when a session ends (sign-out, expiry, switch user): the next sign-in starts on the first page. */
  forgetAll: (): void => {
    stacks.clear();
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(PREFIX)) sessionStorage.removeItem(key);
      }
    } catch {
      // blocked storage: nothing to clear
    }
  },
};
