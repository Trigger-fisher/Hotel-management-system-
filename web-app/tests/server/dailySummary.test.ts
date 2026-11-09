// The owners' daily summary (services/overview/dailySummaryService.ts, /api/v1/cron/daily-summary). What must hold: the addresses of the setting are tidied;
// the summary text carries the day's figures; one pass queues one mail per address for every active hotel that named addresses, through the hotel's own
// mail server (hotel id on the row), at most once a day per hotel; a hotel whose read fails is counted and the others still go; the route needs CRON_SECRET.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { HotelDashboard } from "@shared/dashboards/overview";
import { GET as cronDaily } from "../../src/app/api/v1/cron/daily-summary/route";
import { configureCron } from "../../src/server/compose/cron";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { renderMail, type MailPayload } from "../../src/server/services/auth/mail";
import { createCronService } from "../../src/server/services/cron/cronService";
import { createDailySummaryService, recipientsFrom, summaryText, type DailySummaryCursor } from "../../src/server/services/overview/dailySummaryService";
import { catalog } from "./helpers/session";

const dashboard = (over: Partial<HotelDashboard> = {}): HotelDashboard => ({
  today: "2026-10-13",
  frontDesk: { arrivals: 3, departures: 2, inHouse: 12, roomsToClean: 4, roomsReady: 7 },
  month: "2026-10",
  lastMonth: "2026-09",
  handovers: { today: 2, todayCashPaise: 3_242_800, month: 16, latest: { shift: "Afternoon", at: "2026-10-13T14:10:00+05:30", by: "Ashok Desai" } },
  day: { inPaise: 4_997_000, outPaise: 1_608_000, count: 10, yesterdayInPaise: 680_000 },
  monthToDate: { inPaise: 9_652_050, outPaise: 7_931_000, lastInPaise: 3_300_000, lastOutPaise: 2_100_000 },
  books: [
    { unit: "hotel", name: "Hotel book", todayInPaise: 2_201_000, todayOutPaise: 1_000_000, todayCount: 6, monthInPaise: 0, monthOutPaise: 0 },
    { unit: "food", name: "Food book", todayInPaise: 1_188_000, todayOutPaise: 608_000, todayCount: 4, monthInPaise: 0, monthOutPaise: 0 },
  ],
  trend: [],
  spending: { totalPaise: 0, heads: [] },
  recent: [],
  payroll: { activeStaff: 14, joinedThisMonth: 1, openCount: 3, openAmountPaise: 6_145_000, openSince: "2026-09", advancesPaise: 0, advanceCount: 0, paidPaise: 0, paidCount: 0 },
  attention: [{ id: "salary", tone: "warning", text: "3 salary payments are still open, ₹61,450.00 to pay", action: "Salary payments", viewId: "hotel.payroll.salaryPayments" }],
  ...over,
});

