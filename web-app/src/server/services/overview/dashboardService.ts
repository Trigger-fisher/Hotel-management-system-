import "server-only";
import type { Catalog } from "../../auth/catalog";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { formatINR } from "@shared/dashboards/format";
import { hidesPayroll } from "@shared/dashboards/overview";
import { paiseToNumber, type Paise } from "../../money/paise";
import type { CashMovement, ReportsUnit, FrontDeskFigures } from "../../repos/reports";
import type { PeopleDirectory } from "../cash/ports";
import { shiftMonths } from "./foodPlanMath";

// The Hotel dashboard (Pallav DashboardController): the day at a glance from the two cash books, staff advances, the shift handover and payroll, plus (HMS)
// how many guests are due to arrive today. Guest billing is left out here as in Pallav (no bill or guest advance counts); the Daily Report has those.
// Reading needs the `dashboard` screen at view. Spec: docs/specs/overview.md §3.

const DASHBOARD = "dashboard";
/** The Front Office part: who may see the "Front desk today" row. */
const FRONT_OFFICE = "pms.stays";
const TREND_DAYS = 30;
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const daysInMonth = (monthStart: string): number => new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
const BOOK_NAMES = { hotel: "Hotel book", food: "Food book" } as const;
const num = (p: Paise): number => paiseToNumber(p);

interface CashEntryDto {
  id: string;
  unit: "hotel" | "food";
  direction: "in" | "out";
  kind: CashMovement["kind"];
  head: string | null;
  who: string;
  entryNo: string;
  by: string;
  amountPaise: number;
  at: string;
}

interface HotelDashboardDto {
  today: string;
  month: string;
  lastMonth: string;
  /** Guests due to arrive today who have not checked in (confirmed reservations with today as the check-in date). */
  arrivalsToday: number;
  /** The front desk's day (arrivals, departures, in house, rooms); null for a person without the Front Office (pms.stays view). */
  frontDesk: FrontDeskFigures | null;
  handovers: { today: number; todayCashPaise: number; month: number; latest: { shift: string; at: string; by: string } | null };
  day: { inPaise: number; outPaise: number; count: number; yesterdayInPaise: number };
  monthToDate: { inPaise: number; outPaise: number; lastInPaise: number; lastOutPaise: number };
  books: { unit: "hotel" | "food"; name: string; todayInPaise: number; todayOutPaise: number; todayCount: number; monthInPaise: number; monthOutPaise: number }[];
  trend: { date: string; inPaise: number; outPaise: number }[];
  spending: { totalPaise: number; heads: { head: string; totalPaise: number; count: number }[] };
  recent: CashEntryDto[];
  /** Null for a Hotel User: no salary figure is sent to one (MJ, 5 Nov 2026). */
  payroll: { activeStaff: number; joinedThisMonth: number; openCount: number; openAmountPaise: number; openSince: string | null; advancesPaise: number; advanceCount: number; paidPaise: number; paidCount: number } | null;
  attention: { id: string; tone: "warning" | "info"; text: string; action: string; viewId: string }[];
}

interface DashboardDeps {
  unit: ReportsUnit;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
}

const entry = (m: CashMovement, names: ReadonlyMap<string, string>): CashEntryDto => ({ id: m.id, unit: m.unit, direction: m.direction, kind: m.kind, head: m.head, who: m.who, entryNo: m.entryNo, by: (m.userId && names.get(m.userId)) || m.byName, amountPaise: num(m.amountPaise), at: `${m.date}T${m.time}:00+05:30` });

