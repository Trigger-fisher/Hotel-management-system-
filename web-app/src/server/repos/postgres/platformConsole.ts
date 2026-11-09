import "server-only";
import { changePerson, createPerson } from "./personWrites";
// The PostgreSQL implementation of the Platform console repositories (repos/platformConsole.ts). Platform schema ONLY, as hms_app, inside one
// platform transaction (no SET ROLE, no hotel schema): every table named here is platform.<name>. The in-memory double
// (repos/memory/platformConsole.ts) is the reference for every rule; the database's CHECKs, unique indexes and append-only triggers back it up.
import { randomBytes } from "node:crypto";
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import type { AccountRole } from "../../auth/session";
import type {
  AnnouncementRow,
  PlatformAnnouncementsRepo,
  HotelMailRow,
  PlatformHotelMailRepo,
  GroupMailRow,
  PlatformGroupMailRepo,
  GroupStatus, HotelBackupRow, HotelExportRow, HotelLifecycleStatus, PlatformAccountRow, PlatformAccountsRepo, PlatformActivityRow, PlatformAuditEntryRow, PlatformAuditRepo, PlatformAuditSearchRepo,
  PlatformConsoleRepos, PlatformConsoleUnit, PlatformBackupsRepo, PlatformExportsRepo, PlatformGroupRow, PlatformGroupsRepo, PlatformHealthRepo, PlatformHotelRow, PlatformHotelsRepo, PlatformSettingsRepo,
  PlatformSignInsRepo, PlatformVisitsRepo, SignInEvent, AdminHotelAccess, PlatformAdminAccessRepo,
} from "../platformConsole";
import { RepoError } from "../types";
import { pgAuthRepos } from "./auth";
import { pgInvitationsRepo, pgOnboardingRepo } from "./platformInvitations";
import { createPlatformUnit } from "./platformUnit";
import { asDate, asText, guard, wordsCondition } from "./shared";

type Row = Record<string, unknown>;

const LISTED = "('active', 'suspended', 'pending_approval', 'rejected', 'archived')";

/** A well-formed Argon2id string of random bytes: the column accepts it and no password can ever match it. The temporary password replaces it. */
const unusableHash = (): string => `$argon2id$v=19$m=19456,t=2,p=1$${randomBytes(12).toString("base64").replace(/=+$/, "")}$${randomBytes(32).toString("base64").replace(/=+$/, "")}`;

/* ---------------------------------------------------------------- hotels */

// $1 = now (for "locked until a later moment")
const HOTEL_SELECT = `
  SELECT h.id, h.name, h.slug, h.city, h.state, h.gstin, h.timezone, h.status, h.created_at, h.provisioned_at, h.submitted_at, h.approved_at,
         h.rejected_at, h.reject_reason, h.suspended_at, h.suspend_reason, h.archived_at, h.archive_reason, h.restore_until, h.status_before_archive,
         h.last_activity_at, g.id AS group_id, g.name AS group_name,
         (SELECT os.invitation_id FROM platform.onboarding_submissions os WHERE os.hotel_id = h.id) AS invitation_id,
         (SELECT COUNT(*) FROM platform.user_hotels uh JOIN platform.people u ON u.id = uh.user_id AND u.deleted_at IS NULL
           WHERE uh.hotel_id = h.id AND u.account_role = 'hotel_admin') AS admin_count,
         (SELECT COUNT(*) FROM platform.user_hotels uh JOIN platform.people u ON u.id = uh.user_id AND u.deleted_at IS NULL
           WHERE uh.hotel_id = h.id AND u.account_role = 'hotel_admin' AND u.status NOT IN ('pending_approval', 'disabled') AND uh.status <> 'disabled'
             AND (u.blocked_at IS NOT NULL OR (u.locked_until IS NOT NULL AND u.locked_until > $1::timestamptz))) AS locked_count
    FROM platform.hotels h
    LEFT JOIN platform.group_members gm ON gm.hotel_id = h.id
    LEFT JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL AND g.kind = 'group'
   WHERE h.deleted_at IS NULL AND h.status IN ${LISTED}`;

const hotelOf = (r: Row): PlatformHotelRow => ({
  id: String(r.id),
  name: String(r.name),
  slug: String(r.slug),
  city: asText(r.city),
  state: asText(r.state),
  gstin: asText(r.gstin),
  timeZone: String(r.timezone),
  status: r.status as HotelLifecycleStatus,
  createdAt: asDate(r.created_at) as Date,
  provisionedAt: asDate(r.provisioned_at),
  submittedAt: asDate(r.submitted_at),
  approvedAt: asDate(r.approved_at),
  rejectedAt: asDate(r.rejected_at),
  rejectReason: asText(r.reject_reason),
  suspendedAt: asDate(r.suspended_at),
  suspendReason: asText(r.suspend_reason),
  archivedAt: asDate(r.archived_at),
  archiveReason: asText(r.archive_reason),
  restoreUntil: asDate(r.restore_until),
  statusBeforeArchive: (asText(r.status_before_archive) as PlatformHotelRow["statusBeforeArchive"]) ?? null,
  lastActivityAt: asDate(r.last_activity_at),
  groupId: asText(r.group_id),
  groupName: asText(r.group_name),
  invitationId: asText(r.invitation_id),
  adminCount: Number(r.admin_count ?? 0),
  lockedAdminCount: Number(r.locked_count ?? 0),
});

const LIFECYCLE_COLUMNS: Record<string, string> = {
  status: "status", suspendedAt: "suspended_at", suspendReason: "suspend_reason", archivedAt: "archived_at", archiveReason: "archive_reason",
  restoreUntil: "restore_until", statusBeforeArchive: "status_before_archive", approvedAt: "approved_at", rejectedAt: "rejected_at", rejectReason: "reject_reason",
};

/* ---------------------------------------------------------------- accounts */

const ACCOUNT_SELECT = `
  SELECT u.id, u.username, u.email, u.mobile, u.display_name, u.account_role, u.status, u.blocked_at, u.locked_until, u.last_login_at, u.created_at,
         COALESCE(u.blocked_at, (SELECT max(e.at) FROM platform.auth_events e WHERE e.user_id = u.id AND e.event = 'account_locked')) AS locked_at,
         m.hotel_id, m.member_status, m.hotel_name, m.hotel_status,
         COALESCE(hg.id, ag.id) AS group_id, COALESCE(hg.name, ag.name) AS group_name, ag.id AS admin_group_id, ag.name AS admin_group_name
    FROM platform.people u
    LEFT JOIN LATERAL (
      SELECT uh.hotel_id, uh.status AS member_status, h.name AS hotel_name, h.status AS hotel_status
        FROM platform.user_hotels uh JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL
       WHERE uh.user_id = u.id
       ORDER BY uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1
    ) m ON true
    LEFT JOIN platform.group_members gm ON gm.hotel_id = m.hotel_id
    LEFT JOIN platform.hotel_groups hg ON hg.id = gm.group_id AND hg.deleted_at IS NULL AND hg.kind = 'group'
    LEFT JOIN LATERAL (
      SELECT g2.id, g2.name FROM platform.hotel_groups g2 WHERE g2.admin_user_id = u.id AND g2.deleted_at IS NULL ORDER BY g2.created_at, g2.id LIMIT 1
    ) ag ON true
   WHERE u.deleted_at IS NULL`;

