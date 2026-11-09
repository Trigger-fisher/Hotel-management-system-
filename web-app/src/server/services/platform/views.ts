import "server-only";
import type {
  PlatformActivity, PlatformActivityAction, PlatformAdminStatus, PlatformGroup, PlatformGroupStatus, PlatformHotel, PlatformHotelAdmin, PlatformHotelSettings,
  PlatformHotelStatus, PlatformOnboardingSummary, PlatformStaff, PlatformUser, PlatformUserLevel,
} from "@shared/dashboards/platform";
import { gstCodeOfState, platformCopy } from "@shared/dashboards/platform";
import type { AccountRole } from "../../auth/session";
import type { OnboardingRow, PlatformAccountRow, PlatformActivityRow, PlatformGroupRow, PlatformHotelRow } from "../../repos/platformConsole";
import { inGrace } from "./lifecycle";

// The contract's DTOs (ui-shared/dashboards/platform.ts) made from the platform rows. Nothing here reads a hotel's own data: the Settings tab shows
// what the platform knows (GSTIN, state, city, time zone) and the platform's default GST percent for new hotels.

const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const LISTED: readonly PlatformHotelStatus[] = ["active", "suspended", "pending_approval", "rejected", "archived"];

/** "+919824012345" -> "9824012345" (the contract's 10 digits). */
const tenDigits = (mobile: string | null): string => (mobile ?? "").replace(/^\+91/, "");

export function hotelStatusOf(row: Pick<PlatformHotelRow, "status">): PlatformHotelStatus {
  return (LISTED as readonly string[]).includes(row.status) ? (row.status as PlatformHotelStatus) : "pending_approval";
}

export function hotelView(h: PlatformHotelRow, now: Date): PlatformHotel {
  const status = hotelStatusOf(h);
  return {
    id: h.id, name: h.name, slug: h.slug, city: h.city ?? "", state: h.state ?? "", gstin: h.gstin ?? "", timeZone: h.timeZone, status,
    groupId: h.groupId, groupName: h.groupName, adminCount: h.adminCount, lockedAdminCount: h.lockedAdminCount, createdAt: h.createdAt.toISOString(),
    suspendedAt: isoOrNull(h.suspendedAt), suspendReason: h.suspendReason, kind: h.groupId ? "group" : "individual",
    submittedAt: isoOrNull(h.submittedAt), invitationId: h.invitationId, approvedAt: isoOrNull(h.approvedAt), rejectedAt: isoOrNull(h.rejectedAt), rejectReason: h.rejectReason,
    archivedAt: isoOrNull(h.archivedAt), archiveReason: h.archiveReason,
    ...(status === "archived" ? { canRestore: inGrace(h, now), restoresTo: h.statusBeforeArchive ?? "active" } : {}),
  };
}

export function settingsView(h: PlatformHotelRow, gstPercent: number): PlatformHotelSettings {
  const state = h.state ?? "";
  return {
    gstin: h.gstin ?? "", stateCode: gstCodeOfState(state) ?? (h.gstin ?? "").slice(0, 2), state, city: h.city ?? "", timeZone: h.timeZone,
    gstDefaults: { roomsPercent: gstPercent, foodPercent: gstPercent }, accountingYearStartMonth: 4,
  };
}

const locked = (a: PlatformAccountRow, now: Date): boolean => a.blocked || (a.lockedUntil !== null && a.lockedUntil > now);

/** pending > disabled > locked > active (an invited account that has not chosen its password yet is shown active). */
export function accountStatus(a: PlatformAccountRow, now: Date): PlatformAdminStatus {
  if (a.status === "pending_approval") return "pending";
  if (a.status === "disabled" || a.memberDisabled) return "disabled";
  if (locked(a, now)) return "locked";
  return "active";
}

export function adminView(a: PlatformAccountRow, now: Date): PlatformHotelAdmin {
  const status = accountStatus(a, now);
  return {
    id: a.id, hotelId: a.hotelId ?? "", hotelName: a.hotelName ?? "", name: a.displayName, username: a.username, email: a.email ?? "", mobile: tenDigits(a.mobile),
    status, lastSignInAt: isoOrNull(a.lastLoginAt), lockedAt: status === "locked" ? (isoOrNull(a.lockedAt) ?? isoOrNull(a.lockedUntil)) : null, createdAt: a.createdAt.toISOString(),
    groupAdminOf: a.groupAdminOf,
  };
}

