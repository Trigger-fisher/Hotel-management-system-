import "server-only";
import type { Level } from "../auth/levels";

// The platform side of the business Admin, part 2: users, roles, grants, sign-in history and the audit lines (not one hotel's schema). Plain records, no SQL. The
// PostgreSQL implementation reads and writes the platform tables (users, user_hotels, roles, role_permissions, user_permissions, sessions,
// auth_events, audit_log); the in-memory double is repos/memory/adminPlatform.ts, bound to the SAME data as sign-in.
//
// BOUNDARY (Backend Review, "Admin split"): nothing here reads or writes a password hash, a token, a one-time code or a 2FA secret. A user is made
// without a usable password: the credential side (services/auth/credentialPort.ts) issues the invite. Sessions are only ended (revoked), never read
// for their token. Spec: docs/specs/admin.md.

/* ---------------------------------------------------------------- users in a hotel */

export type MemberStatus = "active" | "invited" | "disabled";

/** One person as the Users screen sees them in ONE hotel (their membership decides the role and whether they may sign in there). */
export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  mobile: string | null;
  displayName: string;
  accountRole: string;
  /** The role in THIS hotel (the membership's own, else the person's). */
  roleId: string;
  roleKey: string;
  roleName: string;
  roleLevel: number;
  /** The person's sign-in status: invited until the invite is used, disabled by an administrator, else active. */
  status: MemberStatus;
  /** Blocked by an administrator or locked by too many wrong tries (until the time passes). */
  blocked: boolean;
  lockedUntil: Date | null;
  /** The emailed sign-in code is required (always for administrators). */
  codeRequired: boolean;
  lastLoginAt: Date | null;
  /** When the password last changed (a date only; the password itself is never read). */
  passwordChangedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

interface NewUserFields {
  username: string;
  email: string;
  mobile: string | null;
  displayName: string;
  roleId: string;
  accountRole: string;
}

interface UserFilter {
  words: readonly string[];
  tab: "all" | "active" | "inactive" | "locked";
}

interface AdminUserRepo {
  list(hotelId: string, filter: UserFilter, now: Date): Promise<AdminUserRow[]>;
  /** Counts over the whole hotel, whatever the filter (the tiles). */
  counts(hotelId: string, now: Date): Promise<{ all: number; active: number; inactive: number; locked: number }>;
  get(hotelId: string, id: string): Promise<AdminUserRow | null>;
  /** The person's OWN account whatever hotels they belong to (platform staff belong to none): for their profile screen. */
  own(id: string): Promise<AdminUserRow | null>;
  usernameTaken(lowerUsername: string, exceptId?: string): Promise<boolean>;
  emailTaken(lowerEmail: string, exceptId?: string): Promise<boolean>;
  /** Made in `invited` status with NO usable password (the credential side issues the invite) and attached to the hotel with that role. */
  create(hotelId: string, fields: NewUserFields, by: string, now: Date): Promise<AdminUserRow>;
  update(hotelId: string, id: string, patch: Partial<Pick<NewUserFields, "displayName" | "username" | "mobile" | "roleId">>): Promise<AdminUserRow>;
  /** The person's OWN details when they belong to no hotel (a Group Hotel Admin, platform staff): the same three fields as `update`, no membership needed. */
  updateOwn(id: string, patch: Partial<Pick<NewUserFields, "displayName" | "username" | "mobile">>): Promise<void>;
  /** Deactivate (disabled) or reactivate in THIS hotel. */
  setMemberStatus(hotelId: string, id: string, status: "active" | "disabled"): Promise<void>;
  /** Clears wrong-try counters, the lock and the block (Pallav unlock); with `record`, also writes 'account_unlocked' to the sign-in history. */
  unlock(id: string, record?: { by: string; hotelId: string | null; ip: string | null; at: Date }): Promise<void>;
  /** Closes the account: it can no longer sign in, and its history stays (soft delete). */
  close(id: string, by: string, now: Date): Promise<void>;
  /** Ends every active session of the person (the token is never read). */
  endSessions(id: string, reason: "admin", now: Date): Promise<number>;
  /** Whole-person lookups for the audit lines. */
  names(ids: readonly string[]): Promise<Map<string, string>>;
  /** The hotel's name, for the profile. */
  hotelName(hotelId: string): Promise<string>;
  /** Decision 47: the guest or company record a portal account is linked to in this hotel (user_hotels.subject_kind/subject_id), or null. */
  portalOf(hotelId: string, userId: string): Promise<{ kind: "guest" | "company"; id: string } | null>;
  /** Links the portal account to a record of this hotel, or unlinks it (null). */
  setPortal(hotelId: string, userId: string, subject: { kind: "guest" | "company"; id: string } | null): Promise<void>;
}

