'use client';

// What the company portal shows about unread notifications outside the Notifications page: the sidebar badge, the phone bar's More entry and the header bell. One small store for
// the whole tab: the shell refreshes it (on opening, when the hotel choice changes, every minute), and the page updates it at once when something is read.
import { useEffect, useSyncExternalStore } from 'react';

import type { PortalNotification } from '@shared/dashboards/notifications';
import { portalHotelStore } from '@shared/dashboards/portalHotel';

import { portalNotificationsApi } from './api';

interface Snapshot {
  unread: number;
  latest: PortalNotification[];
  /** The last answer was an error or nothing came yet: the bell then says so instead of "nothing new". */
  failed: boolean;
}
let snap: Snapshot = { unread: 0, latest: [], failed: false };
const subs = new Set<() => void>();
const set = (next: Snapshot) => {
  snap = next;
  for (const s of subs) s();
};
const subscribe = (l: () => void) => {
  subs.add(l);
  return () => {
    subs.delete(l);
  };
};
const SERVER: Snapshot = { unread: 0, latest: [], failed: false };

/** The notices this tab has already seen (null = nothing read yet), and who wants to hear about new ones (the pop-up). */
let seen: Set<string> | null = null;
const arrivals = new Set<(fresh: PortalNotification[]) => void>();
/** Calls `listener` with the notices that arrived since the last read; returns the way to stop. */
export function onNewNotices(listener: (fresh: PortalNotification[]) => void): () => void {
  arrivals.add(listener);
  return () => {
    arrivals.delete(listener);
  };
}

export const usePortalUnread = (): Snapshot => useSyncExternalStore(subscribe, () => snap, () => SERVER);

/** Reads the badge and the newest ten again (the bell shows five). A failed read keeps what is shown and marks it. */
export async function refreshPortalUnread(): Promise<void> {
  const res = await portalNotificationsApi.list({ pageSize: 10 });
  if (res.ok) {
    // notices that arrived since the last read pop up for a few seconds (MJ, 26 Oct 2026); the first read of the session only learns what is there
    const fresh = seen === null ? [] : res.data.items.filter((n) => n.readAt === null && !seen?.has(n.id));
    seen = new Set([...(seen ?? []), ...res.data.items.map((n) => n.id)]);
    set({ unread: res.data.unread, latest: res.data.items, failed: false });
    if (fresh.length > 0) for (const l of arrivals) l(fresh);
  }
  else set({ ...snap, failed: true });
}

/** The count changed locally (read one, read all): the badge follows before the next read. */
export function adjustPortalUnread(by: number): void {
  set({ ...snap, unread: Math.max(0, snap.unread + by) });
}

/** Every 10 seconds while the portal is open and on screen, and at once when the tab comes back (a new notice shows live, MJ, 1 Nov 2026). */
const EVERY_MS = 10_000;

/** Keeps the store fresh while the company portal is open. */
export function usePortalUnreadPolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    void refreshPortalUnread();
    const tick = () => {
      if (document.visibilityState === 'visible') void refreshPortalUnread();
    };
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    const off = portalHotelStore.subscribe(() => void refreshPortalUnread());
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      off();
    };
  }, [enabled]);
}