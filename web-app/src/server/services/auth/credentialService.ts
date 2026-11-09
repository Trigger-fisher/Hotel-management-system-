import "server-only";
import { randomInt } from "node:crypto";
import { tempPasswordMinutesOf } from "@shared/dashboards/security";
import type { PasswordHasher } from "../../auth/password";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AuthRepos, PlatformUnit, SessionRecord, UserRecord } from "../../repos/auth";
import type { AdminCredentials, CredentialOutcome, ProfileCredentials, TwoFactorState } from "./credentialPort";
import { queueMail, signInLink } from "./mail";
import { HMS_LOCK_MINUTES, MAX_ATTEMPTS, passwordProblem } from "./policy";

// Everything that touches a credential, in one place (the admin split: Worker B's Admin never sees a password, a code or a secret and calls
// the CredentialService port; the profile's credential pages call the extra methods below). Sign-in is Pallav's: password + an EMAILED code.
// There is no authenticator app, no recovery code and no invite link: a new or reset account gets an emailed TEMPORARY PASSWORD and must
// choose its own at the first sign-in (D2, MJ #13). "Two-factor" is the `code_required` switch: the person's own choice for every account (decision 46; default off). Nothing secret is ever logged or returned: a temporary password lives only inside the
// outbox payload; the audit rows hold names and ids.

export const EMAIL_TAKEN_MESSAGE = "That email address is already used by another account.";
export const EMAIL_SAME_MESSAGE = "That is already the email address on this account.";
export const EMAIL_INVALID_MESSAGE = "Enter a valid email address.";
/** ProfileController::changePassword: the two sentences Pallav shows (the UI shows its own copy for the error code). */
export const CURRENT_PASSWORD_MESSAGE = "Your current password is incorrect.";
export const REUSED_MESSAGE = "The new password must be different from the current one.";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

interface CredentialDeps {
  /** Only `run`: every credential change is a write, and the console passes its own transaction's repositories as `{ run: (w) => w(repos.auth) }`. */
  unit: Pick<PlatformUnit, "run">;
  hasher: PasswordHasher;
  now: () => Date;
  /** Tests fix the temporary password; production uses a CSPRNG. */
  newTempPassword?: () => string;
  /** The app's public address: the invitation and reset mails carry a Sign in button to `${publicUrl}/login`. */
  publicUrl?: string;
}

/** A session as the profile page shows it. Never the token, never its hash. */
export interface MySession {
  id: string;
  client: "web";
  deviceLabel: string | null;
  ip: string | null;
  issuedAt: Date;
  lastSeenAt: Date | null;
  current: boolean;
}

export type { TwoFactorState };

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%&*?";