const accountOf = (r: Row): PlatformAccountRow => ({
  id: String(r.id),
  username: String(r.username),
  email: asText(r.email),
  mobile: asText(r.mobile),
  displayName: String(r.display_name),
  accountRole: r.account_role as AccountRole,
  status: r.status as PlatformAccountRow["status"],
  memberDisabled: r.member_status === "disabled",
  blocked: r.blocked_at !== null && r.blocked_at !== undefined,
  lockedUntil: asDate(r.locked_until),
  lockedAt: asDate(r.locked_at),
  lastLoginAt: asDate(r.last_login_at),
  createdAt: asDate(r.created_at) as Date,
  hotelId: asText(r.hotel_id),
  hotelName: asText(r.hotel_name),
  hotelStatus: (asText(r.hotel_status) as HotelLifecycleStatus | null) ?? null,
  groupId: asText(r.group_id),
  groupName: asText(r.group_name),
  groupAdminOf: r.admin_group_id ? { groupId: String(r.admin_group_id), groupName: String(r.admin_group_name) } : null,
});

/* ---------------------------------------------------------------- groups */

const GROUP_SELECT = `
  SELECT g.id, g.name, g.slug, g.status, g.created_at, g.legal_name, g.gstin, g.address, g.city, g.state, g.pin, g.phone, g.email,
         g.submitted_at, g.approved_at, g.rejected_at, g.reject_reason,
         (SELECT i.id FROM platform.invitations i WHERE i.group_id = g.id AND i.type = 'group' ORDER BY i.created_at DESC, i.id LIMIT 1) AS invitation_id,
         COALESCE((SELECT array_agg(gm.hotel_id::text ORDER BY gm.created_at, gm.hotel_id) FROM platform.group_members gm WHERE gm.group_id = g.id), '{}'::text[]) AS hotel_ids,
         a.id AS admin_id, a.display_name AS admin_name, a.username AS admin_username, a.account_role AS admin_role,
         ah.hotel_id AS admin_hotel_id, ah.hotel_name AS admin_hotel_name
    FROM platform.hotel_groups g
    LEFT JOIN platform.people a ON a.id = g.admin_user_id AND a.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT uh.hotel_id, h.name AS hotel_name
        FROM platform.user_hotels uh JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL
       WHERE uh.user_id = a.id AND a.account_role = 'hotel_admin'
       ORDER BY uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1
    ) ah ON true
   WHERE g.deleted_at IS NULL AND g.kind = 'group'`;

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.startsWith("{") ? v.slice(1, -1).split(",").filter(Boolean) : []);

const groupOf = (r: Row): PlatformGroupRow => ({
  id: String(r.id),
  name: String(r.name),
  slug: String(r.slug),
  status: r.status as GroupStatus,
  admin: r.admin_id
    ? { id: String(r.admin_id), displayName: String(r.admin_name), username: String(r.admin_username), accountRole: r.admin_role as AccountRole, hotelId: asText(r.admin_hotel_id), hotelName: asText(r.admin_hotel_name) }
    : null,
  hotelIds: idsOf(r.hotel_ids),
  createdAt: asDate(r.created_at) as Date,
  legalName: asText(r.legal_name),
  gstin: asText(r.gstin),
  address: asText(r.address),
  city: asText(r.city),
  state: asText(r.state),
  pin: asText(r.pin),
  phone: asText(r.phone),
  email: asText(r.email),
  invitationId: asText(r.invitation_id),
  submittedAt: asDate(r.submitted_at),
  approvedAt: asDate(r.approved_at),
  rejectedAt: asDate(r.rejected_at),
  rejectReason: asText(r.reject_reason),
});

// Platform migration 0133 (hotel_groups.max_hotels) applied? Asked once and remembered when yes, at most once a minute when no: until it is there no limit is read or saved.
let maxColumnReady = false;
let maxColumnAskedAt = 0;

