import "server-only";
import { formatINR } from "@shared/dashboards/format";
import { paiseToNumber } from "../money/paise";
import type { VerifiedSession } from "../auth/session";
import { AppError } from "../errors";
import type { RequestMeta } from "../http/meta";
import type { BillingRepos } from "../repos/billing";
import type { CashDepositRecord, CashRepos } from "../repos/cashDeposit";
import type { CompaniesRepos } from "../repos/companies";
import type { CashBook, EntryBase, EntryRepo } from "../repos/entries";
import type { CashWithdrawalRecord, MiscExpenseRecord } from "../repos/expenses";
import type { PayrollCoreRepos } from "../repos/payrollCore";
import type { PayrollPayRepos } from "../repos/payrollPay";
import type { Unit } from "../repos/types";
import type { EmployeeService } from "../services/payrollCore/employeeService";
import type { AdjustmentService } from "../services/payrollPay/adjustmentService";
import type { MealsService } from "../services/payrollPay/mealsService";
import type { SeparationService } from "../services/payrollPay/separationService";
import type { AdvanceService } from "../services/billing/advanceService";
import type { BillService } from "../services/billing/billService";
import type { CompanyService } from "../services/companies/companyService";
import type { RecycleSource, TrashedRow } from "../services/admin/recycleService";

// The recycle bin's SOURCES: one small adapter per kind of record, over the module that owns it. Each lists the module's deleted rows (a repository read) and
// restores or removes by the module's OWN service, so the accounting-year lock, the unique numbers, the advance money and the permission rule are the module's, not
// copied here. The nightly clean-up purges by the repository, as the system. Spec: docs/specs/admin.md §9. Kinds and labels are Pallav's
// (Support/RecycleBin.php MODELS/LABELS); the shift handover's adapter comes with the handover module.

// the bin needs the rows only, never a COUNT: one query per kind
const EVERYTHING = { page: 1, pageSize: 10_000, countTotal: false } as const;
const day = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const money = (paise: bigint): string => formatINR(paiseToNumber(paise));

interface Deletable {
  id: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  version?: number;
}

function row(r: Deletable, title: string, detail: string): TrashedRow {
  return { id: r.id, title, detail, deletedAt: r.deletedAt as Date, deletedBy: r.deletedBy };
}

interface BillingSourceDeps {
  unit: Unit<BillingRepos>;
  bills: () => BillService;
  advances: () => AdvanceService;
}

/** Bills and guest advances (Pallav "bill" and "advance"). */
export function billingRecycleSources(deps: BillingSourceDeps): RecycleSource[] {
  const bill: RecycleSource = {
    key: "bill",
    label: "Bill",
    list: (who) =>
      deps.unit.run(who, async (repos) => (await repos.bills.list({ deleted: "only", sort: "billDate", dir: "desc", ...EVERYTHING })).rows.map((b) => row(b, b.billNumber, `${b.guestName} · ${money(b.totalHotelAmountPaise + b.totalFoodAmountPaise)} on ${day(b.billDate)}`))),
    restore: async (session, id, meta) => {
      const version = (await deps.unit.run(session, (repos) => repos.bills.get(id, { deleted: true })))?.version ?? 0;
      await deps.bills().restore(session, id, version, meta);
    },
    purge: async (session, id) => void (await deps.bills().purge(session, id)),
    purgeBefore: (hotelId, cutoff) =>
      deps.unit.run({ hotelId, userId: "system" }, async (repos) => {
        let n = 0;
        for (const b of (await repos.bills.list({ deleted: "only", sort: "billDate", dir: "desc", ...EVERYTHING })).rows) if (b.deletedAt && b.deletedAt < cutoff && (await repos.bills.purge(b.id))) n += 1;
        return n;
      }),
  };
  const advance: RecycleSource = {
    key: "advance",
    label: "Bill advance",
    list: (who) =>
      deps.unit.run(who, async (repos) => (await repos.advances.list({ deleted: "only", sort: "paymentDate", dir: "desc", ...EVERYTHING })).rows.map((a) => row(a, a.receiptNumber, `${a.guestName} · ${money(a.totalPaise)} on ${day(a.paymentDate)}`))),
    restore: async (session, id, meta) => {
      const version = (await deps.unit.run(session, (repos) => repos.advances.get(id, { deleted: true })))?.version ?? 0;
      await deps.advances().restore(session, id, version, meta);
    },
    purge: async (session, id) => void (await deps.advances().purge(session, id)),
    purgeBefore: (hotelId, cutoff) =>
      deps.unit.run({ hotelId, userId: "system" }, async (repos) => {
        let n = 0;
        for (const a of (await repos.advances.list({ deleted: "only", sort: "paymentDate", dir: "desc", ...EVERYTHING })).rows) if (a.deletedAt && a.deletedAt < cutoff && (await repos.advances.purge(a.id))) n += 1;
        return n;
      }),
  };
  return [bill, advance];
}

