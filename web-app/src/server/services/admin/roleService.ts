import "server-only";
import type { Catalog } from "../../auth/catalog";
import { isDerivedAbility } from "../../auth/access";
import { isLevel, reaches, type Level } from "../../auth/levels";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AdminRoleRow, AdminUsersRepos, AdminUsersUnit, Grant } from "../../repos/adminUsers";
import { Rules } from "../payrollCore/validate";
import type { RoleBody, RoleOrderBody } from "./userSchemas";
import { matchWords } from "../../validation/listQuery";

// Roles and what each rung may do (Pallav AccessController). Reading needs the `access` module at view; changing anything needs edit, and no account
// may hand out something it does not already hold. Pallav's per-action ticks are MJ's four levels here (view, create, edit, full) per module or part.
// The ladder of levels is the order: a custom role starts under the actor's own rung, never above it. Spec: docs/specs/admin.md §7.

const ACCESS = "access";
const SUPER = "super_admin";
/** Pallav's look for a new role when none is chosen. */
const DEFAULT_ICON = "bi-person";
const DEFAULT_ACCENT = "#111114";
const ACCENT = /^#[0-9A-Fa-f]{6}$/;

export const TOP_OF_LADDER_MESSAGE = "SuperAdmin has to stay at the top of the ladder.";
export const EVERY_ROLE_ONCE_MESSAGE = "The order has to name every role exactly once.";
export const SHIPPED_ORDER_MESSAGE = "The roles the system ships with keep their order.";
/** The shipped roles are one row shared by every hotel: a hotel's SuperAdmin may not change them for everyone. */
export const SHIPPED_ROLE_MESSAGE = "The roles the system ships with keep their name, look and permissions. Make a new role for this hotel instead.";

interface AdminRoleDto {
  id: string;
  name: string;
  description: string;
  /** Shipped with the system: cannot be deleted or renamed. */
  builtIn: boolean;
  usersCount: number;
  /** The role's OWN level per module or part (what is ticked on it; the lower rungs' levels it inherits are not listed). */
  levels: Record<string, Level>;
  level: number;
  /** Pallav's look: a Bootstrap Icons class ("bi-person") and a #RRGGBB colour; absent when the role has none. */
  icon?: string;
  accent?: string;
  /** Gets what the rungs below it are allowed. */
  inherits: boolean;
}

interface RoleDeps {
  platform: AdminUsersUnit;
  catalog: Catalog;
  now: () => Date;
}