export function pgPlatformConsoleRepos(db: SqlClient): PlatformConsoleRepos {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);
  const maxColumn = async (): Promise<boolean> => {
    if (maxColumnReady) return true;
    if (Date.now() - maxColumnAskedAt < 60_000) return false;
    maxColumnAskedAt = Date.now();
    try {
      maxColumnReady = (await q("SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'hotel_groups' AND column_name = 'max_hotels'")).rows.length > 0;
    } catch {
      maxColumnReady = false;
    }
    return maxColumnReady;
  };

  const hotels: PlatformHotelsRepo = {
    async list(filter, now) {
      const params: unknown[] = [now.toISOString()];
      const where: string[] = [wordsCondition("concat_ws(' ', h.name, h.slug, h.city, h.state, h.gstin, g.name)", filter.words, params)];
      if (filter.groupId) {
        params.push(filter.groupId);
        where.push(`g.id = $${params.length}::uuid`);
      }
      if (filter.createdMonth) {
        params.push(filter.createdMonth);
        where.push(`to_char(h.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $${params.length}::text`);
      }
      const r = await q(`${HOTEL_SELECT} AND ${where.join(" AND ")} ORDER BY lower(h.name) COLLATE "C", h.name COLLATE "C", h.id`, params);
      return r.rows.map(hotelOf);
    },
    async get(id, now, options) {
      const r = await q(`${HOTEL_SELECT} AND h.id = $2::uuid${options?.forUpdate ? " FOR UPDATE OF h" : ""}`, [now.toISOString(), id]);
      return r.rows[0] ? hotelOf(r.rows[0]) : null;
    },
    async setLifecycle(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const column = LIFECYCLE_COLUMNS[key];
        if (!column) throw new Error("Not a lifecycle field");
        params.push(value instanceof Date ? value.toISOString() : value);
        sets.push(`${column} = $${params.length}`);
      }
      const r = await guard(q(`UPDATE platform.hotels SET ${sets.join(", ")} WHERE id = $1 AND deleted_at IS NULL`, params));
      if (r.affectedRows === 0) throw new RepoError("check", "no such hotel");
    },
    async addStatusHistory(row) {
      await guard(
        q(
          "INSERT INTO platform.hotel_status_history (hotel_id, from_status, to_status, changed_by, actor_role, reason, trace_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [row.hotelId, row.fromStatus, row.toStatus, row.changedBy, row.actorRole, row.reason, row.traceId, row.at.toISOString()],
        ),
      );
    },
    async endSessions(hotelId, now) {
      return (await q("UPDATE platform.sessions SET revoked_at = $2, revoked_reason = 'admin' WHERE hotel_id = $1 AND revoked_at IS NULL", [hotelId, now.toISOString()])).affectedRows;
    },
    async onboarding(hotelId) {
      const r = await q("SELECT invitation_id, payload, submitted_at FROM platform.onboarding_submissions WHERE hotel_id = $1", [hotelId]);
      const x = r.rows[0];
      return x ? { invitationId: String(x.invitation_id), payload: (x.payload as Record<string, unknown>) ?? {}, submittedAt: asDate(x.submitted_at) as Date } : null;
    },
    async invitationCounts(now) {
      const r = await q(
        `SELECT COUNT(*) FILTER (WHERE i.status = 'pending' AND EXISTS (
                  SELECT 1 FROM platform.invitation_links l WHERE l.invitation_id = i.id AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > $1::timestamptz)) AS open,
                COUNT(*) FILTER (WHERE i.type = 'group' AND i.status IN ('pending', 'expired')) AS groups_waiting
           FROM platform.invitations i`,
        [now.toISOString()],
      );
      return { open: Number(r.rows[0]?.open ?? 0), groupsWaiting: Number(r.rows[0]?.groups_waiting ?? 0) };
    },
    async slugTaken(slug) {
      return (await q("SELECT 1 AS x FROM platform.hotels WHERE deleted_at IS NULL AND slug = $1 LIMIT 1", [slug])).rows.length > 0;
    },
    async markDeleted(id, now) {
      const r = await guard(q("UPDATE platform.hotels SET status = 'deleted', deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now.toISOString()]));
      if (r.affectedRows === 0) throw new RepoError("check", "no such hotel");
    },
    async defaultGstPercent() {
      const r = await q("SELECT value FROM platform.platform_settings WHERE key = 'new_hotel.gst_percent'");
      const v = Number(r.rows[0]?.value);
      return Number.isFinite(v) ? v : 5;
    },
    async idPhotoExact(id) {
      const r = await q("SELECT id_photo_exact_copy FROM platform.hotels WHERE id = $1 AND deleted_at IS NULL", [id]);
      return r.rows[0]?.id_photo_exact_copy === true;
    },
    async setIdPhotoExact(id, on) {
      const r = await guard(q("UPDATE platform.hotels SET id_photo_exact_copy = $2 WHERE id = $1 AND deleted_at IS NULL", [id, on]));
      if (r.affectedRows === 0) throw new RepoError("check", "no such hotel");
    },
  };

  const accounts: PlatformAccountsRepo = {
    async list(filter, now) {
      void now;
      const params: unknown[] = [[...filter.accountRoles]];
      const where: string[] = ["u.account_role = ANY($1::text[])", wordsCondition("concat_ws(' ', u.display_name, u.username, u.email, u.mobile, m.hotel_name, hg.name, ag.name)", filter.words, params)];
      if (filter.hotelId) {
        params.push(filter.hotelId);
        where.push(`m.hotel_id = $${params.length}::uuid`);
      }
      if (filter.groupId) {
        params.push(filter.groupId);
        where.push(`COALESCE(hg.id, ag.id) = $${params.length}::uuid`);
      }
      const r = await q(`${ACCOUNT_SELECT} AND ${where.join(" AND ")} ORDER BY lower(u.display_name) COLLATE "C", u.display_name COLLATE "C", u.id`, params);
      return r.rows.map(accountOf);
    },
    async get(id, options) {
      // the lock is taken on the login row: the users view reads several tables and cannot itself be locked
      if (options?.forUpdate) await q("SELECT 1 FROM platform.logins WHERE id = $1::uuid FOR UPDATE", [id]);
      const r = await q(`${ACCOUNT_SELECT} AND u.id = $1::uuid`, [id]);
      return r.rows[0] ? accountOf(r.rows[0]) : null;
    },
    async usernameTaken(lowerUsername) {
      return (await q("SELECT 1 AS x FROM platform.people WHERE deleted_at IS NULL AND username = $1 LIMIT 1", [lowerUsername])).rows.length > 0;
    },
    async emailTaken(lowerEmail) {
      return (await q("SELECT 1 AS x FROM platform.people WHERE deleted_at IS NULL AND email = $1 LIMIT 1", [lowerEmail])).rows.length > 0;
    },
    async mobileTaken(mobile) {
      return (await q("SELECT 1 AS x FROM platform.people WHERE deleted_at IS NULL AND mobile = $1 LIMIT 1", [mobile])).rows.length > 0;
    },
    async hotelHasSuperAdmin(hotelId) {
      const r = await q(
        `SELECT 1 AS x FROM platform.user_hotels uh
           JOIN platform.people u ON u.id = uh.user_id AND u.deleted_at IS NULL
           JOIN platform.roles r ON r.id = COALESCE(uh.role_id, u.role_id)
          WHERE uh.hotel_id = $1 AND r.hotel_id IS NULL AND r.key = 'super_admin' LIMIT 1`,
        [hotelId],
      );
      return r.rows.length > 0;
    },
    async holdsOwnerRole(userId, hotelId) {
      const r = await q(
        `SELECT 1 AS x FROM platform.user_hotels uh
           JOIN platform.people u ON u.id = uh.user_id AND u.deleted_at IS NULL
           JOIN platform.roles r ON r.id = COALESCE(uh.role_id, u.role_id)
          WHERE uh.hotel_id = $1 AND uh.user_id = $2 AND r.hotel_id IS NULL AND r.key = 'super_admin' LIMIT 1`,
        [hotelId, userId],
      );
      return r.rows.length > 0;
    },
    async create(fields, by, now) {
      const role = await q("SELECT id FROM platform.roles WHERE hotel_id IS NULL AND key = $1", [fields.roleKey]);
      if (!role.rows[0]) throw new RepoError("check", "no such built-in role");
      const roleId = String(role.rows[0].id);
      const id = await guard(
        createPerson(q, { username: fields.username, email: fields.email, mobile: fields.mobile, display_name: fields.displayName, password_hash: unusableHash(), role_id: roleId, account_role: fields.accountRole, status: "invited", must_change_password: true, code_required: false, created_by: by, created_at: now.toISOString() }),
      );
      if (fields.hotelId) await guard(q("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id, is_default) VALUES ($1, $2, $3, true)", [id, fields.hotelId, roleId]));
      return id;
    },
    async setStatus(id, status, hotelId) {
      if (!(await guard(changePerson(q, id, { status }, true)))) throw new RepoError("check", "no such user");
      if (status === "active" && hotelId) await q("UPDATE platform.user_hotels SET status = 'active' WHERE user_id = $1 AND hotel_id = $2", [id, hotelId]);
    },
    async unlock(id) {
      await q("UPDATE platform.logins SET failed_attempts = 0, lock_level = 0, locked_until = NULL, blocked_at = NULL, blocked_kind = NULL WHERE id = $1", [id]);
    },
    async endSessions(id, now) {
      return (await q("UPDATE platform.sessions SET revoked_at = $2, revoked_reason = 'admin' WHERE user_id = $1 AND revoked_at IS NULL", [id, now.toISOString()])).affectedRows;
    },
    async activeSuperAdmins() {
      const r = await q("SELECT COUNT(*) AS n FROM platform.people WHERE account_role = 'super_admin' AND status = 'active' AND deleted_at IS NULL");
      return Number(r.rows[0]?.n ?? 0);
    },
    async closeOfHotel(hotelId, by, now) {
      const closed = await q(
        `SELECT u.id FROM platform.people u
          WHERE u.deleted_at IS NULL AND u.account_role IN ('hotel_admin', 'hotel_user')
            AND EXISTS (SELECT 1 FROM platform.user_hotels uh WHERE uh.user_id = u.id AND uh.hotel_id = $1)
            AND NOT EXISTS (SELECT 1 FROM platform.user_hotels o JOIN platform.hotels oh ON oh.id = o.hotel_id AND oh.deleted_at IS NULL WHERE o.user_id = u.id AND o.hotel_id <> $1)`,
        [hotelId],
      );
      for (const x of closed.rows) await changePerson(q, String(x.id), { deleted_at: now.toISOString(), deleted_by: by, status: "disabled" }, true);
      for (const x of closed.rows) await q("UPDATE platform.sessions SET revoked_at = $2, revoked_reason = 'admin' WHERE user_id = $1 AND revoked_at IS NULL", [String(x.id), now.toISOString()]);
      return closed.rows.length;
    },
  };

  const groups: PlatformGroupsRepo = {
    async list() {
      return (await q(`${GROUP_SELECT} ORDER BY lower(g.name) COLLATE "C", g.name COLLATE "C", g.id`)).rows.map(groupOf);
    },
    async get(id, options) {
      const r = await q(`${GROUP_SELECT} AND g.id = $1::uuid${options?.forUpdate ? " FOR UPDATE OF g" : ""}`, [id]);
      return r.rows[0] ? groupOf(r.rows[0]) : null;
    },
    async nameTaken(name) {
      return (await q("SELECT 1 AS x FROM platform.hotel_groups WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1", [name])).rows.length > 0;
    },
    async slugTaken(slug) {
      return (await q("SELECT 1 AS x FROM platform.hotel_groups WHERE deleted_at IS NULL AND slug = $1 LIMIT 1", [slug])).rows.length > 0;
    },
    async create(fields, now) {
      const r = await guard(q("INSERT INTO platform.hotel_groups (name, slug, status, created_at) VALUES ($1, $2, 'active', $3) RETURNING id", [fields.name, fields.slug, now.toISOString()]));
      return String(r.rows[0].id);
    },
    async groupOfHotel(hotelId) {
      const r = await q("SELECT g.id, g.name FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL AND g.kind = 'group' WHERE gm.hotel_id = $1", [hotelId]);
      return r.rows[0] ? { id: String(r.rows[0].id), name: String(r.rows[0].name) } : null;
    },
    async link(groupId, hotelId, by, now) {
      await guard(q("INSERT INTO platform.group_members (group_id, hotel_id, linked_by, created_at) VALUES ($1, $2, $3, $4)", [groupId, hotelId, by, now.toISOString()]));
    },
    async unlink(groupId, hotelId) {
      return (await q("DELETE FROM platform.group_members WHERE group_id = $1 AND hotel_id = $2", [groupId, hotelId])).affectedRows > 0;
    },
    async setAdmin(groupId, userId) {
      const r = await guard(q("UPDATE platform.hotel_groups SET admin_user_id = $2 WHERE id = $1 AND deleted_at IS NULL", [groupId, userId]));
      if (r.affectedRows === 0) throw new RepoError("check", "no such group");
    },
    async setLifecycle(id, patch) {
      const sets = ["status = $2"];
      const params: unknown[] = [id, patch.status];
      for (const [key, column] of [["approvedAt", "approved_at"], ["rejectedAt", "rejected_at"], ["rejectReason", "reject_reason"]] as const) {
        const value = patch[key];
        if (value === undefined) continue;
        params.push(value instanceof Date ? value.toISOString() : value);
        sets.push(`${column} = $${params.length}`);
      }
      const r = await guard(q(`UPDATE platform.hotel_groups SET ${sets.join(", ")} WHERE id = $1 AND deleted_at IS NULL`, params));
      if (r.affectedRows === 0) throw new RepoError("check", "no such group");
    },
    async maxHotels(groupIds) {
      const out = new Map<string, number>();
      if (groupIds.length === 0 || !(await maxColumn())) return out;
      const r = await q("SELECT id, max_hotels FROM platform.hotel_groups WHERE id = ANY($1::uuid[]) AND max_hotels IS NOT NULL", [[...groupIds]]);
      for (const x of r.rows) out.set(String(x.id), Number(x.max_hotels));
      return out;
    },
    async setMaxHotels(groupId, max) {
      if (!(await maxColumn())) return false;
      const r = await guard(q("UPDATE platform.hotel_groups SET max_hotels = $2 WHERE id = $1 AND deleted_at IS NULL", [groupId, max]));
      if (r.affectedRows === 0) throw new RepoError("check", "no such group");
      return true;
    },
    async countTowardLimit(groupId) {
      const r = await q(
        "SELECT COUNT(*) AS n FROM platform.group_members gm JOIN platform.hotels h ON h.id = gm.hotel_id AND h.deleted_at IS NULL WHERE gm.group_id = $1 AND h.status IN ('pending_approval', 'active', 'suspended')",
        [groupId],
      );
      return Number(r.rows[0]?.n ?? 0);
    },
    async addHistory(row) {
      await guard(
        q(
          `INSERT INTO platform.group_history (group_id, event, from_status, to_status, hotel_id, admin_user_id, changed_by, actor_role, reason, trace_id, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [row.groupId, row.event, row.fromStatus, row.toStatus, row.hotelId, row.adminUserId, row.changedBy, row.actorRole, row.reason, row.traceId, row.at.toISOString()],
        ),
      );
    },
  };

  const audit: PlatformAuditRepo = {
    async write(row) {
      const r = await guard(
        q(
          `INSERT INTO platform.audit_log (actor_user_id, hotel_id, group_id, action, entity, entity_id, before, after, reason, trace_id, at,
                                           scope, actor_name, actor_role, inside_hotel, visit_id, target_label, ip, user_agent, result)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'platform', $12, $13, $18::uuid IS NOT NULL, $18::uuid, $14, $15::inet, $16, $17) RETURNING id`,
          [
            row.actorUserId, row.hotelId, row.groupId, row.action, row.entity, row.entityId,
            row.before === null ? null : JSON.stringify(row.before), row.after === null ? null : JSON.stringify(row.after),
            row.reason, row.traceId, row.at.toISOString(), row.actorName, row.actorRole, row.targetLabel, row.ip, row.userAgent, row.result, row.visitId ?? null,
          ],
        ),
      );
      return String(r.rows[0].id);
    },
    async activity(filter, page) {
      const params: unknown[] = [filter.hotelId ?? null, filter.groupId ?? null];
      const where = `a.scope = 'platform' AND a.result = 'success' AND ($1::uuid IS NULL OR a.hotel_id = $1::uuid) AND ($2::uuid IS NULL OR a.group_id = $2::uuid) AND ${wordsCondition("concat_ws(' ', a.actor_name, a.action, a.entity, a.target_label, a.reason, h.name, g.name)", filter.words, params)}`;
      const total = Number(
        (await q(`SELECT COUNT(*) AS n FROM platform.audit_log a LEFT JOIN platform.hotels h ON h.id = a.hotel_id LEFT JOIN platform.hotel_groups g ON g.id = a.group_id WHERE ${where}`, params)).rows[0]?.n ?? 0,
      );
      const r = await q(
        `SELECT a.id, a.at, a.actor_name, a.action, a.entity, a.entity_id, a.hotel_id, h.name AS hotel_name, a.group_id, g.name AS group_name, a.target_label, a.reason
           FROM platform.audit_log a
           LEFT JOIN platform.hotels h ON h.id = a.hotel_id
           LEFT JOIN platform.hotel_groups g ON g.id = a.group_id
          WHERE ${where}
          ORDER BY a.at DESC, a.id DESC LIMIT $3 OFFSET $4`,
        [...params, page.limit, page.offset],
      );
      const rows: PlatformActivityRow[] = r.rows.map((x) => ({
        id: String(x.id), at: asDate(x.at) as Date, actorName: asText(x.actor_name) ?? "System", action: String(x.action), entity: String(x.entity), entityId: asText(x.entity_id),
        hotelId: asText(x.hotel_id), hotelName: asText(x.hotel_name), groupId: asText(x.group_id), groupName: asText(x.group_name), targetLabel: asText(x.target_label), reason: asText(x.reason),
      }));
      return { rows, total };
    },
  };

  // platform 0135 (the visit's access, the platform admins' hotel access) applied? Asked once and remembered when yes: before it, every visit is 'view' as it always was.
  let accessReady: Promise<boolean> | null = null;
  const visitAccessColumn = (): Promise<boolean> =>
    (accessReady ??= q("SELECT to_regclass('platform.platform_admin_hotel_access') IS NOT NULL AS ready")
      .then((r) => r.rows[0]?.ready === true)
      .then((ready) => {
        if (!ready) accessReady = null;
        return ready;
      })
      .catch(() => {
        accessReady = null;
        return false;
      }));

  const visits: PlatformVisitsRepo = {
    async open(userId) {
      const access = (await visitAccessColumn()) ? "v.access" : "'view'::text AS access";
      const r = await q(
        `SELECT v.id, v.user_id, v.hotel_id, h.name AS hotel_name, v.session_id, v.reason, v.started_at, v.expires_at, ${access}
           FROM platform.hotel_visits v JOIN platform.hotels h ON h.id = v.hotel_id
          WHERE v.user_id = $1 AND v.ended_at IS NULL ORDER BY v.started_at DESC, v.id DESC`,
        [userId],
      );
      return r.rows.map((x) => ({
        id: String(x.id), userId: String(x.user_id), hotelId: String(x.hotel_id), hotelName: String(x.hotel_name), sessionId: asText(x.session_id), reason: String(x.reason),
        startedAt: asDate(x.started_at) as Date, expiresAt: asDate(x.expires_at) as Date, access: x.access === "full" ? "full" : "view",
      }));
    },
    async start(f, now) {
      // before 0135 there is no access column: every visit is recorded as view, as it always was (open() then answers 'view', and the service reports what was recorded)
      const ready = await visitAccessColumn();
      // the visit trigger (0106, 0135) refuses with a privilege error (42501) when the person, the hotel or the access is not allowed; the guard maps only the constraint errors
      const r = await guard(
        q(
          ready
            ? `INSERT INTO platform.hotel_visits (user_id, hotel_id, session_id, reason, started_at, expires_at, ip, user_agent, access, extended_from)
               VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9, $10) RETURNING id`
            : `INSERT INTO platform.hotel_visits (user_id, hotel_id, session_id, reason, started_at, expires_at, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8) RETURNING id`,
          ready
            ? [f.userId, f.hotelId, f.sessionId, f.reason, now.toISOString(), f.expiresAt.toISOString(), f.ip, f.userAgent, f.access, f.extendedFrom ?? null]
            : [f.userId, f.hotelId, f.sessionId, f.reason, now.toISOString(), f.expiresAt.toISOString(), f.ip, f.userAgent],
        ).catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code === "42501") throw new RepoError("check", "this visit is not allowed");
          throw error;
        }),
      );
      return String(r.rows[0].id);
    },
    async end(id, reason, by, now) {
      // 'extended' is a 0135 reason; before it the 0106 CHECK knows the closest one, 'replaced' (a new visit took its place)
      const stored = reason === "extended" && !(await visitAccessColumn()) ? "replaced" : reason;
      await guard(q("UPDATE platform.hotel_visits SET ended_at = $2, ended_reason = $3, ended_by = $4 WHERE id = $1 AND ended_at IS NULL", [id, now.toISOString(), stored, by]));
    },
  };

  const DEFAULT_ACCESS = { level: "view" as const, allHotels: true, hotelIds: [] as string[], reason: null, updatedBy: null, updatedAt: null };
  const adminAccess: PlatformAdminAccessRepo = {
    async get(userId) {
      if (!(await visitAccessColumn())) return { ...DEFAULT_ACCESS, hotelIds: [] };
      const r = await q("SELECT level, all_hotels, reason, updated_by, updated_at FROM platform.platform_admin_hotel_access WHERE user_id = $1", [userId]);
      const x = r.rows[0];
      if (!x) return { ...DEFAULT_ACCESS, hotelIds: [] };
      const hotels = x.all_hotels === true ? [] : (await q("SELECT hotel_id FROM platform.platform_admin_hotel_access_hotels WHERE user_id = $1 ORDER BY hotel_id", [userId])).rows.map((h) => String(h.hotel_id));
      return { level: x.level as AdminHotelAccess["level"], allHotels: x.all_hotels === true, hotelIds: hotels, reason: asText(x.reason), updatedBy: asText(x.updated_by), updatedAt: asDate(x.updated_at) };
    },
    async set(userId, access, by, now) {
      if (!(await visitAccessColumn())) return false;
      await guard(
        q(
          `INSERT INTO platform.platform_admin_hotel_access (user_id, level, all_hotels, reason, updated_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)
             ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level, all_hotels = EXCLUDED.all_hotels, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by`,
          [userId, access.level, access.allHotels, access.reason, by, now.toISOString()],
        ),
      );
      await q("DELETE FROM platform.platform_admin_hotel_access_hotels WHERE user_id = $1", [userId]);
      if (!access.allHotels && access.hotelIds.length > 0) {
        await guard(q("INSERT INTO platform.platform_admin_hotel_access_hotels (user_id, hotel_id, created_at, updated_at) SELECT $1, h, $3, $3 FROM unnest($2::uuid[]) AS h", [userId, access.hotelIds, now.toISOString()]));
      }
      return true;
    },
  };

  // ---- P5: the Super Admin's audit log, sign-in history, settings, exports and health (platform tables only)
  const AUDIT_WHERE =
    "a.scope = 'platform' AND ($1::text IS NULL OR a.action = $1) AND ($2::uuid IS NULL OR a.hotel_id = $2::uuid) AND ($3::text IS NULL OR a.actor_name = $3) AND ($4::timestamptz IS NULL OR a.at >= $4::timestamptz) AND ($5::timestamptz IS NULL OR a.at < $5::timestamptz)";
  const auditLog: PlatformAuditSearchRepo = {
    async search(filter, page) {
      const params = [filter.action ?? null, filter.hotelId ?? null, filter.actor ?? null, filter.from?.toISOString() ?? null, filter.to?.toISOString() ?? null];
      const total = Number((await q(`SELECT COUNT(*) AS n FROM platform.audit_log a WHERE ${AUDIT_WHERE}`, params)).rows[0]?.n ?? 0);
      const r = await q(
        `SELECT a.id, a.at, a.actor_name, a.actor_role, a.action, a.entity, a.entity_id, a.hotel_id, h.name AS hotel_name, a.group_id, g.name AS group_name, a.target_label, a.reason,
                a.result, a.inside_hotel, host(a.ip) AS ip, a.user_agent
           FROM platform.audit_log a
           LEFT JOIN platform.hotels h ON h.id = a.hotel_id
           LEFT JOIN platform.hotel_groups g ON g.id = a.group_id
          WHERE ${AUDIT_WHERE}
          ORDER BY a.at DESC, a.id DESC LIMIT $6 OFFSET $7`,
        [...params, page.limit, page.offset],
      );
      const rows: PlatformAuditEntryRow[] = r.rows.map((x) => ({
        id: String(x.id), at: asDate(x.at) as Date, actorName: asText(x.actor_name) ?? "System", actorRole: (asText(x.actor_role) as AccountRole | null) ?? null, action: String(x.action),
        entity: String(x.entity), entityId: asText(x.entity_id), hotelId: asText(x.hotel_id), hotelName: asText(x.hotel_name), groupId: asText(x.group_id), groupName: asText(x.group_name),
        targetLabel: asText(x.target_label), reason: asText(x.reason), result: x.result === "failed" ? "failed" : "success", insideHotel: x.inside_hotel === true, ip: asText(x.ip), userAgent: asText(x.user_agent),
      }));
      return { rows, total };
    },
    async actors() {
      const r = await q(`SELECT actor_name FROM platform.audit_log WHERE scope = 'platform' AND actor_name IS NOT NULL GROUP BY actor_name ORDER BY lower(actor_name) COLLATE "C", actor_name COLLATE "C"`);
      return r.rows.map((x) => String(x.actor_name));
    },
    async lastActors(action, hotelIds) {
      if (hotelIds.length === 0) return new Map();
      const r = await q(
        `SELECT DISTINCT ON (hotel_id) hotel_id, actor_name FROM platform.audit_log
          WHERE scope = 'platform' AND action = $1 AND result = 'success' AND hotel_id = ANY($2::uuid[]) ORDER BY hotel_id, at DESC, id DESC`,
        [action, [...hotelIds]],
      );
      return new Map(r.rows.map((x) => [String(x.hotel_id), asText(x.actor_name) ?? "System"]));
    },
  };

  const signIns: PlatformSignInsRepo = {
    async recent(limit) {
      const r = await q(
        `SELECT e.id, e.at, e.event, e.user_id, u.username, u.display_name, u.account_role, e.detail, host(e.ip) AS ip, e.user_agent,
                COALESCE(eh.name, mh.name, ag.name) AS hotel_name
           FROM platform.auth_events e
           LEFT JOIN platform.people u ON u.id = e.user_id
           LEFT JOIN platform.hotels eh ON eh.id = e.hotel_id
           LEFT JOIN LATERAL (
             SELECT h.name FROM platform.user_hotels uh JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL
              WHERE uh.user_id = u.id ORDER BY uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1
           ) mh ON true
           LEFT JOIN LATERAL (
             SELECT g.name FROM platform.hotel_groups g WHERE g.admin_user_id = u.id AND g.deleted_at IS NULL ORDER BY g.created_at, g.id LIMIT 1
           ) ag ON true
          WHERE e.event IN ('login_success', 'login_failed', 'account_locked', 'code_failed')
          ORDER BY e.at DESC, e.id DESC LIMIT $1`,
        [limit],
      );
      return r.rows.map((x) => ({
        id: String(x.id), at: asDate(x.at) as Date, event: x.event as SignInEvent["event"], userId: asText(x.user_id), username: asText(x.username), name: asText(x.display_name),
        accountRole: (asText(x.account_role) as AccountRole | null) ?? null, hotelName: asText(x.hotel_name), detail: (x.detail as Record<string, unknown> | null) ?? null, ip: asText(x.ip), userAgent: asText(x.user_agent),
      }));
    },
  };

  const settings: PlatformSettingsRepo = {
    async all() {
      const r = await q(
        `SELECT s.key, s.value, s.updated_at, s.updated_by, u.display_name AS updated_by_name
           FROM platform.platform_settings s LEFT JOIN platform.people u ON u.id = s.updated_by WHERE NOT s.is_secret ORDER BY s.key`,
      );
      return r.rows.map((x) => ({ key: String(x.key), value: x.value, updatedAt: asDate(x.updated_at) as Date, updatedBy: asText(x.updated_by), updatedByName: asText(x.updated_by_name) }));
    },
    async set(key, value, by, now, options) {
      void now;
      await guard(
        q(
          `INSERT INTO platform.platform_settings (key, value, is_secret, updated_by) VALUES ($1, $2::jsonb, $4::boolean, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify(value), by, options?.secret === true],
        ),
      );
    },
    async secretChangedAt(keys) {
      const r = await q("SELECT key, updated_at FROM platform.platform_settings WHERE is_secret AND value <> 'null'::jsonb AND key = ANY($1::text[])", [[...keys]]);
      return new Map(r.rows.map((x) => [String(x.key), asDate(x.updated_at) as Date]));
    },
    async secrets(keys) {
      const r = await q("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE is_secret AND key = ANY($1::text[])", [[...keys]]);
      return new Map(r.rows.map((x) => [String(x.key), x.v === null || x.v === undefined || x.v === "" ? null : String(x.v)]));
    },
  };

  const exportsRepo: PlatformExportsRepo = {
    async readyOf(hotelIds) {
      if (hotelIds.length === 0) return new Map();
      const r = await q(
        `SELECT DISTINCT ON (hotel_id) id, hotel_id, file_name, byte_size, file_sha256, requested_by, finished_at FROM platform.hotel_exports
          WHERE status = 'ready' AND hotel_id = ANY($1::uuid[]) ORDER BY hotel_id, finished_at DESC, id DESC`,
        [[...hotelIds]],
      );
      return new Map(
        r.rows.map((x): [string, HotelExportRow] => [
          String(x.hotel_id),
          { id: String(x.id), hotelId: String(x.hotel_id), fileName: String(x.file_name), byteSize: Number(x.byte_size ?? 0), sha256: String(x.file_sha256), requestedBy: String(x.requested_by), finishedAt: asDate(x.finished_at) as Date },
        ]),
      );
    },
    async record(f) {
      const r = await guard(
        q(
          `INSERT INTO platform.hotel_exports (hotel_id, requested_by, status, file_name, file_ref, byte_size, file_sha256, started_at, finished_at)
           VALUES ($1, $2, 'ready', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [f.hotelId, f.requestedBy, f.fileName, f.fileRef, f.byteSize, f.sha256, f.startedAt.toISOString(), f.finishedAt.toISOString()],
        ),
      );
      return String(r.rows[0].id);
    },
    async recordDeletion(f) {
      // the deletion trigger (0102) refuses with 42501 (not a Super Admin) or 23514 (not archived, grace not over, wrong slug, no ready export)
      await guard(
        q(
          `INSERT INTO platform.hotel_deletions (hotel_id, hotel_name, slug, schema_name, confirm_slug, export_id, deleted_by, reason, trace_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [f.hotelId, f.hotelName, f.slug, f.schemaName, f.confirmSlug, f.exportId, f.deletedBy, f.reason, f.traceId, f.at.toISOString()],
        ).catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code === "42501") throw new RepoError("check", "this deletion is not allowed");
          throw error;
        }),
      );
    },
    async schemaOf(hotelId) {
      const r = await q("SELECT schema_name FROM platform.hotels WHERE id = $1", [hotelId]);
      return r.rows[0] ? String(r.rows[0].schema_name) : null;
    },
  };

  const backupOf = (x: Record<string, unknown>): HotelBackupRow => ({
    id: String(x.id), hotelId: String(x.hotel_id), fileName: String(x.file_name), fileRef: String(x.file_ref), byteSize: Number(x.byte_size ?? 0), sha256: String(x.file_sha256),
    tableCount: Number(x.table_count ?? 0), rowCount: Number(x.row_count ?? 0), finishedAt: asDate(x.finished_at) as Date,
  });
  const BACKUP_COLUMNS = "id, hotel_id, file_name, file_ref, byte_size, file_sha256, table_count, row_count, finished_at";
  const backups: PlatformBackupsRepo = {
    async latestOf(hotelIds) {
      if (hotelIds.length === 0) return new Map();
      const r = await q(`SELECT DISTINCT ON (hotel_id) ${BACKUP_COLUMNS} FROM platform.hotel_backups WHERE status = 'ready' AND hotel_id = ANY($1::uuid[]) ORDER BY hotel_id, finished_at DESC, id DESC`, [[...hotelIds]]);
      return new Map(r.rows.map((x): [string, HotelBackupRow] => [String(x.hotel_id), backupOf(x)]));
    },
    async readyOf(hotelId) {
      const r = await q(`SELECT ${BACKUP_COLUMNS} FROM platform.hotel_backups WHERE status = 'ready' AND hotel_id = $1 ORDER BY finished_at DESC, id DESC`, [hotelId]);
      return r.rows.map(backupOf);
    },
    async record(f) {
      const r = await guard(
        f.status === "ready"
          ? q(
              `INSERT INTO platform.hotel_backups (hotel_id, status, file_name, file_ref, byte_size, file_sha256, table_count, row_count, started_at, finished_at)
               VALUES ($1, 'ready', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [f.hotelId, f.fileName, f.fileRef, f.byteSize, f.sha256, f.tableCount, f.rowCount, f.startedAt.toISOString(), f.finishedAt.toISOString()],
            )
          : q(`INSERT INTO platform.hotel_backups (hotel_id, status, error_code, started_at, finished_at) VALUES ($1, 'failed', $2, $3, $4) RETURNING id`, [f.hotelId, f.errorCode, f.startedAt.toISOString(), f.finishedAt.toISOString()]),
      );
      return String(r.rows[0].id);
    },
    async remove(id) {
      await q("DELETE FROM platform.hotel_backups WHERE id = $1", [id]);
    },
  };

  const health: PlatformHealthRepo = {
    async storageBytes(hotelIds) {
      if (hotelIds.length === 0) return new Map();
      // the size functions need no privilege on the tables; a schema the catalog does not show (not provisioned yet) simply has no row
      const r = await q(
        `SELECT h.id, COALESCE(sum(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
           FROM platform.hotels h JOIN pg_namespace ns ON ns.nspname = h.schema_name LEFT JOIN pg_class c ON c.relnamespace = ns.oid AND c.relkind = 'r'
          WHERE h.id = ANY($1::uuid[]) GROUP BY h.id`,
        [[...hotelIds]],
      );
      return new Map(r.rows.map((x): [string, number] => [String(x.id), Number(x.bytes ?? 0)]));
    },
    async hotelsWithFailedMail(since) {
      const r = await q(
        `SELECT DISTINCT uh.hotel_id FROM platform.outbox o JOIN platform.user_hotels uh ON uh.user_id = o.user_id WHERE o.status = 'failed' AND o.updated_at >= $1::timestamptz
         UNION SELECT DISTINCT o.hotel_id FROM platform.outbox o WHERE o.hotel_id IS NOT NULL AND o.status = 'failed' AND o.updated_at >= $1::timestamptz`,
        [since.toISOString()],
      );
      return new Set(r.rows.map((x) => String(x.hotel_id)));
    },
    async ping() {
      const t = process.hrtime.bigint();
      await q("SELECT 1 AS ok");
      return Math.round(Number(process.hrtime.bigint() - t) / 1_000_000);
    },
  };

  const ANNOUNCEMENT_SELECT = `SELECT a.id, a.title, a.body, a.audience, a.important, a.starts_at, a.ends_at, a.ended_at, a.created_by, u.display_name AS created_by_name, a.created_at,
      (SELECT count(*) FROM platform.announcement_reads r WHERE r.announcement_id = a.id) AS reads
      FROM platform.announcements a LEFT JOIN platform.people u ON u.id = a.created_by`;
  const announcementOf = (x: Record<string, unknown>): AnnouncementRow => ({
    id: String(x.id), title: String(x.title), body: String(x.body), audience: x.audience === "everyone" ? "everyone" : "admins", important: x.important === true, startsAt: asDate(x.starts_at) as Date, endsAt: asDate(x.ends_at),
    endedAt: asDate(x.ended_at), createdBy: asText(x.created_by), createdByName: asText(x.created_by_name), createdAt: asDate(x.created_at) as Date, reads: Number(x.reads ?? 0),
  });
  const announcements: PlatformAnnouncementsRepo = {
    async list() {
      return (await q(`${ANNOUNCEMENT_SELECT} ORDER BY a.created_at DESC, a.id DESC`)).rows.map(announcementOf);
    },
    async get(id) {
      const r = await q(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1::uuid`, [id]);
      return r.rows[0] ? announcementOf(r.rows[0]) : null;
    },
    async create(f, by, now) {
      void now;
      const r = await guard(q("INSERT INTO platform.announcements (title, body, audience, important, starts_at, ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid) RETURNING id", [f.title, f.body, f.audience, f.important, f.startsAt, f.endsAt, by]));
      return String(r.rows[0].id);
    },
    async end(id, now) {
      const r = await q("UPDATE platform.announcements SET ended_at = $2 WHERE id = $1::uuid AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > $2)", [id, now]);
      return r.affectedRows > 0;
    },
    async unreadFor(userId, audiences, now) {
      const r = await q(
        `${ANNOUNCEMENT_SELECT} WHERE a.ended_at IS NULL AND a.starts_at <= $2 AND (a.ends_at IS NULL OR a.ends_at > $2) AND a.audience = ANY($3::text[])
           AND NOT EXISTS (SELECT 1 FROM platform.announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = $1::uuid)
         ORDER BY a.starts_at, a.id`,
        [userId, now, [...audiences]],
      );
      return r.rows.map(announcementOf);
    },
    async markRead(id, userId, now) {
      void now;
      await q("INSERT INTO platform.announcement_reads (announcement_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT (announcement_id, user_id) DO NOTHING", [id, userId]);
    },
  };

  const HOTEL_MAIL_COLUMNS = "hotel_id, ses_region, ses_user, ses_password, ses_from, gmail_user, gmail_password, from_name, reply_to, ses_test, gmail_test, pause, updated_at";
  const hotelMailOf = (x: Record<string, unknown>): HotelMailRow => ({
    hotelId: String(x.hotel_id), sesRegion: asText(x.ses_region), sesUser: asText(x.ses_user), sesPassword: asText(x.ses_password), sesFrom: asText(x.ses_from), gmailUser: asText(x.gmail_user),
    gmailPassword: asText(x.gmail_password), fromName: asText(x.from_name), replyTo: asText(x.reply_to), sesTest: x.ses_test ?? null, gmailTest: x.gmail_test ?? null, pause: x.pause ?? null, updatedAt: asDate(x.updated_at),
  });
  const hotelMail: PlatformHotelMailRepo = {
    async get(hotelId) {
      const r = await q(`SELECT ${HOTEL_MAIL_COLUMNS} FROM platform.hotel_mail WHERE hotel_id = $1::uuid`, [hotelId]);
      return r.rows[0] ? hotelMailOf(r.rows[0]) : null;
    },
    async all() {
      return (await q(`SELECT ${HOTEL_MAIL_COLUMNS} FROM platform.hotel_mail`)).rows.map(hotelMailOf);
    },
    async save(hotelId, patch, by) {
      // the row as it is now, with the patch laid over it, written back whole (a field left out of the patch stays)
      const have = await q(`SELECT ${HOTEL_MAIL_COLUMNS} FROM platform.hotel_mail WHERE hotel_id = $1::uuid FOR UPDATE`, [hotelId]);
      const cur: Omit<HotelMailRow, "updatedAt"> = have.rows[0] ? hotelMailOf(have.rows[0]) : { hotelId, sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null };
      const n = { ...cur, ...patch };
      await guard(q(
        `INSERT INTO platform.hotel_mail (hotel_id, ses_region, ses_user, ses_password, ses_from, gmail_user, gmail_password, from_name, reply_to, ses_test, gmail_test, updated_by, pause)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::uuid, $13::jsonb)
         ON CONFLICT (hotel_id) DO UPDATE SET ses_region = EXCLUDED.ses_region, ses_user = EXCLUDED.ses_user, ses_password = EXCLUDED.ses_password, ses_from = EXCLUDED.ses_from, gmail_user = EXCLUDED.gmail_user,
           gmail_password = EXCLUDED.gmail_password, from_name = EXCLUDED.from_name, reply_to = EXCLUDED.reply_to, ses_test = EXCLUDED.ses_test, gmail_test = EXCLUDED.gmail_test, updated_by = EXCLUDED.updated_by, pause = EXCLUDED.pause`,
        [hotelId, n.sesRegion, n.sesUser, n.sesPassword, n.sesFrom, n.gmailUser, n.gmailPassword, n.fromName, n.replyTo, n.sesTest === null || n.sesTest === undefined ? null : JSON.stringify(n.sesTest), n.gmailTest === null || n.gmailTest === undefined ? null : JSON.stringify(n.gmailTest), by, n.pause === null || n.pause === undefined ? null : JSON.stringify(n.pause)],
      ));
    },
    async setTest(hotelId, which, result) {
      await q(`UPDATE platform.hotel_mail SET ${which === "ses" ? "ses_test" : "gmail_test"} = $2::jsonb WHERE hotel_id = $1::uuid`, [hotelId, result === null ? null : JSON.stringify(result)]);
    },
  };
  const GROUP_MAIL_COLUMNS = HOTEL_MAIL_COLUMNS.replace("hotel_id", "group_id");
  const groupMailOf = (x: Record<string, unknown>): GroupMailRow => {
    const { hotelId, ...rest } = hotelMailOf({ ...x, hotel_id: x.group_id });
    return { groupId: hotelId, ...rest };
  };
  const groupMail: PlatformGroupMailRepo = {
    async get(groupId) {
      const r = await q(`SELECT ${GROUP_MAIL_COLUMNS} FROM platform.group_mail WHERE group_id = $1::uuid`, [groupId]);
      return r.rows[0] ? groupMailOf(r.rows[0]) : null;
    },
    async all() {
      return (await q(`SELECT ${GROUP_MAIL_COLUMNS} FROM platform.group_mail`)).rows.map(groupMailOf);
    },
    async save(groupId, patch, by) {
      const have = await q(`SELECT ${GROUP_MAIL_COLUMNS} FROM platform.group_mail WHERE group_id = $1::uuid FOR UPDATE`, [groupId]);
      const cur: Omit<GroupMailRow, "updatedAt"> = have.rows[0] ? groupMailOf(have.rows[0]) : { groupId, sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null };
      const n = { ...cur, ...patch };
      await guard(q(
        `INSERT INTO platform.group_mail (group_id, ses_region, ses_user, ses_password, ses_from, gmail_user, gmail_password, from_name, reply_to, ses_test, gmail_test, updated_by, pause)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::uuid, $13::jsonb)
         ON CONFLICT (group_id) DO UPDATE SET ses_region = EXCLUDED.ses_region, ses_user = EXCLUDED.ses_user, ses_password = EXCLUDED.ses_password, ses_from = EXCLUDED.ses_from, gmail_user = EXCLUDED.gmail_user,
           gmail_password = EXCLUDED.gmail_password, from_name = EXCLUDED.from_name, reply_to = EXCLUDED.reply_to, ses_test = EXCLUDED.ses_test, gmail_test = EXCLUDED.gmail_test, updated_by = EXCLUDED.updated_by, pause = EXCLUDED.pause`,
        [groupId, n.sesRegion, n.sesUser, n.sesPassword, n.sesFrom, n.gmailUser, n.gmailPassword, n.fromName, n.replyTo, n.sesTest === null || n.sesTest === undefined ? null : JSON.stringify(n.sesTest), n.gmailTest === null || n.gmailTest === undefined ? null : JSON.stringify(n.gmailTest), by, n.pause === null || n.pause === undefined ? null : JSON.stringify(n.pause)],
      ));
    },
    async setTest(groupId, which, result) {
      await q(`UPDATE platform.group_mail SET ${which === "ses" ? "ses_test" : "gmail_test"} = $2::jsonb WHERE group_id = $1::uuid`, [groupId, result === null ? null : JSON.stringify(result)]);
    },
  };
  return { hotels, accounts, groups, audit, auth: pgAuthRepos(db), invitations: pgInvitationsRepo(db), onboarding: pgOnboardingRepo(db), visits, adminAccess, auditLog, signIns, settings, exports: exportsRepo, backups, health, announcements, hotelMail, groupMail };
}

/** One platform transaction (hms_app, no hotel role); a failure rolls the whole unit back. */
export function createPgPlatformConsoleUnit(pool: ClientPool): PlatformConsoleUnit {
  return createPlatformUnit(pool, pgPlatformConsoleRepos);
}
