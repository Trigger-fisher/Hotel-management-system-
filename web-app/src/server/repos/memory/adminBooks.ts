import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminBooksRepos, AdminBooksUnit, BookYear, Carried } from "../adminBooks";
import type { SystemLogEntry } from "../cashSupport";

// The in-memory double of the Books side of Admin. The years are real rows here; what a year HOLDS and what it left open belong to the other modules' tables,
// so the test gives them as functions (`counts`, `carried`, `onRemove`); everything else (closing, opening, the one-step start and the all-or-nothing
// removal) is the double's own. A failed transaction leaves nothing behind.
interface AdminBooksData {
  years: BookYear[];
  logs: SystemLogEntry[];
}

interface AdminBooksInputs {
  counts?: (year: BookYear) => Record<string, number>;
  carried?: (year: BookYear) => Carried;
  /** What removing the newest year removes (the double does not own those rows); may throw to prove nothing is half done. */
  onRemove?: (year: BookYear) => Record<string, number>;
}

const EMPTY: Carried = { cashPaise: null, bills: { count: 0, amountPaise: 0 }, advances: { count: 0, amountPaise: 0 }, payroll: { count: 0, amountPaise: 0 }, salaries: { count: 0, amountPaise: 0 } };

function bindAdminBooks(data: AdminBooksData, inputs: AdminBooksInputs = {}): AdminBooksRepos {
  const sorted = (): BookYear[] => [...data.years].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)).map((y) => ({ ...y }));
  return {
    books: {
      years: async () => sorted(),
      counts: async (year) => inputs.counts?.(year) ?? {},
      carried: async (year) => inputs.carried?.(year) ?? EMPTY,
      start: async (next, by, now) => {
        const years = sorted();
        const current = years[years.length - 1];
        if (data.years.some((y) => y.label === next.label || y.startsOn === next.startsOn)) throw new Error("accounting_years unique");
        if (current) {
          const row = data.years.find((y) => y.id === current.id)!;
          row.closedAt = now;
          row.closedBy = by;
        }
        const year: BookYear = { id: randomUUID(), label: next.label, startsOn: next.startsOn, endsOn: next.endsOn, closedAt: null, startedBy: by, closedBy: null };
        data.years.push(year);
        return { ...year };
      },
      removeLatest: async () => {
        const years = sorted();
        const newest = years[years.length - 1];
        if (!newest || years.length < 2) throw new Error("no earlier year");
        const removed = inputs.onRemove?.(newest) ?? inputs.counts?.(newest) ?? {};
        data.years = data.years.filter((y) => y.id !== newest.id);
        const previous = data.years.find((y) => y.id === years[years.length - 2].id)!;
        previous.closedAt = null;
        previous.closedBy = null;
        return removed;
      },
    },
    systemLogs: { write: async (entry) => void data.logs.push(entry) },
  };
}

export function createMemoryAdminBooks(years: BookYear[] = [], inputs: AdminBooksInputs = {}): { unit: AdminBooksUnit; data: AdminBooksData; inputs: AdminBooksInputs } {
  const data: AdminBooksData = { years: structuredClone(years), logs: [] };
  let tail: Promise<unknown> = Promise.resolve();
  return {
    data,
    inputs,
    unit: {
      run: <T>(_session: unknown, work: (repos: AdminBooksRepos) => Promise<T>): Promise<T> => {
        const next = tail.then(async () => {
          const before = structuredClone({ years: data.years, logs: data.logs });
          try {
            return await work(bindAdminBooks(data, inputs));
          } catch (error) {
            data.years = before.years;
            data.logs = before.logs;
            throw error;
          }
        });
        tail = next.catch(() => undefined);
        return next;
      },
    },
  };
}
