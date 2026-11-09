import "server-only";
// Entry numbers: the running number in each book (cash deposits, bills, handovers, ...). Standard S9: match Pallav exactly.
//
// Pallav (app/Models/Concerns/HasEntryNumber.php): the next number is one past the highest one on the table, counting every
// row including soft-deleted ones. A gap in the middle stays a gap; deleting the LAST entry frees its number. Pallav
// guards a race with a row lock and a UNIQUE index and retries; here the same rule runs under a transaction-level advisory
// lock instead, so two parallel saves can never read the same maximum:
//
//   1. pg_advisory_xact_lock on (current schema + table): hotels never wait for each other, and the lock is released
//      by COMMIT/ROLLBACK (never a session lock, which would leak through a connection pool).
//   2. SELECT COALESCE(MAX(entry_no), 0) + 1 over ALL rows (the UNIQUE(entry_no) index makes MAX instant).
//   3. The caller INSERTs in the same transaction. The UNIQUE index stays as the backstop.
//
// The table name goes into SQL text, so it must come from the fixed list below: never from a request.
import type { TxClient } from "../../db/types";
import { classifyPgError } from "../db/pgErrors";
import { AppError } from "../errors";

/** The books Pallav numbers (database/migrations 2026_09_18_120002 LEDGERS). */
export const ENTRY_NUMBER_TABLES = [
  "hotel_cash_deposits",
  "food_cash_deposits",
  "hotel_cash_withdrawals",
  "food_cash_withdrawals",
  "hotel_misc_expenses",
  "food_misc_expenses",
  "staff_advances",
  "shift_handovers",
  "bill_master_bills",
  "bill_master_advances",
  "payroll_advances",
  "bonus_incentives",
  "employee_separations",
] as const;

export type EntryNumberTable = (typeof ENTRY_NUMBER_TABLES)[number];

const ALLOWED: ReadonlySet<string> = new Set(ENTRY_NUMBER_TABLES);

/** current_schema() is the hotel schema (first on search_path inside withHotel), so each hotel has its own lock. */
export const ENTRY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || '.' || $1::text, 0))";

export async function nextEntryNo(client: TxClient, table: EntryNumberTable): Promise<number> {
  if (typeof table !== "string" || !ALLOWED.has(table)) {
    throw new AppError("SERVER_ERROR", "Not a numbered book");
  }
  try {
    await client.query(ENTRY_LOCK_SQL, [table]);
  } catch (error) {
    // the role's lock_timeout (5 s) ends the wait for a busy book: the caller may simply try again
    if (classifyPgError(error).kind === "lock_timeout") throw new AppError("CONFLICT", "The book is busy: try again");
    throw error;
  }
  const result = await client.query(`SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM "${table}"`);
  const next = Number(result.rows[0]?.next);
  if (!Number.isSafeInteger(next) || next < 1) throw new AppError("SERVER_ERROR", "Entry number could not be worked out");
  return next;
}
