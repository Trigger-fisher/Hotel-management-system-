import "server-only";
import type { IdentityCheck } from "../mail/identity";
import type { MailKind } from "../mail/routes";
import type { AccountRole, RecordScope } from "../auth/session";
import type { Grant, UserOverride } from "../auth/permissions";

// The platform's side of sign-in: users, roles and what they hold, sessions, emailed codes, the mail queue and the audit trails. These are
// the platform tables (0003 users, 0004 sessions/auth_codes/outbox, 0005 auth_events/audit_log). Plain records in and out, no SQL.
// The PostgreSQL implementation reads them as hms_app; the in-memory double (repos/memory/auth.ts) obeys the same rules.

/** pending_approval (0105): the first admin of a hotel or group that waits for approval; it can never sign in until approved. */
export type UserStatus = "active" | "invited" | "disabled" | "pending_approval";

/** platform.hotels.status (0102). Only 'active' lets anybody sign in to the hotel. */
export type HotelLifecycleStatus = "invited" | "onboarding" | "pending_approval" | "active" | "suspended" | "archived" | "rejected" | "deleted";

export interface UserRecord {
  id: string;
  /** Lower case. */
  username: string;
  email: string | null;
  mobile: string | null;
  displayName: string;
  /** The Argon2id encoded string; never leaves the server. */
  passwordHash: string;
  roleId: string;
  accountRole: AccountRole;
  status: UserStatus;
  mustChangePassword: boolean;
  /** When the app gave the current temporary password (platform 0193); null when none was given by the app. */
  tempPasswordAt?: Date | null;
  passwordChangedAt: Date | null;
  failedAttempts: number;
  /** How many locks the account has had in a row (0 to 6): the next lock lasts lockMinutes(lockLevel). */
  lockLevel: number;
  lockedUntil: Date | null;
  blockedAt: Date | null;
  blockedKind: "admin" | "auto" | null;
  /** The person's own choice (decision 46): a sign-in asks for the emailed code only when this is true; the default is false for every account. */
  codeRequired: boolean;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
}

export interface RoleRecord {
  id: string;
  /** null = a built-in role every hotel shares. */
  hotelId: string | null;
  key: string;
  level: number;
  inherits: boolean;
}

export interface HotelRecord {
  id: string;
  name: string;
  group: { id: string; name: string } | null;
  /** The hotel's lifecycle status. The PostgreSQL loader always sets it; an in-memory hotel without one is an active hotel. */
  status?: HotelLifecycleStatus;
  /** The hotel's state (Indian state, as typed). */
  state?: string | null;
}

/** What the person holds in ONE hotel: the role, its grants (own plus inherited, folded by the loader), their own grants/revokes there, and their record scope. */
export interface AccessRecord {
  user: UserRecord;
  hotel: HotelRecord | null;
  role: RoleRecord;
  grants: Grant[];
  overrides: UserOverride[];
  scope?: RecordScope;
}

/** An Enter-hotel visit as the session resolver needs it (platform.hotel_visits, 0106). */
export interface VisitSessionRecord {
  id: string;
  hotelId: string;
  hotelName: string;
  expiresAt: Date;
  /** platform 0135; 'view' before it */
  access: "view" | "full";
}

type CodePurposeName = "login" | "reset" | "reset_link" | "recheck";

export interface AuthCodeRecord {
  id: string;
  purpose: CodePurposeName;
  userId: string;
  /** HMAC bound to purpose, user and code (hashAuthCode). */
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  resendCount: number;
  lastSentAt: Date;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  hotelId: string | null;
  client: "web";
  /** SHA-256 of the token (a 256-bit random value): the token itself is never stored. */
  tokenHash: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  issuedAt: Date;
  lastSeenAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: "logout" | "replaced" | "expired" | "admin" | "blocked" | "password_changed" | null;
  /** The screen lock (migration 0188): set while the person has locked the screen; every route but the session check, unlock and sign-out is refused. */
  lockedAt?: Date | null;
  /** The vault re-check (platform 0194): when the person last proved it is them again in this session (password or emailed code). */
  recheckedAt?: Date | null;
}

