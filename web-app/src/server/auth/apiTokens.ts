import "server-only";
import { randomBytes } from "node:crypto";
import { hmacHex } from "../crypto/hash";
import { pathForms } from "../http/pathForms";
import { SECRET_SETTING_PATH } from "./secretSettings";

// API access tokens (docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md, platform migration 0129). The key is `hms_pat_` + 43 random characters (256 bits); only an
// HMAC of it under HMS_HASH_KEY is stored, so a copy of the table cannot call the API. Everything here is pure (no database), so it is tested on its own.

export const API_TOKEN_PREFIX = "hms_pat_";
export const API_TOKEN_SHAPE = /^hms_pat_[A-Za-z0-9_-]{43}$/;

/**
 * read = GET only; full = read and write in the console and in hotels (the dangerous one: see the safeguards in migration 0129); ai = GET only like read, for the other developer's AI
 * (MJ, 4 Nov 2026, migration 0187): every route a read key may not use for privacy (guests, staff pay, messages, ID photos) is open to it, only the secret-bearing ones stay blocked.
 */
export type ApiTokenLevel = "read" | "full" | "ai";
/** platform = the console only; hotel = ONE hotel (read only); all = the console plus any hotel named per call (read only). */
export type ApiTokenScope = "platform" | "hotel" | "all";

/** The header that names the hotel for a token of scope "all" (the rest of the app takes the hotel from the session, never from the request). */
export const API_HOTEL_HEADER = "x-hms-hotel";

/** A new key and its display prefix (the first 4 characters after `hms_pat_`: enough to tell tokens apart in a list, never enough to guess the key). */
export function newApiToken(): { token: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, API_TOKEN_PREFIX.length + 4) };
}

export const hashApiToken = (key: Buffer, token: string): string => hmacHex(key, "api-token", [token]);

/** The key of an `Authorization: Bearer ...` header when it has the shape of ours; "none" when there is no bearer at all; "bad" for a bearer that is not an API key. */
export function readBearer(request: Request): { kind: "none" } | { kind: "bad" } | { kind: "token"; token: string } {
  const header = request.headers.get("authorization");
  if (header === null) return { kind: "none" };
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return { kind: "bad" };
  return API_TOKEN_SHAPE.test(m[1]!) ? { kind: "token", token: m[1]! } : { kind: "bad" };
}

// ---- what a token may never do (checked in the route wrapper, before any handler runs) ----

