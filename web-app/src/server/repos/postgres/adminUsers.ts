import "server-only";
import { changePerson, createPerson, personFieldsOf } from "./personWrites";
// The PostgreSQL implementation of the users, roles and sign-in side of Admin (repos/adminUsers.ts), in the platform schema as hms_app. The in-memory
// double (repos/memory/adminUsers.ts) is the reference for every rule. BOUNDARY: nothing here reads a password hash, a token or a code; a user is
// made with a hash nobody can match, and the credential side (services/auth/credentialService) issues the invite.
import { randomBytes } from "node:crypto";
import type { Level } from "../../auth/levels";
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import { newId } from "../../db/ids";
import type { AdminOverrideRepo, AdminRoleRow, AdminUserRow, AdminUsersRepos, AdminUsersUnit, MemberStatus } from "../adminUsers";
import { RepoError } from "../types";
import { createPlatformUnit } from "./platformUnit";
import { asDate, asText, guard } from "./shared";

type Row = Record<string, unknown>;

const PORTAL_ROLES = ["guest", "corporate"];

/** A well-formed Argon2id string made of random bytes: the column accepts it and no password can ever match it. The invite replaces it. */
const unusableHash = (): string => `$argon2id$v=19$m=19456,t=2,p=1$${randomBytes(12).toString("base64").replace(/=+$/, "")}$${randomBytes(32).toString("base64").replace(/=+$/, "")}`;

const MEMBER_SELECT = `
  SELECT u.id, u.username, u.email, u.mobile, u.display_name, u.account_role, u.status AS user_status, u.blocked_at, u.locked_until, u.code_required, u.last_login_at, u.password_changed_at,
         u.created_at, u.created_by, uh.status AS member_status, r.id AS role_id, r.key AS role_key, r.name AS role_name, r.level AS role_level
    FROM platform.user_hotels uh
    JOIN platform.people u ON u.id = uh.user_id AND u.deleted_at IS NULL
    JOIN platform.roles r ON r.id = COALESCE(uh.role_id, u.role_id)
   WHERE uh.hotel_id = $1`;

const userRowOf = (r: Row): AdminUserRow => ({
  id: String(r.id), username: String(r.username), email: asText(r.email), mobile: asText(r.mobile), displayName: String(r.display_name), accountRole: String(r.account_role), roleId: String(r.role_id),
  roleKey: String(r.role_key), roleName: String(r.role_name), roleLevel: Number(r.role_level),
  status: (r.user_status === "disabled" || r.member_status === "disabled" ? "disabled" : r.user_status === "invited" ? "invited" : "active") as MemberStatus,
  blocked: r.blocked_at !== null, lockedUntil: asDate(r.locked_until), codeRequired: r.code_required === true, lastLoginAt: asDate(r.last_login_at), passwordChangedAt: asDate(r.password_changed_at),
  createdAt: asDate(r.created_at) as Date, createdBy: asText(r.created_by),
});
const roleRowOf = (r: Row): AdminRoleRow => ({
  id: String(r.id), hotelId: asText(r.hotel_id), key: String(r.key), name: String(r.name), description: asText(r.description), icon: asText(r.icon), accent: asText(r.accent), level: Number(r.level),
  inherits: r.inherits === true, isSystem: r.is_system === true,
});