const LEVEL: Partial<Record<AccountRole, PlatformUserLevel>> = {
  super_admin: "super_admin", platform_admin: "platform_admin", group_hotel_admin: "group_admin", hotel_admin: "hotel_admin", hotel_user: "hotel_user",
};
export const levelOf = (role: AccountRole): PlatformUserLevel | null => LEVEL[role] ?? null;

export function userView(a: PlatformAccountRow, now: Date): PlatformUser {
  const status = accountStatus(a, now);
  return {
    id: a.id, name: a.displayName, username: a.username, email: a.email ?? "", mobile: tenDigits(a.mobile), level: levelOf(a.accountRole) ?? "hotel_user",
    hotelId: a.hotelId, hotelName: a.hotelName, groupId: a.groupId, groupName: a.groupName, status, lastSignInAt: isoOrNull(a.lastLoginAt),
    lockedAt: status === "locked" ? (isoOrNull(a.lockedAt) ?? isoOrNull(a.lockedUntil)) : null, createdAt: a.createdAt.toISOString(),
  };
}

export function staffView(a: PlatformAccountRow, now: Date, actorId: string): PlatformStaff {
  const status = accountStatus(a, now);
  return {
    id: a.id, name: a.displayName, username: a.username, email: a.email ?? "", mobile: tenDigits(a.mobile), role: "platform_admin",
    status: status === "pending" ? "active" : status, lastSignInAt: isoOrNull(a.lastLoginAt), lockedAt: status === "locked" ? (isoOrNull(a.lockedAt) ?? isoOrNull(a.lockedUntil)) : null,
    createdAt: a.createdAt.toISOString(), isYou: a.id === actorId,
  };
}

const GROUP_LISTED: readonly PlatformGroupStatus[] = ["pending_approval", "active", "rejected"];
const groupListed = (g: PlatformGroupRow): boolean => (GROUP_LISTED as readonly string[]).includes(g.status);

/** maxHotels: the platform's limit for the group (platform migration 0133; null = none). */
export function groupView(g: PlatformGroupRow, maxHotels: number | null = null): PlatformGroup {
  return {
    id: g.id, name: g.name, hotelIds: [...g.hotelIds], hotelCount: g.hotelIds.length,
    groupAdmin: g.admin ? { adminId: g.admin.id, name: g.admin.displayName, username: g.admin.username, hotelName: g.admin.accountRole === "hotel_admin" ? (g.admin.hotelName ?? "") : "" } : null,
    createdAt: g.createdAt.toISOString(), status: groupListed(g) ? (g.status as PlatformGroupStatus) : "active",
    legalName: g.legalName, gstin: g.gstin, address: g.address, city: g.city, state: g.state, pin: g.pin, phone: g.phone, email: g.email,
    invitationId: g.invitationId, submittedAt: isoOrNull(g.submittedAt), approvedAt: isoOrNull(g.approvedAt), rejectedAt: isoOrNull(g.rejectedAt), rejectReason: g.rejectReason,
    maxHotels,
  };
}

const A = platformCopy.activity;

