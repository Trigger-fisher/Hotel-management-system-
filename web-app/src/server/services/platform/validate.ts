import "server-only";
import {
  RESERVED_SLUGS, normaliseMobile, platformCopy,
} from "@shared/dashboards/platform";
import { AppError } from "../../errors";

// The console's input rules, the same words as the screens (ui-shared/dashboards/platform.ts `platformCopy.errors`). Pure: the "taken" checks
// (slug, username, e-mail, mobile) are done by the service against the repository, because they need the database.

const E = platformCopy.errors;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type Fields = Record<string, string>;

/** 422 VALIDATION_FAILED with the field sentences; nothing when there are none. */
export function failIfAny(fields: Fields): void {
  const first = Object.values(fields)[0];
  if (first !== undefined) throw new AppError("VALIDATION_FAILED", first, { fields });
}

export const lower = (s: string): string => s.trim().toLowerCase();

export function slugProblem(raw: string): string | null {
  const slug = lower(raw);
  if (slug === "") return E.required.slug;
  if (slug.length < 3 || slug.length > 40 || !SLUG_RE.test(slug)) return E.slugFormat;
  if (RESERVED_SLUGS.includes(slug)) return E.slugReserved;
  return null;
}

interface AdminFields {
  name: string;
  username: string;
  email: string;
  mobile: string;
}

/** The person fields (shape only). The caller adds the "already taken" sentences. */
export function checkAdmin(a: AdminFields, prefix: string, f: Fields): void {
  const name = a.name.trim();
  if (!name) f[`${prefix}name`] = E.required.adminName;
  else if (Array.from(name).length > 100) f[`${prefix}name`] = E.nameLong;
  const u = lower(a.username);
  if (!u) f[`${prefix}username`] = E.required.username;
  else if (!USERNAME_RE.test(u)) f[`${prefix}username`] = E.usernameFormat;
  const e = lower(a.email);
  if (!e) f[`${prefix}email`] = E.required.email;
  else if (e.length > 254 || !EMAIL_RE.test(e)) f[`${prefix}email`] = E.emailFormat;
  if (!a.mobile.trim()) f[`${prefix}mobile`] = E.required.mobile;
  else if (!normaliseMobile(a.mobile)) f[`${prefix}mobile`] = E.mobileFormat;
}

/** "+91" and ten digits, as platform.users stores a mobile; null when it is not an Indian mobile. */
export function storedMobile(raw: string): string | null {
  const ten = normaliseMobile(raw);
  return ten ? `+91${ten}` : null;
}

export const MOBILE_TAKEN = "Another account already uses this mobile number.";

/** IST calendar month "YYYY-MM" of a moment (the "New this month" tile). */
export function istMonth(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}
