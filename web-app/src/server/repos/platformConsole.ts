import "server-only";
import type { AccountRole } from "../auth/session";
import type { AuthRepos, HotelLifecycleStatus, UserStatus } from "./auth";
import type { PlatformInvitationsRepo, PlatformOnboardingRepo } from "./platformInvitations";

// The Platform console's data (Platform Admin and Super Admin; BRIEF-BACKEND-PLATFORM P2): hotels and their lifecycle, groups and membership,
// the platform accounts (Hotel Admins, Group Hotel Admins, Platform Admins) and the platform audit trail. ONLY platform tables (0001, 0003,
// 0102 hotel lifecycle, 0103 groups, 0104/0105 invitations and onboarding for counts and the form as sent, 0107 the audit columns): nothing here
// ever opens a hotel's schema, so the console never sees a hotel's business data. Plain records in and out, no SQL. The PostgreSQL
// implementation is repos/postgres/platformConsole.ts; the in-memory double (repos/memory/platformConsole.ts) shares the sign-in data and is
// never looser than the database (the CHECKs, the unique indexes, the append-only history).

export type { HotelLifecycleStatus };

/* ---------------------------------------------------------------- hotels */

/** A hotel as the console sees it: platform facts only. city/state/gstin are NULL for hotels made before the lifecycle existed. */
export interface PlatformHotelRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  timeZone: string;
  status: HotelLifecycleStatus;
  createdAt: Date;
  provisionedAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  suspendedAt: Date | null;
  suspendReason: string | null;
  archivedAt: Date | null;
  archiveReason: string | null;
  /** End of the archive grace period (archived only). */
  restoreUntil: Date | null;
  /** What Restore returns to (archived only). */
  statusBeforeArchive: "active" | "suspended" | "rejected" | null;
  lastActivityAt: Date | null;
  /** The one group it is in (group_members), or null. */
  groupId: string | null;
  groupName: string | null;
  /** The invitation whose onboarding form made it (onboarding_submissions), or null. */
  invitationId: string | null;
  /** Hotel Admin accounts attached to it (any status, closed accounts left out), and of those the locked ones. */
  adminCount: number;
  lockedAdminCount: number;
}

/** The lifecycle columns a status change writes; a field left out keeps its value, null clears it. */
export interface HotelLifecyclePatch {
  status: HotelLifecycleStatus;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectReason?: string | null;
  suspendedAt?: Date | null;
  suspendReason?: string | null;
  archivedAt?: Date | null;
  archiveReason?: string | null;
  restoreUntil?: Date | null;
  statusBeforeArchive?: "active" | "suspended" | "rejected" | null;
}

/** One row of platform.hotel_status_history (append-only): who, why, when. */
export interface HotelStatusChange {
  hotelId: string;
  fromStatus: HotelLifecycleStatus | null;
  toStatus: HotelLifecycleStatus;
  changedBy: string | null;
  actorRole: AccountRole | null;
  reason: string | null;
  traceId: string | null;
  at: Date;
}

interface HotelListFilter {
  /** Lower-case words; each must appear in the name, slug, city, state, GSTIN or group name. */
  words: readonly string[];
  groupId?: string;
  /** "YYYY-MM": created in that month (India time). */
  createdMonth?: string;
}

/** What the onboarding form sent (never a password: a CHECK refuses one at any depth). */
export interface OnboardingRow {
  invitationId: string;
  payload: Record<string, unknown>;
  submittedAt: Date;
}

