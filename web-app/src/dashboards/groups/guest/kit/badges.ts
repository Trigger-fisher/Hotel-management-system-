'use client';

// The guest tab bar's two badges (decision 71): a coral dot on Bills while something is owed (the hotels summary's outstanding total) and the number of live
// room-service orders on Room service. One module store: read when the first reader appears (once per signed-in session: the tab bar lives as long as the
// shell), again on `refreshGuest()`, and the live count follows every live-orders read (useLiveOrdersPoll).
import { useEffect, useSyncExternalStore } from 'react';

import { guestHotelsApi } from '../../portal/hotelsApi';
import { GG_REFRESH } from './refresh';

export interface GuestBadges {
  /** What the guest owes over every linked hotel (0 = nothing, or not known yet). */
  outstandingPaise: number;
  /** Room-service orders still on their way. */
  liveOrders: number;
  /** The room the guest is staying in now (any linked hotel) and that hotel's name; null = not staying, or not known yet. */
  room: string | null;
  hotelName: string | null;
  /** Both reads have answered at least once. */
  ready: boolean;
}

let snap: GuestBadges = { outstandingPaise: 0, liveOrders: 0, room: null, hotelName: null, ready: false };
const listeners = new Set<() => void>();
let readers = 0;
let run = 0;

function set(next: Partial<GuestBadges>): void {
  const merged = { ...snap, ...next };
  if (merged.outstandingPaise === snap.outstandingPaise && merged.liveOrders === snap.liveOrders && merged.room === snap.room && merged.hotelName === snap.hotelName && merged.ready === snap.ready) return;
  snap = merged;
  for (const l of listeners) l();
}

/** The live-orders count from any live-orders read (no extra request). */
export function setLiveOrderCount(n: number): void {
  set({ liveOrders: n });
}

async function load(): Promise<void> {
  const mine = ++run;
  let summary: Awaited<ReturnType<typeof guestHotelsApi.summary>>;
  let orders: Awaited<ReturnType<typeof import('./orders').ordersForStage>>;
  let isLiveOrder: typeof import('./orders').isLiveOrder;
  try {
    // the orders module is loaded only when needed (it pulls the room-service api)
    const [mod, s] = await Promise.all([import('./orders'), guestHotelsApi.summary()]);
    summary = s;
    isLiveOrder = mod.isLiveOrder;
    orders = await mod.ordersForStage();
  } catch {
    return; // a failed read keeps the last numbers
  }
  if (mine !== run) return;
  const staying = summary.ok ? summary.data.hotels.find((h) => h.inHouse && h.roomNumber) : undefined;
  set({
    room: summary.ok ? (staying?.roomNumber ?? null) : snap.room,
    hotelName: summary.ok ? (staying?.name ?? null) : snap.hotelName,
    outstandingPaise: summary.ok ? summary.data.totals.outstandingPaise : snap.outstandingPaise,
    liveOrders: orders.ok ? orders.data.items.filter(isLiveOrder).length : snap.liveOrders,
    ready: true,
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => snap;

/** The badges; the first reader starts the read, `refreshGuest()` repeats it. A failed read keeps the last numbers (no badge rather than a wrong one). */
export function useGuestBadges(): GuestBadges {
  const value = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    readers += 1;
    if (readers === 1) {
      snap = { outstandingPaise: 0, liveOrders: 0, room: null, hotelName: null, ready: false };
      void load();
    }
    const again = () => void load();
    window.addEventListener(GG_REFRESH, again);
    return () => {
      readers -= 1;
      window.removeEventListener(GG_REFRESH, again);
    };
  }, []);
  return value;
}