interface CompanySourceDeps {
  unit: Unit<CompaniesRepos>;
  companies: () => CompanyService;
}

/* ---------------------------------------------------------------- Daily Cash (deposits, withdrawals, miscellaneous expenses) */

const pad4 = (n: number): string => String(n).padStart(4, "0");

/** The engine's restore/purge as the bin needs them (revenue and expense services both have them; the engine finds the book and kind by the id). */
interface CashBinService {
  restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<unknown>;
  purge(session: VerifiedSession, id: string): Promise<{ id: string }>;
}

interface CashSourceDeps {
  unit: Unit<CashRepos>;
  revenue: () => CashBinService;
  expenses: () => CashBinService;
}

type CashTable = "cashDeposits" | "cashWithdrawals" | "miscExpenses";

/**
 * Pallav's six cash kinds (RecycleBin::MODELS): hotel/food deposit, withdrawal and expense. The title is the entry number (RecycleBin::title falls back to
 * entryNumber(), four digits); the line under it names who and how much. Restore and removal go through the cash entry engine (its SuperAdmin rule, its
 * "recycle-bin" system-log line, its version check); the nightly clean-up purges by the repository, as the system.
 */
export function cashRecycleSources(deps: CashSourceDeps): RecycleSource[] {
  const kinds: { key: string; label: string; book: CashBook; table: CashTable; service: () => CashBinService; who: (r: EntryBase) => string }[] = [];
  for (const book of ["food", "hotel"] as const) {
    const Book = book === "food" ? "Food" : "Hotel";
    kinds.push(
      { key: `${book}-deposit`, label: `${Book} cash deposit`, book, table: "cashDeposits", service: deps.revenue, who: (r) => (r as CashDepositRecord).depositor },
      { key: `${book}-withdrawal`, label: `${Book} cash withdrawal`, book, table: "cashWithdrawals", service: deps.expenses, who: (r) => (r as CashWithdrawalRecord).withdrawer },
      { key: `${book}-expense`, label: `${Book} expense`, book, table: "miscExpenses", service: deps.expenses, who: (r) => (r as MiscExpenseRecord).expenseName },
    );
  }
  const repoOf = (repos: CashRepos, table: CashTable): EntryRepo<EntryBase, never, never, never> => repos[table] as unknown as EntryRepo<EntryBase, never, never, never>;
  return kinds.map((k): RecycleSource => {
    const deleted = (who: Pick<VerifiedSession, "hotelId" | "userId">): Promise<EntryBase[]> => deps.unit.run(who, (repos) => repoOf(repos, k.table).rows(k.book, { deleted: "only" }));
    return {
      key: k.key,
      label: k.label,
      list: async (who) => (await deleted(who)).map((r) => row(r, pad4(r.entryNo), [k.who(r), `${money(r.amountPaise)} on ${day(r.date)}`].filter(Boolean).join(" · "))),
      restore: async (session, id, meta) => {
        const r = (await deleted(session)).find((x) => x.id === id);
        await k.service().restore(session, id, r?.version ?? 0, meta);
      },
      purge: async (session, id) => void (await k.service().purge(session, id)),
      purgeBefore: (hotelId, cutoff) =>
        deps.unit.run({ hotelId, userId: "system" }, async (repos) => {
          let n = 0;
          for (const r of await repoOf(repos, k.table).rows(k.book, { deleted: "only" })) if (r.deletedAt && r.deletedAt < cutoff && (await repoOf(repos, k.table).purge(k.book, r.id))) n += 1;
          return n;
        }),
    };
  });
}

