import "server-only";
import type { Catalog } from "../../auth/catalog";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { BillingRepos } from "../../repos/billing";
import type { AttendanceMonthRecord, EmployeeRecord, PayrollCompanyRecord, PayrollCoreRepos, PayrollLogEntry, StaffEmailRecord } from "../../repos/payrollCore";
import type { PayrollPayRepos } from "../../repos/payrollPay";
import type { Unit } from "../../repos/types";
import { guardBooks, guardWouldRefuse, type GuardInput } from "../cash/books";
import type { PeopleDirectory, Person, PlatformAudit } from "../cash/ports";
import { forceOn } from "../cash/rules";

// What the payroll-core services share: dependencies, the PORTS approved by Backend review (2026-10-05) and the company context. Spec:
// docs/specs/payroll-core.md. A payroll service runs in the hotel's one unit (the same data as billing), so it also gets the accounting
// years and the force log.

export type PayrollUnitRepos = PayrollCoreRepos & PayrollPayRepos & Pick<BillingRepos, "accountingYears" | "forceLogs" | "optionLists">;

/**
 * The mail of payroll, through the platform outbox (ruled). Called INSIDE the unit, after the record that tracks it is written; `queued`
 * false means nothing was queued (no mailer yet), and the caller finishes the record as failed with Pallav's sentence.
 */
export interface PayrollMail {
  staffDetails(hotelId: string, mail: { recordId: string; to: string; toName: string; subject: string; attachment: { name: string; status: "ready" | "pending" }; sharedBy: string }): Promise<{ queued: boolean }>;
  offerLetter(hotelId: string, mail: { employeeId: string; to: string; toName: string; subject: string; attachment: { name: string; status: "ready" | "pending" } }): Promise<{ queued: boolean }>;
}

/**
 * The mail attachments (MJ #22, pdfkit): the staff record sheet and the appointment letter. `ready` means the document renders for this person with
 * the sender's permissions; the outbox row carries only the kind and the ids, and the worker renders again at SEND time (nothing is stored).
 * The stub answers "pending" (tests that do not care).
 */
export interface DocumentRenderer {
  render(kind: "employee" | "offer-letter", data: Record<string, unknown>, session?: VerifiedSession): Promise<{ status: "ready"; bytes: Uint8Array } | { status: "pending" }>;
}

/** SalaryProcessor::generate (task B6): writes the payroll-pay rows of the month, inside the SAME unit; the caller then locks the month. */
export interface SalaryRun {
  generate(repos: PayrollUnitRepos, month: AttendanceMonthRecord, userId: string): Promise<void>;
}

/** The pay half of the dashboard (task B6). */
export interface PayrollPayFigures {
  figures(repos: PayrollUnitRepos, companyId: string): Promise<{
    payrollMonth: string | null;
    netPaise: bigint;
    paidPaise: bigint;
    unpaidCount: number;
    payrollCount: number;
    advanceOutstandingPaise: bigint;
    advanceOpen: number;
    openPayments: number;
    failedPayments: number;
    onNotice: number;
    recent: { at: string; icon: string; title: string; detail: string; viewId: string }[];
  }>;
}

export interface PayrollDeps {
  unit: Unit<PayrollUnitRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  mail: PayrollMail;
  renderer: DocumentRenderer;
  /** null until task B6: generate and re-generate answer 422 with details.fields.reason. */
  salaryRun: SalaryRun | null;
  payFigures: PayrollPayFigures | null;
}

export const PAYROLL_MODULE = "payroll";
export const PART = {
  dashboard: "payroll.dashboard",
  staff: "payroll.staff",
  attendance: "payroll.attendance",
  statuses: "payroll.attendance-status",
  deductions: "payroll.deduction",
} as const;
const PARTS = Object.values(PART);

export const SALARY_NOT_READY = "Salary generation arrives with Payroll Pay.";

/** Any payroll part's view (the company list and the switcher, ruled). */
export function requireAnyPayroll(session: VerifiedSession, catalog: Catalog): void {
  if (can(session, catalog, PAYROLL_MODULE, "view") || PARTS.some((p) => can(session, catalog, p, "view"))) return;
  requirePermission(session, catalog, PAYROLL_MODULE, "view");
}

/** PayrollContext::currentOrFail: the company is this hotel's and active, else 404 "Select a company first.". */
export async function companyOrFail(repos: PayrollUnitRepos, companyId: string): Promise<PayrollCompanyRecord> {
  const c = await repos.payrollCompanies.get(companyId);
  if (!c || !c.isActive) throw new AppError("NOT_FOUND", "Select a company first.");
  return c;
}

