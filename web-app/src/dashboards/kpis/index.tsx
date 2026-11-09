'use client';

// The KPI row every page carries (MJ, 5 Nov 2026: "KPI cards on every page"). The shell draws it above the page, under the title; the guest portal's page frame
// (GgPage) takes it from KpiSlot instead so it sits under the large title. Pages that already draw their own figures have no entry here.
import { createContext, lazy, Suspense, useContext, type ComponentType, type ReactNode } from 'react';

import type { ScreenProps } from '../types';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;
type Area = 'platform' | 'group' | 'hotel' | 'corporate' | 'guest';

const areas: Record<Area, ComponentType<P & { viewId: string }>> = {
  platform: lazy(() => import('./platform').then((m) => ({ default: ({ viewId, ...p }: P & { viewId: string }) => pick(m.platformKpis, viewId, p) }))),
  group: lazy(() => import('./group').then((m) => ({ default: ({ viewId, ...p }: P & { viewId: string }) => pick(m.groupKpis, viewId, p) }))),
  hotel: lazy(() => import('./hotel').then((m) => ({ default: ({ viewId, ...p }: P & { viewId: string }) => pick(m.hotelKpis, viewId, p) }))),
  corporate: lazy(() => import('./corporate').then((m) => ({ default: ({ viewId, ...p }: P & { viewId: string }) => pick(m.corporateKpis, viewId, p) }))),
  guest: lazy(() => import('./guest').then((m) => ({ default: ({ viewId, ...p }: P & { viewId: string }) => pick(m.guestKpis, viewId, p) }))),
};

function pick(map: Record<string, ComponentType<P>>, viewId: string, p: P): ReactNode {
  const Row = map[viewId];
  return Row ? <Row {...p} /> : null;
}

/** Every view id that gets a row from here (the pages that draw their own figures are not in it). */
export const KPI_VIEWS: ReadonlySet<string> = new Set([
  'platform.hotels', 'platform.groups', 'platform.admins', 'platform.invitations', 'platform.users', 'platform.audit', 'platform.signins', 'platform.staff', 'platform.health',
  'platform.settings', 'platform.archived', 'platform.announcements', 'platform.demoRequests', 'platform.setup', 'platform.central', 'platform.duplicates',
  'group.hotels', 'group.invitations', 'group.hotels.invite', 'group.admins',
  'hotel.fo.reservations', 'hotel.fo.inHouse', 'hotel.fo.rooms', 'hotel.fo.requests', 'hotel.fo.roomOrders', 'hotel.co.notifications', 'hotel.admin.masters', 'hotel.admin.settings',
  'hotel.admin.guestPortal', 'hotel.admin.companyPortal', 'hotel.web.rooms', 'hotel.web.calendar', 'hotel.web.content', 'hotel.web.services', 'hotel.web.policies', 'hotel.web.nearby',
  'hotel.web.settings',
  'corporate.notifications', 'corporate.bills', 'corporate.payments', 'corporate.ledger', 'corporate.support',
  'guest.bills', 'guest.order', 'guest.support', 'guest.bill', 'guest.profile',
  'platform.profile', 'platform.vault', 'group.profile', 'corporate.bill', 'corporate.profile', 'corporate.myProfile',
  'hotel.fo.checkIn', 'hotel.fo.reservationForm', 'hotel.fo.guestMessages', 'hotel.web.roomForm', 'hotel.payroll.joiningLetter', 'hotel.payroll.experienceLetter', 'hotel.payroll.master', 'hotel.admin.profile',
]);

const areaOf = (viewId: string): Area | null => {
  const head = viewId.split('.')[0];
  return head === 'platform' || head === 'group' || head === 'corporate' || head === 'guest' ? head : head === 'hotel' ? 'hotel' : null;
};

export function PageKpis({ viewId, user, params, navigate }: P & { viewId: string }) {
  const area = areaOf(viewId);
  if (!area || !KPI_VIEWS.has(viewId)) return null;
  const Area = areas[area];
  return (
    <Suspense fallback={null}>
      <Area viewId={viewId} user={user} params={params} navigate={navigate} />
    </Suspense>
  );
}

/** The guest portal's page frame draws this under its title. */
export const KpiSlot = createContext<ReactNode>(null);
export const useKpiSlot = () => useContext(KpiSlot);