function pgAdminUsersRepos(db: SqlClient): AdminUsersRepos {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);

  /** The tab and word filters over the member list, as SQL (`locked` = blocked, or locked until a later moment). */
  function memberWhere(filter: { words: readonly string[]; tab: "all" | "active" | "inactive" | "locked" }, now: Date, params: unknown[]): string {
    const parts: string[] = [];
    for (const w of filter.words) {
      params.push(w.toLowerCase());
      parts.push(`position($${params.length}::text in lower(concat_ws(' ', m.display_name, m.username, m.email, m.mobile, m.role_name))) > 0`);
    }
    if (filter.tab === "all" || filter.tab === "inactive") return parts.length ? parts.join(" AND ") + (filter.tab === "inactive" ? " AND (m.user_status = 'disabled' OR m.member_status = 'disabled')" : "") : filter.tab === "inactive" ? "(m.user_status = 'disabled' OR m.member_status = 'disabled')" : "true";
    params.push(now.toISOString());
    const nowParam = `$${params.length}::timestamptz`;
    const disabled = "(m.user_status = 'disabled' OR m.member_status = 'disabled')";
    const locked = `(m.blocked_at IS NOT NULL OR (m.locked_until IS NOT NULL AND m.locked_until > ${nowParam}))`;
    if (filter.tab === "locked") parts.push(locked);
    if (filter.tab === "active") parts.push(`NOT ${disabled} AND NOT ${locked}`);
    return parts.length ? parts.join(" AND ") : "true";
  }
  const member = async (hotelId: string, id: string): Promise<AdminUserRow | null> => {
    const r = await q(`${MEMBER_SELECT} AND u.id = $2`, [hotelId, id]);
    return r.rows[0] ? userRowOf(r.rows[0]) : null;
  };

  const overrides: AdminOverrideRepo = {
    async list(hotelId, userId) {
      const r = await q("SELECT p.key, up.level, up.granted FROM platform.user_permissions up JOIN platform.permissions p ON p.id = up.permission_id WHERE up.hotel_id = $1 AND up.user_id = $2 ORDER BY p.key", [hotelId, userId]);
      return r.rows.map((x) => ({ key: String(x.key), level: (x.granted === true ? x.level : "none") as Level | "none" }));
    },
    async set(hotelId, userId, key, level, by) {
      if (level === null) {
        await q("DELETE FROM platform.user_permissions WHERE hotel_id = $1 AND user_id = $2 AND permission_id = (SELECT id FROM platform.permissions WHERE key = $3)", [hotelId, userId, key]);
        return;
      }
      const granted = level !== "none";
      const stored = level === "none" ? "view" : level;
      const r = await guard(
        q(
          `INSERT INTO platform.user_permissions (user_id, hotel_id, permission_id, level, granted, granted_by) SELECT $2, $1, p.id, $4, $5, $6 FROM platform.permissions p WHERE p.key = $3
           ON CONFLICT (user_id, hotel_id, permission_id) DO UPDATE SET level = EXCLUDED.level, granted = EXCLUDED.granted, granted_by = EXCLUDED.granted_by RETURNING id`,
          [hotelId, userId, key, stored, granted, by],
        ),
      );
      if (r.rows.length === 0) throw new RepoError("check", "no such permission");
    },
  };

  return {
    users: {
      async list(hotelId, filter, now) {
        const params: unknown[] = [hotelId];
        const where = memberWhere(filter, now, params);
        const r = await q(`SELECT * FROM (${MEMBER_SELECT}) m WHERE ${where} ORDER BY m.role_level DESC, lower(m.display_name) COLLATE "C", m.display_name COLLATE "C", m.id`, params);
        return r.rows.map(userRowOf);
      },
      async counts(hotelId, now) {
        const r = await q(
          `SELECT COUNT(*) AS n,
                  COUNT(*) FILTER (WHERE NOT (m.user_status = 'disabled' OR m.member_status = 'disabled') AND NOT (m.blocked_at IS NOT NULL OR (m.locked_until IS NOT NULL AND m.locked_until > $2))) AS active,
                  COUNT(*) FILTER (WHERE m.user_status = 'disabled' OR m.member_status = 'disabled') AS inactive,
                  COUNT(*) FILTER (WHERE m.blocked_at IS NOT NULL OR (m.locked_until IS NOT NULL AND m.locked_until > $2)) AS locked
             FROM (${MEMBER_SELECT}) m`,
          [hotelId, now.toISOString()],
        );
        const x = r.rows[0];
        return { all: Number(x.n), active: Number(x.active), inactive: Number(x.inactive), locked: Number(x.locked) };
      },
      get: member,
      async own(id) {
        const r = await q(
          `SELECT u.id, u.username, u.email, u.mobile, u.display_name, u.account_role, u.status AS user_status, u.blocked_at, u.locked_until, u.code_required, u.last_login_at, u.password_changed_at,
                  u.created_at, u.created_by, 'active' AS member_status, r.id AS role_id, r.key AS role_key, r.name AS role_name, r.level AS role_level
             FROM platform.people u JOIN platform.roles r ON r.id = u.role_id
            WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [id],
        );
        return r.rows[0] ? userRowOf(r.rows[0]) : null;
      },
      async usernameTaken(lowerUsername, exceptId) {
        return (await q("SELECT 1 AS x FROM platform.people WHERE deleted_at IS NULL AND username = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1", [lowerUsername, exceptId ?? null])).rows.length > 0;
      },
      async emailTaken(lowerEmail, exceptId) {
        return (await q("SELECT 1 AS x FROM platform.people WHERE deleted_at IS NULL AND lower(email) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1", [lowerEmail, exceptId ?? null])).rows.length > 0;
      },
      async create(hotelId, fields, by, now) {
        const id = newId();
        await guard(
          createPerson(q, { id, username: fields.username, email: fields.email, mobile: fields.mobile, display_name: fields.displayName, password_hash: unusableHash(), role_id: fields.roleId, account_role: fields.accountRole, status: "invited", must_change_password: true, code_required: false, created_by: by, created_at: now.toISOString() }),
        );
        await guard(q("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id, is_default) VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM platform.user_hotels WHERE user_id = $1))", [id, hotelId, fields.roleId]));
        return (await member(hotelId, id)) as AdminUserRow;
      },
      async updateOwn(id, patch) {
        const fields = personFieldsOf(patch, ["username", "displayName", "mobile"]);
        if (Object.keys(fields).length) await guard(changePerson(q, id, fields, true));
      },
      async update(hotelId, id, patch) {
        const current = await q("SELECT 1 AS x FROM platform.user_hotels WHERE user_id = $1 AND hotel_id = $2", [id, hotelId]);
        if (!current.rows[0]) throw new RepoError("check", "no such user in this hotel");
        const fields = personFieldsOf(patch, ["username", "displayName", "mobile"]);
        if (Object.keys(fields).length) await guard(changePerson(q, id, fields));
        if (patch.roleId !== undefined) await guard(q("UPDATE platform.user_hotels SET role_id = $3 WHERE user_id = $1 AND hotel_id = $2", [id, hotelId, patch.roleId]));
        return (await member(hotelId, id)) as AdminUserRow;
      },
      async setMemberStatus(hotelId, id, status) {
        const r = await q("UPDATE platform.user_hotels SET status = $3 WHERE user_id = $1 AND hotel_id = $2", [id, hotelId, status]);
        if (r.affectedRows === 0) throw new RepoError("check", "no such user in this hotel");
      },
      async unlock(id, record) {
        await q("UPDATE platform.logins SET failed_attempts = 0, lock_level = 0, locked_until = NULL, blocked_at = NULL, blocked_kind = NULL WHERE id = $1", [id]);
        if (record) {
          await q("INSERT INTO platform.auth_events (user_id, hotel_id, event, ip, detail, at) VALUES ($1, $2, 'account_unlocked', $3::inet, $4::jsonb, $5)", [id, record.hotelId, record.ip, JSON.stringify({ by: record.by }), record.at]);
        }
      },
      async close(id, by, now) {
        await changePerson(q, id, { deleted_at: now.toISOString(), deleted_by: by, status: "disabled" }, true);
      },
      async endSessions(id, reason, now) {
        return (await q("UPDATE platform.sessions SET revoked_at = $3, revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL", [id, reason, now.toISOString()])).affectedRows;
      },
      async portalOf(hotelId, userId) {
        const r = await q("SELECT subject_kind, subject_id FROM platform.user_hotels WHERE user_id = $1 AND hotel_id = $2", [userId, hotelId]);
        const x = r.rows[0];
        return x && x.subject_id ? { kind: String(x.subject_kind) as "guest" | "company", id: String(x.subject_id) } : null;
      },
      async setPortal(hotelId, userId, subject) {
        await guard(q("UPDATE platform.user_hotels SET subject_kind = $3, subject_id = $4 WHERE user_id = $1 AND hotel_id = $2", [userId, hotelId, subject ? subject.kind : null, subject ? subject.id : null]));
      },
      async hotelName(hotelId) {
        const r = await q("SELECT name FROM platform.hotels WHERE id = $1", [hotelId]);
        return r.rows[0] ? String(r.rows[0].name) : "";
      },
      async names(ids) {
        if (ids.length === 0) return new Map();
        return new Map((await q("SELECT id, display_name FROM platform.people WHERE id = ANY($1::uuid[])", [ids])).rows.map((x) => [String(x.id), String(x.display_name)]));
      },
    },

    roles: {
      async list(hotelId) {
        const r = await q('SELECT * FROM platform.roles WHERE (hotel_id IS NULL OR hotel_id = $1) AND key <> ALL($2::text[]) ORDER BY level DESC, lower(name) COLLATE "C", name COLLATE "C", id', [hotelId, PORTAL_ROLES]);
        return r.rows.map(roleRowOf);
      },
      async get(hotelId, id) {
        const r = await q("SELECT * FROM platform.roles WHERE id = $1 AND (hotel_id IS NULL OR hotel_id = $2) AND key <> ALL($3::text[])", [id, hotelId, PORTAL_ROLES]);
        return r.rows[0] ? roleRowOf(r.rows[0]) : null;
      },
      async nameTaken(hotelId, name, exceptId) {
        const r = await q("SELECT 1 AS x FROM platform.roles WHERE (hotel_id IS NULL OR hotel_id = $1) AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [hotelId, name, exceptId ?? null]);
        return r.rows.length > 0;
      },
      async holders(hotelId, roleId) {
        const r = await q(`SELECT COUNT(*) AS n FROM (${MEMBER_SELECT}) m WHERE m.role_id = $2`, [hotelId, roleId]);
        return Number(r.rows[0].n);
      },
      async holdersOf(hotelId, roleIds) {
        if (roleIds.length === 0) return new Map();
        const r = await q(`SELECT m.role_id, COUNT(*) AS n FROM (${MEMBER_SELECT}) m WHERE m.role_id = ANY($2::uuid[]) GROUP BY m.role_id`, [hotelId, roleIds]);
        return new Map(r.rows.map((x) => [String(x.role_id), Number(x.n)]));
      },
      async create(hotelId, fields) {
        const id = newId();
        const r = await guard(
          q("INSERT INTO platform.roles (id, hotel_id, key, name, description, level, icon, accent, inherits, is_system) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) RETURNING *", [id, hotelId, `custom_${id.slice(-8)}`, fields.name, fields.description, fields.level, fields.icon, fields.accent, fields.inherits]),
        );
        return roleRowOf(r.rows[0]);
      },
      async update(roleId, patch) {
        const sets: string[] = [];
        const params: unknown[] = [roleId];
        for (const [field, column] of [["name", "name"], ["description", "description"], ["level", "level"], ["icon", "icon"], ["accent", "accent"], ["inherits", "inherits"]] as const) {
          const value = patch[field];
          if (value === undefined) continue;
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        }
        // a built-in role (hotel_id IS NULL) is one row every hotel shares: never written from a hotel's screen
        const r = await guard(q(`UPDATE platform.roles SET ${sets.length ? sets.join(", ") : "id = id"} WHERE id = $1 AND hotel_id IS NOT NULL RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "no such role");
        return roleRowOf(r.rows[0]);
      },
      async remove(roleId) {
        await guard(q("DELETE FROM platform.roles WHERE id = $1 AND hotel_id IS NOT NULL", [roleId]));
      },
      async grants(roleId) {
        const r = await q("SELECT p.key, rp.level FROM platform.role_permissions rp JOIN platform.permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.key", [roleId]);
        return r.rows.map((x) => ({ key: String(x.key), level: x.level as Level }));
      },
      async grantsOf(roleIds) {
        if (roleIds.length === 0) return new Map();
        const r = await q("SELECT rp.role_id, p.key, rp.level FROM platform.role_permissions rp JOIN platform.permissions p ON p.id = rp.permission_id WHERE rp.role_id = ANY($1::uuid[]) ORDER BY rp.role_id, p.key", [roleIds]);
        const out = new Map<string, { key: string; level: Level }[]>();
        for (const x of r.rows) {
          const list = out.get(String(x.role_id)) ?? [];
          list.push({ key: String(x.key), level: x.level as Level });
          out.set(String(x.role_id), list);
        }
        return out;
      },
      async setGrants(roleId, grants) {
        if ((await q("SELECT 1 AS x FROM platform.roles WHERE id = $1 AND hotel_id IS NOT NULL", [roleId])).rows.length === 0) throw new RepoError("check", "no such role");
        await q("DELETE FROM platform.role_permissions WHERE role_id = $1", [roleId]);
        if (grants.length === 0) return;
        const r = await guard(
          q(
            `INSERT INTO platform.role_permissions (role_id, permission_id, level) SELECT $1, p.id, v.level FROM unnest($2::text[], $3::text[]) AS v(key, level) JOIN platform.permissions p ON p.key = v.key RETURNING id`,
            [roleId, grants.map((g) => g.key), grants.map((g) => g.level)],
          ),
        );
        if (r.rows.length !== new Set(grants.map((g) => g.key)).size) throw new RepoError("check", "no such permission");
      },
    },

    overrides,

    signIns: {
      async list(userId, now) {
        const r = await q(
          `SELECT e.id, e.at, host(e.ip) AS ip, e.user_agent, e.event,
                  (e.event <> 'login_success' OR NOT EXISTS (SELECT 1 FROM platform.sessions s WHERE s.user_id = e.user_id AND s.issued_at = e.at AND s.revoked_at IS NULL AND s.expires_at > $2)) AS ended
             FROM platform.auth_events e
            WHERE e.user_id = $1 AND e.event IN ('login_success', 'login_failed') AND NOT EXISTS (SELECT 1 FROM platform.sign_in_removals x WHERE x.event_id = e.id)
            ORDER BY e.at DESC, e.id DESC`,
          [userId, now.toISOString()],
        );
        return r.rows.map((x) => ({ id: String(x.id), at: asDate(x.at) as Date, ip: asText(x.ip), userAgent: asText(x.user_agent), result: (x.event === "login_success" ? "success" : "failed") as "success" | "failed", ended: x.ended === true }));
      },
      async removeEnded(userId, id, now) {
        const rows = await this.list(userId, now);
        const row = rows.find((x) => x.id === id);
        if (!row || !row.ended) return false;
        await guard(q("INSERT INTO platform.sign_in_removals (user_id, event_id) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING", [userId, id]));
        return true;
      },
      async liveDevices(userId, currentSessionId, now) {
        const r = await q("SELECT id, user_agent, host(ip) AS ip, last_seen_at, issued_at FROM platform.sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY issued_at DESC", [userId, now.toISOString()]);
        return r.rows.map((x) => ({ id: String(x.id), userAgent: asText(x.user_agent), ip: asText(x.ip), lastSeenAt: asDate(x.last_seen_at), issuedAt: asDate(x.issued_at) as Date, current: String(x.id) === currentSessionId }));
      },
    },

    audit: {
      async write(row, now) {
        await q("INSERT INTO platform.audit_log (actor_user_id, hotel_id, action, entity, entity_id, trace_id, after, at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)", [
          row.actorUserId, row.hotelId, row.action, row.entity, row.entityId, row.traceId, row.detail === null ? null : JSON.stringify(row.detail), now.toISOString(),
        ]);
      },
      async aboutUser(userId, limit) {
        const r = await q("SELECT id, at, action, entity_id, after FROM platform.audit_log WHERE entity_id = $1 AND action NOT LIKE 'signin.%' ORDER BY at DESC, id DESC LIMIT $2", [userId, limit]);
        return r.rows.map((x) => ({ id: String(x.id), at: asDate(x.at) as Date, action: String(x.action), entityId: asText(x.entity_id), detail: (x.after as Record<string, unknown> | null) ?? null }));
      },
    },
  };
}

/** One transaction on the platform data, as hms_app. */
export function createPgAdminUsersUnit(pool: ClientPool): AdminUsersUnit {
  return createPlatformUnit(pool, pgAdminUsersRepos);
}
