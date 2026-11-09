import "server-only";
import { changePerson } from "./personWrites";
import { assertMailRoute } from "../../mail/routes";
// The PostgreSQL implementation of the platform's sign-in repositories (repos/auth.ts): users, codes, sessions, outbox, events, audit and the
// access loader, all in the `platform` schema, read and written as hms_app (migration 0099_grants.sql lists exactly what that login may do).
// The in-memory double (repos/memory/auth.ts) obeys the same rules; tests/db/auth.repo.test.ts runs the same scenarios against both.
import { foldRoleGrants } from "../../auth/access";
import type { Grant, UserOverride } from "../../auth/permissions";
import type { RecordScope } from "../../auth/session";
import type { ClientPool } from "../../../db/withHotel";
import { classifyPgError } from "../../db/pgErrors";
import { hmacHex } from "../../crypto/hash";
import type { RateLimitStore } from "../../http/limits";
import type { SqlClient } from "../../../db/types";
import type { AccessRecord, ApiTokenRow, AuthCodeRecord, AuthRepos, HotelRecord, HotelSiteRecord, HotelSetupRecord, MailHoldRecord, OutboxRecord, PlatformUnit, RoleRecord, SenderIdentityRecord, SessionRecord, SiteBuildRecord, SuppressionRecord, UserRecord } from "../auth";
import { RepoError } from "../types";
import { inTestMode } from "../../runtime/testMode";
import { createPlatformUnit } from "./platformUnit";
import { asDate } from "./shared";

const when = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const must = (v: unknown): Date => when(v) as Date;

const USER_COLUMNS = "id, username, email, mobile, display_name, password_hash, role_id, account_role, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until, blocked_at, blocked_kind, code_required, last_login_at, deleted_at";
/** The sign-in columns live in the shared login directory (platform.logins, 0142 and 0144); the rest of the person stays in platform.users. */
const CREDENTIAL_COLUMNS = new Set(["password_hash", "status", "must_change_password", "temp_password_at", "password_changed_at", "failed_attempts", "lock_level", "locked_until", "blocked_at", "blocked_kind", "code_required", "last_login_at"]);
/** The person as one record: the sign-in columns from the login (l), the name from the person's role table (p). `l` and `p` are the aliases of USER_FROM. */
const PROFILE_COLUMNS = new Set<string>();
// temp_password_at (platform 0193) is read through to_jsonb, so a database without the column answers null
const USER_SELECT = `${USER_COLUMNS.split(", ").map((c) => (c === "display_name" ? "COALESCE(p.display_name, l.username) AS display_name" : CREDENTIAL_COLUMNS.has(c) || c === "deleted_at" || c === "email" || c === "mobile" ? `l.${c}` : PROFILE_COLUMNS.has(c) ? `p.${c}` : c === "account_role" ? "l.role_type AS account_role" : `l.${c}`)).join(", ")}, to_jsonb(l) ->> 'temp_password_at' AS temp_password_at`;
const USER_FROM = "platform.logins l LEFT JOIN platform.login_profiles p ON p.login_id = l.id";
const SITE_SQL = `SELECT h.id, h.slug, h.name, h.status, h.city, h.state, coalesce(s.live, false) AS live,
       coalesce(ARRAY(SELECT d.domain FROM platform.hotel_site_domains d WHERE d.hotel_id = h.id ORDER BY d.domain), ARRAY[]::text[]) AS domains
  FROM platform.hotels h LEFT JOIN platform.hotel_sites s ON s.hotel_id = h.id`;
const siteOf = (res: { rows: Record<string, unknown>[] }): HotelSiteRecord | null => {
  const r = res.rows[0];
  return r ? { hotelId: String(r.id), slug: String(r.slug), name: String(r.name), status: String(r.status), city: (r.city as string | null) ?? null, state: (r.state as string | null) ?? null, live: r.live === true, domains: (r.domains as string[]) ?? [] } : null;
};
const SITE_BUILD_COLUMNS = "id, hotel_id, template_key, status, message, run_url, site_url, requested_by, created_at, started_at, finished_at";
const siteBuildOf = (r: Record<string, unknown>): SiteBuildRecord => ({
  id: String(r.id), hotelId: String(r.hotel_id), templateKey: String(r.template_key), status: r.status as SiteBuildRecord["status"],
  message: (r.message as string | null) ?? null, runUrl: (r.run_url as string | null) ?? null, siteUrl: (r.site_url as string | null) ?? null,
  requestedBy: r.requested_by ? String(r.requested_by) : null, requestedAt: must(r.created_at), startedAt: when(r.started_at), finishedAt: when(r.finished_at),
});
const userOf = (r: Record<string, unknown>): UserRecord => ({
  id: String(r.id),
  username: String(r.username),
  email: (r.email as string | null) ?? null,
  mobile: (r.mobile as string | null) ?? null,
  displayName: String(r.display_name),
  passwordHash: String(r.password_hash),
  roleId: String(r.role_id),
  accountRole: r.account_role as UserRecord["accountRole"],
  status: r.status as UserRecord["status"],
  mustChangePassword: r.must_change_password === true,
  tempPasswordAt: when(r.temp_password_at),
  passwordChangedAt: when(r.password_changed_at),
  failedAttempts: Number(r.failed_attempts),
  lockLevel: Number(r.lock_level),
  lockedUntil: when(r.locked_until),
  blockedAt: when(r.blocked_at),
  blockedKind: (r.blocked_kind as UserRecord["blockedKind"]) ?? null,
  codeRequired: r.code_required === true,
  lastLoginAt: when(r.last_login_at),
  deletedAt: when(r.deleted_at),
});

const USER_PATCH: Record<string, string> = {
  username: "username", email: "email", mobile: "mobile", displayName: "display_name", passwordHash: "password_hash", roleId: "role_id", accountRole: "account_role",
  status: "status", mustChangePassword: "must_change_password", tempPasswordAt: "temp_password_at", passwordChangedAt: "password_changed_at", failedAttempts: "failed_attempts", lockLevel: "lock_level",
  lockedUntil: "locked_until", blockedAt: "blocked_at", blockedKind: "blocked_kind", codeRequired: "code_required", lastLoginAt: "last_login_at", deletedAt: "deleted_at",
};
const CODE_PATCH: Record<string, string> = { codeHash: "code_hash", expiresAt: "expires_at", usedAt: "used_at", attempts: "attempts", resendCount: "resend_count", lastSentAt: "last_sent_at", createdAt: "created_at" };

const CODE_COLUMNS = "id, purpose, user_id, code_hash, expires_at, used_at, attempts, resend_count, last_sent_at, created_at";
const codeOf = (r: Record<string, unknown>): AuthCodeRecord => ({
  id: String(r.id),
  purpose: r.purpose as AuthCodeRecord["purpose"],
  userId: String(r.user_id),
  codeHash: String(r.code_hash),
  expiresAt: must(r.expires_at),
  usedAt: when(r.used_at),
  attempts: Number(r.attempts),
  resendCount: Number(r.resend_count),
  lastSentAt: must(r.last_sent_at),
  createdAt: must(r.created_at),
});

const SESSION_COLUMNS = "id, user_id, hotel_id, client, token_hash, device_label, user_agent, host(ip) AS ip, issued_at, last_seen_at, expires_at, revoked_at, revoked_reason";
const sessionOf = (r: Record<string, unknown>): SessionRecord => ({
  id: String(r.id),
  userId: String(r.user_id),
  hotelId: (r.hotel_id as string | null) ?? null,
  client: r.client as SessionRecord["client"],
  tokenHash: String(r.token_hash),
  deviceLabel: (r.device_label as string | null) ?? null,
  userAgent: (r.user_agent as string | null) ?? null,
  ip: (r.ip as string | null) ?? null,
  issuedAt: must(r.issued_at),
  lastSeenAt: when(r.last_seen_at),
  expiresAt: must(r.expires_at),
  revokedAt: when(r.revoked_at),
  revokedReason: (r.revoked_reason as SessionRecord["revokedReason"]) ?? null,
  lockedAt: r.locked_at === undefined || r.locked_at === null ? null : new Date(r.locked_at as string),
  recheckedAt: r.rechecked_at === undefined || r.rechecked_at === null ? null : new Date(r.rechecked_at as string),
});

const OUTBOX_COLUMNS = "id, user_id, hotel_id, kind, to_email, template, payload, status, attempts, next_attempt_at, sent_at, created_at, NULL::text AS last_error";
const OUTBOX_COLUMNS_0124 = "id, user_id, hotel_id, kind, to_email, template, payload, status, attempts, next_attempt_at, sent_at, created_at, last_error";
/** Before platform migration 0118 (no hotel_id column): the same rows with hotel_id read as NULL, so a database not yet migrated keeps sending mail. */
const OUTBOX_COLUMNS_PRE_0118 = "id, user_id, NULL::uuid AS hotel_id, kind, to_email, template, payload, status, attempts, next_attempt_at, sent_at, created_at, NULL::text AS last_error";
const outboxOf = (r: Record<string, unknown>): OutboxRecord => ({
  id: String(r.id),
  userId: (r.user_id as string | null) ?? null,
  hotelId: (r.hotel_id as string | null) ?? null,
  kind: r.kind as OutboxRecord["kind"],
  toEmail: String(r.to_email),
  template: String(r.template),
  payload: (r.payload as string | null) ?? null,
  status: r.status as OutboxRecord["status"],
  attempts: Number(r.attempts),
  nextAttemptAt: must(r.next_attempt_at),
  sentAt: when(r.sent_at),
  createdAt: must(r.created_at),
  lastError: (r.last_error as string | null) ?? null,
});

