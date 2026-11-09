import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { Catalog } from "../../auth/catalog";
import { isDerivedAbility } from "../../auth/access";
import { isLevel, LEVELS } from "../../auth/levels";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AdminRoleRow, AdminUserRow, AdminUsersRepos, AdminUsersUnit } from "../../repos/adminUsers";
import { Rules } from "../payrollCore/validate";
import type { CredentialService } from "../auth/credentialPort";
import type { UserBody, OverrideBody, PortalInviteBody, UserListQuery } from "./userSchemas";

// Users of the hotel (Pallav UserController + Services/UserHierarchy): who may do what to which account. An account manages the rungs below its own
// on the ladder and nothing at or above it; nobody manages themselves; the SuperAdmin account changes hands only by a transfer. Everything about a
// credential (the invite, a reset, an e-mail address change, switching the emailed code off) goes through the CredentialService port: this service
// never sees a password, a token or a code. Spec: docs/specs/admin.md §7.

const USERS = "users";
const ADMIN_ROLES = new Set(["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin"]);
const MOBILE = /^(?:\+?91)?[6-9]\d{9}$/;
const PORTAL_NO_STAFF_ACCESS = "Guest and company accounts cannot get staff access. Create a staff account instead.";

interface AdminUserDto {
  id: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  roleId: string;
  roleName: string;
  status: "active" | "inactive" | "locked" | "invited";
  emailedCode: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdByName: string;
  overrides: { module: string; level: "none" | "view" | "create" | "edit" | "full" }[];
  /** Whether the signed-in person may act on this account (the buttons). */
  canManage: boolean;
  /** Decision 47: for guest and company portal accounts, what they are linked to; null for staff. */
  portal: PortalLinkDto | null;
}

/** Decision 47: the guest or company record a portal account is linked to. */
interface PortalLinkDto {
  kind: "guest" | "company";
  linked: boolean;
  recordId: string | null;
  /** The record's display name, for this (hotel Admin) screen only. */
  recordName: string | null;
}

/** The hotel's guest and company records, for linking portal accounts (the hotel schema, read as the signed-in Admin). */
export interface PortalRecords {
  describe(session: VerifiedSession, links: readonly { kind: "guest" | "company"; id: string }[]): Promise<Map<string, { name: string; active: boolean }>>;
  options(session: VerifiedSession, kind: "guest" | "company", q: string): Promise<{ id: string; name: string; detail: string }[]>;
}

interface UserActionResult {
  user: AdminUserDto;
  message: string;
}

interface UserDeps {
  platform: AdminUsersUnit;
  credentials: CredentialService;
  catalog: Catalog;
  now: () => Date;
  /** Decision 47: the records a portal account can be linked to (absent = names are not shown and linking is refused). */
  portalRecords?: PortalRecords;
}

const normalMobile = (raw: string): string | null => {
  const t = raw.replace(/[\s-]/g, "");
  if (t === "") return null;
  const m = MOBILE.exec(t);
  return m ? `+91${t.slice(-10)}` : "";
};

