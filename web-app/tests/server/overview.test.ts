// Overview: the Daily Report, the Food Plan Report and the Hotel dashboard (GET /api/v1/reports/daily, /reports/food-plan, /overview/dashboard) through the
// REAL route files and the wrapper, on the in-memory double of the report reads. The figures are worked by hand from Pallav's DailySheet / FoodPlanMonth /
// DashboardController arithmetic (docs/specs/overview.md): which column a line sits in, the opening balance from the beginning of time less every earlier
// night's plan meals, the rate in force each night, a stay split between two months, the 30-day trend. Spec: docs/specs/overview.md.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as dashboardGet } from "../../src/app/api/v1/overview/dashboard/route";
import { GET as dailyGet } from "../../src/app/api/v1/reports/daily/route";
import { GET as dailyPdfGet } from "../../src/app/api/v1/reports/daily/pdf/route";
import { GET as foodPlanPdfGet } from "../../src/app/api/v1/reports/food-plan/pdf/route";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { GET as foodPlanGet } from "../../src/app/api/v1/reports/food-plan/route";
import { GET as occupancyGet } from "../../src/app/api/v1/reports/occupancy/route";
import { GET as attentionGet } from "../../src/app/api/v1/overview/attention/route";
import { GET as occupancyCsvGet } from "../../src/app/api/v1/reports/occupancy/csv/route";
import { GET as gstGet } from "../../src/app/api/v1/reports/gst/route";
import { GET as gstCsvGet } from "../../src/app/api/v1/reports/gst/csv/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildOverviewServices, configureOverview } from "../../src/server/compose/overview";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryReports } from "../../src/server/repos/memory/reports";
import type { CashMovement, SheetLine, StayBillRow } from "../../src/server/repos/reports";
import { catalog, grant, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>();
sessions.set("reader", makeSession({ userId: "00000000-0000-4000-8000-000000000001", accountRole: "hotel_admin", client: "web", grants: [grant("reports", "view"), grant("dashboard", "view")] }));
// a Hotel User holding every grant the Hotel Admin above has, the payroll one included: still no payroll on Overview (MJ, 5 Nov 2026)
sessions.set("staff", makeSession({ userId: "00000000-0000-4000-8000-000000000006", accountRole: "hotel_user", client: "web", grants: [grant("reports", "view"), grant("dashboard", "view"), grant("handover", "view"), grant("revenue", "view"), grant("payroll", "full")] }));
sessions.set("reportsOnly", makeSession({ userId: "00000000-0000-4000-8000-000000000002", client: "web", grants: [grant("reports", "view")] }));
sessions.set("desk", makeSession({ userId: "00000000-0000-4000-8000-000000000003", client: "web", grants: [grant("dashboard", "view"), grant("pms.stays", "view")] }));
sessions.set("cashier", makeSession({ userId: "00000000-0000-4000-8000-000000000004", accountRole: "hotel_admin", client: "web", grants: [grant("dashboard", "view"), grant("handover", "view"), grant("revenue", "view"), grant("payroll", "view")] }));
sessions.set("dashOnly", makeSession({ userId: "00000000-0000-4000-8000-000000000005", client: "web", grants: [grant("dashboard", "view")] }));
sessions.set("nobody", makeSession({ userId: "00000000-0000-4000-8000-000000000003", client: "web" }));

const P = (n: number): bigint => BigInt(n);
const PERSON = "00000000-0000-4000-8000-0000000000aa";
let clock = new Date("2026-10-09T10:00:00+05:30");
let reports: ReturnType<typeof createMemoryReports>;

let n = 0;
const line = (over: Partial<SheetLine> & Pick<SheetLine, "kind" | "date" | "direction" | "mode">): SheetLine => ({ id: `l${++n}`, ref: null, room: null, particulars: "Guest", note: null, amountPaise: P(0), party: null, unit: "hotel", fromAdvancePaise: P(0), ...over });
const stay = (over: Partial<StayBillRow>): StayBillRow => ({ id: "b", billNumber: "2026 / 1", billDate: "2026-10-08", roomNumber: "1", guestName: "Guest", companyName: null, persons: 1, hotelPlan: "CP", arrivalDate: null, departureDate: null, stay: null, ...over });
const move = (over: Partial<CashMovement> & Pick<CashMovement, "date" | "direction" | "amountPaise">): CashMovement => ({ id: `m${++n}`, unit: "hotel", kind: over.direction === "in" ? "Deposit" : "Expense", head: over.direction === "in" ? null : "Laundry", who: "x", entryNo: `E-${n}`, userId: null, byName: "Rakesh", time: "10:30", ...over });

beforeEach(() => {
  clock = new Date("2026-10-09T10:00:00+05:30");
  reports = createMemoryReports();
  const d = reports.data;
  d.rates = [
    { plan: "CP", effectiveFrom: "2026-01-01", ratePaise: P(25000) },
    { plan: "CP", effectiveFrom: "2026-10-10", ratePaise: P(27500) },
    { plan: "MAP", effectiveFrom: "2026-01-01", ratePaise: P(60000) },
  ];
  d.stayBills = [
    // 8-11 Oct for two on CP: the rate changes on 10 Oct (nights 8, 9 at 250; nights 10, 11 at 275)
    stay({ id: "A", billNumber: "2026 / 1188", billDate: "2026-10-12", roomNumber: "204", guestName: "Ravi Mehta", companyName: "Infosys", persons: 2, stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2 }] }),
    // 29 Sep to 2 Oct on MAP, one person: two nights in September, two in October
    stay({ id: "B", billNumber: "2026 / 1190", billDate: "2026-10-03", roomNumber: "101", guestName: "Sita Shah", persons: 1, stay: [{ from: "2026-09-29", to: "2026-10-03", plan: "MAP", persons: 1 }] }),
    // no stay parts: built from arrival, departure and plan, never priced when the plan has no rate
    stay({ id: "C", billNumber: "2026 / 1195", billDate: "2026-10-08", roomNumber: "300", guestName: "No Plan", persons: 1, hotelPlan: "EP", arrivalDate: "2026-10-08", departureDate: "2026-10-10" }),
  ];
  configureOverview(buildOverviewServices(reports.unit, () => clock, { get: async (ids: readonly string[]) => new Map(ids.filter((i) => i === PERSON).map((i) => [i, { id: i, name: "Rakesh Solanki", roleKey: "editor", roleLevel: 2, deleted: false }])) }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const ORIGIN = "https://hms.test";
const req = (path: string, who: string | null): Request => new Request(`${ORIGIN}${path}`, { method: "GET", headers: { host: "hms.test", origin: ORIGIN, ...(who ? { "x-test-session": who } : {}) } });
const ctx = { params: Promise.resolve({}) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response): Promise<any> => (await res.clone().json()) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = async (res: Response): Promise<any> => {
  assert.equal(res.status, 200, JSON.stringify(await json(res)));
  return (await json(res)).data;
};
const daily = (q = "", who = "reader") => dailyGet(req(`/api/v1/reports/daily${q}`, who), ctx);
const foodPlan = (q = "", who = "reader") => foodPlanGet(req(`/api/v1/reports/food-plan${q}`, who), ctx);

describe("the Food Plan Report", () => {
  test("prices every night at the rate in force that night, per person, and splits a stay across the months", async () => {
    const r = await ok(await foodPlan("?month=2026-10"));
    assert.deepEqual(r.rows.map((x: { bill: string }) => x.bill), ["1190", "1188"], "by first night in the month");
    const sita = r.rows[0];
    assert.deepEqual([sita.nightCount, sita.personNights, sita.amountPaise, sita.outside, sita.plans], [2, 2, 120000, 2, ["MAP"]]);
    assert.deepEqual(sita.parts, [{ from: "2026-10-01", to: "2026-10-02", plan: "MAP", persons: 1, ratePaise: 60000, nights: 2, amountPaise: 120000 }]);
    const ravi = r.rows[1];
    assert.deepEqual([ravi.nightCount, ravi.personNights, ravi.amountPaise, ravi.ratesPaise, ravi.company], [4, 8, 210000, [25000, 27500], "Infosys"]);
    assert.deepEqual(ravi.parts.map((p: { from: string; to: string; ratePaise: number; nights: number; amountPaise: number }) => [p.from, p.to, p.ratePaise, p.nights, p.amountPaise]), [["2026-10-08", "2026-10-09", 25000, 2, 100000], ["2026-10-10", "2026-10-11", 27500, 2, 110000]]);
    assert.deepEqual(r.totals, { guests: 2, nights: 6, personNights: 10, amountPaise: 330000 }, "a guest on a plan without a rate is not a row");
    assert.deepEqual(r.byPlan, [{ plan: "CP", personNights: 8, ratesPaise: [25000, 27500], amountPaise: 210000 }, { plan: "MAP", personNights: 2, ratesPaise: [60000], amountPaise: 120000 }]);
    assert.deepEqual(r.plans, ["CP", "MAP"], "only plans that carry a rate");
  });

  test("the other month gets the other nights; a plan filter keeps the guests who had that plan", async () => {
    const sept = await ok(await foodPlan("?month=2026-09"));
    assert.deepEqual(sept.rows.map((x: { bill: string; nightCount: number; amountPaise: number; outside: number }) => [x.bill, x.nightCount, x.amountPaise, x.outside]), [["1190", 2, 120000, 2]]);
    const map = await ok(await foodPlan("?month=2026-10&plan=map"));
    assert.deepEqual(map.rows.map((x: { bill: string }) => x.bill), ["1190"]);
    assert.equal(map.plan, "map");
  });

  test("needs the reports screen; a bad month is refused", async () => {
    assert.equal((await foodPlan("", "nobody")).status, 403);
    assert.equal((await foodPlan("", "nobody")).status === 403, true);
    assert.equal((await foodPlanGet(req("/api/v1/reports/food-plan?month=2026-13", "reader"), ctx)).status, 422);
    assert.equal((await foodPlanGet(req("/api/v1/reports/food-plan?month=2026-10&x=1", "reader"), ctx)).status, 422);
  });
});

describe("the Daily Report", () => {
  beforeEach(() => {
    const d = reports.data;
    // before the day: only CASH lines open the drawer
    d.lines.push(
      line({ kind: "Collection", date: "2026-10-07", direction: "in", mode: "Cash", amountPaise: P(1_000_000) }),
      line({ kind: "Expense", date: "2026-10-07", direction: "out", mode: " CASH ", amountPaise: P(200_000) }),
      line({ kind: "Advance", date: "2026-10-07", direction: "in", mode: "UPI", amountPaise: P(999_999) }),
      // the day itself
      line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: "Cash", amountPaise: P(400_000), room: "204", ref: "1660", particulars: "Ravi Mehta" }),
      line({ kind: "Advance", date: "2026-10-09", direction: "in", mode: "UPI", amountPaise: P(500_000), room: "9", ref: "814" }),
      line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: "Debit", amountPaise: P(126_000), room: "10", ref: "1661", party: "Infosys", unit: "food" }),
      line({ kind: "Refund", date: "2026-10-09", direction: "out", mode: "Cash", amountPaise: P(30_000), room: "101", ref: "810" }),
      line({ kind: "Collection", date: "2026-10-09", direction: "in", mode: "Cash", amountPaise: P(20_000), ref: "#12" }),
      line({ kind: "Expense", date: "2026-10-09", direction: "out", mode: "Cash", amountPaise: P(15_000), ref: "#33" }),
      line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: "Complimentary", amountPaise: P(0), room: "305", ref: "1662", fromAdvancePaise: P(5_000) }),
      line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: null, amountPaise: P(0), room: "306", ref: "1663" }),
      line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: null, amountPaise: P(1_000), room: "307", ref: "1664" }),
      line({ kind: "Bill", date: "2026-10-10", direction: "in", mode: "Cash", amountPaise: P(77_777), ref: "tomorrow" }),
    );
  });

  test("sorts the day's lines into the sheet's columns and closes on the two figures", async () => {
    const r = await ok(await daily("?date=2026-10-09"));
    assert.equal(r.date, "2026-10-09");
    assert.deepEqual(r.cashIn.map((l: { ref: string }) => l.ref), ["#12", "1660", "1663"], "no room first, then room order; a line that came to nothing sits with the cash");
    assert.deepEqual(r.cashOut.map((l: { ref: string }) => l.ref), ["#33", "810"]);
    assert.deepEqual(r.banked.map((l: { ref: string; mode: string }) => [l.ref, l.mode]), [["814", "UPI"], ["1664", "Not set"]], "UPI, and a settled amount with no mode, are banked");
    assert.deepEqual(r.debit.map((l: { ref: string; party: string }) => [l.ref, l.party]), [["1661", "Infosys"]]);
    assert.deepEqual(r.complimentary.map((l: { fromAdvancePaise: number }) => l.fromAdvancePaise), [5000]);
  });

  test("the opening is every earlier cash line less every earlier night's plan meals; nothing else moves it", async () => {
    const t = (await ok(await daily("?date=2026-10-09"))).totals;
    // cash 1,000,000 in - 200,000 out = 800,000; plan meals before 9 Oct: 29-30 Sep and 1-2 Oct MAP (240,000) + 8 Oct CP for two (50,000) = 290,000
    assert.equal(t.openingPaise, 510_000);
    assert.deepEqual([t.cashInPaise, t.cashOutPaise, t.cashOnHandPaise], [420_000, 45_000, 930_000]);
    assert.equal(t.foodPlanPaise, 50_000, "tonight: 9 Oct, CP for two at 250");
    assert.equal(t.carryForwardPaise, 510_000 + 420_000 - 45_000 - 50_000);
    assert.deepEqual([t.bankedInPaise, t.bankedOutPaise, t.debitPaise, t.complimentaryPaise], [501_000, 0, 126_000, 0]);
    assert.equal(t.revenuePaise, 420_000 + 501_000 + 126_000, "cash in + online + on credit");
    assert.equal(t.paidOutPaise, 45_000 + 50_000, "cash out + the food plan");
    assert.equal(t.netPaise, 1_047_000 - 95_000);
    assert.equal(t.cashPaidTotalPaise, 95_000);
    assert.equal(t.entries, 9);
  });

  test("tonight's plan meals are listed with the guest and the rate", async () => {
    const r = await ok(await daily("?date=2026-10-09"));
    assert.deepEqual(r.foodPlan.map((f: { room: string; bill: string; guest: string; plan: string; persons: number; ratePaise: number; amountPaise: number }) => [f.room, f.bill, f.guest, f.plan, f.persons, f.ratePaise, f.amountPaise]), [["204", "1188", "Ravi Mehta", "CP", 2, 25000, 50000]]);
  });

  test("the next day opens with what this day carried forward", async () => {
    const today = (await ok(await daily("?date=2026-10-09"))).totals;
    const next = (await ok(await daily("?date=2026-10-10"))).totals;
    // 10 Oct has its own bill line of 77,777 cash in but the opening only counts lines BEFORE the day, and 9 Oct's night is paid out of the drawer too
    assert.equal(next.openingPaise, today.carryForwardPaise);
  });

  test("defaults to today; a bad date is refused; needs the reports screen", async () => {
    assert.equal((await ok(await daily(""))).date, "2026-10-09");
    assert.equal((await daily("?date=2026-02-30")).status, 422);
    assert.equal((await dailyGet(req("/api/v1/reports/daily?date=yesterday", "reader"), ctx)).status, 422);
    assert.equal((await daily("", "nobody")).status, 403);
    assert.equal((await dailyGet(req("/api/v1/reports/daily", null), ctx)).status, 401);
  });

  test("the cash the accounting year carries in is the opening on its first day (what the books show)", async () => {
    const { getReports } = await import("../../src/server/compose/overview");
    assert.equal(await getReports().openingCash({ hotelId: "h", userId: "u" }, "2026-10-09"), 510_000);
    assert.equal(await getReports().openingCash({ hotelId: "h", userId: "u" }, "2026-04-01"), 0, "nothing before the beginning of the books");
  });
});

