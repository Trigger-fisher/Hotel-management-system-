'use client';
// Reservations in Hotel Pallav's own markup (resources/views/pms/reservations/index.blade.php): the tabs, a Show filter and one shared
// DetailCard per reservation (the Blade's table; its two-line cells are the card's facts, the open body spells them out).
import { useState } from 'react';

import { formatDate, formatINR } from '@shared/dashboards/format';
import { reservationSourceLabel, reservationStatusLabel, reservationViews, type ReservationPage, type ReservationView } from '@shared/dashboards/frontOffice';

import type { ScreenProps } from '../../types';
import { errorText, useAsync, usePageSize } from '@/components/ui';
import { Button, DetailCard, DetailList, EmptyState, FilterBar, PageHead, Pager, pagerView, PageSkeleton, SearchField } from '../../pallav/ui';
import { foApi } from './api';
import { FoNav, GoLink, foStatusClass } from './foKit';

import { tr } from '@/lib/i18n/language';
/** Pallav's summary: number_format(total) + Str::plural (thousands grouped by 3). */
const count = (n: number, one: string) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${n === 1 ? one : `${one}s`}`;
/** Reservation::SOURCES label; the server may send the snake_case key (walk_in), the mock the camelCase one (walkIn). */
const sourceLabel = (s: string): string =>
  (reservationSourceLabel as Record<string, string>)[s] ?? (reservationSourceLabel as Record<string, string>)[s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] ?? s;

export function ReservationsScreen({ navigate }: ScreenProps) {
  const [tab, setTab] = useState<ReservationView>('upcoming');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => foApi.listReservations({ tab, search, page, pageSize }), [tab, search, page, pageSize], { keep: true });
  const data: ReservationPage | null = list.state.status === 'ready' ? list.state.data : null;
  const reset = search !== '' ? () => { setSearch(''); setPage(1); } : undefined;

  return (
    <>
      <PageHead className="reveal" sub="Rooms booked for coming dates. Open one to take an advance, change it, cancel it or check the guest in.">
        <SearchField wrapClass="pay-toolbar" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={tr("Search name, mobile, reference…")} label={tr("Search reservations")} />
        <FoNav active="reservations" navigate={navigate} />
      </PageHead>
      <FilterBar tabsLabel="Show" tabs={reservationViews.map((v) => ({ id: v.id, label: v.label }))} active={tab} onTab={(id) => { setTab(id as ReservationView); setPage(1); }}
        summary={count(data?.total ?? 0, 'reservation')} onReset={reset} />

      {list.state.status === 'error' ? (
        <div className="card reveal"><EmptyState icon="exclamation-triangle" title={tr("Could not load the reservations")} text={errorText(list.state.error)}>
          <Button variant="outline" className="mt-3" onClick={list.reload}>{tr("Try again")}</Button>
        </EmptyState></div>
      ) : !data ? (
        <PageSkeleton tiles={false} />
      ) : data.items.length === 0 ? (
        <div className="card reveal"><EmptyState icon="calendar-plus" title={tr("Nothing here")} text="Reservations made here, and website enquiries once confirmed, appear in this list." /></div>
      ) : (
        (
          <>
            <div className="reveal">
              {data.items.map((r) => {
                const who = `${r.adults} ${r.adults === 1 ? tr("adult") : tr("adults")}${r.children ? `, ${r.children} ${r.children === 1 ? 'child' : 'children'}` : ''}`;
                const nights = `${r.nights} ${r.nights === 1 ? tr("night") : tr("nights")}`;
                const rate = formatINR(r.ratePaise, { decimals: false });
                const advance = r.advancePaidPaise > 0 ? formatINR(r.advancePaidPaise, { decimals: false }) : null;
                return (
                  <DetailCard className="hu-dc"
                    key={r.id}
                    label={`${tr("Reservation")} ${r.reference}`}
                    leadWidth="lg"
                    lead={
                      <>
                        <span className="dc-lead-big">{formatDate(r.checkIn).slice(0, 6)}</span>
                        <span className={`fo-status ${foStatusClass(r.status)}`}>{reservationStatusLabel[r.status]}</span>
                      </>
                    }
                    facts={[
                      { label: tr("Reference"), value: r.reference, sub: sourceLabel(r.source) },
                      { label: tr("Guest"), value: r.guestName, sub: `${r.mobile}${r.companyName ? ` · ${r.companyName}` : ''}` },
                      { label: tr("Room"), value: `${r.rooms} × ${r.roomTypeName || '-'}`, sub: who },
                      { label: tr("Stay"), value: `${formatDate(r.checkIn).slice(0, 6)} → ${formatDate(r.checkOut)}`, sub: `${nights} @ ${rate}` },
                    ]}
                    amount={{ label: tr("Advance"), value: advance ?? '-', tone: advance ? undefined : 'muted' }}
                    sections={[
                      {
                        icon: 'person', title: tr("Guest"),
                        content: <DetailList items={[{ label: tr("Name"), value: r.guestName }, { label: tr("Mobile"), value: r.mobile || '-' }, { label: tr("Company"), value: r.companyName || tr("Walk-in") }]} />,
                      },
                      {
                        icon: 'calendar-plus', title: tr("Booking"),
                        content: (
                          <DetailList items={[
                            { label: tr("Reference"), value: r.reference },
                            { label: tr("Source"), value: sourceLabel(r.source) },
                            { label: tr("Status"), value: reservationStatusLabel[r.status] },
                            { label: tr("Rooms"), value: `${r.rooms} × ${r.roomTypeName || '-'}` },
                            { label: tr("Guests"), value: who },
                          ]} />
                        ),
                      },
                      {
                        icon: 'moon-stars', title: tr("Stay"),
                        content: (
                          <DetailList items={[
                            { label: tr("Check in"), value: formatDate(r.checkIn) },
                            { label: tr("Check out"), value: formatDate(r.checkOut) },
                            { label: tr("Nights"), value: nights },
                            { label: tr("Rate per night"), value: rate },
                            { label: tr("Advance paid"), value: advance ?? '-', total: true },
                          ]} />
                        ),
                      },
                    ]}
                    actions={
                      <>
                        {r.status === 'confirmed' && <GoLink to="hotel.fo.checkIn" params={{ reservationId: r.id }} navigate={navigate} className="btn btn-sm btn-p">{tr("Check in")}</GoLink>}
                        <GoLink to="hotel.fo.reservation" params={{ id: r.id }} navigate={navigate} className="btn btn-sm btn-outline-p">{tr("Open")}</GoLink>
                      </>
                    }
                  />
                );
              })}
            </div>
            <div className="card sh-pager-card"><Pager server view={pagerView(data, { setPage })} /></div>
          </>
        )
      )}
    </>
  );
}
