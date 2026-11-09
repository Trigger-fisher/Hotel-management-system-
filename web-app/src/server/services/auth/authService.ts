import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import type { DeviceInfo, HmsUser, ResendCodeResult, ForgotPasswordResult, Session, SignInResult } from "@shared/auth-pallav/types";
import { abilitiesOf, moduleGrantsOf } from "../../auth/access";
import type { Catalog } from "../../auth/catalog";
import { buildPermissionSnapshot } from "../../auth/permissions";
import type { PasswordHasher } from "../../auth/password";
import type { VerifiedSession } from "../../auth/session";
import { dummyResetChallenge, hashSessionToken, issueChangeToken, loginChallenge, newSessionToken, parseChallenge, userOfChangeToken, verifyChangeToken, type DeviceBlob } from "../../auth/tokens";
import { hashAuthCode, safeEqualHex, type CodePurpose } from "../../crypto";
import { hmacHex } from "../../crypto/hash";
import { AppError } from "../../errors";
import type { RateLimitStore } from "../../http/limits";
import type { RequestMeta } from "../../http/meta";
import type { AccessRecord, AuthCodeRecord, AuthRepos, HotelSetupRecord, PlatformUnit, UserRecord } from "../../repos/auth";
import { queueMail } from "./mail";
import {
  CHANGE_VALID_MINUTES, CODE_VALID_MINUTES, HMS_LOCK_MINUTES, MAX_ATTEMPTS, MAX_SENDS, RESEND_SECONDS,
  SEND_WINDOW_SECONDS, WEB_IDLE_MINUTES, maskEmail, passwordProblem, tempPasswordExpired,
} from "./policy";
import { RECHECK_MINUTES } from "@shared/dashboards/security";

// The login backend (ui-shared/auth-pallav, MJ #9 and #13). Pallav's rules are kept exactly (cited as AuthController.php:N, OneTimeCode.php:N,
// PasswordPolicy.php:N); each place where MJ's #13 changes them is marked "HMS (#13):" and has a test that names it.
//
// What is counted is committed in a unit of its own BEFORE the error is thrown, so a refusal never rolls its own counter back; the audit
// rows and the notification mails of a failure go through `after` (the wrapper's failAfterCommit).

/** The forgot-password link (MJ): valid 15 minutes, at most 5 links per account in 15 minutes, the token 32 random bytes in base64url (43 characters). */
const RESET_LINK_MINUTES = 15;
const RESET_LINK_MAX = 5;
const RESET_LINK_WINDOW_SECONDS = 15 * 60;
const RESET_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Refused tries ("choose a password different from your old one") one reset link allows before it is used up. */
const RESET_LINK_MAX_REFUSALS = 5;

interface AuthDeps {
  unit: PlatformUnit;
  catalog: Catalog;
  hasher: PasswordHasher;
  /** HMS_HASH_KEY: codes, challenges and change tokens are keyed under it. */
  hashKey: Buffer;
  /** Counters that outlive a request (code sends, wrong reset codes): platform.rate_limits. */
  rateLimits: RateLimitStore;
  /** The stored food business name of a hotel (its general.food_name setting, else the food payroll company PF01), or null when none. Optional: without it the default is used. */
  foodName?: (hotelId: string) => Promise<string | null>;
  now: () => Date;
  /** Tests fix the code; production uses a CSPRNG. */
  newCode?: () => string;
  /** Tests fix the reset-link token; production uses a CSPRNG. */
  newToken?: () => string;
  /** HMS_PUBLIC_URL: the reset link is built from it. */
  publicUrl?: string;
  /** An account was just locked by its fifth wrong password (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 7: a Warning). Best effort: its failure never changes the answer. Carries no name, email or password. */
  onAccountLocked?: (event: { userId: string; accountRole: string; via: "sign-in" | "unlock" | "recheck"; minutes: number; ip: string | null; traceId: string }) => Promise<void>;
}

export type After = (work: () => Promise<void>) => void;

export interface Outcome<T> {
  data: T;
  /** A new session's token: the route puts it in the httpOnly cookie. */
  webToken?: string;
}

const addMs = (d: Date, ms: number): Date => new Date(d.getTime() + ms);
const minutes = (n: number): number => n * 60_000;
const secondsUntil = (to: Date, from: Date): number => Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 1000));
/** Account roles that work without a hotel of their own (the platform staff and a group-level admin). Everyone else signs in to a hotel. */
const HOTEL_LESS_ROLES = new Set(["super_admin", "platform_admin", "group_hotel_admin"]);

/**
 * Why a sign-in is refused although the password was right (BRIEF-BACKEND-PLATFORM rule 1, migration 0105): the account waits for approval,
 * or the hotel is not open. ACCOUNT_BLOCKED with `details.reason`; the sentence is the contract's (pallavCopy.blockedReason, platformCopy.signIns.reasons).
 * Contract request: ui-shared auth-pallav PallavBlockedReason gets hotel_suspended / hotel_archived / hotel_rejected and blockedReasonOf reads details.reason.
 */
const BLOCKED_REASONS = {
  hotel_pending: "Your hotel is waiting for approval.",
  group_pending: "Your group is waiting for approval.",
  hotel_suspended: "The hotel is suspended.",
  hotel_archived: "The hotel is archived.",
  hotel_rejected: "The hotel was rejected.",
} as const;
const blocked = (reason: keyof typeof BLOCKED_REASONS): AppError => new AppError("ACCOUNT_BLOCKED", BLOCKED_REASONS[reason], { reason });

/** The account is switched off (by an admin, a rejected application or a hotel deleted for good). `reason` is the key the sign-in screen words. */
type DisabledReason = "disabled" | "hotel_rejected" | "group_rejected" | "no_email" | "temp_password_expired";
const TEMP_PASSWORD_EXPIRED_MESSAGE = "This temporary password has expired. Ask your administrator to send a new one.";
const disabled = (reason: DisabledReason = "disabled", message?: string): AppError => new AppError("ACCOUNT_DISABLED", message, { reason });

