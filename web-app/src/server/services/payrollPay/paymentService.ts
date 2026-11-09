import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { PayEmployee, PaymentMonth, PaymentStatus, PayrollCompanyRef, ReportResult, SalaryRecord } from "@shared/dashboards/payrollPay";
import { requirePermission } from "../../auth/permissions";
import { AppError } from "../../errors";
import { unwrapVersioned } from "../../repos/unwrap";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { PayrollMasterList } from "../../repos/payrollCore";
import { PAYMENT_STATUSES, type PaymentPatch, type SalaryProcessingRecord, type SlipSort } from "../../repos/payrollPay";
import { wordsOf } from "./listView";
import { istMoment } from "../cash/ist";
import { companyOrFail, notFound, payrollKit, requireAnyPayroll, type PayrollDeps, type PayrollPayFigures, type PayrollUnitRepos, type PayrollWrite } from "../payrollCore/context";
import { choices } from "../payrollCore/masters";
import { fieldError, Rules } from "../payrollCore/validate";
import { numberFormat, payEmployee, periodOf, salaryRecord } from "./dto";
import { mealStatement } from "./mealsService";
import type { BulkPaymentBody, PaymentBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";

// Salary payments (Pallav SalaryPaymentController), slips (SalarySlipController), the reports (SalaryReportController) and the pickers the pay
// screens share, plus the dashboard's pay half (PayrollPayFigures). Every month is read in ONE query with its lines in one more. Spec:
// docs/specs/payroll-pay.md §4-6.

/** A choice in the pay screens' staff picker (GET .../staff/lookup). */
export interface PayStaffItem {
  id: string;
  name: string;
  code: string;
  designation: string;
}
/** The Salary Slips summary (GET .../slips): the month asked for, else every slip; never follows the page, search, status or sort. */
export interface SlipSummary {
  period: string | null;
  slips: number;
  people: number;
  netPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  byStatus: Record<PaymentStatus, number>;
  latestPeriod: string | null;
  /** The net pay of the `latestPeriod` month's slips (0 when there are none). */
  latestNetPaise: number;
  /** How many distinct months have slips. */
  periods: number;
}
/** PaymentMonth plus, when a page was asked for, where that page sits (`page.total` = every row of the month). */
export type PagedPaymentMonth = PaymentMonth & { page?: { page: number; pageSize: number; total: number } };

/** The payments screen's filter, search and sort, applied before paging (the summary always counts the whole month). */
export interface PaymentView {
  status?: PaymentStatus;
  search?: string;
  sort?: "employee" | "net" | "paid" | "balance" | "paidOn" | "status";
  dir?: "asc" | "desc";
}

/** Without `sort` the month keeps Pallav's order (unpaid first, then paid latest first, then by name). */
function viewOf(rows: readonly SalaryProcessingRecord[], view: PaymentView): SalaryProcessingRecord[] {
  const words = (view.search ?? "").trim().toLowerCase();
  let out = rows.filter((r) => (!view.status || r.paymentStatus === view.status) && (words === "" || [r.employeeName, r.employeeCode, r.designation ?? "", r.paymentReference ?? ""].some((v) => v.toLowerCase().includes(words))));
  if (view.sort) {
    const keys: Record<NonNullable<PaymentView["sort"]>, (r: SalaryProcessingRecord) => string | bigint> = {
      employee: (r) => r.employeeName.toLowerCase(),
      net: (r) => r.netSalaryPaise,
      paid: (r) => r.paidAmountPaise,
      balance: (r) => (r.netSalaryPaise > r.paidAmountPaise ? r.netSalaryPaise - r.paidAmountPaise : ZERO),
      paidOn: (r) => r.paidAt ?? "",
      status: (r) => r.paymentStatus,
    };
    const key = keys[view.sort];
    const sign = view.dir === "desc" ? -1 : 1;
    // ties by name, then code, so a page never reshuffles
    out = [...out].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x !== y) return (x < y ? -1 : 1) * sign;
      return a.employeeName.localeCompare(b.employeeName) || a.employeeCode.localeCompare(b.employeeCode);
    });
  }
  return out;
}

const BULK: readonly PaymentStatus[] = ["Pending", "Processing", "On Hold", "Paid", "Failed"];
const SETTLING: readonly PaymentStatus[] = ["Paid", "Partially Paid"];
const ZERO = BigInt(0);
const n = paiseToNumber;
const FUTURE = "The payment date cannot be in the future.";

