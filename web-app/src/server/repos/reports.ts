import "server-only";
import type { Paise } from "../money/paise";
import type { MealPlanRateRepo } from "./billing";
import type { Unit } from "./types";

// The reads behind the Reports (Daily Report, Food Plan) and the Hotel dashboard (Pallav Services/Reports/{DailySheet,FoodPlanMonth}.php and
// DashboardController). They READ other modules' tables and compute nothing about money rules: the services (services/overview/*) apply the buckets, the
// opening balance, the nightly meal prices and the totals, so the PostgreSQL side is plain selects. Deleted rows (deleted_at set) are never read. Dates are
// YYYY-MM-DD (the hotel's IST day), amounts are paise. Spec: docs/specs/overview.md.

/* ---------------------------------------------------------------- the day sheet */

export type SheetKind = "Bill" | "Advance" | "Refund" | "Debit recovery" | "Collection" | "Withdrawal" | "Expense" | "Staff advance";

/**
 * One line of the day sheet as the source tables give it (DailySheet::line without its bucket). The repository builds lines exactly as Pallav does:
 *  - Bill: each live bill, per side (hotel, food) whose total is above 0, dated bill_date; amount = max(0, total_side − advance_side_taken); mode = the side's
 *    mode; ref = the number after the last "/" ("2026 / 1660" → "1660"); particulars = guest name or "Walk-in guest"; party = company name;
 *    fromAdvancePaise = advance_side_taken; note = join(" - ", [hotel plan (hotel side only), "Pallav Food" (food side), "{amount} from advance {short advance receipt}" when fromAdvance > 0]).
 *  - Advance: each live advance, per side with an amount above 0, dated payment_date; direction in; mode = the side's mode; particulars = guest or "Advance"; note "Advance received" (+ " Pallav Food").
 *  - Refund: each live advance with a refund, per side with a refund amount above 0, dated refund_payment_date; direction out; mode = the side's refund mode; particulars = refund guest, else guest, else "Advance refund"; note "Advance refunded" (+ " Pallav Food") (+ " - {refund instruction}").
 *  - Debit recovery: for each of the five settlement slots of a live bill, per side with an amount above 0, dated that slot's date; direction in; particulars = company name, else guest, else "Debit recovery"; note "Against an earlier debit bill" (+ " Pallav Food").
 *  - Collection / Withdrawal / Expense: the three cash books of each business (deposits in; withdrawals and expenses out), dated `date`; mode "Cash"; ref "#" + entry number; particulars = depositor / withdrawer / expense name, else the kind; note = expense head, revenue source, reason or instruction (first that is set).
 *  - Staff advance: each live cash staff advance dated `date`; direction out; mode "Cash"; ref "#" + entry number; particulars = the staff member's name or "Staff advance"; note "Salary advance" (+ " for {year-month}"); unit = the advance's business (hotel when not set).
 */
export interface SheetLine {
  /** The source row's id (with the kind and side it is unique enough to key a table). */
  id: string;
  kind: SheetKind;
  ref: string | null;
  room: string | null;
  particulars: string;
  note: string | null;
  /** As stored; null when not set. */
  mode: string | null;
  direction: "in" | "out";
  amountPaise: Paise;
  date: string;
  party: string | null;
  unit: "hotel" | "food";
  fromAdvancePaise: Paise;
}

export interface DaySheetRepo {
  /** Every line dated between `from` and `to` inclusive; `from` null = from the beginning of time. */
  lines(range: { from: string | null; to: string }): Promise<SheetLine[]>;
  /**
   * The drawer's net cash from the beginning of time up to the day BEFORE `day`: the sum of the lines dated before `day` whose mode is "cash" (trimmed,
   * case-insensitive) and direction in, minus the same with direction out. A pushed-down form of lines({from: null, to: day − 1}) so the opening of a late
   * day does not read every line ever made; the answer must be the same (a test of the PostgreSQL side compares them).
   */
  cashNetBefore(day: string): Promise<Paise>;
}

/* ---------------------------------------------------------------- the food plan */

/** A live bill whose stay can have nights in the window (FoodPlanMonth::bills): it has stay parts, or both an arrival and a departure. */
export interface StayBillRow {
  id: string;
  billNumber: string;
  billDate: string;
  roomNumber: string | null;
  guestName: string;
  companyName: string | null;
  persons: number | null;
  hotelPlan: string | null;
  /** The date part (IST) of the arrival and the departure; null when not set. */
  arrivalDate: string | null;
  departureDate: string | null;
  /** The stay as saved (priced parts): from, to (exclusive), plan, persons; null when the bill has none. */
  stay: { from: string; to: string; plan: string | null; persons: number }[] | null;
}

export interface FoodPlanRepo {
  /** Live bills with stay parts, or an arrival and a departure, whose bill_date is within [billDateFrom, billDateTo] (the service passes the window ± 2 months, as Pallav). */
  stayBills(window: { billDateFrom: string; billDateTo: string; mealPlans?: readonly string[] }): Promise<StayBillRow[]>;
  // `mealPlans` (lower-case plan names that have a price above nothing in the rate table) leaves out the bills that have no stay parts and whose own plan is not one of them:
  // such a bill is worth no meals on any night, so it can change no figure. Left out, every bill of the window comes back.
}

/* ---------------------------------------------------------------- the dashboard */

type MovementKind = "Deposit" | "Withdrawal" | "Expense" | "Staff advance";

