// Sign-in and security rules the Super Admin sets (Platform settings > Security, MJ 5 Nov 2026): how long each user kind stays signed in and how long a
// temporary password works. Stored in platform.platform_settings (security.session_minutes, security.temp_password_minutes; platform migration 0192).
import type { Role } from '../auth/types';

export type SessionKind = Role;

export const SESSION_KINDS: readonly SessionKind[] = ['super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user'];

export const SESSION_KIND_LABELS: Record<SessionKind, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Admin',
  group_hotel_admin: 'Group Hotel Admin',
  hotel_admin: 'Hotel Admin',
  hotel_user: 'Hotel User',
  corporate_user: 'Company',
  guest_user: 'Guest',
};

const HOUR = 60;
const DAY = 24 * HOUR;

/** 12 hours for the staff kinds, 7 days for company and guest. */
export const SESSION_MINUTES_DEFAULT: Readonly<Record<SessionKind, number>> = {
  super_admin: 12 * HOUR,
  platform_admin: 12 * HOUR,
  group_hotel_admin: 12 * HOUR,
  hotel_admin: 12 * HOUR,
  hotel_user: 12 * HOUR,
  corporate_user: 7 * DAY,
  guest_user: 7 * DAY,
};
export const SESSION_MINUTES_MIN = 15;
export const SESSION_MINUTES_MAX = 30 * DAY;
export const SESSION_MINUTE_CHOICES: readonly number[] = [15, 30, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

export const TEMP_PASSWORD_MINUTES_DEFAULT = 30;
export const TEMP_PASSWORD_MINUTES_MIN = 5;
export const TEMP_PASSWORD_MINUTES_MAX = DAY;
export const TEMP_PASSWORD_MINUTE_CHOICES: readonly number[] = [15, 30, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, DAY];

/** Five wrong passwords lock the account for this long. */
export const LOCK_MINUTES = 15;
/** A vault shows secrets for this long after the person proves it is them again. */
export const RECHECK_MINUTES = 5;

export interface SecuritySettings {
  sessionMinutes: Record<SessionKind, number>;
  tempPasswordMinutes: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SecuritySettingsInput {
  sessionMinutes?: Partial<Record<SessionKind, number>>;
  tempPasswordMinutes?: number;
}

const whole = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
export const validSessionMinutes = (n: unknown): n is number => whole(n, SESSION_MINUTES_MIN, SESSION_MINUTES_MAX);
export const validTempPasswordMinutes = (n: unknown): n is number => whole(n, TEMP_PASSWORD_MINUTES_MIN, TEMP_PASSWORD_MINUTES_MAX);

/** The stored value read safely: each kind's own number when it is within the bounds, its default otherwise. */
export function sessionMinutesOf(raw: unknown): Record<SessionKind, number> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(SESSION_KINDS.map((k) => [k, validSessionMinutes(o[k]) ? o[k] : SESSION_MINUTES_DEFAULT[k]])) as Record<SessionKind, number>;
}

export function tempPasswordMinutesOf(raw: unknown): number {
  return validTempPasswordMinutes(raw) ? raw : TEMP_PASSWORD_MINUTES_DEFAULT;
}

/** "15 minutes", "1 hour", "12 hours", "1 day", "7 days". */
export function durationText(minutes: number): string {
  if (minutes % DAY === 0) return minutes === DAY ? '1 day' : `${minutes / DAY} days`;
  if (minutes % HOUR === 0) return minutes === HOUR ? '1 hour' : `${minutes / HOUR} hours`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
