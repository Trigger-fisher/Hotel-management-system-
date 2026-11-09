import "server-only";
import { dmy, shortDate } from "./dates";

// The letters' text rules (Pallav Models/JoiningLetter::renderFor, ExperienceLetter::renderFor, EmployeeSeparation::tenureLabel). Golden:
// db/scripts/php/generate-payroll-letters-fixtures.php (real PHP DateTime::diff for the interval; Carbon's wording rule written out).

const ms = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const DAY_MS = 86_400_000;

/** PHP's date arithmetic: a day that does not exist in the target month rolls over into the next one (Jan 31 + 1 month = Mar 2 or 3). */
function addMonths(day: string, months: number): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + months;
  return Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, Number(day.slice(8, 10)));
}

/**
 * DateTime::diff on two dates (PHP 8.1+): the most months that fit before the later date, then the days left. Either order gives the same
 * (the interval is only flagged inverted).
 */
export function dateDiff(a: string, b: string): { y: number; m: number; d: number } {
  const [from, to] = ms(a) <= ms(b) ? [a, b] : [b, a];
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  while (months > 0 && addMonths(from, months) > ms(to)) months -= 1;
  const days = Math.round((ms(to) - addMonths(from, months)) / DAY_MS);
  return { y: Math.floor(months / 12), m: months % 12, d: days };
}

/** EmployeeSeparation::tenureLabel: Carbon diffForHumans(ABSOLUTE, parts 2): "1 year 3 months", "11 months 3 weeks", "0 seconds". */
export function tenureLabel(joined: string | null, lastWorkingDay: string): string {
  if (!joined) return "-";
  const { y, m, d } = dateDiff(joined, lastWorkingDay);
  const units: [string, number][] = [["year", y], ["month", m], ["week", Math.floor(d / 7)], ["day", d % 7]];
  const parts: string[] = [];
  for (const [unit, value] of units) if (value > 0 && parts.length < 2) parts.push(`${value} ${unit}${value === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" ") : "0 seconds";
}

/** PHP strtr($text, $pairs): one pass, longest key first, replaced text is never scanned again. */
export function strtr(text: string, pairs: Record<string, string>): string {
  const keys = Object.keys(pairs).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.replace(new RegExp(escaped.join("|"), "g"), (hit) => pairs[hit]);
}


interface Person {
  name: string;
  designation: string | null;
  department: string | null;
  responsibilities?: string | null;
  joiningDate: string | null;
}

export function joiningValues(e: Person, today: string): Record<string, string> {
  return {
    "{EMPLOYEE_NAME}": e.name,
    "{DESIGNATION}": e.designation ?? "",
    "{DEPARTMENT}": e.department ?? "",
    "{RESPONSIBILITIES}": e.responsibilities ?? "",
    "{JOINING_DATE}": e.joiningDate ? dmy(e.joiningDate) : "",
    "{CURRENT_DATE}": dmy(today),
  };
}

export function experienceValues(e: Person, lastWorkingDate: string, today: string): Record<string, string> {
  return {
    "{EMPLOYEE_NAME}": e.name,
    "{DESIGNATION}": e.designation ?? "",
    "{DEPARTMENT}": e.department ?? "",
    "{JOINING_DATE}": e.joiningDate ? shortDate(e.joiningDate) : "",
    "{LAST_WORKING_DATE}": shortDate(lastWorkingDate),
    "{DURATION}": tenureLabel(e.joiningDate, lastWorkingDate),
    "{CURRENT_DATE}": shortDate(today),
  };
}