describe("the report PDFs", () => {
  // a generous deadline: these prove WHAT is printed, never how fast
  const renderer = createDocumentRenderer({ timeoutMs: 90_000 });
  beforeEach(() => configureDocumentRenderer(renderer));

  test("the Daily Report prints the figures of the screen and the Food Plan Report prints its guests", async () => {
    reports.data.lines.push(line({ kind: "Bill", date: "2026-10-09", direction: "in", mode: "Cash", amountPaise: P(400_000), room: "204", ref: "1660", particulars: "Ravi Mehta" }));
    const day = await dailyPdfGet(req("/api/v1/reports/daily/pdf?date=2026-10-09", "reader"), ctx);
    assert.equal(day.status, 200);
    assert.deepEqual([day.headers.get("content-type"), day.headers.get("cache-control"), day.headers.get("content-disposition")], ["application/pdf", "no-store", 'inline; filename="daily-report-2026-10-09.pdf"']);
    assert.equal(Buffer.from(new Uint8Array(await day.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
    const { getReports } = await import("../../src/server/compose/overview");
    const sheet = (await renderer.render("payrollDoc", await getReports().dailyDocument(sessions.get("reader")!, "2026-10-09"))).text.join("|");
    for (const must of ["Daily report", "09 Oct 2026", "Ravi Mehta", "Cash carried forward", "Plan meals for tonight"]) assert.ok(sheet.includes(must), `missing: ${must}`);
    const food = await foodPlanPdfGet(req("/api/v1/reports/food-plan/pdf?month=2026-10", "reader"), ctx);
    assert.equal(food.status, 200);
    assert.equal(food.headers.get("content-disposition"), 'inline; filename="food-plan-2026-10.pdf"');
    const plan = (await renderer.render("payrollDoc", await getReports().foodPlanDocument(sessions.get("reader")!, "2026-10", undefined))).text.join("|");
    for (const must of ["Food plan report", "Ravi Mehta", "Sita Shah", "Owed to the food business for the month"]) assert.ok(plan.includes(must), `missing: ${must}`);
  });

  test("need the reports screen; a bad date is refused", async () => {
    assert.equal((await dailyPdfGet(req("/api/v1/reports/daily/pdf", "nobody"), ctx)).status, 403);
    assert.equal((await dailyPdfGet(req("/api/v1/reports/daily/pdf", null), ctx)).status, 401);
    assert.equal((await dailyPdfGet(req("/api/v1/reports/daily/pdf?date=2026-02-30", "reader"), ctx)).status, 422);
    assert.equal((await foodPlanPdfGet(req("/api/v1/reports/food-plan/pdf?month=2026-13", "reader"), ctx)).status, 422);
  });
});

describe("the Hotel dashboard", () => {
  beforeEach(() => {
    const d = reports.data;
    d.movements.push(
      move({ date: "2026-10-09", direction: "in", amountPaise: P(500_000), unit: "hotel", who: "Room 204" }),
      move({ date: "2026-10-09", direction: "out", amountPaise: P(120_000), head: "Laundry" }),
      move({ date: "2026-10-09", direction: "in", amountPaise: P(300_000), unit: "food" }),
      move({ date: "2026-10-08", direction: "in", amountPaise: P(400_000) }),
      move({ date: "2026-10-02", direction: "out", amountPaise: P(50_000), head: "Repairs" }),
      move({ date: "2026-09-09", direction: "in", amountPaise: P(200_000) }),
      move({ date: "2026-09-09", direction: "out", amountPaise: P(50_000), head: "Laundry" }),
      move({ date: "2026-09-20", direction: "in", amountPaise: P(999_000) }),
    );
    d.payroll = { activeStaff: 38, joinedThisMonth: 2, openCount: 3, openAmountPaise: P(6_145_000), openSince: "2026-08", advancesPaise: P(100_000), advanceCount: 2, paidPaise: P(4_823_000), paidCount: 35 };
    d.arrivals.set("2026-10-09", 4);
    d.frontDeskFigures = { departures: 2, inHouse: 13, roomsToClean: 3, roomsReady: 7 };
  });

  test("today, the month against last month to the same day, the books, the trend and the spending", async () => {
    const raw = await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx);
    assert.deepEqual([raw.headers.get("cache-control"), raw.headers.has("etag")], ["private, no-cache", true], "an ETag answer: the shell's re-reads can be 304s (API audit B22)");
    assert.equal((await attentionGet(req("/api/v1/overview/attention", "reader"), ctx)).headers.get("cache-control"), "private, no-cache", "the bell's poll too");
    const r = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.deepEqual([r.today, r.month, r.lastMonth, r.arrivalsToday], ["2026-10-09", "2026-10", "2026-09", 4]);
    assert.equal(r.frontDesk, null, "no Front Office grant: no front desk row");
    const desk = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "desk"), ctx));
    assert.deepEqual(desk.frontDesk, { arrivals: 4, departures: 2, inHouse: 13, roomsToClean: 3, roomsReady: 7 }, "the front desk row, for a person with the Front Office");
    assert.deepEqual(r.day, { inPaise: 800_000, outPaise: 120_000, count: 3, yesterdayInPaise: 400_000 });
    assert.deepEqual(r.monthToDate, { inPaise: 1_200_000, outPaise: 170_000, lastInPaise: 200_000, lastOutPaise: 50_000 }, "last month only up to 9 Sep");
    assert.deepEqual(r.books.map((b: { unit: string; todayInPaise: number; todayOutPaise: number; todayCount: number; monthInPaise: number }) => [b.unit, b.todayInPaise, b.todayOutPaise, b.todayCount, b.monthInPaise]), [["hotel", 500_000, 120_000, 2, 900_000], ["food", 300_000, 0, 1, 300_000]]);
    assert.equal(r.trend.length, 30);
    assert.deepEqual([r.trend[0].date, r.trend[29].date, r.trend[29].inPaise, r.trend[28].inPaise], ["2026-09-10", "2026-10-09", 800_000, 400_000]);
    assert.deepEqual(r.spending, { totalPaise: 170_000, heads: [{ head: "Laundry", totalPaise: 120_000, count: 1 }, { head: "Repairs", totalPaise: 50_000, count: 1 }] });
  });

  test("more than six heads fold into one so the rows still add up", async () => {
    for (const [i, head] of ["A", "B", "C", "D", "E", "F", "G"].entries()) reports.data.movements.push(move({ date: "2026-10-05", direction: "out", amountPaise: P(10_000 + i), head }));
    const r = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.equal(r.spending.heads.length, 6);
    assert.equal(r.spending.heads[5].head, "4 other heads");
    assert.equal(r.spending.heads.reduce((a: number, h: { totalPaise: number }) => a + h.totalPaise, 0), r.spending.totalPaise);
  });

  test("what needs attention: no handover, open salaries, nothing entered", async () => {
    let r = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.deepEqual(r.attention.map((a: { id: string }) => a.id), ["handover", "salary"]);
    assert.match(r.attention[1].text, /^3 salary payments are still open, .*61,450\.00.* to pay$/);
    reports.data.handovers = { todayCount: 2, todayCashPaise: P(2_345_000), monthCount: 20, latest: { shift: "Morning", date: "2026-10-09", time: "15:04", userId: PERSON, byName: "rakesh (snapshot)" } };
    reports.data.payroll.openCount = 0;
    reports.data.movements = [];
    r = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.deepEqual(r.attention.map((a: { id: string }) => a.id), ["entries"]);
    assert.deepEqual(r.handovers, { today: 2, todayCashPaise: 2_345_000, month: 20, latest: { shift: "Morning", at: "2026-10-09T15:04:00+05:30", by: "Rakesh Solanki" } });
  });

  test("a Hotel User gets no payroll figure and no salary item, even holding the payroll grant; the Hotel Admin keeps both", async () => {
    const admin = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.equal(admin.payroll.openCount, 3);
    assert.ok(admin.attention.some((a: { id: string }) => a.id === "salary"));
    const raw = await dashboardGet(req("/api/v1/overview/dashboard", "staff"), ctx);
    const staff = await ok(raw);
    assert.equal(staff.payroll, null);
    assert.deepEqual(staff.attention.map((a: { id: string }) => a.id), ["handover"]);
    const body = await raw.clone().text();
    for (const leak of ["61450", "6145000", "salary", "openAmountPaise", "activeStaff"]) assert.ok(!body.includes(leak), `the answer carries no ${leak}`);
    assert.deepEqual(staff.day, admin.day, "the rest of the page is the same");
    const bell = await ok(await attentionGet(req("/api/v1/overview/attention", "staff"), ctx));
    assert.deepEqual(bell.items.map((i: { id: string }) => i.id), ["handover"], "the bell has no salary item for a Hotel User");
    const adminBell = await ok(await attentionGet(req("/api/v1/overview/attention", "cashier"), ctx));
    assert.deepEqual(adminBell.items.map((i: { id: string }) => i.id), ["handover", "salary"]);
  });

  test("the newest entries and the dashboard permission", async () => {
    const r = await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx));
    assert.equal(r.recent.length, 7);
    assert.equal(r.recent[0].by, "Rakesh", "a recorder the people directory cannot find shows the name written on the row");
    reports.data.movements[7] = { ...reports.data.movements[7], userId: PERSON, date: "2026-10-09", time: "23:59" };
    assert.equal((await ok(await dashboardGet(req("/api/v1/overview/dashboard", "reader"), ctx))).recent[0].by, "Rakesh Solanki", "the display name wins when it is found");
    assert.ok(r.recent[0].at.startsWith("2026-10-09"));
    assert.equal((await dashboardGet(req("/api/v1/overview/dashboard", "reportsOnly"), ctx)).status, 403);
    assert.equal((await dashboardGet(req("/api/v1/overview/dashboard", null), ctx)).status, 401);
  });
});

