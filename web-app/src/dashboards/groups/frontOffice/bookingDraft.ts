// The pure part of the two-step booking form (ReservationFormScreen): the form's shape and first values, the draft kept in this browser per booking,
// what a past-guest match fills, the 14-day strip, the plan rate and the summary's money. No React, no browser objects: tests/bookingDraft.test.ts.
import { addDays, daysBetween, gstSlabPercent, planRate, type GuestLookupMatch, type Reservation, type ReservationSource, type RoomType } from '@shared/dashboards/frontOffice';

import { DRAFT_MAX_AGE_MS, paiseToRate, rateToPaise, type StorageLike } from './checkInDraft';

export interface BookingForm {
  guestName: string; mobile: string; email: string; companyId: string; source: ReservationSource;
  checkIn: string; checkOut: string; adults: string; children: string; roomTypeId: string; rooms: string; plan: string; rate: string; notes: string;
  /** True once the desk typed a rate by hand: the plan no longer overwrites it. */
  rateEdited: boolean;
}
/** What the browser keeps: the form without the notes (free text about a guest stays in memory only). */
export type DraftForm = Omit<BookingForm, 'notes'>;
export interface BookingDraft { v: 1; savedAt: number; form: DraftForm }

export const DRAFT_PREFIX = 'hms-booking-draft:';
export const draftKey = (reservationId: string): string => `${DRAFT_PREFIX}${reservationId || 'new'}`;

/** The sources the desk picks from, in the order they are offered; "other" stays for bookings that already carry it. */
export const SOURCES: ReservationSource[] = ['phone', 'walkIn', 'website', 'company', 'agent'];
export const STEP1_FIELDS = new Set(['guestName', 'mobile', 'email', 'companyId', 'source']);
export const STRIP_DAYS = 14;

const DRAFT_KEYS: (keyof Omit<DraftForm, 'rateEdited'>)[] = ['guestName', 'mobile', 'email', 'companyId', 'source', 'checkIn', 'checkOut', 'adults', 'children', 'roomTypeId', 'rooms', 'plan', 'rate'];

/** The form as a booking gives it, else the desk's usual defaults (tonight, two adults, one room, by phone). */
export function initialForm(reservation: Reservation | null, today: string): BookingForm {
  const r = reservation;
  return {
    guestName: r?.guestName ?? '', mobile: r?.mobile ?? '', email: r?.email ?? '', companyId: r?.companyId ?? '', source: r?.source ?? 'phone',
    checkIn: r?.checkIn ?? today, checkOut: r?.checkOut ?? addDays(today, 1), adults: String(r?.adults ?? 2), children: String(r?.children ?? 0),
    roomTypeId: r?.roomTypeId ?? '', rooms: String(r?.rooms ?? 1), plan: r?.plan ?? '', rate: r && r.ratePaise ? paiseToRate(r.ratePaise) : '', notes: r?.notes ?? '',
    rateEdited: Boolean(r && r.ratePaise),
  };
}

export function toDraft(form: BookingForm, now: number = Date.now()): BookingDraft {
  const kept = Object.fromEntries(DRAFT_KEYS.map((k) => [k, form[k]])) as Omit<DraftForm, 'rateEdited'>;
  return { v: 1, savedAt: now, form: { ...kept, rateEdited: form.rateEdited } };
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** A saved draft read back over `base`; null for anything that is not one (another version, bad JSON, a hand-edited value). */
export function parseDraft(text: string | null, base: BookingForm): BookingDraft | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || typeof d.savedAt !== 'number' || !d.form || typeof d.form !== 'object') return null;
  const f = d.form as Record<string, unknown>;
  const form = { rateEdited: f.rateEdited === true } as DraftForm;
  for (const k of DRAFT_KEYS) (form as unknown as Record<string, string>)[k] = isStr(f[k]) ? f[k] : base[k];
  if (!SOURCES.includes(form.source) && form.source !== 'other') form.source = base.source;
  return { v: 1, savedAt: d.savedAt, form };
}

/** The draft laid over the booking's form: a typed value wins, an empty one leaves the booking's; the notes stay as the booking gives them. */
export function applyDraft(form: BookingForm, draft: BookingDraft): BookingForm {
  const out = { ...form, rateEdited: draft.form.rateEdited };
  for (const k of DRAFT_KEYS) if (draft.form[k].trim() !== '') (out as unknown as Record<string, string>)[k] = draft.form[k];
  return out;
}