/** A rule the database enforces (a CHECK or a UNIQUE index) becomes the same RepoError the in-memory double throws; anything else is a bug and stays as it is. */
async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const info = classifyPgError(error);
    if (info.kind === "unique" || info.kind === "check") throw new RepoError(info.kind, info.constraint ?? "database rule");
    throw error;
  }
}

/** SET clause and parameters for a partial update; only names in `columns` are accepted (never a name from outside). */
function setClause(patch: object, columns: Record<string, string>, first: number): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = columns[key];
    if (!column) throw new Error("Not an updatable field");
    params.push(value);
    parts.push(`${column} = $${first + params.length - 1}`);
  }
  return { sql: parts.join(", "), params };
}

/** One row of the ladder read: a role (its id, hotel, key, level, inherits) and one of its grants, or none (LEFT JOIN). The same shape whether read as rows or as json_agg. */
interface LadderRow {
  id: unknown;
  hotel_id: unknown;
  key: unknown;
  level: unknown;
  inherits: unknown;
  grant_key?: unknown;
  grant_level?: unknown;
}

/** The ladder and every rung's grants, as one SELECT list (the `r` and `p`/`rp` aliases of LADDER_FROM). */
const LADDER_COLUMNS = "r.id, r.hotel_id, r.key, r.level, r.inherits, p.key AS grant_key, rp.level AS grant_level";
const LADDER_FROM = "FROM platform.roles r LEFT JOIN platform.role_permissions rp ON rp.role_id = r.id LEFT JOIN platform.permissions p ON p.id = rp.permission_id";
/** The same ladder folded into one json column (for the one-statement session read): every rung as a LadderRow object. */
const LADDER_JSON = `json_agg(json_build_object('id', r.id, 'hotel_id', r.hotel_id, 'key', r.key, 'level', r.level, 'inherits', r.inherits, 'grant_key', p.key, 'grant_level', rp.level))`;

/**
 * The chosen role (by id, or a built-in one by key) and its grants folded over the ladder of built-in roles and the hotel's own (auth/access.ts foldRoleGrants).
 * Pure: the same fold whether the rows came as a result set or as a json column. null when the role is not on the ladder (a custom role of another hotel, or gone).
 */
export function foldLadder(rows: readonly LadderRow[], pick: { roleId: string | null } | { builtInKey: string }): { role: RoleRecord; grants: Grant[] } | null {
  const ladderById = new Map<string, RoleRecord>();
  const byRole = new Map<string, Grant[]>();
  for (const r of rows) {
    const id = String(r.id);
    if (!ladderById.has(id)) ladderById.set(id, { id, hotelId: (r.hotel_id as string | null) ?? null, key: String(r.key), level: Number(r.level), inherits: r.inherits === true });
    if (r.grant_key !== null && r.grant_key !== undefined) {
      const list = byRole.get(id) ?? [];
      list.push({ key: String(r.grant_key), level: r.grant_level as Grant["level"] });
      byRole.set(id, list);
    }
  }
  const ladder = [...ladderById.values()];
  const role = "builtInKey" in pick ? ladder.find((r) => r.hotelId === null && r.key === pick.builtInKey) : ladder.find((r) => r.id === pick.roleId);
  if (!role) return null;
  return { role, grants: foldRoleGrants(role, ladder, (id) => byRole.get(id) ?? []) };
}

/** The columns of `row` that start with `prefix`, with the prefix taken off (a joined row read by the plain mappers). */
const unprefixed = (row: Record<string, unknown>, prefix: string): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));

/** A hotel row with its first group (the `<p>id`, `<p>name`, ... names of a hotel LATERAL), or null when the hotel column is null. */
const hotelOf = (r: Record<string, unknown>, p: string): HotelRecord | null =>
  r[`${p}id`] ? { id: String(r[`${p}id`]), name: String(r[`${p}name`]), group: r[`${p}group_id`] ? { id: String(r[`${p}group_id`]), name: String(r[`${p}group_name`]) } : null, status: r[`${p}status`] as HotelRecord["status"], state: (r[`${p}state`] as string | null) ?? null } : null;

const GROUP_LATERAL = "LEFT JOIN LATERAL (SELECT hg.id, hg.name FROM platform.group_members gm JOIN platform.hotel_groups hg ON hg.id = gm.group_id AND hg.deleted_at IS NULL AND hg.kind = 'group' WHERE gm.hotel_id = h.id ORDER BY gm.created_at LIMIT 1) g ON true";

/**
 * The one-statement session read (access.loadBySession): the session by its token hash, its person, their membership in the session's hotel (the LATERAL of
 * access.load), the role ladder with grants and the person's overrides for that hotel as json columns, and, for a platform, super or group account only, the
 * live visit bound to the session (visits.activeForSession; the 0135 `access` column read through to_jsonb so a database without it answers 'view') with the
 * visited hotel (access.loadVisit) and that hotel's ladder. One row or none. $1 = the token hash, $2 = now.
 */
const LOAD_BY_SESSION_SQL = `
  SELECT s.id AS s_id, s.user_id AS s_user_id, s.hotel_id AS s_hotel_id, s.client AS s_client, s.token_hash AS s_token_hash, s.device_label AS s_device_label, s.user_agent AS s_user_agent,
         host(s.ip) AS s_ip, s.issued_at AS s_issued_at, s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at, s.revoked_reason AS s_revoked_reason,
         to_jsonb(s) ->> 'locked_at' AS s_locked_at, to_jsonb(s) ->> 'rechecked_at' AS s_rechecked_at,
         (SELECT st.value FROM platform.platform_settings st WHERE st.key = 'security.session_minutes') AS session_limits,
         ${USER_SELECT},
         m.m_hotel_id, m.m_role_id, m.m_subject_id, m.m_subject_kind, m.m_hotel_name, m.m_hotel_status, m.m_hotel_state, m.m_group_id, m.m_group_name,
         (SELECT ${LADDER_JSON} ${LADDER_FROM} WHERE l.id IS NOT NULL AND (r.hotel_id IS NULL OR r.hotel_id = m.m_hotel_id)) AS ladder,
         (SELECT json_agg(json_build_object('key', p.key, 'level', up.level, 'granted', up.granted))
            FROM platform.user_permissions up JOIN platform.permissions p ON p.id = up.permission_id WHERE up.user_id = l.id AND up.hotel_id = m.m_hotel_id) AS overrides,
         v.v_id, v.v_hotel_id, v.v_hotel_name, v.v_expires_at, v.v_access,
         vh.vh_id, vh.vh_name, vh.vh_status, vh.vh_state, vh.vh_group_id, vh.vh_group_name,
         (SELECT ${LADDER_JSON} ${LADDER_FROM} WHERE vh.vh_id IS NOT NULL AND (r.hotel_id IS NULL OR r.hotel_id = vh.vh_id)) AS visit_ladder
    FROM platform.sessions s
    LEFT JOIN (platform.logins l LEFT JOIN platform.login_profiles p ON p.login_id = l.id) ON l.id = s.user_id AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT uh.hotel_id AS m_hotel_id, uh.role_id AS m_role_id, uh.subject_id AS m_subject_id, uh.subject_kind AS m_subject_kind, h.name AS m_hotel_name, h.status AS m_hotel_status, h.state AS m_hotel_state,
             g.id AS m_group_id, g.name AS m_group_name
        FROM platform.user_hotels uh
        JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL
        ${GROUP_LATERAL}
       WHERE uh.user_id = l.id AND uh.status = 'active' AND (s.hotel_id IS NULL OR uh.hotel_id = s.hotel_id)
       ORDER BY uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT v.id AS v_id, v.hotel_id AS v_hotel_id, h.name AS v_hotel_name, v.expires_at AS v_expires_at, COALESCE(to_jsonb(v)->>'access', 'view') AS v_access
        FROM platform.hotel_visits v JOIN platform.hotels h ON h.id = v.hotel_id AND h.deleted_at IS NULL
       WHERE l.role_type IN ('platform_admin', 'super_admin', 'group_hotel_admin') AND v.session_id = s.id AND v.ended_at IS NULL AND v.expires_at > $2::timestamptz
       LIMIT 1
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT h.id AS vh_id, h.name AS vh_name, h.status AS vh_status, h.state AS vh_state, g.id AS vh_group_id, g.name AS vh_group_name
        FROM platform.hotels h
        ${GROUP_LATERAL}
       WHERE h.id = v.v_hotel_id AND h.deleted_at IS NULL AND h.status <> 'deleted'
    ) vh ON true
   WHERE s.token_hash = $1`;

const setupOf = (r: Record<string, unknown>): HotelSetupRecord => ({
  hotelId: String(r.hotel_id),
  status: String(r.status) as HotelSetupRecord["status"],
  steps: (typeof r.steps === "string" ? JSON.parse(r.steps) : (r.steps ?? {})) as Record<string, string>,
  hidden: r.hidden === true,
  doneAt: asDate(r.done_at),
});

// Platform migration 0126 (mail_send_counts, hotel_mail_limits) applied? Asked once and remembered when yes; asked again at most once a minute when no, so a live database that has not run it
// yet keeps sending (no daily caps and no counts until the tables are there).
let mailTablesReady = false;
let mailTablesAskedAt = 0;
// The same for platform migration 0128 (sender_identities).
let identityTableReady = false;
let identityTableAskedAt = 0;
// The same for platform migration 0130 (mail_suppressions, hotel_mail_holds, mail_campaign_runs, the bounce and complaint counts).
let safetyTablesReady = false;
let safetyTablesAskedAt = 0;
// The same for platform migration 0136 (mail_event_receipts: the webhooks' repeated deliveries).
let receiptsTableReady = false;
let receiptsTableAskedAt = 0;
// Is platform migration 0118 (outbox.hotel_id) applied? Asked once per process and remembered (here, at module scope: pgAuthRepos is built anew for every unit,
// so a closure would ask once per transaction), so a live database that has not run it yet still queues and sends every mail (through the platform sender);
// the hotel's own mail server is used as soon as the column is there.
let outboxHasHotel: Promise<boolean> | null = null;
// The same for platform migration 0124 (outbox.last_error): until it is applied a failed mail simply keeps no reason.
let outboxHasError: Promise<boolean> | null = null;
/** Webhook receipts are kept this long (a repeated delivery later than this is long past SNS's signature window and Brevo's retries). */
const RECEIPT_DAYS = 7;

