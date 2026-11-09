import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { SystemAdminRepos } from "../../repos/systemAdmin";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory } from "../cash/ports";
import { istInstant, istMoment } from "../cash/ist";
import { isSuperAdmin } from "../cash/rules";

// What the system pages (System Log, Force Log, System Health) and the payroll administration (Payroll Master, Payroll Log) share: dependencies, the
// SuperAdmin gate (Pallav: every one of these controllers is "SuperAdmin only"), and the IST day arithmetic of the "today" and "last 7 days" views.

/** What the server can learn about itself without the database: the disk and the mail driver in use. Never a secret. */
export interface HealthProbes {
  /** Free and total bytes of the disk the app runs from, or null when it cannot be read. */
  disk(): Promise<{ freeBytes: number; totalBytes: number } | null>;
  /** The mail sender in use: "log" while no SMTP sender exists (compose/mail.ts). */
  mailDriver(): string;
  /** Deployment warnings in plain sentences (ops/notices.ts: photo storage on a serverless host, the database login); absent = none. */
  notices?(): Promise<string[]>;
}

export interface SystemAdminDeps {
  unit: Unit<SystemAdminRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  probes: HealthProbes;
  now: () => Date;
}

export function requireSuperAdmin(session: VerifiedSession, what: string): void {
  if (!isSuperAdmin(session)) throw new AppError("FORBIDDEN", `Only the SuperAdmin can open ${what}.`);
}

const DAY_MS = 86_400_000;

/** The instant an IST day starts. */
export const dayStart = (date: string): Date => istInstant(date, "00:00:00");

/** Today in IST and the instants of today, tomorrow and six days ago (Carbon::today()->subDays(6)). */
export function istWindow(now: Date): { today: string; todayStart: Date; tomorrowStart: Date; weekStart: Date } {
  const today = istMoment(now).date;
  const todayStart = dayStart(today);
  return { today, todayStart, tomorrowStart: new Date(todayStart.getTime() + DAY_MS), weekStart: new Date(todayStart.getTime() - 6 * DAY_MS) };
}

/** whereDate(created_at, >= from) / (<= to) on the IST day: the instants of the window, `to` inclusive. */
export function dayRange(from?: string, to?: string): { fromAt?: Date; toAt?: Date } {
  return { ...(from ? { fromAt: dayStart(from) } : {}), ...(to ? { toAt: new Date(dayStart(to).getTime() + DAY_MS) } : {}) };
}

/** A log line's details as label -> text (money stays the paise number the line was written with). */
export function detailsText(details: unknown): Record<string, string> | null {
  if (details === null || details === undefined || typeof details !== "object" || Array.isArray(details)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) out[k] = typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v);
  return Object.keys(out).length > 0 ? out : null;
}

/** Two filters must not both narrow a time window: the view's window and the from/to window are combined (the later start, the earlier end). */
export function intersect(a: { fromAt?: Date; toAt?: Date }, b: { fromAt?: Date; toAt?: Date }): { fromAt?: Date; toAt?: Date } {
  const fromAt = a.fromAt && b.fromAt ? (a.fromAt > b.fromAt ? a.fromAt : b.fromAt) : (a.fromAt ?? b.fromAt);
  const toAt = a.toAt && b.toAt ? (a.toAt < b.toAt ? a.toAt : b.toAt) : (a.toAt ?? b.toAt);
  return { ...(fromAt ? { fromAt } : {}), ...(toAt ? { toAt } : {}) };
}
