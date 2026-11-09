import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminOverrideRepo, AdminRoleRow, AdminUserRow, AdminUsersRepos, AdminUsersUnit, MemberStatus } from "../adminUsers";
import { RepoError } from "../types";
import { createMemoryAuth, type AuthData } from "./auth";
import type { MemoryStore } from "./store";

// The in-memory double of the users, roles and sign-in side of Admin, bound to the SAME platform data as sign-in (users, roles, grants, memberships, sessions,
// events, audit), so what an administrator does is what the next sign-in sees. What the sign-in tables do not carry (a role's name, description and
// accent; when a person was made and by whom; the sign-in records an administrator removed) lives in its own small data
// here: the PostgreSQL tables have columns for them. It never reads a password hash, a token or a code, and a user is made WITHOUT a usable password.
interface AdminUsersData {
  roleMeta: Map<string, { name: string; description: string | null; icon: string | null; accent: string | null; isSystem: boolean }>;
  userMeta: Map<string, { createdAt: Date; createdBy: string | null }>;
  /** Sign-in records removed from the person's own list (the table itself is insert-only). */
  removedSignIns: Set<string>;
  /** Audit lines the administrators wrote (the platform audit_log, with their detail). */
  auditLines: { id: string; at: Date; actorUserId: string; hotelId: string | null; action: string; entity: string; entityId: string | null; traceId: string | null; detail: Record<string, unknown> | null }[];
}

const emptyAdminUsersData = (): AdminUsersData => ({ roleMeta: new Map(), userMeta: new Map(), removedSignIns: new Set(), auditLines: [] });

/** Marks a placeholder that no password can ever match: the credential side replaces it when the invite is used. */
export const UNUSABLE_PASSWORD = "!unusable-until-the-invite-is-used";

const PORTAL_ROLES = new Set(["guest", "corporate"]);
const BUILT_IN_NAMES: Record<string, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin", super_admin: "SuperAdmin" };
const clone = <T>(v: T): T => structuredClone(v);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();