/* ---------------------------------------------------------------- roles and grants */

export interface AdminRoleRow {
  id: string;
  /** null = a built-in role every hotel shares. */
  hotelId: string | null;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  level: number;
  inherits: boolean;
  /** Shipped with the system: cannot be deleted or renamed. */
  isSystem: boolean;
}

interface RoleFields {
  name: string;
  description: string | null;
  level: number;
  /** A Bootstrap icon class, at most 40 characters ("bi-person"). */
  icon: string;
  /** #RRGGBB */
  accent: string;
  /** Gets what the rungs below it are allowed (Pallav roles.inherits). */
  inherits: boolean;
}

export interface Grant {
  key: string;
  level: Level;
}

interface AdminRoleRepo {
  /** The roles this hotel can hand out: the built-in ones and its own custom ones, highest level first. The portal roles (guest, corporate) are not listed. */
  list(hotelId: string): Promise<AdminRoleRow[]>;
  get(hotelId: string, id: string): Promise<AdminRoleRow | null>;
  nameTaken(hotelId: string, name: string, exceptId?: string): Promise<boolean>;
  /** How many people in this hotel hold the role. */
  holders(hotelId: string, roleId: string): Promise<number>;
  /** How many people in this hotel hold each of these roles: ONE grouped count (a role nobody holds is absent). */
  holdersOf(hotelId: string, roleIds: readonly string[]): Promise<Map<string, number>>;
  create(hotelId: string, fields: RoleFields): Promise<AdminRoleRow>;
  update(roleId: string, patch: Partial<RoleFields>): Promise<AdminRoleRow>;
  remove(roleId: string): Promise<void>;
  /** The role's OWN grants (not the inherited ones). */
  grants(roleId: string): Promise<Grant[]>;
  /** The OWN grants of each of these roles in ONE read, by key order (a role with none is absent). */
  grantsOf(roleIds: readonly string[]): Promise<Map<string, Grant[]>>;
  /** Replaces the role's own grants. */
  setGrants(roleId: string, grants: readonly Grant[]): Promise<void>;
}

export interface AdminOverrideRepo {
  /** What an administrator gave or took away from one person in one hotel, on top of their role. level "none" is a revoke. */
  list(hotelId: string, userId: string): Promise<{ key: string; level: Level | "none" }[]>;
  set(hotelId: string, userId: string, key: string, level: Level | "none" | null, by: string): Promise<void>;
}

/* ---------------------------------------------------------------- sign-in history and the audit trail */

export interface SignInRow {
  /** The event's id (an id of the sign-in record). */
  id: string;
  at: Date;
  ip: string | null;
  userAgent: string | null;
  result: "success" | "failed";
  /** The session this sign-in opened has ended (only an ended record can be deleted). */
  ended: boolean;
}

interface AdminSignInRepo {
  /** The person's own sign-ins (success and failed), newest first. */
  list(userId: string, now: Date): Promise<SignInRow[]>;
  /** Removes one ended sign-in record of this person; false when it is not theirs or still running. */
  removeEnded(userId: string, id: string, now: Date): Promise<boolean>;
  /** The person's sessions that are still valid, newest first (read only: no token). */
  liveDevices(userId: string, currentSessionId: string, now: Date): Promise<{ id: string; userAgent: string | null; ip: string | null; lastSeenAt: Date | null; issuedAt: Date; current: boolean }[]>;
}

export interface AuditWrite {
  actorUserId: string;
  hotelId: string | null;
  action: string;
  /** What it is about (a user, a role): shown as the entity. */
  entity: string;
  entityId: string | null;
  traceId: string | null;
  /** Small facts only: never a password, code or token. */
  detail: Record<string, unknown> | null;
}

interface AuditRead {
  id: string;
  at: Date;
  action: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
}

interface AdminAuditRepo {
  write(row: AuditWrite, now: Date): Promise<void>;
  /** The newest account changes about one person (no sign-in rows), for the profile's "recent changes". */
  aboutUser(userId: string, limit: number): Promise<AuditRead[]>;
}

export interface AdminUsersRepos {
  users: AdminUserRepo;
  roles: AdminRoleRepo;
  overrides: AdminOverrideRepo;
  signIns: AdminSignInRepo;
  audit: AdminAuditRepo;
}

/** One transaction on the platform data. */
export interface AdminUsersUnit {
  run<T>(work: (repos: AdminUsersRepos) => Promise<T>): Promise<T>;
}
