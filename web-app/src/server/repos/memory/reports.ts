import "server-only";
import type { Paise } from "../../money/paise";
import type { CashMovement, HandoverFigures, PayrollFigures, ReportsRepos, ReportsUnit, SheetLine, StayBillRow, FrontDeskFigures, GstBillRow, NightFigures } from "../reports";

// The in-memory double of the report reads: plain arrays the test fills, read back the way the PostgreSQL side reads the tables (a line is dated in the window,
// the opening is the cash lines before the day, the stay bills are the ones dated in the window). Nothing here knows a money rule; the services do.
interface ReportsData {
  lines: SheetLine[];
  stayBills: StayBillRow[];
  movements: CashMovement[];
  handovers: HandoverFigures;
  payroll: PayrollFigures;
  rates: { plan: string; effectiveFrom: string; ratePaise: Paise }[];
  /** Check-in date → confirmed reservations arriving that day. */
  arrivals: Map<string, number>;
  /** The rest of the front desk's day (the dashboard's row); a test sets what it needs. */
  frontDeskFigures: Omit<FrontDeskFigures, "arrivals">;
  openGuestRequests: number;
  /** The occupancy report's nights (a test sets the nights it needs; the rest answer zeros) and the rooms in service. */
  nights: Map<string, Omit<NightFigures, "date">>;
  roomCount: number;
  /** The live bills the GST summary reads. */
  gstBills: GstBillRow[];
}

const emptyReportsData = (): ReportsData => ({
  lines: [],
  stayBills: [],
  movements: [],
  handovers: { todayCount: 0, todayCashPaise: BigInt(0), monthCount: 0, latest: null },
  payroll: { activeStaff: 0, joinedThisMonth: 0, openCount: 0, openAmountPaise: BigInt(0), openSince: null, advancesPaise: BigInt(0), advanceCount: 0, paidPaise: BigInt(0), paidCount: 0 },
  rates: [],
  arrivals: new Map(),
  frontDeskFigures: { departures: 0, inHouse: 0, roomsToClean: 0, roomsReady: 0 },
  openGuestRequests: 0,
  nights: new Map(),
  roomCount: 0,
  gstBills: [],
});

const newestFirst = (a: CashMovement, b: CashMovement): number => (a.date + a.time + a.id < b.date + b.time + b.id ? 1 : -1);

/** The next calendar day of an ISO date (UTC arithmetic on a date-only string). */
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function bindReports(data: ReportsData): ReportsRepos {
  return {
    daySheet: {
      lines: async ({ from, to }) => data.lines.filter((l) => (from === null || l.date >= from) && l.date <= to),
      cashNetBefore: async (day) => data.lines.filter((l) => l.date < day && (l.mode ?? "").trim().toLowerCase() === "cash").reduce((net, l) => (l.direction === "in" ? net + l.amountPaise : net - l.amountPaise), BigInt(0)),
    },
    foodPlan: {
      stayBills: async ({ billDateFrom, billDateTo, mealPlans }) =>
        data.stayBills.filter(
          (b) => b.billDate >= billDateFrom && b.billDate <= billDateTo && (!mealPlans || (b.stay && b.stay.length > 0) || mealPlans.includes((b.hotelPlan ?? "").toLowerCase())),
        ),
    },
    overview: {
      movements: async ({ from, to }) => data.movements.filter((m) => m.date >= from && m.date <= to),
      movementCount: async ({ from, to }) => data.movements.filter((m) => m.date >= from && m.date <= to).length,
      recent: async (limit) => [...data.movements].sort(newestFirst).slice(0, limit),
      handovers: async () => data.handovers,
      payroll: async () => data.payroll,
    },
    mealPlanRates: { table: async () => [...data.rates].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)) },
    reservations: { arrivalsToday: async (date) => data.arrivals.get(date) ?? 0 },
    frontDesk: { today: async (date) => ({ arrivals: data.arrivals.get(date) ?? 0, ...data.frontDeskFigures }), openGuestRequests: async () => data.openGuestRequests },
    occupancy: {
      nights: async (from, to) => {
        const out: NightFigures[] = [];
        for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, ...(data.nights.get(d) ?? { roomsSold: 0, roomRevenuePaise: BigInt(0), arrivals: 0, departures: 0 }) });
        return out;
      },
      roomCount: async () => data.roomCount,
    },
    gst: { bills: async (from, to) => data.gstBills.filter((b) => b.billDate >= from && b.billDate <= to) },
  };
}

export function createMemoryReports(): { unit: ReportsUnit; data: ReportsData } {
  const data = emptyReportsData();
  return { data, unit: { run: (_session, work) => work(bindReports(data)) } };
}
