'use client';

// KPI rows of the hotel pages that had none (Hotel Admin and Hotel User). No page here shows payroll or a restricted money figure.
import type { ComponentType } from 'react';

import { todayIst } from '@shared/dashboards/frontOffice';
import type { ScreenProps } from '../types';
import { foApi } from '../groups/frontOffice/api';
import { deskOrdersApi } from '../groups/roomService/api';
import { adminApi } from '../groups/admin/api';
import { api as companiesApi } from '../groups/companies/api';
import { payrollApi } from '../groups/payrollCore/api';
import { notificationsApi } from '../groups/notifications/api';
import { webApi } from '../groups/website/api';
import { KpiRow, card, wordCard } from './Row';
import { tr } from '@/lib/i18n/language';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;

function Reservations() {
  return (
    <KpiRow
      load={() => foApi.listReservations({ tab: 'all', search: '', page: 1, pageSize: 1 })}
      cards={(d) => [
        card('Arriving today', d.counts.today, tr('Check-ins to do')),
        card('Coming up', d.counts.upcoming, tr('Booked ahead')),
        card('In the house', d.counts.inHouse, tr('Staying now')),
        card('Cancelled', d.counts.cancelled, tr('Not coming')),
      ]}
    />
  );
}

function InHouse() {
  return (
    <KpiRow
      load={() => foApi.listStays({ tab: 'inHouse', search: '', page: 1, pageSize: 500 })}
      cards={(d) => {
        const today = todayIst();
        const out = d.items.map((s) => s.expectedCheckOut.slice(0, 10));
        return [
          card('In the house', d.counts.inHouse, tr('Guests staying now')),
          card('Leaving today', out.filter((o) => o === today).length, tr('Check-outs to do')),
          card('Past leaving date', out.filter((o) => o < today).length, tr('Still in the room')),
          card('Checked out', d.counts.past, tr('Earlier stays')),
        ];
      }}
    />
  );
}

function Rooms() {
  return (
    <KpiRow
      load={() => foApi.listRooms({ tab: 'all', search: '', page: 1, pageSize: 1 })}
      cards={(d) => [
        card('Rooms', d.counts.all, tr('On the board')),
        card('Vacant', d.counts.vacant, tr('Ready to sell')),
        card('Needs cleaning', d.counts.dirty, tr('Marked dirty')),
        card('Out of order', d.counts.outOfOrder, tr('Not for sale')),
      ]}
    />
  );
}

function Requests() {
  return (
    <KpiRow
      load={() => foApi.listRequests({ tab: 'open', page: 1, pageSize: 100 })}
      cards={(d) => [
        card('Waiting', d.counts.open, tr('Guests asked, not done')),
        card('Asked today', d.page.items.filter((r) => r.at.slice(0, 10) === todayIst()).length, tr('Since midnight')),
        card('Older', d.page.items.filter((r) => r.at.slice(0, 10) < todayIst()).length, tr('Asked on an earlier day')),
        card('Rooms asking', new Set(d.page.items.map((r) => r.roomNumber)).size, tr('Different rooms')),
      ]}
    />
  );
}

function Orders() {
  return (
    <KpiRow
      load={async () => {
        const r = await deskOrdersApi.list({ status: 'open', page: 1, pageSize: 200 });
        return r;
      }}
      cards={(d) => [
        card('Open orders', d.openCount, tr('Not delivered yet')),
        card('Just placed', d.items.filter((o) => o.status === 'placed').length, tr('Nobody has started')),
        card('Being made', d.items.filter((o) => o.status === 'accepted' || o.status === 'preparing').length, tr('In the kitchen')),
        card('On the way', d.items.filter((o) => o.status === 'on_the_way').length, tr('To the room')),
      ]}
    />
  );
}

function Notices() {
  return (
    <KpiRow
      load={async () => {
        const q = { search: '', page: 1, pageSize: 1 };
        const rs = await Promise.all([notificationsApi.list(q), notificationsApi.list({ ...q, status: 'active' }), notificationsApi.list({ ...q, status: 'withdrawn' }), notificationsApi.list({ ...q, status: 'expired' })]);
        for (const r of rs) if (!r.ok) return r;
        return { ok: true as const, data: rs.map((r) => (r.ok ? r.data.total : 0)) };
      }}
      cards={(d) => [
        card('Sent', d[0], tr('All notices')),
        card('Showing now', d[1], tr('Companies can see')),
        card('Withdrawn', d[2], tr('Taken back')),
        card('Ended', d[3], tr('Time ran out')),
      ]}
    />
  );
}