describe("the GST summary", () => {
  beforeEach(() => {
    const row = (n: number, over: Record<string, unknown>) => ({
      id: `b${n}`, billDate: "2026-10-01", billNumber: `2026 / ${n}`, guestName: `Guest ${n}`, guestGstin: null, companyName: null,
      totalHotelAmountPaise: P(112_000), hotelGstPaise: P(12_000), hotelGstPercent: "12", totalFoodAmountPaise: P(0), foodGstPaise: P(0), foodGstPercent: null, ...over,
    });
    reports.data.gstBills = [
      row(2, { billDate: "2026-10-03", totalFoodAmountPaise: P(10_500), foodGstPaise: P(500), foodGstPercent: "5" }) as never,
      row(1, { guestGstin: " 24aaaci1681g1zl ", companyName: "Infosys Rajkot" }) as never,
      row(3, { billDate: "2026-09-30" }) as never,
      row(4, { billDate: "2026-11-01" }) as never,
    ];
  });

  test("this month: every live bill dated in it, taxable = total less GST per business, B2B (a GSTIN) and B2C totals, oldest first; needs the reports screen", async () => {
    const r = await ok(await gstGet(req("/api/v1/reports/gst", "reader"), ctx));
    assert.equal(r.month, "2026-10");
    assert.deepEqual(r.bills.map((b: { billNumber: string }) => b.billNumber), ["2026 / 1", "2026 / 2"]);
    assert.deepEqual(r.bills[0], { id: "b1", date: "2026-10-01", billNumber: "2026 / 1", guest: "Guest 1", gstin: "24AAACI1681G1ZL", company: "Infosys Rajkot", hotelTaxablePaise: 100_000, hotelGstPaise: 12_000, hotelGstPercent: "12", foodTaxablePaise: 0, foodGstPaise: 0, foodGstPercent: null, totalPaise: 112_000 });
    assert.deepEqual(r.totals, {
      bills: 2, taxablePaise: 210_000, gstPaise: 24_500, totalPaise: 234_500,
      b2b: { bills: 1, taxablePaise: 100_000, gstPaise: 12_000, totalPaise: 112_000 },
      b2c: { bills: 1, taxablePaise: 110_000, gstPaise: 12_500, totalPaise: 122_500 },
      hotel: { bills: 2, taxablePaise: 200_000, gstPaise: 24_000, totalPaise: 224_000 },
      food: { bills: 1, taxablePaise: 10_000, gstPaise: 500, totalPaise: 10_500 },
    });
    assert.deepEqual((await ok(await gstGet(req("/api/v1/reports/gst?month=2026-09", "reader"), ctx))).bills.map((b: { id: string }) => b.id), ["b3"]);
    assert.equal((await gstGet(req("/api/v1/reports/gst?month=2026-13", "reader"), ctx)).status, 422);
    assert.equal((await gstGet(req("/api/v1/reports/gst", "nobody"), ctx)).status, 403);
  });

  test("the CSV: one line per bill and business in GSTR-1 order, then B2B, B2C and grand totals", async () => {
    const res = await gstCsvGet(req("/api/v1/reports/gst/csv?month=2026-10", "reader"), ctx);
    assert.deepEqual([res.status, res.headers.get("content-type"), res.headers.get("content-disposition")], [200, "text/csv; charset=utf-8", 'attachment; filename="gst-2026-10.csv"']);
    const lines = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).subarray(3)).trim().split("\r\n");
    assert.deepEqual(lines, [
      '"Invoice date","Invoice number","Receiver name","GSTIN/UIN of recipient","Type","Business","Rate (%)","Taxable value (Rs)","GST (Rs)","Invoice value (Rs)"',
      '"2026-10-01","2026 / 1","Infosys Rajkot","24AAACI1681G1ZL","B2B","Hotel","12","1000.00","120.00","1120.00"',
      '"2026-10-03","2026 / 2","Guest 2",,"B2C","Hotel","12","1000.00","120.00","1225.00"',
      '"2026-10-03","2026 / 2","Guest 2",,"B2C","Food","5","100.00","5.00","1225.00"',
      ',"B2B total",,,"B2B",,,"1000.00","120.00","1120.00"',
      ',"B2C total",,,"B2C",,,"1100.00","125.00","1225.00"',
      ',"Total",,,,,,"2100.00","245.00","2345.00"',
    ]);
  });
});

