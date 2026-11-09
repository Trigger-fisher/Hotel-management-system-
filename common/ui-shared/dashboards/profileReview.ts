// The Super Admin's "Possible duplicates" (platform migration 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md). Every guest and company has ONE common profile; the
// backfill and the hotels never merge two of them on their own. This page lists live profiles that share a value (guests: the same mobile or email; companies: the same GSTIN
// or email) and lets the Super Admin decide: MERGE (one profile is kept; the hotels' records of the others point at it; the others stay as history) or KEEP APART (the pair
// stops showing). Super Admin only (a Platform Admin and everyone else: 403). Nothing here touches a hotel's bills, stays or records; every decision is in the audit log.
//
// GET  /api/v1/platform/profiles/duplicates?kind=guest|company&search=&page=&pageSize=10|25|50  -> DuplicatePage
// POST /api/v1/platform/profiles/merge            MergeInput      -> MergeResult      (422 fields kind, keepId, mergeIds, reason; 404 a profile not live; 409 two logins)
// POST /api/v1/platform/profiles/keep-apart       KeepApartInput  -> { kept: boolean } (true = newly kept apart)
// POST /api/v1/platform/profiles/keep-apart/undo  KeepApartInput  -> { undone: boolean }
import type { DashResult } from './common';
import { formatDateTime } from './format';

export type ProfileKind = 'guest' | 'company';

/**
 * The last change of a guest's or company's ONE common profile (security review round 2, M1(a)): which hotel, who and when. Sent as `lastChange` on the desk's Customer and
 * CompanyProfile (companies.ts) and on My profile (guest.ts GuestProfile, corporate.ts PortalProfile). null = not changed since it was made (or made before the history
 * began); absent = an older server. Shown as one line under the shared fields: `lastChangeLine(c)`.
 */
export interface ProfileLastChange {
  /** ISO time. */
  at: string;
  /** The hotel where the change was saved (the desk's hotel, or the hotel the guest or company was signed in to); null = that hotel is gone. */
  hotelName: string | null;
  /** The person's name as it was then: a staff member (via "desk"), or the guest or company themselves (via "portal"). null = not known. */
  by: string | null;
  via: 'desk' | 'portal';
  /** The shared fields that changed, as keys: name, email, mobile, landline, address, city, pincode, country, gstin, mainContact, contacts. Empty = the profile was made. */
  fields: string[];
  /** A GSTIN change (M1(c)): old -> new, MASKED to the last four ("XXXX Q1ZW"; null = none). Absent when the GSTIN did not change. */
  gstin?: { from: string | null; to: string | null };
}

/**
 * M1(b): confirming a shared change at the desk. A save of a Customer or Company Profile whose record is the ONE common profile (`common`) at 2 or more hotels
 * (`sharedHotels`), and which changes one of the shared fields, is refused with 409 CONFLICT until it is sent again with `confirmShared: true`:
 *   error.message                         the sentence to show: "This changes email and city for this guest at all 3 hotels."
 *   error.details.fields.confirmShared    the same sentence (the marker: only this 409 carries it)
 *   error.details.fields.<form field>     "Shared with 3 hotels" for each shared field that would change (the form's own field names)
 * A change of hotel-only fields (a guest's mobile, ID proof, notes; a company's rates, instruction, nationality) never asks. The portals' own My profile never asks.
 * M1(c): the GSTIN and the legal name of a common company may be changed at the desk only with Full Access on Companies (a manager or the owner);
 * anyone else gets 403 FORBIDDEN "Ask a manager to change the GSTIN." (or "... the company name."). The company's own portal login may change its GSTIN.
 */
export const CONFIRM_SHARED_FIELD = 'confirmShared';
/** True for the M1(b) 409 that asks to confirm (resend the same input with `confirmShared: true`). */
export function needsSharedConfirm(e: { code: string; details?: { fields?: Record<string, string> } }): boolean {
  return e.code === 'CONFLICT' && typeof e.details?.fields?.[CONFIRM_SHARED_FIELD] === 'string';
}