/** One cash-book movement (deposits in; withdrawals, expenses and cash staff advances out), the two businesses' books together. */
export interface CashMovement {
  id: string;
  unit: "hotel" | "food";
  direction: "in" | "out";
  kind: MovementKind;
  /** Expense head ("Unsorted" when empty), "Cash withdrawals", "Staff advances"; null for a deposit. */
  head: string | null;
  /** Depositor, withdrawer, expense name or staff name. */
  who: string;
  entryNo: string;
  /** The user who recorded it, when the row has one: the service resolves the display name through the people directory (a hotel schema cannot read platform.users). */
  userId: string | null;
  /** The name written on the row (a snapshot): what is shown when the user cannot be resolved. */
  byName: string;
  amountPaise: Paise;
  date: string;
  /** HH:MM the entry was made. */
  time: string;
}

export interface HandoverFigures {
  todayCount: number;
  /** The sum of the handovers' counted cash dated today. */
  todayCashPaise: Paise;
  monthCount: number;
  /** The newest by date, time, id. */
  latest: { shift: string; date: string; time: string; userId: string | null; byName: string } | null;
}

export interface PayrollFigures {
  activeStaff: number;
  /** Active staff whose joining date is within the month so far. */
  joinedThisMonth: number;
  /** Salary runs not Paid. */
  openCount: number;
  /** Sum of max(0, net − paid) over them. */
  openAmountPaise: Paise;
  /** The oldest of them, "2026-08"; null when none. */
  openSince: string | null;
  /** Cash staff advances dated within the month so far. */
  advancesPaise: Paise;
  advanceCount: number;
  /** Salary runs paid (paid_at) within the month so far. */
  paidPaise: Paise;
  paidCount: number;
}

export interface OverviewRepo {
  /** Every movement dated between `from` and `to` inclusive. */
  movements(range: { from: string; to: string }): Promise<CashMovement[]>;
  /** How many movements are dated between `from` and `to` inclusive (the bell only needs "any today?": a count, not every row). */
  movementCount(range: { from: string; to: string }): Promise<number>;
  /** The newest `limit` movements by date, time, id (the "recent entries" list). */
  recent(limit: number): Promise<CashMovement[]>;
  handovers(today: string, monthStart: string): Promise<HandoverFigures>;
  payroll(monthStart: string, today: string): Promise<PayrollFigures>;
}

/** The front desk's day in numbers (the dashboard's "Front desk today" row). */
export interface FrontDeskFigures {
  /** Confirmed reservations with check-in = today and no check-in yet. */
  arrivals: number;
  /** In-house stays whose expected check-out is today or earlier. */
  departures: number;
  inHouse: number;
  /** Rooms marked dirty that are not out of order. */
  roomsToClean: number;
  /** Rooms clean, not out of order and with nobody in house. */
  roomsReady: number;
}

/** Confirmed reservations arriving on a date with no check-in yet (the dashboard's "arrivals today"). */
interface ArrivalsRepo {
  /** status confirmed (not checked in, cancelled or no-show) and check_in = `date`. */
  arrivalsToday(date: string): Promise<number>;
}

/** The front desk's day (the dashboard's "Front desk today" row). */
export interface FrontDeskRepo {
  today(date: string): Promise<FrontDeskFigures>;
  /** Guest requests (G2) still waiting; zero for a hotel built before migration 0031. */
  openGuestRequests(): Promise<number>;
}

/** One night of the occupancy report, as the database counts it. */
export interface NightFigures {
  date: string;
  /** Stays whose check-in day <= this night < check-out day (the actual one, else the expected one). */
  roomsSold: number;
  /** The sum of those stays' rates (paise). */
  roomRevenuePaise: Paise;
  /** Stays whose check-in day is this day. */
  arrivals: number;
  /** Stays whose check-out day (actual, else expected) is this day. */
  departures: number;
}

export interface OccupancyRepo {
  /** One row per night from `from` to `to` inclusive (nights with nothing are rows of zeros). */
  nights(from: string, to: string): Promise<NightFigures[]>;
  /** Rooms not out of order. */
  roomCount(): Promise<number>;
}

/** One live bill as the GST summary reads it (bill_master_bills; the company's name joined). */
export interface GstBillRow {
  id: string;
  billDate: string;
  billNumber: string;
  guestName: string;
  guestGstin: string | null;
  companyName: string | null;
  totalHotelAmountPaise: Paise;
  hotelGstPaise: Paise;
  hotelGstPercent: string | null;
  totalFoodAmountPaise: Paise;
  foodGstPaise: Paise;
  foodGstPercent: string | null;
}

export interface GstRepo {
  /** Every live bill dated from `from` to `to` inclusive. */
  bills(from: string, to: string): Promise<GstBillRow[]>;
}

/** What the report services get inside one hotel transaction. */
export interface ReportsRepos {
  daySheet: DaySheetRepo;
  foodPlan: FoodPlanRepo;
  overview: OverviewRepo;
  /** Every plan rate, oldest first (the same table billing prices a stay from). */
  mealPlanRates: MealPlanRateRepo;
  /** `reservations.arrivalsToday` of the front office. */
  reservations: ArrivalsRepo;
  frontDesk: FrontDeskRepo;
  occupancy: OccupancyRepo;
  gst: GstRepo;
}

export type ReportsUnit = Unit<ReportsRepos>;
