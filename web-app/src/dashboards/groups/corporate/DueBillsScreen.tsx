'use client';

// corporate.bills, "Bills": the open bills of the company, oldest trouble first. This is the paying page: Pay all due in the head (the sticky bar on a
// phone) pays every open bill in one go, and each bill opens to be reviewed and paid on its own. An overdue bill has an amber edge and a red pill.
// Without online paying (online.ts) the line above the list says how to pay and each bill's button opens it.
import { personsText } from '@shared/dashboards/guest';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';
import { useState } from 'react';

import { Bi, Button, DetailCard, DetailList, PortalButton } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { StickyActions } from '../portal/AppKit';
import { useLinkedHotels } from '../portal/HotelParts';
import { usePortalHotel } from '../portal/HotelSwitch';
import { corporateApi } from './api';
import { AccountList } from './AccountList';
import { BillPill, CpFigures } from './cpParts';
import { corporateCanPayOnline } from './online';
import { PayAllDialog } from './PayAll';
import { cpWords } from './words';

const W = cpWords.bills;
const nights = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;

export function CorporateDueBillsScreen({ navigate }: ScreenProps) {
  const c = useCopy(corporateCopyByLanguage);
  const T = c.accounts.dueBills;
  const [paid, setPaid] = useState(0);
  const [payAll, setPayAll] = useState<number | null>(null);
  // Pay all due pays the company's whole account, so it is offered only when the list shows the whole account.
  const scope = usePortalHotel();
  const hotels = useLinkedHotels('corporate');
  const whole = scope === PORTAL_ALL_HOTELS || hotels.length <= 1;
  return (
    <>
      <AccountList
        sub={T.sub}
        searchPlaceholder={T.search}
        fetch={(q) => corporateApi.listDueBills(q)}
        deps={[paid]}
        count={T.count}
        empty={{
          icon: 'receipt',
          title: T.emptyTitle,
          text: T.emptyText,
          filteredText: T.emptyFiltered,
        }}
        actions={(d) => {
          const due = d.summary.totalDuePaise;
          if (!whole || due <= 0 || !corporateCanPayOnline(d.summary)) return null;
          const label = W.payAll(formatINR(due));
          return (
            <>
              <Button icon="credit-card" className="app-hide-phone" onClick={() => setPayAll(due)}>
                {label}
              </Button>
              <StickyActions label={label}>
                <PortalButton icon="credit-card" onClick={() => setPayAll(due)}>
                  {label}
                </PortalButton>
              </StickyActions>
            </>
          );
        }}
        note={(d) => {
          const online = corporateCanPayOnline(d.summary);
          return (
            <p className="cp-note">
              <Bi name={online ? 'credit-card' : 'bank'} /> {tr(online ? W.payHint : W.offHint)}
            </p>
          );
        }}
        summary={(d) => (
          <CpFigures
            figures={[
              {
                id: 'due',
                label: W.owed,
                value: formatINR(d.summary.totalDuePaise),
                note: d.summary.totalDuePaise > 0 ? c.dues.toPay : c.dues.nothingDue,
                tone: d.summary.totalDuePaise > 0 ? 'warn' : undefined,
              },
              {
                id: 'open',
                label: W.open,
                value: String(d.summary.openBills),
                note: d.summary.byHotel.length > 1 ? cpWords.list.hotelsNote(d.summary.byHotel.length) : undefined,
              },
            ]}
          />
        )}
        row={(b, showHotel, d) => {
          const online = corporateCanPayOnline(d.summary);
          const x = b.detail;
          const overdue = b.status === 'overdue';
          return (
            <DetailCard
              label={c.calm.openBill(b.billNumber)}
              leadWidth="lg"
              className="cp-bill"
              warn={overdue}
              lead={
                <>
                  <span className="dc-lead-big">
                    {b.ageDays}
                    <small> {b.ageDays === 1 ? tr('day') : tr('days')}</small>
                  </span>
                  <BillPill status={b.status} />
                </>
              }
              facts={[
                {
                  label: T.cols.bill,
                  value: b.billNumber,
                  sub: W.billed(formatDate(b.billDate)),
                },
                {
                  label: T.cols.guest,
                  value: b.guestName,
                  sub: x.roomNumber ? c.common.room(x.roomNumber) : undefined,
                },
                ...(showHotel ? [{ label: T.cols.hotel, value: b.hotelName }] : []),
                {
                  label: T.detail.stay,
                  value: x.checkIn ? formatDate(x.checkIn) : '',
                  sub: x.nights ? nights(x.nights) : undefined,
                  empty: '-',
                },
              ]}
              amount={{
                label: T.cols.due,
                value: formatINR(b.duePaise),
                tone: overdue ? 'danger' : undefined,
                sub: (
                  <>
                    <span>
                      {c.businesses.hotel.short} <b>{formatINR(x.balanceHotelPaise)}</b>
                    </span>
                    <span>
                      {c.businesses.food.short} <b>{formatINR(x.balanceFoodPaise)}</b>
                    </span>
                  </>
                ),
              }}
              sections={[
                {
                  icon: 'person',
                  title: W.stay,
                  content: (
                    <DetailList
                      items={[
                        !showHotel && {
                          label: T.detail.hotel,
                          value: b.hotelName,
                        },
                        x.persons
                          ? {
                              label: 'Persons',
                              value: `${personsText(x.persons)}${x.persons.names.length > 0 ? ` (${x.persons.names.join(', ')})` : ''}`,
                            }
                          : false,
                        x.guestMobile ? { label: T.detail.mobile, value: x.guestMobile } : false,
                        x.roomNumber ? { label: T.detail.room, value: x.roomNumber } : false,
                        x.plan ? { label: T.detail.plan, value: x.plan } : false,
                        x.reference ? { label: T.detail.reference, value: x.reference } : false,
                        x.note ? { label: T.detail.note, value: x.note } : false,
                      ]}
                    />
                  ),
                },
                {
                  icon: 'receipt',
                  title: W.amounts,
                  content: (
                    <DetailList
                      items={[
                        {
                          label: T.detail.hotelAmount,
                          value: formatINR(x.hotelAmountPaise),
                        },
                        {
                          label: T.detail.foodAmount,
                          value: formatINR(x.foodAmountPaise),
                        },
                        x.advancePaise
                          ? {
                              label: T.detail.advance,
                              value: `− ${formatINR(x.advancePaise)}`,
                            }
                          : false,
                        {
                          label: T.detail.balanceHotel,
                          value: formatINR(x.balanceHotelPaise),
                        },
                        {
                          label: T.detail.balanceFood,
                          value: formatINR(x.balanceFoodPaise),
                        },
                        {
                          label: T.cols.due,
                          value: formatINR(b.duePaise),
                          total: true,
                        },
                      ]}
                    />
                  ),
                },
              ]}
              actions={
                <Button size="sm" icon={online ? 'credit-card' : 'receipt'} onClick={() => navigate('corporate.bill', { id: b.id })}>
                  {online ? W.review : W.openBill}
                </Button>
              }
            />
          );
        }}
      />
      <PayAllDialog amountPaise={payAll} onClose={() => setPayAll(null)} onPaid={() => setPaid((n) => n + 1)} />
    </>
  );
}