/** The activity sentence, from the action and the snapshots kept on the audit row (the contract's platformCopy.activity words). */
export function activityText(action: PlatformActivityAction, x: { hotel: string; group: string; target: string; reason: string | null }): string {
  const { hotel: hn, group: gn, target: an, reason } = x;
  switch (action) {
    // a hotel a group created itself names who did ("Created by group Sunrise Group (group admin Gita Rao)") so the Super Admin sees it on the Dashboard and in Activity
    case "hotel_created": return reason ? `${A.hotelCreated(hn)} ${reason}.` : A.hotelCreated(hn);
    case "hotel_suspended": return A.hotelSuspended(hn, reason);
    case "hotel_reactivated": return A.hotelReactivated(hn);
    case "hotel_entered": return A.hotelEntered(hn, reason);
    case "hotel_exited": return A.hotelExited(hn);
    case "hotel_visit_extended": return A.hotelVisitExtended(hn);
    case "platform_admin_access_changed": return A.platformAdminAccessChanged(an);
    case "admin_created": return A.adminCreated(an, hn);
    case "admin_password_reset": return A.adminPasswordReset(an);
    case "admin_unlocked": return A.adminUnlocked(an);
    case "admin_disabled": return A.adminDisabled(an);
    case "admin_enabled": return A.adminEnabled(an);
    case "admin_locked": return A.adminLocked(an);
    case "group_created": return A.groupCreated(gn);
    case "group_hotel_added": return A.groupHotelAdded(hn, gn);
    case "group_hotel_removed": return A.groupHotelRemoved(hn, gn);
    case "group_admin_set": return A.groupAdminSet(an, gn);
    case "group_admin_cleared": return A.groupAdminCleared(gn);
    case "hotel_submitted": return A.hotelSubmitted(hn);
    case "hotel_approved": return A.hotelApproved(hn);
    case "hotel_rejected": return A.hotelRejected(hn, reason);
    case "hotel_archived": return A.hotelArchived(hn, reason);
    case "hotel_restored": return A.hotelRestored(hn);
    case "group_submitted": return A.groupSubmitted(gn);
    case "group_approved": return A.groupApproved(gn);
    case "group_rejected": return A.groupRejected(gn, reason);
    case "invitation_sent": return A.invitationSent(an, "");
    case "invitation_resent": return A.invitationResent(an, "");
    case "invitation_opened": return A.invitationOpened(an);
    case "invitation_cancelled": return A.invitationCancelled(an);
    case "user_disabled": return A.userDisabled(an);
    case "user_enabled": return A.userEnabled(an);
    case "user_password_reset": return A.userPasswordReset(an);
    case "user_unlocked": return A.userUnlocked(an);
    case "staff_created": return platformCopy.platformStaff.logCreated(an);
    case "health_checked": return platformCopy.platformHealth.logChecked(reason ?? "");
    case "settings_updated": return platformCopy.platformSettings.logUpdated(reason ?? "");
    case "announcement_created": return platformCopy.announcements.logCreated(reason ?? "");
    case "announcement_ended": return platformCopy.announcements.logEnded(reason ?? "");
    case "hotel_exported": return platformCopy.archivedHotels.logExported(hn, reason ?? "");
    case "hotel_deleted": return platformCopy.archivedHotels.logDeleted(hn);
    // the two actions the contract has labels for but no sentence (a contract request): ours
    case "audit_exported": return `Exported the audit log${reason ? ` (${reason})` : ""}.`;
    case "hotel_write_started": return `About to change something inside ${hn || "a hotel"} during a full-access visit${reason ? `: ${reason}` : ""}.`;
    case "hotel_write": return `Changed something inside ${hn || "a hotel"} during a full-access visit${reason ? `: ${reason}` : ""}.`;
    case "hotel_write_refused": return `Tried to change something inside ${hn || "a hotel"} while only viewing it${reason ? `: ${reason}` : ""}.`;
    // API access keys: the target is the key's name (made, revoked) or the call ("POST /api/v1/..."); the reason is the answer, the refusal or the new address
    case "api_token_created": return `Made the API key ${an}${reason ? ` (${reason})` : ""}.`;
    case "api_token_revoked": return `Revoked ${an === "" ? "an API key" : an.startsWith("Every key") ? an.replace("Every key", "every API key") : `the API key ${an}`}${reason ? `: ${reason}` : ""}.`;
    case "api_token_full_access": return `${an || "Full access keys switched"}${reason ? `: ${reason}` : ""}.`;
    case "api_token_write": return `${an}${hn && hn !== an ? ` in ${hn}` : ""}${reason ? ` (${reason})` : ""}.`;
    case "api_token_refused": return `Refused ${an}${hn && hn !== an ? ` in ${hn}` : ""}${reason ? `: ${reason}` : ""}`;
    case "api_token_new_ip": return `${reason ?? "Used from a new address"} (key ${an}).`;
    // deliverability (platform 0130): the target is the address (suppressions) or the hotel (holds); the reason is the Super Admin's words or the rates
    case "mail_suppressed": return `Suppressed ${an || "an address"}${hn ? ` for ${hn}` : " for every hotel"}${reason ? ` (${reason})` : ""}.`;
    case "mail_unsuppressed": return `Lifted the suppression of ${an || "an address"}${reason ? ` (${reason})` : ""}.`;
    case "mail_hold": return `Held the campaign mail of ${hn || an || "a hotel"}${reason ? `: ${reason}` : ""}.`;
    case "mail_hold_released": return `Released the campaign mail of ${hn || an || "a hotel"}${reason ? `: ${reason}` : ""}.`;
    // the hotel vault (platform 0168): the reason is "<kind>: <name>" and, on a change, what changed
    case "vault_item_added": return `Added ${reason ?? "an item"} to the vault of ${hn || "a hotel"}.`;
    case "vault_item_changed": return `Changed ${reason ?? "an item"} in the vault of ${hn || "a hotel"}.`;
    case "vault_item_revealed": return `Showed the secret of ${reason ?? "an item"} in the vault of ${hn || "a hotel"}.`;
    case "vault_item_removed": return `Removed ${reason ?? "an item"} from the vault of ${hn || "a hotel"}.`;
    // My vault (platform 0190): the reason is the type only
    case "personal_vault_item_added": return `Added ${reason ?? "an item"} to their own vault.`;
    case "personal_vault_item_changed": return `Changed ${reason ?? "an item"} in their own vault.`;
    case "personal_vault_item_revealed": return `Showed the secret of ${reason ?? "an item"} in their own vault.`;
    case "personal_vault_item_removed": return `Removed ${reason ?? "an item"} from their own vault.`;
    // a website demo request (platform 0169): the target is the hotel the visitor named, the reason the new status
    case "demo_request_updated": return `Marked the demo request of ${an || "a hotel"} as ${reason ?? "changed"}.`;
    // the Central tabs: the target is "Guest profile: <name>", the reason says which field; the value itself is never kept
    case "central_created": return `Created ${an || "a record"} in Central.`;
    case "central_updated": return `Changed ${an || "a record"} in Central${reason ? ` (${reason})` : ""}.`;
    case "central_deleted": return `Deleted ${an || "a record"} in Central${reason ? `: ${reason}` : ""}.`;
    case "central_restored": return `Restored ${an || "a record"} in Central.`;
    case "central_revealed": return `${reason ?? "Showed a full mobile or email"} of ${an || "a profile"}.`;
    default: return String(action);
  }
}

