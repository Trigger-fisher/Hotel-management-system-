'use client';
// In house in Hotel Pallav's own markup (resources/views/pms/stays/index.blade.php): guests staying now, or those who have left, one shared
// DetailCard per stay (the Blade's table; the room is the lead, a stay past its leaving date carries the amber edge and a Due chip).
import { useState } from 'react';

import { splitAfterAdvance } from '@shared/dashboards/billing';
import { userMayEdit } from '@shared/dashboards/features';
import { formatCount, formatDate, formatDateTime, formatINR, formatTime } from '@shared/dashboards/format';
import { folioTotals, frontOfficeCopy as copy, todayIst, type Stay, type StayPage, type StayView } from '@shared/dashboards/frontOffice';

import type { ScreenProps } from '../../types';
import { errorText, useAsync, usePageSize } from '@/components/ui';
import { Button, DetailCard, DetailList, EmptyState, PageHead, Pager, pagerView, PageSkeleton } from '../../pallav/ui';
import { QuickPay } from '../billing/QuickPay';
import { CashSearch } from '../cash/cashKit';
import { foApi } from './api';
import { FoFilterBar, FoNav, GoLink } from './foKit';

import { tr } from '@/lib/i18n/language';
const c = copy.inHouse;
/** "05 Nov, 3:05 pm" on the card's facts; the open body writes the full formatDateTime. */
const when = (iso: string) => `${formatDate(iso).slice(0, 6)}, ${formatTime(iso)}`;

/** The row's pay pair. The hotel GST percent follows the stay's rate slab, so the defaults are read per stay (a short GET, cached). */
function RowPay({ stay, user, navigate, onPaid }: { stay: Stay; user: ScreenProps['user']; navigate: ScreenProps['navigate']; onPaid: () => void }) {
  const defaults = useAsync(() => foApi.getCheckoutDefaults(stay.id), [stay.id]);
  if (defaults.state.status === 'error') {
    return (
      <span className="small text-muted">
        {tr("Balance not worked out.")} <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); defaults.reload(); }}>{tr("Try again")}</button>
      </span>
    );
  }
  if (defaults.state.status !== 'ready') return null;
  const gst = defaults.state.data;
  const totals = folioTotals(stay, gst.hotelGstPercent, gst.foodGstPercent);
  const owed = splitAfterAdvance(totals.hotelPaise + totals.hotelGstPaise, totals.foodPaise + totals.foodGstPaise, totals.advancePaise);
  return <QuickPay target={{ kind: 'stay', stay, hotelPaise: owed.hotelPaise, foodPaise: owed.foodPaise }} user={user} navigate={navigate} onPaid={onPaid} layout="compact" />;
}

export function InHouseScreen({ navigate, user }: ScreenProps) {
  const [tab, setTab] = useState<StayView>('inHouse');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => foApi.listStays({ tab, search, page, pageSize }), [tab, search, page, pageSize], { keep: true });
  const data: StayPage | null = list.state.status === 'ready' ? list.state.data : null;
  const today = todayIst();
  const past = tab === 'past';
  const mayPay = (s: Stay) => userMayEdit('bills') || (s.reservationId !== null && userMayEdit('pms'));
  const quickPay = (s: Stay) => (mayPay(s) ? <RowPay stay={s} user={user} navigate={navigate} onPaid={list.reload} /> : undefined);

  return (
    <>
      <PageHead sub={past ? 'Guests who have checked out, newest first. Each links to its bill in Bills.' : 'Guests staying now. Open one for their account, to add charges, move room or check out.'}>
        <CashSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} onClear={() => { setSearch(''); setPage(1); }} placeholder={tr("Search name, mobile, room or register number")} />
        <FoNav active="inHouse" navigate={navigate} />
      </PageHead>
      <FoFilterBar tabs={[{ id: 'inHouse', label: 'In house' }, { id: 'past', label: 'Checked out' }]} active={tab} onTab={(id) => { setTab(id as StayView); setPage(1); }}
        summary={`${formatCount(data?.total ?? 0)} ${data?.total === 1 ? 'guest' : 'guests'}`} />

      {list.state.status === 'error' ? (
        <div className="card"><EmptyState icon="exclamation-triangle" title={tr("Could not load the guests")} text={errorText(list.state.error)}>
          <Button variant="outline" className="mt-3" onClick={list.reload}>{tr("Try again")}</Button>
        </EmptyState></div>
      ) : !data ? (
        <PageSkeleton tiles={false} />
      ) : data.items.length === 0 ? (
        <div className="card"><EmptyState icon="person-check" title={past ? 'Nobody has checked out yet' : 'Nobody is in the house'} text={c.emptyBody} /></div>
      ) : (
        (
          <>
            <div>
              {data.items.map((s) => {
                const due = !past && s.expectedCheckOut <= today;
                const leaves = past ? (s.checkOutAt ? when(s.checkOutAt) : null) : formatDate(s.expectedCheckOut).slice(0, 6);
                const nights = `${s.nights} ${s.nights === 1 ? tr("night") : tr("nights")}`;
                const soFar = formatINR(s.totalSoFarPaise, { decimals: false });
                return (
                  <DetailCard className="hu-dc"
                    key={s.id}
                    label={`${tr("Room")} ${s.roomNumber} ${s.guestName}`}
                    warn={due}
                    lead={{ big: s.roomNumber, tag: s.roomTypeName, title: s.roomTypeName ?? undefined }}
                    facts={[
                      { label: tr("Guest"), value: s.guestName, sub: `${s.mobile}${s.grNumber ? ` · ${tr("Register")} ${s.grNumber}` : ''}` },
                      { label: tr("Arrived"), value: when(s.checkInAt) },
                      { label: past ? tr("Left") : tr("Leaves"), value: leaves, tone: due ? 'danger' : undefined, sub: due ? <span className="fo-status no_show">{tr("Due")}</span> : undefined },
                      { label: tr("Nights"), value: nights },
                    ]}
                    amount={{ label: tr("So far"), value: soFar, extra: past ? undefined : quickPay(s) }}
                    sections={[
                      {
                        icon: 'person', title: tr("Guest"),
                        content: <DetailList items={[{ label: tr("Name"), value: s.guestName }, { label: tr("Mobile"), value: s.mobile || '-' }, { label: tr("Register number"), value: s.grNumber || '-' }]} />,
                      },
                      {
                        icon: 'door-closed', title: tr("Stay"),
                        content: (
                          <DetailList items={[
                            { label: tr("Room"), value: `${s.roomNumber} · ${s.roomTypeName}` },
                            { label: tr("Arrived"), value: formatDateTime(s.checkInAt) },
                            { label: past ? tr("Left") : tr("Leaves"), value: past ? (s.checkOutAt ? formatDateTime(s.checkOutAt) : '-') : <>{formatDate(s.expectedCheckOut)}{due ? <> <span className="fo-status no_show">{tr("Due")}</span></> : null}</> },
                            { label: tr("Nights"), value: nights },
                            { label: tr("So far"), value: soFar, total: true },
                          ]} />
                        ),
                      },
                    ]}
                    actions={<GoLink to="hotel.fo.stay" params={{ id: s.id }} navigate={navigate} className="btn btn-sm btn-outline-p">{past ? tr("Open") : tr("Account")}</GoLink>}
                  />
                );
              })}
            </div>
            <div className="card sh-pager-card"><Pager view={pagerView(data, { setPage })} /></div>
          </>
        )
      )}
    </>
  );
}