describe("the daily summary", () => {
  test("the addresses: split on commas, semicolons or spaces, lower case, valid only, no doubles, at most ten", () => {
    assert.deepEqual(recipientsFrom(" Owner@Hotel.in, manager@hotel.in;owner@hotel.in not-an-address  x@y.in "), ["owner@hotel.in", "manager@hotel.in", "x@y.in"]);
    assert.deepEqual(recipientsFrom(null), []);
    assert.equal(recipientsFrom(Array.from({ length: 12 }, (_, i) => `p${i}@h.in`).join(",")).length, 10);
  });

  test("the text: front desk, cash today per book, month to date, handovers, staff, what needs attention; no front desk row without the front office", () => {
    const text = summaryText(dashboard());
    for (const must of ["FRONT DESK", "Arrivals 3 | Departures 2 | In house 12 | Rooms to clean 4 | Rooms ready 7", "CASH TODAY", "In ₹49,970.00 | Out ₹16,080.00 | Net ₹33,890.00 (10 entries)", "Hotel book: in ₹22,010.00, out ₹10,000.00", "MONTH TO DATE", "2 handovers today, ₹32,428.00 counted (last: Afternoon by Ashok Desai)", "14 active staff; 3 salary payments open, ₹61,450.00 to pay (since 2026-09)", "NEEDS ATTENTION", "- 3 salary payments are still open"]) {
      assert.ok(text.includes(must), `missing: ${must}\n${text}`);
    }
    const quiet = summaryText(dashboard({ frontDesk: null, handovers: { today: 0, todayCashPaise: 0, month: 0, latest: null }, attention: [], payroll: { ...dashboard().payroll!, openCount: 0 } }));
    assert.ok(!quiet.includes("FRONT DESK") && quiet.includes("No handover recorded today") && quiet.includes("no salary payment open") && quiet.includes("Nothing: all clear."), quiet);
    assert.ok(!summaryText(dashboard({ payroll: null, attention: [] })).includes("STAFF"), "no payroll figures: no staff line");
    // Email Marketing: a Campaigns section only when the hotel sent a campaign today, between the staff line and what needs attention
    assert.ok(!text.includes("CAMPAIGNS"));
    const withCampaign = summaryText(dashboard(), { sent: 1, recipients: 42, delivered: 39, failed: 1, pending: 2 });
    assert.ok(withCampaign.includes("CAMPAIGNS\n1 campaign sent today to 42 addresses: 39 delivered, 1 failed, 2 waiting\n\nNEEDS ATTENTION"), withCampaign);
    assert.ok(!summaryText(dashboard(), { sent: 0, recipients: 0, delivered: 0, failed: 0, pending: 0 }).includes("CAMPAIGNS"));
    const mail = renderMail("daily_summary", { name: "Hotel Sunrise team", hotelName: "Hotel Sunrise", date: "13 Oct 2026", summary: text });
    assert.equal(mail.subject, "Daily summary: Hotel Sunrise, 13 Oct 2026");
    assert.ok(mail.text.startsWith("Hello Hotel Sunrise team,\n\nHere is the day at Hotel Sunrise (13 Oct 2026).\n\nFRONT DESK"), mail.text.slice(0, 120));
  });

  test("one pass: a mail per address for each hotel that named some, through the hotel's own server; once a day; a failing hotel counted, the rest served", async () => {
    const settings = new Map<string, { to: string | null; sentOn: string | null }>([
      ["h1", { to: "owner@sunrise.in, gm@sunrise.in", sentOn: null }],
      ["h2", { to: "", sentOn: null }],
      ["h3", { to: "boss@pearl.in", sentOn: null }],
    ]);
    const queued: { hotelId: string; to: string; payload: MailPayload }[] = [];
    const reported: string[] = [];
    let clock = new Date("2026-10-13T15:30:00Z");
    const service = createDailySummaryService({
      hotels: async () => [{ id: "h1", name: "Hotel Sunrise" }, { id: "h2", name: "Quiet Inn" }, { id: "h3", name: "Hotel Pearl" }],
      settingsOf: async (id) => settings.get(id) ?? { to: null, sentOn: null },
      markSent: async (id, date) => void settings.set(id, { ...(settings.get(id) ?? { to: null, sentOn: null }), sentOn: date }),
      dashboardOf: async (id) => {
        if (id === "h3") throw new Error("the hotel's database is away");
        return dashboard();
      },
      enqueue: async (hotelId, to, payload) => void queued.push({ hotelId, to, payload }),
      // h1 sent a campaign today; h2's campaign read fails (a hotel not yet at the marketing migration), which costs it nothing but the section
      campaignsOf: async (id) => (id === "h1" ? { sent: 1, recipients: 10, delivered: 10, failed: 0, pending: 0 } : Promise.reject(new Error("no such table"))),
      now: () => clock,
      report: (message, _error, hotelId) => void reported.push(`${hotelId}: ${message}`),
    });
    assert.deepEqual(await service.run(), { hotels: 3, queued: 2, skipped: 1, failed: 1 });
    assert.ok(queued.some((q) => q.hotelId === "h1" && String((q.payload as { summary: string }).summary).includes("1 campaign sent today to 10 addresses")));
    assert.deepEqual(queued.map((q) => [q.hotelId, q.to]), [["h1", "owner@sunrise.in"], ["h1", "gm@sunrise.in"]]);
    assert.deepEqual([queued[0].payload.name, queued[0].payload.hotelName, queued[0].payload.date, queued[0].payload.summary?.includes("CASH TODAY")], ["Hotel Sunrise team", "Hotel Sunrise", "13 Oct 2026", true]);
    assert.deepEqual(reported, ["h3: daily summary could not be queued"]);
    // the same evening again: h1 is already served (its day is kept), h3 is tried again
    assert.deepEqual(await service.run(), { hotels: 3, queued: 0, skipped: 2, failed: 1 });
    // the next evening (IST): h1 goes again
    clock = new Date("2026-10-14T15:30:00Z");
    assert.deepEqual(await service.run(), { hotels: 3, queued: 2, skipped: 1, failed: 1 });
  });

  test("housekeeping runs once per active hotel, also for a hotel that gets no mail, before its mail; a failure is reported and never stops the mail", async () => {
    const order: string[] = [];
    const reported: string[] = [];
    const settings = new Map<string, { to: string | null; sentOn: string | null }>([["h1", { to: "owner@sunrise.in", sentOn: null }], ["h2", { to: "", sentOn: null }], ["h3", { to: "boss@pearl.in", sentOn: null }]]);
    const service = createDailySummaryService({
      hotels: async () => [{ id: "h1", name: "Hotel Sunrise" }, { id: "h2", name: "Quiet Inn" }, { id: "h3", name: "Hotel Pearl" }],
      housekeeping: async (id) => {
        order.push(`tidy ${id}`);
        if (id === "h1") throw new Error("no such table");
      },
      settingsOf: async (id) => (order.push(`settings ${id}`), settings.get(id) ?? { to: null, sentOn: null }),
      markSent: async (id, date) => void settings.set(id, { ...(settings.get(id) ?? { to: null, sentOn: null }), sentOn: date }),
      dashboardOf: async () => dashboard(),
      enqueue: async () => undefined,
      now: () => new Date("2026-10-13T15:30:00Z"),
      report: (message, _error, hotelId) => void reported.push(`${hotelId}: ${message}`),
    });
    assert.deepEqual(await service.run(), { hotels: 3, queued: 2, skipped: 1, failed: 0 }, "h1's failed housekeeping did not cost it its mail");
    assert.deepEqual(order, ["tidy h1", "settings h1", "tidy h2", "settings h2", "tidy h3", "settings h3"]);
    assert.deepEqual(reported, ["h1: daily housekeeping could not run"]);
  });
});

