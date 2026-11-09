'use client';

// KPI rows of the company portal pages that had none.
import type { ComponentType } from 'react';

import type { ScreenProps } from '../types';
import { corporateApi } from '../groups/corporate/api';
import { portalNotificationsApi } from '../groups/notifications/api';
import { corporatePayProblemsApi } from '../groups/portal/payProblemsApi';
import { formatDate } from '@shared/dashboards/format';
import { KpiRow, card, wordCard } from './Row';
import { tr } from '@/lib/i18n/language';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;

function Notices() {
  return (
    <KpiRow
      load={() => portalNotificationsApi.list({ page: 1, pageSize: 1 })}
      cards={(d) => [
        card('Notices', d.total, tr('From your hotels')),
        card('Unread', d.unread, tr('Not opened yet')),
        card('Read', Math.max(0, d.total - d.unread), tr('Opened')),
        wordCard('Latest', d.items[0] ? formatDate(d.items[0].createdAt.slice(0, 10)) : '-', tr('Newest notice')),
      ]}
    />
  );
}

function Bills() {
  return (
    <KpiRow
      load={() => corporateApi.listDueBills({ page: 1, pageSize: 200 })}
      cards={(d) => [
        card('To pay', d.summary.totalDuePaise, tr('All open bills'), true),
        card('Open bills', d.summary.openBills, tr('Waiting for payment')),
        card('Overdue', d.items.filter((b) => b.status === 'overdue').length, tr('Past the due date')),
        card('Oldest bill', d.items.reduce((m, b) => Math.max(m, b.ageDays), 0), tr('Days old')),
      ]}
    />
  );
}

function Payments() {
  return (
    <KpiRow
      load={() => corporateApi.listPaymentHistory({ page: 1, pageSize: 200 })}
      cards={(d) => [
        card('Paid in all', d.summary.receivedPaise, tr('Payments and advances'), true),
        card('Payments', d.total, tr('Entries in the list')),
        card('Advances', d.items.filter((p) => p.kind === 'advance').length, tr('Paid ahead')),
        card('Hotels paid', d.summary.byHotel.length, tr('Hotels you paid')),
      ]}
    />
  );
}

function Statement() {
  return (
    <KpiRow
      load={() => corporateApi.getLedgerAccount({ page: 1, pageSize: 1, period: 'all' })}
      cards={(d) => [
        card('Billed', d.totals.billedPaise, tr('All stays'), true),
        card('Paid', d.totals.receivedPaise, tr('Payments and advances'), true),
        card('Refunded', d.totals.refundedPaise, tr('Given back'), true),
        card('Balance', Math.abs(d.totals.balancePaise), d.totals.balancePaise < 0 ? tr('In your favour') : tr('Still to pay'), true),
      ]}
    />
  );
}

function Support() {
  return (
    <KpiRow
      load={() => corporatePayProblemsApi.listProblems({ status: 'all' })}
      cards={(d) => [
        card('Raised', d.total, tr('All questions')),
        card('Waiting', d.items.filter((p) => p.status === 'open').length, tr('The hotel has not answered')),
        card('Answered', d.items.filter((p) => p.status === 'answered').length, tr('Reply from the hotel')),
        card('Closed', d.items.filter((p) => p.status === 'closed' || p.status === 'withdrawn').length, tr('Done')),
      ]}
    />
  );
}

function Home({ navigate }: P) {
  return (
    <KpiRow
      load={() => corporateApi.getDashboard()}
      cards={(d) => [
        card('To pay', d.cards.totalDuePaise, tr('All open bills'), true, { onOpen: () => navigate('corporate.bills') }),
        card('Paid in advance', d.cards.creditPaise, tr('Credit with the hotels'), true, { onOpen: () => navigate('corporate.ledger') }),
        card('Bills this month', d.cards.billsThisMonth, tr('Raised this month'), false, { onOpen: () => navigate('corporate.bills') }),
        card('Unread notices', d.unreadNotifications, tr('From your hotels'), false, { onOpen: () => navigate('corporate.notifications') }),
      ]}
    />
  );
}

export const corporateKpis: Record<string, ComponentType<P>> = {
  'corporate.notifications': Notices,
  'corporate.bills': Bills,
  'corporate.payments': Payments,
  'corporate.ledger': Statement,
  'corporate.support': Support,
  'corporate.bill': Bills,
  'corporate.profile': Home,
  'corporate.myProfile': Home,
};