function bindAdminUsers(auth: AuthData, meta: AdminUsersData): AdminUsersRepos {
  const roleRow = (r: AuthData["roles"][number]): AdminRoleRow => {
    const m = meta.roleMeta.get(r.id);
    return {
      id: r.id,
      hotelId: r.hotelId,
      key: r.key,
      name: m?.name ?? BUILT_IN_NAMES[r.key] ?? r.key,
      description: m?.description ?? null,
      icon: m?.icon ?? null,
      accent: m?.accent ?? null,
      level: r.level,
      inherits: r.inherits,
      isSystem: m?.isSystem ?? r.hotelId === null,
    };
  };
  const statusOf = (u: AuthData["users"][number], m: AuthData["memberships"][number] | undefined): MemberStatus => (u.status === "disabled" || m?.status === "disabled" ? "disabled" : u.status === "invited" ? "invited" : "active");
  const userRow = (hotelId: string, id: string): AdminUserRow | null => {
    const u = auth.users.find((x) => x.id === id && x.deletedAt === null);
    const m = auth.memberships.find((x) => x.userId === id && x.hotelId === hotelId);
    if (!u || !m) return null;
    const role = auth.roles.find((r) => r.id === (m.roleId ?? u.roleId));
    if (!role) return null;
    const r = roleRow(role);
    const created = meta.userMeta.get(u.id);
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      mobile: u.mobile,
      displayName: u.displayName,
      accountRole: u.accountRole,
      roleId: role.id,
      roleKey: r.key,
      roleName: r.name,
      roleLevel: r.level,
      status: statusOf(u, m),
      blocked: u.blockedAt !== null,
      lockedUntil: u.lockedUntil,
      codeRequired: u.codeRequired,
      lastLoginAt: u.lastLoginAt,
      passwordChangedAt: u.passwordChangedAt,
      createdAt: created?.createdAt ?? new Date(0),
      createdBy: created?.createdBy ?? null,
    };
  };
  const locked = (r: AdminUserRow, now: Date): boolean => r.blocked || (r.lockedUntil !== null && r.lockedUntil > now);
  const members = (hotelId: string): AdminUserRow[] => auth.memberships.filter((m) => m.hotelId === hotelId).flatMap((m) => userRow(hotelId, m.userId) ?? []);
  const text = (r: AdminUserRow): string => lower([r.displayName, r.username, r.email, r.mobile, r.roleName].join(" "));

  const overrides: AdminOverrideRepo = {
    list: async (hotelId, userId) => auth.userPermissions.filter((p) => p.userId === userId && p.hotelId === hotelId).map((p) => ({ key: p.key, level: p.granted ? p.level : ("none" as const) })),
    set: async (hotelId, userId, key, level) => {
      const at = auth.userPermissions.findIndex((p) => p.userId === userId && p.hotelId === hotelId && p.key === key);
      if (level === null) {
        if (at >= 0) auth.userPermissions.splice(at, 1);
        return;
      }
      const row = { userId, hotelId, key, level: level === "none" ? ("view" as const) : level, granted: level !== "none" };
      if (at >= 0) auth.userPermissions[at] = row;
      else auth.userPermissions.push(row);
    },
  };

  return {
    users: {
      list: async (hotelId, f, now) =>
        members(hotelId)
          .filter((r) => f.words.every((w) => text(r).includes(w)))
          .filter((r) => (f.tab === "all" ? true : f.tab === "locked" ? locked(r, now) : f.tab === "inactive" ? r.status === "disabled" : r.status !== "disabled" && !locked(r, now)))
          .sort((a, b) => b.roleLevel - a.roleLevel || a.displayName.localeCompare(b.displayName)),
      counts: async (hotelId, now) => {
        const all = members(hotelId);
        return { all: all.length, active: all.filter((r) => r.status !== "disabled" && !locked(r, now)).length, inactive: all.filter((r) => r.status === "disabled").length, locked: all.filter((r) => locked(r, now)).length };
      },
      get: async (hotelId, id) => userRow(hotelId, id),
      own: async (id) => {
        const u = auth.users.find((x) => x.id === id && x.deletedAt === null);
        const role = u ? auth.roles.find((r) => r.id === u.roleId) : undefined;
        if (!u || !role) return null;
        const r = roleRow(role);
        return {
          id: u.id, username: u.username, email: u.email, mobile: u.mobile, displayName: u.displayName, accountRole: u.accountRole, roleId: role.id, roleKey: r.key, roleName: r.name, roleLevel: r.level,
          status: "active", blocked: u.blockedAt !== null, lockedUntil: u.lockedUntil, codeRequired: u.codeRequired, lastLoginAt: u.lastLoginAt, passwordChangedAt: u.passwordChangedAt,
          createdAt: meta.userMeta.get(u.id)?.createdAt ?? new Date(0), createdBy: meta.userMeta.get(u.id)?.createdBy ?? null,
        };
      },
      usernameTaken: async (name, except) => auth.users.some((u) => u.id !== except && u.deletedAt === null && u.username === name),
      emailTaken: async (email, except) => auth.users.some((u) => u.id !== except && u.deletedAt === null && lower(u.email) === email),
      create: async (hotelId, f, by, now) => {
        if (auth.users.some((u) => u.deletedAt === null && u.username === f.username)) throw new RepoError("unique", "users_username_live_key");
        const id = randomUUID();
        auth.users.push({
          id, username: f.username, email: f.email, mobile: f.mobile, displayName: f.displayName, passwordHash: UNUSABLE_PASSWORD, roleId: f.roleId, accountRole: f.accountRole as never,
          status: "invited", mustChangePassword: true, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null,
          codeRequired: false, lastLoginAt: null, deletedAt: null,
        });
        auth.memberships.push({ userId: id, hotelId, roleId: f.roleId, status: "active", isDefault: !auth.memberships.some((m) => m.userId === id), subject: null });
        meta.userMeta.set(id, { createdAt: now, createdBy: by });
        return userRow(hotelId, id)!;
      },
      updateOwn: async (id, patch) => {
        const u = auth.users.find((x) => x.id === id && x.deletedAt === null);
        if (!u) return;
        if (patch.username !== undefined) {
          if (auth.users.some((x) => x.id !== id && x.deletedAt === null && x.username === patch.username)) throw new RepoError("unique", "users_username_live_key");
          u.username = patch.username;
        }
        if (patch.displayName !== undefined) u.displayName = patch.displayName;
        if (patch.mobile !== undefined) u.mobile = patch.mobile;
      },
      update: async (hotelId, id, patch) => {
        const u = auth.users.find((x) => x.id === id);
        const m = auth.memberships.find((x) => x.userId === id && x.hotelId === hotelId);
        if (!u || !m) throw new RepoError("check", "no such user in this hotel");
        if (patch.username !== undefined) {
          if (auth.users.some((x) => x.id !== id && x.deletedAt === null && x.username === patch.username)) throw new RepoError("unique", "users_username_live_key");
          u.username = patch.username;
        }
        if (patch.displayName !== undefined) u.displayName = patch.displayName;
        if (patch.mobile !== undefined) u.mobile = patch.mobile;
        if (patch.roleId !== undefined) m.roleId = patch.roleId;
        return userRow(hotelId, id)!;
      },
      setMemberStatus: async (hotelId, id, status) => {
        const m = auth.memberships.find((x) => x.userId === id && x.hotelId === hotelId);
        if (!m) throw new RepoError("check", "no such user in this hotel");
        m.status = status;
      },
      unlock: async (id, record) => {
        const u = auth.users.find((x) => x.id === id);
        if (!u) return;
        Object.assign(u, { failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null });
        if (record) auth.events.push({ userId: id, hotelId: record.hotelId, event: "account_unlocked", ip: record.ip, userAgent: null, detail: { by: record.by }, at: record.at });
      },
      close: async (id, _by, now) => {
        const u = auth.users.find((x) => x.id === id);
        if (u) {
          u.deletedAt = now;
          u.status = "disabled";
        }
      },
      endSessions: async (id, reason, now) => {
        let n = 0;
        for (const s of auth.sessions) {
          if (s.userId === id && s.revokedAt === null) {
            s.revokedAt = now;
            s.revokedReason = reason;
            n += 1;
          }
        }
        return n;
      },
      hotelName: async (hotelId) => auth.hotels.find((h) => h.id === hotelId)?.name ?? "",
    portalOf: async (hotelId, userId) => {
      const m = auth.memberships.find((x) => x.userId === userId && x.hotelId === hotelId);
      return m && m.subject ? { kind: m.subject.kind as "guest" | "company", id: m.subject.id } : null;
    },
    setPortal: async (hotelId, userId, subject) => {
      const m = auth.memberships.find((x) => x.userId === userId && x.hotelId === hotelId);
      if (m) m.subject = subject;
    },
      names: async (ids) => new Map(auth.users.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.displayName])),
    },

    roles: {
      list: async (hotelId) => auth.roles.filter((r) => (r.hotelId === null || r.hotelId === hotelId) && !PORTAL_ROLES.has(r.key)).map(roleRow).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
      get: async (hotelId, id) => {
        const r = auth.roles.find((x) => x.id === id && (x.hotelId === null || x.hotelId === hotelId) && !PORTAL_ROLES.has(x.key));
        return r ? roleRow(r) : null;
      },
      nameTaken: async (hotelId, name, except) => auth.roles.some((r) => r.id !== except && (r.hotelId === null || r.hotelId === hotelId) && lower(roleRow(r).name) === lower(name)),
      holders: async (hotelId, roleId) => members(hotelId).filter((u) => u.roleId === roleId).length,
      holdersOf: async (hotelId, roleIds) => new Map(roleIds.map((id) => [id, members(hotelId).filter((u) => u.roleId === id).length] as const).filter(([, n]) => n > 0)),
      create: async (hotelId, f) => {
        const id = randomUUID();
        const key = `custom_${id.slice(0, 8)}`;
        auth.roles.push({ id, hotelId, key, level: f.level, inherits: f.inherits });
        meta.roleMeta.set(id, { name: f.name, description: f.description, icon: f.icon, accent: f.accent, isSystem: false });
        return roleRow(auth.roles.find((r) => r.id === id)!);
      },
      update: async (roleId, patch) => {
        // as Postgres: a built-in role (hotelId null) is shared by every hotel and never written from here
        const r = auth.roles.find((x) => x.id === roleId && x.hotelId !== null);
        if (!r) throw new RepoError("check", "no such role");
        const m = meta.roleMeta.get(roleId) ?? { name: BUILT_IN_NAMES[r.key] ?? r.key, description: null, icon: null, accent: null, isSystem: r.hotelId === null };
        if (patch.name !== undefined) m.name = patch.name;
        if (patch.description !== undefined) m.description = patch.description;
        if (patch.level !== undefined) r.level = patch.level;
        if (patch.inherits !== undefined) r.inherits = patch.inherits;
        if (patch.icon !== undefined) m.icon = patch.icon;
        if (patch.accent !== undefined) m.accent = patch.accent;
        meta.roleMeta.set(roleId, m);
        return roleRow(r);
      },
      remove: async (roleId) => {
        if (!auth.roles.some((r) => r.id === roleId && r.hotelId !== null)) return;
        if (auth.users.some((u) => u.roleId === roleId && u.deletedAt === null) || auth.memberships.some((m) => m.roleId === roleId)) throw new RepoError("check", "roles_in_use");
        auth.roles = auth.roles.filter((r) => r.id !== roleId);
        auth.rolePermissions = auth.rolePermissions.filter((p) => p.roleId !== roleId);
        meta.roleMeta.delete(roleId);
      },
      grants: async (roleId) => auth.rolePermissions.filter((p) => p.roleId === roleId).map((p) => ({ key: p.key, level: p.level })),
      grantsOf: async (roleIds) =>
        new Map(roleIds.map((id) => [id, auth.rolePermissions.filter((p) => p.roleId === id).map((p) => ({ key: p.key, level: p.level })).sort((a, b) => a.key.localeCompare(b.key))] as const).filter(([, g]) => g.length > 0)),
      setGrants: async (roleId, grants) => {
        if (!auth.roles.some((r) => r.id === roleId && r.hotelId !== null)) throw new RepoError("check", "no such role");
        auth.rolePermissions = [...auth.rolePermissions.filter((p) => p.roleId !== roleId), ...grants.map((g) => ({ roleId, key: g.key, level: g.level }))];
      },
    },

    overrides,

    signIns: {
      list: async (userId, now) =>
        auth.events
          .map((e, i) => ({ e, id: String(i) }))
          .filter(({ e, id }) => e.userId === userId && (e.event === "login_success" || e.event === "login_failed") && !meta.removedSignIns.has(`${userId}:${id}`))
          .map(({ e, id }) => ({
            id,
            at: e.at,
            ip: e.ip,
            userAgent: e.userAgent,
            result: e.event === "login_success" ? ("success" as const) : ("failed" as const),
            // a success is still running while one of the person's sessions was opened at that moment and is not ended
            ended: e.event === "login_success" ? !auth.sessions.some((s) => s.userId === userId && s.issuedAt.getTime() === e.at.getTime() && s.revokedAt === null && s.expiresAt > now) : true,
          }))
          .sort((a, b) => b.at.getTime() - a.at.getTime()),
      removeEnded: async (userId, id, now) => {
        const rows = await bindAdminUsers(auth, meta).signIns.list(userId, now);
        const row = rows.find((r) => r.id === id);
        if (!row || !row.ended) return false;
        meta.removedSignIns.add(`${userId}:${id}`);
        return true;
      },
      liveDevices: async (userId, currentSessionId, now) =>
        auth.sessions
          .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > now)
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
          .map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, issuedAt: s.issuedAt, current: s.id === currentSessionId })),
    },

    audit: {
      write: async (row, now) => {
        meta.auditLines.push({ id: randomUUID(), at: now, actorUserId: row.actorUserId, hotelId: row.hotelId, action: row.action, entity: row.entity, entityId: row.entityId, traceId: row.traceId, detail: row.detail });
        auth.audit.push({ actorUserId: row.actorUserId, hotelId: row.hotelId, action: row.action, entity: row.entity, entityId: row.entityId, traceId: row.traceId, at: now });
      },
      aboutUser: async (userId, limit) => {
        const own = meta.auditLines.filter((l) => l.entityId === userId && !l.action.startsWith("signin.")).map((l) => ({ id: l.id, at: l.at, action: l.action, entityId: l.entityId, detail: l.detail }));
        // the credential side (password, emailed code, e-mail address) writes to the sign-in data only; PostgreSQL keeps both in the one audit_log
        const mirrored = (a: AuthData["audit"][number]): boolean => meta.auditLines.some((l) => l.action === a.action && l.entityId === a.entityId && l.at.getTime() === a.at.getTime());
        const credential = auth.audit
          .map((a, i) => ({ a, i }))
          .filter(({ a }) => a.entityId === userId && !a.action.startsWith("signin.") && !mirrored(a))
          .map(({ a, i }) => ({ id: `audit-${i}`, at: a.at, action: a.action, entityId: a.entityId, detail: null }));
        return [...own, ...credential].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
      },
    },
  };
}

/** A unit over the platform data of sign-in (the same store). One transaction at a time; a failed one leaves nothing behind. */
export function createMemoryAdminUsers(auth: { store: MemoryStore<AuthData> } = createMemoryAuth()): { unit: AdminUsersUnit; meta: AdminUsersData } {
  const meta = emptyAdminUsersData();
  return {
    meta,
    unit: {
      run: <T>(work: (repos: AdminUsersRepos) => Promise<T>): Promise<T> =>
        auth.store.exclusive("platform", async (data) => {
          const before = { roleMeta: clone(meta.roleMeta), userMeta: clone(meta.userMeta), removed: clone(meta.removedSignIns), lines: clone(meta.auditLines) };
          try {
            return await work(bindAdminUsers(data, meta));
          } catch (error) {
            meta.roleMeta = before.roleMeta;
            meta.userMeta = before.userMeta;
            meta.removedSignIns = before.removed;
            meta.auditLines = before.lines;
            throw error;
          }
        }),
    },
  };
}
