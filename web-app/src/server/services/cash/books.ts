import "server-only";
import { AppError } from "../../errors";
import type { AccountingYear } from "../../repos/cashSupport";

// The accounting-year lock. A port of Pallav's Support/Books.php guard() for a record dated by one `date` column: only the NEWEST
// year takes entries; a save or a delete that reaches into a closed year is refused (error field `date`). Dates before the first year
// are history the years never covered, so they are not locked. Force mode steps past the lock (the caller writes the force log).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const covers = (year: AccountingYear, date: string): boolean => date >= year.startsOn && date <= year.endsOn;

function dayText(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

const monthYear = (date: string): string => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const span = (year: AccountingYear): string => `${monthYear(year.startsOn)} - ${monthYear(year.endsOn)}`;
/** The year starting on 1 April of `startYear` as its label: 2027-28. */
const labelFor = (startYear: number): string => `${startYear}-${String(startYear + 1).slice(-2)}`;

type GuardAction = "dated" | "changed" | "deleted";

function refuse(years: AccountingYear[], date: string, what: GuardAction): AppError {
  const current = years[years.length - 1];
  const day = dayText(date);
  let message: string;
  if (date > current.endsOn) {
    message = `${day} is in ${labelFor(Number(current.startsOn.slice(0, 4)) + 1)}, which has not been started yet. An Admin can start it from the year menu in the header. Until then, entries up to ${dayText(current.endsOn)} can still be made.`;
  } else {
    const year = years.find((y) => covers(y, date));
    const closed = year ? `${year.label} is closed` : "That year is closed";
    message =
      what === "dated"
        ? `${closed}, so nothing can be dated ${day}. Only ${current.label} (${span(current)}) takes entries.`
        : `${closed}, so an entry dated ${day} cannot be ${what}. Only ${current.label} (${span(current)}) takes entries.`;
  }
  return new AppError("VALIDATION_FAILED", message, { fields: { date: message } });
}

export interface GuardInput {
  years: AccountingYear[];
  /** The date the entry has now (a saved one), or null for a new entry. */
  was: string | null;
  /** The date it would have after the save; for a delete, null. */
  now: string | null;
  action: "save" | "delete";
  /**
   * Pallav's 4th/5th guard arguments ($booksPending, $booksActionDates, Books.php:59-81): a closed year's record may still be finished
   * (a bill settled, an advance refunded) when ONLY its pending columns change, and each action date that changed must be this year.
   * Absent = the record has no pending columns (cash).
   */
  pending?: { onlyPendingChanged: boolean; actionDates: readonly { was: string | null; now: string | null }[] };
}

/** Throws the Pallav refusal, or returns. `years` is oldest first. */
export function guardBooks(input: GuardInput): void {
  const { years } = input;
  const current = years[years.length - 1];
  if (!current) return;
  const first = years[0].startsOn;
  const held = (d: string | null): string | null => (d && d >= first ? d : null);
  const was = held(input.was);
  const now = held(input.now);
  if (input.action === "delete") {
    if (was && !covers(current, was)) throw refuse(years, was, "deleted");
    return;
  }
  // an older year's entry: only finishing what it left open (its pending columns), with any action date in this year
  if (input.was !== null && was && !covers(current, was)) {
    if (!input.pending?.onlyPendingChanged) throw refuse(years, was, "changed");
    for (const d of input.pending.actionDates) {
      if (d.was === d.now) continue;
      // undoing what a closed year did is closed too
      if (d.was && !covers(current, d.was)) throw refuse(years, d.was, "changed");
      if (d.now && !covers(current, d.now)) throw refuse(years, d.now, "dated");
    }
    return;
  }
  if (now && !covers(current, now)) throw refuse(years, now, "dated");
}

/** Would the guard have refused? Used for force mode, which writes what it stepped past to the force log. */
export function guardWouldRefuse(input: GuardInput): boolean {
  try {
    guardBooks(input);
    return false;
  } catch (error) {
    if (error instanceof AppError) return true;
    throw error;
  }
}