export const notFound = (message?: string): AppError => new AppError("NOT_FOUND", message);

/** A refusal shown as the page's message (Pallav `back()->with('error', ...)` / PayrollRules::refuse 403). */
export const refuse = (message: string): AppError => new AppError("FORBIDDEN", message);
/** A business rule the request broke (Pallav's flash error on an allowed action). */
export const conflict = (message: string): AppError => new AppError("CONFLICT", message);

export interface PayrollWrite {
  repos: PayrollUnitRepos;
  session: VerifiedSession;
  meta: RequestMeta;
  actor: Person | undefined;
  company: PayrollCompanyRecord;
}

export function payrollKit(deps: PayrollDeps) {
  const { catalog, audit, people } = deps;

  async function forceAudit(w: PayrollWrite, what: string): Promise<void> {
    await w.repos.forceLogs.write({ userId: w.session.userId, userName: w.actor?.name ?? "System", action: "lock", module: PAYROLL_MODULE, summary: `Forced past a lock: ${what}`, details: { Lock: what }, route: null, method: null, ipAddress: w.meta.ip });
    await audit.record({ action: "force.override", userId: w.session.userId, hotelId: w.session.hotelId, details: { lock: what, traceId: w.meta.traceId } });
  }

  return {
    actor: async (session: VerifiedSession): Promise<Person | undefined> => (await people.get([session.userId])).get(session.userId),

    /** ForceMode::locked: true = refuse; under force the lock steps aside and is written to the force log. */
    async locked(condition: boolean, what: string, w: PayrollWrite): Promise<boolean> {
      if (!condition) return false;
      if (!forceOn(w.session, catalog)) return true;
      await forceAudit(w, what);
      return false;
    },

    /** Pallav InAccountingYear on AttendanceMonth ($booksDate = year, month): the 1st of the month is the date that is guarded. */
    async guardMonth(w: PayrollWrite, month: { year: number; month: number }): Promise<void> {
      const date = `${month.year}-${String(month.month).padStart(2, "0")}-01`;
      const input = { years: await w.repos.accountingYears.list(), was: date, now: date, action: "save" as const };
      if (forceOn(w.session, catalog)) {
        if (guardWouldRefuse(input)) await forceAudit(w, "Accounting year lock");
        return;
      }
      guardBooks(input);
    },

    /** Books::guard for any payroll record (InAccountingYear), with the refusal on the apps' field for the date. */
    async guard(w: PayrollWrite, input: Omit<GuardInput, "years">, field = "date"): Promise<void> {
      const full = { ...input, years: await w.repos.accountingYears.list() };
      if (forceOn(w.session, catalog)) {
        if (guardWouldRefuse(full)) await forceAudit(w, "Accounting year lock");
        return;
      }
      try {
        guardBooks(full);
      } catch (error) {
        if (error instanceof AppError && field !== "date") throw new AppError("VALIDATION_FAILED", error.message, { fields: { [field]: error.message } });
        throw error;
      }
    },

    /** PayrollLogger::record into payroll_logs. Never a password, token, bank or ID number (the callers pass plain labels only). */
    async log(w: PayrollWrite, line: Pick<PayrollLogEntry, "action" | "entity" | "summary" | "details"> & { status?: PayrollLogEntry["status"]; subject?: { id: string; label: string } | null }): Promise<void> {
      await w.repos.payrollLog.record({
        payrollCompanyId: w.company.id,
        companyName: w.company.name,
        userId: w.session.userId,
        userName: w.actor?.name ?? "System",
        action: line.action,
        status: line.status ?? "success",
        entity: line.entity,
        subjectId: line.subject?.id ?? null,
        subjectLabel: line.subject?.label ?? null,
        summary: line.summary.slice(0, 500),
        details: line.details,
        ipAddress: w.meta.ip,
      });
    },

    force: (session: VerifiedSession): boolean => forceOn(session, catalog),
  };
}


/** The month as the apps name it: "2026-10". */
export const monthKey = (m: { year: number; month: number }): string => `${m.year}-${String(m.month).padStart(2, "0")}`;
/** Pallav's log label: "10/2026". */
export const monthLabel = (m: { year: number; month: number }): string => `${m.month}/${m.year}`;

export type { EmployeeRecord, StaffEmailRecord };
