'use client';

// KPI rows of the Platform console pages that had none (Super Admin and Platform Admin; the Super Admin only pages stay behind their own menu entries).
import type { ComponentType } from 'react';

import { formatDate } from '@shared/dashboards/format';
import type { ScreenProps } from '../types';
import { platformApi } from '../groups/platform/api';
import { personalVaultApi } from '../groups/platform/personalVaultApi';
import { demoRequestsApi } from '../groups/platform/demoRequestsApi';
import { createHttpCentralApi } from '@/lib/api/adapters/central';
import { createCentralMock } from '@shared/dashboards/central.mock';
import { chooseApi } from '@/lib/api/mode';
import type { CentralApi } from '@shared/dashboards/central';
import { KpiRow, card, wordCard } from './Row';
import { tr } from '@/lib/i18n/language';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;
const one = { pageSize: 1 };

function Hotels() {
  return (
    <KpiRow
      load={() => platformApi.listHotels(one)}
      cards={(d) => [
        card('Hotels live', d.counts.active, tr('Taking guests now')),
        card('Waiting for review', d.counts.pending_approval, tr('Sent their form')),
        card('Suspended', d.counts.suspended, tr('Paused by the platform')),
        card('In a group', d.kindCounts.group, tr('Member hotels')),
      ]}
    />
  );
}

function Groups() {
  return (
    <KpiRow
      load={async () => {
        const [o, h] = await Promise.all([platformApi.getOverview(), platformApi.listHotels(one)]);
        if (!o.ok) return o;
        if (!h.ok) return h;
        return { ok: true as const, data: { tiles: o.data.tiles, grouped: h.data.kindCounts.group } };
      }}
      cards={(d) => [
        card('Groups live', d.tiles.groups, tr('With an admin')),
        card('Waiting for review', d.tiles.pendingGroups ?? 0, tr('Sent their form')),
        card('Waiting for admin', d.tiles.groupsWaiting ?? 0, tr('Invitation not used yet')),
        card('Hotels in groups', d.grouped, tr('Member hotels')),
      ]}
    />
  );
}

function Admins() {
  return (
    <KpiRow
      load={() => platformApi.listHotelAdmins(one)}
      cards={(d) => [
        card('Hotel admins', d.counts.all, tr('All accounts')),
        card('Active', d.counts.active, tr('Can sign in')),
        card('Locked', d.counts.locked, tr('Too many wrong passwords')),
        card('Switched off', d.counts.disabled, tr('Cannot sign in')),
      ]}
    />
  );
}

function Invitations() {
  return (
    <KpiRow
      load={() => platformApi.listInvitations(one)}
      cards={(d) => [
        card('Waiting', d.counts.pending, tr('Sent, not finished')),
        card('Form sent back', d.counts.submitted, tr('Ready to review')),
        card('Expired', d.counts.expired, tr('Link ran out')),
        card('All invitations', d.counts.all, tr('Ever sent')),
      ]}
    />
  );
}

function Users() {
  return (
    <KpiRow
      load={() => platformApi.listUsers(one)}
      cards={(d) => [
        card('All users', d.counts.statuses.all, tr('Every login')),
        card('Active', d.counts.statuses.active, tr('Can sign in')),
        card('Locked', d.counts.statuses.locked, tr('Too many wrong passwords')),
        card('Switched off', d.counts.statuses.disabled, tr('Cannot sign in')),
      ]}
    />
  );
}

const sameDay = (iso: string, day: string) => iso.slice(0, 10) === day;

function Audit() {
  return (
    <KpiRow
      load={() => platformApi.listAudit({ pageSize: 500 })}
      cards={(d) => {
        const today = d.items[0]?.at.slice(0, 10) ?? '';
        return [
          card('Entries', d.total, tr('In the log')),
          card('On the latest day', d.items.filter((e) => sameDay(e.at, today)).length, today ? formatDate(today) : tr('Nothing yet')),
          card('Refused', d.items.filter((e) => e.result === 'failed').length, tr('Shown below')),
          card('People', d.actors.length, tr('Who did something')),
        ];
      }}
    />
  );
}

function SignIns() {
  return (
    <KpiRow
      load={() => platformApi.listSignIns(one)}
      cards={(d) => [
        card('Sign-ins', d.counts.all, tr('All tries')),
        card('Signed in', d.counts.success, tr('Correct password')),
        card('Wrong password', d.counts.failed, tr('Not let in')),
        card('Locked out', d.counts.locked, tr('Too many tries')),
      ]}
    />
  );
}

function Staff() {
  return (
    <KpiRow
      load={() => platformApi.listPlatformStaff(one)}
      cards={(d) => [
        card('Platform admins', d.counts.all, tr('All accounts')),
        card('Active', d.counts.active, tr('Can sign in')),
        card('Locked', d.counts.locked, tr('Too many wrong passwords')),
        card('Switched off', d.counts.disabled, tr('Cannot sign in')),
      ]}
    />
  );
}

function Health() {
  return (
    <KpiRow
      load={() => platformApi.getPlatformHealth()}
      cards={(d) => [
        card('Healthy hotels', d.tiles.healthy, tr('Nothing to fix')),
        card('Need a look', d.tiles.attention, tr('Something is wrong')),
        card('No backup', d.tiles.noBackup, tr('Never backed up')),
        card('Database updates waiting', d.tiles.pendingMigrations, tr('Not applied yet')),
      ]}
    />
  );
}

