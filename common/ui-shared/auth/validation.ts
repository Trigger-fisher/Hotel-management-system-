// Client-side checks shared by web and mobile. The server repeats every check.

export type IdentifierKind = 'email' | 'mobile' | 'username';

// Invisible and control characters (Unicode C* categories) are never allowed (LESSONS 9).
const INVISIBLE = /\p{C}/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const LIMITS = {
  identifierMax: 254,
  passwordMin: 8,
  passwordMax: 128,
  totpLength: 6,
} as const;

/** Indian mobile: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9. Spaces and dashes allowed. */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export type FieldError =
  | 'required'
  | 'invalid_identifier'
  | 'invalid_username'
  | 'invalid_email'
  | 'invisible_characters'
  | 'too_short'
  | 'too_long'
  | 'mismatch'
  | 'password_rules'
  | 'invalid_code';

export function validateEmail(raw: string): FieldError | null {
  const v = raw.trim();
  if (!v) return 'required';
  if (INVISIBLE.test(v)) return 'invisible_characters';
  return EMAIL.test(v) && v.length <= LIMITS.identifierMax ? null : 'invalid_email';
}

/** For sign-in and screen unlock: only "is it filled". Never hint at the rules of an existing password. */
/** Pallav login (MJ #9): sign in with a USERNAME only. Lower-cased, 3 to 32 of a-z 0-9 . _ - */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): FieldError | null {
  const v = raw.trim();
  if (!v) return 'required';
  if (INVISIBLE.test(v)) return 'invisible_characters';
  return USERNAME.test(v.toLowerCase()) ? null : 'invalid_username';
}

/**
 * The ONE sign-in page for every person (MJ, 2026-10-06): the field takes a USERNAME or an EMAIL (both are unique);
 * the server finds the account and the app opens that person's own dashboard.
 */
export function validateSignInName(raw: string): FieldError | null {
  const v = raw.trim();
  if (!v) return 'required';
  if (INVISIBLE.test(v)) return 'invisible_characters';
  if (v.includes('@')) return EMAIL.test(v) && v.length <= LIMITS.identifierMax ? null : 'invalid_email';
  return USERNAME.test(v.toLowerCase()) ? null : 'invalid_username';
}

/** Lower-cased and trimmed; an email and a username are both stored lower-case. */
export function normaliseSignInName(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateExistingPassword(pw: string): FieldError | null {
  return pw ? null : 'required';
}

/**
 * New-password rule (MJ, 2026-10-05: "password will be 8 with regex"):
 * 8 to 128 characters, at least one uppercase, one lowercase, one number and one special character.
 * The server uses this same regex.
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`~])\S{8,128}$/u;

const SPECIAL = /[!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`~]/;

export interface PasswordCheck {
  id: 'length' | 'uppercase' | 'lowercase' | 'number' | 'special' | 'not_identifier' | 'no_invisible';
  ok: boolean;
}

/** Live checklist for a NEW password (reset, invite, forced change). */
export function newPasswordChecks(pw: string, avoid: string[] = []): PasswordCheck[] {
  const lower = pw.toLowerCase();
  return [
    { id: 'length', ok: pw.length >= LIMITS.passwordMin && pw.length <= LIMITS.passwordMax },
    { id: 'uppercase', ok: /[A-Z]/.test(pw) },
    { id: 'lowercase', ok: /[a-z]/.test(pw) },
    { id: 'number', ok: /\d/.test(pw) },
    { id: 'special', ok: SPECIAL.test(pw) },
    {
      id: 'not_identifier',
      ok:
        pw.length > 0 &&
        !avoid.some((a) => {
          const local = a.toLowerCase().split('@')[0] ?? '';
          return local.length >= 3 && lower.includes(local);
        }),
    },
    { id: 'no_invisible', ok: pw.length > 0 && !INVISIBLE.test(pw) && !/\s/.test(pw) },
  ];
}

export function validateNewPassword(pw: string, confirm: string, avoid: string[] = []): {
  password: FieldError | null;
  confirm: FieldError | null;
} {
  let password: FieldError | null = null;
  if (!pw) password = 'required';
  else if (pw.length < LIMITS.passwordMin) password = 'too_short';
  else if (pw.length > LIMITS.passwordMax) password = 'too_long';
  else if (!PASSWORD_REGEX.test(pw)) password = 'password_rules';
  else if (newPasswordChecks(pw, avoid).some((c) => !c.ok)) password = 'password_rules';
  return { password, confirm: !confirm ? 'required' : confirm !== pw ? 'mismatch' : null };
}

/**
 * The 6 digits of a typed or pasted code, or null: "123456", "123 456", "123-456", "123456." and a whole pasted line holding exactly one
 * 6-digit code ("Your sign-in code is 123456. It works for 10 minutes.") all work.
 */
export function normaliseTotp(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 6) return digits;
  const runs = raw.match(/(?<!\d)\d{3}[ -]?\d{3}(?!\d)/g);
  return runs && runs.length === 1 ? runs[0].replace(/\D/g, '') : null;
}
