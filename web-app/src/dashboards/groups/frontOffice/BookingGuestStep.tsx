'use client';
// Step 1 of the booking, the guest card: mobile first (a past guest is found by it and fills what is empty), name, email, the source as one segmented
// row, and the company only when the booking is billed to one.
import { frontOfficeCopy as copy, reservationSourceLabel, type FrontOfficeOptions, type GuestLookupMatch, type ReservationSource } from '@shared/dashboards/frontOffice';
import { formatDate } from '@shared/dashboards/format';
import type { FieldErrors } from '@/components/ui';

import { Button, Field, PmsSelect, SegTabs, StatusChip } from '../../pallav/ui';
import { SOURCES, showCompany, type BookingForm } from './bookingDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.reservationForm;

/** `failed`: the lookup did not answer (offline, a timeout, a refusal); never shown as a new guest. `filled`: what is found goes into the empty fields (not on a saved booking whose mobile the desk left as it was). */
export type Lookup = { status: 'idle' | 'busy' | 'done' | 'failed'; match: GuestLookupMatch | null; filled: boolean };

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

export function BookingGuestStep({ options, form, lookup, onRetryLookup, errors, set, isNew }: {
  options: FrontOfficeOptions; form: BookingForm; lookup: Lookup; onRetryLookup: () => void; errors: FieldErrors;
  set: <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => void; isNew: boolean;
}) {
  const m = lookup.match;
  const digits = form.mobile.replace(/\D/g, '').length;
  const sources = form.source === 'other' ? [...SOURCES, 'other' as ReservationSource] : SOURCES;
  return (
    <div className="card p-3 p-md-4">
      <div className="bk-head">
        <h6>{tr(c.whoIsBooking)}</h6>
        <div className="bk-chips" role="status" aria-live="polite">
          {lookup.status === 'busy' ? <span className="bk-quiet">{tr(c.checkingPast)}</span> : m ? (
            <>
              <StatusChip tone="ok">{tr(m.stays ? c.returning : c.bookedBefore)}</StatusChip>
              {m.stays > 0 && <span className="bk-quiet">{tr(c.nthStay(m.stays))}</span>}
            </>
          ) : lookup.status === 'done' ? <StatusChip tone="neutral">{tr(c.newGuest)}</StatusChip> : lookup.status === 'failed' ? (
            <>
              <span className="bk-quiet">{tr(c.lookupFailed)}</span>
              <Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={onRetryLookup}>{tr(c.retryLookup)}</Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="row g-3">
        <Field label={tr(c.mobile)} col="col-md-4" error={errors.mobile}>
          <input className="form-control" maxLength={20} inputMode="tel" autoComplete="off" autoFocus={isNew && !form.mobile} value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          {!m && lookup.status !== 'done' && <div className="form-text">{tr(c.mobileHint)}{digits > 0 && digits < 10 ? ` (${digits}/10)` : ''}</div>}
        </Field>
        <Field label={tr(c.guestName)} required col="col-md-8" error={errors.guestName}>
          <input className="form-control" maxLength={150} value={form.guestName} onChange={(e) => set('guestName', e.target.value)} />
        </Field>
        {m && lookup.filled && (
          <div className="col-12">
            <div className="bk-found" role="status">
              <span className="bk-av" aria-hidden="true">{initials(m.guestName)}</span>
              <div>
                <b>{m.guestName}</b>
                <span className="bk-quiet">
                  {[m.city, m.lastRoomNumber || m.lastCheckOut ? tr(copy.checkIn.lastStay(m.lastRoomNumber, m.lastCheckOut ? formatDate(m.lastCheckOut) : null)) : '', tr(c.filledFrom)].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          </div>
        )}
        <Field label={tr(c.email)} col="col-md-6" error={errors.email}>
          <input type="email" className="form-control" maxLength={150} value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={tr(c.source)} required col="col-md-6" error={errors.source}>
          <SegTabs className="bk-seg" label={tr(c.source)} active={form.source} onChange={(id) => set('source', id as ReservationSource)}
            tabs={sources.map((s) => ({ id: s, label: reservationSourceLabel[s] }))} />
        </Field>
        {showCompany(form, lookup.filled ? m : null) && (
          <Field label={<>{tr(c.company)} <span className="text-muted">({tr(c.companyHint).toLowerCase()})</span></>} col="col-md-6" error={errors.companyId}>
            <PmsSelect value={form.companyId} onChange={(e) => set('companyId', e.target.value)}>
              <option value="">{tr(c.none)}</option>
              {options.companies.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </PmsSelect>
          </Field>
        )}
      </div>
    </div>
  );
}