export interface PlatformHotelsRepo {
  /** Every hotel the console lists (statuses active, suspended, pending_approval, rejected, archived; deleted / invited / onboarding never). */
  list(filter: HotelListFilter, now: Date): Promise<PlatformHotelRow[]>;
  /** One listed hotel, or null. `forUpdate` locks the row for this unit (a status change). */
  get(id: string, now: Date, options?: { forUpdate?: boolean }): Promise<PlatformHotelRow | null>;
  setLifecycle(id: string, patch: HotelLifecyclePatch): Promise<void>;
  addStatusHistory(row: HotelStatusChange): Promise<void>;
  /** Ends every session opened in the hotel (suspend, archive); returns how many. */
  endSessions(hotelId: string, now: Date): Promise<number>;
  onboarding(hotelId: string): Promise<OnboardingRow | null>;
  /** Invitations still open (pending with a live link), and 'group' invitations still waiting for their admin (pending or expired). */
  invitationCounts(now: Date): Promise<{ open: number; groupsWaiting: number }>;
  /** Is this web address used by a live hotel (any status, deleted ones free it)? */
  slugTaken(slug: string): Promise<boolean>;
  /** After a permanent delete: status 'deleted' with deleted_at (the row stays for the audit tables; the slug is free again). */
  markDeleted(id: string, now: Date): Promise<void>;
  /** GST percent a new hotel starts with (platform_settings new_hotel.gst_percent), for the read-only Settings tab. */
  defaultGstPercent(): Promise<number>;
  /** ID pictures kept as an exact copy (platform 0196 hotels.id_photo_exact_copy); false = a sharp JPEG under 500 KB. */
  idPhotoExact(id: string): Promise<boolean>;
  setIdPhotoExact(id: string, on: boolean): Promise<void>;
}

/* ---------------------------------------------------------------- accounts */

export type AccountStatus = UserStatus;

/** A platform account (any account role), with the hotel it belongs to and the group it is in or runs. Never a password hash. */
export interface PlatformAccountRow {
  id: string;
  username: string;
  email: string | null;
  /** "+91" and ten digits, as stored. */
  mobile: string | null;
  displayName: string;
  accountRole: AccountRole;
  status: AccountStatus;
  /** Its membership in that hotel was switched off from the hotel's own Users screen. */
  memberDisabled: boolean;
  blocked: boolean;
  lockedUntil: Date | null;
  /** When the current block or lock began (blocked_at, else the newest account_locked event); absent/null when not known. */
  lockedAt?: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** Its default hotel (closed hotels left out), or null. */
  hotelId: string | null;
  hotelName: string | null;
  hotelStatus: HotelLifecycleStatus | null;
  /** The group of that hotel, or the group this account administers. */
  groupId: string | null;
  groupName: string | null;
  /** The group whose Group Hotel Admin this account is (hotel_groups.admin_user_id), or null. */
  groupAdminOf: { groupId: string; groupName: string } | null;
}

interface AccountFilter {
  words: readonly string[];
  /** Only these account roles. */
  accountRoles: readonly AccountRole[];
  hotelId?: string;
  groupId?: string;
}

interface NewAccount {
  username: string;
  email: string;
  /** "+91" and ten digits. */
  mobile: string;
  displayName: string;
  accountRole: AccountRole;
  /** A built-in permission role key (super_admin, admin, viewer): the hotel's ladder for a Hotel Admin, a placeholder for platform staff. */
  roleKey: string;
  /** The hotel it is attached to (a Hotel Admin), or null (platform staff). */
  hotelId: string | null;
}

export interface PlatformAccountsRepo {
  list(filter: AccountFilter, now: Date): Promise<PlatformAccountRow[]>;
  /** A live (not closed) account of any role, or null. `forUpdate` locks the row. */
  get(id: string, options?: { forUpdate?: boolean }): Promise<PlatformAccountRow | null>;
  usernameTaken(lowerUsername: string): Promise<boolean>;
  emailTaken(lowerEmail: string): Promise<boolean>;
  mobileTaken(mobile: string): Promise<boolean>;
  /** Does a live account hold the hotel's built-in SuperAdmin permission role there? */
  hotelHasSuperAdmin(hotelId: string): Promise<boolean>;
  /** Does THIS account hold the built-in SuperAdmin permission role in that hotel (the hotel's owner account)? */
  holdsOwnerRole(userId: string, hotelId: string): Promise<boolean>;
  /** Made in 'invited' status with NO usable password (the credential side gives the temporary one); returns the id. */
  create(fields: NewAccount, by: string, now: Date): Promise<string>;
  /** Disable or enable the account (enable also switches its membership in `hotelId` back on). */
  setStatus(id: string, status: "active" | "disabled", hotelId: string | null): Promise<void>;
  /** Clears wrong-try counters, the timed lock and the block. */
  unlock(id: string): Promise<void>;
  endSessions(id: string, now: Date): Promise<number>;
  activeSuperAdmins(): Promise<number>;
  /** A hotel deleted for good: closes (soft-deletes) every hotel-level account whose ONLY hotel it was and ends their sessions; others just lose the membership. Returns how many were closed. */
  closeOfHotel(hotelId: string, by: string, now: Date): Promise<number>;
}