/** Refuses an account waiting for approval and any hotel that is not active. Call ONLY after the password (or code) was proved: it says the account exists. */
function assertMayEnter(user: Pick<UserRecord, "status" | "accountRole">, access: AccessRecord | null): void {
  if (user.status === "pending_approval") throw blocked(user.accountRole === "group_hotel_admin" ? "group_pending" : "hotel_pending");
  if (!access) throw disabled();
  // a console account (Super, Platform, Group Hotel Admin) never signs in inside a hotel: a hotel reaches it only through an audited visit, so no hotel's state can stop it
  if (HOTEL_LESS_ROLES.has(user.accountRole)) return;
  const hotel = access.hotel;
  if (!hotel) {
    // a hotel account whose only hotel is gone (deleted for good) is not turned into a hotel-less account
    if (!HOTEL_LESS_ROLES.has(user.accountRole)) throw disabled();
    return;
  }
  switch (hotel.status ?? "active") {
    case "active":
      return;
    case "suspended":
      throw blocked("hotel_suspended");
    case "archived":
      throw blocked("hotel_archived");
    case "rejected":
      throw blocked("hotel_rejected");
    case "deleted":
      throw disabled();
    default:
      // invited, onboarding, pending_approval: the hotel waits for approval
      throw blocked("hotel_pending");
  }
}