function Settings() {
  return (
    <KpiRow
      load={() => platformApi.getPlatformSettings()}
      cards={(d) => [
        card('Default GST', d.defaultGstPercent, tr('For a new hotel')),
        card('Invitation lasts', d.invitationValidHours, tr('Hours')),
        card('Mail files kept', d.mailFilesKeepHours, tr('Hours')),
        wordCard('Time zone', d.defaultTimeZone, tr('For a new hotel')),
      ]}
    />
  );
}

function Archived() {
  return (
    <KpiRow
      load={() => platformApi.listArchivedHotels({})}
      cards={(d) => {
        const rows = d;
        return [
          card('Archived hotels', rows.length, tr('Kept for the grace days')),
          card('Can be restored', rows.filter((h) => h.canRestore).length, tr('Still in the grace days')),
          card('Past the grace days', rows.filter((h) => !h.canRestore).length, tr('Can only be deleted')),
          card('Ready to delete', rows.filter((h) => h.canDelete).length, tr('Exported already')),
        ];
      }}
    />
  );
}

function Announcements() {
  return (
    <KpiRow
      load={() => platformApi.listAnnouncements()}
      cards={(d) => {
        const rows = d;
        return [
          card('Showing now', rows.filter((a) => a.state === 'live').length, tr('Live notices')),
          card('Coming up', rows.filter((a) => a.state === 'scheduled').length, tr('Start later')),
          card('Over', rows.filter((a) => a.state === 'over').length, tr('Ended')),
          card('Read by', rows.reduce((s, a) => s + a.reads, 0), tr('People who closed one')),
        ];
      }}
    />
  );
}

function Demo() {
  return (
    <KpiRow
      load={() => demoRequestsApi.list({ status: 'new', page: 1, pageSize: 1 })}
      cards={(d) => [
        card('New', d.counts.new, tr('Not answered')),
        card('Contacted', d.counts.contacted, tr('Being followed up')),
        card('Closed', d.counts.closed, tr('Done')),
        card('All requests', d.counts.new + d.counts.contacted + d.counts.closed, tr('From the website')),
      ]}
    />
  );
}

function Setup() {
  return (
    <KpiRow
      load={() => platformApi.listHotels(one)}
      cards={(d) => [
        card('Hotels', d.counts.all, tr('Not archived')),
        card('Live', d.counts.active, tr('Taking guests now')),
        card('Waiting for review', d.counts.pending_approval, tr('Sent their form')),
        card('Suspended', d.counts.suspended, tr('Paused by the platform')),
      ]}
    />
  );
}

const central: CentralApi = chooseApi(createHttpCentralApi, createCentralMock, { guard: false });

function Central() {
  return (
    <KpiRow
      load={async () => {
        const q = { page: 1, pageSize: 1 };
        const [a, b, c, d] = await Promise.all([central.logins(q), central.guests(q), central.companies(q), central.gst(q)]);
        if (!a.ok) return a;
        if (!b.ok) return b;
        if (!c.ok) return c;
        if (!d.ok) return d;
        return { ok: true as const, data: [a.data.total, b.data.total, c.data.total, d.data.total] };
      }}
      cards={(d) => [
        card('Logins', d[0], tr('All hotels together')),
        card('Guest profiles', d[1], tr('Kept once')),
        card('Company profiles', d[2], tr('Kept once')),
        card('GST records', d[3], tr('Looked up and saved')),
      ]}
    />
  );
}

function Profile({ navigate }: P) {
  return (
    <KpiRow
      load={() => platformApi.getOverview()}
      cards={(d) => [
        card('Hotels live', d.tiles.hotelsActive, tr('Taking guests now'), false, { onOpen: () => navigate('platform.hotels') }),
        card('Groups', d.tiles.groups, tr('With an admin'), false, { onOpen: () => navigate('platform.groups') }),
        card('Waiting for review', d.tiles.pendingApproval, tr('Hotels and groups'), false, { onOpen: () => navigate('platform.hotels') }),
        card('Locked', d.tiles.lockedAccounts, tr('Too many wrong passwords'), false, { onOpen: () => navigate('platform.admins') }),
      ]}
    />
  );
}

function Vault() {
  return (
    <KpiRow
      load={() => personalVaultApi.list()}
      cards={(d) => {
        const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        return [
          card('Items', d.length, tr('In your vault')),
          card('Passwords', d.filter((i) => i.kind === 'password').length, tr('Logins you keep')),
          card('Bank and cards', d.filter((i) => i.kind === 'bank' || i.kind === 'card').length, tr('Accounts you keep')),
          card('Expiring soon', d.filter((i) => i.expiresOn !== null && i.expiresOn <= soon).length, tr('Within 30 days')),
        ];
      }}
    />
  );
}

export const platformKpis: Record<string, ComponentType<P>> = {
  'platform.hotels': Hotels,
  'platform.groups': Groups,
  'platform.admins': Admins,
  'platform.invitations': Invitations,
  'platform.users': Users,
  'platform.audit': Audit,
  'platform.signins': SignIns,
  'platform.staff': Staff,
  'platform.health': Health,
  'platform.settings': Settings,
  'platform.archived': Archived,
  'platform.announcements': Announcements,
  'platform.demoRequests': Demo,
  'platform.setup': Setup,
  'platform.central': Central,
  'platform.duplicates': Central,
  'platform.profile': Profile,
  'platform.vault': Vault,
};