/* ---------------------------------------------------------------- groups */

export type GroupStatus = "pending_approval" | "active" | "suspended" | "rejected" | "archived";

export interface PlatformGroupRow {
  id: string;
  name: string;
  slug: string;
  status: GroupStatus;
  /** The Group Hotel Admin: a group-level account, or a Hotel Admin of a member hotel. */
  admin: { id: string; displayName: string; username: string; accountRole: AccountRole; hotelId: string | null; hotelName: string | null } | null;
  hotelIds: string[];
  createdAt: Date;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  invitationId: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
}

export type GroupEvent = "created" | "submitted" | "approved" | "rejected" | "suspended" | "reactivated" | "archived" | "restored" | "hotel_linked" | "hotel_unlinked" | "admin_set" | "admin_cleared" | "max_hotels_set";

/** One row of platform.group_history (append-only). */
export interface GroupHistoryRow {
  groupId: string;
  event: GroupEvent;
  fromStatus: GroupStatus | null;
  toStatus: GroupStatus | null;
  hotelId: string | null;
  adminUserId: string | null;
  changedBy: string | null;
  actorRole: AccountRole | null;
  reason: string | null;
  traceId: string | null;
  at: Date;
}

export interface PlatformGroupsRepo {
  /** Every live group (not deleted), any status. */
  list(): Promise<PlatformGroupRow[]>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<PlatformGroupRow | null>;
  /** Case-insensitive, among live groups of any status. */
  nameTaken(name: string): Promise<boolean>;
  slugTaken(slug: string): Promise<boolean>;
  /** A new active group (made in the console); returns the id. */
  create(fields: { name: string; slug: string }, now: Date): Promise<string>;
  groupOfHotel(hotelId: string): Promise<{ id: string; name: string } | null>;
  /** One group per hotel: a second link is a RepoError("unique"). */
  link(groupId: string, hotelId: string, by: string, now: Date): Promise<void>;
  /** false when the hotel was not in that group. */
  unlink(groupId: string, hotelId: string): Promise<boolean>;
  setAdmin(groupId: string, userId: string | null): Promise<void>;
  addHistory(row: GroupHistoryRow): Promise<void>;
  /** Approve or reject a group that came from an invitation (P3): the status and its decision columns. */
  setLifecycle(id: string, patch: { status: GroupStatus; approvedAt?: Date | null; rejectedAt?: Date | null; rejectReason?: string | null }): Promise<void>;
  /** The most hotels each of these groups may have (platform migration 0133); a group with no limit is absent (also while 0133 is not applied). */
  maxHotels(groupIds: readonly string[]): Promise<Map<string, number>>;
  /** Sets (null removes) the limit; false while 0133 is not applied (nothing saved). */
  setMaxHotels(groupId: string, max: number | null): Promise<boolean>;
  /** The group's hotels that count toward the limit: waiting, active or suspended (archived, rejected and deleted ones do not). Call it after locking the group row. */
  countTowardLimit(groupId: string): Promise<number>;
}

/* ---------------------------------------------------------------- the platform audit trail */

/** The contract's PlatformActivityAction values are the action names. */
export interface PlatformAuditRow {
  actorUserId: string | null;
  /** The actor's name at that moment ("System" for the system). */
  actorName: string;
  actorRole: AccountRole | null;
  action: string;
  entity: "hotel" | "group" | "user" | "invitation" | "platform";
  entityId: string | null;
  hotelId: string | null;
  groupId: string | null;
  /** What it was done to, as shown ("Nisha Rao", "Hotel Sunrise"): a snapshot. */
  targetLabel: string | null;
  reason: string | null;
  result: "success" | "failed";
  /** Set for everything done during an Enter-hotel visit (and its start and end): the audit row's inside_hotel is then true. */
  visitId?: string | null;
  /** Small facts only: never a password, code or token. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  traceId: string | null;
  at: Date;
}

export interface PlatformActivityRow {
  id: string;
  at: Date;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  hotelId: string | null;
  hotelName: string | null;
  groupId: string | null;
  groupName: string | null;
  targetLabel: string | null;
  reason: string | null;
}

export interface PlatformAuditRepo {
  /** Append-only: there is no call that edits or removes a row. */
  write(row: PlatformAuditRow): Promise<string>;
  /** The successful platform actions about a hotel or a group (either filter, or none), newest first. */
  activity(filter: { hotelId?: string; groupId?: string; words?: readonly string[] }, page: { offset: number; limit: number }): Promise<{ rows: PlatformActivityRow[]; total: number }>;
}