/** 12 characters that pass Pallav's password rule: at least one of each class, shuffled, no look-alike letters. */
export function randomTempPassword(): string {
  const pick = (set: string): string => set[randomInt(0, set.length)];
  const all = UPPER + LOWER + DIGIT + SPECIAL;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function createCredentialService(deps: CredentialDeps) {
  const { unit, hasher, now } = deps;
  const tempPassword = deps.newTempPassword ?? randomTempPassword;

  async function liveUser(r: AuthRepos, userId: string): Promise<UserRecord> {
    const user = await r.users.byId(userId, { forUpdate: true });
    if (!user || user.deletedAt !== null) throw new AppError("NOT_FOUND", "No such person");
    return user;
  }

  /** Gives the person a new temporary password (they must change it at the next sign-in) and mails it. */
  async function giveTemporaryPassword(userId: string, kind: "temp_password" | "admin_reset", action: string): Promise<CredentialOutcome> {
    const at = now();
    const password = tempPassword();
    if (passwordProblem(password) !== null) throw new AppError("SERVER_ERROR", "The generated password does not meet the rule");
    const passwordHash = await hasher.hash(password);
    return unit.run(async (r) => {
      const user = await liveUser(r, userId);
      if (kind === "temp_password" && user.status !== "invited") throw new AppError("CONFLICT", "This account is already set up");
      await r.users.update(user.id, { passwordHash, mustChangePassword: true, tempPasswordAt: at, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null });
      // an administrator's reset ends every session of the person; an invite has none yet
      if (kind === "admin_reset") await r.sessions.revokeActive(user.id, "password_changed", at);
      await r.events.event({ userId: user.id, hotelId: null, event: kind === "admin_reset" ? "password_reset_done" : "password_changed", ip: null, userAgent: null, detail: { by: "administrator" }, at });
      await r.events.audit({ actorUserId: null, hotelId: null, action, entity: "user", entityId: user.id, traceId: null, at });
      if (!user.email) return { queued: false };
      // the email says how long the temporary password works (the Super Admin's time, Platform settings > Security)
      const minutes = tempPasswordMinutesOf((await r.access.security()).tempPasswordMinutes);
      await queueMail(r, { userId: user.id, kind, toEmail: user.email, payload: { name: user.displayName, username: user.username, tempPassword: password, link: signInLink(deps.publicUrl), minutes } }, at);
      return { queued: true };
    });
  }

  const service: AdminCredentials = {
    issueInvite: (userId) => giveTemporaryPassword(userId, "temp_password", "user.invite_issued"),
    adminResetPassword: (userId) => giveTemporaryPassword(userId, "admin_reset", "user.password_reset_by_admin"),

    async changeEmail(userId, newEmail) {
      const email = typeof newEmail === "string" ? newEmail.trim().toLowerCase() : "";
      if (email.length === 0 || email.length > 254 || !EMAIL_SHAPE.test(email)) return { ok: false, message: EMAIL_INVALID_MESSAGE };
      const at = now();
      return unit.run(async (r) => {
        const user = await liveUser(r, userId);
        if (user.email === email) return { ok: false as const, message: EMAIL_SAME_MESSAGE };
        const other = await r.users.byEmail(email);
        if (other && other.id !== user.id) return { ok: false as const, message: EMAIL_TAKEN_MESSAGE };
        const old = user.email;
        await r.users.update(user.id, { email });
        // the address is where codes and resets go: every other way in is closed until the person signs in again
        await r.sessions.revokeActive(user.id, "admin", at);
        await r.events.audit({ actorUserId: null, hotelId: null, action: "user.email_changed", entity: "user", entityId: user.id, traceId: null, at });
        if (old) await queueMail(r, { userId: user.id, kind: "email_changed", toEmail: old, payload: { name: user.displayName } }, at);
        await queueMail(r, { userId: user.id, kind: "email_changed", toEmail: email, payload: { name: user.displayName } }, at);
        return { ok: true as const, queued: true };
      });
    },

  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // the profile's credential pages: what a person does about their OWN credentials
  // ---------------------------------------------------------------------------------------------------------------------------------
  const mine = {
    /** Change my password: the current one is checked first (Pallav has no lock on this form, so a wrong one counts nothing), the new one must pass the rule and differ; my OTHER sessions end. */
    async changeMyPassword(session: VerifiedSession, req: { currentPassword: string; newPassword: string }, meta: RequestMeta): Promise<{ changed: true; otherSessionsEnded: number }> {
      const at = now();
      // the new rule is checked before anything is touched; the CURRENT password is checked inside the unit, on the locked row, so two
      // changes made at the same moment cannot both succeed with the same old password
      const problem = passwordProblem(req.newPassword);
      const newHash = problem ? "" : await hasher.hash(req.newPassword);
      return unit.run(async (r) => {
        const user = await liveUser(r, session.userId);
        if (!(await hasher.verify(user.passwordHash, req.currentPassword))) throw new AppError("INVALID_CREDENTIALS", CURRENT_PASSWORD_MESSAGE, { fields: { currentPassword: CURRENT_PASSWORD_MESSAGE } });
        if (problem) throw new AppError("PASSWORD_TOO_WEAK", problem, { fields: { newPassword: problem } });
        if (await hasher.verify(user.passwordHash, req.newPassword)) throw new AppError("PASSWORD_REUSED", REUSED_MESSAGE, { fields: { newPassword: REUSED_MESSAGE } });
        await r.users.update(user.id, { passwordHash: newHash, passwordChangedAt: at, mustChangePassword: false, tempPasswordAt: null });
        const ended = await r.sessions.revokeOthers(user.id, session.sessionId, "password_changed", at);
        await r.events.event({ userId: user.id, hotelId: session.hotelId, event: "password_changed", ip: meta.ip, userAgent: null, detail: null, at });
        await r.events.audit({ actorUserId: user.id, hotelId: session.hotelId, action: "user.password_changed", entity: "user", entityId: user.id, traceId: meta.traceId, at });
        if (user.email) await queueMail(r, { userId: user.id, kind: "password_changed", toEmail: user.email, payload: { name: user.displayName } }, at);
        return { changed: true as const, otherSessionsEnded: ended };
      });
    },

    /** Where I am signed in: my valid sessions, newest first, the one in use marked. */
    async listMySessions(session: VerifiedSession): Promise<MySession[]> {
      const rows = await unit.run((r) => r.sessions.listActive(session.userId, now()));
      return rows.map((s: SessionRecord) => ({ id: s.id, client: s.client, deviceLabel: s.deviceLabel, ip: s.ip, issuedAt: s.issuedAt, lastSeenAt: s.lastSeenAt, current: s.id === session.sessionId }));
    },

    /** End one of MY other sessions. Somebody else's id is "not found", never "forbidden" (nothing to learn); the one in use is ended by sign-out. */
    async endMySession(session: VerifiedSession, sessionId: string): Promise<{ ended: true }> {
      if (sessionId === session.sessionId) throw new AppError("VALIDATION_FAILED", "This is the session you are using: sign out instead.");
      const at = now();
      return unit.run(async (r) => {
        const rows = await r.sessions.listActive(session.userId, at);
        if (!rows.some((s) => s.id === sessionId)) throw new AppError("NOT_FOUND");
        await r.sessions.revokeById(sessionId, "logout", at);
        await r.events.event({ userId: session.userId, hotelId: session.hotelId, event: "logout", ip: null, userAgent: null, detail: { by: "profile" }, at });
        return { ended: true as const };
      });
    },

    /** End every session of mine except this one. */
    async endOtherSessions(session: VerifiedSession): Promise<{ ended: number }> {
      const at = now();
      return unit.run(async (r) => ({ ended: await r.sessions.revokeOthers(session.userId, session.sessionId, "logout", at) }));
    },

    /** The emailed-code switch as the profile page shows it (decision 46: every account may switch it, administrators included). */
    async myTwoFactor(session: VerifiedSession): Promise<TwoFactorState> {
      const user = await unit.run((r) => liveUser(r, session.userId));
      return { codeRequired: user.codeRequired, canChange: true };
    },

    /**
     * Switch my emailed sign-in code on or off (decision 46). ON needs nothing extra. OFF needs the CURRENT PASSWORD: a missing or wrong one counts like a wrong
     * sign-in (five tries, then the same timed lock) and the answer is INVALID_CREDENTIALS on the field `password`, or ACCOUNT_LOCKED. Only ever my own account.
     */
    async setMyTwoFactor(session: VerifiedSession, codeRequired: boolean, meta?: RequestMeta, currentPassword?: string): Promise<TwoFactorState> {
      const at = now();
      if (!codeRequired) {
        const outcome = await unit.run(async (r) => {
          const user = await r.users.byId(session.userId, { forUpdate: true });
          if (!user || user.deletedAt !== null) throw new AppError("NOT_FOUND");
          if (user.lockedUntil !== null && user.lockedUntil > at) return { state: "locked" as const, seconds: Math.ceil((user.lockedUntil.getTime() - at.getTime()) / 1000) };
          if (currentPassword !== undefined && currentPassword !== "" && (await hasher.verify(user.passwordHash, currentPassword))) return { state: "ok" as const };
          const attempts = user.failedAttempts + 1;
          if (attempts < MAX_ATTEMPTS) {
            await r.users.update(user.id, { failedAttempts: attempts });
            return { state: "wrong" as const };
          }
          const mins = HMS_LOCK_MINUTES;
          await r.users.update(user.id, { failedAttempts: 0, lockLevel: Math.min(user.lockLevel + 1, 6), lockedUntil: new Date(at.getTime() + mins * 60_000) });
          await r.events.event({ userId: user.id, hotelId: null, event: "account_locked", ip: meta?.ip ?? null, userAgent: null, detail: { minutes: mins, via: "profile" }, at });
          return { state: "locked" as const, seconds: mins * 60 };
        });
        if (outcome.state === "locked") throw new AppError("ACCOUNT_LOCKED", undefined, { retryAfterSeconds: outcome.seconds });
        if (outcome.state === "wrong") throw new AppError("INVALID_CREDENTIALS", CURRENT_PASSWORD_MESSAGE, { fields: { password: CURRENT_PASSWORD_MESSAGE } });
      }
      return unit.run(async (r) => {
        const user = await liveUser(r, session.userId);
        await r.users.update(user.id, { codeRequired });
        await r.events.audit({ actorUserId: user.id, hotelId: session.hotelId, action: codeRequired ? "user.two_factor_enabled" : "user.two_factor_disabled", entity: "user", entityId: user.id, traceId: meta?.traceId ?? null, at });
        return { codeRequired, canChange: true };
      });
    },
  };
  return { ...service, ...(mine satisfies ProfileCredentials) };
}

