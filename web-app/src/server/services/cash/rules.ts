import "server-only";
import { SUPER_ADMIN_ROLE_KEY, isHotelSuperAdmin } from "../../auth/access";
import type { Catalog } from "../../auth/catalog";
import { can, canWriteAnything } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { Person } from "./ports";

// Who may do what to a cash entry. A port of Pallav's CashLedger::editable / blocked and the User role helpers (Models/User.php
// 137-238), over the permission engine instead of Pallav's role names:
//   admin        = may see the users module (Pallav: can('users.view'))
//   super admin  = the hotel's built-in permission role super_admin (roles.key, level 4), NOT the account role: the platform owner's account role super_admin is a different thing
//   can write    = holds create or edit on anything (Access::writes)
//   manage(owner)= super admin always; admin unless the owner is a super admin; anyone else only their own entry; an unknown owner: admin only
type Who = Pick<VerifiedSession, "permissions" | "roleKey" | "roleLevel" | "userId" | "forceMode">;

export const isAdmin = (s: Who, catalog: Catalog): boolean => can(s, catalog, "users", "view");
export const SUPER_ADMIN_ROLE = SUPER_ADMIN_ROLE_KEY;
export const isSuperAdmin = isHotelSuperAdmin;
export const canBackdate = (s: Who, catalog: Catalog): boolean => can(s, catalog, "system.backdate", "view");

/** Force mode: the super admin holds the ability and has armed it for this session. */
export const forceOn = (s: Who, catalog: Catalog): boolean => isSuperAdmin(s) && s.forceMode === true && can(s, catalog, "system.force", "view");

export function canManage(s: Who, catalog: Catalog, owner: Person | null): boolean {
  if (owner === null) return isAdmin(s, catalog);
  if (isSuperAdmin(s)) return true;
  // an admin never reaches over a super admin: only entries of people at or below their own level
  if (isAdmin(s, catalog)) return owner.roleKey !== SUPER_ADMIN_ROLE && owner.roleLevel <= s.roleLevel;
  return s.userId === owner.id;
}

interface EditDecision {
  allowed: boolean;
  /** Allowed only because force mode is on: the caller writes the force log. */
  viaForce: boolean;
  /** The refusal text when not allowed. */
  refusal: string | null;
}

/** RevenueController::update: the newest entry of its book, by someone allowed to manage it, or any entry under force mode. */
export function editDecision(s: Who & Pick<VerifiedSession, "permissions">, catalog: Catalog, input: { recordId: string; newestId: string | null; owner: Person | null }, noun = "deposit"): EditDecision {
  const isNewest = input.recordId === input.newestId;
  const everyday = canWriteAnything(s) && canManage(s, catalog, input.owner) && isNewest;
  if (everyday) return { allowed: true, viaForce: false, refusal: null };
  if (forceOn(s, catalog)) return { allowed: true, viaForce: true, refusal: null };
  return { allowed: false, viaForce: false, refusal: isNewest ? `You are not allowed to edit this ${noun}.` : `Only the latest ${noun} in a book can be edited.` };
}

/** CashLedger::deleteRefusal: why a delete is refused, or null. */
export function deleteRefusal(s: Who, catalog: Catalog, owner: Person | null): string | null {
  if (!isAdmin(s, catalog)) return "Only an Admin or the SuperAdmin can delete an entry.";
  if (!canManage(s, catalog, owner)) return "You are not allowed to delete this entry.";
  return null;
}