export function createPaymentService(deps: PayrollDeps) {
  const { unit, catalog, people, now } = deps;
  const kit = payrollKit(deps);
  const today = (): string => istMoment(now()).date;

  async function records(repos: PayrollUnitRepos, rows: readonly SalaryProcessingRecord[]): Promise<SalaryRecord[]> {
    const lines = await repos.salaryProcessings.lines(rows.map((r) => r.id));
    const names = await people.get([...new Set(rows.flatMap((r) => (r.paymentUpdatedBy ? [r.paymentUpdatedBy] : [])))]);
    return rows.map((r) => salaryRecord(r, lines, r.paymentUpdatedBy ? (names.get(r.paymentUpdatedBy)?.name ?? "Removed user") : null));
  }

  /** SalaryReportController::resolveMonth (:22-39): the month asked for, else the latest processed, else this month; never past this month. */
  async function resolveMonth(repos: PayrollUnitRepos, companyId: string, period?: string): Promise<{ year: number; month: number }> {
    const current = today().slice(0, 7);
    let asked = period;
    if (!asked) {
      const latest = await repos.salaryProcessings.latestPeriod(companyId);
      asked = latest ? periodOf(latest) : current;
    }
    const use = asked > current ? current : asked;
    return { year: Number(use.slice(0, 4)), month: Number(use.slice(5, 7)) };
  }

  /** applyPayment (:115-147) */
  function paymentPatch(p: SalaryProcessingRecord, data: { status: PaymentStatus; paidPaise?: number | null; paidOn: string | null; reference: string | null; remarks?: string | null }, userId: string): PaymentPatch {
    let paid = ZERO;
    if (data.status === "Paid") paid = p.netSalaryPaise;
    else if (data.status === "Partially Paid") {
      paid = BigInt(data.paidPaise ?? 0);
      if (paid <= ZERO || paid >= p.netSalaryPaise) {
        throw fieldError("paidPaise", `A partial payment must be more than ₹0 and less than the net salary of ₹${numberFormat(p.netSalaryPaise)}.`);
      }
    }
    const settles = SETTLING.includes(data.status);
    return {
      paymentStatus: data.status,
      paidAmountPaise: paid,
      paidAt: settles ? (data.paidOn ?? today()) : null,
      paymentReference: data.reference ?? (settles ? p.paymentReference : null),
      paymentRemarks: data.remarks !== undefined ? data.remarks : p.paymentRemarks,
      paymentUpdatedBy: userId,
      paymentUpdatedAt: now(),
    };
  }

  /** SalaryProcessing InAccountingYear: a closed year's salary can still be paid, dated this year ($booksPending, $booksActionDates paid_at). */
  async function guardPayment(w: PayrollWrite, p: SalaryProcessingRecord, patch: PaymentPatch): Promise<void> {
    const date = `${periodOf(p)}-01`;
    await kit.guard(w, { was: date, now: date, action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: p.paidAt, now: patch.paidAt }] } }, "paidOn");
  }

  function validDate(v: Rules, key: string, value: string): string | null {
    const d = v.date(key, "paid at", Rules.clean(value));
    if (d && !v.has(key) && d > today()) v.fail(key, FUTURE);
    return d;
  }

  return {
    /* ---------------------------------------------------------- the pickers */

    async companies(session: VerifiedSession): Promise<PayrollCompanyRef[]> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) =>
        (await repos.payrollCompanies.list({ active: true })).map((c) => ({ id: c.id, name: c.name, code: c.code, providesFood: c.code === "PF01", address: [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", "), gstin: "" })),
      );
    },

    /** The pay screens' lean picker: name or employee-code prefix, at most 50, only what a choice list shows. Any payroll part's view. */
    async staffLookup(session: VerifiedSession, companyId: string, q: { q?: string; limit: number; activeOnly: boolean }): Promise<PayStaffItem[]> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const found = await repos.employees.lookup(companyId, { prefix: q.q ?? "", limit: Math.min(50, q.limit), active: q.activeOnly ? true : undefined });
        return found.map((e) => ({ id: e.id, name: e.name, code: e.employeeCode, designation: e.designation ?? "" }));
      });
    },

    async employees(session: VerifiedSession, companyId: string, activeOnly: boolean): Promise<PayEmployee[]> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        // the whole company in one query (no COUNT), capped at 5,000 people; the paged list is GET .../employees
        const listed = await repos.employees.list(companyId, { active: activeOnly ? true : undefined, deleted: "no", sort: "name", page: 1, pageSize: 5000, countTotal: false });
        return listed.rows.map((e) => payEmployee(e));
      });
    },

    async masterChoices(session: VerifiedSession, companyId: string, list: PayrollMasterList): Promise<string[]> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        return choices(repos, list, companyId);
      });
    },

    /* ---------------------------------------------------------- payments */

    async periods(session: VerifiedSession, companyId: string): Promise<string[]> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        return (await repos.salaryProcessings.periods(companyId)).map(periodOf);
      });
    },

    /** index (:20-58): unpaid first, then latest paid; the figures over the month (outstanding is each person's balance, added up). */
    /** One month's payments. Without `paging` every row (as Pallav's screen); with it, that page of rows. The summary always counts the whole month. */
    async month(session: VerifiedSession, companyId: string, period?: string, paging?: { page: number; pageSize: number }, view: PaymentView = {}): Promise<PagedPaymentMonth> {
      requirePermission(session, catalog, "payroll.salary-payment", "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const m = await resolveMonth(repos, companyId, period);
        const rows = await repos.salaryProcessings.month(companyId, m.year, m.month, "payments");
        const byStatus = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, rows.filter((r) => r.paymentStatus === s).length])) as Record<PaymentStatus, number>;
        const sum = (f: (r: SalaryProcessingRecord) => bigint): bigint => rows.reduce((t, r) => t + f(r), ZERO);
        const filtered = viewOf(rows, view);
        const shown = paging ? filtered.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize) : filtered;
        return {
          period: periodOf(m),
          rows: await records(repos, shown),
          ...(paging ? { page: { page: paging.page, pageSize: paging.pageSize, total: filtered.length } } : {}),
          summary: {
            netPaise: n(sum((r) => r.netSalaryPaise)),
            paidPaise: n(sum((r) => r.paidAmountPaise)),
            outstandingPaise: n(sum((r) => (r.netSalaryPaise > r.paidAmountPaise ? r.netSalaryPaise - r.paidAmountPaise : ZERO))),
            fullyPaid: byStatus.Paid,
            total: rows.length,
            byStatus,
          },
        };
      });
    },

    /** update (:60-79) */
    async update(session: VerifiedSession, companyId: string, id: string, input: PaymentBody, meta: RequestMeta): Promise<SalaryRecord> {
      requirePermission(session, catalog, "payroll.salary-payment", "edit");
      const actor = await kit.actor(session);
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const w: PayrollWrite = { repos, session, meta, actor, company };
        const p = await repos.salaryProcessings.get(companyId, id, { forUpdate: true });
        if (!p) throw notFound();
        const v = new Rules();
        const status = v.oneOf("status", "payment status", v.required("status", "payment status", input.status), PAYMENT_STATUSES) as PaymentStatus | null;
        if (input.paidPaise !== null) v.atLeast("paidPaise", "paid amount", input.paidPaise, 0);
        const paidOn = validDate(v, "paidOn", input.paidOn);
        const reference = v.text("reference", "payment reference", input.reference, 100);
        const remarks = v.text("remarks", "payment remarks", input.remarks, 500);
        v.done();
        const patch = paymentPatch(p, { status: status!, paidPaise: input.paidPaise, paidOn, reference, remarks }, session.userId);
        await guardPayment(w, p, patch);
        const saved = unwrapVersioned(await repos.salaryProcessings.updatePayment(p.id, patch, input.version === undefined ? undefined : { expectedVersion: input.version }));
        await kit.log(w, { action: "updated", entity: "Salary Payment", summary: `${saved.employeeName} marked ${saved.paymentStatus}.`, subject: { id: p.id, label: `${saved.employeeName} (${saved.employeeCode})` }, details: { Month: periodOf(saved), Status: saved.paymentStatus, Paid: numberFormat(saved.paidAmountPaise) } });
        return (await records(repos, [saved]))[0];
      });
    },

    /** bulk (:81-101): every chosen salary of THIS company, one status (no partial amount); one unit. */
    async bulk(session: VerifiedSession, companyId: string, input: BulkPaymentBody, meta: RequestMeta): Promise<{ updated: number; message: string }> {
      requirePermission(session, catalog, "payroll.salary-payment", "edit");
      const actor = await kit.actor(session);
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const w: PayrollWrite = { repos, session, meta, actor, company };
        const v = new Rules();
        if (input.ids.length === 0) v.fail("ids", "Select at least one employee.");
        const status = v.oneOf("status", "payment status", v.required("status", "payment status", input.status), BULK) as PaymentStatus | null;
        const paidOn = validDate(v, "paidOn", input.paidOn);
        const reference = v.text("reference", "payment reference", input.reference, 100);
        v.done();
        const rows = await repos.salaryProcessings.getMany(companyId, input.ids, { forUpdate: true });
        // any stale version refuses the whole update, before anything is written
        const stale = rows.find((p) => input.versions?.[p.id] !== undefined && input.versions[p.id] !== p.version);
        if (stale) throw new AppError("CONFLICT", undefined, { currentVersion: stale.version });
        for (const p of rows) {
          const patch = paymentPatch(p, { status: status!, paidOn, reference }, session.userId);
          await guardPayment(w, p, patch);
          unwrapVersioned(await repos.salaryProcessings.updatePayment(p.id, patch));
        }
        const message = `${rows.length} payment(s) marked ${status}.`;
        await kit.log(w, { action: "updated", entity: "Salary Payment", summary: message, subject: null, details: { Status: status, People: rows.length } });
        return { updated: rows.length, message };
      });
    },

    /* ---------------------------------------------------------- slips */

    /**
     * SalarySlipController::index: newest period first, newest processing within it. Search, status and sort apply before paging (`total` counts
     * what they keep); the summary covers the month asked for, else every slip, whatever the page, search, status or sort.
     */
    async slips(
      session: VerifiedSession,
      companyId: string,
      q: { search?: string; period?: string; page: number; pageSize: number; status?: PaymentStatus; sort?: SlipSort; dir?: "asc" | "desc" },
    ): Promise<Page<SalaryRecord> & { summary: SlipSummary }> {
      requirePermission(session, catalog, "payroll.salary-slip", "view");
      const words = wordsOf(q.search);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const period = q.period ? { year: Number(q.period.slice(0, 4)), month: Number(q.period.slice(5, 7)) } : undefined;
        const listed = await repos.salaryProcessings.list(companyId, { words, period, status: q.status, sort: q.sort ? { key: q.sort, dir: q.dir ?? "asc" } : undefined, page: q.page, pageSize: q.pageSize });
        const s = await repos.salaryProcessings.slipSummary(companyId, period);
        return {
          items: await records(repos, listed.rows),
          total: listed.total,
          page: q.page,
          pageSize: q.pageSize,
          summary: {
            period: q.period ?? null,
            slips: s.slips,
            people: s.people,
            netPaise: n(s.netPaise),
            paidPaise: n(s.paidPaise),
            outstandingPaise: n(s.outstandingPaise),
            byStatus: s.byStatus,
            latestPeriod: s.latest ? periodOf(s.latest) : null,
            latestNetPaise: n(s.latestNetPaise),
            periods: s.periods,
          },
        };
      });
    },

    async slip(session: VerifiedSession, companyId: string, id: string): Promise<SalaryRecord> {
      requirePermission(session, catalog, "payroll.salary-slip", "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const p = await repos.salaryProcessings.get(companyId, id);
        if (!p) throw notFound();
        return (await records(repos, [p]))[0];
      });
    },

    /* ---------------------------------------------------------- reports */

    /** index (:41-80): a range inside one month, not past today; the processed salaries of that month (one person or all), by name. */
    async periodReport(session: VerifiedSession, companyId: string, q: { from: string; to: string; employeeId?: string; search?: string }): Promise<ReportResult> {
      requirePermission(session, catalog, "payroll.period-report", "view");
      let error: [string, string] | null = null;
      if (q.from > q.to) error = ["from", "From Date must be on or before To Date."];
      else if (q.from.slice(0, 7) !== q.to.slice(0, 7)) error = ["to", "The selected date range must belong to the same month and year."];
      else if (q.to > today()) error = ["to", "The selected date range must not exceed the current date."];
      if (error) throw fieldError(error[0], error[1]);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const rows = await repos.salaryProcessings.month(companyId, Number(q.from.slice(0, 4)), Number(q.from.slice(5, 7)), "name", { employeeId: q.employeeId });
        return searched(report(await records(repos, rows), null), q.search);
      });
    },

    /** monthlyIndex (:82-101): the month (resolveMonth), every person by name. The meals bill comes with task B6b. */
    async monthlyReport(session: VerifiedSession, companyId: string, period?: string, search?: string): Promise<ReportResult & { period: string }> {
      requirePermission(session, catalog, "payroll.monthly-report", "view");
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const m = await resolveMonth(repos, companyId, period);
        const rows = await repos.salaryProcessings.month(companyId, m.year, m.month, "name");
        // what Hotel Pallav owes Pallav Food for its staff's meals (FoodCharges::statement, final: only once the month's salary is generated)
        const bill = rows.length > 0 ? await mealStatement(repos, company, m.year, m.month, { live: false, today: today() }) : null;
        return { ...searched(report(await records(repos, rows), bill ? n(bill.totalPaise) : null), search), period: periodOf(m) };
      });
    },
  };
}