function Lists() {
  return (
    <KpiRow
      load={() => adminApi.listMasterRail()}
      cards={(d) => {
        const counted = d.filter((e) => e.count !== null);
        return [
          card('Lists', d.length, tr('You can edit')),
          card('Items', counted.reduce((s, e) => s + (e.count ?? 0), 0), tr('In all lists')),
          card('Lists with items', counted.filter((e) => (e.count ?? 0) > 0).length, tr('In use')),
          card('Empty lists', counted.filter((e) => e.count === 0).length, tr('Nothing added yet')),
        ];
      }}
    />
  );
}

function Setup() {
  return (
    <KpiRow
      load={async () => {
        const [rooms, users, bin] = await Promise.all([foApi.listRooms({ tab: 'all', search: '', page: 1, pageSize: 1 }), adminApi.listUsers({ pageSize: 1 }), adminApi.listRecycle({ page: 1, pageSize: 1 })]);
        if (!rooms.ok) return rooms;
        if (!users.ok) return users;
        if (!bin.ok) return bin;
        return { ok: true as const, data: { rooms: rooms.data.counts.all, vacant: rooms.data.counts.vacant, users: users.data.stats.all, bin: bin.data.total } };
      }}
      cards={(d) => [card('Rooms', d.rooms, tr('On the board')), card('Vacant', d.vacant, tr('Ready to sell')), card('Users', d.users, tr('With a login')), card('In the recycle bin', d.bin, tr('Can be brought back'))]}
    />
  );
}

function GuestPortal() {
  return (
    <KpiRow
      load={() => foApi.listReservations({ tab: 'all', search: '', page: 1, pageSize: 1 })}
      cards={(d) => [
        card('In the house', d.counts.inHouse, tr('Can use the portal now')),
        card('Arriving today', d.counts.today, tr('Will get their link')),
        card('Coming up', d.counts.upcoming, tr('Booked ahead')),
        card('Checked out', d.counts.past, tr('Earlier stays')),
      ]}
    />
  );
}

function CompanyPortal() {
  return (
    <KpiRow
      load={() => companiesApi.ledgerOverview({ tab: 'all', page: 1, pageSize: 1 })}
      cards={(d) => [
        card('Companies', d.counts.all, tr('With a profile')),
        card('Owing', d.counts.owing, tr('Have open bills')),
        card('In credit', d.counts.credit, tr('Paid in advance')),
        card('Settled', d.counts.settled, tr('Nothing open')),
      ]}
    />
  );
}

const filled = (o: object) => Object.values(o).filter((v) => typeof v === 'string' && v.trim() !== '').length;

function WebRooms() {
  return (
    <KpiRow
      load={() => webApi.listRooms()}
      cards={(d) => {
        const rows = d;
        return [
          card('Room types', rows.length, tr('On the website')),
          card('Rooms in all', rows.reduce((s, r) => s + r.totalCount, 0), tr('Physical rooms')),
          card('Taking enquiries', rows.filter((r) => r.available).length, tr('Shown as available')),
          card('Showing a price', rows.filter((r) => r.showPrice).length, tr('Price on the website')),
        ];
      }}
    />
  );
}

function WebCounts() {
  return (
    <KpiRow
      load={async () => {
        const rs = await Promise.all([webApi.listRooms(), webApi.listServices(), webApi.listPolicies(), webApi.listNearby()]);
        for (const r of rs) if (!r.ok) return r;
        return { ok: true as const, data: rs.map((r) => (r.ok && Array.isArray(r.data) ? r.data.length : 0)) };
      }}
      cards={(d) => [
        card('Room types', d[0], tr('On the website')),
        card('Services', d[1], tr('Listed')),
        card('House rules', d[2], tr('Listed')),
        card('Nearby places', d[3], tr('Listed')),
      ]}
    />
  );
}

function WebContent() {
  return (
    <KpiRow
      load={() => webApi.getContent()}
      cards={(d) => {
        const all = Object.values(d).filter((v) => typeof v === 'string').length;
        const done = filled(d);
        return [card('Texts written', done, tr('On the website')), card('Texts empty', all - done, tr('Using the standard words')), card('Texts in all', all, tr('You can change')), wordCard('Complete', `%`, tr('Of the texts'))];
      }}
    />
  );
}

