'use client';

// KPI rows of the Group console pages that had none (Group Hotel Admin).
import { useMemo, type ComponentType } from 'react';

import type { ScreenProps } from '../types';
import { groupApiFor } from '../groups/group/api';
import { KpiRow, card } from './Row';
import { tr } from '@/lib/i18n/language';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;
const one = { pageSize: 1 };

function Hotels({ user }: P) {
  const api = useMemo(() => groupApiFor(user), [user]);
  return (
    <KpiRow
      load={() => api.myHotels(one)}
      deps={[api]}
      cards={(d) => [
        card('Hotels', d.counts.all, tr('In your group')),
        card('Live', d.counts.active, tr('Taking guests now')),
        card('Waiting for review', d.counts.pending_approval, tr('Sent their form')),
        card('Suspended', d.counts.suspended, tr('Paused by the platform')),
      ]}
    />
  );
}

function Invitations({ user }: P) {
  const api = useMemo(() => groupApiFor(user), [user]);
  return (
    <KpiRow
      load={() => api.myInvitations(one)}
      deps={[api]}
      cards={(d) => [
        card('Waiting', d.counts.pending, tr('Sent, not finished')),
        card('Form sent back', d.counts.submitted, tr('Ready to review')),
        card('Expired', d.counts.expired, tr('Link ran out')),
        card('All invitations', d.counts.all, tr('Ever sent')),
      ]}
    />
  );
}

function Admins({ user }: P) {
  const api = useMemo(() => groupApiFor(user), [user]);
  return (
    <KpiRow
      load={() => api.myHotelAdmins({ ...one, liveOnly: true })}
      deps={[api]}
      cards={(d) => [
        card('Hotel admins', d.counts.all, tr('All accounts')),
        card('Active', d.counts.active, tr('Can sign in')),
        card('Locked', d.counts.locked, tr('Too many wrong passwords')),
        card('Switched off', d.counts.disabled, tr('Cannot sign in')),
      ]}
    />
  );
}

function Profile({ user, navigate }: P) {
  const api = useMemo(() => groupApiFor(user), [user]);
  return (
    <KpiRow
      load={() => api.groupOverview()}
      deps={[api]}
      cards={(d) => [
        card('Hotels', d.tiles.hotels, tr('In your group'), false, { onOpen: () => navigate('group.hotels') }),
        card('Live', d.tiles.hotelsActive, tr('Taking guests now'), false, { onOpen: () => navigate('group.hotels') }),
        card('Hotel admins', d.tiles.hotelAdmins, tr('All accounts'), false, { onOpen: () => navigate('group.admins') }),
        card('Invitations open', d.tiles.invitationsOpen, tr('Not used yet'), false, { onOpen: () => navigate('group.invitations') }),
      ]}
    />
  );
}

export const groupKpis: Record<string, ComponentType<P>> = {
  'group.hotels': Hotels,
  'group.invitations': Invitations,
  'group.hotels.invite': Invitations,
  'group.admins': Admins,
  'group.profile': Profile,
};
