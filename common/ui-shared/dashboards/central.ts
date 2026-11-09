// The "Central" category of the Platform console (MJ, 3 Nov 2026): everything the platform keeps once for all hotels, as read-only tabs with search, paging and a detail view.
// Logins, guest profiles, company profiles, GST records and GST lookups; "Possible duplicates" (profileReview.ts) is the sixth tab. Super Admin and Platform Admin only.
// WRITES (MJ, 3 Nov 2026: "full CRUD in all", Super Admin only, one audit line each): create, edit and delete on the Logins, Guest profiles, Company profiles and GST records tabs; a delete asks for the record's name typed
// out. The GST lookups tab stays read only (an audit trail is not editable). A deleted profile or GST record is hidden, not removed, and can be restored. No export.
// No password hash, token, session id, auth code or key is ever sent. A guest's or company's mobile and email come MASKED in every list
// and detail; "Reveal" asks the server for one full value and the server writes one audit line (who, which profile, when; never the value).
//
// GET  /api/v1/platform/central/<tab>?search=&page=&pageSize=10|25|50   -> CentralPage<row>     tab = logins | guests | companies | gst | gst-lookups
// GET  /api/v1/platform/central/<tab>/<id>                              -> the tab's detail
// POST /api/v1/platform/central/reveal   RevealInput                    -> { value }            (404 not found or the value is empty)
// API keys are refused on every one of these routes, and so is a platform visit inside a hotel.
import type { DashResult } from './common';

export type CentralTab = 'logins' | 'guests' | 'companies' | 'gst' | 'lookups';

/** The tab ids in the order they show. The sixth tab, "duplicates", is the existing Possible duplicates page. */
export const centralTabs: readonly CentralTab[] = ['logins', 'guests', 'companies', 'gst', 'lookups'];

/** The path segment of each tab. */
export const centralTabPath: Record<CentralTab, string> = { logins: 'logins', guests: 'guests', companies: 'companies', gst: 'gst', lookups: 'gst-lookups' };

