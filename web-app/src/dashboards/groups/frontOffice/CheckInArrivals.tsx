'use client';
// Step 1 of the check-in, the top: today's bookings as tappable rows with a search by mobile, name or reference, and the way in for a guest with no booking.
import type { AsyncState } from '@/components/ui';
import { frontOfficeCopy as copy, plural, type Reservation } from '@shared/dashboards/frontOffice';
import { formatINR } from '@shared/dashboards/format';

import { Bi, Button, EmptyState, ListSearch, LoadError, Skeleton, StatusChip } from '../../pallav/ui';
import { filterArrivals } from './checkInDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.checkIn;

const initials = (name: string): string => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

export function CheckInArrivals({ state, onRetry, query, onQuery, picked, walkIn, onPick, onWalkIn, onBookings }: {
  state: AsyncState<Reservation[]>; onRetry: () => void; query: string; onQuery: (q: string) => void;
  picked: string; walkIn: boolean; onPick: (r: Reservation) => void; onWalkIn: () => void; onBookings: () => void;
}) {
  const all = state.status === 'ready' ? state.data : [];
  const rows = filterArrivals(all, query);
  if (walkIn) {
    return (
      <div className="card p-3 p-md-4">
        <div className="ci-head">
          <h6>{tr(c.steps[0])}</h6>
          <span className="ci-quiet">{state.status === 'ready' ? tr(c.arrivingToday(all.length)) : ''}</span>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="hu-gr me-auto"><Bi name="person-plus" /> <b>{tr(c.walkInGuest)}</b></span>
          {all.length > 0 && <Button variant="outline" icon="calendar-check" onClick={onBookings}>{tr("Today's bookings")}</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className="card p-3 p-md-4">
      <div className="ci-head">
        <h6>{tr(c.steps[0])}</h6>
        <span className="ci-quiet">{state.status === 'ready' ? tr(c.arrivingToday(all.length)) : ''}</span>
      </div>
      <ListSearch value={query} onChange={onQuery} onClear={() => onQuery('')} placeholder={tr("Mobile, name or reference")} wrapClass="ci-search" />
      {state.status === 'error' ? (
        <LoadError error={state.error} onRetry={onRetry} />
      ) : state.status !== 'ready' ? (
        <Skeleton rows={3} />
      ) : all.length === 0 ? (
        <EmptyState icon="calendar-check" text={c.noArrivals} />
      ) : rows.length === 0 ? (
        <EmptyState icon="search" text={c.noArrivalMatch} />
      ) : (
        <div className="ci-list">
          {rows.map((r) => (
            // check-shared-ignore: a tappable booking row (a card that is pressed), nothing in the kit draws it
            <button key={r.id} type="button" className="ci-arr" aria-pressed={picked === r.id} onClick={() => onPick(r)}>
              <span className="ci-av" aria-hidden="true">{initials(r.guestName)}</span>
              <span className="min-w-0">
                <span className="ci-n">{r.guestName}</span>
                <span className="ci-s">
                  {r.companyName ? `${r.companyName} · ` : ''}{r.reference} · {plural(r.nights, 'night')} · {r.rooms > 1 ? `${r.rooms} × ` : ''}{r.roomTypeName}
                  {r.mobile ? ` · ${r.mobile}` : ''}{r.advanceBalancePaise > 0 ? ` · ${tr("advance")} ${formatINR(r.advanceBalancePaise, { decimals: false })}` : ''}
                </span>
              </span>
              {r.companyName ? <StatusChip tone="neutral">{tr("Company bill")}</StatusChip> : <i className="bi bi-chevron-right text-muted" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3">
        <Button variant="outline" className="ci-walkin" icon="person-plus" aria-pressed={walkIn} onClick={onWalkIn}>{tr(c.walkInGuest)}</Button>
      </div>
    </div>
  );
}
