import "server-only";
import type { Catalog } from "../../auth/catalog";
import { assembleGst, assembleOccupancy, type GstBillLine, type GstReport, type OccupancyDay, type OccupancyReport } from "@shared/dashboards/overview";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { paiseToNumber, type Paise } from "../../money/paise";
import type { ReportsRepos, ReportsUnit, SheetKind, SheetLine } from "../../repos/reports";
import { buildFoodPlan, shiftMonths, type FoodPlanResult, type FoodPlanRowDto } from "./foodPlanMath";
import { dailyReportDoc, foodPlanDoc, type DocHeader } from "./reportDocuments";
import type { PayrollDoc } from "@shared/dashboards/payrollPay";

// The accounts reports Pallav offers (ReportController): the Daily Report (DailySheet) and the Food Plan Report (FoodPlanMonth). Reading needs the `reports`
// screen at view. The money rules (which column a line sits in, the opening balance, the nights' prices) live HERE; the repository only reads rows.
// Spec: docs/specs/overview.md.

const REPORTS = "reports";
const BEGINNING = "2000-01-01";

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const num = (p: Paise): number => paiseToNumber(p);
const natural = (a: string | null, b: string | null): number => (a ?? "").localeCompare(b ?? "", "en", { numeric: true });

export interface DayLineDto {
  id: string;
  kind: SheetKind;
  room: string | null;
  ref: string | null;
  particulars: string;
  note: string | null;
  /** As stored; "Not set" when the line has none. */
  mode: string;
  party: string | null;
  amountPaise: number;
  /** A bill paid in full from an advance moved no money today. */
  fromAdvancePaise: number;
}

interface FoodPlanTonightDto {
  id: string;
  room: string;
  bill: string;
  guest: string;
  company: string | null;
  plan: string;
  persons: number;
  ratePaise: number;
  amountPaise: number;
}

interface DailyTotalsDto {
  openingPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  cashOnHandPaise: number;
  foodPlanPaise: number;
  carryForwardPaise: number;
  bankedInPaise: number;
  bankedOutPaise: number;
  debitPaise: number;
  complimentaryPaise: number;
  /** Cash in + online + on credit. */
  revenuePaise: number;
  /** Cash out + online out + the food plan. */
  paidOutPaise: number;
  netPaise: number;
  entries: number;
  /** Cash out + the food plan: what left the drawer. */
  cashPaidTotalPaise: number;
}

export interface DailyReportDto {
  date: string;
  cashIn: DayLineDto[];
  cashOut: DayLineDto[];
  banked: DayLineDto[];
  debit: DayLineDto[];
  complimentary: DayLineDto[];
  foodPlan: FoodPlanTonightDto[];
  totals: DailyTotalsDto;
}

export interface FoodPlanMonthDto {
  month: string;
  plan: string | null;
  plans: string[];
  rows: Omit<FoodPlanRowDto, "firstNight" | "lastNight">[];
  byPlan: FoodPlanResult["byPlan"];
  totals: FoodPlanResult["totals"];
}

export type Bucket = "cash" | "banked" | "debit" | "free";

/** DailySheet::bucket: which of the sheet's columns a settlement belongs in. A line that came to nothing is still shown, with the cash. */
function bucketOf(mode: string | null, amountPaise: Paise): Bucket {
  const m = (mode ?? "").trim().toLowerCase();
  if (m === "complimentary") return "free";
  if (m === "debit") return "debit";
  if (m === "cash") return "cash";
  if (m === "") return amountPaise > BigInt(0) ? "banked" : "cash";
  return "banked";
}

