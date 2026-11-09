// The pure part of the two-step check-in (CheckInScreen): the form's shape and its first values, the draft kept in the browser between visits
// (never an ID number), the arrivals search, what a past-guest match fills, and the money of the summary. No React, no browser objects: tests/checkInDraft.test.ts.
import {
  addDays, EMPTY_REGISTER_FIELDS, gstSlabPercent,
  type CheckInPrefill, type GuestLookupMatch, type GuestRegisterFields, type Reservation, type StayMemberInput,
} from '@shared/dashboards/frontOffice';
import { formatDate } from '@shared/dashboards/format';

export interface CheckInForm {
  roomId: string; expectedCheckOut: string; grNumber: string; adults: string; children: string; plan: string; rate: string;
  guestName: string; mobile: string; email: string; address: string; city: string; nationality: string; idProofType: string; idProofNumber: string;
  companyId: string; guestGstin: string; notes: string;
}

/** Another person in the room: with an ID, or by name only (no ID carried). */
export interface MemberRow { key: string; fullName: string; mobile: string; idType: string; idNumber: string; nameOnly: boolean }

/** What the browser keeps: never an ID number, the room (the board's choice or a free one wins) or the G.R. number (HMS suggests a fresh one on return). */
export type DraftForm = Omit<CheckInForm, 'idProofNumber' | 'roomId' | 'grNumber'>;
export interface CheckInDraft { v: 1; savedAt: number; form: DraftForm; register: GuestRegisterFields; members: Omit<MemberRow, 'idNumber'>[] }

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; readonly length?: number; key?(index: number): string | null }

export const DRAFT_PREFIX = 'hms-checkin-draft:';
export const draftKey = (reservationId: string): string => `${DRAFT_PREFIX}${reservationId || 'walk-in'}`;
/** A draft older than a shift is not trusted: the guest has long arrived or gone. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const FORM_KEYS: (keyof CheckInForm)[] = ['roomId', 'expectedCheckOut', 'grNumber', 'adults', 'children', 'plan', 'rate', 'guestName', 'mobile', 'email', 'address', 'city', 'nationality', 'idProofType', 'idProofNumber', 'companyId', 'guestGstin', 'notes'];
const NOT_IN_DRAFT = new Set<keyof CheckInForm>(['idProofNumber', 'roomId', 'grNumber']);
const DRAFT_KEYS = FORM_KEYS.filter((k) => !NOT_IN_DRAFT.has(k)) as (keyof DraftForm)[];

/** The form as the prefill gives it: the booking's values, else the desk's usual defaults. */
export function initialForm(prefill: CheckInPrefill, today: string, roomIdParam?: string): CheckInForm {
  const res = prefill.reservation;
  return {
    roomId: roomIdParam && prefill.rooms.some((r) => r.id === roomIdParam) ? roomIdParam : '',
    expectedCheckOut: res && res.checkOut > today ? res.checkOut : addDays(today, 1),
    grNumber: prefill.suggestedGrNumber ?? '',
    adults: String(res?.adults ?? 2),
    children: String(res?.children ?? 0),
    plan: res?.plan ?? '',
    rate: res && res.ratePaise ? paiseToRate(res.ratePaise) : '',
    guestName: res?.guestName ?? '',
    mobile: res?.mobile ?? '',
    email: res?.email ?? '',
    address: '',
    city: '',
    nationality: 'Indian',
    idProofType: '',
    idProofNumber: '',
    companyId: res?.companyId ?? '',
    guestGstin: '',
    notes: res?.notes ?? '',
  };
}

