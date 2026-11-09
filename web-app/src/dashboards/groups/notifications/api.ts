'use client';

// The notifications APIs, one pair per browser session: the hotel's (Companies > Notifications) and the company portal's. In the mock both read ONE store, so a
// notice sent on the hotel side shows up in the portal (the mock is loaded through lib/api/mockLoader.ts). Against the real server they are two sets of routes.
import type { NotificationsApi, PortalNotificationsApi } from '@shared/dashboards/notifications';

import { createHttpNotificationsApi, createHttpPortalNotificationsApi } from '@/lib/api/adapters/notifications';
import { lazyMock, loadMocks, type MockModule } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
let loading: Promise<{ m: MockModule; store: ReturnType<MockModule['createNotificationsStore']> }> | null = null;
const shared = () =>
  (loading ??= loadMocks().then((m) => ({ m, store: m.createNotificationsStore() })));

export const notificationsApi: NotificationsApi = chooseApi(
  () => createHttpNotificationsApi(),
  () => lazyMock(async () => { const { m, store } = await shared(); return m.createNotificationsMock({ offline }, store); }),
);

export const portalNotificationsApi: PortalNotificationsApi = chooseApi(
  () => createHttpPortalNotificationsApi(),
  () => lazyMock(async () => { const { m, store } = await shared(); return m.withPortalDemo(m.createPortalNotificationsMock({ offline }, store), 'company'); }),
);