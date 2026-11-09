'use client';

// group.payments: online payments across the hotels of the signed-in group (read only). The month as one quiet row of figures, the hotels with
// problems waiting as a queue, then one card per hotel and one per newest payment. To refund or answer, the admin opens that hotel.
import { formatDate, formatDateTime, formatINR, formatTime } from '@shared/dashboards/format';
import { groupCopy } from '@shared/dashboards/groupCopy';
import { groupPaymentsCopy as c, type GroupPaymentRow, type GroupPaymentsHotel } from '@shared/dashboards/groupPayments';

import type { ScreenProps } from '../../types';
import { Alert, Bi, Button, DetailCard, DetailList, EmptyState, PageHead, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { groupPaymentsApi } from './paymentsApi';

const P = groupCopy.payments;
const money = (paise: number): string => formatINR(Math.round(paise));
const count = (n: number) => String(Math.round(n));
const methodLabel = (m: string | null): string => (m === null ? P.online : m === 'upi' ? 'UPI' : m === 'emi' ? 'EMI' : m.charAt(0).toUpperCase() + m.slice(1).replace('_', ' '));
const TONE: Record<string, ChipTone> = { captured: 'ok', authorized: 'warn', failed: 'danger', refunded: 'neutral', created: 'neutral' };

export function GroupPayments({ navigate }: ScreenProps) {
  const { data, error, reload } = useLoaded(() => groupPaymentsApi.overview(), []);
  const open = (hotelId: string) => navigate('group.hotel', { id: hotelId });

  return (
    <>
      <PageHead className="reveal" sub={c.sub} />
      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={5} />
      ) : (
        <div className="hd gc-pay">
          <StaleNote error={error} onRetry={reload} />
          {data.unavailable.length > 0 ? (
            <Alert tone="warning" icon="exclamation-triangle" role="status">
              {c.unavailable(data.unavailable.map((u) => u.hotelName))}
            </Alert>
          ) : null}

          <HomeStats
            stats={
              [
                { id: 'today', label: c.tiles.today, value: data.totals.todayPaise, format: money, note: P.figureNotes.today(data.hotels.length) },
                { id: 'month', label: c.tiles.month, value: data.totals.monthPaise, format: money, note: P.figureNotes.month(money(data.totals.refundedPaise)) },
                { id: 'failed', label: c.tiles.failed, value: data.totals.failed, format: count, note: P.figureNotes.failed },
                { id: 'problems', label: c.tiles.problems, value: data.totals.openProblems, format: count, note: P.figureNotes.problems },
              ] satisfies HomeStat[]
            }
          />

          {data.hotels.some((h) => h.openProblems > 0) ? (
            <>
              <div className="hd-sec">
                <h3>{P.problemsTitle}</h3>
              </div>
              <div className="hm-queue gc-stack">
                {data.hotels
                  .filter((h) => h.openProblems > 0)
                  .map((h) => (
                    <div key={h.hotelId} className="hm-q">
                      <i className="hm-dot tone-warn" aria-hidden="true" />
                      <div className="hm-q-text">
                        <b title={h.hotelName}>{P.problemsLine(h.hotelName, h.openProblems)}</b>
                        <small>{P.problemsNote}</small>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => open(h.hotelId)}>
                        {c.openHotel}
                      </Button>
                    </div>
                  ))}
              </div>
            </>
          ) : null}

          <div className="hd-sec">
            <h3>{c.hotelsTitle}</h3>
          </div>
          {data.hotels.length === 0 ? (
            <div className="card hm-empty">
              <EmptyState icon="buildings" title={c.noHotels.title} text={c.noHotels.text} />
            </div>
          ) : (
            <div>
              {data.hotels.map((h) => (
                <HotelCard key={h.hotelId} h={h} onOpen={() => open(h.hotelId)} />
              ))}
            </div>
          )}

          <div className="hd-sec">
            <h3>{c.recentTitle}</h3>
          </div>
          {data.recent.length === 0 ? (
            <div className="card hm-empty">
              <EmptyState icon="credit-card-2-front" title={c.noPayments.title} text={c.noPayments.text} />
            </div>
          ) : (
            <div>
              {data.recent.map((p) => (
                <PaymentCard key={`${p.hotelId}-${p.paymentId}`} p={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function HotelCard({ h, onOpen }: { h: GroupPaymentsHotel; onOpen: () => void }) {
  return (
    <DetailCard
      label={`${P.hotel} ${h.hotelName}`}
      className="gc-card"
      warn={h.openProblems > 0}
      lead={
        <span className="pf-kind" aria-hidden="true">
          <Bi name="building" />
        </span>
      }
      facts={[
        { label: P.hotel, value: h.hotelName, sub: P.paymentsCount(h.payments) },
        { label: P.today, value: money(h.todayPaise) },
        { label: P.failed, value: count(h.failed), tone: h.failed > 0 ? 'warn' : undefined },
        { label: P.problems, value: count(h.openProblems), tone: h.openProblems > 0 ? 'warn' : 'muted' },
      ]}
      amount={{ label: P.month, value: money(h.monthPaise), sub: h.refundedPaise > 0 ? P.refundedSub(money(h.refundedPaise)) : undefined }}
      sections={[
        {
          icon: 'calendar3',
          title: P.aboutMonth,
          wide: true,
          content: (
            <DetailList
              items={[
                { label: P.today, value: money(h.todayPaise) },
                { label: P.month, value: money(h.monthPaise) },
                { label: P.payments, value: count(h.payments) },
                { label: P.failed, value: count(h.failed) },
                { label: P.refunded, value: money(h.refundedPaise) },
                { label: P.problems, value: count(h.openProblems) },
              ]}
            />
          ),
        },
      ]}
      actions={
        <Button size="sm" icon="box-arrow-in-right" onClick={onOpen}>
          {c.openHotel}
        </Button>
      }
    />
  );
}

function PaymentCard({ p }: { p: GroupPaymentRow }) {
  const partly = p.status === 'captured' && p.amountRefundedPaise > 0;
  const word = partly ? P.partlyRefunded : (c.payStatus[p.status] ?? p.status);
  const what = p.description || P.onlinePayment;
  return (
    <DetailCard
      label={`${P.payment} ${what}`}
      leadWidth="lg"
      className="gc-card gc-pay-card"
      warn={p.status === 'failed'}
      lead={{ big: formatTime(p.at), tag: formatDate(p.at) }}
      facts={[
        { label: P.payment, value: what, sub: p.hotelName },
        { label: P.method, value: methodLabel(p.method), sub: P.business[p.business] },
        { label: P.status, value: <StatusChip tone={partly ? 'warn' : (TONE[p.status] ?? 'neutral')}>{word}</StatusChip>, title: word },
      ]}
      amount={{ label: P.amount, value: money(p.amountPaise), sub: p.amountRefundedPaise > 0 ? P.refundedSub(money(p.amountRefundedPaise)) : undefined, tone: p.status === 'failed' ? 'muted' : undefined }}
      sections={[
        {
          icon: 'credit-card-2-front',
          title: P.aboutPayment,
          wide: true,
          content: (
            <DetailList
              items={[
                { label: P.hotel, value: p.hotelName },
                { label: P.when, value: formatDateTime(p.at) },
                { label: P.method, value: `${methodLabel(p.method)} · ${P.business[p.business]}` },
                { label: P.amount, value: money(p.amountPaise) },
                p.amountRefundedPaise > 0 ? { label: P.refunded, value: money(p.amountRefundedPaise) } : null,
              ]}
            />
          ),
        },
      ]}
    />
  );
}