export function createRoleService(deps: RoleDeps) {
  const { platform, catalog, now } = deps;

  const audit = (repos: AdminUsersRepos, session: VerifiedSession, meta: RequestMeta, action: string, role: Pick<AdminRoleRow, "id" | "name">, detail: Record<string, unknown> | null = null) =>
    repos.audit.write({ actorUserId: session.userId, hotelId: session.hotelId, action, entity: "role", entityId: role.id, traceId: meta.traceId, detail: { role: role.name, ...detail } }, now());

  /** The DTOs of any number of roles from two reads (every role's grants, every role's holders), not two per role. */
  async function dtos(repos: AdminUsersRepos, session: VerifiedSession, roles: readonly AdminRoleRow[]): Promise<AdminRoleDto[]> {
    const ids = roles.map((r) => r.id);
    const grants = await repos.roles.grantsOf(ids);
    const holders = await repos.roles.holdersOf(session.hotelId, ids);
    return roles.map((role) => ({
      id: role.id, name: role.name, description: role.description ?? "", builtIn: role.isSystem, usersCount: holders.get(role.id) ?? 0,
      levels: Object.fromEntries((grants.get(role.id) ?? []).map((g) => [g.key, g.level])), level: role.level,
      ...(role.icon ? { icon: role.icon } : {}), ...(role.accent ? { accent: role.accent } : {}), inherits: role.inherits,
    }));
  }
  const dto = async (repos: AdminUsersRepos, session: VerifiedSession, role: AdminRoleRow): Promise<AdminRoleDto> => (await dtos(repos, session, [role]))[0];

  /** The look fields (AccessController store/update rules `nullable|string|max:40` and the colour regex), Laravel's words. Empty or absent = null. */
  function look(v: Rules, input: RoleBody): { icon: string | null; accent: string | null } {
    const icon = v.text("icon", "icon", input.icon, 40);
    const accent = Rules.clean(input.accent);
    if (accent !== null && !ACCENT.test(accent)) v.fail("accent", "The accent field format is invalid.");
    return { icon, accent };
  }

  /** The rules of togglePermission (:107-148) for one change, in Pallav's words. */
  function checkGrant(session: VerifiedSession, role: AdminRoleRow, key: string, was: Level | undefined, now_: Level | undefined): void {
    const entry = catalog.get(key);
    if (!entry) throw new AppError("VALIDATION_FAILED", "That is not a permission.", { fields: { levels: `${key} is not a permission.` } });
    if (isDerivedAbility(key)) throw new AppError("VALIDATION_FAILED", "That ability is derived from the role and cannot be granted.", { fields: { levels: `${key} is derived from the role and cannot be granted.` } });
    const raised = now_ !== undefined && (was === undefined || !reaches(was, now_));
    if (raised && !can(session, catalog, key, now_)) throw new AppError("VALIDATION_FAILED", "You cannot give away a permission you do not have.");
    if (role.key === SUPER && now_ === undefined && key === ACCESS) throw new AppError("VALIDATION_FAILED", "SuperAdmin has to keep the keys to this screen.");
    // changing roles is the one permission that reaches every other: it stays with the single account that owns the system
    if (key === ACCESS && now_ !== undefined && now_ !== "view" && role.key !== SUPER) {
      throw new AppError("VALIDATION_FAILED", `Only SuperAdmin can change roles and permissions. That is what keeps full access with one account. Give ${role.name} the screens it needs instead.`);
    }
  }

  return {
    /** index (:25-47): the ladder, highest rung first, with how many people hold each role in this hotel. */
    async list(session: VerifiedSession, search?: string): Promise<AdminRoleDto[]> {
      requirePermission(session, catalog, ACCESS, "view");
      return platform.run(async (repos) => matchWords(await dtos(repos, session, await repos.roles.list(session.hotelId)), search, (r) => [r.name, r.description]));
    },

    /** store (:60-87): a new rung under the actor's own, never above; nothing is allowed until it is ticked. */
    async create(session: VerifiedSession, input: RoleBody, meta: RequestMeta): Promise<AdminRoleDto> {
      requirePermission(session, catalog, ACCESS, "edit");
      return platform.run(async (repos) => {
        const v = new Rules();
        const name = v.max("name", "name", v.required("name", "name", input.name), 40);
        if (name !== null && (await repos.roles.nameTaken(session.hotelId, name.trim()))) v.fail("name", "The name has already been taken.");
        const description = v.max("description", "description", Rules.clean(input.description), 500);
        const { icon, accent } = look(v, input);
        v.done();
        // where the new rung goes: asked for, but never at or above the creator's own rung (and never below the bottom one)
        const highest = Math.max(1, session.roleLevel - 1);
        const level = input.level === undefined ? highest : Math.min(Math.max(1, input.level), highest);
        const inherits = input.inherits ?? true;
        const placeholder = { id: "", name: name!.trim(), key: "", hotelId: session.hotelId, level, inherits, isSystem: false, description, icon, accent } as AdminRoleRow;
        const grants = Object.entries(input.levels).map(([key, l]) => ({ key, level: l as Level }));
        for (const g of grants) if (g.level !== ("none" as string)) checkGrant(session, placeholder, g.key, undefined, g.level);
        const role = await repos.roles.create(session.hotelId, { name: name!.trim(), description, level, icon: icon ?? DEFAULT_ICON, accent: accent ?? DEFAULT_ACCENT, inherits });
        await repos.roles.setGrants(role.id, grants.filter((g) => isLevel(g.level)));
        await audit(repos, session, meta, "role.created", role);
        return dto(repos, session, role);
      });
    },

    /**
     * update (:89-105) with the grants of togglePermission: the shipped roles keep their names; each ticked or unticked level is checked and audited.
     * The look (icon, accent) and `inherits` change only when sent (absent or empty = unchanged); SuperAdmin always inherits (as the shipped names stay,
     * silently). `level` is not changed here: the ladder is moved with PUT roles/order.
     */
    async update(session: VerifiedSession, id: string, input: RoleBody, meta: RequestMeta): Promise<AdminRoleDto> {
      requirePermission(session, catalog, ACCESS, "edit");
      return platform.run(async (repos) => {
        const role = await repos.roles.get(session.hotelId, id);
        if (!role) throw new AppError("NOT_FOUND");
        // a FULL Enter-hotel visit (platform 0135) never touches the hotel's own owner role, whatever else the visitor may change
        if (session.visit && role.key === SUPER) throw new AppError("FORBIDDEN", "The hotel's SuperAdmin role cannot be changed during a visit.");
        const v = new Rules();
        const name = v.max("name", "name", v.required("name", "name", input.name), 40);
        if (!role.isSystem && name !== null && (await repos.roles.nameTaken(session.hotelId, name.trim(), id))) v.fail("name", "The name has already been taken.");
        const description = v.max("description", "description", Rules.clean(input.description), 500);
        const { icon, accent } = look(v, input);
        v.done();
        if (role.isSystem || role.hotelId === null) {
          // shared by every hotel (roles.hotel_id IS NULL): the same values are accepted and nothing is written; any change is refused
          const before = new Map((await repos.roles.grants(id)).map((g) => [g.key, g.level as string]));
          const wanted = Object.entries(input.levels).filter(([, l]) => isLevel(l));
          const grantsChanged = wanted.length !== before.size || wanted.some(([k, l]) => before.get(k) !== l);
          const changed: string[] = [];
          if (name!.trim() !== role.name) changed.push("name");
          if (description !== null && description !== (role.description ?? null)) changed.push("description");
          if (icon !== null && icon !== role.icon) changed.push("icon");
          if (accent !== null && accent !== role.accent) changed.push("accent");
          if (input.inherits !== undefined && input.inherits !== role.inherits) changed.push("inherits");
          if (input.level !== undefined && input.level !== role.level) changed.push("level");
          if (grantsChanged) changed.push("levels");
          if (changed.length) throw new AppError("CONFLICT", SHIPPED_ROLE_MESSAGE, { fields: Object.fromEntries(changed.map((f) => [f, SHIPPED_ROLE_MESSAGE])) });
          return dto(repos, session, role);
        }
        const inherits = role.key === SUPER || input.inherits === undefined ? undefined : input.inherits;
        const lookChanges = Object.fromEntries(
          ([["icon", icon, role.icon], ["accent", accent, role.accent], ["inherits", inherits, role.inherits]] as const).filter(([, next, was]) => next !== null && next !== undefined && next !== was).map(([k, next, was]) => [k, { from: was, to: next }]),
        );
        const before = new Map((await repos.roles.grants(id)).map((g) => [g.key, g.level]));
        const wanted = new Map(Object.entries(input.levels).filter(([, l]) => isLevel(l)).map(([k, l]) => [k, l as Level]));
        const keys = new Set([...before.keys(), ...Object.keys(input.levels)]);
        for (const key of keys) {
          const was = before.get(key);
          const is = wanted.get(key);
          if (was === is) continue;
          checkGrant(session, role, key, was, is);
          await audit(repos, session, meta, is === undefined ? "role.permission.revoked" : "role.permission.granted", role, { permission: key, level: is ?? null });
        }
        const next: Grant[] = [...wanted].map(([key, level]) => ({ key, level }));
        await repos.roles.setGrants(id, next);
        const saved = await repos.roles.update(id, {
          name: role.isSystem ? role.name : name!.trim(), description,
          ...(icon !== null ? { icon } : {}), ...(accent !== null ? { accent } : {}), ...(inherits !== undefined ? { inherits } : {}),
        });
        await audit(repos, session, meta, "role.updated", saved, Object.keys(lookChanges).length ? lookChanges : null);
        return dto(repos, session, saved);
      });
    },

    /**
     * reorder (AccessController::reorder): the whole ladder, top rung first, every role of this hotel exactly once. SuperAdmin stays at the top and the
     * shipped roles keep their order; each custom role takes the level of the shipped rung just below it (the bottom rung's level when it sits below
     * Viewer), and never reaches the actor's own rung. HMS deviation: levels are shared with the shipped rungs, so custom roles on one rung are listed by
     * name, not in the order sent. One audit line `role.reordered`. Answers the ladder as GET roles does.
     */
    async reorder(session: VerifiedSession, input: RoleOrderBody, meta: RequestMeta): Promise<AdminRoleDto[]> {
      requirePermission(session, catalog, ACCESS, "edit");
      return platform.run(async (repos) => {
        const roles = await repos.roles.list(session.hotelId);
        const byId = new Map(roles.map((r) => [r.id, r]));
        const fail = (message: string): never => {
          throw new AppError("VALIDATION_FAILED", message, { fields: { order: message } });
        };
        if (input.order.length !== roles.length || new Set(input.order).size !== input.order.length || input.order.some((x) => !byId.has(x))) fail(EVERY_ROLE_ONCE_MESSAGE);
        const wanted = input.order.map((x) => byId.get(x)!);
        if (wanted[0].key !== SUPER) fail(TOP_OF_LADDER_MESSAGE);
        const shippedNow = roles.filter((r) => r.isSystem).sort((a, b) => b.level - a.level).map((r) => r.id);
        const shippedWanted = wanted.filter((r) => r.isSystem).map((r) => r.id);
        if (shippedNow.join() !== shippedWanted.join()) fail(SHIPPED_ORDER_MESSAGE);

        const bottom = Math.min(...roles.filter((r) => r.isSystem).map((r) => r.level));
        const moved: { id: string; name: string; from: number; to: number }[] = [];
        for (let i = 0; i < wanted.length; i++) {
          const r = wanted[i];
          if (r.isSystem) continue;
          const below = wanted.slice(i + 1).find((x) => x.isSystem);
          const level = below ? below.level : bottom;
          if (level >= session.roleLevel) fail("You cannot place a role at or above your own.");
          if (level !== r.level) moved.push({ id: r.id, name: r.name, from: r.level, to: level });
        }
        for (const m of moved) await repos.roles.update(m.id, { level: m.to });
        await repos.audit.write(
          { actorUserId: session.userId, hotelId: session.hotelId, action: "role.reordered", entity: "role", entityId: null, traceId: meta.traceId, detail: { order: wanted.map((r) => r.name), moved: moved.map(({ name, from, to }) => ({ role: name, from, to })) } },
          now(),
        );
        return dtos(repos, session, await repos.roles.list(session.hotelId));
      });
    },

    /** destroy (:149-168): the shipped roles stay; a role people still hold must be emptied first. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, ACCESS, "edit");
      return platform.run(async (repos) => {
        const role = await repos.roles.get(session.hotelId, id);
        if (!role) throw new AppError("NOT_FOUND");
        if (role.isSystem) throw new AppError("CONFLICT", "The four roles the system ships with cannot be deleted.");
        const holders = await repos.roles.holders(session.hotelId, id);
        if (holders > 0) throw new AppError("CONFLICT", `${holders} ${holders === 1 ? "account" : "accounts"} still use ${role.name}. Move them first.`);
        await repos.roles.remove(id);
        await audit(repos, session, meta, "role.deleted", role);
        return { id, message: `Role ${role.name} deleted.` };
      });
    },
  };
}

export type RoleService = ReturnType<typeof createRoleService>;