const toDto = (l: SheetLine): DayLineDto => ({ id: l.id, kind: l.kind, room: l.room, ref: l.ref, particulars: l.particulars, note: l.note, mode: l.mode && l.mode.trim() !== "" ? l.mode : "Not set", party: l.party, amountPaise: num(l.amountPaise), fromAdvancePaise: num(l.fromAdvancePaise) });
const ordered = (lines: readonly SheetLine[]): DayLineDto[] => [...lines].sort((a, b) => natural(a.room, b.room) || natural(a.ref, b.ref)).map(toDto);
const sum = (lines: readonly SheetLine[]): bigint => lines.reduce((a, l) => a + l.amountPaise, BigInt(0));

interface ReportDeps {
  unit: ReportsUnit;
  catalog: Catalog;
  now: () => Date;
  /** The hotel's header for a printed document (name, address, phone). */
  header?: (session: VerifiedSession) => Promise<DocHeader>;
}

/**
 * The plan names (lower-case, as `rateOn` compares them) that have a price above nothing. A bill without stay parts whose own plan is not one of these
 * is worth no meals on any night, so the repository need not return it. Undefined (no filtering) when a name is not plain ASCII, where the database's
 * lower-casing could differ from this one.
 */
function mealPlansOf(rates: readonly { plan: string; ratePaise: Paise }[]): string[] | undefined {
  const names = [...new Set(rates.filter((r) => r.ratePaise > BigInt(0)).map((r) => r.plan.toLowerCase()))];
  return names.every((n) => /^[\x20-\x7e]*$/.test(n)) ? names : undefined;
}

const validDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** A food-plan row as the screen gets it: the first and last night are only used to build the period, not shown. */
function withoutNights<T extends { firstNight: unknown; lastNight: unknown }>(row: T): Omit<T, "firstNight" | "lastNight"> {
  const out: Partial<T> = { ...row };
  delete out.firstNight;
  delete out.lastNight;
  return out as Omit<T, "firstNight" | "lastNight">;
}