function WebSettings() {
  return (
    <KpiRow
      load={() => webApi.getSettings()}
      cards={(d) => [
        wordCard('Check-in', d.checkinTime || '-', tr('Shown to guests')),
        wordCard('Check-out', d.checkoutTime || '-', tr('Shown to guests')),
        card('Contact details set', [d.gmPhone, d.receptionPhone, d.email, d.address].filter((v) => v.trim() !== '').length, tr('Of 4')),
        card('Links set', [d.gbpLink, d.facebookLink, d.instagramLink].filter((v) => v.trim() !== '').length, tr('Google, Facebook, Instagram')),
      ]}
    />
  );
}

function CheckIn({ navigate }: P) {
  return (
    <KpiRow
      load={() => foApi.getBoard()}
      cards={(d) => [
        card('Arriving today', d.arrivals.length, tr('Check-ins to do'), false, { onOpen: () => navigate('hotel.fo.reservations') }),
        card('In the house', d.inHouse, tr('Staying now'), false, { onOpen: () => navigate('hotel.fo.inHouse') }),
        card('Rooms free', Math.max(0, d.stats.rooms - d.stats.outOfOrder - d.stats.occupied), tr('Ready to sell'), false, { onOpen: () => navigate('hotel.fo.rooms') }),
        card('Leaving today', d.departures.length, tr('Check-outs to do'), false, { onOpen: () => navigate('hotel.fo.inHouse') }),
      ]}
    />
  );
}

function PayCompanies() {
  return (
    <KpiRow
      load={() => payrollApi.listCompanies()}
      cards={(d) => [
        card('Companies', d.length, tr('On payroll')),
        card('Active', d.filter((r) => r.isActive).length, tr('Open for work')),
        card('Staff on payroll', d.reduce((n, r) => n + r.activeStaffCount, 0), tr('Active, all companies')),
        card('Without staff', d.filter((r) => r.activeStaffCount === 0).length, tr('Nobody added yet')),
      ]}
    />
  );
}

function Today({ navigate }: P) {
  return (
    <KpiRow
      load={() => foApi.getBoard()}
      cards={(d) => [
        card('In the house', d.inHouse, tr('Staying now'), false, { onOpen: () => navigate('hotel.fo.inHouse') }),
        card('Arriving today', d.arrivals.length, tr('Check-ins to do'), false, { onOpen: () => navigate('hotel.fo.reservations') }),
        card('Leaving today', d.departures.length, tr('Check-outs to do'), false, { onOpen: () => navigate('hotel.fo.inHouse') }),
        card('Rooms free', Math.max(0, d.stats.rooms - d.stats.outOfOrder - d.stats.occupied), tr('Ready to sell'), false, { onOpen: () => navigate('hotel.fo.rooms') }),
      ]}
    />
  );
}

export const hotelKpis: Record<string, ComponentType<P>> = {
  'hotel.fo.reservations': Reservations,
  'hotel.fo.inHouse': InHouse,
  'hotel.fo.rooms': Rooms,
  'hotel.fo.requests': Requests,
  'hotel.fo.roomOrders': Orders,
  'hotel.co.notifications': Notices,
  'hotel.admin.masters': Lists,
  'hotel.admin.settings': Setup,
  'hotel.admin.guestPortal': GuestPortal,
  'hotel.admin.companyPortal': CompanyPortal,
  'hotel.web.rooms': WebRooms,
  'hotel.web.calendar': WebRooms,
  'hotel.web.content': WebContent,
  'hotel.web.services': WebCounts,
  'hotel.web.policies': WebCounts,
  'hotel.web.nearby': WebCounts,
  'hotel.web.settings': WebSettings,
  'hotel.fo.checkIn': CheckIn,
  'hotel.fo.reservationForm': Reservations,
  'hotel.fo.guestMessages': Requests,
  'hotel.web.roomForm': WebRooms,
  'hotel.payroll.joiningLetter': PayCompanies,
  'hotel.payroll.experienceLetter': PayCompanies,
  'hotel.payroll.master': PayCompanies,
  'hotel.admin.profile': Today,
};