describe("the occupancy report", () => {
  beforeEach(() => {
    const d = reports.data;
    d.roomCount = 20;
    d.nights.set("2026-10-01", { roomsSold: 10, roomRevenuePaise: P(2_500_000), arrivals: 10, departures: 0 });
    d.nights.set("2026-10-02", { roomsSold: 15, roomRevenuePaise: P(4_200_000), arrivals: 5, departures: 0 });
    d.nights.set("2026-10-09", { roomsSold: 20, roomRevenuePaise: P(6_000_000), arrivals: 8, departures: 3 });
  });

  test("this month up to today: a row per night (zeros where nothing happened), occupancy %, ADR and RevPAR; a future month is empty; needs the reports screen", async () => {
    const r = await ok(await occupancyGet(req("/api/v1/reports/occupancy", "reader"), ctx));
    assert.deepEqual([r.month, r.rooms, r.days.length, r.days[0].date, r.days[8].date], ["2026-10", 20, 9, "2026-10-01", "2026-10-09"]);
    assert.deepEqual(r.days[1], { date: "2026-10-02", roomsSold: 15, roomRevenuePaise: 4_200_000, arrivals: 5, departures: 0, occupancyPct: 75 });
    assert.deepEqual(r.days[2], { date: "2026-10-03", roomsSold: 0, roomRevenuePaise: 0, arrivals: 0, departures: 0, occupancyPct: 0 });
    // 45 sold of 180 room nights = 25%; 1,27,00,000 / 45 = 2,82,222 ADR; / 180 = 70,556 RevPAR
    assert.deepEqual(r.totals, { nights: 9, roomNights: 180, roomsSold: 45, roomRevenuePaise: 12_700_000, occupancyPct: 25, adrPaise: 282_222, revParPaise: 70_556, arrivals: 23, departures: 3 });
    const future = await ok(await occupancyGet(req("/api/v1/reports/occupancy?month=2027-01", "reader"), ctx));
    assert.deepEqual([future.days.length, future.totals.roomsSold, future.rooms], [0, 0, 0]);
    assert.equal((await occupancyGet(req("/api/v1/reports/occupancy?month=2026-13", "reader"), ctx)).status, 422);
    assert.equal((await occupancyGet(req("/api/v1/reports/occupancy", "nobody"), ctx)).status, 403);
  });

  test("the CSV: a header, one line per night, a totals line and RevPAR, as an attachment", async () => {
    const res = await occupancyCsvGet(req("/api/v1/reports/occupancy/csv?month=2026-10", "reader"), ctx);
    assert.deepEqual([res.status, res.headers.get("content-type"), res.headers.get("content-disposition")], [200, "text/csv; charset=utf-8", 'attachment; filename="occupancy-2026-10.csv"']);
    const lines = (await res.text()).replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    assert.equal(lines[0], '"Night","Rooms sold","Rooms in service","Occupancy %","Room revenue (Rs)","ADR (Rs)","Arrivals","Departures"');
    assert.equal(lines[2], '"2026-10-02",15,20,75,"42000.00","2800.00",5,0');
    assert.equal(lines[10], '"Total",45,20,25,"127000.00","2822.22",23,3');
    assert.equal(lines[11], '"RevPAR (Rs)","705.56"');
  });
});