const SUPPRESSION_COLUMNS = "id, email, hotel_id, reason, source, detail, created_by, created_at";
const suppressionOf = (x: Record<string, unknown>): SuppressionRecord => ({
  id: String(x.id),
  email: String(x.email),
  hotelId: x.hotel_id === null || x.hotel_id === undefined ? null : String(x.hotel_id),
  reason: x.reason as SuppressionRecord["reason"],
  source: x.source as SuppressionRecord["source"],
  detail: (x.detail as string | null) ?? null,
  createdBy: (x.created_by as string | null) ?? null,
  createdAt: must(x.created_at),
});
const HOLD_COLUMNS = "hotel_id, reason, detail, held_at, held_by, released_at, released_by, release_reason, counted_from";
const holdOf = (x: Record<string, unknown>): MailHoldRecord => ({
  hotelId: String(x.hotel_id),
  reason: x.reason as MailHoldRecord["reason"],
  detail: String(x.detail),
  heldAt: must(x.held_at),
  heldBy: (x.held_by as string | null) ?? null,
  releasedAt: when(x.released_at),
  releasedBy: (x.released_by as string | null) ?? null,
  releaseReason: (x.release_reason as string | null) ?? null,
  countedFrom: when(x.counted_from),
});

const identityOf = (x: Record<string, unknown>): SenderIdentityRecord => ({
  scope: x.hotel_id === null || x.hotel_id === undefined ? "platform" : String(x.hotel_id),
  domain: String(x.domain),
  fromAddress: x.from_address === null || x.from_address === undefined ? null : String(x.from_address),
  dkimTokens: Array.isArray(x.dkim_tokens) ? x.dkim_tokens.map(String) : [],
  sesConfirmed: x.ses_confirmed === true,
  status: x.status === "verified" ? "verified" : "pending",
  checkedAt: asDate(x.checked_at),
  result: x.result && typeof x.result === "object" ? (x.result as SenderIdentityRecord["result"]) : null,
});
const IDENTITY_COLUMNS = "hotel_id, domain, from_address, dkim_tokens, ses_confirmed, status, checked_at, result";

