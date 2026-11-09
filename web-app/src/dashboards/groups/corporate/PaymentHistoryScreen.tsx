'use client';

// corporate.payments, "Payments": what the company has paid and the advances it gave, information only (paying is done from Bills, which the line above
// the list opens). One DetailCard per payment.
import { formatDate, formatINR } from '@shared/dashboards/format';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';

import { Bi, Button, DetailCard, DetailList } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { corporateApi } from './api';
import { AccountList } from './AccountList';
import { CpFigures } from './cpParts';
import { cpWords } from './words';

const W = cpWords.payments;

export function CorporatePaymentHistoryScreen({ navigate }: ScreenProps) {
  const c = useCopy(corporateCopyByLanguage);
  const T = c.accounts.payments;
  return (
    <AccountList
      sub={T.sub}
      searchPlaceholder={T.search}
      fetch={(q) => corporateApi.listPaymentHistory(q)}
      count={T.count}
      empty={{ icon: 'wallet2', title: T.emptyTitle, text: T.emptyText, filteredText: T.emptyFiltered }}
      actions={(d) =>
        d.items.length > 0 ? (
          <Button icon="printer" onClick={() => window.print()}>
            {tr(W.print)}
          </Button>
        ) : null
      }
      note={
        <p className="cp-note">
          <Bi name="info-circle" />
          <span>
            {tr(W.toPayLine)}{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                navigate('corporate.bills');
              }}
            >
              {tr(W.toPayLink)}
            </a>
          </span>
        </p>
      }
      summary={(d) => (
        <CpFigures
          figures={[
            { id: 'received', label: W.received, value: formatINR(d.summary.receivedPaise), note: d.summary.byHotel.length > 1 ? cpWords.list.hotelsNote(d.summary.byHotel.length) : W.receivedNote },
            { id: 'count', label: W.count, value: String(d.total), note: W.countNote },
          ]}
        />
      )}
      row={(p, showHotel) => {
        const x = p.detail;
        const kind = p.kind === 'advance' ? T.advance : T.payment;
        return (
          <DetailCard
            label={`${kind} ${formatDate(p.date)}`}
            lead={{ big: formatDate(p.date).slice(0, 6), tag: kind, title: formatDate(p.date) }}
            facts={[
              { label: T.cols.mode, value: p.mode ?? '', sub: p.reference ?? undefined, empty: '-' },
              { label: T.cols.for, value: x.billNumber ? `${T.bill} ${x.billNumber}` : W.noBill, sub: x.guestName ?? undefined, tone: x.billNumber ? undefined : 'muted' },
              ...(showHotel ? [{ label: T.cols.hotel, value: p.hotelName }] : []),
              { label: T.detail.receipt, value: x.receipt ?? '', empty: '-' },
            ]}
            amount={{ label: T.cols.amount, value: formatINR(p.amountPaise) }}
            sections={[
              {
                icon: 'wallet2',
                title: W.details,
                content: (
                  <DetailList
                    items={[
                      !showHotel && { label: T.detail.hotel, value: p.hotelName },
                      { label: T.detail.date, value: formatDate(p.date) },
                      { label: T.detail.kind, value: kind },
                      p.mode ? { label: T.detail.mode, value: p.mode } : false,
                      p.reference ? { label: T.detail.reference, value: p.reference } : false,
                      x.receipt ? { label: T.detail.receipt, value: x.receipt } : false,
                      x.billNumber ? { label: T.detail.bill, value: x.billNumber } : false,
                      x.guestName ? { label: T.detail.guest, value: x.guestName } : false,
                      x.note ? { label: T.detail.note, value: x.note } : false,
                      { label: T.cols.amount, value: formatINR(p.amountPaise), total: true },
                    ]}
                  />
                ),
              },
            ]}
          />
        );
      }}
    />
  );
}