/** What goes to the browser: everything but the ID numbers (they stay in memory only), the room, the G.R. number and the photos. */
export function toDraft(form: CheckInForm, register: GuestRegisterFields, members: MemberRow[], now: number = Date.now()): CheckInDraft {
  const kept = Object.fromEntries(DRAFT_KEYS.map((k) => [k, form[k]])) as DraftForm;
  return { v: 1, savedAt: now, form: kept, register: { ...register }, members: members.map(({ key, fullName, mobile, idType, nameOnly }) => ({ key, fullName, mobile, idType, nameOnly })) };
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** A saved draft read back; null for anything that is not one (another version, bad JSON, a hand-edited value). */
export function parseDraft(text: string | null): CheckInDraft | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || typeof d.savedAt !== 'number' || !d.form || typeof d.form !== 'object' || !d.register || typeof d.register !== 'object' || !Array.isArray(d.members)) return null;
  const form = d.form as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of DRAFT_KEYS) if (isStr(form[k])) out[k] = form[k];
  const reg = d.register as Record<string, unknown>;
  const register = { ...EMPTY_REGISTER_FIELDS };
  for (const k of Object.keys(register) as (keyof GuestRegisterFields)[]) if (isStr(reg[k])) register[k] = reg[k];
  const members: CheckInDraft['members'] = [];
  for (const m of d.members as unknown[]) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (!isStr(r.key) || !isStr(r.fullName)) continue;
    members.push({ key: r.key, fullName: r.fullName, mobile: isStr(r.mobile) ? r.mobile : '', idType: isStr(r.idType) ? r.idType : '', nameOnly: r.nameOnly === true });
  }
  return { v: 1, savedAt: d.savedAt, form: out as DraftForm, register, members };
}

/** The draft laid over the prefilled form: a typed value wins, an empty one leaves the prefill; the room, the G.R. number and the ID numbers stay as the prefill gives them. */
export function applyDraft(form: CheckInForm, draft: CheckInDraft): { form: CheckInForm; register: GuestRegisterFields; members: MemberRow[] } {
  const typed = Object.fromEntries(Object.entries(draft.form).filter(([, v]) => v.trim() !== ''));
  return {
    form: { ...form, ...typed, roomId: form.roomId, grNumber: form.grNumber, idProofNumber: form.idProofNumber },
    register: { ...draft.register },
    members: draft.members.map((m) => ({ ...m, idNumber: '' })),
  };
}

/** The draft under `key`, or null; one older than DRAFT_MAX_AGE_MS is dropped and not returned. */
export function readDraft(storage: StorageLike | null | undefined, key: string, now: number = Date.now()): CheckInDraft | null {
  try {
    const d = parseDraft(storage?.getItem(key) ?? null);
    if (d && now - d.savedAt > DRAFT_MAX_AGE_MS) { storage?.removeItem(key); return null; }
    return d;
  } catch { return null; }
}
export function writeDraft(storage: StorageLike | null | undefined, key: string, draft: CheckInDraft): void {
  try { storage?.setItem(key, JSON.stringify(draft)); } catch { /* a full or blocked store loses the draft, never the check-in */ }
}
export function dropDraft(storage: StorageLike | null | undefined, key: string): void {
  try { storage?.removeItem(key); } catch { /* same */ }
}
/** Every check-in draft in the store except the bookings named in `keep` (today's arrivals): a cancelled or no-show booking leaves no guest details behind. With no `keep`, every draft goes (sign-out). */
export function sweepDrafts(storage: StorageLike | null | undefined, keep: Iterable<string> = []): void {
  try {
    if (!storage?.key || storage.length === undefined) return;
    const kept = new Set([...keep].map((id) => draftKey(id)));
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX) && !kept.has(k)) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
  } catch { /* same */ }
}

/** The last 10 digits typed; the lookup runs once there are 10. */
export const mobileDigits = (s: string): string => s.replace(/\D/g, '').slice(-10);

/** Today's arrivals narrowed by what is typed: every word must match the name, the mobile's digits, the reference or the company. */
export function filterArrivals(list: Reservation[], query: string): Reservation[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((r) => {
    const hay = `${r.guestName} ${r.reference} ${r.companyName ?? ''}`.toLowerCase();
    const digits = r.mobile.replace(/\D/g, '');
    return words.every((w) => hay.includes(w) || (/^\d+$/.test(w) && digits.includes(w)));
  });
}