export function createReportService(deps: ReportDeps) {
  const { unit, catalog, now } = deps;
  const headerOf = async (session: VerifiedSession): Promise<DocHeader> => (await deps.header?.(session)) ?? { name: "", address: null, phone: null };

  /** FoodPlanMonth::totalBetween / forDay: the plan meals of the nights from `from` to `until`, in the bills the repository finds around them. */
  async function plan(repos: ReportsRepos, start: string, end: string, filter: string | null = null): Promise<FoodPlanResult> {
    const rates = await repos.mealPlanRates.table();
    const bills = await repos.foodPlan.stayBills({ billDateFrom: shiftMonths(start, -2), billDateTo: shiftMonths(end, 2), mealPlans: mealPlansOf(rates) });
    return buildFoodPlan(bills, rates, start, end, filter);
  }

  /** The drawer's opening on a day: every cash line before it, less every night's plan meals before it, from the beginning (DailySheet::openingBalance). */
  async function opening(repos: ReportsRepos, day: string): Promise<bigint> {
    const net = await repos.daySheet.cashNetBefore(day);
    const before = addDays(day, -1);
    const meals = before < BEGINNING ? 0 : (await plan(repos, BEGINNING, before)).totals.amountPaise;
    return net - BigInt(meals);
  }

  /**
   * The opening AND the night's plan meals of one day from a single read of the rates and the stay bills (the day sheet needs both). Each part is
   * fed exactly the bills its own window would have found (bill date within the nights' window ± 2 months), so the figures equal those of
   * `opening` and `plan` called one after the other, with one query and one rates read less.
   */
  async function openingAndTonight(repos: ReportsRepos, day: string): Promise<{ open: bigint; tonight: FoodPlanResult }> {
    const before = addDays(day, -1);
    const net = await repos.daySheet.cashNetBefore(day);
    const rates = await repos.mealPlanRates.table();
    const bills = await repos.foodPlan.stayBills({ billDateFrom: shiftMonths(BEGINNING, -2), billDateTo: shiftMonths(day, 2), mealPlans: mealPlansOf(rates) });
    const around = (from: string, to: string) => bills.filter((b) => b.billDate >= shiftMonths(from, -2) && b.billDate <= shiftMonths(to, 2));
    const meals = before < BEGINNING ? 0 : buildFoodPlan(around(BEGINNING, before), rates, BEGINNING, before, null).totals.amountPaise;
    return { open: net - BigInt(meals), tonight: buildFoodPlan(around(day, day), rates, day, day, null) };
  }

  return {
    /**
     * Occupancy for one month (default: this month, up to today): rooms sold and room revenue per night from the stays, occupancy %, ADR and RevPAR
     * (ui-shared assembleOccupancy, so the mock and the server agree). A month in the future is empty. Needs the Reports screen.
     */
    async occupancy(session: VerifiedSession, month?: string): Promise<OccupancyReport> {
      requirePermission(session, catalog, REPORTS, "view");
      const today = istDay(now());
      const m = month ?? today.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new AppError("VALIDATION_FAILED", "Pick a month like 2026-10.", { fields: { month: "Pick a month like 2026-10." } });
      const first = `${m}-01`;
      const lastOfMonth = `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
      const to = m === today.slice(0, 7) ? today : lastOfMonth;
      if (first > today) return assembleOccupancy(m, 0, []);
      const { rooms, nights } = await unit.run(session, async (repos) => ({ rooms: await repos.occupancy.roomCount(), nights: await repos.occupancy.nights(first, to) }));
      const days: OccupancyDay[] = nights.map((n) => ({ date: n.date, roomsSold: n.roomsSold, roomRevenuePaise: paiseToNumber(n.roomRevenuePaise), arrivals: n.arrivals, departures: n.departures, occupancyPct: rooms ? Math.round((n.roomsSold / rooms) * 1000) / 10 : 0 }));
      return assembleOccupancy(m, rooms, days);
    },

    /** The same month as a CSV file (Excel opens it): one line per night and a totals line. */
    async occupancyCsv(session: VerifiedSession, month?: string): Promise<{ bytes: Uint8Array; filename: string }> {
      const r = await this.occupancy(session, month);
      const cell = (v: string | number): string => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
      const rupees = (paise: number): string => (paise / 100).toFixed(2);
      const lines = [["Night", "Rooms sold", "Rooms in service", "Occupancy %", "Room revenue (Rs)", "ADR (Rs)", "Arrivals", "Departures"].map(cell).join(",")];
      for (const d of r.days) lines.push([d.date, d.roomsSold, r.rooms, d.occupancyPct, rupees(d.roomRevenuePaise), d.roomsSold ? rupees(Math.round(d.roomRevenuePaise / d.roomsSold)) : "0.00", d.arrivals, d.departures].map(cell).join(","));
      const t = r.totals;
      lines.push(["Total", t.roomsSold, r.rooms, t.occupancyPct, rupees(t.roomRevenuePaise), rupees(t.adrPaise), t.arrivals, t.departures].map(cell).join(","));
      lines.push(["RevPAR (Rs)", rupees(t.revParPaise)].map(cell).join(","));
      // a BOM so Excel reads the rupee figures and names as UTF-8
      return { bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`), filename: `occupancy-${r.month}.csv` };
    },
    /**
     * The GST summary of one month (default: this month): every live bill dated in it with its taxable value (the business total less its GST) and GST per
     * business, B2B (a GSTIN on the bill) and B2C totals (ui-shared assembleGst). Needs the Reports screen.
     */
    async gst(session: VerifiedSession, month?: string): Promise<GstReport> {
      requirePermission(session, catalog, REPORTS, "view");
      const today = istDay(now());
      const m = month ?? today.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new AppError("VALIDATION_FAILED", "Pick a month like 2026-10.", { fields: { month: "Pick a month like 2026-10." } });
      const first = `${m}-01`;
      const last = `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
      const rows = await unit.run(session, (repos) => repos.gst.bills(first, last));
      const bills: GstBillLine[] = rows.map((b) => {
        const hotelGst = num(b.hotelGstPaise);
        const foodGst = num(b.foodGstPaise);
        const hotelTaxable = num(b.totalHotelAmountPaise) - hotelGst;
        const foodTaxable = num(b.totalFoodAmountPaise) - foodGst;
        const gstin = (b.guestGstin ?? "").trim().toUpperCase() || null;
        return { id: b.id, date: b.billDate, billNumber: b.billNumber, guest: b.guestName, gstin, company: b.companyName, hotelTaxablePaise: hotelTaxable, hotelGstPaise: hotelGst, hotelGstPercent: b.hotelGstPercent, foodTaxablePaise: foodTaxable, foodGstPaise: foodGst, foodGstPercent: b.foodGstPercent, totalPaise: hotelTaxable + hotelGst + foodTaxable + foodGst };
      });
      return assembleGst(m, bills);
    },

    /** The same month as a GSTR-1 shaped CSV: one line per bill and business (hotel, food), then B2B, B2C and grand totals. */
    async gstCsv(session: VerifiedSession, month?: string): Promise<{ bytes: Uint8Array; filename: string }> {
      const r = await this.gst(session, month);
      const cell = (v: string | number | null): string => (v === null ? "" : typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
      const rupees = (paise: number): string => (paise / 100).toFixed(2);
      const line = (cells: (string | number | null)[]): string => cells.map(cell).join(",");
      const lines = [line(["Invoice date", "Invoice number", "Receiver name", "GSTIN/UIN of recipient", "Type", "Business", "Rate (%)", "Taxable value (Rs)", "GST (Rs)", "Invoice value (Rs)"])];
      for (const b of r.bills) {
        const type = b.gstin ? "B2B" : "B2C";
        if (b.hotelTaxablePaise + b.hotelGstPaise !== 0) lines.push(line([b.date, b.billNumber, b.company ?? b.guest, b.gstin, type, "Hotel", b.hotelGstPercent, rupees(b.hotelTaxablePaise), rupees(b.hotelGstPaise), rupees(b.totalPaise)]));
        if (b.foodTaxablePaise + b.foodGstPaise !== 0) lines.push(line([b.date, b.billNumber, b.company ?? b.guest, b.gstin, type, "Food", b.foodGstPercent, rupees(b.foodTaxablePaise), rupees(b.foodGstPaise), rupees(b.totalPaise)]));
      }
      const t = r.totals;
      lines.push(line([null, "B2B total", null, null, "B2B", null, null, rupees(t.b2b.taxablePaise), rupees(t.b2b.gstPaise), rupees(t.b2b.totalPaise)]));
      lines.push(line([null, "B2C total", null, null, "B2C", null, null, rupees(t.b2c.taxablePaise), rupees(t.b2c.gstPaise), rupees(t.b2c.totalPaise)]));
      lines.push(line([null, "Total", null, null, null, null, null, rupees(t.taxablePaise), rupees(t.gstPaise), rupees(t.totalPaise)]));
      return { bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`), filename: `gst-${r.month}.csv` };
    },
    /** The day sheet for one day. */
    async daily(session: VerifiedSession, date: string | undefined): Promise<DailyReportDto> {
      requirePermission(session, catalog, REPORTS, "view");
      const day = date ?? istDay(now());
      if (!validDay(day)) throw new AppError("VALIDATION_FAILED", "Choose a valid date.", { fields: { date: "Choose a valid date." } });
      return unit.run(session, async (repos) => {
        const lines = (await repos.daySheet.lines({ from: day, to: day })).map((l) => ({ l, bucket: bucketOf(l.mode, l.amountPaise) }));
        const pick = (bucket: Bucket, direction?: "in" | "out") => lines.filter((x) => x.bucket === bucket && (!direction || x.l.direction === direction)).map((x) => x.l);
        const cashIn = pick("cash", "in");
        const cashOut = pick("cash", "out");
        const banked = pick("banked");
        const debit = pick("debit");
        const free = pick("free");
        const { open, tonight } = await openingAndTonight(repos, day);
        const mealsPaise = BigInt(tonight.totals.amountPaise);
        const cashInTotal = sum(cashIn);
        const cashOutTotal = sum(cashOut);
        const bankedIn = sum(banked.filter((l) => l.direction === "in"));
        const bankedOut = sum(banked.filter((l) => l.direction === "out"));
        const debitRaised = sum(debit);
        const revenue = cashInTotal + bankedIn + debitRaised;
        const paidOut = cashOutTotal + bankedOut;
        return {
          date: day,
          cashIn: ordered(cashIn),
          cashOut: ordered(cashOut),
          banked: ordered(banked),
          debit: ordered(debit),
          complimentary: ordered(free),
          foodPlan: tonight.rows.map((r) => ({ id: r.id, room: r.room, bill: r.bill, guest: r.guest, company: r.company, plan: r.plans[0] ?? "", persons: r.persons[0] ?? 0, ratePaise: r.ratesPaise[0] ?? 0, amountPaise: r.amountPaise })),
          totals: {
            openingPaise: num(open),
            cashInPaise: num(cashInTotal),
            cashOutPaise: num(cashOutTotal),
            cashOnHandPaise: num(open + cashInTotal),
            foodPlanPaise: tonight.totals.amountPaise,
            carryForwardPaise: num(open + cashInTotal - cashOutTotal - mealsPaise),
            bankedInPaise: num(bankedIn),
            bankedOutPaise: num(bankedOut),
            debitPaise: num(debitRaised),
            complimentaryPaise: num(sum(free)),
            revenuePaise: num(revenue),
            paidOutPaise: num(paidOut + mealsPaise),
            netPaise: num(revenue - paidOut - mealsPaise),
            entries: lines.length,
            cashPaidTotalPaise: num(cashOutTotal + mealsPaise),
          },
        };
      });
    },

    /** The food plan for one calendar month, optionally one plan. */
    async foodPlan(session: VerifiedSession, month: string | undefined, planFilter: string | undefined): Promise<FoodPlanMonthDto> {
      requirePermission(session, catalog, REPORTS, "view");
      const m = month ?? istDay(now()).slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new AppError("VALIDATION_FAILED", "Choose a valid month.", { fields: { month: "Choose a valid month." } });
      const start = `${m}-01`;
      const end = addDays(shiftMonths(start, 1), -1);
      return unit.run(session, async (repos) => {
        const result = await plan(repos, start, end, planFilter ? planFilter.trim() || null : null);
        return { month: m, plan: result.plan, plans: result.plans, rows: result.rows.map(withoutNights), byPlan: result.byPlan, totals: result.totals };
      });
    },

    /** The Daily Report as the document the PDF draws: the SAME figures and permission as `daily`. */
    async dailyDocument(session: VerifiedSession, date: string | undefined): Promise<{ doc: PayrollDoc; filename: string }> {
      const report = await this.daily(session, date);
      return { doc: dailyReportDoc(await headerOf(session), report), filename: `daily-report-${report.date}` };
    },

    /** The Food Plan Report as the document the PDF draws: the SAME figures and permission as `foodPlan`. */
    async foodPlanDocument(session: VerifiedSession, month: string | undefined, planFilter: string | undefined): Promise<{ doc: PayrollDoc; filename: string }> {
      const report = await this.foodPlan(session, month, planFilter);
      return { doc: foodPlanDoc(await headerOf(session), report), filename: `food-plan-${report.month}${report.plan ? `-${report.plan}` : ""}` };
    },

    /** The cash in the drawer when a day opens (the daily sheet's opening); the accounting years show it as what they carry in. */
    async openingCash(session: Pick<VerifiedSession, "hotelId" | "userId">, day: string): Promise<number> {
      return unit.run(session, async (repos) => num(await opening(repos, day)));
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;