export function activityView(r: PlatformActivityRow): PlatformActivity {
  const action = r.action as PlatformActivityAction;
  return {
    id: r.id, at: r.at.toISOString(), actorName: r.actorName, action, hotelId: r.hotelId, hotelName: r.hotelName, groupId: r.groupId, groupName: r.groupName,
    adminId: r.entity === "user" ? r.entityId : null,
    text: activityText(action, { hotel: r.hotelName ?? r.targetLabel ?? "", group: r.groupName ?? "", target: r.targetLabel ?? "", reason: r.reason }),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The onboarding form as sent ({hotel: {...}, admin: {...}}, P3). Never a password: the table refuses one and nothing here reads one. */
export function onboardingView(o: OnboardingRow | null): PlatformOnboardingSummary | null {
  if (!o) return null;
  const h = obj(o.payload.hotel);
  const a = obj(o.payload.admin);
  const rooms = typeof h.roomCount === "number" ? h.roomCount : null;
  const gstType = h.gstType === "regular" || h.gstType === "composition" ? h.gstType : null;
  return {
    invitationId: o.invitationId, contactName: str(o.payload.contactName) || str(a.name), address: str(h.address), city: str(h.city), state: str(h.state), pin: str(h.pin),
    gstin: str(h.gstin), phone: str(h.phone), email: str(h.email), logoName: strOrNull(h.logoName), submittedAt: o.submittedAt.toISOString(),
    adminName: str(a.name), adminUsername: str(a.username), adminEmail: str(a.email), adminMobile: str(a.mobile),
    legalName: strOrNull(h.legalName), tradeName: strOrNull(h.tradeName), gstType, roomCount: rooms, checkInTime: strOrNull(h.checkInTime), checkOutTime: strOrNull(h.checkOutTime),
  };
}