describe("GET /api/v1/cron/daily-summary", () => {
  const SECRET = "d".repeat(48);
  let runs = 0;
  beforeEach(() => {
    runs = 0;
    configureCron(createCronService({ secret: () => SECRET, drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => (runs += 1, { hotels: 2, queued: 3, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }) }));
    configureRoutes({ resolveSession: async () => null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  });
  afterEach(() => configureCron(null));
  const call = (authorization?: string) => cronDaily(new Request("https://hms.test/api/v1/cron/daily-summary", { headers: { host: "hms.test", ...(authorization ? { authorization } : {}) } }));

  test("the secret gates it; the right one runs the pass once and answers its counts, never cached", async () => {
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer wrong")).status, 401);
    const res = await call(`Bearer ${SECRET}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(((await res.json()) as { data: unknown }).data, { hotels: 2, queued: 3, skipped: 0, failed: 0 });
    assert.equal(runs, 1);
  });
});

describe("a pass over many hotels in batches (the cursor)", () => {
  const ids = Array.from({ length: 11 }, (_, i) => `h${String(i + 1).padStart(2, "0")}`);
  function setup(over: { batch?: number; budgetMs?: number; tick?: () => number; failCursor?: boolean } = {}) {
    const sentOn = new Map<string, string>();
    const queued: string[] = [];
    let cursor: DailySummaryCursor | null = null;
    let saves = 0;
    let clock = new Date("2026-10-13T15:30:00Z");
    const service = createDailySummaryService({
      // unsorted on purpose: the service takes the hotels in id order
      hotels: async () => [...ids].reverse().map((id) => ({ id, name: `Hotel ${id}` })),
      settingsOf: async (id) => ({ to: `owner@${id}.in`, sentOn: sentOn.get(id) ?? null }),
      markSent: async (id, date) => void sentOn.set(id, date),
      dashboardOf: async () => dashboard(),
      enqueue: async (hotelId) => void queued.push(hotelId),
      now: () => clock,
      cursorOf: async () => (cursor ? { ...cursor } : null),
      saveCursor: async (c) => {
        if (over.failCursor) throw new Error("settings are away");
        saves += 1;
        cursor = { ...c };
      },
      batch: over.batch,
      budgetMs: over.budgetMs,
      tick: over.tick,
    });
    return { service, queued, sentOn, cursor: () => cursor, saves: () => saves, nextDay: () => void (clock = new Date("2026-10-14T15:30:00Z")) };
  }

  test("batches of 4: each call hands over with more: true until the last, every hotel is mailed exactly once, in id order; the answer of a complete pass keeps its old shape", async () => {
    const s = setup({ batch: 4 });
    assert.deepEqual(await s.service.run(), { hotels: 4, queued: 4, skipped: 0, failed: 0, more: true });
    assert.deepEqual(s.cursor(), { day: "2026-10-13", after: "h04", done: false });
    assert.deepEqual(await s.service.run(), { hotels: 4, queued: 4, skipped: 0, failed: 0, more: true });
    assert.deepEqual(await s.service.run(), { hotels: 3, queued: 3, skipped: 0, failed: 0 }, "the last call has no `more`");
    assert.deepEqual(s.cursor(), { day: "2026-10-13", after: null, done: true });
    assert.deepEqual(s.queued, ids, "once each, in id order");
    // a call after a finished pass starts a new one: everybody is already served today, so everybody is skipped (the old behaviour of a second call)
    assert.deepEqual(await s.service.run(), { hotels: 4, queued: 0, skipped: 4, failed: 0, more: true });
    assert.deepEqual(s.queued, ids, "nobody gets a second mail");
  });

  test("a new day starts from the first hotel even when yesterday's pass stopped half way", async () => {
    const s = setup({ batch: 4 });
    await s.service.run();
    s.nextDay();
    const next = await s.service.run();
    assert.deepEqual([next.hotels, next.queued, s.cursor()?.day, s.cursor()?.after], [4, 4, "2026-10-14", "h04"]);
    assert.deepEqual(s.queued.slice(4), ["h01", "h02", "h03", "h04"], "yesterday's cursor was not used");
  });

  test("the time budget hands over too (a slow hotel list), after at least the work already done", async () => {
    let now = 0;
    // each hotel 'takes' 400 ms (its settings read): the budget of 1,000 ms is passed after the third, so the fourth is left for the next call
    const service = createDailySummaryService({
      hotels: async () => ids.map((id) => ({ id, name: id })),
      settingsOf: async () => {
        now += 400;
        return { to: "a@b.in", sentOn: null };
      },
      markSent: async () => undefined,
      dashboardOf: async () => dashboard(),
      enqueue: async () => undefined,
      now: () => new Date("2026-10-13T15:30:00Z"),
      budgetMs: 1000,
      tick: () => now,
    });
    const r = await service.run();
    assert.deepEqual([r.hotels, r.more], [3, true]);
  });

  test("a call cut off mid-pass resumes after the last cursor saved; the 'sent today' marks keep the hotels between the cursor and the cut-off from a second mail", async () => {
    // the stored cursor says h03 was the last handled, but h04..h06 were mailed before the cut-off (their marks were kept)
    const marks = new Map(["h01", "h02", "h03", "h04", "h05", "h06"].map((id) => [id, "2026-10-13"]));
    const queued: string[] = [];
    const service = createDailySummaryService({
      hotels: async () => ids.map((id) => ({ id, name: id })),
      settingsOf: async (id) => ({ to: "a@b.in", sentOn: marks.get(id) ?? null }),
      markSent: async (id, date) => void marks.set(id, date),
      dashboardOf: async () => dashboard(),
      enqueue: async (hotelId) => void queued.push(hotelId),
      now: () => new Date("2026-10-13T15:30:00Z"),
      cursorOf: async () => ({ day: "2026-10-13", after: "h03", done: false }),
    });
    const r = await service.run();
    assert.deepEqual([r.hotels, r.queued, r.skipped], [8, 5, 3], "h04-h06 skipped by their marks, h07-h11 mailed");
    assert.deepEqual(queued, ["h07", "h08", "h09", "h10", "h11"]);
  });

  test("a cursor that cannot be saved never stops the mails", async () => {
    const s = setup({ batch: 4, failCursor: true });
    assert.deepEqual(await s.service.run(), { hotels: 4, queued: 4, skipped: 0, failed: 0, more: true });
    assert.equal(s.saves(), 0);
  });

  test("the route: a call with more answers it, a detached call answers {accepted: true} at once and the batch runs after the answer", async () => {
    const SECRET = "d".repeat(48);
    const calls: string[] = [];
    let n = 0;
    configureCron(createCronService({ secret: () => SECRET, drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => (calls.push("run"), n += 1, n === 1 ? { hotels: 150, queued: 150, skipped: 0, failed: 0, more: true as const } : { hotels: 20, queued: 20, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }) }));
    configureRoutes({ resolveSession: async () => null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
    try {
      const get = (query = "") => cronDaily(new Request(`https://hms.test/api/v1/cron/daily-summary${query}`, { headers: { host: "hms.test", authorization: `Bearer ${SECRET}` } }));
      const first = await get();
      assert.deepEqual(((await first.json()) as { data: unknown }).data, { hotels: 150, queued: 150, skipped: 0, failed: 0, more: true });
      // outside a request the "after the answer" work runs at once: the chain went on in-process (no self address in a test) until a call had no more
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(calls, ["run", "run"]);
      n = 0;
      calls.length = 0;
      const detached = await get("?detached=1");
      assert.deepEqual(((await detached.json()) as { data: unknown }).data, { accepted: true });
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(calls, ["run", "run"], "the detached call ran its batch and continued the chain");
    } finally {
      configureCron(null);
    }
  });
});