export type Verdict = { allowed: true } | { allowed: false; why: string };
const yes: Verdict = { allowed: true };
const no = (why: string): Verdict => ({ allowed: false, why });

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Routes no API key may call, whatever its level or scope: signing in and out, passwords and one-time links, the person's own profile, managing API keys themselves, online
 * payments, backups and exports (a whole hotel's data in one file), permanently deleting a hotel and the cron routes (they have their own secrets),
 * invitations (their links are credentials), anything that serves a guest's ID photo or a saved login, and the staff's salary records. Matched on the path without the query.
 */
const DENIED: readonly { test: RegExp; why: string; /** still blocked for an "ai" key: secrets, and routes that DO something when called with GET (a paid lookup, a scheduled job) */ secret?: true }[] = [
  { test: /^\/api\/v1\/auth(\/|$)/, why: "Sign-in, passwords and sessions are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/profile(\/|$)/, why: "A person's own profile is not available to an API key." },
  { test: /^\/api\/v1\/(guest|corporate)(\/|$)/, why: "Guest and company accounts are not available to an API key.", secret: true },
  // security events, layer status and the emergency resets (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md sections 7 and 9): a Super Admin in the browser, never a key (reads included, an "ai" key too)
  { test: /^\/api\/v1\/platform\/security(\/|$)/, why: "The security tools are used in the browser by a Super Admin, never with an API key.", secret: true },
  { test: /^\/api\/v1\/platform\/api-tokens(\/|$)/, why: "API keys are managed in the browser by the Super Admin, never with a key.", secret: true },
  { test: /(^|\/)(reset-password|reset-link|reset-login|portal-link|emailed-code|sign-in-code)(\/|$)/, why: "Password and one-time link routes are not available to an API key.", secret: true },
  { test: /(^|\/)id-number(\/|$)/, why: "The whole ID number is shown in the browser to a signed-in person, never to an API key.", secret: true },
  { test: /^\/api\/v1\/admin\/razorpay(\/|$)/, why: "Online payments are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/group\/payments(\/|$)/, why: "Online payments are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/admin\/backup(\/|$)/, why: "Backups are not available to an API key.", secret: true },
  // the hotel settings that hold a secret are saved through ONE route chosen by a group name (review round 3, R3-1): the hotel's own mail server, both Razorpay accounts, the backup
  { test: SECRET_SETTING_PATH, why: "The hotel's mail server, online payments and backup settings are changed in the browser by its Super Admin, never with an API key.", secret: true },
  // the Set-up centre (MJ, 5 Nov 2026): every outside service's keys and their tests, the Super Admin in the browser only
  { test: /^\/api\/v1\/platform\/setup(\/|$)/, why: "Set-up of outside services is done in the browser by the Super Admin, never with an API key.", secret: true },
  { test: /^\/api\/v1\/platform\/hotels\/[^/]+\/export$/, why: "A hotel's data export is not available to an API key." },
  { test: /^\/api\/v1\/platform\/hotels\/[^/]+\/delete-permanently$/, why: "Deleting a hotel for good is not available to an API key." },
  { test: /^\/api\/v1\/platform\/audit\/export$/, why: "The audit export is not available to an API key." },
  { test: /^\/api\/v1\/platform\/sign-ins$/, why: "The sign-in history is not available to an API key." },
  // the one common guest and company profile across hotels (B): who a guest is, merges and keep-apart decisions, with personal data
  { test: /^\/api\/v1\/platform\/profiles(\/|$)/, why: "Guest and company profiles and their merges are not available to an API key." },
  // the Central tabs (MJ, 3 Nov 2026): the logins, every guest's and company's details, the GST records and the lookup log, reads included
  { test: /^\/api\/v1\/platform\/central(\/|$)/, why: "The Central lists (logins, guest and company profiles, GST records and lookups) are not available to an API key." },
  // the GST lookup (platform 0167): every call to the paid service costs money
  { test: /^\/api\/v1\/gst(\/|$)/, why: "The GST lookup is not available to an API key.", secret: true },
  // AI (MJ, 3 Nov 2026): it costs money and handles private text, and belongs to a person, so no API key may use it
  { test: /^\/api\/v1\/ai(\/|$)/, why: "AI is not available to an API key.", secret: true },
  { test: /^\/api\/v1\/(platform|group)\/invitations(\/|$)/, why: "Invitations are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/onboarding(\/|$)/, why: "Onboarding links are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/cron(\/|$)/, why: "Scheduled jobs are not available to an API key.", secret: true },
  { test: /^\/api\/v1\/front-office\/stays\/[^/]+\/id-photos?(\/|$)/, why: "A guest's ID photo is not available to an API key." },
  // Conversations (decision 66, A2): every route of the hotel's hub and of the platform's, reads included
  { test: /^\/api\/v1\/(platform\/)?conversations(\/|$)/, why: "Guest and staff messages (email and WhatsApp) are private: no API key reads or sends them (decision 66)." },
  // WhatsApp (plan part 7 and 28.4): the chats, the lines with their tokens, the rules and the hotel's own settings; reads included. Meta's webhook is called without any key.
  { test: /^\/api\/v1\/(platform\/)?whatsapp(\/|$)/, why: "WhatsApp chats, numbers and rules are private: no API key reads or changes them." },
  // My mailbox (platform 0178, 0179): every staff login's personal mailbox is theirs alone, reads included (the same path from the hotel, group and platform dashboards)
  { test: /^\/api\/v1\/my-mailbox(\/|$)/, why: "A personal mailbox is private to its owner: no API key reads or sends it." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/(salary-profiles|salary-periods|payments|slips)(\/|$)/, why: "Salary records are not available to an API key." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/employees\/[^/]+\/(joining-letter|offer-letter)(\/|$)/, why: "Staff letters are not available to an API key." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/letters(\/|$)/, why: "Staff letters are not available to an API key." },
  { test: /^\/api\/v1\/payroll\/companies\/[^/]+\/separations\/[^/]+\/experience-letter(\/|$)/, why: "Staff letters are not available to an API key." },
];

/**
 * Writes no API key may make, even a full one (security review round 2, M3): anything that gives lasting access that would outlive the key. Accounts (platform staff,
 * hotel admins, users, a group's admin; making, disabling, enabling, unlocking them, a platform admin's hotel access), the platform's mail server and sender
 * identities (they decide where every password mail goes), the mail webhooks' keys, and entering a hotel (a visit is a person's, bound to their browser session).
 * Reading these stays open to a key's level and scope.
 */
const WRITE_DENIED: readonly { test: RegExp; why: string }[] = [
  { test: /^\/api\/v1\/platform\/(staff|hotel-admins|users)(\/|$)/, why: "Accounts are managed in the browser, never with an API key." },
  { test: /^\/api\/v1\/platform\/hotels\/[^/]+\/admins$/, why: "Accounts are managed in the browser, never with an API key." },
  // a hotel's own accounts and roles (review round 3, R3-2): a full key in a hotel is its SuperAdmin and could make an Admin that outlives the key
  { test: /^\/api\/v1\/admin\/(users|roles)(\/|$)/, why: "Accounts and roles are managed in the browser, never with an API key." },
  { test: /^\/api\/v1\/platform\/groups\/[^/]+\/admin$/, why: "Accounts are managed in the browser, never with an API key." },
  { test: /^\/api\/v1\/group\/hotel-admins(\/|$)/, why: "Accounts are managed in the browser, never with an API key." },
  { test: /^\/api\/v1\/platform\/settings(\/|$)/, why: "The platform settings and its mail server are changed in the browser, never with an API key." },
  { test: /^\/api\/v1\/platform\/mail-identities(\/|$)/, why: "Sender identities are changed in the browser, never with an API key." },
  { test: /^\/api\/v1\/platform\/mail-safety\/webhooks(\/|$)/, why: "The mail services' report keys are changed in the browser, never with an API key." },
  { test: /^\/api\/v1\/(platform|group)\/hotels\/[^/]+\/(enter|exit|extend)$/, why: "Entering a hotel is for a person in the browser, never for an API key." },
  { test: /^\/api\/v1\/website\/site-template$/, why: "Changing the website's design starts a build and a deployment: it is done in the browser, never with an API key." },
];

/** Whether an API key may call this path at all (the same for every scope; an "ai" key is refused only the secret-bearing routes, the others the whole list). */
export function tokenPathVerdict(pathname: string, level: ApiTokenLevel = "read"): Verdict {
  for (const form of pathForms(pathname)) for (const rule of DENIED) if ((level !== "ai" || rule.secret === true) && rule.test.test(form)) return no(rule.why);
  return yes;
}

/** Whether an API key may WRITE to this path (after tokenPathVerdict; the same for every level and scope). */
export function tokenWriteVerdict(pathname: string): Verdict {
  for (const form of pathForms(pathname)) for (const rule of WRITE_DENIED) if (rule.test.test(form)) return no(rule.why);
  return yes;
}

/** Whether the path is the console: tested on every form of the path, so a platform key needs ALL forms to be console and a hotel key is refused when ANY form is. */
const consoleForms = (pathname: string): boolean[] => pathForms(pathname).map((p) => /^\/api\/v1\/platform(\/|$)/.test(p));

/** The scope decides which route families a key reaches: platform = the console only; hotel = hotel routes only (its one hotel); all = both (a hotel is named per call). */
function scopeVerdict(scope: ApiTokenScope, pathname: string): Verdict {
  if (scope === "platform" && !consoleForms(pathname).every(Boolean)) return no("This API key reaches the Platform console only.");
  if (scope === "hotel" && consoleForms(pathname).some(Boolean)) return no("This API key reaches its one hotel only, not the Platform console.");
  return yes;
}

/**
 * In TEST MODE a key changes nothing that reaches the outside world: no "send a test email" button (those send at once, not through the mail queue, which test mode
 * empties anyway: runtime/testMode.ts).
 */
const TEST_MODE_BLOCKED: readonly RegExp[] = [/^\/api\/v1\/platform\/settings\/smtp-test$/, /^\/api\/v1\/admin\/settings\/email\/test$/];

/** Everything the wrapper asks about one call made with a key: the deny list, the scope, and (for a write) the level and test mode. A read key never writes; a full key writes where its scope reaches. */
export function tokenCallVerdict(token: { level: ApiTokenLevel; scope: ApiTokenScope; testMode?: boolean }, method: string, pathname: string): Verdict {
  const path = tokenPathVerdict(pathname, token.level);
  if (!path.allowed) return path;
  const scope = scopeVerdict(token.scope, pathname);
  if (!scope.allowed) return scope;
  if (SAFE_METHODS.has(method.toUpperCase())) return yes;
  if (token.level !== "full") return no("This API key is read only.");
  const write = tokenWriteVerdict(pathname);
  if (!write.allowed) return write;
  if (token.testMode !== false && pathForms(pathname).some((p) => TEST_MODE_BLOCKED.some((t) => t.test(p)))) return no("In test mode an API key cannot send a test email.");
  return yes;
}