export interface SenderIdentityRecord {
  /** platform or a hotel id. */
  scope: string;
  domain: string;
  /** The hotel's address on that domain; null for the platform. */
  fromAddress: string | null;
  /** The three DKIM names from SES (or none yet). */
  dkimTokens: string[];
  sesConfirmed: boolean;
  status: "pending" | "verified";
  checkedAt: Date | null;
  result: IdentityCheck | null;
}
export interface SenderIdentityPatch {
  domain?: string;
  fromAddress?: string | null;
  dkimTokens?: string[];
  sesConfirmed?: boolean;
  status?: "pending" | "verified";
  checkedAt?: Date | null;
  result?: IdentityCheck | null;
}

export interface OutboxRecord {
  id: string;
  userId: string | null;
  /** The hotel whose own mail server sends it (Settings > Email); null = the platform's sender. */
  hotelId: string | null;
  /** Every kind has a route in mail/routes.ts: a hotel kind names its hotel, a platform kind does not. */
  kind: MailKind;
  toEmail: string;
  template: string;
  /** JSON text; the only place a one-time code ever is. Null once the mail has been sent. */
  payload: string | null;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  /** Why the last try failed, as a code (mail/failure.ts); null when it did not fail. Never the server's own words. */
  lastError: string | null;
}

/** An address no campaign mail may go to (platform.mail_suppressions, migration 0130). hotelId null = every hotel. */
export interface SuppressionRecord {
  id: string;
  email: string;
  hotelId: string | null;
  reason: "bounce" | "complaint" | "unsubscribe" | "manual";
  source: "ses" | "brevo" | "manual";
  detail: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** A hotel's campaign mail on hold (platform.hotel_mail_holds, migration 0130): held while releasedAt is null. */
export interface MailHoldRecord {
  hotelId: string;
  reason: "bounces" | "complaints" | "manual";
  detail: string;
  heldAt: Date;
  heldBy: string | null;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseReason: string | null;
  /** The rates are counted from the day after this (the release); null = the last seven days. */
  countedFrom: Date | null;
}

/** A campaign being sent now (platform.mail_campaign_runs, migration 0130): the feeder's work list. */
export interface CampaignRunRecord {
  hotelId: string;
  campaignId: string;
  state: "sending" | "paused";
  startedAt: Date;
}

type AuthEventName =
  | "login_success" | "login_failed" | "logout" | "code_sent" | "code_failed" | "password_reset_requested" | "password_reset_done"
  | "password_changed" | "account_locked" | "account_unlocked" | "account_blocked" | "account_unblocked" | "session_replaced";

export interface AuthEventRecord {
  userId: string | null;
  hotelId: string | null;
  event: AuthEventName;
  ip: string | null;
  userAgent: string | null;
  /** Small facts only (the lock length): never a password, code, token or ID number. */
  detail: Record<string, unknown> | null;
  at: Date;
}

export interface AuditRecord {
  actorUserId: string | null;
  hotelId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  traceId: string | null;
  at: Date;
}

export interface AuthRepos {
  users: {
    byUsername(lowerName: string): Promise<UserRecord | null>;
    /** A live (not deleted) account with this lower-case email address, or null. */
    byEmail(lowerEmail: string): Promise<UserRecord | null>;
    /** `forUpdate`: lock the row for this unit (SELECT ... FOR UPDATE), so counters cannot be lost to a race. */
    byId(id: string, options?: { forUpdate?: boolean }): Promise<UserRecord | null>;
    update(id: string, patch: Partial<Omit<UserRecord, "id">>): Promise<void>;
  };
  codes: {
    byId(id: string): Promise<AuthCodeRecord | null>;
    /** A reset link by its token's keyed hash (the token itself is never stored); `forUpdate` locks it so two clicks cannot both use it. */
    byHash(purpose: "reset_link", hash: string, options?: { forUpdate?: boolean }): Promise<AuthCodeRecord | null>;
    /** Marks every unused code of the person and purpose as used (one live code per person and purpose), then inserts. */
    replace(row: Omit<AuthCodeRecord, "id" | "createdAt" | "usedAt" | "attempts" | "resendCount">, now: Date): Promise<AuthCodeRecord>;
    update(id: string, patch: Partial<Omit<AuthCodeRecord, "id" | "userId" | "purpose">>): Promise<void>;
  };
  sessions: {
    insert(row: Omit<SessionRecord, "id" | "revokedAt" | "revokedReason">): Promise<SessionRecord>;
    byTokenHash(hash: string): Promise<SessionRecord | null>;
    update(id: string, patch: Partial<Pick<SessionRecord, "lastSeenAt" | "expiresAt">>): Promise<void>;
    /** The person's sessions that are still valid (not revoked, not expired), newest first: the profile's "where am I signed in" list. */
    listActive(userId: string, now: Date): Promise<SessionRecord[]>;
    /** Revokes every active session of the person except one (the one being used); returns how many. */
    revokeOthers(userId: string, exceptSessionId: string, reason: NonNullable<SessionRecord["revokedReason"]>, now: Date): Promise<number>;
    /** Ends one session (sign-out). */
    revokeById(id: string, reason: NonNullable<SessionRecord["revokedReason"]>, now: Date): Promise<void>;
    /** Locks (a time) or unlocks (null) one live session's screen. */
    setLocked(id: string, at: Date | null): Promise<void>;
    /** The vault re-check: the person proved it is them again in this live session at this time. */
    setRechecked(id: string, at: Date): Promise<void>;
    /** Revokes every active session of the person; returns how many. */
    revokeActive(userId: string, reason: NonNullable<SessionRecord["revokedReason"]>, now: Date): Promise<number>;
  };
  outbox: {
    /** `hotelId` names the hotel whose own mail server sends it; left out or null = the platform sender. */
    enqueue(row: Omit<OutboxRecord, "id" | "status" | "attempts" | "nextAttemptAt" | "sentAt" | "createdAt" | "hotelId" | "lastError"> & { hotelId?: string | null }, now: Date): Promise<void>;
    /** The mail worker: due rows (pending, next attempt reached), marked 'sending'. */
    claimDue(now: Date, limit: number): Promise<OutboxRecord[]>;
    /**
     * The lane-aware claim (mail/routes.ts MAIL_LANE): "system" = every kind but the bulk ones, "bulk" = campaign mail, optionally of ONE hotel. Rows are marked 'sending'. The system lane
     * is claimed first by the worker, so a campaign never delays a code.
     */
    claimLane(now: Date, lane: "system" | "bulk", limit: number, hotelId?: string): Promise<OutboxRecord[]>;
    /** The hotels that have bulk (campaign) mail due now, most waiting first. */
    bulkHotels(now: Date): Promise<string[]>;
    /** Mails already sent today for these owners (a hotel id, or "platform"), by the UTC day "YYYY-MM-DD"; an owner with none is absent. */
    sentToday(scopes: readonly string[], day: string): Promise<Map<string, number>>;
    /** Adds sent mails to the day's count of each owner (the daily caps and the monthly usage read these). */
    addSent(entries: readonly { scope: string; day: string; sent: number }[]): Promise<void>;
    /** The Super Admin's daily cap per hotel (Platform > hotel); a hotel with none is absent. */
    caps(hotelIds: readonly string[]): Promise<Map<string, number>>;
    /** Sets (or removes, with null) the Super Admin's daily cap for a hotel. false while platform migration 0126 is not applied (nothing was saved). */
    setCap(hotelId: string, cap: number | null): Promise<boolean>;
    /** Mails sent per owner from the day romDay (inclusive) to 	oDay (exclusive), YYYY-MM-DD; an owner with none is absent. The monthly usage report sums these. */
    usage(fromDay: string, toDay: string, scopes: readonly string[]): Promise<Map<string, number>>;
    /** How the mails of a hotel with these templates stand: pending (waiting or sending), sent, failed; a template with no row is absent. */
    countByTemplate(hotelId: string, templates: readonly string[]): Promise<Map<string, { pending: number; sent: number; failed: number }>>;
    /** The mail worker: sent (payload removed) or failed (retry later, or for good after the last try: payload removed). */
    finish(id: string, outcome: { status: "sent" | "pending" | "failed"; attempts: number; nextAttemptAt?: Date; sentAt?: Date; error?: string | null }): Promise<void>;
    /** The newest result of a hotel's own mail: the failure code and when, or null when the last mail went (or there was none). For Settings > Email. */
    lastFailure(hotelId: string): Promise<{ code: string; at: Date } | null>;
    /** Campaign mail of these hotels waiting in the queue (pending or sending), by hotel; a hotel with none is absent. The campaign feeder keeps this small. */
    bulkWaiting(hotelIds: readonly string[]): Promise<Map<string, number>>;
    /** A cancelled campaign: its mails still waiting are closed as failed with the reason CANCELLED (payload removed); returns how many. */
    cancelTemplate(hotelId: string, template: string): Promise<number>;
    /** The hotel of an outbox row (a mail service's event names the row through our Message-ID); undefined = no such row, null = a platform mail. */
    hotelOf(id: string): Promise<string | null | undefined>;
    /** The hotel whose mail most recently went to this address since `since` (a mail service's event without our Message-ID); null = none. */
    lastHotelMailedTo(email: string, since: Date): Promise<string | null>;
  };
  /**
   * Deliverability (platform migration 0130): the suppression list, the bounce and complaint counts per hotel and day, and the hotels whose campaign mail is on hold. Every
   * method answers empty (or false) while the migration is not applied, so mail keeps going as before.
   */
  mailSafety: {
    /** true once platform migration 0130 is applied. */
    ready(): Promise<boolean>;
    /** One address suppressed (lower-case); false when the same address and hotel were already suppressed, or while 0130 is not applied. */
    suppress(row: Omit<SuppressionRecord, "id" | "createdAt">, now: Date): Promise<boolean>;
    /** Lifts one suppression; the row as it was, or null. */
    unsuppress(id: string): Promise<SuppressionRecord | null>;
    /** Newest first; `search` matches a part of the address; `before` continues a page. */
    suppressions(query: { search?: string; limit: number; before?: { at: Date; id: string } }): Promise<SuppressionRecord[]>;
    /** Which of these (lower-case) addresses no campaign mail of this hotel may go to: suppressed for every hotel or for this one. */
    suppressedAmong(hotelId: string, emails: readonly string[]): Promise<Set<string>>;
    /** Adds bounces and complaints to the day's counts of each owner (a hotel id, or "platform"). */
    addEvents(entries: readonly { scope: string; day: string; bounced: number; complained: number }[]): Promise<void>;
    /** A hotel's sent, bounced and complained mails from the day fromDay (inclusive, YYYY-MM-DD) to today. */
    rates(hotelId: string, fromDay: string): Promise<{ sent: number; bounced: number; complained: number }>;
    /** The hold row of a hotel (held or released), or null. */
    hold(hotelId: string): Promise<MailHoldRecord | null>;
    /** Every hold row, held first, newest first. */
    holds(): Promise<MailHoldRecord[]>;
    /** Which of these hotels are held now. */
    heldAmong(hotelIds: readonly string[]): Promise<Set<string>>;
    /** Puts a hotel on hold; false when it already is (or 0130 is not applied). */
    putOnHold(row: { hotelId: string; reason: MailHoldRecord["reason"]; detail: string; heldBy: string | null }, now: Date): Promise<boolean>;
    /** Releases a held hotel; false when it was not held. The rates are counted again from the day after now. */
    release(hotelId: string, by: string, reason: string, now: Date): Promise<boolean>;
    /**
     * The webhook's receipts (platform migration 0136): records these event keys (64 hex characters) and answers the ones seen for the FIRST time; a key already received is a
     * repeated delivery. Receipts older than seven days are removed on the way. While 0136 is not applied every key is new (nothing is remembered, as before).
     */
    receive(provider: "ses" | "brevo", keys: readonly string[], now: Date): Promise<Set<string>>;
  };
  /** The campaigns being sent now, across hotels (platform migration 0130). Empty while the migration is not applied. */
  campaignRuns: {
    start(hotelId: string, campaignId: string, now: Date): Promise<void>;
    setState(hotelId: string, campaignId: string, state: CampaignRunRecord["state"]): Promise<void>;
    end(hotelId: string, campaignId: string): Promise<void>;
    /** Every run, oldest first. */
    active(): Promise<CampaignRunRecord[]>;
  };
  /** Sender identities (platform.sender_identities, migration 0128): the domain a mail comes from and its DNS check. scope is platform or a hotel id. All answer empty / null while the table is not there. */
  identities: {
    get(scope: string): Promise<SenderIdentityRecord | null>;
    list(): Promise<SenderIdentityRecord[]>;
    /** Creates or updates the identity of this scope; null while migration 0128 is not applied. A new domain resets the DKIM names, the SES confirmation, the status and the check. */
    save(scope: string, patch: SenderIdentityPatch): Promise<SenderIdentityRecord | null>;
    remove(scope: string): Promise<void>;
  };
  /** API access keys (platform.api_tokens, migration 0129), as the session resolver needs them: look one up by the keyed hash of its key, and count one call. Both fail while the table is not there. */
  apiTokens: {
    byHash(hash: string): Promise<ApiTokenRecord | null>;
    /** The Super Admin's switch for FULL keys (platform.api_access_settings); false when it is off or the table is not there. */
    fullAccessEnabled(): Promise<boolean>;
    /** One call made with the key: when and from where, today's count, and the address added to the ones the key was seen from (the newest 20). */
    recordUse(id: string, use: { at: Date; day: string; ip: string | null }): Promise<void>;
    /** The console: every key (newest first, revoked and expired ones too: they stay for the audit trail), at most 200. */
    list(): Promise<ApiTokenRow[]>;
    /** The console: a new key (only its keyed hash arrives here). */
    insert(row: ApiTokenInsert, now: Date): Promise<ApiTokenRow>;
    /** Keys that are not revoked and not expired. */
    countActive(now: Date): Promise<number>;
    /** Revokes one key; false when it was not there or already revoked. */
    revoke(id: string, by: string, now: Date): Promise<boolean>;
    /** Revokes every active key; returns how many. */
    revokeAll(by: string, now: Date): Promise<number>;
    /** The switch for FULL keys and who set it last. */
    accessSettings(): Promise<ApiAccessSettings>;
    setFullAccess(enabled: boolean, by: string, reason: string, now: Date): Promise<void>;
  };
  events: { event(row: AuthEventRecord): Promise<void>; audit(row: AuditRecord): Promise<void> };
  access: {
    /** The person's access in a hotel (their default one when none is given); null when the person or the hotel is not there. */
    load(userId: string, hotelId: string | null): Promise<AccessRecord | null>;
    /**
     * Platform staff INSIDE a hotel (Enter hotel, P4): the hotel's built-in SuperAdmin permission role, no personal grants, no record scope. The caller
     * has already proved there is an active visit; the hotel may be active or suspended, a deleted one is null. Reads only: the route wrapper refuses writes.
     */
    loadVisit(userId: string, hotelId: string): Promise<AccessRecord | null>;
    /**
     * Everything the session resolver needs about one session cookie in ONE read: the session row (by the token's hash), the person's access in the session's hotel
     * (as `load` gives it; null when the person is gone or not a member) and, for a platform, super or group account only, the live Enter-hotel visit bound to the
     * session (as `visits.activeForSession`) with the visited hotel's access (as `loadVisit`; null when the hotel is gone). Null when there is no such session.
     * The resolver applies every rule itself (revoked, expired, account state, hotel state): this only reads.
     */
    loadBySession(tokenHash: string, at: Date): Promise<{ session: SessionRecord; access: AccessRecord | null; visit: VisitSessionRecord | null; visitAccess: AccessRecord | null; /** The stored security.session_minutes value (read in the same statement), or null. */ sessionLimits?: unknown } | null>;
    /** The stored Platform settings > Security values (security.session_minutes, security.temp_password_minutes) as they are, each null when not set. */
    security(): Promise<{ sessionMinutes: unknown; tempPasswordMinutes: unknown }>;
    /** Decision 48: the active hotels a guest or company portal login is linked to (one user_hotels row each, with that hotel's own record id), sorted by hotel name. */
    portalHotels(userId: string, kind: "guest" | "company"): Promise<{ hotelId: string; hotelName: string; subjectId: string }[]>;
    /** Decision 55: the hotel a website's Sign in button names (`?hotel=<slug>`): its id when the hotel is active, not deleted and its website is live, else null (the same answer for "no such hotel"). */
    entryHotelId(slug: string): Promise<string | null>;
    /** The group a Group Hotel Admin administers (platform.hotel_groups.admin_user_id, migration 0156), not deleted, with its status; null when there is none. */
    adminGroup(userId: string): Promise<{ id: string; name: string; status: string } | null>;
  };
  /** Decision 55: hotel websites (platform.hotel_sites and hotel_site_domains): what the public API reads before it opens a hotel's own schema. */
  sites: {
    /** The hotel with this slug (not deleted), whatever its status, with its website switch and domains; null when there is none. */
    bySlug(slug: string): Promise<HotelSiteRecord | null>;
    /** The hotel's own website settings by its id. */
    byHotel(hotelId: string): Promise<HotelSiteRecord | null>;
    /** The hotel whose registered domains include this host (lower-case), or null. */
    byDomain(host: string): Promise<HotelSiteRecord | null>;
    /** Saves the switch and the whole domain list (the caller has validated them). Returns the domains that already belong to another hotel (nothing is saved then). */
    save(hotelId: string, next: { live: boolean; domains: readonly string[] }, by: string): Promise<{ taken: string[] }>;
  };
  /** Website templates (platform.hotel_site_builds): each time a hotel picked a design, and what the "Create hotel site" job reported back. */
  siteBuilds: {
    byId(id: string): Promise<SiteBuildRecord | null>;
    /** The hotel's newest builds, newest first, at most `limit`. */
    recent(hotelId: string, limit: number): Promise<SiteBuildRecord[]>;
    /** Queues a build; null when the hotel already has one queued or building (one at a time: the database keeps that too). */
    queue(hotelId: string, templateKey: string, by: string | null, now: Date): Promise<SiteBuildRecord | null>;
    /**
     * Moves a build on: to `building` only from queued, to `live` or `failed` from queued or building (a final build never moves again). The row after the move,
     * or null when it is not there or already past that step (the caller reads `byId` to tell a repeat of the same report from a late, different one).
     */
    advance(id: string, next: { status: Exclude<SiteBuildStatus, "queued">; message: string | null; runUrl: string | null; siteUrl: string | null }, now: Date): Promise<SiteBuildRecord | null>;
    /** Fails the hotel's builds still queued or building that were asked for before `before` (the job never answered): how many. */
    failStale(hotelId: string, before: Date, message: string, now: Date): Promise<number>;
  };
  visits: {
    /** The visit bound to this platform session that has not ended and is not past its time, or null. */
    activeForSession(sessionId: string, now: Date): Promise<VisitSessionRecord | null>;
    /** Ends every open visit bound to this session (sign-out, or the session ended); `live` = it had not run out yet, so a hotel_exited row is due. */
    endForSession(sessionId: string, reason: "signed_out" | "session_ended", by: string | null, now: Date): Promise<{ id: string; hotelId: string; live: boolean }[]>;
  };
  /** The "Set up your hotel" checklist of a hotel that came through approval (platform.hotel_setup). */
  hotelSetup: {
    /** Inside a unit's transaction (a failed statement is contained so the transaction stays usable). */
    get(hotelId: string): Promise<HotelSetupRecord | null>;
    /** The same row on `read` (no transaction): a plain SELECT; a database without the table yet (migration 0110) simply has no checklist. */
    find(hotelId: string): Promise<HotelSetupRecord | null>;
    /** Made at approval; a second call changes nothing. */
    create(hotelId: string): Promise<void>;
    /** Saves the whole state (the row is locked by the caller's unit); `doneAt` is set exactly when the status is final. */
    save(hotelId: string, next: { status: HotelSetupStatus; steps: Record<string, string>; hidden: boolean; updatedBy: string; doneAt: Date | null }): Promise<HotelSetupRecord>;
  };
}

/** One API access key as stored (the key itself is not: only its keyed hash, which is what `byHash` looks up). */
export interface ApiTokenRecord {
  id: string;
  name: string;
  level: "read" | "full" | "ai";
  scope: "platform" | "hotel" | "all";
  hotelId: string | null;
  /** While on, a call with this key never sends real mail. */
  testMode: boolean;
  /** The most calls a minute. */
  callsPerMinute: number;
  /** When not empty, the only addresses that may use the key. */
  ipAllow: string[];
  /** The addresses the key was used from (the newest 20). */
  ipSeen: string[];
  /** The Super Admin whose account the key acts through. */
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** The whole row (the console's list and the in-memory double): the record plus what the list shows. `tokenHash` is the keyed hash, never the key. */
export interface ApiTokenRow extends ApiTokenRecord {
  tokenHash: string;
  /** "hms_pat_ab12": tells tokens apart in the list. */
  prefix: string;
  /** Why a full key was made. */
  reason: string | null;
  /** Why test mode was turned off for this key (a key in test mode has none). */
  testModeOffReason: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastIp: string | null;
  /** The UTC day (YYYY-MM-DD) the count below belongs to. */
  callsDay: string | null;
  callsCount: number;
  revokedBy: string | null;
}

/** What the console gives to make a key: the keyed hash and display prefix (never the key), and the choices the form made. */
export type ApiTokenInsert = Pick<ApiTokenRow, "name" | "tokenHash" | "prefix" | "level" | "scope" | "hotelId" | "ipAllow" | "reason" | "testMode" | "testModeOffReason" | "callsPerMinute" | "createdBy" | "expiresAt">;

/** The Super Admin's switch for FULL keys (platform.api_access_settings): off until turned on, with who and why. */
export interface ApiAccessSettings {
  fullAccessEnabled: boolean;
  changedBy: string | null;
  changedAt: Date | null;
  reason: string | null;
}

/** A hotel as the public website API and the website settings see it. */
export interface HotelSiteRecord {
  hotelId: string;
  slug: string;
  name: string;
  status: string;
  city: string | null;
  state: string | null;
  live: boolean;
  domains: string[];
}

export type SiteBuildStatus = "queued" | "building" | "live" | "failed";

/** One go at giving a hotel's website a design: asked for, then built by the "Create hotel site" job. `live` rows are what the hotel runs; the newest is the current one. */
export interface SiteBuildRecord {
  id: string;
  hotelId: string;
  /** A folder name under website-templates/templates: template-1 .. template-10, or a hotel's own custom one. */
  templateKey: string;
  status: SiteBuildStatus;
  /** What the job said (a plain sentence, at most 500 characters), most often why it failed. */
  message: string | null;
  /** The job's log page (https). */
  runUrl: string | null;
  /** The address the site went live on (https). */
  siteUrl: string | null;
  requestedBy: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

type HotelSetupStatus = "pending" | "in_progress" | "done" | "skipped";
export interface HotelSetupRecord {
  hotelId: string;
  status: HotelSetupStatus;
  steps: Record<string, string>;
  hidden: boolean;
  doneAt: Date | null;
}

/** One transaction on the platform data. */
export interface PlatformUnit {
  run<T>(work: (repos: AuthRepos) => Promise<T>): Promise<T>;
  /** One statement with no BEGIN / COMMIT around it (two fewer waits for the database): never a write, a locking read, or reads that must agree with one another. */
  read<T>(work: (repos: AuthRepos) => Promise<T>): Promise<T>;
}
