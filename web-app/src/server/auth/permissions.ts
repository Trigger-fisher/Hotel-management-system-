import "server-only";
import { AppError } from "../errors";
import { portalNotLinked } from "../errors/portal";
import { isDerivedAbility } from "./access";
import type { Catalog } from "./catalog";
import { maxLevel, minLevel, reaches, type Level } from "./levels";
import type { RecordScope, VerifiedSession } from "./session";

// The permission engine: MJ's four levels on Pallav's modules and parts.
//
// Pallav (app/Support/Access.php effective(), Permissions::expand()) works in three steps, and this follows them exactly:
//   1. start from the role's grants (its own plus every role below it that it inherits from);
//   2. apply the person's own overrides: a grant adds, a revoke removes that exact permission before the module is spread;
//   3. spread each module over its parts ("a module's own permission stands for all of it"), then remove again every part that
//      was revoked by name, so a part taken away stays taken away even when the module as a whole is still theirs.
// Pallav's grants are per ACTION; here each is one LEVEL (view < create < edit < full), so "spreading" a module at level L gives
// each part min(L, the highest level that part offers), and an explicit grant on a part adds to it.

export interface Grant {
  key: string;
  level: Level;
}

/** A person's own override in ONE hotel (platform.user_permissions: hotel_id, permission, level, granted). */
export interface UserOverride extends Grant {
  granted: boolean;
}

/** A user_permissions row as stored: scoped to one hotel (A5). */
interface UserOverrideRow extends UserOverride {
  hotelId: string;
}

/** Only the person's rows for the hotel being signed in to: a grant or revoke made for hotel A never reaches hotel B. */
export function overridesForHotel(rows: readonly UserOverrideRow[], hotelId: string): UserOverride[] {
  return rows.filter((r) => r.hotelId === hotelId).map(({ key, level, granted }) => ({ key, level, granted }));
}

interface SnapshotInput {
  catalog: Catalog;
  /** The role's grants with inheritance from lower roles already folded in (the highest level per key). */
  roleGrants: readonly Grant[];
  /** Only the rows of the hotel being signed in to (user_permissions.hotel_id = session hotel). */
  userOverrides: readonly UserOverride[];
}

/**
 * The key of a role grant or a per-person override must be a real catalog row and never a derived ability (system.recycle comes from
 * the hotel role alone). Called by the services that store grants; throws a validation error naming the field, never a value.
 */
export function assertGrantableKey(catalog: Catalog, key: string): void {
  if (isDerivedAbility(key) || !catalog.get(key)) throw new AppError("VALIDATION_FAILED", "That permission cannot be granted", { fields: { key: "not a grantable permission" } });
}

/** The effective level per module/part/ability key. Keys the catalog does not know are ignored (a stale row never grants anything). */
export function buildPermissionSnapshot(input: SnapshotInput): Record<string, Level> {
  const { catalog } = input;
  const raw = new Map<string, Level>();
  const add = (key: string, level: Level): void => {
    if (!catalog.get(key)) return;
    const have = raw.get(key);
    raw.set(key, have ? maxLevel(have, level) : level);
  };
  for (const grant of input.roleGrants) add(grant.key, grant.level);

  // step 2: the person's own changes come first, so taking away "payroll" also takes away what it would spread to
  for (const o of input.userOverrides) {
    if (o.granted) add(o.key, o.level);
    else raw.delete(o.key);
  }

  // step 3: spread modules over their parts, each capped by what the part offers
  const effective = new Map<string, Level>();
  for (const [key, level] of raw) {
    const entry = catalog.get(key);
    if (!entry) continue;
    effective.set(key, minLevel(level, entry.offers));
    if (entry.kind === "module") {
      for (const part of catalog.partsOf(key)) {
        const spread = minLevel(level, part.offers);
        const have = effective.get(part.key);
        effective.set(part.key, have ? maxLevel(have, spread) : spread);
      }
    }
  }
  // a part revoked by name stays revoked even when its module is still held
  for (const o of input.userOverrides) if (!o.granted) effective.delete(o.key);

  return Object.fromEntries(effective);
}

/** What the session may do on this key, or null. */
export function effectiveLevel(session: Pick<VerifiedSession, "permissions">, key: string): Level | null {
  return Object.hasOwn(session.permissions, key) ? session.permissions[key] : null;
}

/**
 * May the session do `need` on `key`? `need` is capped by what the key offers, so "full" on a part that only offers View and Edit
 * means everything it offers (Pallav: full = every action the part has). Unknown keys are never allowed.
 */
export function can(session: Pick<VerifiedSession, "permissions">, catalog: Catalog, key: string, need: Level): boolean {
  const entry = catalog.get(key);
  if (!entry) return false;
  const have = effectiveLevel(session, key);
  return have !== null && reaches(have, minLevel(need, entry.offers));
}

/** Throws FORBIDDEN (403) unless the session may do `need` on `key`. The message names nothing the caller cannot already see. */
export function requirePermission(session: Pick<VerifiedSession, "permissions">, catalog: Catalog, key: string, need: Level): void {
  if (!can(session, catalog, key, need)) throw new AppError("FORBIDDEN");
}

/** Does the session hold create or edit (or more) on anything? Pallav Access::writes(): "anything at all this account can add or change". */
export function canWriteAnything(session: Pick<VerifiedSession, "permissions">): boolean {
  return Object.values(session.permissions).some((level) => reaches(level, "create"));
}

/**
 * Guest and corporate accounts have no module rows at all: `can` is false for them on every key. They see only the records of the
 * company or guest their account points at. Staff (everyone else) are not scoped by record.
 */
/** Is this a guest or company portal account (it reaches only its own records)? Never throws. */
export const isPortalAccount = (session: Pick<VerifiedSession, "accountRole">): boolean => session.accountRole === "guest_user" || session.accountRole === "corporate_user";

export function recordScopeOf(session: Pick<VerifiedSession, "accountRole" | "scope">): RecordScope | null {
  if (session.accountRole !== "guest_user" && session.accountRole !== "corporate_user") return null;
  // decision 47: a portal account with no record behind it is told so (409), not refused (403)
  if (!session.scope) throw portalNotLinked(session.accountRole === "guest_user" ? "guest" : "company");
  return session.scope;
}