/** The report's page search: only the rows narrow (employee, code, designation, department); the totals stay the whole month's. */
function searched(r: ReportResult, search?: string): ReportResult {
  return search ? { ...r, rows: matchWords(r.rows, search, (x) => [x.employeeName, x.employeeCode, x.designation, x.department]) } : r;
}

function report(rows: SalaryRecord[], mealsBillPaise: number | null): ReportResult {
  const sum = (f: (r: SalaryRecord) => number): number => rows.reduce((t, r) => t + f(r), 0);
  return {
    rows,
    totals: {
      salaryPaise: sum((r) => r.monthlySalaryPaise),
      attendancePaise: sum((r) => r.attendanceSalaryPaise),
      otHours: Math.round(sum((r) => r.otHours) * 100) / 100,
      otPaise: sum((r) => r.otAmountPaise),
      bonusPaise: sum((r) => r.bonusPaise),
      incentivePaise: sum((r) => r.incentivePaise),
      deductionsPaise: sum((r) => r.deductions.reduce((t, d) => t + d.paise, 0)),
      advancePaise: sum((r) => r.advanceRecoveryPaise),
      netPaise: sum((r) => r.netPaise),
      payableDays: Math.round(sum((r) => r.payableDays) * 100) / 100,
    },
    mealsBillPaise,
  };
}