describe("the bell (overview/attention)", () => {
  test("each person sees only the items their grants let them act on; warnings first; nothing for someone with no grants", async () => {
    const d = reports.data;
    d.arrivals.set("2026-10-09", 4);
    d.frontDeskFigures = { departures: 2, inHouse: 13, roomsToClean: 3, roomsReady: 7 };
    d.openGuestRequests = 2;
    d.payroll = { activeStaff: 38, joinedThisMonth: 2, openCount: 3, openAmountPaise: P(6_145_000), openSince: "2026-08", advancesPaise: P(0), advanceCount: 0, paidPaise: P(0), paidCount: 0 };
    const desk = await ok(await attentionGet(req("/api/v1/overview/attention", "desk"), ctx));
    assert.deepEqual(desk.items.map((i: { id: string; tone: string }) => [i.id, i.tone]), [["requests", "warning"], ["departures", "warning"], ["arrivals", "info"], ["rooms", "info"]]);
    assert.match(desk.items[0].text, /2 guest requests are waiting/);
    assert.match(desk.items[1].text, /2 guests are due to leave today/);
    const cashier = await ok(await attentionGet(req("/api/v1/overview/attention", "cashier"), ctx));
    assert.deepEqual(cashier.items.map((i: { id: string }) => i.id), ["handover", "salary", "entries"], "no handover yet today, open salaries, an empty cash book");
    assert.match(cashier.items[1].text, /3 salary payments are still open, ₹61,450\.00 to pay/);
    const dashOnly = await ok(await attentionGet(req("/api/v1/overview/attention", "dashOnly"), ctx));
    assert.deepEqual(dashOnly.items, [], "the dashboard alone: nothing to act on");
    assert.equal((await attentionGet(req("/api/v1/overview/attention", "nobody"), ctx)).status, 403);
    assert.equal((await attentionGet(req("/api/v1/overview/attention", null), ctx)).status, 401);
  });
});
