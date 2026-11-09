'use client';

// corporate.ledger, "Statement": the running account with the hotels (date, what, debit, credit, balance), information only. With several hotels the balance
// runs within each hotel, so every row names its hotel when "All hotels" is chosen. A line that comes from a bill opens that bill.
import { useState } from 'react';

import { formatDate, formatINR } from '@shared/dashboards/format';
import { balanceSide, type AccountsQuery, type LedgerKind } from '@shared/dashboards/corporate';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';

import { Bi, Button, DetailCard, DetailList } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { corporateApi } from './api';
import { AccountList } from './AccountList';
import { CpFigures } from './cpParts';
import { cpWords } from './words';

type Period = NonNullable<AccountsQuery['period']>;
const PERIODS: Period[] = ['month', 'last', 'year', 'all'];
const W = cpWords.ledger;

const balanceText = (paise: number): string => `${formatINR(Math.abs(paise))}${balanceSide(paise) ? ` ${balanceSide(paise)}` : ''}`;

export function CorporateLedgerAccountScreen({ navigate }: ScreenProps) {
  const c = useCopy(corporateCopyByLanguage);
  const T = c.accounts.ledger;
  const [period, setPeriod] = useState<Period>('all');
  const kindOf = (k: string) => (k in c.kinds ? c.kinds[k as LedgerKind].label : '');
  return (
    <AccountList
      sub={T.sub}
      searchPlaceholder={T.search}
      fetch={(q) => corporateApi.getLedgerAccount({ ...q, period })}
      deps={[period]}
      actions={
        <Button icon="printer" onClick={() => window.print()}>
          {W.print}
        </Button>
      }
      count={T.count}
      empty={{ icon: 'journal-text', title: T.emptyTitle, text: T.emptyText, filteredText: T.emptyFiltered }}
      tabs={{ label: T.periodLabel, items: PERIODS.map((p) => ({ id: p, label: T.periods[p] })), active: period, onTab: (id) => setPeriod(id as Period) }}
      note={
        <p className="cp-note">
          <Bi name="info-circle" /> {tr(W.legend)}
        </p>
      }
      summary={(d) => (
        <>
          <CpFigures
            figures={[
              { id: 'billed', label: W.billed, value: formatINR(d.totals.billedPaise), note: T.periods[period] },
              { id: 'received', label: W.received, value: formatINR(d.totals.receivedPaise), note: T.periods[period] },
              {
                id: 'balance',
                label: W.balance,
                value: balanceText(d.totals.balancePaise),
                note: d.totals.balancePaise > 0 ? W.owe : d.totals.balancePaise < 0 ? W.ahead : W.settled,
                tone: d.totals.balancePaise > 0 ? 'warn' : undefined,
              },
            ]}
          />
          {d.capped ? <p className="cp-note">{T.capped}</p> : null}
        </>
      )}
      row={(l, showHotel) => (
        <DetailCard
          label={`${W.line} ${formatDate(l.date)}`}
          lead={{ big: formatDate(l.date).slice(0, 6), tag: kindOf(l.detail.kind) || undefined, title: formatDate(l.date) }}
          facts={[
            { label: T.cols.what, value: l.what, sub: l.detail.guest ?? undefined },
            { label: T.cols.debit, value: l.debitPaise ? formatINR(l.debitPaise) : '', empty: '-' },
            { label: T.cols.credit, value: l.creditPaise ? formatINR(l.creditPaise) : '', empty: '-' },
            ...(showHotel ? [{ label: T.cols.hotel, value: l.hotelName }] : []),
          ]}
          amount={{ label: T.cols.balance, value: balanceText(l.balancePaise) }}
          sections={[
            {
              icon: 'journal-text',
              title: W.entry,
              content: (
                <DetailList
                  items={[
                    !showHotel && { label: T.detail.hotel, value: l.hotelName },
                    { label: T.detail.date, value: formatDate(l.date) },
                    { label: T.detail.ref, value: l.detail.ref || '-' },
                    l.detail.room ? { label: T.detail.room, value: l.detail.room } : false,
                    l.detail.mode ? { label: T.detail.mode, value: l.detail.mode } : false,
                    l.detail.note ? { label: T.detail.note, value: l.detail.note } : false,
                    { label: T.detail.balance, value: balanceText(l.balancePaise), total: true },
                  ]}
                />
              ),
            },
          ]}
          actions={
            l.detail.billId ? (
              <Button variant="outline" size="sm" icon="receipt" onClick={() => navigate('corporate.bill', { id: l.detail.billId ?? '' })}>
                {W.openBill}
              </Button>
            ) : undefined
          }
        />
      )}
    />
  );
}