export function pgAuthRepos(db: SqlClient): AuthRepos {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);
  const hotelColumn = (): Promise<boolean> =>
    (outboxHasHotel ??= q("SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'outbox' AND column_name = 'hotel_id'")
      .then((r) => r.rows.length > 0)
      .catch(() => {
        outboxHasHotel = null;
        return false;
      }));
  const errorColumn = (): Promise<boolean> =>
    (outboxHasError ??= q("SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'outbox' AND column_name = 'last_error'")
      .then((r) => r.rows.length > 0)
      .catch(() => {
        outboxHasError = null;
        return false;
      }));
  const mailTables = async (): Promise<boolean> => {
    if (mailTablesReady) return true;
    if (Date.now() - mailTablesAskedAt < 60_000) return false;
    mailTablesAskedAt = Date.now();
    try {
      const r = await q("SELECT (to_regclass('platform.mail_send_counts') IS NOT NULL AND to_regclass('platform.hotel_mail_limits') IS NOT NULL) AS ready");
      mailTablesReady = r.rows[0]?.ready === true;
    } catch {
      mailTablesReady = false;
    }
    return mailTablesReady;
  };
  const identityTable = async (): Promise<boolean> => {
    if (identityTableReady) return true;
    if (Date.now() - identityTableAskedAt < 60_000) return false;
    identityTableAskedAt = Date.now();
    try {
      identityTableReady = (await q("SELECT to_regclass('platform.sender_identities') IS NOT NULL AS ready")).rows[0]?.ready === true;
    } catch {
      identityTableReady = false;
    }
    return identityTableReady;
  };
  const safetyTables = async (): Promise<boolean> => {
    if (safetyTablesReady) return true;
    if (Date.now() - safetyTablesAskedAt < 60_000) return false;
    safetyTablesAskedAt = Date.now();
    try {
      safetyTablesReady = (await q("SELECT (to_regclass('platform.mail_suppressions') IS NOT NULL AND to_regclass('platform.hotel_mail_holds') IS NOT NULL AND to_regclass('platform.mail_campaign_runs') IS NOT NULL) AS ready")).rows[0]?.ready === true;
    } catch {
      safetyTablesReady = false;
    }
    return safetyTablesReady;
  };
  const receiptsTable = async (): Promise<boolean> => {
    if (receiptsTableReady) return true;
    if (Date.now() - receiptsTableAskedAt < 60_000) return false;
    receiptsTableAskedAt = Date.now();
    try {
      receiptsTableReady = (await q("SELECT to_regclass('platform.mail_event_receipts') IS NOT NULL AS ready")).rows[0]?.ready === true;
    } catch {
      receiptsTableReady = false;
    }
    return receiptsTableReady;
  };
  const outboxColumns = async (): Promise<string> => ((await hotelColumn()) ? ((await errorColumn()) ? OUTBOX_COLUMNS_0124 : OUTBOX_COLUMNS) : OUTBOX_COLUMNS_PRE_0118);

  /**
   * What a person holds in a hotel: the chosen role (by id, or a built-in one by key), its grants folded over the ladder of built-in roles and the hotel's
   * own, and, when asked, the person's own grants and revokes there. null when the role is not there (a custom role of another hotel, or gone).
   */
  const accessIn = async (user: UserRecord, hotel: HotelRecord | null, roleId: string | null, builtInKey: string | null, scope: RecordScope | undefined, withOverrides: boolean): Promise<AccessRecord | null> => {
    // the role ladder and every rung's grants in one read (this runs on every request)
    const rows = await q(`SELECT ${LADDER_COLUMNS} ${LADDER_FROM} WHERE r.hotel_id IS NULL OR r.hotel_id = $1::uuid`, [hotel?.id ?? null]);
    const folded = foldLadder(rows.rows as unknown as LadderRow[], builtInKey ? { builtInKey } : { roleId });
    if (!folded) return null;
    const overrides: UserOverride[] =
      withOverrides && hotel
        ? (await q("SELECT p.key, up.level, up.granted FROM platform.user_permissions up JOIN platform.permissions p ON p.id = up.permission_id WHERE up.user_id = $1 AND up.hotel_id = $2", [user.id, hotel.id])).rows.map((r) => ({
            key: String(r.key), level: r.level as Grant["level"], granted: r.granted === true,
          }))
        : [];
    return { user, hotel, role: folded.role, grants: folded.grants, overrides, ...(scope ? { scope } : {}) };
  };

  return {
    users: {
      async byUsername(lowerName) {
        // the username is stored once, in the shared login directory (platform.logins, migration 0142); the person is then read by that id
        const r = await q(`SELECT ${USER_SELECT} FROM ${USER_FROM} WHERE l.username = $1 AND l.deleted_at IS NULL AND l.deleted_at IS NULL`, [lowerName]);
        return r.rows[0] ? userOf(r.rows[0]) : null;
      },
      async byEmail(lowerEmail) {
        const r = await q(`SELECT ${USER_SELECT} FROM ${USER_FROM} WHERE l.email = $1 AND l.deleted_at IS NULL`, [lowerEmail]);
        return r.rows[0] ? userOf(r.rows[0]) : null;
      },
      async byId(id, options) {
        const r = await q(`SELECT ${USER_SELECT} FROM ${USER_FROM} WHERE l.id = $1${options?.forUpdate ? " FOR UPDATE OF l" : ""}`, [id]);
        return r.rows[0] ? userOf(r.rows[0]) : null;
      },
      async update(id, patch) {
        // the sign-in fields are written to the shared login directory (platform.logins); the rest of the person through platform.change_person (the role table, the core and the contact guard)
        const own: Record<string, unknown> = {};
        const login: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) (CREDENTIAL_COLUMNS.has(USER_PATCH[k] ?? "") ? login : own)[k] = v;
        const set = setClause(own, USER_PATCH, 2);
        const loginSet = setClause(login, USER_PATCH, 2);
        if (set.sql === "" && loginSet.sql === "") return;
        let touched = 0;
        if (loginSet.sql !== "") touched = (await guard(q(`UPDATE platform.logins SET ${loginSet.sql} WHERE id = $1`, [id, ...loginSet.params]))).affectedRows;
        if (set.sql !== "") touched = (await guard(changePerson(q, id, Object.fromEntries(Object.entries(own).map(([k, v]) => [USER_PATCH[k] as string, v]))))) ? 1 : 0;
        if (touched === 0) throw new RepoError("check", "no such user");
      },
    },
    codes: {
      async byId(id) {
        const r = await q(`SELECT ${CODE_COLUMNS} FROM platform.auth_codes WHERE id = $1`, [id]);
        return r.rows[0] ? codeOf(r.rows[0]) : null;
      },
      async byHash(purpose, hash, options) {
        const r = await q(`SELECT ${CODE_COLUMNS} FROM platform.auth_codes WHERE purpose = $1 AND code_hash = $2${options?.forUpdate ? " FOR UPDATE" : ""}`, [purpose, hash]);
        return r.rows[0] ? codeOf(r.rows[0]) : null;
      },
      async replace(row, now) {
        await q("UPDATE platform.auth_codes SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [row.userId, row.purpose, now]);
        const r = await guard(
          q(`INSERT INTO platform.auth_codes (purpose, user_id, code_hash, expires_at, last_sent_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CODE_COLUMNS}`, [row.purpose, row.userId, row.codeHash, row.expiresAt, row.lastSentAt, now]),
        );
        return codeOf(r.rows[0]);
      },
      async update(id, patch) {
        const set = setClause(patch, CODE_PATCH, 2);
        if (set.sql === "") return;
        const r = await guard(q(`UPDATE platform.auth_codes SET ${set.sql} WHERE id = $1`, [id, ...set.params]));
        if (r.affectedRows === 0) throw new RepoError("check", "no such code");
      },
    },
    sessions: {
      async insert(row) {
        const r = await guard(
          q(
            `INSERT INTO platform.sessions (user_id, hotel_id, client, token_hash, device_label, user_agent, ip, issued_at, last_seen_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9, $10) RETURNING ${SESSION_COLUMNS}`,
            [row.userId, row.hotelId, row.client, row.tokenHash, row.deviceLabel, row.userAgent, row.ip, row.issuedAt, row.lastSeenAt, row.expiresAt],
          ),
        );
        return sessionOf(r.rows[0]);
      },
      async byTokenHash(hash) {
        const r = await q(`SELECT ${SESSION_COLUMNS} FROM platform.sessions WHERE token_hash = $1`, [hash]);
        return r.rows[0] ? sessionOf(r.rows[0]) : null;
      },
      async update(id, patch) {
        const set = setClause(patch, { lastSeenAt: "last_seen_at", expiresAt: "expires_at" }, 2);
        if (set.sql === "") return;
        await guard(q(`UPDATE platform.sessions SET ${set.sql} WHERE id = $1`, [id, ...set.params]));
      },
      async setLocked(id, at) {
        await q("UPDATE platform.sessions SET locked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [id, at]);
      },
      async setRechecked(id, at) {
        await q("UPDATE platform.sessions SET rechecked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [id, at]);
      },
      async listActive(userId, now) {
        const r = await q(`SELECT ${SESSION_COLUMNS} FROM platform.sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY issued_at DESC`, [userId, now]);
        return r.rows.map(sessionOf);
      },
      async revokeOthers(userId, exceptSessionId, reason, now) {
        const r = await q("UPDATE platform.sessions SET revoked_at = $4, revoked_reason = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [userId, exceptSessionId, reason, now]);
        return r.affectedRows;
      },
      async revokeById(id, reason, now) {
        await q("UPDATE platform.sessions SET revoked_at = $3, revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [id, reason, now]);
      },
      async revokeActive(userId, reason, now) {
        const r = await q("UPDATE platform.sessions SET revoked_at = $3, revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, reason, now]);
        return r.affectedRows;
      },
    },
    outbox: {
      async enqueue(row, now) {
        assertMailRoute(row.kind, row.hotelId);
        // a call made with an API key in test mode (runtime/testMode.ts): the mail is checked as usual but never queued, so it is never sent
        if (inTestMode()) return;
        if (await hotelColumn()) {
          await guard(
            q("INSERT INTO platform.outbox (user_id, hotel_id, kind, to_email, template, payload, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)", [row.userId, row.hotelId ?? null, row.kind, row.toEmail, row.template, row.payload, now]),
          );
        } else {
          await guard(q("INSERT INTO platform.outbox (user_id, kind, to_email, template, payload, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [row.userId, row.kind, row.toEmail, row.template, row.payload, now]));
        }
      },
      async claimDue(now, limit) {
        // A row left 'sending' by a stopped server may or may not have gone out; it is never sent again (a code must not arrive twice), so after ten minutes it
        // is closed as failed, and its payload (the code) goes with it.
        await q("UPDATE platform.outbox SET status = 'failed', payload = NULL WHERE status = 'sending' AND updated_at < $1::timestamptz - interval '10 minutes'", [now]);
        const r = await q(
          `UPDATE platform.outbox SET status = 'sending' WHERE id IN (
             SELECT id FROM platform.outbox WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
           ) RETURNING ${await outboxColumns()}`,
          [now, limit],
        );
        return r.rows.map(outboxOf);
      },
      async claimLane(now, lane, limit, hotelId) {
        // the predicates are written exactly as the partial indexes of migration 0126 are (kind = 'campaign' / kind <> 'campaign'), so each lane reads its own small index
        const kindSql = lane === "bulk" ? "kind = 'campaign'" : "kind <> 'campaign'";
        const params: unknown[] = [now, limit];
        let hotelSql = "";
        if (lane === "bulk" && hotelId !== undefined) {
          params.push(hotelId);
          hotelSql = " AND hotel_id = $3";
        }
        const r = await q(
          `UPDATE platform.outbox SET status = 'sending' WHERE id IN (
             SELECT id FROM platform.outbox WHERE status = 'pending' AND next_attempt_at <= $1 AND ${kindSql}${hotelSql} ORDER BY next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
           ) RETURNING ${await outboxColumns()}`,
          params,
        );
        return r.rows.map(outboxOf);
      },
      async bulkHotels(now) {
        if (!(await hotelColumn())) return [];
        // a "skip scan" over outbox_due_bulk_idx (hotel_id, next_attempt_at, id) WHERE status = 'pending' AND kind = 'campaign': one index probe per hotel instead of
        // counting every waiting row (with 50,000 waiting the old count read the whole outbox on every pass; MAIL-LOAD-REPORT F2). In hotel id order: the pass shares the
        // batch evenly, so no "most waiting first" is needed.
        const r = await q(
          `WITH RECURSIVE h AS (
             (SELECT hotel_id FROM platform.outbox WHERE status = 'pending' AND kind = 'campaign' AND hotel_id IS NOT NULL AND next_attempt_at <= $1 ORDER BY hotel_id LIMIT 1)
             UNION ALL
             SELECT (SELECT o.hotel_id FROM platform.outbox o WHERE o.status = 'pending' AND o.kind = 'campaign' AND o.hotel_id > h.hotel_id AND o.next_attempt_at <= $1 ORDER BY o.hotel_id LIMIT 1)
               FROM h WHERE h.hotel_id IS NOT NULL
           )
           SELECT hotel_id FROM h WHERE hotel_id IS NOT NULL LIMIT 200`,
          [now],
        );
        return r.rows.map((x) => String(x.hotel_id));
      },
      async sentToday(scopes, day) {
        const out = new Map<string, number>();
        if (scopes.length === 0 || !(await mailTables())) return out;
        const r = await q("SELECT scope, sent FROM platform.mail_send_counts WHERE day = $1::date AND scope = ANY($2::text[])", [day, scopes]);
        for (const x of r.rows) out.set(String(x.scope), Number(x.sent));
        return out;
      },
      async addSent(entries) {
        if (entries.length === 0 || !(await mailTables())) return;
        await q(
          `INSERT INTO platform.mail_send_counts (scope, day, sent) SELECT * FROM unnest($1::text[], $2::date[], $3::int[])
             ON CONFLICT (scope, day) DO UPDATE SET sent = platform.mail_send_counts.sent + EXCLUDED.sent`,
          [entries.map((e) => e.scope), entries.map((e) => e.day), entries.map((e) => e.sent)],
        );
      },
      async setCap(hotelId, cap) {
        if (!(await mailTables())) return false;
        if (cap === null) await q("DELETE FROM platform.hotel_mail_limits WHERE hotel_id = $1", [hotelId]);
        else await q("INSERT INTO platform.hotel_mail_limits (hotel_id, daily_cap) VALUES ($1, $2) ON CONFLICT (hotel_id) DO UPDATE SET daily_cap = EXCLUDED.daily_cap", [hotelId, cap]);
        return true;
      },
      async usage(fromDay, toDay, scopes) {
        const out = new Map<string, number>();
        if (scopes.length === 0 || !(await mailTables())) return out;
        const r = await q("SELECT scope, sum(sent)::int AS sent FROM platform.mail_send_counts WHERE day >= $1::date AND day < $2::date AND scope = ANY($3::text[]) GROUP BY scope", [fromDay, toDay, scopes]);
        for (const x of r.rows) out.set(String(x.scope), Number(x.sent));
        return out;
      },
      async caps(hotelIds) {
        const out = new Map<string, number>();
        if (hotelIds.length === 0 || !(await mailTables())) return out;
        const r = await q("SELECT hotel_id, daily_cap FROM platform.hotel_mail_limits WHERE hotel_id = ANY($1::uuid[])", [hotelIds]);
        for (const x of r.rows) out.set(String(x.hotel_id), Number(x.daily_cap));
        return out;
      },
      async countByTemplate(hotelId, templates) {
        const out = new Map<string, { pending: number; sent: number; failed: number }>();
        if (templates.length === 0) return out;
        const r = await q(
          `SELECT template, COUNT(*) FILTER (WHERE status = 'sent') AS sent, COUNT(*) FILTER (WHERE status = 'failed') AS failed, COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) AS pending
             FROM platform.outbox WHERE hotel_id = $1 AND kind = 'campaign' AND template = ANY($2::text[]) GROUP BY template`,
          [hotelId, templates],
        );
        for (const row of r.rows) out.set(String(row.template), { pending: Number(row.pending), sent: Number(row.sent), failed: Number(row.failed) });
        return out;
      },
      async finish(id, outcome) {
        // the one-time code only ever lives in the payload: it goes as soon as the mail is sent or has failed for good
        if (await errorColumn()) {
          await guard(
            q(
              `UPDATE platform.outbox SET status = $2, attempts = $3, next_attempt_at = COALESCE($4, next_attempt_at), sent_at = COALESCE($5, sent_at), last_error = $6::text,
                 payload = CASE WHEN $2 = 'pending' THEN payload ELSE NULL END WHERE id = $1`,
              [id, outcome.status, outcome.attempts, outcome.nextAttemptAt ?? null, outcome.sentAt ?? null, outcome.status === "sent" ? null : (outcome.error ?? null)],
            ),
          );
          return;
        }
        await guard(
          q(
            `UPDATE platform.outbox SET status = $2, attempts = $3, next_attempt_at = COALESCE($4, next_attempt_at), sent_at = COALESCE($5, sent_at),
               payload = CASE WHEN $2 = 'pending' THEN payload ELSE NULL END WHERE id = $1`,
            [id, outcome.status, outcome.attempts, outcome.nextAttemptAt ?? null, outcome.sentAt ?? null],
          ),
        );
      },
      async lastFailure(hotelId) {
        if (!(await errorColumn())) return null;
        const r = await q("SELECT status, last_error, updated_at FROM platform.outbox WHERE hotel_id = $1 AND (status = 'sent' OR last_error IS NOT NULL) ORDER BY updated_at DESC, id DESC LIMIT 1", [hotelId]);
        const row = r.rows[0];
        return row && row.status !== "sent" && row.last_error ? { code: String(row.last_error), at: must(row.updated_at) } : null;
      },
      async bulkWaiting(hotelIds) {
        const out = new Map<string, number>();
        if (hotelIds.length === 0 || !(await hotelColumn())) return out;
        const r = await q("SELECT hotel_id, count(*)::int AS n FROM platform.outbox WHERE status IN ('pending', 'sending') AND kind = 'campaign' AND hotel_id = ANY($1::uuid[]) GROUP BY hotel_id", [hotelIds]);
        for (const x of r.rows) out.set(String(x.hotel_id), Number(x.n));
        return out;
      },
      async cancelTemplate(hotelId, template) {
        const r = (await errorColumn())
          ? await q("UPDATE platform.outbox SET status = 'failed', payload = NULL, last_error = 'CANCELLED' WHERE hotel_id = $1 AND template = $2 AND kind = 'campaign' AND status = 'pending'", [hotelId, template])
          : await q("UPDATE platform.outbox SET status = 'failed', payload = NULL WHERE hotel_id = $1 AND template = $2 AND kind = 'campaign' AND status = 'pending'", [hotelId, template]);
        return r.affectedRows;
      },
      async hotelOf(id) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
        const r = await q(`SELECT ${(await hotelColumn()) ? "hotel_id" : "NULL::uuid AS hotel_id"} FROM platform.outbox WHERE id = $1`, [id]);
        if (!r.rows[0]) return undefined;
        return (r.rows[0].hotel_id as string | null) ?? null;
      },
      async lastHotelMailedTo(email, since) {
        if (!(await hotelColumn())) return null;
        const r = await q("SELECT hotel_id FROM platform.outbox WHERE lower(to_email) = $1 AND status = 'sent' AND hotel_id IS NOT NULL AND sent_at >= $2 ORDER BY sent_at DESC LIMIT 1", [email.trim().toLowerCase(), since]);
        return r.rows[0] ? String(r.rows[0].hotel_id) : null;
      },
    },
    mailSafety: {
      ready: () => safetyTables(),
      async receive(provider, keys, now) {
        const wanted = [...new Set(keys)];
        if (wanted.length === 0 || !(await receiptsTable())) return new Set(wanted);
        await q("DELETE FROM platform.mail_event_receipts WHERE received_at < $1", [new Date(now.getTime() - RECEIPT_DAYS * 86_400_000)]);
        // ON CONFLICT DO NOTHING: only a key not received before comes back (two deliveries at once: one of them wins)
        const r = await guard(q("INSERT INTO platform.mail_event_receipts (provider, event_key, received_at) SELECT $1, k, $3 FROM unnest($2::text[]) AS k ON CONFLICT DO NOTHING RETURNING event_key", [provider, wanted, now]));
        return new Set(r.rows.map((x) => String(x.event_key)));
      },
      async suppress(row, now) {
        if (!(await safetyTables())) return false;
        const r = await guard(
          q(
            `INSERT INTO platform.mail_suppressions (email, hotel_id, reason, source, detail, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
               ON CONFLICT (email, COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
            [row.email.trim().toLowerCase(), row.hotelId, row.reason, row.source, row.detail, row.createdBy, now],
          ),
        );
        return r.affectedRows > 0;
      },
      async unsuppress(id) {
        if (!(await safetyTables())) return null;
        const r = await q(`DELETE FROM platform.mail_suppressions WHERE id = $1 RETURNING ${SUPPRESSION_COLUMNS}`, [id]);
        return r.rows[0] ? suppressionOf(r.rows[0]) : null;
      },
      async suppressions(query) {
        if (!(await safetyTables())) return [];
        const params: unknown[] = [];
        const where: string[] = [];
        if (query.search) {
          params.push(`%${query.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
          where.push(`email LIKE $${params.length}`);
        }
        if (query.before) {
          params.push(query.before.at, query.before.id);
          where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
        }
        params.push(query.limit);
        const r = await q(`SELECT ${SUPPRESSION_COLUMNS} FROM platform.mail_suppressions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
        return r.rows.map(suppressionOf);
      },
      async suppressedAmong(hotelId, emails) {
        const out = new Set<string>();
        if (emails.length === 0 || !(await safetyTables())) return out;
        const r = await q("SELECT DISTINCT email FROM platform.mail_suppressions WHERE email = ANY($2::text[]) AND (hotel_id IS NULL OR hotel_id = $1)", [hotelId, emails.map((e) => e.trim().toLowerCase())]);
        for (const x of r.rows) out.add(String(x.email));
        return out;
      },
      async addEvents(entries) {
        if (entries.length === 0 || !(await safetyTables())) return;
        await q(
          `INSERT INTO platform.mail_send_counts (scope, day, sent, bounced, complained) SELECT s, d, 0, b, c FROM unnest($1::text[], $2::date[], $3::int[], $4::int[]) AS e(s, d, b, c)
             ON CONFLICT (scope, day) DO UPDATE SET bounced = platform.mail_send_counts.bounced + EXCLUDED.bounced, complained = platform.mail_send_counts.complained + EXCLUDED.complained`,
          [entries.map((e) => e.scope), entries.map((e) => e.day), entries.map((e) => e.bounced), entries.map((e) => e.complained)],
        );
      },
      async rates(hotelId, fromDay) {
        if (!(await safetyTables())) return { sent: 0, bounced: 0, complained: 0 };
        const r = await q("SELECT coalesce(sum(sent), 0)::int AS sent, coalesce(sum(bounced), 0)::int AS bounced, coalesce(sum(complained), 0)::int AS complained FROM platform.mail_send_counts WHERE scope = $1 AND day >= $2::date", [hotelId, fromDay]);
        const x = r.rows[0] ?? {};
        return { sent: Number(x.sent ?? 0), bounced: Number(x.bounced ?? 0), complained: Number(x.complained ?? 0) };
      },
      async hold(hotelId) {
        if (!(await safetyTables())) return null;
        const r = await q(`SELECT ${HOLD_COLUMNS} FROM platform.hotel_mail_holds WHERE hotel_id = $1`, [hotelId]);
        return r.rows[0] ? holdOf(r.rows[0]) : null;
      },
      async holds() {
        if (!(await safetyTables())) return [];
        const r = await q(`SELECT ${HOLD_COLUMNS} FROM platform.hotel_mail_holds ORDER BY (released_at IS NULL) DESC, held_at DESC LIMIT 200`);
        return r.rows.map(holdOf);
      },
      async heldAmong(hotelIds) {
        const out = new Set<string>();
        if (hotelIds.length === 0 || !(await safetyTables())) return out;
        const r = await q("SELECT hotel_id FROM platform.hotel_mail_holds WHERE released_at IS NULL AND hotel_id = ANY($1::uuid[])", [hotelIds]);
        for (const x of r.rows) out.add(String(x.hotel_id));
        return out;
      },
      async putOnHold(row, now) {
        if (!(await safetyTables())) return false;
        // a released row is held again (its counted_from stays: the rates were counted from the release); a held one is left as it is
        const r = await guard(
          q(
            `INSERT INTO platform.hotel_mail_holds (hotel_id, reason, detail, held_at, held_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $4, $4)
               ON CONFLICT (hotel_id) DO UPDATE SET reason = EXCLUDED.reason, detail = EXCLUDED.detail, held_at = EXCLUDED.held_at, held_by = EXCLUDED.held_by,
                 released_at = NULL, released_by = NULL, release_reason = NULL
               WHERE platform.hotel_mail_holds.released_at IS NOT NULL`,
            [row.hotelId, row.reason, row.detail, now, row.heldBy],
          ),
        );
        return r.affectedRows > 0;
      },
      async release(hotelId, by, reason, now) {
        if (!(await safetyTables())) return false;
        const r = await guard(q("UPDATE platform.hotel_mail_holds SET released_at = $2, released_by = $3, release_reason = $4, counted_from = $2 WHERE hotel_id = $1 AND released_at IS NULL", [hotelId, now, by, reason]));
        return r.affectedRows > 0;
      },
    },
    campaignRuns: {
      async start(hotelId, campaignId, now) {
        if (!(await safetyTables())) return;
        await q("INSERT INTO platform.mail_campaign_runs (hotel_id, campaign_id, state, started_at, updated_at) VALUES ($1, $2, 'sending', $3, $3) ON CONFLICT (hotel_id, campaign_id) DO UPDATE SET state = 'sending'", [hotelId, campaignId, now]);
      },
      async setState(hotelId, campaignId, state) {
        if (!(await safetyTables())) return;
        await q("UPDATE platform.mail_campaign_runs SET state = $3 WHERE hotel_id = $1 AND campaign_id = $2", [hotelId, campaignId, state]);
      },
      async end(hotelId, campaignId) {
        if (!(await safetyTables())) return;
        await q("DELETE FROM platform.mail_campaign_runs WHERE hotel_id = $1 AND campaign_id = $2", [hotelId, campaignId]);
      },
      async active() {
        if (!(await safetyTables())) return [];
        const r = await q("SELECT hotel_id, campaign_id, state, started_at FROM platform.mail_campaign_runs ORDER BY started_at, campaign_id LIMIT 500");
        return r.rows.map((x) => ({ hotelId: String(x.hotel_id), campaignId: String(x.campaign_id), state: x.state as "sending" | "paused", startedAt: must(x.started_at) }));
      },
    },
    identities: {
      async get(scope) {
        if (!(await identityTable())) return null;
        const r = scope === "platform" ? await q(`SELECT ${IDENTITY_COLUMNS} FROM platform.sender_identities WHERE hotel_id IS NULL`) : await q(`SELECT ${IDENTITY_COLUMNS} FROM platform.sender_identities WHERE hotel_id = $1`, [scope]);
        return r.rows[0] ? identityOf(r.rows[0]) : null;
      },
      async list() {
        if (!(await identityTable())) return [];
        return (await q(`SELECT ${IDENTITY_COLUMNS} FROM platform.sender_identities ORDER BY hotel_id NULLS FIRST, domain`)).rows.map(identityOf);
      },
      async save(scope, patch) {
        if (!(await identityTable())) return null;
        const hotelId = scope === "platform" ? null : scope;
        const existing = await (hotelId === null ? q(`SELECT ${IDENTITY_COLUMNS} FROM platform.sender_identities WHERE hotel_id IS NULL FOR UPDATE`) : q(`SELECT ${IDENTITY_COLUMNS} FROM platform.sender_identities WHERE hotel_id = $1 FOR UPDATE`, [hotelId]));
        const old = existing.rows[0] ? identityOf(existing.rows[0]) : null;
        if (!old && patch.domain === undefined) throw new RepoError("check", "sender_identities_domain");
        // a new domain starts again: the old DKIM names, confirmation and check do not describe it
        const fresh = !old || (patch.domain !== undefined && patch.domain !== old.domain);
        const next = {
          domain: patch.domain ?? old!.domain,
          fromAddress: patch.fromAddress !== undefined ? patch.fromAddress : (old?.fromAddress ?? null),
          dkimTokens: patch.dkimTokens ?? (fresh ? [] : old!.dkimTokens),
          sesConfirmed: patch.sesConfirmed ?? (fresh ? false : old!.sesConfirmed),
          status: patch.status ?? (fresh ? "pending" : old!.status),
          checkedAt: patch.checkedAt !== undefined ? patch.checkedAt : (fresh ? null : old!.checkedAt),
          result: patch.result !== undefined ? patch.result : (fresh ? null : old!.result),
        };
        const params = [next.domain, next.fromAddress, next.dkimTokens, next.sesConfirmed, next.status, next.checkedAt, next.result === null ? null : JSON.stringify(next.result)];
        const r = old
          ? await guard(q(`UPDATE platform.sender_identities SET domain = $1, from_address = $2, dkim_tokens = $3::text[], ses_confirmed = $4, status = $5, checked_at = $6, result = $7::jsonb WHERE ${hotelId === null ? "hotel_id IS NULL" : "hotel_id = $8"} RETURNING ${IDENTITY_COLUMNS}`, hotelId === null ? params : [...params, hotelId]))
          : await guard(q(`INSERT INTO platform.sender_identities (domain, from_address, dkim_tokens, ses_confirmed, status, checked_at, result, hotel_id) VALUES ($1, $2, $3::text[], $4, $5, $6, $7::jsonb, $8) RETURNING ${IDENTITY_COLUMNS}`, [...params, hotelId]));
        return identityOf(r.rows[0]);
      },
      async remove(scope) {
        if (!(await identityTable())) return;
        if (scope === "platform") await q("DELETE FROM platform.sender_identities WHERE hotel_id IS NULL");
        else await q("DELETE FROM platform.sender_identities WHERE hotel_id = $1", [scope]);
      },
    },
    events: {
      async event(row) {
        await q("INSERT INTO platform.auth_events (user_id, hotel_id, event, ip, user_agent, detail, at) VALUES ($1, $2, $3, $4::inet, $5, $6::jsonb, $7)", [
          row.userId, row.hotelId, row.event, row.ip, row.userAgent, row.detail === null ? null : JSON.stringify(row.detail), row.at,
        ]);
      },
      async audit(row) {
        await q("INSERT INTO platform.audit_log (actor_user_id, hotel_id, action, entity, entity_id, trace_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
          row.actorUserId, row.hotelId, row.action, row.entity, row.entityId, row.traceId, row.at,
        ]);
      },
    },
    access: {
      async load(userId, hotelId): Promise<AccessRecord | null> {
        // the person and their membership in one read (this runs on every request); the membership columns carry an m_ prefix
        const u = await q(
          `SELECT ${USER_SELECT}, m.m_hotel_id, m.m_role_id, m.m_subject_id, m.m_subject_kind, m.m_hotel_name, m.m_hotel_status, m.m_hotel_state, m.m_group_id, m.m_group_name
             FROM ${USER_FROM}
             LEFT JOIN LATERAL (
               SELECT uh.hotel_id AS m_hotel_id, uh.role_id AS m_role_id, uh.subject_id AS m_subject_id, uh.subject_kind AS m_subject_kind, h.name AS m_hotel_name, h.status AS m_hotel_status, h.state AS m_hotel_state,
                      g.id AS m_group_id, g.name AS m_group_name
                 FROM platform.user_hotels uh
                 JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL
                 LEFT JOIN LATERAL (SELECT hg.id, hg.name FROM platform.group_members gm JOIN platform.hotel_groups hg ON hg.id = gm.group_id AND hg.deleted_at IS NULL AND hg.kind = 'group' WHERE gm.hotel_id = h.id ORDER BY gm.created_at LIMIT 1) g ON true
                WHERE uh.user_id = $1 AND uh.status = 'active' AND ($2::uuid IS NULL OR uh.hotel_id = $2::uuid)
                  AND l.role_type NOT IN ('super_admin', 'platform_admin', 'group_hotel_admin')
                ORDER BY (h.status = 'active') DESC, uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1
             ) m ON true
            WHERE l.id = $1 AND l.deleted_at IS NULL`,
          [userId, hotelId],
        );
        if (!u.rows[0]) return null;
        const user = userOf(u.rows[0]);
        const row = u.rows[0];
        const m = row.m_hotel_id
          ? { hotel_id: row.m_hotel_id, role_id: row.m_role_id, subject_id: row.m_subject_id, subject_kind: row.m_subject_kind, hotel_name: row.m_hotel_name, hotel_status: row.m_hotel_status, hotel_state: row.m_hotel_state, group_id: row.m_group_id, group_name: row.m_group_name }
          : undefined;
        if (hotelId && !m) return null;
        const hotel: HotelRecord | null = m
          ? { id: String(m.hotel_id), name: String(m.hotel_name), group: m.group_id ? { id: String(m.group_id), name: String(m.group_name) } : null, status: m.hotel_status as HotelRecord["status"], state: (m.hotel_state as string | null) ?? null }
          : null;

        const scope: RecordScope | undefined = m?.subject_id ? { kind: m.subject_kind as RecordScope["kind"], id: String(m.subject_id) } : undefined;
        return accessIn(user, hotel, (m?.role_id as string | null) ?? user.roleId, null, scope, true);
      },
      async loadBySession(tokenHash, at) {
        const r = await q(LOAD_BY_SESSION_SQL, [tokenHash, at.toISOString()]);
        const row = r.rows[0];
        if (!row) return null;
        const session = sessionOf(unprefixed(row, "s_"));
        const sessionLimits = row.session_limits ?? null;
        // the person (u.*): gone or deleted = no access, as `load` answers
        if (!row.id) return { session, access: null, visit: null, visitAccess: null, sessionLimits };
        const user = userOf(row);
        const hotel = hotelOf({ ...row, m_id: row.m_hotel_id, m_name: row.m_hotel_name, m_status: row.m_hotel_status, m_state: row.m_hotel_state }, "m_");
        let access: AccessRecord | null = null;
        // a session opened in a hotel the person is no longer a member of has no access (load's `hotelId && !m`)
        if (!(session.hotelId && !hotel)) {
          const folded = foldLadder((row.ladder as LadderRow[] | null) ?? [], { roleId: (row.m_role_id as string | null) ?? user.roleId });
          const scope: RecordScope | undefined = row.m_subject_id ? { kind: row.m_subject_kind as RecordScope["kind"], id: String(row.m_subject_id) } : undefined;
          const overrides: UserOverride[] = ((row.overrides as { key: unknown; level: unknown; granted: unknown }[] | null) ?? []).map((o) => ({ key: String(o.key), level: o.level as Grant["level"], granted: o.granted === true }));
          if (folded) access = { user, hotel, role: folded.role, grants: folded.grants, overrides, ...(scope ? { scope } : {}) };
        }
        const visit = row.v_id ? { id: String(row.v_id), hotelId: String(row.v_hotel_id), hotelName: String(row.v_hotel_name), expiresAt: asDate(row.v_expires_at) as Date, access: row.v_access === "full" ? ("full" as const) : ("view" as const) } : null;
        let visitAccess: AccessRecord | null = null;
        const visited = visit ? hotelOf(row, "vh_") : null;
        if (visited) {
          // the hotel's built-in SuperAdmin permission role; no personal grants, no record scope (as `loadVisit`)
          const folded = foldLadder((row.visit_ladder as LadderRow[] | null) ?? [], { builtInKey: "super_admin" });
          if (folded) visitAccess = { user, hotel: visited, role: folded.role, grants: folded.grants, overrides: [] };
        }
        return { session, access, visit, visitAccess, sessionLimits };
      },
      async security() {
        const r = await q("SELECT key, value FROM platform.platform_settings WHERE key IN ('security.session_minutes', 'security.temp_password_minutes')");
        const by = new Map(r.rows.map((x) => [String(x.key), x.value as unknown]));
        return { sessionMinutes: by.get("security.session_minutes") ?? null, tempPasswordMinutes: by.get("security.temp_password_minutes") ?? null };
      },
      async portalHotels(userId, kind) {
        const r = await q(
          `SELECT uh.hotel_id, h.name, uh.subject_id
             FROM platform.user_hotels uh
             JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL AND h.status = 'active'
            WHERE uh.user_id = $1 AND uh.status = 'active' AND uh.subject_kind = $2 AND uh.subject_id IS NOT NULL
            ORDER BY lower(h.name), h.id`,
          [userId, kind],
        );
        return r.rows.map((x) => ({ hotelId: String(x.hotel_id), hotelName: String(x.name), subjectId: String(x.subject_id) }));
      },
      async entryHotelId(slug) {
        const r = await q(
          `SELECT h.id FROM platform.hotels h JOIN platform.hotel_sites s ON s.hotel_id = h.id AND s.live
            WHERE h.slug = $1 AND h.deleted_at IS NULL AND h.status = 'active'`,
          [slug],
        );
        return r.rows[0] ? String(r.rows[0].id) : null;
      },
      async adminGroup(userId) {
        const r = await q(
          `SELECT g.id, g.name, g.status FROM platform.hotel_groups g
            WHERE g.admin_user_id = $1 AND g.deleted_at IS NULL AND g.kind = 'group'
            ORDER BY g.created_at, g.id LIMIT 1`,
          [userId],
        );
        const g = r.rows[0];
        return g ? { id: String(g.id), name: String(g.name), status: String(g.status) } : null;
      },
      async loadVisit(userId, hotelId): Promise<AccessRecord | null> {
        const u = await q(`SELECT ${USER_SELECT} FROM ${USER_FROM} WHERE l.id = $1 AND l.deleted_at IS NULL`, [userId]);
        if (!u.rows[0]) return null;
        const h = await q(
          `SELECT h.id, h.name, h.status, h.state, g.id AS group_id, g.name AS group_name
             FROM platform.hotels h
             LEFT JOIN LATERAL (SELECT hg.id, hg.name FROM platform.group_members gm JOIN platform.hotel_groups hg ON hg.id = gm.group_id AND hg.deleted_at IS NULL AND hg.kind = 'group' WHERE gm.hotel_id = h.id ORDER BY gm.created_at LIMIT 1) g ON true
            WHERE h.id = $1 AND h.deleted_at IS NULL AND h.status <> 'deleted'`,
          [hotelId],
        );
        const r = h.rows[0];
        if (!r) return null;
        const hotel: HotelRecord = { id: String(r.id), name: String(r.name), group: r.group_id ? { id: String(r.group_id), name: String(r.group_name) } : null, status: r.status as HotelRecord["status"], state: (r.state as string | null) ?? null };
        // the hotel's built-in SuperAdmin permission role; no personal grants, no record scope
        return accessIn(userOf(u.rows[0]), hotel, null, "super_admin", undefined, false);
      },
    },
    sites: {
      async bySlug(slug) {
        return siteOf(await q(`${SITE_SQL} WHERE h.slug = $1 AND h.deleted_at IS NULL`, [slug]));
      },
      async byHotel(hotelId) {
        return siteOf(await q(`${SITE_SQL} WHERE h.id = $1 AND h.deleted_at IS NULL`, [hotelId]));
      },
      async byDomain(host) {
        return siteOf(await q(`${SITE_SQL} WHERE h.deleted_at IS NULL AND h.id = (SELECT hotel_id FROM platform.hotel_site_domains WHERE domain = $1)`, [host]));
      },
      async save(hotelId, next, by) {
        const domains = [...next.domains];
        const taken = await q("SELECT domain FROM platform.hotel_site_domains WHERE domain = ANY($1::text[]) AND hotel_id <> $2 ORDER BY domain", [domains, hotelId]);
        if (taken.rows.length > 0) return { taken: taken.rows.map((r) => String(r.domain)) };
        await q("INSERT INTO platform.hotel_sites (hotel_id, live, updated_by) VALUES ($1, $2, $3) ON CONFLICT (hotel_id) DO UPDATE SET live = EXCLUDED.live, updated_by = EXCLUDED.updated_by", [hotelId, next.live, by]);
        await q("DELETE FROM platform.hotel_site_domains WHERE hotel_id = $1 AND NOT (domain = ANY($2::text[]))", [hotelId, domains]);
        for (const domain of domains) await q("INSERT INTO platform.hotel_site_domains (domain, hotel_id) VALUES ($1, $2) ON CONFLICT (domain) DO NOTHING", [domain, hotelId]);
        return { taken: [] };
      },
    },
    siteBuilds: {
      async byId(id) {
        const r = await q(`SELECT ${SITE_BUILD_COLUMNS} FROM platform.hotel_site_builds WHERE id = $1`, [id]);
        return r.rows[0] ? siteBuildOf(r.rows[0]) : null;
      },
      async recent(hotelId, limit) {
        const r = await q(`SELECT ${SITE_BUILD_COLUMNS} FROM platform.hotel_site_builds WHERE hotel_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [hotelId, limit]);
        return r.rows.map(siteBuildOf);
      },
      async queue(hotelId, templateKey, by, now) {
        // ON CONFLICT DO NOTHING covers the partial unique index (one queued or building build per hotel) without aborting the transaction
        const r = await q(
          `INSERT INTO platform.hotel_site_builds (hotel_id, template_key, requested_by, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING ${SITE_BUILD_COLUMNS}`,
          [hotelId, templateKey, by, now],
        );
        return r.rows[0] ? siteBuildOf(r.rows[0]) : null;
      },
      async advance(id, next, now) {
        const final = next.status !== "building";
        const r = await q(
          `UPDATE platform.hotel_site_builds
              SET status = $2, message = $3, run_url = coalesce($4, run_url), site_url = coalesce($5, site_url),
                  started_at = coalesce(started_at, $6), finished_at = CASE WHEN $7 THEN $6 ELSE finished_at END
            WHERE id = $1 AND status = ANY($8::text[])
        RETURNING ${SITE_BUILD_COLUMNS}`,
          [id, next.status, next.message, next.runUrl, next.siteUrl, now, final, next.status === "building" ? ["queued"] : ["queued", "building"]],
        );
        return r.rows[0] ? siteBuildOf(r.rows[0]) : null;
      },
      async failStale(hotelId, before, message, now) {
        const r = await q(
          `UPDATE platform.hotel_site_builds SET status = 'failed', message = $3, finished_at = $4 WHERE hotel_id = $1 AND status IN ('queued', 'building') AND created_at < $2`,
          [hotelId, before, message, now],
        );
        return r.affectedRows;
      },
    },
    apiTokens: {
      async byHash(hash) {
        const r = await q(
          `SELECT id, name, level, scope_kind, hotel_id, test_mode, calls_per_minute, ip_allow, ip_seen, created_by, expires_at, revoked_at FROM platform.api_tokens WHERE token_hash = $1`,
          [hash],
        );
        const x = r.rows[0];
        if (!x) return null;
        return {
          id: String(x.id), name: String(x.name), level: x.level === "full" ? "full" : x.level === "ai" ? "ai" : "read", testMode: x.test_mode !== false, callsPerMinute: Number(x.calls_per_minute) || 60,
          scope: x.scope_kind === "hotel" ? "hotel" : x.scope_kind === "all" ? "all" : "platform",
          hotelId: x.hotel_id === null ? null : String(x.hotel_id),
          ipAllow: Array.isArray(x.ip_allow) ? x.ip_allow.map(String) : [], ipSeen: Array.isArray(x.ip_seen) ? x.ip_seen.map(String) : [],
          createdBy: String(x.created_by), expiresAt: asDate(x.expires_at) as Date, revokedAt: asDate(x.revoked_at),
        };
      },
      async fullAccessEnabled() {
        const r = await q("SELECT full_access_enabled FROM platform.api_access_settings LIMIT 1");
        return r.rows[0]?.full_access_enabled === true;
      },
      async list() {
        const r = await q(`SELECT ${API_TOKEN_COLUMNS} FROM platform.api_tokens ORDER BY created_at DESC, id DESC LIMIT 200`);
        return r.rows.map(apiTokenRowOf);
      },
      async insert(row, now) {
        const r = await q(
          `INSERT INTO platform.api_tokens (name, token_hash, token_prefix, level, scope_kind, hotel_id, ip_allow, reason, test_mode, test_mode_off_reason, calls_per_minute, created_by, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz) RETURNING ${API_TOKEN_COLUMNS}`,
          [row.name, row.tokenHash, row.prefix, row.level, row.scope, row.hotelId, row.ipAllow, row.reason, row.testMode, row.testModeOffReason, row.callsPerMinute, row.createdBy, now.toISOString(), row.expiresAt.toISOString()],
        );
        return apiTokenRowOf(r.rows[0]);
      },
      async countActive(now) {
        const r = await q("SELECT count(*) AS n FROM platform.api_tokens WHERE revoked_at IS NULL AND expires_at > $1::timestamptz", [now.toISOString()]);
        return Number(r.rows[0]?.n ?? 0);
      },
      async revoke(id, by, now) {
        const r = await q("UPDATE platform.api_tokens SET revoked_at = $3::timestamptz, revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL", [id, by, now.toISOString()]);
        return r.affectedRows > 0;
      },
      async revokeAll(by, now) {
        const r = await q("UPDATE platform.api_tokens SET revoked_at = $2::timestamptz, revoked_by = $1 WHERE revoked_at IS NULL", [by, now.toISOString()]);
        return r.affectedRows;
      },
      async accessSettings() {
        const r = await q("SELECT full_access_enabled, changed_by, changed_at, reason FROM platform.api_access_settings LIMIT 1");
        const x = r.rows[0];
        return { fullAccessEnabled: x?.full_access_enabled === true, changedBy: x?.changed_by ? String(x.changed_by) : null, changedAt: x ? asDate(x.changed_at) : null, reason: x?.reason ? String(x.reason) : null };
      },
      async setFullAccess(enabled, by, reason, now) {
        await q("UPDATE platform.api_access_settings SET full_access_enabled = $1, changed_by = $2, changed_at = $3::timestamptz, reason = $4", [enabled, by, now.toISOString(), reason]);
      },
      async recordUse(id, use) {
        // one UPDATE per call: last use, the day's count (a new UTC day starts at 1), and a new address added to ip_seen (newest 20 kept)
        await q(
          `UPDATE platform.api_tokens SET
             last_used_at = $2::timestamptz,
             last_ip = $4::text,
             calls_count = CASE WHEN calls_day = $3::date THEN calls_count + 1 ELSE 1 END,
             calls_day = $3::date,
             ip_seen = CASE WHEN $4::text IS NULL OR $4::text = ANY(ip_seen) THEN ip_seen
                            ELSE (SELECT coalesce(array_agg(a ORDER BY ord), '{}') FROM (SELECT a, ord FROM unnest(ip_seen || $4::text) WITH ORDINALITY AS t(a, ord) ORDER BY ord DESC LIMIT 20) newest) END
           WHERE id = $1`,
          [id, use.at.toISOString(), use.day, use.ip],
        );
      },
    },
    visits: {
      async endForSession(sessionId, reason, by, now) {
        const r = await q(
          `UPDATE platform.hotel_visits SET ended_at = $2, ended_reason = $3, ended_by = $4 WHERE session_id = $1 AND ended_at IS NULL
           RETURNING id, hotel_id, expires_at > $2 AS live`,
          [sessionId, now.toISOString(), reason, by],
        );
        return r.rows.map((x) => ({ id: String(x.id), hotelId: String(x.hotel_id), live: x.live === true }));
      },
      async activeForSession(sessionId, now) {
        // platform 0135's access column, read through to_jsonb (as loadBySession does) so a database without it answers 'view' with no probe of its own
        const r = await q(
          `SELECT v.id, v.hotel_id, h.name AS hotel_name, v.expires_at, COALESCE(to_jsonb(v)->>'access', 'view') AS access
             FROM platform.hotel_visits v JOIN platform.hotels h ON h.id = v.hotel_id AND h.deleted_at IS NULL
            WHERE v.session_id = $1 AND v.ended_at IS NULL AND v.expires_at > $2::timestamptz LIMIT 1`,
          [sessionId, now.toISOString()],
        );
        const x = r.rows[0];
        return x ? { id: String(x.id), hotelId: String(x.hotel_id), hotelName: String(x.hotel_name), expiresAt: asDate(x.expires_at) as Date, access: x.access === "full" ? "full" : "view" } : null;
      },
    },
    hotelSetup: {
      async get(hotelId) {
        // The checklist is optional and must never break a sign-in: a database that has not run migration 0110 yet (no table, or the table of an
        // earlier version without the `hidden` column) simply has no checklist. The savepoint keeps the unit's transaction usable after that error.
        await q("SAVEPOINT hotel_setup_get");
        try {
          const r = await q("SELECT hotel_id, status, steps, hidden, done_at FROM platform.hotel_setup WHERE hotel_id = $1::uuid", [hotelId]);
          await q("RELEASE SAVEPOINT hotel_setup_get");
          return r.rows[0] ? setupOf(r.rows[0]) : null;
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          if (code !== "42P01" && code !== "42703") throw error;
          await q("ROLLBACK TO SAVEPOINT hotel_setup_get");
          return null;
        }
      },
      async find(hotelId) {
        // outside a transaction (unit.read) a failed statement poisons nothing, so no savepoint: the same two "no checklist yet" errors are simply null
        try {
          const r = await q("SELECT hotel_id, status, steps, hidden, done_at FROM platform.hotel_setup WHERE hotel_id = $1::uuid", [hotelId]);
          return r.rows[0] ? setupOf(r.rows[0]) : null;
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          if (code !== "42P01" && code !== "42703") throw error;
          return null;
        }
      },
      async create(hotelId) {
        await q("INSERT INTO platform.hotel_setup (hotel_id) VALUES ($1::uuid) ON CONFLICT (hotel_id) DO NOTHING", [hotelId]);
      },
      async save(hotelId, next) {
        const r = await q(
          `UPDATE platform.hotel_setup SET status = $2::text, steps = $3::jsonb, hidden = $4::boolean, updated_by = $5::uuid, done_at = $6::timestamptz
            WHERE hotel_id = $1::uuid RETURNING hotel_id, status, steps, hidden, done_at`,
          [hotelId, next.status, JSON.stringify(next.steps), next.hidden, next.updatedBy, next.doneAt ? next.doneAt.toISOString() : null],
        );
        if (!r.rows[0]) throw new Error("hotel_setup: no row for this hotel");
        return setupOf(r.rows[0]);
      },
    },
  };
}

const API_TOKEN_COLUMNS =
  "id, name, token_hash, token_prefix, level, scope_kind, hotel_id, ip_allow, ip_seen, reason, test_mode, test_mode_off_reason, calls_per_minute, created_by, created_at, expires_at, last_used_at, last_ip, calls_day, calls_count, revoked_at, revoked_by";

function apiTokenRowOf(x: Record<string, unknown>): ApiTokenRow {
  const day = x.calls_day instanceof Date ? x.calls_day.toISOString().slice(0, 10) : x.calls_day ? String(x.calls_day).slice(0, 10) : null;
  return {
    id: String(x.id), name: String(x.name), tokenHash: String(x.token_hash), prefix: String(x.token_prefix),
    level: x.level === "full" ? "full" : x.level === "ai" ? "ai" : "read", scope: x.scope_kind === "hotel" ? "hotel" : x.scope_kind === "all" ? "all" : "platform",
    hotelId: x.hotel_id === null ? null : String(x.hotel_id),
    testMode: x.test_mode !== false, testModeOffReason: x.test_mode_off_reason ? String(x.test_mode_off_reason) : null, callsPerMinute: Number(x.calls_per_minute) || 60,
    ipAllow: Array.isArray(x.ip_allow) ? x.ip_allow.map(String) : [], ipSeen: Array.isArray(x.ip_seen) ? x.ip_seen.map(String) : [],
    reason: x.reason ? String(x.reason) : null, createdBy: String(x.created_by), createdAt: asDate(x.created_at) as Date, expiresAt: asDate(x.expires_at) as Date,
    lastUsedAt: asDate(x.last_used_at), lastIp: x.last_ip ? String(x.last_ip) : null, callsDay: day, callsCount: Number(x.calls_count) || 0,
    revokedAt: asDate(x.revoked_at), revokedBy: x.revoked_by ? String(x.revoked_by) : null,
  };
}

export { createPlatformUnit } from "./platformUnit";

/** One transaction on the platform data, as hms_app (no hotel role: the platform schema is the app's own). A failure rolls the whole unit back. */
export function createPgPlatformUnit(pool: ClientPool): PlatformUnit {
  return createPlatformUnit(pool, pgAuthRepos);
}

/** Fixed-window counters in platform.rate_limits: the key is hashed (HMAC with HMS_HASH_KEY), so a leaked table names nobody. One upsert counts, no read-then-write. */
export function createPgRateLimitStore(pool: ClientPool, hashKey: Buffer, now: () => number = Date.now): RateLimitStore {
  const keyHash = (key: string): string => hmacHex(hashKey, "rate-limit", [key]);
  const windowOf = (windowSeconds: number): { start: Date; end: number } => {
    const ms = windowSeconds * 1000;
    const start = Math.floor(now() / ms) * ms;
    return { start: new Date(start), end: start + ms };
  };
  const one = async <T>(text: string, params: unknown[], read: (rows: Record<string, unknown>[]) => T): Promise<T> => {
    const client = await pool.connect();
    try {
      return read((await client.query(text, params)).rows);
    } finally {
      client.release();
    }
  };
  return {
    async hit(key, windowSeconds) {
      const { start, end } = windowOf(windowSeconds);
      const count = await one(
        "INSERT INTO platform.rate_limits (key_hash, window_start) VALUES ($1, $2) ON CONFLICT (key_hash, window_start) DO UPDATE SET count = platform.rate_limits.count + 1 RETURNING count",
        [keyHash(key), start],
        (rows) => Number(rows[0].count),
      );
      return { count, resetInSeconds: Math.max(1, Math.ceil((end - now()) / 1000)) };
    },
    async peek(key, windowSeconds) {
      return one("SELECT count FROM platform.rate_limits WHERE key_hash = $1 AND window_start = $2", [keyHash(key), windowOf(windowSeconds).start], (rows) => (rows[0] ? Number(rows[0].count) : 0));
    },
    async reset(key) {
      await one("DELETE FROM platform.rate_limits WHERE key_hash = $1", [keyHash(key)], () => undefined);
    },
  };
}