/** The dashboard's pay half (PayrollDashboardController :20-45, :129-155, :165-200): ONE aggregate per table, the latest few rows. */
export function createPayFigures(): PayrollPayFigures {
  const pad = (x: number): string => String(x).padStart(2, "0");
  return {
    async figures(repos, companyId) {
      const f = await repos.salaryProcessings.figures(companyId);
      const adv = await repos.payrollAdvances.figures(companyId);
      const advances = await repos.payrollAdvances.list(companyId, { viewFrom: null, page: 1, pageSize: 4 });
      const bonuses = await repos.bonuses.list(companyId, { viewFrom: null, page: 1, pageSize: 4 });
      const leavers = await repos.separations.list(companyId, { page: 1, pageSize: 3 });
      const recent = [
        ...advances.rows.map((a) => ({ at: a.advanceDate.toISOString(), icon: "wallet", title: a.employeeName ?? "Removed employee", detail: `Advance of ₹${numberFormat(a.amountPaise)}`, viewId: "hotel.payroll.advances" })),
        ...bonuses.rows.map((b) => ({ at: b.entryDate.toISOString(), icon: "gift", title: b.employeeName ?? "Removed employee", detail: `${b.type} of ₹${numberFormat(b.amountPaise)}`, viewId: "hotel.payroll.bonus" })),
        ...leavers.rows.map((x) => ({ at: new Date(`${x.lastWorkingDate}T00:00:00+05:30`).toISOString(), icon: "logout", title: x.employeeName ?? "Removed employee", detail: `${x.separationType} - ${x.status}`, viewId: "hotel.payroll.resignations" })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 7);
      return {
        payrollMonth: f.latest ? `${f.latest.year}-${pad(f.latest.month)}` : null,
        netPaise: f.netPaise,
        paidPaise: f.paidPaise,
        unpaidCount: f.unpaid,
        payrollCount: f.count,
        advanceOutstandingPaise: adv.outstandingPaise,
        advanceOpen: adv.open,
        openPayments: f.open,
        failedPayments: f.failed,
        onNotice: (await repos.separations.counts(companyId)).inNotice,
        recent,
      };
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