export function readDraft(storage: StorageLike | null | undefined, key: string, base: BookingForm, now: number = Date.now()): BookingDraft | null {
  try {
    const d = parseDraft(storage?.getItem(key) ?? null, base);
    if (d && now - d.savedAt > DRAFT_MAX_AGE_MS) { storage?.removeItem(key); return null; }
    return d;
  } catch { return null; }
}
export function writeDraft(storage: StorageLike | null | undefined, key: string, draft: BookingDraft): void {
  try { storage?.setItem(key, JSON.stringify(draft)); } catch { /* a full or blocked store loses the draft, never the booking */ }
}
export function dropDraft(storage: StorageLike | null | undefined, key: string): void {
  try { storage?.removeItem(key); } catch { /* same */ }
}
/** Every booking draft in the store (sign-out): no guest's half-typed booking outlives the session on a shared desk machine. */
export function sweepBookingDrafts(storage: StorageLike | null | undefined): void {
  try {
    if (!storage?.key || storage.length === undefined) return;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
  } catch { /* same */ }
}

/** A past guest's details fill only what is still empty; the source is the desk's to pick. */
export function fillFromMatch(form: BookingForm, m: GuestLookupMatch): BookingForm {
  const pick = (cur: string, next: string) => (cur.trim() ? cur : next);
  return { ...form, guestName: pick(form.guestName, m.guestName), email: pick(form.email, m.email), companyId: pick(form.companyId, m.companyId ?? '') };
}

/** The company box shows when the booking is billed to one, a past stay was, or one is already chosen. */
export const showCompany = (form: BookingForm, match: GuestLookupMatch | null): boolean => form.source === 'company' || form.companyId !== '' || Boolean(match?.companyId);

/** The first day of the strip: today, unless the booking's check-in is outside the next two weeks (then the strip shows the booking's week). */
export function stripStart(today: string, checkIn: string): string {
  const d = daysBetween(today, checkIn);
  return d >= 0 && d < STRIP_DAYS ? today : checkIn;
}
export const stripDays = (start: string): string[] => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(start, i));

export type Phase = 'in' | 'out';
/** A tap on the strip: the first tap is the check-in, the next a later check-out; a tap on or before the check-in starts again. */
export function pickDay(form: Pick<BookingForm, 'checkIn' | 'checkOut'>, day: string, phase: Phase): { checkIn: string; checkOut: string; phase: Phase } {
  if (phase === 'out' && day > form.checkIn) return { checkIn: form.checkIn, checkOut: day, phase: 'in' };
  return { checkIn: day, checkOut: form.checkOut > day ? form.checkOut : addDays(day, 1), phase: 'out' };
}

export const nightsOf = (form: Pick<BookingForm, 'checkIn' | 'checkOut'>): number => Math.max(0, daysBetween(form.checkIn, form.checkOut) || 0);

/** The plan the chips price a category by: the form's plan when that category has it, else the category's first. */
export function planOf(type: RoomType | undefined, code: string) {
  return type?.plans.find((p) => p.code === code) ?? type?.plans[0] ?? null;
}

/** The category, plan or adults changed: the plan's price for these adults goes in unless the desk typed a rate. */
export function rateFromPlan(form: BookingForm, types: RoomType[]): BookingForm {
  const type = types.find((t) => t.id === form.roomTypeId);
  const plan = planOf(type, form.plan);
  const next = { ...form, plan: plan?.code ?? '' };
  if (form.rateEdited || !plan) return next;
  return { ...next, rate: paiseToRate(planRate(plan, Number.parseInt(form.adults, 10) || 2)) };
}

/** The summary's money: rooms x nights at the rate, GST by the slab of the rate. */
export function bookingEstimate(ratePaise: number | null, nights: number, rooms: number): { roomPaise: number; gstPercent: 5 | 18; gstPaise: number; totalPaise: number } {
  const roomPaise = (ratePaise ?? 0) * Math.max(1, nights) * Math.max(1, rooms);
  const gstPercent = gstSlabPercent(ratePaise);
  const gstPaise = Math.round((roomPaise * gstPercent) / 100);
  return { roomPaise, gstPercent, gstPaise, totalPaise: roomPaise + gstPaise };
}

export { rateToPaise, paiseToRate };