export interface CentralPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CentralQuery {
  /** true = the deleted records of the tab (guests, companies, GST records, logins), to restore them. */
  deleted?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export type LoginRoleType = 'super_admin' | 'platform_admin' | 'group_hotel_admin' | 'hotel_admin' | 'hotel_user' | 'corporate_user' | 'guest_user';
export type LoginStatus = 'active' | 'invited' | 'disabled' | 'pending_approval';

export interface CentralLoginRow {
  id: string;
  username: string;
  displayName: string | null;
  roleType: LoginRoleType;
  status: LoginStatus;
  /** Names of the hotels the login belongs to. */
  hotels: string[];
  lastLoginAt: string | null;
  /** Locked after wrong passwords, or blocked by an admin. */
  locked: boolean;
  /** A closed account (kept for history). */
  closed: boolean;
  createdAt: string;
}

export interface CentralLoginDetail extends CentralLoginRow {
  hotelLinks: { hotelId: string; hotelName: string; status: string }[];
  blockedKind: 'admin' | 'auto' | null;
  blockedAt: string | null;
  lockedUntil: string | null;
  failedAttempts: number;
  lockLevel: number;
  mustChangePassword: boolean;
  codeRequired: boolean;
  passwordChangedAt: string | null;
  /** How many sign-ins are open now (a count only: never a session id). */
  activeSessions: number;
  /** The guest or company profile this login owns, when it has one. */
  profile: { kind: ProfileKindC; id: string; name: string } | null;
}

export type ProfileKindC = 'guest' | 'company';

export interface CentralHotelRef {
  hotelId: string;
  hotelName: string;
}

export interface CentralMergeFrom {
  id: string;
  name: string;
  mergedAt: string;
}

/** The merge history of a profile: where it went (when it is history) and which profiles went into it. */
export interface CentralMergeHistory {
  mergedInto: { id: string; name: string } | null;
  mergedAt: string | null;
  mergedByName: string | null;
  mergedFrom: CentralMergeFrom[];
}

export interface CentralGuestRow {
  id: string;
  name: string;
  /** Masked: "+91 ••••• ••236". */
  mobile: string | null;
  /** Masked: "a•••@gmail.com". */
  email: string | null;
  city: string | null;
  hotelCount: number;
  hasLogin: boolean;
  /** The profile this one was merged into (it is history), or null. */
  mergedInto: string | null;
  /** When the Super Admin deleted it (it is hidden and can be restored), or null. */
  deletedAt: string | null;
  createdAt: string;
}

export interface CentralGuestDetail extends CentralGuestRow, CentralDeletedNote {
  address: string | null;
  hotels: CentralHotelRef[];
  loginUsername: string | null;
  updatedAt: string;
  history: CentralMergeHistory;
}

export interface CentralContactView {
  name: string;
  role: string;
  /** Masked. */
  email: string;
  /** Masked. */
  mobile: string;
}

export interface CentralCompanyRow {
  id: string;
  name: string;
  gstin: string | null;
  mainContactName: string | null;
  /** Masked. */
  email: string | null;
  /** Masked. */
  mobile: string | null;
  hotelCount: number;
  hasLogin: boolean;
  mergedInto: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface CentralCompanyDetail extends CentralCompanyRow, CentralDeletedNote {
  /** Masked. */
  landline: string | null;
  address: string | null;
  pincode: string | null;
  country: string | null;
  contacts: CentralContactView[];
  hotels: CentralHotelRef[];
  loginUsername: string | null;
  updatedAt: string;
  history: CentralMergeHistory;
}

export type CentralGstStatus = 'active' | 'cancelled' | 'suspended' | 'inactive' | 'unknown';

export interface CentralGstRow {
  id: string;
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  status: CentralGstStatus;
  state: string | null;
  source: string;
  fetchedAt: string;
  refreshAfter: string;
  timesUsed: number;
  deletedAt: string | null;
}

/** Every field the table holds (public GST data). `raw` is the lookup service's answer exactly as it came (never a key). */
export interface CentralGstDetail extends CentralGstRow, CentralDeletedNote {
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
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CentralLookupOutcome = 'found' | 'not_found' | 'failed';

/** One call to the GST lookup service: never the service's key, never its words. */
export interface CentralLookupRow {
  id: string;
  gstin: string;
  provider: string;
  outcome: CentralLookupOutcome;
  errorCode: string | null;
  tookMs: number | null;
  hotelName: string | null;
  /** The username of the person who asked. */
  requestedBy: string | null;
  createdAt: string;
}

export type CentralLookupDetail = CentralLookupRow;

export type RevealField = 'mobile' | 'email' | 'landline' | 'contactMobile' | 'contactEmail';

export interface RevealInput {
  kind: ProfileKindC;
  id: string;
  field: RevealField;
  /** Which contact person (contactMobile, contactEmail only), counting from 0. */
  index?: number;
}

/** Who and why a record was deleted (details of guests, companies and GST records). */
export interface CentralDeletedNote {
  deletedReason: string | null;
}

export interface CentralLoginInput {
  username: string;
  displayName: string;
  email: string;
  mobile: string;
  /** Only these three can be made here; the others have their own page (a Group Hotel Admin, a company or a guest login). */
  roleType: 'platform_admin' | 'hotel_admin' | 'hotel_user';
  /** The hotel, for a Hotel Admin or Hotel User. */
  hotelId?: string | null;
}

/** A field left out stays as it is. */
export interface CentralLoginPatch {
  displayName?: string;
  email?: string;
  mobile?: string;
}

/** A field left out stays as it is; null clears it (mobile, email, address, city, GSTIN ...); a text replaces it. */
export interface CentralGuestInput {
  name?: string;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface CentralCompanyInput {
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

/** A delete: the record's name typed out (the username of a login, the GSTIN of a GST record) and, optionally, why. */
export interface CentralDeleteInput {
  confirmName: string;
  reason?: string;
}

export const centralPaths = {
  list: (tab: CentralTab) => `/api/v1/platform/central/${centralTabPath[tab]}`,
  detail: (tab: CentralTab, id: string) => `/api/v1/platform/central/${centralTabPath[tab]}/${id}`,
  reveal: '/api/v1/platform/central/reveal',
  /** POST = create (logins, guests, companies, gst); PATCH and DELETE on the detail address; POST on `<detail>/restore` or `<detail>/refresh`. */
  write: (tab: CentralTab, id?: string, action?: 'restore' | 'refresh') => `/api/v1/platform/central/${centralTabPath[tab]}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`,
} as const;

export const centralCopy = {
  title: 'Central',
  subtitle: 'What the platform keeps once for every hotel. Read only.',
  tabs: { logins: 'Logins', guests: 'Guest profiles', companies: 'Company profiles', gst: 'GST records', lookups: 'GST lookups', duplicates: 'Possible duplicates' } as Record<CentralTab | 'duplicates', string>,
  search: {
    logins: 'Search username, name or role',
    guests: 'Search name or city (or a full mobile or email)',
    companies: 'Search name, GSTIN or city (or a full mobile or email)',
    gst: 'Search GSTIN, name or state',
    lookups: 'Search GSTIN, hotel or outcome',
  } as Record<CentralTab, string>,
  role: {
    super_admin: 'Super Admin', platform_admin: 'Platform Admin', group_hotel_admin: 'Group Hotel Admin', hotel_admin: 'Hotel Admin', hotel_user: 'Hotel User', corporate_user: 'Company login', guest_user: 'Guest login',
  } as Record<LoginRoleType, string>,
  status: { active: 'Active', invited: 'Invited', disabled: 'Disabled', pending_approval: 'Waiting for approval' } as Record<LoginStatus, string>,
  gstStatus: { active: 'Active', cancelled: 'Cancelled', suspended: 'Suspended', inactive: 'Inactive', unknown: 'Not known' } as Record<CentralGstStatus, string>,
  outcome: { found: 'Found', not_found: 'Not found', failed: 'Failed' } as Record<CentralLookupOutcome, string>,
  reveal: 'Reveal',
  revealNote: 'Showing the full value is written to the audit log.',
  readOnly: 'Nothing here is exported. Only the Super Admin can add, change or delete.',
  write: {
    showDeleted: 'Show deleted', showLive: 'Show live', edit: 'Edit', restore: 'Restore', restored: 'Restored.', refresh: 'Refresh from the provider', refreshed: 'Refreshed from the provider.',
    lookupsReadOnly: 'The lookup log is read only: an audit trail cannot be edited or deleted.',
    deleteHelp: 'Type the name exactly as shown to confirm.', reason: 'Why (optional)', cancel: 'Cancel', save: 'Save', saved: 'Saved.', created: 'Created.', deleted: 'Deleted.',
    keepBlank: 'Leave blank to keep it', removeIt: 'Remove it',
    loginNote: 'The sign-in invitation with a temporary password is emailed. It is not shown anywhere.',
    gstNote: 'Looks the number up now and saves it centrally. A bad number is refused.',
    profileNote: 'Changes the central profile only. No hotel\'s own copy changes.',
  },
  empty: { title: 'Nothing here yet', body: 'No records have been saved in this list.' },
  notReady: 'This list is not set up on this database yet.',
  noMatch: { title: 'No match', body: 'Nothing matches this search.' },
  history: 'Merge history',
  neverSignedIn: 'Never',
  merged: 'Merged (history)',
  total: (n: number) => (n === 1 ? '1 record' : `${n} records`),
} as const;

export interface CentralApi {
  logins(q: CentralQuery): Promise<DashResult<CentralPage<CentralLoginRow>>>;
  guests(q: CentralQuery): Promise<DashResult<CentralPage<CentralGuestRow>>>;
  companies(q: CentralQuery): Promise<DashResult<CentralPage<CentralCompanyRow>>>;
  gst(q: CentralQuery): Promise<DashResult<CentralPage<CentralGstRow>>>;
  lookups(q: CentralQuery): Promise<DashResult<CentralPage<CentralLookupRow>>>;
  login(id: string): Promise<DashResult<CentralLoginDetail>>;
  guest(id: string): Promise<DashResult<CentralGuestDetail>>;
  company(id: string): Promise<DashResult<CentralCompanyDetail>>;
  gstRecord(id: string): Promise<DashResult<CentralGstDetail>>;
  lookup(id: string): Promise<DashResult<CentralLookupDetail>>;
  reveal(input: RevealInput): Promise<DashResult<{ value: string }>>;
  /** The writes (Super Admin only). Each answers the record as the detail shows it. */
  createLogin(input: CentralLoginInput): Promise<DashResult<CentralLoginDetail>>;
  updateLogin(id: string, patch: CentralLoginPatch): Promise<DashResult<CentralLoginDetail>>;
  deleteLogin(id: string, input: CentralDeleteInput): Promise<DashResult<{ id: string }>>;
  createGuest(input: CentralGuestInput): Promise<DashResult<CentralGuestDetail>>;
  updateGuest(id: string, patch: CentralGuestInput): Promise<DashResult<CentralGuestDetail>>;
  deleteGuest(id: string, input: CentralDeleteInput): Promise<DashResult<{ id: string }>>;
  restoreGuest(id: string): Promise<DashResult<CentralGuestDetail>>;
  createCompany(input: CentralCompanyInput): Promise<DashResult<CentralCompanyDetail>>;
  updateCompany(id: string, patch: CentralCompanyInput): Promise<DashResult<CentralCompanyDetail>>;
  deleteCompany(id: string, input: CentralDeleteInput): Promise<DashResult<{ id: string }>>;
  restoreCompany(id: string): Promise<DashResult<CentralCompanyDetail>>;
  /** Looks the GSTIN up now (the lookup service saves it centrally). */
  createGst(gstin: string): Promise<DashResult<CentralGstDetail>>;
  /** Asks the provider again and replaces the fields (a logged lookup). */
  refreshGst(id: string): Promise<DashResult<CentralGstDetail>>;
  deleteGst(id: string, input: CentralDeleteInput): Promise<DashResult<{ id: string }>>;
  restoreGst(id: string): Promise<DashResult<CentralGstDetail>>;
}
