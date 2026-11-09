import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { FetchLike } from "../../payments/razorpay";
import type { AdminRepos } from "../../repos/admin";
import type { BillingRepos } from "../../repos/billing";
import type { SystemLogEntry } from "../../repos/cashSupport";
import type { Unit } from "../../repos/types";
import type { MailQueue } from "../auth/mail";
import type { PeopleDirectory, Person, PlatformAudit } from "../cash/ports";
import { isSuperAdmin } from "../cash/rules";
import type { SearchRepos } from "./searchService";

// What the admin services share: dependencies, the SuperAdmin gate (Pallav's `superadmin` middleware), and the system-log line in Pallav's words.
// Admin NEVER touches a credential: where an action needs one it calls the CredentialService port (services/auth/credentialPort.ts). Spec: docs/specs/admin.md.

export type AdminUnitRepos = AdminRepos & Pick<BillingRepos, "systemLogs" | "mealPlanRates" | "hotelProfile"> & SearchRepos;

export interface AdminDeps {
  unit: Unit<AdminUnitRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  /** Tests: the key that seals the hotel's SMTP password, instead of SMTP_SECRET_KEY from the environment (null = none). */
  smtpSecretKey?: Buffer | null;
  /** Tests: answers for Razorpay's API instead of the network. */
  razorpayFetch?: FetchLike;
  /** Tests: where a payment link's email is queued, instead of the real outbox. */
  razorpayMail?: Pick<MailQueue, "queue">;
}

export interface Who {
  session: VerifiedSession;
  meta: RequestMeta;
  actor: Person | undefined;
}

export async function actorOf(deps: Pick<AdminDeps, "people">, session: VerifiedSession): Promise<Person | undefined> {
  return (await deps.people.get([session.userId])).get(session.userId);
}

/** The hotel's SuperAdmin only (Pallav `superadmin` middleware): everything else is refused with 403. */
export function requireSuperAdmin(session: VerifiedSession, what = "this"): void {
  if (!isSuperAdmin(session)) throw new AppError("FORBIDDEN", `Only the SuperAdmin can open ${what}.`);
}

/** One line of the system log, under a module of its own ("masters", "settings", "users"...). */
export function logLine(w: Who, module: string, line: { action: SystemLogEntry["action"]; entity: string; summary: string; subject: { id: string; label: string } | null; details?: Record<string, unknown> }): SystemLogEntry {
  return {
    module,
    action: line.action,
    entity: line.entity,
    subjectId: line.subject?.id ?? null,
    subjectLabel: line.subject?.label ?? null,
    summary: line.summary.slice(0, 500),
    details: line.details && Object.keys(line.details).length > 0 ? line.details : null,
    userId: w.session.userId,
    userName: w.actor?.name ?? "System",
    ipAddress: w.meta.ip,
    traceId: w.meta.traceId,
  };
}

/** The two businesses by the names this hotel gave them (site name, food name), for screens and messages; never a project constant. */
export async function businessNamesOf(repos: Pick<AdminUnitRepos, "hotelProfile">): Promise<Record<"hotel" | "food", string>> {
  const h = await repos.hotelProfile.header();
  return { hotel: h.name, food: h.foodName || h.name };
}

export const notFound = (message?: string): AppError => new AppError("NOT_FOUND", message);
export const conflict = (message: string): AppError => new AppError("CONFLICT", message);
export const refuse = (message: string): AppError => new AppError("FORBIDDEN", message);
export const fieldError = (key: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [key]: message } });