export function createUserService(deps: UserDeps) {
  const { platform, credentials, catalog, now, portalRecords } = deps;

  /** Which portal a hotel account belongs to (null = staff). */
  const portalKindOf = (accountRole: string): "guest" | "company" | null => (accountRole === "guest_user" ? "guest" : accountRole === "corporate_user" ? "company" : null);

  /** UserHierarchy::canManage: not yourself, never the SuperAdmin, and only a lower rung. */
  const rankOk = (session: VerifiedSession, target: AdminUserRow): boolean => session.userId !== target.id && target.roleKey !== "super_admin" && session.roleLevel > target.roleLevel;

  function assertManage(session: VerifiedSession, target: AdminUserRow): void {
    if (target.roleKey === "super_admin") throw new AppError("FORBIDDEN", "The SuperAdmin account can only be changed by transferring the role.");
    if (!rankOk(session, target)) throw new AppError("FORBIDDEN", "You are not allowed to manage this account.");
  }

  /** The rungs the actor may hand out: every role of this hotel below their own. */
  const assignable = (session: VerifiedSession, roles: readonly AdminRoleRow[]): AdminRoleRow[] => roles.filter((r) => r.level < session.roleLevel);

  const statusOf = (r: AdminUserRow, at: Date): AdminUserDto["status"] => (r.blocked || (r.lockedUntil !== null && r.lockedUntil > at) ? "locked" : r.status === "disabled" ? "inactive" : r.status === "invited" ? "invited" : "active");

  async function dto(repos: AdminUsersRepos, session: VerifiedSession, rows: readonly AdminUserRow[]): Promise<AdminUserDto[]> {
    const at = now();
    const names = await repos.users.names(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
    // decision 47: what each guest/company portal account is linked to (and the record's name, for this screen)
    const links = new Map<string, { kind: "guest" | "company"; id: string } | null>();
    for (const r of rows) if (portalKindOf(r.accountRole) !== null) links.set(r.id, await repos.users.portalOf(session.hotelId, r.id));
    const linked = [...links.values()].flatMap((l) => (l ? [l] : []));
    const described = portalRecords && linked.length > 0 ? await portalRecords.describe(session, linked) : new Map<string, { name: string; active: boolean }>();
    const out: AdminUserDto[] = [];
    for (const r of rows) {
      const portalKind = portalKindOf(r.accountRole);
      const link = links.get(r.id) ?? null;
      const overrides = await repos.overrides.list(session.hotelId, r.id);
      out.push({
        id: r.id,
        name: r.displayName,
        username: r.username,
        email: r.email ?? "",
        mobile: r.mobile ?? "",
        roleId: r.roleId,
        roleName: r.roleName,
        status: statusOf(r, at),
        emailedCode: r.codeRequired,
        lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        createdByName: r.createdBy ? (names.get(r.createdBy) ?? "Removed user") : "System",
        overrides: overrides.map((o) => ({ module: o.key, level: o.level })),
        canManage: rankOk(session, r),
        portal: portalKind ? { kind: link ? link.kind : portalKind, linked: link !== null, recordId: link ? link.id : null, recordName: link ? (described.get(`${link.kind}:${link.id}`)?.name ?? null) : null } : null,
      });
    }
    return out;
  }

  async function target(repos: AdminUsersRepos, session: VerifiedSession, id: string): Promise<AdminUserRow> {
    const row = await repos.users.get(session.hotelId, id);
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  }

  const audit = (repos: AdminUsersRepos, session: VerifiedSession, meta: RequestMeta, action: string, row: Pick<AdminUserRow, "id" | "username">, detail: Record<string, unknown> | null = null) =>
    repos.audit.write({ actorUserId: session.userId, hotelId: session.hotelId, action, entity: "user", entityId: row.id, traceId: meta.traceId, detail }, now());

  /** A free username from an email's name part (letters, numbers, dots, underscores), with a number added when it is taken. */
  async function freeUsername(repos: AdminUsersRepos, email: string): Promise<string> {
    const base = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 40).padEnd(3, "0");
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? base : `${base}${n + 1}`;
      if (!(await repos.users.usernameTaken(candidate))) return candidate;
    }
    return `${base}${Date.now() % 100000}`;
  }

  /** profileRules() + messages() (UserController :44-70), applied to the create or edit form. */
  async function validated(repos: AdminUsersRepos, input: UserBody, existing: AdminUserRow | null, requireEmail: boolean) {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name), 100);
    let username = v.required("username", "username", input.username);
    if (username !== null) {
      if (Array.from(username).length < 3) v.fail("username", "The username field must be at least 3 characters.");
      else if (Array.from(username).length > 50) v.fail("username", "The username field must not be greater than 50 characters.");
      else if (!/^[A-Za-z0-9._]+$/.test(username)) v.fail("username", "Username can only contain letters, numbers, dots and underscores.");
      username = username.toLowerCase();
      if (!v.has("username") && (await repos.users.usernameTaken(username, existing?.id))) v.fail("username", "That username is already taken.");
    }
    let email: string | null = v.max("email", "email", v.email("email", "email", Rules.clean(input.email)), 254);
    if (requireEmail && Rules.clean(input.email) === null) v.fail("email", "An email address is needed - the sign-in invitation is sent to it.");
    email = email === null ? null : email.toLowerCase();
    if (email !== null && !v.has("email") && (await repos.users.emailTaken(email, existing?.id))) v.fail("email", "The email has already been taken.");
    const mobile = normalMobile(input.mobile);
    if (mobile === "") v.fail("mobile", "Enter a 10-digit mobile number.");
    return { v, name, username, email, mobile: mobile === "" ? null : mobile };
  }

  /** The override rules of Pallav's userOverride (AccessController :163-210), per module and level. */
  function checkOverride(session: VerifiedSession, who: AdminUserRow, key: string, level: string | null): void {
    if (!catalog.get(key)) throw new AppError("VALIDATION_FAILED", "That is not a permission.", { fields: { module: "That is not a permission." } });
    if (isDerivedAbility(key)) throw new AppError("VALIDATION_FAILED", "That ability is derived from the role and cannot be granted.", { fields: { module: "That ability is derived from the role and cannot be granted." } });
    if (level !== null && level !== "none" && !isLevel(level)) throw new AppError("VALIDATION_FAILED", "Choose a level.", { fields: { level: "Choose a level." } });
    if (who.accountRole && portalKindOf(who.accountRole) !== null) throw new AppError("VALIDATION_FAILED", PORTAL_NO_STAFF_ACCESS, { fields: { module: PORTAL_NO_STAFF_ACCESS } });
    if (who.roleKey === "super_admin" && who.id !== session.userId) throw new AppError("VALIDATION_FAILED", "The SuperAdmin account cannot be changed this way.");
    if (who.id === session.userId) throw new AppError("VALIDATION_FAILED", "You cannot change your own access.");
    if (level !== null && level !== "none" && !can(session, catalog, key, level)) throw new AppError("VALIDATION_FAILED", "You cannot give away a permission you do not have.");
    if (key === "access" && level !== null && level !== "none" && level !== "view") {
      throw new AppError("VALIDATION_FAILED", "Changing roles and permissions stays with the one account that owns the system. Transfer SuperAdmin if it has to move.");
    }
  }

  return {
    /** index (:20-45): the people of this hotel, highest rung first then by name; the tiles count the whole hotel whatever the search. */
    async list(session: VerifiedSession, q: UserListQuery): Promise<{ page: Page<AdminUserDto>; stats: { all: number; active: number; inactive: number; locked: number } }> {
      requirePermission(session, catalog, USERS, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return platform.run(async (repos) => {
        const rows = await repos.users.list(session.hotelId, { words, tab: q.tab }, now());
        const items = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
        return { page: { items: await dto(repos, session, items), total: rows.length, page: q.page, pageSize: q.pageSize }, stats: await repos.users.counts(session.hotelId, now()) };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<AdminUserDto> {
      requirePermission(session, catalog, USERS, "view");
      return platform.run(async (repos) => (await dto(repos, session, [await target(repos, session, id)]))[0]);
    },

    /** The rungs the signed-in person may hand out (the role picker). */
    async assignableRoles(session: VerifiedSession): Promise<{ id: string; name: string; level: number }[]> {
      requirePermission(session, catalog, USERS, "view");
      return platform.run(async (repos) => assignable(session, await repos.roles.list(session.hotelId)).map((r) => ({ id: r.id, name: r.name, level: r.level })));
    },

    /** store (:72-110): made in `invited` status without a password; the credential side sends the invitation. */
    async create(session: VerifiedSession, input: UserBody, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "create");
      const created = await platform.run(async (repos) => {
        const f = await validated(repos, input, null, true);
        const role = assignable(session, await repos.roles.list(session.hotelId)).find((r) => r.id === input.roleId);
        if (!role) f.v.fail("roleId", "You are not allowed to create an account with that role.");
        for (const o of input.overrides) {
          try {
            checkOverride(session, { id: "", roleKey: "", roleLevel: 0 } as AdminUserRow, o.module, o.level);
          } catch (error) {
            if (error instanceof AppError) f.v.fail("overrides", error.message);
          }
        }
        f.v.done();
        const row = await repos.users.create(
          session.hotelId,
          { username: f.username!, email: f.email!, mobile: f.mobile, displayName: f.name!, roleId: role!.id, accountRole: ADMIN_ROLES.has(role!.key) || role!.key === "admin" ? "hotel_admin" : "hotel_user" },
          session.userId,
          now(),
        );
        for (const o of input.overrides) await repos.overrides.set(session.hotelId, row.id, o.module, o.level, session.userId);
        await audit(repos, session, meta, "user.created", row, { role: role!.name });
        return { row, view: (await dto(repos, session, [row]))[0] };
      });
      // the invitation is the credential side's work, after the account exists: a failure to mail never undoes the account (Pallav)
      const sent = await credentials.issueInvite(created.row.id);
      return {
        user: created.view,
        message: sent.queued ? `Account @${created.row.username} created as ${created.row.roleName}. The sign-in invitation has been emailed to ${created.row.email}.` : `Account @${created.row.username} was created, but the invitation email could not be sent. Use Reset password to try again.`,
      };
    },

    /**
     * A guest or company portal login for a record of THIS hotel (MJ, 5 Nov 2026: the portals need a real first sign-in): made `invited`, linked to the record
     * (user_hotels.subject_kind/subject_id), with no staff access (the lowest rung; a portal session holds no module anyway), the invitation (temporary password)
     * emailed through the credential port, audited. Needs Create on the users screen; the record must exist and be active.
     */
    async invitePortal(session: VerifiedSession, input: PortalInviteBody, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "create");
      if (!portalRecords) throw new AppError("CONFLICT", "Portal accounts are not available on this server.");
      const found = (await portalRecords.describe(session, [{ kind: input.kind, id: input.recordId }])).get(`${input.kind}:${input.recordId}`);
      if (!found) throw new AppError("VALIDATION_FAILED", `That ${input.kind} does not exist in this hotel.`, { fields: { recordId: `That ${input.kind} does not exist in this hotel.` } });
      if (!found.active) throw new AppError("VALIDATION_FAILED", `That ${input.kind} is switched off.`, { fields: { recordId: `That ${input.kind} is switched off.` } });
      const created = await platform.run(async (repos) => {
        const username = input.username?.trim() || (await freeUsername(repos, input.email));
        const f = await validated(repos, { name: input.name, username, email: input.email, mobile: input.mobile, roleId: "00000000-0000-4000-8000-000000000000", overrides: [] }, null, true);
        const lowest = [...(await repos.roles.list(session.hotelId))].sort((a, b) => a.level - b.level)[0];
        if (!lowest) f.v.fail("kind", "This hotel has no roles yet.");
        f.v.done();
        const row = await repos.users.create(
          session.hotelId,
          { username: f.username!, email: f.email!, mobile: f.mobile, displayName: f.name!, roleId: lowest!.id, accountRole: input.kind === "guest" ? "guest_user" : "corporate_user" },
          session.userId,
          now(),
        );
        await repos.users.setPortal(session.hotelId, row.id, { kind: input.kind, id: input.recordId });
        await audit(repos, session, meta, "portal.invited", row, { kind: input.kind });
        return { row, view: (await dto(repos, session, [row]))[0] };
      });
      const sent = await credentials.issueInvite(created.row.id);
      const portal = input.kind === "guest" ? "guest portal" : "company portal";
      return {
        user: created.view,
        message: sent.queued ? `${created.row.displayName} can now sign in to the ${portal} as @${created.row.username}. The invitation has been emailed to ${created.row.email}.` : `The ${portal} account @${created.row.username} was created, but the invitation email could not be sent. Use Reset password to try again.`,
      };
    },

    /** update (:112-140): name, username, mobile and role here; an e-mail address is a credential channel, so it goes through the credential port. */
    async update(session: VerifiedSession, id: string, input: UserBody, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "edit");
      let emailChange: { id: string; email: string } | null = null;
      const done = await platform.run(async (repos) => {
        const row = await target(repos, session, id);
        assertManage(session, row);
        const f = await validated(repos, input, row, false);
        const role = assignable(session, await repos.roles.list(session.hotelId)).find((r) => r.id === input.roleId);
        if (!role) f.v.fail("roleId", "You are not allowed to assign that role.");
        // user kinds are never mixed: a guest or company login keeps its role and never gets staff access
        if (portalKindOf(row.accountRole) !== null && input.roleId !== row.roleId) f.v.fail("roleId", PORTAL_NO_STAFF_ACCESS);
        f.v.done();
        const before = { name: row.displayName, username: row.username, mobile: row.mobile ?? "", role: row.roleName, email: row.email ?? "" };
        const saved = await repos.users.update(session.hotelId, id, { displayName: f.name!, username: f.username!, mobile: f.mobile, roleId: role!.id });
        if (f.email !== null && f.email !== (row.email ?? "").toLowerCase()) emailChange = { id, email: f.email };
        const after = { name: saved.displayName, username: saved.username, mobile: saved.mobile ?? "", role: saved.roleName, email: emailChange ? f.email! : before.email };
        const changes = Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== (before as Record<string, string>)[k]).map(([k, v]) => [k, { from: (before as Record<string, string>)[k], to: v }]));
        if (Object.keys(changes).length > 0) await audit(repos, session, meta, "user.updated", saved, changes);
        if (role!.id !== row.roleId) await repos.users.endSessions(id, "admin", now());
        return { saved, changed: Object.keys(changes).length > 0 };
      });
      if (emailChange) {
        const result = await credentials.changeEmail((emailChange as { id: string; email: string }).id, (emailChange as { id: string; email: string }).email);
        if (!result.ok) throw new AppError("VALIDATION_FAILED", result.message, { fields: { email: result.message } });
      }
      return platform.run(async (repos) => ({ user: (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0], message: done.changed || emailChange ? `Account @${done.saved.username} updated.` : "No changes to save." }));
    },

    /** toggleActive (:142-151): signed out of everywhere when deactivated. */
    async toggle(session: VerifiedSession, id: string, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "edit");
      return platform.run(async (repos) => {
        const row = await target(repos, session, id);
        assertManage(session, row);
        const next = row.status === "disabled" ? "active" : "disabled";
        await repos.users.setMemberStatus(session.hotelId, id, next);
        if (next === "disabled") await repos.users.endSessions(id, "admin", now());
        await audit(repos, session, meta, next === "active" ? "user.activated" : "user.deactivated", row);
        return { user: (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0], message: `@${row.username} is now ${next === "active" ? "active" : "deactivated"}.` };
      });
    },

    /** unlock (:178-199): clears the block, any lock and the wait on emailed codes. */
    async unlock(session: VerifiedSession, id: string, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "edit");
      return platform.run(async (repos) => {
        const row = await target(repos, session, id);
        assertManage(session, row);
        await repos.users.unlock(id, { by: session.userId, hotelId: session.hotelId || null, ip: meta.ip, at: now() });
        await audit(repos, session, meta, "user.unlocked", row);
        return { user: (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0], message: `@${row.username} can sign in again.` };
      });
    },

    /** resetPassword (:201-230): a new password is emailed by the credential side; the person must replace it. Needs the `users.password` ability. */
    async resetPassword(session: VerifiedSession, id: string, meta: RequestMeta): Promise<UserActionResult> {
      requirePermission(session, catalog, USERS, "edit");
      if (!can(session, catalog, "users.password", "view")) throw new AppError("FORBIDDEN", "Your account cannot reset someone else's password.");
      const row = await platform.run(async (repos) => {
        const r = await target(repos, session, id);
        assertManage(session, r);
        if (!r.email) throw new AppError("CONFLICT", `@${r.username} has no email address, so a new password cannot be sent. Add one first.`);
        return r;
      });
      const sent = await credentials.adminResetPassword(id);
      return platform.run(async (repos) => {
        await repos.users.endSessions(id, "admin", now());
        await audit(repos, session, meta, "user.password_reset", row, { emailed: sent.queued });
        return {
          user: (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0],
          message: sent.queued ? `A new password has been emailed to ${row.email}. @${row.username} must replace it when they sign in.` : `The password was reset but the email could not be sent to ${row.email}. Check the mail settings and reset again.`,
        };
      });
    },

    /**
     * Decision 47: link a guest or company portal account to a record of THIS hotel (user_hotels.subject_kind/subject_id), so its portal opens. The record must exist and be
     * active; the account must be of that portal kind. Needs Edit on the users screen and rank over the account; audited without any secret. Answers the user.
     */
    async portalLink(session: VerifiedSession, id: string, input: { kind: "guest" | "company"; recordId: string }, meta: RequestMeta): Promise<AdminUserDto> {
      requirePermission(session, catalog, USERS, "edit");
      if (!portalRecords) throw new AppError("CONFLICT", "Linking portal accounts is not available on this server.");
      const row = await platform.run(async (repos) => {
        const r = await target(repos, session, id);
        assertManage(session, r);
        return r;
      });
      if (portalKindOf(row.accountRole) !== input.kind) throw new AppError("VALIDATION_FAILED", `This is not a ${input.kind} portal account.`, { fields: { kind: `This is not a ${input.kind} portal account.` } });
      const found = (await portalRecords.describe(session, [{ kind: input.kind, id: input.recordId }])).get(`${input.kind}:${input.recordId}`);
      if (!found) throw new AppError("VALIDATION_FAILED", `That ${input.kind} does not exist in this hotel.`, { fields: { recordId: `That ${input.kind} does not exist in this hotel.` } });
      if (!found.active) throw new AppError("VALIDATION_FAILED", `That ${input.kind} is switched off.`, { fields: { recordId: `That ${input.kind} is switched off.` } });
      return platform.run(async (repos) => {
        await repos.users.setPortal(session.hotelId, id, { kind: input.kind, id: input.recordId });
        await audit(repos, session, meta, "portal.linked", row, { kind: input.kind });
        return (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0];
      });
    },

    /** Decision 47: unlink the portal account (its portal then says "not linked yet"). */
    async portalUnlink(session: VerifiedSession, id: string, meta: RequestMeta): Promise<AdminUserDto> {
      requirePermission(session, catalog, USERS, "edit");
      return platform.run(async (repos) => {
        const r = await target(repos, session, id);
        assertManage(session, r);
        if (portalKindOf(r.accountRole) === null) throw new AppError("VALIDATION_FAILED", "This is not a portal account.");
        await repos.users.setPortal(session.hotelId, id, null);
        await audit(repos, session, meta, "portal.unlinked", r);
        return (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0];
      });
    },

    /** Decision 47: the active guest or company records the picker offers for this account (up to 25, filtered by a typed word). */
    async portalOptions(session: VerifiedSession, id: string, q: string): Promise<{ items: { id: string; name: string; detail: string }[] }> {
      requirePermission(session, catalog, USERS, "edit");
      const row = await platform.run(async (repos) => {
        const r = await target(repos, session, id);
        assertManage(session, r);
        return r;
      });
      const kind = portalKindOf(row.accountRole);
      if (kind === null) throw new AppError("VALIDATION_FAILED", "This is not a portal account.");
      return { items: portalRecords ? await portalRecords.options(session, kind, q) : [] };
    },

    /** destroy (:263-293): the account is closed, never the records it made. Needs Full Access. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, USERS, "full");
      return platform.run(async (repos) => {
        const row = await target(repos, session, id);
        if (row.roleKey === "super_admin") throw new AppError("CONFLICT", "The SuperAdmin account cannot be deleted. Transfer the SuperAdmin role to an Admin first.");
        if (!rankOk(session, row)) throw new AppError("FORBIDDEN", "You are not allowed to delete this account.");
        await repos.users.endSessions(id, "admin", now());
        await repos.users.close(id, session.userId, now());
        await audit(repos, session, meta, "user.deleted", row, { role: row.roleName, name: row.displayName });
        return { id, message: "Account closed. Any entries they recorded are kept." };
      });
    },

    /** userOverride (AccessController :163-210): one module or part given to, or taken from, one person on top of their role; null clears it. */
    async setOverride(session: VerifiedSession, id: string, input: OverrideBody, meta: RequestMeta): Promise<AdminUserDto> {
      requirePermission(session, catalog, "access", "edit");
      return platform.run(async (repos) => {
        const row = await target(repos, session, id);
        checkOverride(session, row, input.module, input.level);
        await repos.overrides.set(session.hotelId, id, input.module, input.level, session.userId);
        await audit(repos, session, meta, input.level === null ? "user.permission.clear" : input.level === "none" ? "user.permission.revoke" : "user.permission.grant", row, { permission: input.module, level: input.level });
        return (await dto(repos, session, [(await repos.users.get(session.hotelId, id))!]))[0];
      });
    },
  };
}

void LEVELS;
export type UserService = ReturnType<typeof createUserService>;
