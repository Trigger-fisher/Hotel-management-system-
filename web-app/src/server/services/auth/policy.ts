import "server-only";
import { LOCK_MINUTES, SESSION_KINDS, SESSION_MINUTES_DEFAULT, sessionMinutesOf, tempPasswordMinutesOf, type SessionKind } from "@shared/dashboards/security";

// The password rule, the lock schedule and the code limits of Hotel Pallav's sign-in (Support/PasswordPolicy.php, Services/Auth/OneTimeCode.php,
// Http/Controllers/Auth/AuthController.php), plus MJ's changes (#13), each marked "HMS:" where it differs. Golden-tested against real PHP
// (tests/server/auth.golden.test.ts, fixtures/auth-pallav.json).

/** Five tries is all anyone gets, for a password or for a code (PasswordPolicy::MAX_ATTEMPTS). */
export const MAX_ATTEMPTS = 5;

/** Each lock lasts longer than the last, capped at a day (PasswordPolicy::LOCK_STEPS, in minutes). */
export const LOCK_STEPS = [15, 30, 60, 180, 480, 1440] as const;
export const MAX_LOCK_MINUTES = 1440;

/** How long the next lock lasts for an account that has been locked `level` times before. */
export function lockMinutes(level: number): number {
  const index = Math.max(0, Math.min(level, LOCK_STEPS.length - 1));
  return Math.min(LOCK_STEPS[index], MAX_LOCK_MINUTES);
}

/** Written out, so the sign-in screen can explain the wait (PasswordPolicy::lockLabel). */
export function lockLabel(minutes: number): string {
  if (minutes >= MAX_LOCK_MINUTES) return "24 hours";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

export const PASSWORD_MESSAGE = "Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.";

// PasswordPolicy::REGEX is a PCRE pattern over BYTES with `$` matching before a final newline; this is the same test over the UTF-8 bytes:
// \S is only ASCII non-whitespace, `.` is anything but \n, and a trailing \n is allowed after the last character.
const PASSWORD_REGEX = /^(?=[^\n]*[A-Z])(?=[^\n]*[a-z])(?=[^\n]*\d)(?=[^\n]*[!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`~])[^ \t\n\x0b\f\r]{8,}(?=\n?$)/;

/** Does it pass Pallav's password regex? */
export function passesPasswordRegex(password: string): boolean {
  return PASSWORD_REGEX.test(Buffer.from(password, "utf8").toString("latin1"));
}

/** The password rule as the screens need it: required, at most 128 characters, and the regex. Returns the message, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (Array.from(password).length > 128) return "The password field must not be greater than 128 characters.";
  return passesPasswordRegex(password) ? null : PASSWORD_MESSAGE;
}

/** AuthController::maskEmail: the first two characters, stars for the rest of the name, the domain in full. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "your email";
  const at = email.indexOf("@");
  const name = Array.from(email.slice(0, at));
  const domain = email.slice(at + 1);
  return `${name.slice(0, 2).join("")}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

// ---- the emailed code (OneTimeCode) ----
/** A code is good for ten minutes (OneTimeCode::VALID_MINUTES). */
export const CODE_VALID_MINUTES = 10;
/**
 * HMS: a new code can be asked for after 30 seconds (the contract's resendAfterSeconds); Pallav says 60 (OneTimeCode::RESEND_SECONDS).
 */
export const RESEND_SECONDS = 30;
/** Emails allowed before the wait starts (OneTimeCode::MAX_SENDS). */
export const MAX_SENDS = 5;
/** HMS (MJ #13): the sends are counted per hour, and once the five are used no code is sent until the hour is over (Pallav: a growing wait). */
export const SEND_WINDOW_SECONDS = 3600;
/** A page to choose a new password stays open for 15 minutes once reached (AuthController::CHANGE_MINUTES). */
export const CHANGE_VALID_MINUTES = 15;
/** MASTER 4.2: a web session ends after 120 idle minutes; a phone token lasts 90 days. */
export const WEB_IDLE_MINUTES = 120;

/**
 * HMS (MJ, 5 Nov 2026): five wrong passwords lock the account for 15 minutes, every time (Pallav's growing LOCK_STEPS above stay only as the golden reference).
 */
export const HMS_LOCK_MINUTES = LOCK_MINUTES;

/**
 * However active, a web session ends this long after its sign-in. The Super Admin sets the time per user kind (Platform settings > Security, stored as
 * security.session_minutes); a kind not set, or a stored value out of bounds, uses its default (12 hours for the staff kinds, 7 days for company and guest).
 */
export function maxLifeMinutes(accountRole: string, stored: unknown): number {
  const limits = sessionMinutesOf(stored);
  return (SESSION_KINDS as readonly string[]).includes(accountRole) ? limits[accountRole as SessionKind] : SESSION_MINUTES_DEFAULT.hotel_user;
}

/** When this session's absolute lifetime ends (measured from the sign-in, not from the last request). */
export function maxLifeEnd(issuedAt: Date, accountRole: string, stored: unknown): Date {
  return new Date(issuedAt.getTime() + maxLifeMinutes(accountRole, stored) * 60_000);
}

/** Is this session past its absolute lifetime? */
export function pastMaxLife(issuedAt: Date, accountRole: string, at: Date, stored: unknown = null): boolean {
  return at.getTime() >= maxLifeEnd(issuedAt, accountRole, stored).getTime();
}

/** A temporary password given at `givenAt` no longer works once the Super Admin's time (security.temp_password_minutes, default 30) has passed. */
export function tempPasswordExpired(givenAt: Date | null | undefined, at: Date, stored: unknown): boolean {
  if (!givenAt) return false;
  return at.getTime() - givenAt.getTime() >= tempPasswordMinutesOf(stored) * 60_000;
}
