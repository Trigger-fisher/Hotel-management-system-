import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AdminBooksUnit, BookYear, Carried } from "../../repos/adminBooks";
import type { PeopleDirectory } from "../cash/ports";
import { isSuperAdmin } from "../cash/rules";
import { actorOf, fieldError, logLine } from "./context";
import { matchWords } from "../../validation/listQuery";

// The accounting years (Pallav BooksController + Support/Books.php): the list with what each year holds and what the last one left open, starting the next
// year (an Admin, after 31 March) and removing the newest (the SuperAdmin only, typing DELETE and the year). Which years are ON SCREEN is the app's own
// choice (Pallav kept it in the session): the lists take it as `from`/`to` of the years chosen, so the server keeps no per-person view state.
// Spec: docs/specs/admin.md §8.

const ADMIN_ROLES = new Set(["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NAMES: Record<string, string> = {
  hotel_cash_deposits: "Hotel deposits",
  food_cash_deposits: "Food deposits",
  hotel_cash_withdrawals: "Hotel withdrawals",
  food_cash_withdrawals: "Food withdrawals",
  hotel_misc_expenses: "Hotel expenses",
  food_misc_expenses: "Food expenses",
  shift_handovers: "Handovers",
  bill_master_bills: "Bills",
  bill_master_advances: "Guest advances",
  staff_advances: "Staff advances (cash)",
  payroll_advances: "Payroll advances",
  bonus_incentives: "Bonus and incentives",
  employee_meal_periods: "Staff meal periods",
  salary_processings: "Salary runs",
  attendance_months: "Attendance months",
};

const dayText = (date: string): string => `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
/** AccountingYear::shapeFor: the year starting on 1 April of `startYear`. */
const shapeFor = (startYear: number): { label: string; startsOn: string; endsOn: string } => ({ label: `${startYear}-${String(startYear + 1).slice(-2)}`, startsOn: `${startYear}-04-01`, endsOn: `${startYear + 1}-03-31` });
const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const addDay = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface BookYearDto {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  /** The year the business is working in (the newest). */
  current: boolean;
  closedAt: string | null;
  counts: { key: string; name: string; count: number }[];
}

interface BooksPanel {
  /** Newest first. */
  years: BookYearDto[];
  next: { label: string; startsOn: string; endsOn: string };
  /** Why the next year cannot be started now (Pallav's sentence), or null. */
  cannotStart: string | null;
  /** Why the newest year cannot be removed, or null. */
  cannotRemove: string | null;
  carried: Carried | null;
}

interface BooksDeps {
  unit: AdminBooksUnit;
  people: PeopleDirectory;
  now: () => Date;
  /** The drawer's cash when a day opens (the Daily Report's opening): what the current year carried in. Absent or failing = not worked out (null), as Pallav's try/catch. */
  openingCash?: (session: VerifiedSession, day: string) => Promise<number>;
}

export function createBooksService(deps: BooksDeps) {
  const { unit, now } = deps;

  const requireAdmin = (session: VerifiedSession): void => {
    if (!ADMIN_ROLES.has(session.accountRole)) throw new AppError("FORBIDDEN", "Only an Admin or the SuperAdmin can open Accounting years.");
  };

  const nextOf = (years: readonly BookYear[]) => {
    const current = years[years.length - 1];
    const today = istDay(now());
    return shapeFor(current ? Number(current.startsOn.slice(0, 4)) + 1 : Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1);
  };

  /** Books::cannotStart. */
  function cannotStart(session: VerifiedSession, years: readonly BookYear[]): string | null {
    if (!ADMIN_ROLES.has(session.accountRole)) return "Only an Admin or the SuperAdmin can start a new accounting year.";
    const current = years[years.length - 1];
    if (current && istDay(now()) <= current.endsOn) return `${current.label} runs until ${dayText(current.endsOn)}. The next year can be started from ${dayText(addDay(current.endsOn))}.`;
    return null;
  }

  /** Books::cannotRemove. */
  function cannotRemove(session: VerifiedSession, years: readonly BookYear[]): string | null {
    if (!isSuperAdmin(session)) return "Only the SuperAdmin can remove an accounting year.";
    if (years.length < 2) return "This is the only year. There is no earlier year to go back to.";
    return null;
  }

  return {
    async panel(session: VerifiedSession, search?: string): Promise<BooksPanel> {
      requireAdmin(session);
      return unit.run(session, async (repos) => {
        const years = await repos.books.years();
        const dtos: BookYearDto[] = [];
        for (const y of years) {
          const counts = await repos.books.counts(y);
          dtos.push({
            id: y.id,
            label: y.label,
            startsOn: y.startsOn,
            endsOn: y.endsOn,
            current: y === years[years.length - 1],
            closedAt: y.closedAt ? y.closedAt.toISOString() : null,
            counts: Object.entries(NAMES).flatMap(([key, name]) => (key in counts ? [{ key, name, count: counts[key] }] : [])),
          });
        }
        const current = years[years.length - 1];
        return {
          years: matchWords(dtos.reverse(), search, (y) => [y.label, y.startsOn, y.endsOn]),
          next: nextOf(years),
          cannotStart: cannotStart(session, years),
          cannotRemove: cannotRemove(session, years),
          carried: current ? await repos.books.carried(current) : null,
        };
      }).then(async (p) => {
        const current = p.years.find((y) => y.current);
        if (p.carried && current && deps.openingCash) p.carried = { ...p.carried, cashPaise: await deps.openingCash(session, current.startsOn).catch(() => null) };
        return p;
      });
    },

    /** start (:39-48): an Admin, only once the current year is over; the current year is closed and the next opens, in one step. */
    async start(session: VerifiedSession, meta: RequestMeta): Promise<{ year: BookYearDto; message: string }> {
      requireAdmin(session);
      const actor = await actorOf(deps, session);
      return unit.run(session, async (repos) => {
        const years = await repos.books.years();
        const why = cannotStart(session, years);
        if (why) throw new AppError("CONFLICT", why);
        const year = await repos.books.start(nextOf(years), session.userId, now());
        const closed = years[years.length - 1]?.label ?? null;
        await repos.systemLogs.write(logLine({ session, meta, actor }, "system", { action: "created", entity: "accounting_year", summary: `Started accounting year ${year.label}`, subject: { id: year.id, label: year.label }, details: { year: year.label, closed } }));
        return {
          year: { id: year.id, label: year.label, startsOn: year.startsOn, endsOn: year.endsOn, current: true, closedAt: null, counts: [] },
          message: `Accounting year ${year.label} has started. ${dayText(year.startsOn)} onwards is open; earlier years are now read-only.`,
        };
      });
    },

    /** remove (:50-64): the SuperAdmin only, the newest year only, after typing DELETE and its label; everything dated in it goes and the year before is open again. */
    async removeLatest(session: VerifiedSession, input: { confirm: string }, meta: RequestMeta): Promise<{ removed: Record<string, number>; message: string }> {
      const actor = await actorOf(deps, session);
      return unit.run(session, async (repos) => {
        const years = await repos.books.years();
        const why = cannotRemove(session, years);
        if (why) throw new AppError(isSuperAdmin(session) ? "CONFLICT" : "FORBIDDEN", why);
        const current = years[years.length - 1];
        if (input.confirm !== `DELETE ${current.label}`) throw fieldError("confirm", `Type DELETE ${current.label} exactly to remove the year.`);
        const removed = await repos.books.removeLatest(session.userId, now());
        const total = Object.values(removed).reduce((a, b) => a + b, 0);
        const previous = years[years.length - 2];
        await repos.systemLogs.write(logLine({ session, meta, actor }, "system", { action: "deleted", entity: "accounting_year", summary: `Removed accounting year ${current.label} and everything dated in it`, subject: { id: current.id, label: current.label }, details: { year: current.label, rows: removed } }));
        return { removed, message: `Accounting year ${current.label} was removed with its ${total} entries. ${previous.label} is open again.` };
      });
    },
  };
}

export type BooksService = ReturnType<typeof createBooksService>;