export function createAuthService(deps: AuthDeps) {
  const { unit, catalog, hasher, hashKey, rateLimits, now } = deps;
  const newCode = deps.newCode ?? ((): string => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  // the reset link: a random 32-byte token (base64url), kept only as its keyed hash
  const newToken = deps.newToken ?? ((): string => randomBytes(32).toString("base64url"));
  const resetLinkHash = (token: string): string => hmacHex(hashKey, "reset_link", [token]);
  const publicUrl = (deps.publicUrl ?? "http://localhost:3000").replace(/\/+$/, "");

  const device = (d: DeviceInfo): DeviceBlob => {
    const name = (d.name ?? "").trim();
    const problems: Record<string, string> = {};
    if (d.platform !== "web") problems["device.platform"] = "Not valid";
    if (name === "" || Array.from(name).length > 120) problems["device.name"] = "Not valid";
    if (Object.keys(problems).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields: problems });
    return { platform: "web", name };
  };

  // decision 46 (MJ, 12 Oct 2026): the emailed code is the person's own choice (default off) for EVERY account, administrators included
  const needsCode = (u: UserRecord): boolean => u.codeRequired;

  /** AuthController::lockedMessage's two cases as codes: a block (no timer) or a timed lock. */
  function assertUsable(u: UserRecord, at: Date): void {
    if (u.blockedAt !== null) throw new AppError("ACCOUNT_BLOCKED");
    if (u.lockedUntil !== null && u.lockedUntil > at) throw new AppError("ACCOUNT_LOCKED", undefined, { retryAfterSeconds: secondsUntil(u.lockedUntil, at) });
  }

  /** The hotel's own food business name (hotel setting general.food_name); a failed read is simply "not set": it must never break a sign-in. */
  async function foodNameOf(hotelId: string): Promise<string | null> {
    try {
      return (await deps.foodName?.(hotelId)) ?? null;
    } catch {
      return null;
    }
  }

  /** The checklist applies to the Hotel Admin of a hotel that came through approval until it is finished or skipped for good. */
  const setupApplies = (access: Pick<AccessRecord, "user" | "hotel">, row: HotelSetupRecord | null): boolean =>
    access.user.accountRole === "hotel_admin" && access.hotel !== null && row !== null && row.status !== "done" && row.status !== "skipped";

  /** `food`: the hotel's food business name when the caller already started reading it (sign-in starts it early, so it overlaps the session writes). */
  /** The group a Group Hotel Admin runs (hotel_groups.admin_user_id): they have no hotel, so their group never comes from one. */
  /** `r`: the caller's open unit, when there is one (a second unit inside it would wait for the first). */
  async function groupOf(access: AccessRecord, r?: AuthRepos): Promise<{ id: string; name: string } | null> {
    if (access.hotel?.group) return access.hotel.group;
    if (access.user.accountRole !== "group_hotel_admin") return null;
    const g = r ? await r.access.adminGroup(access.user.id) : await unit.read((x) => x.access.adminGroup(access.user.id));
    return g ? { id: g.id, name: g.name } : null;
  }

  async function hmsUser(access: AccessRecord, setup: HotelSetupRecord | null = null, food?: Promise<string | null>, r?: AuthRepos): Promise<HmsUser> {
    const snapshot = buildPermissionSnapshot({ catalog, roleGrants: access.grants, userOverrides: access.overrides });
    return {
      id: access.user.id,
      displayName: access.user.displayName,
      email: access.user.email ?? "",
      username: access.user.username,
      role: access.user.accountRole,
      // `foodName` (not in the shared type yet): the food business of this hotel, the hotel setting general.food_name, else the name of the fixed food payroll company PF01 (named "<hotel name> Food" when the hotel is built), else "<hotel name> Food"
      // `setup` (not in the shared type yet): present only while the "Set up your hotel" checklist applies to this person
      hotel: access.hotel
        ? ({ id: access.hotel.id, name: access.hotel.name, foodName: (await (food ?? foodNameOf(access.hotel.id))) ?? `${access.hotel.name} Food`, ...(setupApplies(access, setup) ? { setup: { applies: true } } : {}) } as HmsUser["hotel"])
        : null,
      group: await groupOf(access, r),
      // the abilities THIS person holds in THIS hotel, from the permission snapshot, never from input
      abilities: abilitiesOf(snapshot, catalog, { roleKey: access.role.key }),
      // the module levels of the hotel role, for the menus (not in the shared type yet): only for a person inside a hotel, and not for the hotel SuperAdmin (who holds everything)
      ...(access.hotel && !HOTEL_LESS_ROLES.has(access.user.accountRole) && access.user.accountRole !== "guest_user" && access.user.accountRole !== "corporate_user" ? { grants: moduleGrantsOf(snapshot, catalog, { roleKey: access.role.key }) } : {}),
    };
  }

  /** A counter in platform.rate_limits that must survive the request (code sends, wrong reset codes). */
  const bump = (key: string, windowSeconds: number) => rateLimits.hit(key, windowSeconds);

  // ---------------------------------------------------------------------------------------------------------------------------------
  // signing in
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Opens the session in the caller's unit: ends the old one (a person has one browser session), inserts the new one, writes the trail. */
  async function openSession(r: AuthRepos, access: AccessRecord, dev: DeviceBlob, meta: RequestMeta, at: Date, entryHotelId: string | null = null): Promise<Outcome<{ status: "signed_in"; session: Session }>> {
    // the hotel's food business name is read in the hotel's own schema on ANOTHER connection: started now, it overlaps the writes below instead of waiting at the end
    // (foodNameOf never fails: a failed read is "not set")
    const food = access.hotel ? foodNameOf(access.hotel.id) : Promise.resolve(null);
    const replaced = await r.sessions.revokeActive(access.user.id, "replaced", at);
    const token = newSessionToken();
    const expiresAt = addMs(at, minutes(WEB_IDLE_MINUTES));
    await r.sessions.insert({
      userId: access.user.id,
      hotelId: access.hotel?.id ?? null,
      client: "web",
      tokenHash: hashSessionToken(token),
      deviceLabel: dev.name,
      userAgent: null,
      ip: meta.ip,
      issuedAt: at,
      lastSeenAt: at,
      expiresAt,
    });
    // the account is in good standing: the counters start again (AuthController::completeSignIn:201-214; a block set by an admin stays)
    await r.users.update(access.user.id, { failedAttempts: 0, lockLevel: 0, lockedUntil: null, lastLoginAt: at });
    if (replaced > 0) await r.events.event({ userId: access.user.id, hotelId: access.hotel?.id ?? null, event: "session_replaced", ip: meta.ip, userAgent: null, detail: { count: replaced }, at });
    await r.events.event({ userId: access.user.id, hotelId: access.hotel?.id ?? null, event: "login_success", ip: meta.ip, userAgent: null, detail: { client: "web" }, at });
    const setupRow = access.hotel && access.user.accountRole === "hotel_admin" ? await r.hotelSetup.get(access.hotel.id) : null;
    // the token travels only in the httpOnly cookie (`webToken`); the answer carries none
    const session: Session = { user: await hmsUser(access, setupRow, food, r), client: "web", expiresAt: expiresAt.toISOString(), token: null, ...(entryHotelId !== null ? { entryHotelId } : {}) };
    return { data: { status: "signed_in", session }, webToken: token };
  }

  /** Counts a wrong password; the fifth locks the account for 15 minutes (MJ, 5 Nov 2026; Pallav BLOCKS with no timer, AuthController::registerFailure). */
  async function wrongPassword(userId: string, at: Date, meta: RequestMeta, after: After, via: "sign-in" | "unlock" | "recheck"): Promise<AppError> {
    const result = await unit.run(async (r) => {
      const u = await r.users.byId(userId, { forUpdate: true });
      if (!u) return { locked: false as const };
      const attempts = u.failedAttempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        await r.users.update(userId, { failedAttempts: attempts });
        return { locked: false as const };
      }
      const mins = HMS_LOCK_MINUTES;
      const until = addMs(at, minutes(mins));
      await r.users.update(userId, { failedAttempts: 0, lockLevel: Math.min(u.lockLevel + 1, 6), lockedUntil: until });
      return { locked: true as const, until, mins, user: u };
    });
    after(async () => {
      await unit.run(async (r) => {
        await r.events.event({ userId, hotelId: null, event: "login_failed", ip: meta.ip, userAgent: null, detail: { via }, at });
        if (result.locked) {
          await r.events.event({ userId, hotelId: null, event: "account_locked", ip: meta.ip, userAgent: null, detail: { minutes: result.mins }, at });
          await deps.onAccountLocked?.({ userId, accountRole: result.user.accountRole, via, minutes: result.mins, ip: meta.ip, traceId: meta.traceId }).catch(() => undefined);
          if (result.user.email) await queueMail(r, { userId, kind: "account_locked", toEmail: result.user.email, payload: { name: result.user.displayName, until: result.until.toISOString() } }, at);
        }
      });
    });
    return result.locked ? new AppError("ACCOUNT_LOCKED", undefined, { retryAfterSeconds: secondsUntil(result.until, at) }) : new AppError("INVALID_CREDENTIALS");
  }

  /** A fresh 6-digit code for a person and purpose, mailed through the outbox. Returns the row. */
  async function issueCode(r: AuthRepos, u: UserRecord, purpose: CodePurpose, at: Date): Promise<{ row: AuthCodeRecord; ok: true } | { ok: false; retryAfterSeconds: number }> {
    const sends = await bump(`code-sent|${purpose}|${u.id}`, SEND_WINDOW_SECONDS);
    if (sends.count > MAX_SENDS) return { ok: false, retryAfterSeconds: sends.resetInSeconds };
    const code = newCode();
    const row = await r.codes.replace({ purpose, userId: u.id, codeHash: hashAuthCode(hashKey, purpose, u.id, code), expiresAt: addMs(at, minutes(CODE_VALID_MINUTES)), lastSentAt: at }, at);
    await queueMail(r, { userId: u.id, kind: purpose === "reset" ? "reset_code" : "login_code", toEmail: u.email as string, payload: { name: u.displayName, code, minutes: CODE_VALID_MINUTES } }, at);
    await r.events.event({ userId: u.id, hotelId: null, event: "code_sent", ip: null, userAgent: null, detail: { purpose }, at });
    return { ok: true, row };
  }

  async function codeStep(r: AuthRepos, u: UserRecord, dev: DeviceBlob, at: Date): Promise<SignInResult> {
    if (!u.email) throw disabled("no_email", "This account has no email address for the sign-in code. Ask your administrator to add one.");
    const issued = await issueCode(r, u, "login", at);
    if (!issued.ok) throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: issued.retryAfterSeconds });
    return { status: "code_required", challengeId: loginChallenge(hashKey, issued.row.id, dev), maskedEmail: maskEmail(u.email), resendAfterSeconds: RESEND_SECONDS };
  }

  /** Decision 55: the access in the hotel a website named, when the person is linked to it and the hotel is open and live; otherwise null and the sign-in goes on exactly as today. */
  async function entryAccess(r: AuthRepos, userId: string, slug: string | undefined): Promise<AccessRecord | null> {
    if (!slug) return null;
    const hotelId = await r.access.entryHotelId(slug);
    return hotelId ? r.access.load(userId, hotelId) : null;
  }

  /**
   * Everything after the right password, in ONE transaction (sign-in speed, 18 Oct 2026: it was three, with the access read twice): the wrong-try count starts again (written
   * only when it is not already 0; it is kept even when the account is then refused, as before), the account and hotel are checked, then the code step, the temporary-password
   * step or the session.
   */
  async function afterPassword(u: UserRecord, dev: DeviceBlob, meta: RequestMeta, at: Date, entryHotel?: string): Promise<Outcome<SignInResult>> {
    const out = await unit.run(async (r): Promise<{ refused: unknown } | { done: Outcome<SignInResult> }> => {
      if (u.failedAttempts > 0) await r.users.update(u.id, { failedAttempts: 0 });
      const fallback = await r.access.load(u.id, null);
      // BRIEF-BACKEND-PLATFORM rule 1: an account waiting for approval, or a hotel that is not active, is refused here (after the password, so a
      // stranger learns nothing), before any code is mailed or a temporary password is exchanged. The refusal is thrown after this unit commits (the count stays reset).
      try {
        assertMayEnter(u, fallback);
      } catch (error) {
        return { refused: error };
      }
      // AuthController.php:101-103: a temporary password is only good for choosing a real one; no session is opened here.
      // HMS (MJ, 5 Nov 2026): and only for the time the Super Admin set (default 30 minutes) after it was given; then it is refused
      if (u.mustChangePassword) {
        if (tempPasswordExpired(u.tempPasswordAt, at, (await r.access.security()).tempPasswordMinutes)) return { refused: disabled("temp_password_expired", TEMP_PASSWORD_EXPIRED_MESSAGE) };
        return { done: { data: { status: "password_change_required", changeToken: issueChangeToken(hashKey, { userId: u.id, passwordHash: u.passwordHash, why: "first", expiresAt: addMs(at, minutes(CHANGE_VALID_MINUTES)) }) } } };
      }
      // decision 46: the code only when the person switched it on for their own account (code_required); otherwise the password finishes the sign-in
      if (needsCode(u)) return { done: { data: await codeStep(r, u, dev, at) } };
      const entry = await entryAccess(r, u.id, entryHotel);
      const access = entry ?? fallback;
      if (!access) return { refused: disabled() };
      return { done: await openSession(r, access, dev, meta, at, entry?.hotel?.id ?? null) };
    });
    if ("refused" in out) throw out.refused;
    return out.done;
  }

  /** Why a switched-off account is off: a rejected group or hotel application says so (the onboarding refusal disables the account), anything else is "disabled". */
  async function disabledReasonOf(u: UserRecord): Promise<DisabledReason> {
    return unit.read(async (r) => {
      if (u.accountRole === "group_hotel_admin" && (await r.access.adminGroup(u.id))?.status === "rejected") return "group_rejected";
      if ((await r.access.load(u.id, null))?.hotel?.status === "rejected") return "hotel_rejected";
      return "disabled";
    });
  }

  /** MJ (2026-10-06): the ONE sign-in page takes a username OR an email (both unique among live users, both stored lower-case): an "@" means the email. */
  const findByName = (r: AuthRepos, name: string): Promise<UserRecord | null> => (name.includes("@") ? r.users.byEmail(name) : r.users.byUsername(name));
  const nameTooLong = (name: string): boolean => Array.from(name).length > (name.includes("@") ? 254 : 50);

  // ---------------------------------------------------------------------------------------------------------------------------------
  const api = {
    /** Step one: username and password (AuthController::login:58-119). */
    async signIn(req: { username: string; password: string; device: DeviceInfo; entryHotel?: string }, meta: RequestMeta, after: After): Promise<Outcome<SignInResult>> {
      const username = (req.username ?? "").trim().toLowerCase();
      if (username === "" || nameTooLong(username) || req.password === "" || Array.from(req.password).length > 128) {
        throw new AppError("VALIDATION_FAILED", undefined, { fields: { ...(username === "" || nameTooLong(username) ? { username: "Enter your username or email" } : {}), ...(req.password === "" || req.password.length > 128 ? { password: "Enter your password" } : {}) } });
      }
      const dev = device(req.device);
      const at = now();
      // one SELECT: no transaction around it (two fewer waits for the database)
      const user = await unit.read((r) => findByName(r, username));
      if (!user) {
        // the same time and the same answer as a wrong password: nothing tells a wrong username from a wrong password
        await hasher.dummyVerify(req.password);
        after(() => unit.run((r) => r.events.event({ userId: null, hotelId: null, event: "login_failed", ip: meta.ip, userAgent: null, detail: { via: "sign-in", known: false }, at })));
        throw new AppError("INVALID_CREDENTIALS");
      }
      assertUsable(user, at); // AuthController.php:76-78: locked or blocked is announced before the password is looked at
      if (!(await hasher.verify(user.passwordHash, req.password))) throw await wrongPassword(user.id, at, meta, after, "sign-in");
      // a refusal after the right password (disabled account, hotel not open, waiting for approval) is a failed sign-in in the Super Admin's history, with its reason
      const refused = (error: unknown): unknown => {
        const reason = error instanceof AppError && (error.code === "ACCOUNT_BLOCKED" || error.code === "ACCOUNT_DISABLED") ? String(error.details?.reason ?? "disabled") : null;
        if (reason !== null) after(() => unit.run((r) => r.events.event({ userId: user.id, hotelId: null, event: "login_failed", ip: meta.ip, userAgent: null, detail: { via: "sign-in", reason }, at })));
        return error;
      };
      if (user.status === "disabled") throw refused(disabled(await disabledReasonOf(user))); // :91-93, after the password, as in Pallav (reason: BACKEND.md 14.9)
      // the wrong-try count starts again inside afterPassword's one transaction
      try {
        return await afterPassword(user, dev, meta, at, req.entryHotel);
      } catch (error) {
        throw refused(error);
      }
    },

    /** Step two: the emailed code (AuthController::verify:138-166; OneTimeCode::check:171-199). */
    async verifyCode(req: { challengeId: string; code: string; entryHotel?: string }, meta: RequestMeta, after: After): Promise<Outcome<SignInResult>> {
      const parsed = parseChallenge(hashKey, req.challengeId, "login");
      if (!parsed || !parsed.device) throw new AppError("CHALLENGE_EXPIRED");
      const code = req.code.replace(/[\s-]/g, "");
      if (!/^\d{6}$/.test(code)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { code: "Enter the 6-digit code" } });
      const at = now();
      const state = await unit.run(async (r) => {
        const row = await r.codes.byId(parsed.codeId);
        if (!row || row.purpose !== "login" || row.usedAt !== null || row.expiresAt <= at) return { kind: "expired" as const };
        const u = await r.users.byId(row.userId, { forUpdate: true });
        if (!u || u.deletedAt !== null) return { kind: "expired" as const };
        assertUsable(u, at);
        const good = safeEqualHex(row.codeHash, hashAuthCode(hashKey, "login", u.id, code));
        if (good) {
          await r.codes.update(row.id, { usedAt: at });
          return { kind: "good" as const, user: u };
        }
        const attempts = row.attempts + 1;
        // HMS (#13): five wrong guesses CANCEL this code (the person signs in again for a new one); Pallav blocked the whole account (OneTimeCode.php:185-189)
        if (attempts >= MAX_ATTEMPTS) await r.codes.update(row.id, { attempts, usedAt: at });
        else await r.codes.update(row.id, { attempts });
        return { kind: "wrong" as const, attempts, userId: u.id };
      });
      if (state.kind === "expired") throw new AppError("CHALLENGE_EXPIRED");
      if (state.kind === "wrong") {
        after(() => unit.run((r) => r.events.event({ userId: state.userId, hotelId: null, event: "code_failed", ip: meta.ip, userAgent: null, detail: { attempts: state.attempts }, at })));
        if (state.attempts >= MAX_ATTEMPTS) throw new AppError("CODE_ATTEMPTS_EXCEEDED");
        throw new AppError("INVALID_CODE", undefined, { attemptsLeft: MAX_ATTEMPTS - state.attempts });
      }
      return unit.run(async (r) => {
        const fallback = await r.access.load(state.user.id, null);
        // the hotel may have been suspended (or the account put on hold) between the password and the code
        assertMayEnter(state.user, fallback);
        if (!fallback) throw disabled();
        // decision 55: the hotel a website named is applied only when the person is linked to it (a hint, sent again with the code)
        const entry = await entryAccess(r, state.user.id, req.entryHotel);
        return openSession(r, entry ?? fallback, parsed.device as DeviceBlob, meta, at, entry?.hotel?.id ?? null);
      });
    },

    /** "Send a new code" on the code screen: the same challenge stays valid (OneTimeCode::canResend/send). */
    async resendCode(req: { challengeId: string }): Promise<Outcome<ResendCodeResult>> {
      const parsed = parseChallenge(hashKey, req.challengeId, "login");
      if (!parsed) throw new AppError("CHALLENGE_EXPIRED");
      const at = now();
      return unit.run(async (r) => {
        const row = await r.codes.byId(parsed.codeId);
        // a half-finished sign-in is only good for ten minutes (AuthController::pendingUser:337-349)
        if (!row || row.purpose !== "login" || row.usedAt !== null || addMs(row.createdAt, minutes(CODE_VALID_MINUTES)) <= at) throw new AppError("CHALLENGE_EXPIRED");
        const u = await r.users.byId(row.userId);
        if (!u || !u.email) throw new AppError("CHALLENGE_EXPIRED");
        assertUsable(u, at);
        const wait = row.lastSentAt.getTime() + RESEND_SECONDS * 1000 - at.getTime();
        if (wait > 0) throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: Math.ceil(wait / 1000) });
        const sends = await bump(`code-sent|login|${u.id}`, SEND_WINDOW_SECONDS);
        if (sends.count > MAX_SENDS) throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: sends.resetInSeconds });
        const code = newCode();
        await r.codes.update(row.id, { codeHash: hashAuthCode(hashKey, "login", u.id, code), expiresAt: addMs(at, minutes(CODE_VALID_MINUTES)), attempts: 0, resendCount: row.resendCount + 1, lastSentAt: at });
        await queueMail(r, { userId: u.id, kind: "login_code", toEmail: u.email, payload: { name: u.displayName, code, minutes: CODE_VALID_MINUTES } }, at);
        await r.events.event({ userId: u.id, hotelId: null, event: "code_sent", ip: null, userAgent: null, detail: { purpose: "login", resend: true }, at });
        return { data: { maskedEmail: maskEmail(u.email), resendAfterSeconds: RESEND_SECONDS } };
      });
    },

    /**
     * Forgot password (MJ: an emailed LINK, not a code). The name may be a username or an email. ALWAYS the same answer, whether or not the account exists,
     * is usable or has an email, and whether or not a limit was reached (HMS #13: nothing to learn about an account). For a real, usable account with an
     * email (and under 5 links in 15 minutes per account) a random single-use token is made, its keyed hash kept as a 'reset_link' code (a new one ends the
     * old one), and the link `${publicUrl}/?reset=<token>` mailed through the outbox: valid 15 minutes. The old `challengeId` field stays for older screens.
     */
    async forgotPassword(req: { username: string }, meta: RequestMeta): Promise<Outcome<ForgotPasswordResult & { sent: true; message: string }>> {
      const username = (req.username ?? "").trim().toLowerCase();
      if (username === "" || nameTooLong(username)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { username: "Enter your username or email" } });
      const at = now();
      const token = newToken();
      const sent = await unit.run(async (r) => {
        const u = await findByName(r, username);
        if (!u || u.status === "disabled" || u.deletedAt !== null || !u.email) return false;
        const links = await bump(`reset-link|${u.id}`, RESET_LINK_WINDOW_SECONDS);
        if (links.count > RESET_LINK_MAX) return false;
        await r.codes.replace({ purpose: "reset_link", userId: u.id, codeHash: resetLinkHash(token), expiresAt: addMs(at, minutes(RESET_LINK_MINUTES)), lastSentAt: at }, at);
        await queueMail(r, { userId: u.id, kind: "reset_link", toEmail: u.email, payload: { name: u.displayName, link: `${publicUrl}/?reset=${token}`, minutes: RESET_LINK_MINUTES } }, at);
        await r.events.event({ userId: u.id, hotelId: null, event: "password_reset_requested", ip: meta.ip, userAgent: null, detail: { by: "link" }, at });
        return true;
      });
      // the same work either way (the keyed hash), so the timing says nothing
      if (!sent) resetLinkHash(token);
      return { data: { challengeId: dummyResetChallenge(hashKey, username), sentTo: "the email on that account", resendAfterSeconds: RESEND_SECONDS, sent: true, message: "If an account matches, we have sent a link to its email." } };
    },

    /** Opening the link: 200 {valid: true} while it is good; expired, used, unknown, malformed or the account no longer usable: the same NOT_FOUND. */
    async checkResetLink(token: string): Promise<Outcome<{ valid: true }>> {
      if (!RESET_TOKEN.test(token)) throw new AppError("NOT_FOUND");
      const at = now();
      const good = await unit.run(async (r) => {
        const row = await r.codes.byHash("reset_link", resetLinkHash(token));
        if (!row || row.usedAt !== null || row.expiresAt <= at) return false;
        const u = await r.users.byId(row.userId);
        return Boolean(u && u.deletedAt === null && u.status !== "disabled");
      });
      if (!good) throw new AppError("NOT_FOUND");
      return { data: { valid: true } };
    },

    /**
     * The new password through the link: the password rules first (the same for everyone), then the link is taken (locked, so two clicks cannot both use
     * it) and used up, the password set, every session of the account ended, the audit row written. A link no longer good: NOT_FOUND.
     */
    async resetWithLink(req: { token: string; newPassword: string }, meta: RequestMeta): Promise<Outcome<{ done: true }>> {
      const problem = passwordProblem(req.newPassword);
      if (problem) throw new AppError("PASSWORD_TOO_WEAK", problem, { fields: { newPassword: problem } });
      if (!RESET_TOKEN.test(req.token)) throw new AppError("NOT_FOUND");
      const at = now();
      const user = await unit.run(async (r) => {
        const row = await r.codes.byHash("reset_link", resetLinkHash(req.token), { forUpdate: true });
        if (!row || row.usedAt !== null || row.expiresAt <= at) return null;
        const u = await r.users.byId(row.userId, { forUpdate: true });
        if (!u || u.deletedAt !== null || u.status === "disabled") return null;
        // a refused password ("same as before") leaves the link usable until it expires, but counts: after RESET_LINK_MAX_REFUSALS refusals it is used up
        if (await hasher.verify(u.passwordHash, req.newPassword)) {
          const attempts = row.attempts + 1;
          await r.codes.update(row.id, attempts >= RESET_LINK_MAX_REFUSALS ? { attempts, usedAt: at } : { attempts });
          return "reused" as const;
        }
        await r.codes.update(row.id, { usedAt: at });
        return u;
      });
      if (user === "reused") throw new AppError("PASSWORD_REUSED", "Choose a password different from your old one.", { fields: { newPassword: "Choose a password different from your old one." } });
      if (!user) throw new AppError("NOT_FOUND");
      await setNewPassword(user, req.newPassword, "reset_link", meta, at);
      return { data: { done: true } };
    },
    /** A temporary password's one allowed move: choose your own (AuthController::changePassword:275-315), then sign in. */
    async changePassword(req: { changeToken: string; newPassword: string; device: DeviceInfo }, meta: RequestMeta): Promise<Outcome<SignInResult>> {
      const dev = device(req.device);
      const at = now();
      const id = userOfChangeToken(req.changeToken);
      const u = id ? await unit.run((r) => r.users.byId(id)) : null;
      const verified = u ? verifyChangeToken(hashKey, req.changeToken, u.passwordHash, at) : null;
      // a first sign-in is only good while the password is still temporary and the account usable (changeUser:331-334)
      if (!u || !verified || verified.why !== "first" || !u.mustChangePassword || u.status === "disabled" || u.deletedAt !== null) throw new AppError("CHALLENGE_EXPIRED");
      assertUsable(u, at);
      const problem = passwordProblem(req.newPassword);
      if (problem) throw new AppError("PASSWORD_TOO_WEAK", problem, { fields: { newPassword: problem } });
      const updated = await setNewPassword(u, req.newPassword, "first", meta, at);
      return afterPassword(updated, dev, meta, at);
    },

    /** The screen-lock "enter your password again" (the contract's unlockScreen). A wrong one counts toward the lock like a wrong sign-in. */
    async unlockScreen(session: VerifiedSession, req: { password: string }, meta: RequestMeta, after: After): Promise<Outcome<{ unlocked: true }>> {
      if (req.password === "" || Array.from(req.password).length > 128) throw new AppError("VALIDATION_FAILED", undefined, { fields: { password: "Enter your password" } });
      const at = now();
      // one SELECT, no transaction around it; the writes below run in their own
      const u = await unit.read((r) => r.users.byId(session.userId));
      if (!u) throw new AppError("SESSION_EXPIRED");
      assertUsable(u, at);
      if (!(await hasher.verify(u.passwordHash, req.password))) throw await wrongPassword(u.id, at, meta, after, "unlock");
      await unit.run(async (r) => {
        await r.users.update(u.id, { failedAttempts: 0 });
        if (session.client === "web") await r.sessions.setLocked(session.sessionId, null);
      });
      return { data: { unlocked: true } };
    },

    /** Vault re-check with the password (MJ, 5 Nov 2026): good for RECHECK_MINUTES in this session. A wrong one counts toward the lock like a wrong sign-in. */
    async recheckPassword(session: VerifiedSession, req: { password: string }, meta: RequestMeta, after: After): Promise<Outcome<{ rechecked: true; validUntil: string }>> {
      if (session.client !== "web") throw new AppError("FORBIDDEN");
      if (req.password === "" || Array.from(req.password).length > 128) throw new AppError("VALIDATION_FAILED", undefined, { fields: { password: "Enter your password" } });
      const at = now();
      const u = await unit.read((r) => r.users.byId(session.userId));
      if (!u) throw new AppError("SESSION_EXPIRED");
      assertUsable(u, at);
      if (!(await hasher.verify(u.passwordHash, req.password))) throw await wrongPassword(u.id, at, meta, after, "recheck");
      return { data: await rechecked(session, u.id, "password", meta, at) };
    },

    /** Vault re-check with a code: a fresh 6-digit code is emailed (purpose 'recheck', ten minutes, at most 5 an hour). The answer names the code row, never the code. */
    async sendRecheckCode(session: VerifiedSession): Promise<Outcome<{ challengeId: string; maskedEmail: string; resendAfterSeconds: number }>> {
      if (session.client !== "web") throw new AppError("FORBIDDEN");
      const at = now();
      return unit.run(async (r) => {
        const u = await r.users.byId(session.userId);
        if (!u) throw new AppError("SESSION_EXPIRED");
        assertUsable(u, at);
        if (!u.email) throw new AppError("CONFLICT", "This account has no email address for a code. Use your password instead.");
        const issued = await issueCode(r, u, "recheck", at);
        if (!issued.ok) throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: issued.retryAfterSeconds });
        return { data: { challengeId: issued.row.id, maskedEmail: maskEmail(u.email), resendAfterSeconds: RESEND_SECONDS } };
      });
    },

    /** The emailed re-check code: five wrong ones cancel it (as at sign-in). Only the person it was sent to can use it, in their own session. */
    async recheckCode(session: VerifiedSession, req: { challengeId: string; code: string }, meta: RequestMeta): Promise<Outcome<{ rechecked: true; validUntil: string }>> {
      if (session.client !== "web") throw new AppError("FORBIDDEN");
      const code = req.code.replace(/[\s-]/g, "");
      if (!/^\d{6}$/.test(code)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { code: "Enter the 6-digit code" } });
      const at = now();
      const state = await unit.run(async (r) => {
        const row = /^[0-9a-f-]{36}$/.test(req.challengeId) ? await r.codes.byId(req.challengeId) : null;
        if (!row || row.purpose !== "recheck" || row.userId !== session.userId || row.usedAt !== null || row.expiresAt <= at) return { kind: "expired" as const };
        if (safeEqualHex(row.codeHash, hashAuthCode(hashKey, "recheck", row.userId, code))) {
          await r.codes.update(row.id, { usedAt: at });
          return { kind: "good" as const };
        }
        const attempts = row.attempts + 1;
        await r.codes.update(row.id, attempts >= MAX_ATTEMPTS ? { attempts, usedAt: at } : { attempts });
        return { kind: "wrong" as const, attempts };
      });
      if (state.kind === "expired") throw new AppError("CHALLENGE_EXPIRED");
      if (state.kind === "wrong") {
        await unit.run((r) => r.events.event({ userId: session.userId, hotelId: null, event: "code_failed", ip: meta.ip, userAgent: null, detail: { purpose: "recheck", attempts: state.attempts }, at }));
        if (state.attempts >= MAX_ATTEMPTS) throw new AppError("CODE_ATTEMPTS_EXCEEDED");
        throw new AppError("INVALID_CODE", undefined, { attemptsLeft: MAX_ATTEMPTS - state.attempts });
      }
      return { data: await rechecked(session, session.userId, "code", meta, at) };
    },

    /** The screen lock, kept on the session (sessions.locked_at): until the password unlocks it, every route but the session check, unlock and sign-out answers 423. */
    async lockScreen(session: VerifiedSession): Promise<Outcome<{ locked: true }>> {
      if (session.client !== "web") throw new AppError("FORBIDDEN");
      if (!session.locked) await unit.run((r) => r.sessions.setLocked(session.sessionId, now()));
      return { data: { locked: true } };
    },

    /**
     * The session as it stands. It does NOT extend the idle window (the route is marked touch: false). `known`: the access record the session resolver built
     * the session from (resolver.accessOf); with it nothing is loaded again and only what is missing is read, at the same time: the Hotel Admin's checklist row
     * (one plain SELECT) and the hotel's food name. The answer is the same either way.
     */
    async getSession(session: VerifiedSession, known?: AccessRecord | null): Promise<Outcome<Session>> {
      // inside an Enter-hotel visit the person is platform staff and not a member of the visited hotel: the answer is their own account with the
      // visited hotel's context (its SuperAdmin abilities) and a `visit` block (hotel, server expiry, readOnly) for the banner
      const visit = session.visit;
      let access: AccessRecord | null;
      let setupRow: HotelSetupRecord | null;
      let food: Promise<string | null> | undefined;
      if (known) {
        access = known;
        food = known.hotel ? foodNameOf(known.hotel.id) : undefined;
        setupRow = !visit && known.hotel && known.user.accountRole === "hotel_admin" ? await unit.read((r) => r.hotelSetup.find(known.hotel!.id)) : null;
      } else {
        ({ access, setupRow } = await unit.run(async (r) => {
          const found = visit ? await r.access.loadVisit(session.userId, visit.hotelId) : await r.access.load(session.userId, session.hotelId === "" ? null : session.hotelId);
          const row = !visit && found?.hotel && found.user.accountRole === "hotel_admin" ? await r.hotelSetup.get(found.hotel.id) : null;
          return { access: found, setupRow: row };
        }));
      }
      if (!access) throw new AppError("SESSION_EXPIRED");
      const user = await hmsUser(access, setupRow, food);
      return {
        data: {
          user: visit ? { ...user, role: session.accountRole } : user,
          // an API key never reaches this route (denied in the wrapper), so the answer is always a browser session's
          client: "web" as const,
          expiresAt: (session.expiresAt ?? now()).toISOString(),
          token: null,
          ...(session.locked ? { locked: true as const } : {}),
          ...(visit ? { visit: { id: visit.id, hotelId: visit.hotelId, hotelName: visit.hotelName, expiresAt: visit.expiresAt.toISOString(), readOnly: visit.access !== "full", access: visit.access } } : {}),
        },
      };
    },

    /** The "Set up your hotel" checklist of the signed-in Hotel Admin's hotel: `applies` is false for everyone else and for a hotel without one. */
    async getHotelSetup(session: VerifiedSession): Promise<HotelSetupDto> {
      if (session.accountRole !== "hotel_admin" || session.visit || session.hotelId === "") return NO_SETUP;
      // one plain SELECT (find: no savepoint, nothing to keep usable outside a transaction)
      const row = await unit.read((r) => r.hotelSetup.find(session.hotelId));
      return row ? setupDto(row) : NO_SETUP;
    },

    /** Saves the checklist (the whole state, as the screen holds it). "Go live" (`finished`) needs every other step done or skipped, ends the checklist for good and is audited. */
    async putHotelSetup(session: VerifiedSession, input: HotelSetupInput, meta: RequestMeta): Promise<HotelSetupDto> {
      if (session.accountRole !== "hotel_admin" || session.visit || session.hotelId === "") throw new AppError("FORBIDDEN");
      const at = now();
      return unit.run(async (r) => {
        const row = await r.hotelSetup.get(session.hotelId);
        if (!row) throw new AppError("NOT_FOUND");
        if (row.status === "done" || row.status === "skipped") throw new AppError("CONFLICT", "This hotel is already set up.");
        const steps = input.steps;
        const others = Object.entries(steps).filter(([k]) => k !== "live");
        if (input.finished && !(others.length > 0 && others.every(([, v]) => v === "done" || v === "skipped"))) throw new AppError("CONFLICT", "Finish or skip every step before going live.");
        const everything = Object.values(steps);
        const status = input.finished ? (others.every(([, v]) => v === "skipped") ? "skipped" : "done") : everything.some((v) => v !== "todo") ? "in_progress" : "pending";
        const final = status === "done" || status === "skipped";
        const saved = await r.hotelSetup.save(session.hotelId, { status, steps, hidden: final ? true : input.hidden, updatedBy: session.userId, doneAt: final ? at : null });
        if (final) await r.events.audit({ actorUserId: session.userId, hotelId: session.hotelId, action: status === "done" ? "hotel_setup.done" : "hotel_setup.skipped", entity: "hotel", entityId: session.hotelId, traceId: meta.traceId, at });
        return setupDto(saved);
      });
    },

    async signOut(session: VerifiedSession, meta: RequestMeta): Promise<Outcome<{ signedOut: true }>> {
      const at = now();
      await unit.run(async (r) => {
        await r.sessions.revokeById(session.sessionId, "logout", at);
        await r.events.event({ userId: session.userId, hotelId: session.hotelId || null, event: "logout", ip: meta.ip, userAgent: null, detail: null, at });
        await closeVisits(r, session.sessionId, session.userId, meta.traceId, at);
      });
      return { data: { signedOut: true } };
    },

    /**
     * An administrator blocks an account: no timer, and the account's sessions end (reason 'blocked'). Called by the users module (later);
     * here so the rule and its tests live with sign-in. A stranger's wrong attempts only ever LOCK and never touch the owner's sessions.
     */
    async blockUser(actor: { userId: string; hotelId: string | null }, targetUserId: string, meta: RequestMeta): Promise<void> {
      const at = now();
      await unit.run(async (r) => {
        const u = await r.users.byId(targetUserId, { forUpdate: true });
        if (!u) throw new AppError("NOT_FOUND");
        await r.users.update(u.id, { blockedAt: at, blockedKind: "admin" });
        await r.sessions.revokeActive(u.id, "blocked", at);
        await r.events.event({ userId: u.id, hotelId: actor.hotelId, event: "account_blocked", ip: meta.ip, userAgent: null, detail: { by: actor.userId }, at });
        await r.events.audit({ actorUserId: actor.userId, hotelId: actor.hotelId, action: "user.block", entity: "user", entityId: u.id, traceId: meta.traceId, at });
        if (u.email) await queueMail(r, { userId: u.id, kind: "account_blocked", toEmail: u.email, payload: { name: u.displayName } }, at);
      });
    },

    async unblockUser(actor: { userId: string; hotelId: string | null }, targetUserId: string, meta: RequestMeta): Promise<void> {
      const at = now();
      await unit.run(async (r) => {
        const u = await r.users.byId(targetUserId, { forUpdate: true });
        if (!u) throw new AppError("NOT_FOUND");
        await r.users.update(u.id, { blockedAt: null, blockedKind: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null });
        await r.events.event({ userId: u.id, hotelId: actor.hotelId, event: "account_unblocked", ip: meta.ip, userAgent: null, detail: { by: actor.userId }, at });
        await r.events.audit({ actorUserId: actor.userId, hotelId: actor.hotelId, action: "user.unblock", entity: "user", entityId: u.id, traceId: meta.traceId, at });
      });
    },
  };

  /** Marks the session re-checked (the wrong-try count starts again) and writes it to the audit log: who, how and when, nothing secret. */
  async function rechecked(session: VerifiedSession, userId: string, how: "password" | "code", meta: RequestMeta, at: Date): Promise<{ rechecked: true; validUntil: string }> {
    await unit.run(async (r) => {
      await r.users.update(userId, { failedAttempts: 0 });
      await r.sessions.setRechecked(session.sessionId, at);
      await r.events.audit({ actorUserId: userId, hotelId: null, action: how === "code" ? "vault.rechecked_by_code" : "vault.rechecked_by_password", entity: "user", entityId: userId, traceId: meta.traceId, at });
    });
    return { rechecked: true, validUntil: addMs(at, minutes(RECHECK_MINUTES)).toISOString() };
  }

  /** HMS (#13): 10 wrong reset codes in 24 hours stop new reset codes for the account for 24 hours. */
  /** Sets a new password and ends every session (AuthController::changePassword:291-310). A reset also clears a timed lock; HMS (#13): it does NOT lift an administrator's block. */
  async function setNewPassword(u: UserRecord, newPassword: string, why: "first" | "reset" | "reset_link", meta: RequestMeta, at: Date): Promise<UserRecord> {
    if (await hasher.verify(u.passwordHash, newPassword)) {
      throw new AppError("PASSWORD_REUSED", why === "first" ? "Choose a password different from the temporary one." : "Choose a password different from your old one.", {
        fields: { newPassword: why === "first" ? "Choose a password different from the temporary one." : "Choose a password different from your old one." },
      });
    }
    const passwordHash = await hasher.hash(newPassword);
    return unit.run(async (r) => {
      await r.users.update(u.id, { passwordHash, mustChangePassword: false, tempPasswordAt: null, passwordChangedAt: at, failedAttempts: 0, lockLevel: 0, lockedUntil: null, status: u.status === "invited" ? "active" : u.status });
      await r.sessions.revokeActive(u.id, "password_changed", at);
      await r.events.event({ userId: u.id, hotelId: null, event: why === "first" ? "password_changed" : "password_reset_done", ip: meta.ip, userAgent: null, detail: why === "reset_link" ? { by: "link" } : null, at });
      await r.events.audit({ actorUserId: u.id, hotelId: null, action: why === "reset" ? "password.reset_by_code" : why === "reset_link" ? "password.reset_by_link" : "user.first_password_set", entity: "user", entityId: u.id, traceId: meta.traceId, at });
      if (u.email) await queueMail(r, { userId: u.id, kind: "password_changed", toEmail: u.email, payload: { name: u.displayName } }, at);
      return { ...u, passwordHash, mustChangePassword: false };
    });
  }

  return api;
}