/** "email and city", "name, email and city": the history's field keys in plain words. */
export function sharedFieldsText(fields: readonly string[]): string {
  const words: Record<string, string> = { name: 'name', email: 'email', mobile: 'mobile', landline: 'phone', address: 'address', city: 'city', pincode: 'pincode', country: 'country', gstin: 'GSTIN', mainContact: 'main contact', contacts: 'contact people' };
  const w = fields.map((f) => words[f] ?? f);
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/** "Last changed by Hotel Sunrise · Asha Patel · 18 Oct 2026, 2:05 pm" (IST) (an unknown hotel or person is left out). */
export function lastChangeLine(c: ProfileLastChange): string {
  return `Last changed by ${[c.hotelName, c.by, formatDateTime(c.at)].filter((x): x is string => Boolean(x)).join(' · ')}`;
}
export type DuplicateBy = 'mobile' | 'email' | 'gstin';

export interface ReviewProfile {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  /** Companies only. */
  gstin: string | null;
  /** Guests only. */
  city: string | null;
  /** The profile belongs to a portal login (that person signs in with it). */
  hasLogin: boolean;
  createdAt: string;
  /** The hotels whose records are this profile. */
  hotels: { hotelId: string; hotelName: string }[];
}

export interface DuplicateGroup {
  /** Stable key for the list (kind, what they share, the value). */
  key: string;
  by: DuplicateBy;
  /** The shared value as stored (+91 mobile, lower-case email, upper-case GSTIN). */
  value: string;
  /** Oldest first: the first is the usual one to keep. */
  profiles: ReviewProfile[];
  /** Pairs in this group already marked "not the same" (each pair once). */
  keptApart: [string, string][];
}

export interface DuplicatePage {
  items: DuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MergeInput {
  kind: ProfileKind;
  keepId: string;
  /** 1 to 10 profiles that go into the kept one. */
  mergeIds: string[];
  /** Why (3 to 300 characters): it is kept in the audit log. */
  reason: string;
}

export interface MergeResult {
  kept: ReviewProfile;
  merged: number;
  /** Hotel records that now point at the kept profile. */
  relinked: number;
}

export interface KeepApartInput {
  kind: ProfileKind;
  leftId: string;
  rightId: string;
}

export const profileReviewPaths = {
  duplicates: '/api/v1/platform/profiles/duplicates',
  merge: '/api/v1/platform/profiles/merge',
  keepApart: '/api/v1/platform/profiles/keep-apart',
  undoKeepApart: '/api/v1/platform/profiles/keep-apart/undo',
} as const;

export const profileReviewCopy = {
  title: 'Possible duplicates',
  subtitle: 'Guests and companies that may be the same, across hotels. Nothing is merged unless you merge it.',
  kind: { guest: 'Guests', company: 'Companies' } as Record<ProfileKind, string>,
  by: { mobile: 'Same mobile', email: 'Same email', gstin: 'Same GSTIN' } as Record<DuplicateBy, string>,
  keep: 'Keep this one',
  merge: 'Merge',
  keepApart: 'Not the same',
  undoKeepApart: 'Show again',
  reasonLabel: 'Why are these the same?',
  mergeNote: 'The hotels\' records of the others will point at the one you keep. Bills, stays and the hotels\' own details do not change. The others stay as history.',
  twoLogins: 'Both profiles have their own sign-in, so they are two people. They cannot be merged.',
  empty: 'No possible duplicates.',
  merged: (n: number) => (n === 1 ? 'One profile merged.' : `${n} profiles merged.`),
} as const;

export interface ProfileReviewApi {
  duplicates(q: { kind: ProfileKind; search?: string; page?: number; pageSize?: number }): Promise<DashResult<DuplicatePage>>;
  merge(input: MergeInput): Promise<DashResult<MergeResult>>;
  keepApart(input: KeepApartInput): Promise<DashResult<{ kept: boolean }>>;
  undoKeepApart(input: KeepApartInput): Promise<DashResult<{ undone: boolean }>>;
}
