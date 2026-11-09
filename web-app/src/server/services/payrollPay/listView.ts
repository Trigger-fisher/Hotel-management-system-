import "server-only";
import type { InstantRange } from "../../repos/payrollPay";
import { istInstant } from "../cash/ist";

// The pay lists' shared paging contract (Slips, Advances, Bonus, Resignations; docs/BACKEND.md §7.6): period, search, status, sort and dir apply
// before paging; ties in a sort keep the list's old order, so a page never reshuffles.

export type SortDir = "asc" | "desc";
type SortValue = string | number | bigint;

/** The search box as words (each must match), lower-cased. */
export const wordsOf = (search: string | undefined): string[] => (search ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Every word inside the parts joined by spaces (as the repos' concat_ws match). */
export const hasWords = (words: readonly string[], ...parts: (string | null | undefined)[]): boolean => {
  if (words.length === 0) return true;
  const hay = parts.filter((p) => p !== null && p !== undefined).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

/** A stable sort by one key; without a key the rows keep their order. */
export function sortRows<T>(rows: readonly T[], key: ((r: T) => SortValue | readonly SortValue[]) | undefined, dir: SortDir | undefined): T[] {
  if (!key) return [...rows];
  const sign = dir === "desc" ? -1 : 1;
  const keyed = rows.map((r, i) => ({ r, i, k: key(r) }));
  const cmp = (x: SortValue | readonly SortValue[], y: SortValue | readonly SortValue[]): number => {
    const a = Array.isArray(x) ? x : [x];
    const b = Array.isArray(y) ? y : [y];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  };
  return keyed.sort((a, b) => cmp(a.k, b.k) * sign || a.i - b.i).map((x) => x.r);
}

export const pageOf = <T>(rows: readonly T[], q: { page: number; pageSize: number }): T[] => rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);

/** "YYYY-MM" as the IST month's instants [first day 00:00, next month's first day 00:00). */
export function monthInstants(period: string): InstantRange {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: istInstant(`${period}-01`, "00:00:00"), to: istInstant(`${next}-01`, "00:00:00") };
}

/** "YYYY-MM" as its first and last day ("YYYY-MM-DD", both included). */
export function monthDays(period: string): { from: string; to: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
