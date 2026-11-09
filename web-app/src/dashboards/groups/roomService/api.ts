'use client';

// Room service with a status: the guest's orders (Order to room) and the hotel desk's queue (Front Office > Room service orders) over ONE mock store, so an order the
// desk moves or cancels changes on the guest's page too. Real server: lib/api/adapters/roomService.ts.
import type { RoomServiceApi } from '@shared/dashboards/roomService';

import { createHttpRoomServiceApi } from '@/lib/api/adapters/roomService';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
let shared: Promise<RoomServiceApi> | null = null;
const mock = () => (shared ??= loadMocks().then((m) => m.createRoomServiceMock({ offline })));

const api: RoomServiceApi = chooseApi(
  () => createHttpRoomServiceApi(),
  () => ({
    guest: lazyMock(async () => (await mock()).guest),
    desk: lazyMock(async () => (await mock()).desk),
  }) as RoomServiceApi,
);

export const guestOrdersApi = api.guest;
export const deskOrdersApi = api.desk;