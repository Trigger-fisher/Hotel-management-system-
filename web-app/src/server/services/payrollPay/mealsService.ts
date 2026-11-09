import "server-only";
import type { MealBillRow, MealPeriod, MealPrice, MealStaffRow, MealsOverview } from "@shared/dashboards/payrollPay";
import { canUseRecycleBin } from "../../auth/access";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import { phpRound, rupeesToPaise } from "../../money/phpFloat";
import type { PayrollCompanyRecord } from "../../repos/payrollCore";
import type { MealPeriodRecord } from "../../repos/payrollPay";
import { istMoment } from "../cash/ist";
import { isDate } from "../billing/advanceValidate";
import { companyOrFail, conflict, notFound, payrollKit, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "../payrollCore/context";
import { fieldError } from "../payrollCore/validate";
import { longDate, monthOf, monthYear, nextMonth, periodLabel } from "./dates";
import { payEmployee } from "./dto";
import { mealRow, rateOn, type PriceRow } from "./mealsMath";
import type { MealPeriodBody, MealPriceBody, MealStopBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";

// Staff meals (Pallav Support/FoodCharges.php, FoodPriceController, FoodChargeController): Pallav Food (PF01) keeps the monthly price per
// employee; Hotel Pallav (HP01) and Pallav Food keep who takes meals; each person's days at the price in force that day make the bill the
// monthly report carries. The arithmetic is mealsMath.ts (golden against real PHP). Spec: docs/specs/payroll-pay.md §11.

const PAYER = "HP01";
const PROVIDER = "PF01";
const PRICE_PART = "payroll.food-price";
const CHARGE_PART = "payroll.food-charge";
const n = paiseToNumber;

export interface MealsOverviewOut extends MealsOverview {
  /** The month the PRICE is closed through (any company's salary run closes it) and the first month a new price can start in. */
  priceClosedThrough: string | null;
  firstOpenPriceMonth: string;
}

export const servesMeals = (c: Pick<PayrollCompanyRecord, "code">): boolean => c.code === PAYER || c.code === PROVIDER;

interface MealStatement {
  rows: (MealBillRow & { left: number; note: string | null })[];
  totalPaise: bigint;
}

/** FoodCharges::statement (:195-262) as rows: null when the company does not serve meals, no price is set, or nobody is charged. */
export async function mealStatement(repos: PayrollUnitRepos, company: PayrollCompanyRecord, year: number, month: number, opts: { live: boolean; today: string }): Promise<MealStatement | null> {
  const monthRows = await repos.salaryProcessings.month(company.id, year, month, "name");
  const isGenerated = monthRows.length > 0;
  if (!servesMeals(company) || (!opts.live && !isGenerated)) return null;
  const provider = (await repos.payrollCompanies.list({})).find((c) => c.code === PROVIDER);
  const rates = provider ? await priceRows(repos, provider.id) : [];
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const asOf = opts.live && monthOf(opts.today) === monthOf(first) ? opts.today : null;
  if (rates.length === 0 || rateOn(last, rates) === null) return null;

  // chargedStaff (:100-112): everyone whose meals records cover part of the month, by name; the record decides, not the payroll
  const periods = await repos.meals.periodsIn(company.id, first, last);
  const ids = [...new Set(periods.map((p) => p.employeeId))];
  const staff = (await repos.employees.getMany(company.id, ids)).sort((a, b) => a.name.localeCompare(b.name));
  const everyPeriod = await repos.meals.periodsOf(staff.map((e) => e.id));
  const lastDays = await repos.separations.lastDays(staff.map((e) => e.id));
  const skipped = await repos.meals.skippedDays(company.id, year, month);
  const rows = staff
    .map((e) => {
      const mine = everyPeriod.filter((p) => p.employeeId === e.id).map((p) => ({ startsOn: p.startsOn, endsOn: p.endsOn }));
      const r = mealRow({ year, month, joined: e.joiningDate, left: lastDays.get(e.id) ?? null, skipped: skipped.get(e.id) ?? [], periods: mine, until: asOf, rates });
      return { employeeId: e.id, employeeName: e.name, designation: e.designation, days: r.days, amountPaise: rupeesToPaise(r.amount), left: r.leftOut, note: r.note, rupees: r.amount };
    })
    .filter((r) => r.days > 0);
  if (rows.length === 0) return null;
  const total = phpRound(rows.reduce((t, r) => t + r.rupees, 0), 2);
  return { rows: rows.map((r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, designation: r.designation, days: r.days, amountPaise: n(r.amountPaise), left: r.left, note: r.note })), totalPaise: rupeesToPaise(total) };
}

async function priceRows(repos: PayrollUnitRepos, providerId: string): Promise<PriceRow[]> {
  return (await repos.meals.prices(providerId)).map((p) => ({ effectiveFrom: p.effectiveFrom, amount: Number(p.monthlyAmountPaise) / 100 }));
}

export function createMealsService(deps: PayrollDeps) {
  const { unit, catalog, people, now } = deps;
  const kit = payrollKit(deps);
  const today = (): string => istMoment(now()).date;

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => {
      const company = await companyOrFail(repos, companyId);
      if (!servesMeals(company)) throw notFound();
      return work({ repos, session, meta, actor, company });
    });
  }
  const provider = async (repos: PayrollUnitRepos): Promise<PayrollCompanyRecord | null> => (await repos.payrollCompanies.list({})).find((c) => c.code === PROVIDER) ?? null;
  /** The provider alone sets the price (FoodPriceController::company :16-22). */
  async function priceOwner(w: PayrollWrite): Promise<PayrollCompanyRecord> {
    if (w.company.code !== PROVIDER) throw notFound();
    return w.company;
  }

  /** FoodCharges::lockedThrough: the latest month ANY company generated salary for ("YYYY-MM"). */
  const priceLock = async (repos: PayrollUnitRepos): Promise<string | null> => {
    const l = await repos.meals.lockedThrough();
    return l ? `${l.year}-${String(l.month).padStart(2, "0")}` : null;
  };
  /** FoodCharges::lockedThroughFor: this company's own latest generated month. */
  const ownLock = async (repos: PayrollUnitRepos, companyId: string): Promise<string | null> => {
    const l = await repos.salaryProcessings.latestPeriod(companyId);
    return l ? `${l.year}-${String(l.month).padStart(2, "0")}` : null;
  };
  const closedBy = (lock: string | null, day: string): boolean => lock !== null && monthOf(day) <= lock;
  const priceClosed = (day: string): string => `Salary has already been generated for ${monthYear(day)}, so its meal price is closed.`;

  /** FoodChargeController::closed (:158-162) */
  const mealsClosed = (lock: string | null, day: string): string =>
    `Salary has already been generated for ${monthYear(day)}, so its meals bill is closed. Changes can start from ${monthYear(`${lock ? nextMonth(lock) : "2000-01"}-01`)} onwards.`;

  const periodDto = async (rows: readonly MealPeriodRecord[]): Promise<MealPeriod[]> => {
    const names = await people.get([...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))]);
    return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, startsOn: r.startsOn, endsOn: r.endsOn, createdBy: r.createdBy ? (names.get(r.createdBy)?.name ?? "Removed user") : "System" }));
  };

  async function periodOut(p: MealPeriodRecord): Promise<MealPeriod> {
    return (await periodDto([p]))[0];
  }

  /** Books::guard on a meals record: dated by its start; a closed year's record may still be ended, the end dated this year. */
  async function guardPeriod(w: PayrollWrite, input: { was: string | null; now: string | null; action: "save" | "delete"; endChange?: { was: string | null; now: string | null } }): Promise<void> {
    await kit.guard(w, { was: input.was, now: input.now, action: input.action, ...(input.endChange ? { pending: { onlyPendingChanged: true, actionDates: [input.endChange] } } : {}) }, "startsOn");
  }

  return {
    /** index (:20-70): this month unless another was asked for, never one that has not begun; the live bill, the price history, who is on meals. */
    async overview(session: VerifiedSession, companyId: string, period?: string, search?: string): Promise<MealsOverviewOut> {
      if (!can(session, catalog, CHARGE_PART, "view") && !can(session, catalog, PRICE_PART, "view")) requirePermission(session, catalog, CHARGE_PART, "view");
      const t = today();
      const thisMonth = monthOf(t);
      const p = !period || period > thisMonth ? thisMonth : period;
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        if (!servesMeals(company)) throw notFound();
        const owner = await provider(repos);
        const prices = owner ? await repos.meals.prices(owner.id) : [];
        const globalLock = await priceLock(repos);
        const ownClosed = await ownLock(repos, companyId);
        const current = prices.filter((x) => x.effectiveFrom <= t).pop() ?? null;
        const priceList: MealPrice[] = prices
          .map((x, i) => ({ id: x.id, effectiveFrom: x.effectiveFrom, monthlyPaise: n(x.monthlyAmountPaise), previousPaise: i > 0 ? n(prices[i - 1].monthlyAmountPaise) : null, inForce: current !== null && x.id === current.id, locked: closedBy(globalLock, x.effectiveFrom) }))
          .reverse();

        const employees = await repos.employees.list(companyId, { deleted: "no", sort: "active", page: 1, pageSize: 20_000 });
        const periods = await repos.meals.periodsOf(employees.rows.map((e) => e.id));
        const staff: MealStaffRow[] = [];
        for (const e of employees.rows) {
          const mine = periods.filter((x) => x.employeeId === e.id).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
          staff.push({ employee: payEmployee(e), periods: await periodDto(mine), onMealsToday: mine.some((x) => x.startsOn <= t && (x.endsOn === null || x.endsOn >= t)) });
        }
        const year = Number(p.slice(0, 4));
        const month = Number(p.slice(5, 7));
        const bill = await mealStatement(repos, company, year, month, { live: true, today: t });
        const generated = (await repos.salaryProcessings.month(companyId, year, month, "name")).length > 0;
        return {
          period: p,
          today: t,
          canSetPrice: company.code === PROVIDER,
          currentPricePaise: current ? n(current.monthlyAmountPaise) : null,
          closedThrough: ownClosed,
          firstOpenMonth: ownClosed ? nextMonth(ownClosed) : "2000-01",
          priceClosedThrough: globalLock,
          firstOpenPriceMonth: globalLock ? nextMonth(globalLock) : "2000-01",
          prices: matchWords(priceList, search, (x) => [x.effectiveFrom, x.monthlyPaise / 100]),
          staff: matchWords(staff, search, (x) => [x.employee.name, x.employee.code, x.employee.designation]),
          bill: matchWords((bill?.rows ?? []).map((r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, designation: r.designation, days: r.days, amountPaise: r.amountPaise })), search, (r) => [r.employeeName, r.designation]),
          billTotalPaise: bill ? n(bill.totalPaise) : 0,
          billFinal: generated,
        };
      });
    },

    /** store (FoodPriceController :56-88): today or earlier, in an open month; a second price for the same day replaces the first. */
    async addPrice(session: VerifiedSession, companyId: string, input: MealPriceBody, meta: RequestMeta): Promise<{ effectiveFrom: string; message: string }> {
      requirePermission(session, catalog, PRICE_PART, "edit");
      return write(session, companyId, meta, async (w) => {
        const owner = await priceOwner(w);
        const f: Record<string, string> = {};
        if (input.monthlyPaise === null) f.monthlyPaise = "The monthly amount field is required.";
        else if (input.monthlyPaise < 0) f.monthlyPaise = "The monthly amount field must be at least 0.";
        else if (input.monthlyPaise > 100_000_000) f.monthlyPaise = "The monthly amount field must not be greater than 1000000.";
        const from = input.effectiveFrom.trim();
        if (from === "") f.effectiveFrom = "The effective from field is required.";
        else if (!isDate(from)) f.effectiveFrom = "The effective from field must be a valid date.";
        else if (from > today()) f.effectiveFrom = "A price cannot start after today. Choose today or an earlier day in an open month.";
        if (Object.keys(f).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f });
        const lock = await priceLock(w.repos);
        if (closedBy(lock, from)) {
          throw fieldError("effectiveFrom", `${priceClosed(from)} A new price can start from ${monthYear(`${lock ? nextMonth(lock) : "2000-01"}-01`)} onwards.`);
        }
        const amount = BigInt(input.monthlyPaise!);
        const same = await w.repos.meals.priceOn(owner.id, from);
        // a second price for the same day is a correction made the same day, not a change worth keeping twice
        if (same) await w.repos.meals.setPrice(same.id, amount, session.userId);
        else await w.repos.meals.createPrice(owner.id, { monthlyAmountPaise: amount, effectiveFrom: from }, session.userId);
        const rupees = (Number(amount) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        const message = `The price is now Rs ${rupees} per employee from ${longDate(from)}. The earlier price stays on record.`;
        await kit.log(w, { action: same ? "updated" : "created", entity: "Meal Price", summary: `Meal price Rs ${rupees} per employee from ${longDate(from)}`, subject: null, details: { Amount: rupees, From: from } });
        return { effectiveFrom: from, message };
      });
    },

    /** destroy (:90-100): a price in an open month; the days it covered fall back to the one before. */
    async deletePrice(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PRICE_PART, "full");
      return write(session, companyId, meta, async (w) => {
        const owner = await priceOwner(w);
        const price = await w.repos.meals.getPrice(owner.id, id);
        if (!price) throw notFound();
        const lock = await priceLock(w.repos);
        if (await kit.locked(closedBy(lock, price.effectiveFrom), "Salary has already been generated, so its meal price is closed", w)) {
          throw conflict(`${priceClosed(price.effectiveFrom)} A new price can start from ${monthYear(`${lock ? nextMonth(lock) : "2000-01"}-01`)} onwards.`);
        }
        await w.repos.meals.removePrice(id);
        await kit.log(w, { action: "deleted", entity: "Meal Price", summary: `Meal price removed (from ${longDate(price.effectiveFrom)})`, subject: null, details: { Amount: (Number(price.monthlyAmountPaise) / 100).toFixed(2) } });
        return { id, message: "That price was removed. Days it covered fall back to the price before it." };
      });
    },

    /** start (FoodChargeController :72-110) */
    async startMeals(session: VerifiedSession, companyId: string, employeeId: string, input: MealPeriodBody, meta: RequestMeta): Promise<MealPeriod> {
      requirePermission(session, catalog, CHARGE_PART, "create");
      return write(session, companyId, meta, async (w) => {
        const e = await w.repos.employees.get(companyId, employeeId);
        if (!e) throw notFound();
        const f: Record<string, string> = {};
        const starts = input.startsOn.trim();
        const endsText = input.endsOn.trim();
        const ends = endsText === "" ? null : endsText;
        const valid = isDate;
        if (starts === "") f.startsOn = "The starts on field is required.";
        else if (!valid(starts)) f.startsOn = "The starts on field must be a valid date.";
        else if (starts > today()) f.startsOn = "Meals cannot start after today.";
        else if (starts < e.joiningDate) f.startsOn = `${e.name} joined on ${longDate(e.joiningDate)}, so meals cannot start before that.`;
        if (ends !== null) {
          if (!valid(ends)) f.endsOn = "The ends on field must be a valid date.";
          else if (valid(starts) && ends < starts) f.endsOn = "The end date cannot be before the start date.";
          else if (ends > today()) f.endsOn = "The end date cannot be after today.";
        }
        if (Object.keys(f).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f });
        const lock = await ownLock(w.repos, companyId);
        if (closedBy(lock, starts)) throw fieldError("startsOn", mealsClosed(lock, starts));
        const clash = await w.repos.meals.overlapping(employeeId, starts, ends);
        if (clash) throw fieldError("startsOn", `${e.name} already has meals recorded for ${periodLabel(clash)}. Stop that first, or start after it.`);
        await guardPeriod(w, { was: null, now: starts, action: "save" });
        const p = await w.repos.meals.createPeriod(companyId, { employeeId, startsOn: starts, endsOn: ends }, session.userId);
        await kit.log(w, { action: "created", entity: "Meals Record", summary: `${e.name} takes meals from ${longDate(starts)}${ends ? ` to ${longDate(ends)}` : ""}`, subject: { id: p.id, label: `${e.name} (${e.employeeCode})` }, details: { From: starts, To: ends } });
        return periodOut(p);
      });
    },

    /** stop (:112-139): sets the day a record ends; the days that change are between the old end and the new one. */
    async stopMeals(session: VerifiedSession, companyId: string, periodId: string, input: MealStopBody, meta: RequestMeta): Promise<MealPeriod> {
      requirePermission(session, catalog, CHARGE_PART, "edit");
      return write(session, companyId, meta, async (w) => {
        const p = await w.repos.meals.getPeriod(companyId, periodId, { forUpdate: true });
        if (!p) throw notFound();
        const e = await w.repos.employees.get(companyId, p.employeeId);
        const ends = input.endsOn.trim();
        const valid = isDate(ends);
        if (ends === "") throw fieldError("endsOn", "The ends on field is required.");
        if (!valid) throw fieldError("endsOn", "The ends on field must be a valid date.");
        if (ends < p.startsOn) throw fieldError("endsOn", `The end date cannot be before the start date (${longDate(p.startsOn)}).`);
        if (ends > today()) throw fieldError("endsOn", "The end date cannot be after today.");
        // the earliest day that changes is the day after whichever end comes first
        const earlier = p.endsOn === null || ends < p.endsOn ? ends : p.endsOn;
        const firstChanged = new Date(Date.parse(`${earlier}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        const lock = await ownLock(w.repos, companyId);
        if (closedBy(lock, firstChanged)) throw fieldError("endsOn", mealsClosed(lock, firstChanged));
        const clash = await w.repos.meals.overlapping(p.employeeId, p.startsOn, ends, p.id);
        if (clash) throw fieldError("endsOn", `That would run into another record (${periodLabel(clash)}).`);
        await guardPeriod(w, { was: p.startsOn, now: p.startsOn, action: "save", endChange: { was: p.endsOn, now: ends } });
        const saved = await w.repos.meals.setEnd(p.id, ends, session.userId);
        await kit.log(w, { action: "updated", entity: "Meals Record", summary: `${e?.name ?? ""} takes meals ${periodLabel(saved)}`, subject: { id: p.id, label: e ? `${e.name} (${e.employeeCode})` : p.id }, details: { From: saved.startsOn, To: saved.endsOn } });
        return periodOut(saved);
      });
    },

    /** destroy (:141-155): removing a record takes away every day it covered, from its first day. */
    async deleteMealPeriod(session: VerifiedSession, companyId: string, periodId: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, CHARGE_PART, "full");
      return write(session, companyId, meta, async (w) => {
        const p = await w.repos.meals.getPeriod(companyId, periodId, { forUpdate: true });
        if (!p) throw notFound();
        const lock = await ownLock(w.repos, companyId);
        if (await kit.locked(closedBy(lock, p.startsOn), "Salary has already been generated, so its meals bill is closed", w)) {
          throw conflict(`${mealsClosed(lock, p.startsOn)} To stop meals from a later day instead, end the record rather than removing it.`);
        }
        const e = await w.repos.employees.get(companyId, p.employeeId);
        await guardPeriod(w, { was: p.startsOn, now: null, action: "delete" });
        await w.repos.meals.softDeletePeriod(companyId, periodId, session.userId);
        await kit.log(w, { action: "deleted", entity: "Meals Record", summary: `The meals record for ${e?.name ?? ""} was removed`, subject: { id: p.id, label: e ? `${e.name} (${e.employeeCode})` : p.id }, details: { From: p.startsOn, To: p.endsOn } });
        return { id: periodId, message: `The meals record for ${e?.name ?? ""} was removed.` };
      });
    },

    /** Recycle bin (Pallav RecycleBin 'meal-period'): the SuperAdmin brings a removed record back; the same closed-month and overlap rules as adding it again. */
    async restoreMealPeriod(session: VerifiedSession, companyId: string, periodId: string, meta: RequestMeta): Promise<MealPeriod> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN", "Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const p = (await w.repos.meals.deletedPeriods(companyId)).find((x) => x.id === periodId);
        if (!p) throw notFound();
        const lock = await ownLock(w.repos, companyId);
        if (closedBy(lock, p.startsOn)) throw conflict(mealsClosed(lock, p.startsOn));
        const clash = await w.repos.meals.overlapping(p.employeeId, p.startsOn, p.endsOn);
        if (clash) throw conflict(`That would run into another record (${periodLabel(clash)}).`);
        await guardPeriod(w, { was: null, now: p.startsOn, action: "save" });
        if (!(await w.repos.meals.restorePeriod(companyId, periodId))) throw notFound();
        const e = await w.repos.employees.get(companyId, p.employeeId);
        await kit.log(w, { action: "updated", entity: "Meals Record", summary: `The meals record for ${e?.name ?? ""} was restored`, subject: { id: p.id, label: e ? `${e.name} (${e.employeeCode})` : p.id }, details: { From: p.startsOn, To: p.endsOn, "Restored by": w.actor?.name ?? "System" } });
        return periodOut({ ...p, deletedAt: null });
      });
    },

    /** Recycle bin: a removed record goes for good (it charges nothing while in the bin). */
    async purgeMealPeriod(session: VerifiedSession, companyId: string, periodId: string, meta: RequestMeta): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN", "Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const p = (await w.repos.meals.deletedPeriods(companyId)).find((x) => x.id === periodId);
        if (!p || !(await w.repos.meals.purgePeriod(companyId, periodId))) throw notFound();
        const e = (await w.repos.employees.get(companyId, p.employeeId)) ?? (await w.repos.employees.get(companyId, p.employeeId, { deleted: true }));
        // the payroll-log line in the same unit (a failing log write takes the removal back), as purgeAdvance
        await kit.log(w, { action: "deleted", entity: "Meals Record", summary: `The meals record for ${e?.name ?? ""} was removed for good`, subject: { id: p.id, label: e ? `${e.name} (${e.employeeCode})` : p.id }, details: { From: p.startsOn, To: p.endsOn } });
        return { id: periodId };
      });
    },

    /** FoodCharges::statement for the monthly report (final: only once the month's salary is generated). */
    async finalBill(repos: PayrollUnitRepos, company: PayrollCompanyRecord, year: number, month: number): Promise<number | null> {
      const s = await mealStatement(repos, company, year, month, { live: false, today: today() });
      return s ? n(s.totalPaise) : null;
    },
  };
}

export type MealsService = ReturnType<typeof createMealsService>;
