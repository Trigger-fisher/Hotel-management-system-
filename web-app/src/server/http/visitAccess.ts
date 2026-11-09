import "server-only";
import { SECRET_SETTING_PATH } from "../auth/secretSettings";
import type { VerifiedSession } from "../auth/session";
import { pathForms } from "./pathForms";

// What a write inside an Enter-hotel visit may do (BACKEND.md 14.7; platform 0135). A VIEW visit writes nothing in the hotel. A FULL visit writes as the
// hotel's SuperAdmin, except the families below: money (online payments), saved secrets, backups and exports, salary records and staff letters. A platform
// admin's full visit also never changes accounts or roles; the Super Admin's may, but the services keep the hotel's own owner account and role out of reach
// (userService.assertManage, roleService.update). The route inventory test (tests/server/visit.access.test.ts) walks every hotel route against this list.
// The console itself, sign-in/out and the person's own profile stay writable in every visit.

/** The only route families platform staff may WRITE to in a view visit: the console itself, sign-out/unlock, and their own profile. */
export const VISIT_WRITABLE: readonly string[] = ["/api/v1/platform/", "/api/v1/group/", "/api/v1/auth/", "/api/v1/profile/"];

interface Deny {
  test: RegExp;
  why: string;
}

/** Refused to every full visit. */
export const FULL_VISIT_DENIED: readonly Deny[] = [
  { test: /^\/api\/v1\/admin\/razorpay(\/|$)/, why: "Online payments cannot be changed during a visit." },
  { test: /^\/api\/v1\/admin\/backup(\/|$)/, why: "Backups cannot be changed during a visit." },
  // the hotel's own mail server, both Razorpay accounts and the backup are saved through ONE route chosen by a group name (review round 3, R3-1)
  { test: SECRET_SETTING_PATH, why: "The hotel's mail server, online payments and backup settings cannot be changed during a visit." },
  { test: /^\/api\/v1\/website\/google(\/|$)/, why: "The hotel's Google connection cannot be changed during a visit." },
  { test: /(^|\/)export(s)?(\/|$)/, why: "Exports are not available during a visit." },
  // decision 74: platform staff never see a guest's whole ID number
  { test: /(^|\/)id-number(\/|$)/, why: "A guest's whole ID number is not shown to platform staff during a visit." },
  // Conversations (decision 66, C4): a hotel's messages are private; the service also refuses every read to platform staff
  { test: /^\/api\/v1\/conversations(\/|$)/, why: "A hotel's conversations are private: they do not open during a visit." },
  // My mailbox belongs to a person and works only for their own login outside a visit (the service refuses a visit too)
  { test: /^\/api\/v1\/my-mailbox(\/|$)/, why: "My mailbox cannot be used during a visit." },
  // AI belongs to a person and costs money: it is not available during a visit (the AI service refuses a visit too)
  { test: /^\/api\/v1\/ai(\/|$)/, why: "AI cannot be used during a visit." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/(salary-profiles|salary-periods|payments|slips)(\/|$)/, why: "Salary records cannot be changed during a visit." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/employees\/[^/]+\/(joining-letter|offer-letter)(\/|$)/, why: "Staff letters cannot be changed during a visit." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/letters(\/|$)/, why: "Staff letters cannot be changed during a visit." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/separations\/[^/]+\/experience-letter(\/|$)/, why: "Staff letters cannot be changed during a visit." },
];

/** Also refused to a platform admin's full visit: every account and role write. */
export const PLATFORM_ADMIN_VISIT_DENIED: readonly Deny[] = [
  { test: /^\/api\/v1\/admin\/(users|roles)(\/|$)/, why: "Accounts and roles cannot be changed by platform staff during a visit." },
  { test: /(^|\/)(reset-login|reset-password|portal-link)(\/|$)/, why: "Accounts and roles cannot be changed by platform staff during a visit." },
];

/** What the platform OWNER's full visit may still do with online payments: the Razorpay routes, and the two Razorpay groups' own save (never their sub-routes, never the mail server or the backup). */
const OWNER_TEST_MONEY: readonly RegExp[] = [/^\/api\/v1\/admin\/razorpay(\/|$)/, /^\/api\/v1\/admin\/settings\/razorpay_(hotel|food)$/];

export type VisitVerdict = { allowed: true } | { allowed: false; why: string };

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** A write that lands in the hotel (not the console, sign-in/out or the profile): in a full visit it is audited in the platform log too. */
export const isHotelWrite = (method: string, path: string): boolean => !SAFE.has(method.toUpperCase()) && !pathForms(path).every((form) => VISIT_WRITABLE.some((p) => form.startsWith(p)));

/** May this visiting session make this call? Reads always; console/auth/profile writes always; hotel writes only in a full visit and outside the deny lists. */
export function visitWriteVerdict(session: Pick<VerifiedSession, "visit" | "accountRole">, method: string, path: string): VisitVerdict {
  const visit = session.visit;
  if (!visit || !isHotelWrite(method, path)) return { allowed: true };
  const viewing = `You are viewing ${visit.hotelName} as ${session.accountRole === "group_hotel_admin" ? "the Group Hotel Admin" : "platform staff"}. This is read-only.`;
  if (visit.access !== "full") return { allowed: false, why: viewing };
  const rules = [...FULL_VISIT_DENIED, ...(session.accountRole === "super_admin" ? [] : PLATFORM_ADMIN_VISIT_DENIED)];
  const denied = pathForms(path).flatMap((form) => rules.filter((d) => d.test.test(form)))[0];
  // the platform owner's own full visit may work the hotel's Razorpay in Test Mode (MJ, 2 Nov 2026): the keys' own save and the payments routes. The services refuse Live Mode in a
  // visit and a key that is not a test key, so no real money moves. Platform admins and API keys stay refused.
  if (denied && session.accountRole === "super_admin" && pathForms(path).every((form) => OWNER_TEST_MONEY.some((t) => t.test(form)))) return { allowed: true };
  return denied ? { allowed: false, why: denied.why } : { allowed: true };
}
