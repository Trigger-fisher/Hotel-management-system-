import "server-only";
import type { Catalog } from "./catalog";
import type { Grant } from "./permissions";
import { rankOf, type Level } from "./levels";

// What a role holds once the roles below it are folded in. A port of Pallav's Role::effectiveRaw() / below() (Models/Role.php:62-100):
// a role holds its own grants; while it `inherits`, it also holds those of every rung below it, nearest first, and the walk stops after a
// rung that does not inherit ("that rung does not pass anything further up"). The ladder is every role of the hotel (the built-in ones and
// the hotel's own), highest level first.
interface LadderRole {
  id: string;
  key: string;
  level: number;
  inherits: boolean;
}

export function foldRoleGrants(role: LadderRole, ladder: readonly LadderRole[], ownGrants: (roleId: string) => readonly Grant[]): Grant[] {
  const grants: Grant[] = [...ownGrants(role.id)];
  if (role.inherits) {
    const below = ladder.filter((r) => r.level < role.level).sort((a, b) => b.level - a.level);
    for (const lower of below) {
      grants.push(...ownGrants(lower.id));
      if (!lower.inherits) break;
    }
  }
  return grants;
}

/** The role key of Pallav's SuperAdmin (the top rung of a hotel's ladder). NOT the platform owner's account role of the same name. */
export const SUPER_ADMIN_ROLE_KEY = "super_admin";

/** The ability the apps read to show the recycle bin (ui-shared ABILITY.recycleBin). DERIVED from the hotel role, never granted. */
export const RECYCLE_ABILITY = "system.recycle";

/** Abilities that exist only as a derivation (never a catalog row, never grantable through user_permissions). */
const DERIVED_ABILITIES: readonly string[] = [RECYCLE_ABILITY];

/** Is this person the hotel's SuperAdmin in THIS hotel? Decided by the hotel role key of the verified session, never by the account role. */
export const isHotelSuperAdmin = (session: { readonly roleKey: string }): boolean => session.roleKey === SUPER_ADMIN_ROLE_KEY;

/**
 * Recycle bin: list deleted records, restore, delete for ever. Pallav has no permission for it: its RecycleBinController is behind the
 * "superadmin only" middleware. This ONE predicate is the UI's hint (`system.recycle` in user.abilities) AND the server's enforcement on
 * every recycle-bin list, restore and purge route, so the two can never disagree.
 */
export const canUseRecycleBin = (session: { readonly roleKey: string }): boolean => isHotelSuperAdmin(session);

/** True for a key that is derived and so can never be stored as a grant (a role grant or a per-person override). */
export const isDerivedAbility = (key: string): boolean => DERIVED_ABILITIES.includes(key);

/**
 * The one-off abilities (users.password, system.backdate, system.force, ...) held in the permission snapshot, plus the derived ones
 * (system.recycle, from the hotel role): sent to the apps in `user.abilities`. Derived abilities never come from the snapshot.
 */
export function abilitiesOf(permissions: Readonly<Record<string, Level>>, catalog: Catalog, role?: { readonly roleKey: string }): string[] {
  const held = Object.keys(permissions).filter((key) => catalog.get(key)?.kind === "ability" && !isDerivedAbility(key));
  if (role && canUseRecycleBin(role)) held.push(RECYCLE_ABILITY);
  return held.sort();
}

/**
 * The module levels a signed-in hotel person holds, for the apps' menus (`user.grants`): per catalog MODULE the highest level held on the module itself or on
 * any of its parts, as the apps' three words (view, edit, full; "create" counts as edit). A module with no level is left out. The hotel SuperAdmin holds
 * everything, so `undefined` is returned for it (the apps then filter nothing); the server still checks every request (403).
 */
export function moduleGrantsOf(permissions: Readonly<Record<string, Level>>, catalog: Catalog, role?: { readonly roleKey: string }): Record<string, "view" | "edit" | "full"> | undefined {
  if (role && isHotelSuperAdmin(role)) return undefined;
  const out: Record<string, "view" | "edit" | "full"> = {};
  for (const entry of catalog.entries) {
    if (entry.kind !== "module") continue;
    let best: Level | null = null;
    for (const key of [entry.key, ...catalog.partsOf(entry.key).map((p) => p.key)]) {
      const have = Object.hasOwn(permissions, key) ? permissions[key] : null;
      if (have && (best === null || rankOf(have) > rankOf(best))) best = have;
    }
    if (best) out[entry.key] = best === "view" ? "view" : best === "full" ? "full" : "edit";
  }
  return out;
}