/** A past guest's details fill only what is still empty: the booking's own values and anything typed stay. */
export function fillFromLookup(form: CheckInForm, register: GuestRegisterFields, m: GuestLookupMatch): { form: CheckInForm; register: GuestRegisterFields } {
  const pick = (cur: string, next: string) => (cur.trim() ? cur : next);
  return {
    form: {
      ...form,
      guestName: pick(form.guestName, m.guestName), email: pick(form.email, m.email), address: pick(form.address, m.address), city: pick(form.city, m.city),
      nationality: form.nationality === 'Indian' && m.nationality ? m.nationality : pick(form.nationality, m.nationality),
      idProofType: pick(form.idProofType, m.idProofType), idProofNumber: pick(form.idProofNumber, m.idProofNumber), companyId: pick(form.companyId, m.companyId ?? ''),
    },
    register: { ...register, dateOfBirth: pick(register.dateOfBirth, m.dateOfBirth) },
  };
}

export const paiseToRate = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
export function rateToPaise(rate: string): number | null {
  const n = Number.parseFloat(rate);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** The summary's money: room nights at the slab's GST, less the booking's unused advance. */
export function stayEstimate(ratePaise: number | null, nights: number, advancePaise: number): { roomPaise: number; gstPercent: 5 | 18; gstPaise: number; totalPaise: number; balancePaise: number } {
  const rate = ratePaise ?? 0;
  const roomPaise = rate * Math.max(1, nights);
  const gstPercent = gstSlabPercent(ratePaise);
  const gstPaise = Math.round((roomPaise * gstPercent) / 100);
  const totalPaise = roomPaise + gstPaise;
  return { roomPaise, gstPercent, gstPaise, totalPaise, balancePaise: Math.max(0, totalPaise - advancePaise) };
}

/** "05 to 07 Nov 2026", or "30 Nov to 02 Dec 2026" across a month. */
export function dateSpan(from: string, to: string): string {
  const a = formatDate(from).split(' ');
  const b = formatDate(to).split(' ');
  if (a[1] === b[1] && a[2] === b[2]) return `${a[0]} to ${b[0]} ${b[1]} ${b[2]}`;
  if (a[2] === b[2]) return `${a[0]} ${a[1]} to ${b[0]} ${b[1]} ${b[2]}`;
  return `${formatDate(from)} to ${formatDate(to)}`;
}

let memberSeq = 0;
export const newMember = (nameOnly: boolean): MemberRow => ({ key: `m${Date.now().toString(36)}${(memberSeq += 1)}`, fullName: '', mobile: '', idType: '', idNumber: '', nameOnly });

/** The members as the server takes them: a name-only guest carries no ID; a row with no name is dropped. */
export function membersInput(members: MemberRow[]): StayMemberInput[] {
  return members.filter((m) => m.fullName.trim()).map((m) => ({ fullName: m.fullName.trim(), mobile: m.mobile.trim(), idType: m.nameOnly ? '' : m.idType, idNumber: m.nameOnly ? '' : m.idNumber.trim() }));
}

/** True when a row carries something (a mobile, an ID type or number, a photo) but no name: it would be dropped at save, with that person's ID lost. */
export const hasUnnamedMember = (members: MemberRow[], photoKeys: Iterable<string> = []): boolean => {
  const withPhoto = new Set(photoKeys);
  return members.some((m) => !m.fullName.trim() && (m.mobile.trim() || m.idType || m.idNumber.trim() || withPhoto.has(m.key)));
};

/** The names of the guests who carried no ID, for the register's note; '' when everyone had one. */
export const nameOnlyNames = (members: MemberRow[]): string => members.filter((m) => m.nameOnly && m.fullName.trim()).map((m) => m.fullName.trim()).join(', ');
