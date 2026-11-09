import "server-only";
import type { SystemLogRepo } from "./cashSupport";
import type { Unit } from "./types";

// The accounting years as the Books screen sees them (Pallav Support/Books.php + BooksController). The years themselves (`accounting_years`) are plain rows;
// what a year HOLDS (a count per dated table), what it leaves open (the carried-forward figures) and the removal of the newest year (which gives back what
// the year did to older records, then deletes everything dated in it) reach every module's tables, so those three are the engine's work in ONE transaction:
// the PostgreSQL implementation is SQL over the hotel's schema (Backend 1); the in-memory double takes them from the test. Rules, words and permissions are
// in services/admin/booksService.ts and do not depend on the engine.

export interface BookYear {
  id: string;
  /** "2026-27" */
  label: string;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
  closedAt: Date | null;
  startedBy: string | null;
  closedBy: string | null;
}

/** A count and an amount in paise. */
interface CountAmount {
  count: number;
  amountPaise: number;
}

/** What an older year left open, carried into the current one (Books::carried). */
export interface Carried {
  /** Cash in hand on the first day of the year (the daily sheet's opening); null when it cannot be worked out. */
  cashPaise: number | null;
  bills: CountAmount;
  advances: CountAmount;
  payroll: CountAmount;
  salaries: CountAmount;
}

/** The tables with a date, by the key the screen shows (Books::DATED). */
export const DATED_TABLES = [
  "hotel_cash_deposits",
  "food_cash_deposits",
  "hotel_cash_withdrawals",
  "food_cash_withdrawals",
  "hotel_misc_expenses",
  "food_misc_expenses",
  "shift_handovers",
  "bill_master_bills",
  "bill_master_advances",
  "staff_advances",
  "payroll_advances",
  "bonus_incentives",
  "employee_meal_periods",
  "salary_processings",
  "attendance_months",
] as const;

export interface BooksRepo {
  /** Every year, oldest first; the newest is the one the business works in. */
  years(): Promise<BookYear[]>;
  /** How many rows each dated table has in the year (keys of DATED_TABLES; a table the hotel does not keep is absent). */
  counts(year: BookYear): Promise<Record<string, number>>;
  carried(year: BookYear): Promise<Carried>;
  /** Closes the current year (closed_at, closed_by) and adds the next, in one step. */
  start(next: { label: string; startsOn: string; endsOn: string }, by: string, now: Date): Promise<BookYear>;
  /**
   * Removes the NEWEST year and everything dated in it, after giving back what it did to older records (advances it used, debit bills it settled, refunds
   * it paid, salaries it paid, payroll advances it recovered; each month's salary run reversed the way payroll itself reverses it), then opens the previous
   * year again. Returns what it removed, the same counts as `counts`. Nothing is left half done.
   */
  removeLatest(by: string, now: Date): Promise<Record<string, number>>;
}

export interface AdminBooksRepos {
  books: BooksRepo;
  systemLogs: SystemLogRepo;
}

/** One hotel transaction, like every hotel unit: the session names the hotel (a hotel database picks its schema from it). */
export type AdminBooksUnit = Unit<AdminBooksRepos>;
