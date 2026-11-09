'use client';

// KPI rows of the guest portal pages that had none. They sit in the page frame (GgPage), under the title.
import type { ComponentType } from 'react';

import { moneyOf } from '@shared/dashboards/guestStage';
import type { ScreenProps } from '../types';
import { guestApi, guestToday } from '../groups/guest/api';
import { useHotelChoice } from '../groups/guest/kit';
import { guestPayProblemsApi } from '../groups/portal/payProblemsApi';
import { KpiRow, card, wordCard } from './Row';
import { tr, trf } from '@/lib/i18n/language';

type P = Pick<ScreenProps, 'user' | 'params' | 'navigate'>;

function Bills() {
  const [hotel] = useHotelChoice();
  return (
    <KpiRow
      load={() => guestApi.listBills({ tab: 'open', limit: 50, hotel })}
      deps={[hotel]}
      cards={(d) => {
        const m = moneyOf(d.items, guestToday());
        return [
          card('To pay', m.duePaise, tr('All open bills'), true),
          card('Open bills', m.openCount, tr('Waiting for payment')),
          card('Overdue', m.overduePaise, tr('Past the pay-by date'), true),
          card('Paid so far', m.paidPaise, tr('On these bills'), true),
        ];
      }}
    />
  );
}

function Order() {
  const [hotel] = useHotelChoice();
  return (
    <KpiRow
      load={() => guestApi.getOverview({ hotel })}
      deps={[hotel]}
      cards={(d) => {
        const m = moneyOf(d.openBills, guestToday());
        return d.stay
          ? [
              wordCard('Your room', d.stay.roomNumber, d.stay.roomType),
              card('Night', d.stay.nightsDone + 1, trf('Of {0}', [d.stay.nights])),
              card('Open bills', m.openCount, tr('Waiting for payment')),
              card('To pay', m.duePaise, tr('Including food orders'), true),
            ]
          : [card('Open bills', m.openCount, tr('Waiting for payment')), card('To pay', m.duePaise, tr('All open bills'), true), card('Overdue', m.overduePaise, tr('Past the pay-by date'), true), card('Paid so far', m.paidPaise, tr('On these bills'), true)];
      }}
    />
  );
}

function Support() {
  const [hotel] = useHotelChoice();
  return (
    <KpiRow
      load={() => guestPayProblemsApi.listProblems({ status: 'all', hotel })}
      deps={[hotel]}
      cards={(d) => [
        card('Raised', d.total, tr('All questions')),
        card('Waiting', d.items.filter((p) => p.status === 'open').length, tr('The hotel has not answered')),
        card('Answered', d.items.filter((p) => p.status === 'answered').length, tr('Reply from the hotel')),
        card('Closed', d.items.filter((p) => p.status === 'closed' || p.status === 'withdrawn').length, tr('Done')),
      ]}
    />
  );
}

export const guestKpis: Record<string, ComponentType<P>> = {
  'guest.bills': Bills,
  'guest.bill': Bills,
  'guest.profile': Bills,
  'guest.order': Order,
  'guest.support': Support,
};