export function createDashboardService(deps: DashboardDeps) {
  const { unit, catalog, now } = deps;
  return {
    /**
     * The bell (every hotel page): what needs someone's attention right now, only the items the person may act on (their grants). Cheap: four small
     * reads, no trend or spending. Front desk items need pms.stays; the handover, cash-book and salary items need their modules.
     */
    async attention(session: VerifiedSession): Promise<{ items: HotelDashboardDto["attention"]; at: string }> {
      const at = now();
      const today = istDay(at);
      const monthStart = `${today.slice(0, 7)}-01`;
      const sees = (key: string) => can(session, catalog, key, "view");
      const wantHandover = sees("handover");
      const wantCash = sees("revenue");
      const wantPayroll = sees("payroll") && !hidesPayroll(session.accountRole);
      const wantDesk = sees(FRONT_OFFICE);
      const raw = await unit.run(session, async (repos) => ({
        handovers: wantHandover ? await repos.overview.handovers(today, monthStart) : null,
        // only "is there any entry today" is needed: a count, not every row of the day
        todayCount: wantCash ? await repos.overview.movementCount({ from: today, to: today }) : null,
        payroll: wantPayroll ? await repos.overview.payroll(monthStart, today) : null,
        desk: wantDesk ? await repos.frontDesk.today(today) : null,
        requests: wantDesk ? await repos.frontDesk.openGuestRequests() : 0,
      }));
      const items: HotelDashboardDto["attention"] = [];
      const d = raw.desk;
      if (raw.requests > 0) items.push({ id: "requests", tone: "warning", text: `${raw.requests} guest ${raw.requests === 1 ? "request is" : "requests are"} waiting`, action: "Guest requests", viewId: "hotel.fo.requests" });
      if (d && d.departures > 0) items.push({ id: "departures", tone: "warning", text: `${d.departures} ${d.departures === 1 ? "guest is" : "guests are"} due to leave today`, action: "In house", viewId: "hotel.fo.inHouse" });
      if (raw.handovers && raw.handovers.todayCount === 0) items.push({ id: "handover", tone: "warning", text: "No shift handover recorded today", action: "Record handover", viewId: "hotel.cash.handover" });
      if (raw.payroll && raw.payroll.openCount > 0) items.push({ id: "salary", tone: "warning", text: `${raw.payroll.openCount} salary ${raw.payroll.openCount === 1 ? "payment is" : "payments are"} still open, ${formatINR(num(raw.payroll.openAmountPaise))} to pay`, action: "Salary payments", viewId: "hotel.payroll.salaryPayments" });
      if (d && d.arrivals > 0) items.push({ id: "arrivals", tone: "info", text: `${d.arrivals} ${d.arrivals === 1 ? "guest is" : "guests are"} arriving today`, action: "Reservations", viewId: "hotel.fo.reservations" });
      if (d && d.roomsToClean > 0) items.push({ id: "rooms", tone: "info", text: `${d.roomsToClean} ${d.roomsToClean === 1 ? "room needs" : "rooms need"} cleaning`, action: "Rooms", viewId: "hotel.fo.rooms" });
      if (raw.todayCount === 0) items.push({ id: "entries", tone: "info", text: "Nothing entered in either cash book today", action: "Open revenue", viewId: "hotel.cash.revenue" });
      return { items, at: at.toISOString() };
    },

    async summary(session: VerifiedSession): Promise<HotelDashboardDto> {
      requirePermission(session, catalog, DASHBOARD, "view");
      const today = istDay(now());
      const monthStart = `${today.slice(0, 7)}-01`;
      const trendStart = addDays(today, -(TREND_DAYS - 1));
      const lastMonthStart = shiftMonths(monthStart, -1);
      const lastMonthSameDay = `${lastMonthStart.slice(0, 7)}-${String(Math.min(Number(today.slice(8, 10)), daysInMonth(lastMonthStart))).padStart(2, "0")}`;
      const yesterday = addDays(today, -1);

      const raw = await unit.run(session, async (repos) => ({
        movements: await repos.overview.movements({ from: trendStart < lastMonthStart ? trendStart : lastMonthStart, to: today }),
        recent: await repos.overview.recent(7),
        handovers: await repos.overview.handovers(today, monthStart),
        payroll: hidesPayroll(session.accountRole) ? null : await repos.overview.payroll(monthStart, today),
        arrivalsToday: await repos.reservations.arrivalsToday(today),
        frontDesk: can(session, catalog, FRONT_OFFICE, "view") ? await repos.frontDesk.today(today) : null,
      }));

      // who recorded each: the display name through the people directory, the name written on the row when it cannot be found
      const ids = [...new Set([...raw.recent.map((m) => m.userId), raw.handovers.latest?.userId ?? null].flatMap((i) => (i ? [i] : [])))];
      const names = new Map([...(await deps.people.get(ids))].map(([id, p]) => [id, p.name]));
      const between = (from: string, to: string) => raw.movements.filter((m) => m.date >= from && m.date <= to);
      const total = (rows: readonly CashMovement[], direction: "in" | "out"): number => num(rows.filter((m) => m.direction === direction).reduce((a, m) => a + m.amountPaise, BigInt(0)));
      const todayRows = between(today, today);
      const monthRows = between(monthStart, today);
      const lastMonthRows = between(lastMonthStart, lastMonthSameDay);

      const books = (["hotel", "food"] as const).map((u) => {
        const t = todayRows.filter((m) => m.unit === u);
        const m = monthRows.filter((x) => x.unit === u);
        return { unit: u, name: BOOK_NAMES[u], todayInPaise: total(t, "in"), todayOutPaise: total(t, "out"), todayCount: t.length, monthInPaise: total(m, "in"), monthOutPaise: total(m, "out") };
      });

      const trend: HotelDashboardDto["trend"] = [];
      for (let d = trendStart; d <= today; d = addDays(d, 1)) {
        const rows = between(d, d);
        trend.push({ date: d, inPaise: total(rows, "in"), outPaise: total(rows, "out") });
      }

      // what this month's money out went on: six rows at most, the rest folded into one so the rows still add up
      const out = monthRows.filter((m) => m.direction === "out");
      const byHead = new Map<string, { head: string; totalPaise: number; count: number }>();
      for (const m of out) {
        const head = m.head ?? "Unsorted";
        const h = byHead.get(head) ?? { head, totalPaise: 0, count: 0 };
        h.totalPaise += num(m.amountPaise);
        h.count += 1;
        byHead.set(head, h);
      }
      let heads = [...byHead.values()].sort((a, b) => b.totalPaise - a.totalPaise || a.head.localeCompare(b.head));
      if (heads.length > 6) {
        const rest = heads.slice(5);
        heads = [...heads.slice(0, 5), { head: `${rest.length} other heads`, totalPaise: rest.reduce((a, h) => a + h.totalPaise, 0), count: rest.reduce((a, h) => a + h.count, 0) }];
      }

      const p = raw.payroll;
      const payroll = p && {
        activeStaff: p.activeStaff,
        joinedThisMonth: p.joinedThisMonth,
        openCount: p.openCount,
        openAmountPaise: num(p.openAmountPaise),
        openSince: p.openSince,
        advancesPaise: num(p.advancesPaise),
        advanceCount: p.advanceCount,
        paidPaise: num(p.paidPaise),
        paidCount: p.paidCount,
      };
      const h = raw.handovers;
      const attention: HotelDashboardDto["attention"] = [];
      if (h.todayCount === 0) attention.push({ id: "handover", tone: "warning", text: "No shift handover recorded today", action: "Record handover", viewId: "hotel.cash.handover" });
      if (payroll && payroll.openCount > 0) {
        attention.push({ id: "salary", tone: "warning", text: `${payroll.openCount} salary ${payroll.openCount === 1 ? "payment is" : "payments are"} still open, ${formatINR(payroll.openAmountPaise)} to pay`, action: "Salary payments", viewId: "hotel.payroll.salaryPayments" });
      }
      if (todayRows.length === 0) attention.push({ id: "entries", tone: "info", text: "Nothing entered in either cash book today", action: "Open revenue", viewId: "hotel.cash.revenue" });

      return {
        today,
        month: today.slice(0, 7),
        lastMonth: lastMonthStart.slice(0, 7),
        arrivalsToday: raw.arrivalsToday,
        frontDesk: raw.frontDesk,
        handovers: { today: h.todayCount, todayCashPaise: num(h.todayCashPaise), month: h.monthCount, latest: h.latest ? { shift: h.latest.shift, at: `${h.latest.date}T${h.latest.time}:00+05:30`, by: (h.latest.userId && names.get(h.latest.userId)) || h.latest.byName } : null },
        day: { inPaise: total(todayRows, "in"), outPaise: total(todayRows, "out"), count: todayRows.length, yesterdayInPaise: total(between(yesterday, yesterday), "in") },
        monthToDate: { inPaise: total(monthRows, "in"), outPaise: total(monthRows, "out"), lastInPaise: total(lastMonthRows, "in"), lastOutPaise: total(lastMonthRows, "out") },
        books,
        trend,
        spending: { totalPaise: out.reduce((a, m) => a + num(m.amountPaise), 0), heads },
        recent: raw.recent.map((m) => entry(m, names)),
        payroll,
        attention,
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