/* ---------------------------------------------------------------- Payroll (staff, staff advances, bonuses, separations, meal periods) */

interface PayrollSourceDeps {
  unit: Unit<PayrollCoreRepos & PayrollPayRepos>;
  employees: () => EmployeeService;
  adjustments: () => AdjustmentService;
  separations: () => SeparationService;
  meals: () => MealsService;
}

interface PayrollTrashed {
  companyId: string;
  row: TrashedRow;
}

/**
 * Payroll's five kinds. Every payroll record belongs to one payroll company, so each kind reads the bin of every company of the hotel and remembers which
 * company a row is in: restore and removal then go through the module's own service for THAT company (its SuperAdmin rule, its checks such as "the
 * employee ID is free again" or "the meals month is closed", its payroll-log line). The clean-up removes by the repository, as the system.
 */
export function payrollRecycleSources(deps: PayrollSourceDeps): RecycleSource[] {
  type Repos = PayrollCoreRepos & PayrollPayRepos;
  const everyCompany = async (repos: Repos): Promise<string[]> => (await repos.payrollCompanies.list({})).map((c) => c.id);
  const names = async (repos: Repos, companyId: string, ids: readonly string[]): Promise<Map<string, string>> =>
    new Map((await repos.employees.getMany(companyId, [...new Set(ids)])).map((e) => [e.id, `${e.name} (${e.employeeCode})`]));

  function source(key: string, label: string, read: (repos: Repos, companyId: string) => Promise<TrashedRow[]>, restore: (session: VerifiedSession, companyId: string, id: string, meta: RequestMeta) => Promise<unknown>, purge: (session: VerifiedSession, companyId: string, id: string, meta: RequestMeta) => Promise<unknown>, remove: (repos: Repos, companyId: string, id: string) => Promise<boolean>): RecycleSource {
    const all = (who: Pick<VerifiedSession, "hotelId" | "userId">): Promise<PayrollTrashed[]> =>
      deps.unit.run(who, async (repos) => {
        const out: PayrollTrashed[] = [];
        for (const companyId of await everyCompany(repos)) for (const r of await read(repos, companyId)) out.push({ companyId, row: r });
        return out;
      });
    const companyOf = async (who: Pick<VerifiedSession, "hotelId" | "userId">, id: string): Promise<string> => {
      const hit = (await all(who)).find((t) => t.row.id === id);
      if (!hit) throw new AppError("NOT_FOUND", "That record is not in the recycle bin.");
      return hit.companyId;
    };
    return {
      key,
      label,
      list: async (who) => (await all(who)).map((t) => t.row),
      restore: async (session, id, meta) => void (await restore(session, await companyOf(session, id), id, meta)),
      purge: async (session, id, meta) => void (await purge(session, await companyOf(session, id), id, meta)),
      purgeBefore: async (hotelId, cutoff) => {
        const who = { hotelId, userId: "system" };
        const old = (await all(who)).filter((t) => t.row.deletedAt < cutoff);
        let n = 0;
        // one transaction each (as the company source): on PostgreSQL a refused DELETE aborts its transaction, so a row still named elsewhere stays without
        // undoing the rows removed before it or breaking the ones after it
        for (const t of old) if (await deps.unit.run(who, (repos) => remove(repos, t.companyId, t.row.id)).catch(() => false)) n += 1;
        return n;
      },
    };
  }

  const EVERY = EVERYTHING;
  const when = (d: Date): string => day(d.toISOString());
  return [
    source(
      "employee",
      "Staff",
      async (repos, companyId) => (await repos.employees.list(companyId, { deleted: "only", sort: "name", ...EVERY })).rows.map((e) => row(e, e.name, [e.employeeCode, e.designation].filter(Boolean).join(" · "))),
      (s, c, id, m) => deps.employees().restore(s, c, id, m),
      (s, c, id, m) => deps.employees().purge(s, c, id, m),
      // never while attendance, salary, a separation or a meal period still names the person (the service's own refusal; the database refuses too)
      async (repos, companyId, id) => !(await repos.employees.blockingDependency(id, { purge: true })) && repos.employees.purge(companyId, id),
    ),
    source(
      "payroll-advance",
      "Staff advance",
      async (repos, companyId) => {
        const rows = (await repos.payrollAdvances.list(companyId, { viewFrom: null, deleted: "only", ...EVERY })).rows;
        return rows.map((a) => row(a, pad4(a.entryNo), [a.employeeName, `${money(a.amountPaise)} on ${when(a.advanceDate)}`].filter(Boolean).join(" · ")));
      },
      (s, c, id, m) => deps.adjustments().restoreAdvance(s, c, id, m),
      (s, c, id, m) => deps.adjustments().purgeAdvance(s, c, id, m),
      (repos, companyId, id) => repos.payrollAdvances.purge(companyId, id),
    ),
    source(
      "bonus",
      "Bonus / incentive",
      async (repos, companyId) => {
        const rows = (await repos.bonuses.list(companyId, { viewFrom: null, deleted: "only", ...EVERY })).rows;
        return rows.map((b) => row(b, pad4(b.entryNo), [b.employeeName, b.type, `${money(b.amountPaise)} on ${when(b.entryDate)}`].filter(Boolean).join(" · ")));
      },
      (s, c, id, m) => deps.adjustments().restoreBonus(s, c, id, m),
      (s, c, id, m) => deps.adjustments().purgeBonus(s, c, id, m),
      (repos, companyId, id) => repos.bonuses.purge(companyId, id),
    ),
    source(
      "separation",
      "Separation",
      async (repos, companyId) => {
        const rows = (await repos.separations.list(companyId, { deleted: "only", ...EVERY })).rows;
        return rows.map((s) => ({ id: s.id, title: pad4(s.entryNo), detail: [s.employeeName, s.separationType, `last day ${day(s.lastWorkingDate)}`].filter(Boolean).join(" · "), deletedAt: s.deletedAt as Date, deletedBy: null }));
      },
      (s, c, id, m) => deps.separations().restore(s, c, id, m),
      (s, c, id, m) => deps.separations().purge(s, c, id, m),
      (repos, companyId, id) => repos.separations.purge(companyId, id),
    ),
    source(
      "meal-period",
      "Meal period",
      async (repos, companyId) => {
        const periods = await repos.meals.deletedPeriods(companyId);
        const who = await names(repos, companyId, periods.map((p) => p.employeeId));
        // Pallav's title falls back to "#id" for a record with no name or number; HMS shows the person, so two records can be told apart
        return periods.map((p) => ({ id: p.id, title: who.get(p.employeeId) ?? "Meals record", detail: `Meals from ${day(p.startsOn)}${p.endsOn ? ` to ${day(p.endsOn)}` : ""}`, deletedAt: p.deletedAt as Date, deletedBy: null }));
      },
      (s, c, id, m) => deps.meals().restoreMealPeriod(s, c, id, m),
      (s, c, id, m) => deps.meals().purgeMealPeriod(s, c, id, m),
      (repos, companyId, id) => repos.meals.purgePeriod(companyId, id),
    ),
  ];
}

/** Company profiles (Pallav "company"). */
export function companyRecycleSources(deps: CompanySourceDeps): RecycleSource[] {
  return [
    {
      key: "company",
      label: "Company",
      list: (who) => deps.unit.run(who, async (repos) => (await repos.companyProfiles.list({ deleted: "only", ...EVERYTHING })).rows.map((c) => row(c, c.name, c.gstNumber ? `GSTIN ${c.gstNumber}` : ""))),
      restore: async (session, id, meta) => void (await deps.companies().restore(session, id, meta)),
      purge: async (session, id) => void (await deps.companies().purge(session, id)),
      purgeBefore: async (hotelId, cutoff) => {
        const who = { hotelId, userId: "system" };
        const old = (await deps.unit.run(who, (repos) => repos.companyProfiles.list({ deleted: "only", ...EVERYTHING }))).rows.filter((c) => c.deletedAt && c.deletedAt < cutoff);
        let n = 0;
        // one transaction each: a company still named on a bill or an advance is refused by the database and stays (as when removed by hand), without undoing the rest
        for (const c of old) if (await deps.unit.run(who, (repos) => repos.companyProfiles.purge(c.id)).catch(() => false)) n += 1;
        return n;
      },
    },
  ];
}
