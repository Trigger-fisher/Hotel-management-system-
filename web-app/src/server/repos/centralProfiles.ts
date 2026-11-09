import "server-only";
import type { ProfileLastChange } from "@shared/dashboards/profileReview";
import type { PlatformConsoleRepos } from "./platformConsole";

// The ONE common guest and company profile (platform migration 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md): platform.guests / platform.companies and the link
// from each hotel's own record (guest_hotels / company_hotels). Plain records, no SQL. The PostgreSQL implementation is repos/postgres/centralProfiles.ts, the in-memory double
// repos/memory/centralProfiles.ts. A profile is never deleted; a merged one points at the one it was merged into, and every read here follows that to the live profile.

export interface CentralGuest {
  id: string;
  displayName: string;
  /** +91 and ten digits, or null. A copy for the duplicates list and to show it: bills are matched by each hotel's own copy. */
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CentralContact {
  name: string;
  role: string;
  email: string;
  mobile: string;
}

export interface CentralCompany {
  id: string;
  name: string;
  mainContactName: string | null;
  gstin: string | null;
  email: string | null;
  mobile: string | null;
  landline: string | null;
  address: string | null;
  pincode: string | null;
  country: string | null;
  contacts: CentralContact[];
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CentralGuestFields = Pick<CentralGuest, "displayName" | "mobile" | "email" | "address" | "city" | "userId">;
export type CentralCompanyFields = Pick<CentralCompany, "name" | "mainContactName" | "gstin" | "email" | "mobile" | "landline" | "address" | "pincode" | "country" | "contacts" | "userId">;

interface GuestsRepo {
  /** The live profile owned by this login, or null. */
  byUser(userId: string): Promise<CentralGuest | null>;
  /** The oldest live profile with this mobile (+91 and ten digits), or null: a hotel that makes a guest with the same mobile joins it instead of making a second one. */
  byMobile(mobile: string): Promise<CentralGuest | null>;
  /** The live profile a hotel record is linked to (through any merges), or null when the record has no link yet. */
  ofRecord(hotelId: string, customerId: string): Promise<CentralGuest | null>;
  create(fields: CentralGuestFields): Promise<CentralGuest>;
  /** Only the fields given change. Null when there is no such live profile. */
  update(id: string, patch: Partial<CentralGuestFields>): Promise<CentralGuest | null>;
  /** Links a hotel record to a profile; a record that already has a link keeps it (answers false). */
  link(hotelId: string, customerId: string, guestId: string): Promise<boolean>;
  /** How many hotels have a record linked to this profile (a shared change reaches them all). */
  hotelCount(guestId: string): Promise<number>;
}

interface CompaniesRepo {
  byUser(userId: string): Promise<CentralCompany | null>;
  /** The oldest live profile with this GSTIN (upper case), or null: a hotel that makes a company with the same GSTIN joins it instead of making a second one. */
  byGstin(gstin: string): Promise<CentralCompany | null>;
  ofRecord(hotelId: string, companyProfileId: string): Promise<CentralCompany | null>;
  create(fields: CentralCompanyFields): Promise<CentralCompany>;
  update(id: string, patch: Partial<CentralCompanyFields>): Promise<CentralCompany | null>;
  link(hotelId: string, companyProfileId: string, companyId: string): Promise<boolean>;
  hotelCount(companyId: string): Promise<number>;
}

export type ProfileKind = "guest" | "company";

/** Live profiles that share one value: guests by mobile or email, companies by GSTIN or email. Ids oldest first. */
export interface DuplicateGroup {
  by: "mobile" | "email" | "gstin";
  value: string;
  ids: string[];
}

/** One profile as the Super Admin's review shows it, with the hotels whose records point at it. */
export interface ProfileSummary {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  city: string | null;
  userId: string | null;
  createdAt: Date;
  hotels: { hotelId: string; hotelName: string; recordId: string }[];
}

/** The Super Admin's possible-duplicates review (platform 0132): never automatic, every change is a person's decision. */
interface ReviewRepo {
  duplicates(kind: ProfileKind): Promise<DuplicateGroup[]>;
  /** Live and merged profiles alike (a merged one says so through `mergedInto`). */
  summaries(kind: ProfileKind, ids: readonly string[]): Promise<(ProfileSummary & { mergedInto: string | null })[]>;
  /** Pairs marked "not the same", each with the smaller id first. */
  keptApart(kind: ProfileKind): Promise<[string, string][]>;
  keepApart(kind: ProfileKind, a: string, b: string, by: string, at: Date): Promise<boolean>;
  undoKeepApart(kind: ProfileKind, a: string, b: string): Promise<boolean>;
  /**
   * Merges `goneId` into `keepId`: the hotels' records that pointed at the one that goes now point at the one kept (the hotels' own data is not touched), the one that goes
   * is kept as history (merged_into, when, by whom), and its login (if the kept one has none) moves to the kept one. Answers how many hotel records were re-linked.
   */
  merge(kind: ProfileKind, keepId: string, goneId: string, by: string, at: Date): Promise<{ relinked: number; loginMoved: boolean }>;
}

/** One save of a shared profile (security review round 2, M1(a)): which hotel, who, which fields, when. Kept in platform.audit_log (scope 'hotel'; no migration). */
export interface ProfileChange {
  kind: ProfileKind;
  profileId: string;
  /** The desk's hotel, or the hotel the guest or company was signed in to. */
  hotelId: string;
  byUserId: string;
  /** The person's name as it is now (kept with the row, so a later rename does not rewrite history). */
  byName: string | null;
  via: "desk" | "portal";
  /** The shared fields that changed (keys, never values); empty = the profile was made. */
  fields: string[];
  /** A GSTIN change (M1(c)): old and new, MASKED to the last four (maskGstin). */
  gstin?: { from: string | null; to: string | null };
  at: Date;
  traceId: string | null;
}

export interface LastProfileChange {
  at: Date;
  hotelName: string | null;
  by: string | null;
  via: "desk" | "portal";
  fields: string[];
  gstin?: { from: string | null; to: string | null };
}

/** A GSTIN as the history keeps it: the last four only ("XXXX 1Z5"); null stays null. */
export const maskGstin = (v: string | null | undefined): string | null => (v ? `XXXX ${v.slice(-4)}` : null);

interface HistoryRepo {
  /** Written in the same transaction as the change it describes. Append-only. */
  record(change: ProfileChange): Promise<void>;
  /** The latest change of this profile, or null. */
  last(kind: ProfileKind, profileId: string): Promise<LastProfileChange | null>;
}

export interface CentralProfilesRepos {
  /** False while platform migration 0132 has not been run on this database: the callers then use each hotel's own record, as before. */
  ready(): Promise<boolean>;
  guests: GuestsRepo;
  companies: CompaniesRepo;
  review: ReviewRepo;
  history: HistoryRepo;
}

/** The last change as the apps get it (`lastChange` on the desk's and My profile's DTOs). */
export const lastChangeView = (c: LastProfileChange | null): ProfileLastChange | null =>
  c ? { at: c.at.toISOString(), hotelName: c.hotelName, by: c.by, via: c.via, fields: [...c.fields], ...(c.gstin ? { gstin: { ...c.gstin } } : {}) } : null;

/** The shared guest fields that differ between two versions of a profile, as ProfileLastChange keys. */
export function guestFieldsChanged(a: CentralGuestFields | CentralGuest, b: CentralGuestFields | CentralGuest): string[] {
  const keys: [keyof CentralGuestFields, string][] = [["displayName", "name"], ["email", "email"], ["mobile", "mobile"], ["address", "address"], ["city", "city"]];
  return keys.filter(([k]) => (a[k] ?? null) !== (b[k] ?? null)).map(([, name]) => name);
}

/** The shared company fields that differ between two versions of a profile, as ProfileLastChange keys. */
export function companyFieldsChanged(a: CentralCompanyFields | CentralCompany, b: CentralCompanyFields | CentralCompany): string[] {
  const keys: [keyof CentralCompanyFields, string][] = [
    ["name", "name"], ["mainContactName", "mainContact"], ["gstin", "gstin"], ["email", "email"], ["mobile", "mobile"], ["landline", "landline"], ["address", "address"], ["pincode", "pincode"], ["country", "country"],
  ];
  const changed = keys.filter(([k]) => (a[k] ?? null) !== (b[k] ?? null)).map(([, name]) => name);
  const contacts = (c: CentralContact[]) => JSON.stringify(c.map((x) => [x.name, x.role, x.email, x.mobile]));
  return contacts(a.contacts) === contacts(b.contacts) ? changed : [...changed, "contacts"];
}

/** One transaction on the platform data. */
export interface CentralProfilesUnit {
  run<T>(work: (repos: CentralProfilesRepos) => Promise<T>): Promise<T>;
}

/** The Super Admin's review: the central profiles and the console's accounts and audit log in ONE transaction (a merge and its audit row commit together). */
export interface ProfileReviewUnit {
  run<T>(work: (repos: { central: CentralProfilesRepos; console: PlatformConsoleRepos }) => Promise<T>): Promise<T>;
}

/** The hotel's mobile as the central copy keeps it (+91 and ten digits, 6 to 9 first), or null when it cannot be read: "98250 41236", "+91 98250-41236", "098250 41236". */
export function centralMobile(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D+/g, "");
  const ten = digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : null;
  return ten && /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}
