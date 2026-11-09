import "server-only";
// The PORT between the business-side Admin (users, roles, masters, settings, reports...) and the credential side of the platform (Backend 1 / hms-f3).
// Admin NEVER hashes, stores, compares or reads a password, token, one-time code or 2FA secret, and never reads a credential column. Where an
// action needs one it calls this port; Backend 1 implements it over the auth tables (hash, invite code, outbox mail, session revocation). Tests
// give Admin a fake. Interface only: no implementation here.

import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";

/** What the caller learns: the mail was queued (or not), never a secret. */
export interface CredentialOutcome {
  /** The mail (invite, reset notice, e-mail change notice) was put on the outbox. false: the person has no usable address or no outbox is configured. */
  queued: boolean;
}

/** The emailed-code switch as the profile shows it: on, and whether this person may change it (never an administrator). */
export interface TwoFactorState {
  codeRequired: boolean;
  canChange: boolean;
  reason?: string;
}

/** What the signed-in person does about their OWN credentials from the profile (the account service calls these; it never sees a hash). */
export interface ProfileCredentials {
  /**
   * Change my password: the current one is checked on the locked row, the new one must pass the rule and differ; my OTHER sessions end and I am
   * mailed. Refusals: INVALID_CREDENTIALS (current wrong), PASSWORD_TOO_WEAK, PASSWORD_REUSED, each with the field and the sentence.
   */
  changeMyPassword(session: VerifiedSession, req: { currentPassword: string; newPassword: string }, meta: RequestMeta): Promise<{ changed: true; otherSessionsEnded: number }>;
  /** Switch my emailed sign-in code on or off (decision 46: every account, administrators included). OFF needs my current password (wrong = counted like a wrong sign-in). */
  setMyTwoFactor(session: VerifiedSession, codeRequired: boolean, meta?: RequestMeta, currentPassword?: string): Promise<TwoFactorState>;
}

/** What the users screen asks of the credential side about SOMEONE ELSE. */
export interface AdminCredentials {
  /**
   * A new user was just created by an administrator (status "invited"): issues the one-time invite (a code or link the person uses to choose a
   * password) and queues the mail. Admin sends only the user id; the hotel comes from the unit that created the user.
   */
  issueInvite(userId: string): Promise<CredentialOutcome>;

  /**
   * An administrator resets someone's password: invalidates the old one and every session of that person, issues a one-time reset the person
   * completes themselves (Admin never sees or sets a password), and queues the mail. The person must change it at next sign-in.
   */
  adminResetPassword(userId: string): Promise<CredentialOutcome>;

  /**
   * Changes the sign-in e-mail address: the address is a credential channel (codes and resets go to it). Backend 1 validates, stores it, tells the
   * old and the new address, and ends the person's other sessions. Admin passes the new address as typed (already trimmed and lower-cased).
   * Resolves with `ok: false` and a sentence when the address is taken or not allowed.
   */
  changeEmail(userId: string, newEmail: string): Promise<{ ok: true } & CredentialOutcome | { ok: false; message: string }>;
}

/** The whole port: the users screen's calls and the profile's own. */
export interface CredentialService extends AdminCredentials, ProfileCredentials {}
