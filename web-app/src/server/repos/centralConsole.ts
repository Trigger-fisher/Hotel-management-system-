import "server-only";
import type { CentralGstStatus, CentralLookupOutcome, LoginRoleType, LoginStatus, ProfileKindC, RevealField } from "@shared/dashboards/central";
import type { PlatformConsoleRepos } from "./platformConsole";

// The "Central" tabs of the Platform console (platform migrations 0132, 0142-0154, 0167): READ ONLY lists and details of the logins, the common guest and company profiles, the GST
// records and the GST lookup log. Plain records, no SQL. The PostgreSQL implementation is repos/postgres/centralConsole.ts, the in-memory double repos/memory/centralConsole.ts.
// Every select names its columns: no password hash, token, session id or auth code is ever read here. The service masks a mobile and an email; only `reveal` returns a full one.

export interface CentralQueryArgs {
  /** The words typed, trimmed (may be empty). */
  search: string;
  /** true = only the deleted records (guests, companies, GST records); false = only the live ones. */
  deleted?: boolean;
  limit: number;
  offset: number;
}

export interface CentralRows<T> {
  rows: T[];
  total: number;
}

export interface LoginListRecord {
  id: string;
  username: string;
  displayName: string | null;
  roleType: LoginRoleType;
  status: LoginStatus;
  hotels: string[];
  lastLoginAt: Date | null;
  locked: boolean;
  closed: boolean;
  createdAt: Date;
}

export interface LoginDetailRecord extends LoginListRecord {
  hotelLinks: { hotelId: string; hotelName: string; status: string }[];
  blockedKind: "admin" | "auto" | null;
  blockedAt: Date | null;
  lockedUntil: Date | null;
  failedAttempts: number;
  lockLevel: number;
  mustChangePassword: boolean;
  codeRequired: boolean;
  passwordChangedAt: Date | null;
  activeSessions: number;
  profile: { kind: ProfileKindC; id: string; name: string } | null;
}

export interface GuestListRecord {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  city: string | null;
  hotelCount: number;
  hasLogin: boolean;
  mergedInto: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface MergeHistoryRecord {
  mergedInto: { id: string; name: string } | null;
  mergedAt: Date | null;
  mergedByName: string | null;
  mergedFrom: { id: string; name: string; mergedAt: Date }[];
}

export interface GuestDetailRecord extends GuestListRecord {
  address: string | null;
  hotels: { hotelId: string; hotelName: string }[];
  loginUsername: string | null;
  updatedAt: Date;
  deletedReason: string | null;
  history: MergeHistoryRecord;
}

export interface CompanyListRecord {
  id: string;
  name: string;
  gstin: string | null;
  mainContactName: string | null;
  email: string | null;
  mobile: string | null;
  hotelCount: number;
  hasLogin: boolean;
  mergedInto: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface CompanyDetailRecord extends CompanyListRecord {
  landline: string | null;
  address: string | null;
  pincode: string | null;
  country: string | null;
  contacts: { name: string; role: string; email: string; mobile: string }[];
  hotels: { hotelId: string; hotelName: string }[];
  loginUsername: string | null;
  updatedAt: Date;
  deletedReason: string | null;
  history: MergeHistoryRecord;
}

export interface GstListRecord {
  id: string;
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  status: CentralGstStatus;
  state: string | null;
  source: string;
  fetchedAt: Date;
  refreshAfter: Date;
  timesUsed: number;
  deletedAt: Date | null;
}

export interface GstDetailRecord extends GstListRecord {
  pan: string;
  stateCode: string;
  taxpayerType: string | null;
  constitution: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  pincode: string | null;
  natureOfBusiness: string[];
  blockStatus: string | null;
  stateJurisdiction: string | null;
  street: string | null;
  locality: string | null;
  buildingName: string | null;
  buildingNumber: string | null;
  floor: string | null;
  landmark: string | null;
  raw: Record<string, unknown> | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedReason: string | null;
}

export interface LookupRecord {
  id: string;
  gstin: string;
  provider: string;
  outcome: CentralLookupOutcome;
  errorCode: string | null;
  tookMs: number | null;
  hotelName: string | null;
  requestedBy: string | null;
  createdAt: Date;
}

/** Which of the platform tables this database has (a database that has not run 0132 or 0167 yet answers empty lists, never an error). */
export interface CentralAvailability {
  profiles: boolean;
  gst: boolean;
}

export interface RevealTarget {
  /** For the audit line: "Guest profile: Amit Joshi". */
  label: string;
  value: string | null;
}

/** The fields a Super Admin writes on a guest profile; null clears, a missing key stays. */
export interface GuestWrite {
  displayName?: string;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface CompanyWrite {
  name?: string;
  gstin?: string | null;
  mainContactName?: string | null;
  email?: string | null;
  mobile?: string | null;
  landline?: string | null;
  address?: string | null;
  pincode?: string | null;
  country?: string | null;
}

export interface CentralConsoleRepos {
  available(): Promise<CentralAvailability>;
  logins: { list(q: CentralQueryArgs): Promise<CentralRows<LoginListRecord>>; get(id: string): Promise<LoginDetailRecord | null> };
  guests: {
    list(q: CentralQueryArgs): Promise<CentralRows<GuestListRecord>>;
    get(id: string): Promise<GuestDetailRecord | null>;
    create(fields: GuestWrite & { displayName: string }, at: Date): Promise<string>;
    /** Only a live profile; false when there is none. */
    update(id: string, patch: GuestWrite): Promise<boolean>;
    markDeleted(id: string, by: string, reason: string | null, at: Date): Promise<boolean>;
    restore(id: string): Promise<boolean>;
  };
  companies: {
    list(q: CentralQueryArgs): Promise<CentralRows<CompanyListRecord>>;
    get(id: string): Promise<CompanyDetailRecord | null>;
    create(fields: CompanyWrite & { name: string }, at: Date): Promise<string>;
    update(id: string, patch: CompanyWrite): Promise<boolean>;
    markDeleted(id: string, by: string, reason: string | null, at: Date): Promise<boolean>;
    restore(id: string): Promise<boolean>;
  };
  gst: {
    list(q: CentralQueryArgs): Promise<CentralRows<GstListRecord>>;
    get(id: string): Promise<GstDetailRecord | null>;
    /** The id of the saved record of this GSTIN (live or deleted), or null. */
    idOf(gstin: string): Promise<string | null>;
    markDeleted(id: string, by: string, reason: string | null, at: Date): Promise<boolean>;
    restore(id: string): Promise<boolean>;
  };
  lookups: { list(q: CentralQueryArgs): Promise<CentralRows<LookupRecord>>; get(id: string): Promise<LookupRecord | null> };
  /** One full value of one profile (a mobile, an email, a landline or a contact's), or null when there is no such profile or field. */
  reveal(kind: ProfileKindC, id: string, field: RevealField, index: number): Promise<RevealTarget | null>;
}

/** The Central tabs and the console's accounts and audit log in ONE transaction (a reveal and its audit row commit together). */
export interface CentralConsoleUnit {
  run<T>(work: (repos: { central: CentralConsoleRepos; console: PlatformConsoleRepos }) => Promise<T>): Promise<T>;
}