export type AuthService = ReturnType<typeof createAuthService>;

/**
 * Signing out (or the session ending) closes any hotel visit bound to the session at that moment, with a hotel_exited audit row for one still running,
 * so the audit trail never shows a console user inside a hotel after they left.
 */
export async function closeVisits(r: Pick<AuthRepos, "visits" | "events">, sessionId: string, userId: string, traceId: string | null, at: Date): Promise<void> {
  for (const v of await r.visits.endForSession(sessionId, "signed_out", userId, at)) {
    if (v.live) await r.events.audit({ actorUserId: userId, hotelId: v.hotelId, action: "hotel_exited", entity: "hotel", entityId: v.hotelId, traceId: traceId ?? "sign-out", at });
  }
}

/** The checklist as the screen holds it: each step todo / visited / done / skipped, "Skip for now" (hidden) and "Go live" pressed (finished). */
interface HotelSetupDto {
  applies: boolean;
  steps: Record<string, string>;
  hidden: boolean;
  finished: boolean;
}
interface HotelSetupInput {
  steps: Record<string, "todo" | "visited" | "done" | "skipped">;
  hidden: boolean;
  finished: boolean;
}
const NO_SETUP: HotelSetupDto = { applies: false, steps: {}, hidden: false, finished: false };
const setupDto = (row: HotelSetupRecord): HotelSetupDto => ({ applies: row.status !== "done" && row.status !== "skipped", steps: row.steps, hidden: row.hidden, finished: row.status === "done" || row.status === "skipped" });