/* ---------------------------------------------------------------- the Super Admin's extras (P5) */

/** The audit log filters (the Super Admin's list and CSV). `from` is inclusive, `to` exclusive (the service turns IST dates into moments). */
export interface AuditSearch {
  action?: string;
  hotelId?: string;
  /** Exact actor name. */
  actor?: string;
  from?: Date;
  to?: Date;
}

export interface PlatformAuditEntryRow extends PlatformActivityRow {
  actorRole: AccountRole | null;
  result: "success" | "failed";
  insideHotel: boolean;
  ip: string | null;
  userAgent: string | null;
}

export interface PlatformAuditSearchRepo {
  /** Platform-scope rows (successful and refused), newest first. */
  search(filter: AuditSearch, page: { offset: number; limit: number }): Promise<{ rows: PlatformAuditEntryRow[]; total: number }>;
  /** Every actor name in the platform audit log, for the filter. */
  actors(): Promise<string[]>;
  /** Who did `action` last to each of these hotels (successful rows only). */
  lastActors(action: string, hotelIds: readonly string[]): Promise<Map<string, string>>;
}

/** One sign-in event of the sign-in history. A refusal after a right password is a `login_failed` with `detail.reason`. */
export interface SignInEvent {
  id: string;
  at: Date;
  event: "login_success" | "login_failed" | "account_locked" | "code_failed";
  /** null when the username matched nobody (only a keyed hash would be stored; none is). */
  userId: string | null;
  username: string | null;
  name: string | null;
  accountRole: AccountRole | null;
  hotelName: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

export interface PlatformSignInsRepo {
  /** The newest sign-in events (success, failed, locked), newest first, at most `limit`. */
  recent(limit: number): Promise<SignInEvent[]>;
}

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface PlatformSettingsRepo {
  /** Every non-secret setting. A secret row (is_secret) is never in this list. */
  all(): Promise<SettingRow[]>;
  /** Sets one known key (the database CHECK refuses a wrong shape). `secret` marks the row is_secret (the value is already encrypted by the caller). */
  set(key: string, value: unknown, by: string | null, now: Date, options?: { secret?: boolean }): Promise<void>;
  /**
   * The stored text of secret rows, for the server only: the mail sender opens it, the settings view only asks whether it is there. null = no value. NEVER returned by an
   * API and never logged.
   */
  secrets(keys: readonly string[]): Promise<Map<string, string | null>>;
  /** When each of these secret rows was last written: only the date, never the value. A key that is not a saved secret is absent. */
  secretChangedAt(keys: readonly string[]): Promise<Map<string, Date>>;
}

export interface HotelExportRow {
  id: string;
  hotelId: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  requestedBy: string;
  finishedAt: Date;
}

export interface PlatformExportsRepo {
  /** The newest ready export of each of these hotels. */
  readyOf(hotelIds: readonly string[]): Promise<Map<string, HotelExportRow>>;
  /** A finished export (status ready); returns its id. */
  record(row: { hotelId: string; requestedBy: string; fileName: string; fileRef: string; byteSize: number; sha256: string; startedAt: Date; finishedAt: Date }): Promise<string>;
  /** The permanent-delete record: the database trigger refuses anyone but an active Super Admin, anything but an archived hotel past its grace, a wrong slug or schema, no ready export. */
  recordDeletion(row: { hotelId: string; hotelName: string; slug: string; schemaName: string; confirmSlug: string; exportId: string; deletedBy: string; reason: string | null; traceId: string | null; at: Date }): Promise<void>;
  /** The hotel's schema name (hotel_<32 hex>). */
  schemaOf(hotelId: string): Promise<string | null>;
}

export interface PlatformHealthRepo {
  /** Hotel ids whose people have mail that failed to send in the last day. */
  hotelsWithFailedMail(since: Date): Promise<Set<string>>;
  /** Times a trivial query on the platform schema (the database answered, how long it took). */
  ping(): Promise<number>;
  /** What each hotel's own tables take on disk (tables, indexes and TOAST; P1 "storage per hotel"), by hotel id; a hotel that could not be measured is left out. */
  storageBytes(hotelIds: readonly string[]): Promise<Map<string, number>>;
}

/** One nightly backup copy of a hotel (platform.hotel_backups, migration 0122; MJ's plan T6). */
export interface HotelBackupRow {
  id: string;
  hotelId: string;
  fileName: string;
  /** The private storage key (store prefix + hotel + name); never a public URL. */
  fileRef: string;
  byteSize: number;
  sha256: string;
  tableCount: number;
  rowCount: number;
  finishedAt: Date;
}

export interface PlatformBackupsRepo {
  /** The newest ready copy of each of these hotels. */
  latestOf(hotelIds: readonly string[]): Promise<Map<string, HotelBackupRow>>;
  /** Every ready copy of one hotel, newest first (the nightly run prunes from it). */
  readyOf(hotelId: string): Promise<HotelBackupRow[]>;
  /** One run for one hotel: a ready copy, or a failed one with a short step name. Answers the row id. */
  record(row: { hotelId: string; startedAt: Date; finishedAt: Date } & ({ status: "ready"; fileName: string; fileRef: string; byteSize: number; sha256: string; tableCount: number; rowCount: number } | { status: "failed"; errorCode: string })): Promise<string>;
  /** Forgets a pruned copy's row (its file is removed first). */
  remove(id: string): Promise<void>;
}

/* ---------------------------------------------------------------- the unit */

/* ---------------------------------------------------------------- hotel mail (platform 0161) */

/** One hotel_mail row as the server holds it: the two passwords are still sealed. */
export interface HotelMailRow {
  hotelId: string;
  sesRegion: string | null;
  sesUser: string | null;
  sesPassword: string | null;
  sesFrom: string | null;
  gmailUser: string | null;
  gmailPassword: string | null;
  fromName: string | null;
  replyTo: string | null;
  sesTest: unknown;
  gmailTest: unknown;
  /** Null (or left out) while the mail runs; else the pause a Super Admin set: { at, by, reason, scope } (services/platform/hotelMailService.ts). */
  pause?: unknown;
  updatedAt: Date | null;
}

/** What a save changes: a field left out (undefined) stays, null clears it. */
export type HotelMailPatch = Partial<Omit<HotelMailRow, "hotelId" | "updatedAt">>;

export interface PlatformHotelMailRepo {
  get(hotelId: string): Promise<HotelMailRow | null>;
  /** Every hotel that has a row (the list shows which are set up). */
  all(): Promise<HotelMailRow[]>;
  /** Creates the row or changes the fields of the patch. */
  save(hotelId: string, patch: HotelMailPatch, by: string, now: Date): Promise<void>;
  /** The last test result of one account; null clears it. */
  setTest(hotelId: string, which: "ses" | "gmail", result: unknown, now: Date): Promise<void>;
}
/* ---------------------------------------------------------------- group mail (platform 0162) */

/** One group_mail row: the same accounts as a hotel's (hotel_mail), for a group. */
export interface GroupMailRow extends Omit<HotelMailRow, "hotelId"> {
  groupId: string;
}

export type GroupMailPatch = Partial<Omit<GroupMailRow, "groupId" | "updatedAt">>;

export interface PlatformGroupMailRepo {
  get(groupId: string): Promise<GroupMailRow | null>;
  /** Every group that has a row (the list shows which are set up). */
  all(): Promise<GroupMailRow[]>;
  /** Creates the row or changes the fields of the patch. */
  save(groupId: string, patch: GroupMailPatch, by: string, now: Date): Promise<void>;
  /** The last test result of one account; null clears it. */
  setTest(groupId: string, which: "ses" | "gmail", result: unknown, now: Date): Promise<void>;
}

export interface PlatformConsoleRepos {
  hotels: PlatformHotelsRepo;
  groups: PlatformGroupsRepo;
  accounts: PlatformAccountsRepo;
  audit: PlatformAuditRepo;
  /** The sign-in tables on the SAME transaction, so the credential side (temporary password, reset, mail) commits or rolls back with the action. */
  auth: AuthRepos;
  /** P3: invitations and the public onboarding form. */
  invitations: PlatformInvitationsRepo;
  onboarding: PlatformOnboardingRepo;
  /** P4: Enter hotel. */
  visits: PlatformVisitsRepo;
  /** What each platform admin may do inside hotels (platform 0135). */
  adminAccess: PlatformAdminAccessRepo;
  /** P5: the Super Admin's extras. */
  auditLog: PlatformAuditSearchRepo;
  signIns: PlatformSignInsRepo;
  settings: PlatformSettingsRepo;
  exports: PlatformExportsRepo;
  backups: PlatformBackupsRepo;
  health: PlatformHealthRepo;
  /** P4: announcements to the hotels. */
  announcements: PlatformAnnouncementsRepo;
  /** A hotel's own mail accounts (Platform > Hotel mail). */
  hotelMail: PlatformHotelMailRepo;
  /** A group's own mail accounts (Platform > Hotel mail, groups). */
  groupMail: PlatformGroupMailRepo;
}

/* ---------------------------------------------------------------- Enter hotel */

interface VisitRow {
  id: string;
  userId: string;
  hotelId: string;
  hotelName: string;
  sessionId: string | null;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  /** What the visit may do (platform 0135): 'view' = read only; 'full' = writes allowed and audited. Fixed when it starts. */
  access: VisitAccess;
}

export type VisitAccess = "view" | "full";
type VisitEnd = "exit" | "expired" | "signed_out" | "session_ended" | "hotel_unavailable" | "replaced" | "extended";

export interface PlatformVisitsRepo {
  /** Every visit of this person that has not ended (past its time or not), newest first. At most one exists (a unique index). */
  open(userId: string): Promise<VisitRow[]>;
  /**
   * A new visit; returns its id. The database trigger lets only an active Platform / Super Admin (or a group's own admin) enter a live, provisioned hotel, and (0135)
   * only with an access the person may have: a group admin view only, a platform admin within the level and hotels the Super Admin gave them.
   */
  start(f: { userId: string; hotelId: string; sessionId: string | null; reason: string; expiresAt: Date; ip: string | null; userAgent: string | null; access: VisitAccess; extendedFrom?: string | null }, now: Date): Promise<string>;
  end(id: string, reason: VisitEnd, by: string | null, now: Date): Promise<void>;
}

/** What the Super Admin allows a platform admin inside hotels (platform.platform_admin_hotel_access, 0135). No row = view, all hotels. */
export interface AdminHotelAccess {
  level: "none" | "view" | "full";
  allHotels: boolean;
  /** The hotels of a "selected hotels" scope (empty when allHotels). */
  hotelIds: string[];
  reason: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface PlatformAdminAccessRepo {
  /** The platform admin's access, or the default (view, all hotels) when none was set. */
  get(userId: string): Promise<AdminHotelAccess>;
  /** Sets it (the hotel list is replaced). false while platform 0135 is not applied. */
  set(userId: string, access: Omit<AdminHotelAccess, "updatedBy" | "updatedAt">, by: string, now: Date): Promise<boolean>;
}

/* ---------------------------------------------------------------- announcements (P4) */

export type AnnouncementAudience = "admins" | "everyone";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** Opens the top notch until the person accepts it. */
  important: boolean;
  startsAt: Date;
  endsAt: Date | null;
  endedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  /** How many people dismissed it. */
  reads: number;
}

export interface PlatformAnnouncementsRepo {
  /** Every announcement, newest first (ended ones included). */
  list(): Promise<AnnouncementRow[]>;
  get(id: string): Promise<AnnouncementRow | null>;
  create(f: { title: string; body: string; audience: AnnouncementAudience; important: boolean; startsAt: Date; endsAt: Date | null }, by: string, now: Date): Promise<string>;
  /** Ends it now; false when it was already over. */
  end(id: string, now: Date): Promise<boolean>;
  /** The live ones (started, not over, not ended) this person has not dismissed, for the audiences given; oldest first. */
  unreadFor(userId: string, audiences: readonly AnnouncementAudience[], now: Date): Promise<AnnouncementRow[]>;
  /** Marks it dismissed for this person (a repeat is fine). */
  markRead(id: string, userId: string, now: Date): Promise<void>;
}

/** One transaction on the platform schema (hms_app, no hotel role). */
export interface PlatformConsoleUnit {
  run<T>(work: (repos: PlatformConsoleRepos) => Promise<T>): Promise<T>;
}
