'use client';

// Live room-service orders (decision 71): the 30-second status refresh Home and Room service share, the badge count, and the two order views other pages use
// (LiveOrders, OrderTracker), drawn by Room service's own YourOrders (OrderParts.tsx).
import { useEffect, useRef } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import type { GuestRoomOrders, RoomOrder } from '@shared/dashboards/roomService';

import { useAsync } from '@/components/ui';
import type { AsyncState } from '@/components/ui/useAsync';
import { apiMode } from '@/lib/api/mode';

import { guestMockInHouse } from '../api';
import { YourOrders } from '../OrderParts';
import { guestOrdersApi } from '../../roomService/api';
import { setLiveOrderCount } from './badges';
import { useGuestRefresh } from './refresh';

/** How often the guest's live orders are read again while the page is visible. */
export const LIVE_ORDERS_POLL_MS = 30_000;

/** An order still on its way (not delivered, not cancelled). */
export const isLiveOrder = (o: Pick<RoomOrder, 'status'>): boolean => o.status !== 'delivered' && o.status !== 'cancelled';

const EMPTY: DashResult<GuestRoomOrders> = { ok: true, data: { items: [], guestCancelMinutes: [], unavailable: [] } };

/** The guest's orders as this stage shows them: the demo guest outside a stay (the preview's stages) has none. Real server: as the server says. */
export function ordersForStage(): Promise<DashResult<GuestRoomOrders>> {
  if (apiMode() === 'mock' && !guestMockInHouse()) return Promise.resolve(EMPTY);
  return guestOrdersApi.list();
}

/**
 * The guest's room-service orders, newest first, read again every 30 seconds while the tab is visible and at least one order is live (and at once when the tab
 * comes back); the timer stops on unmount. Also reloads on `refreshGuest()` and keeps the tab bar's Room service count in step.
 */
export function useLiveOrdersPoll(enabled = true): { state: AsyncState<GuestRoomOrders>; reload: () => void; items: RoomOrder[]; live: RoomOrder[] } {
  const list = useAsync(() => (enabled ? ordersForStage() : Promise.resolve(EMPTY)), [enabled], { keep: true });
  const items = list.state.status === 'ready' ? list.state.data.items : [];
  const live = items.filter(isLiveOrder);
  const anyLive = live.length > 0;
  const reloadRef = useRef(list.reload);
  useEffect(() => {
    reloadRef.current = list.reload;
  });
  useGuestRefresh(list.reload);

  useEffect(() => {
    if (!enabled || !anyLive) return undefined;
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => {
      if (visible()) reloadRef.current();
    }, LIVE_ORDERS_POLL_MS);
    const onShow = () => {
      if (visible()) reloadRef.current();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [enabled, anyLive]);

  const ready = list.state.status === 'ready';
  useEffect(() => {
    if (ready) setLiveOrderCount(live.length);
  }, [ready, live.length]);

  return { state: list.state, reload: list.reload, items, live };
}

/**
 * The guest's live orders, compact, for Home (Room service's YourOrders, refreshing itself every 30 seconds while one is live). Draws nothing when there are none.
 * Props: `limit` (default 3) and `onOpen` (the "Room service" link).
 */
export function LiveOrders({ limit = 3, onOpen }: { limit?: number; onOpen?: () => void }) {
  return <YourOrders version={0} activeOnly limit={limit} link={onOpen ? { label: 'Dining', onPress: onOpen } : undefined} />;
}

/** Every order with its status steps and the cancel window (Room service's YourOrders). */
export function OrderTracker({ version = 0 }: { version?: number }) {
  return <YourOrders version={version} />;
}
