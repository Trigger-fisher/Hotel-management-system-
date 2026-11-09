// System Health usage (GET /system/health/usage): the pure builder, the service gate (SuperAdmin only) and the route, on fake readers, plus the SQL of the
// real reader against a fake client (what is asked of the database, with which windows). The real PostgreSQL run is tests/db/systemHealth.repo.test.ts.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as usageRoute } from "../../src/app/api/v1/system/health/usage/route";
import { configureHealthUsage } from "../../src/server/compose/healthUsage";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createPgHealthUsageReader, type HealthUsageReader, type UsageRaw } from "../../src/server/repos/postgres/healthUsage";
import { buildHealthUsage, createHealthUsageService } from "../../src/server/services/systemAdmin/healthUsage";
import { assumeTransaction, type SqlResult } from "../../src/db/types";
import { catalog, grant, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessions = new Map([
  ["super", makeSession({ userId: id(5), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("users", "full")] })],
  ["admin", makeSession({ userId: id(4), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "full")] })],
  ["viewer", makeSession({ userId: id(1), grants: [grant("payroll", "view")] })],
]);

const TODAY = "2026-10-11";
const NOW = new Date("2026-10-11T10:00:00+05:30");
const empty: UsageRaw = { daily: [], users7: [], prev7: [], flows: [], faults: [] };

describe("buildHealthUsage", () => {
  test("every feature is idle with no rows, with thirty empty days oldest first, and nothing invented", () => {
    const out = buildHealthUsage(empty, TODAY);
    assert.ok(out.features.length >= 12);
    for (const f of out.features) {
      assert.equal(f.status, "idle");
      assert.deepEqual([f.hits7, f.hits30, f.trend, f.users7, f.errors7, f.openFaults, f.avgMs, f.maxMs], [0, 0, 0, 0, 0, 0, null, 0]);
      assert.equal(f.daily.length, 30);
      assert.deepEqual([f.daily[0].day, f.daily[29].day], ["12 Sep", "11 Oct"]);
    }
    assert.deepEqual(out.flows, []);
    assert.deepEqual(out.tables.revenue, ["hotel_cash_deposits", "food_cash_deposits"]);
  });

  test("hits, the last seven days, people, trend against the week before, failed actions and open faults", () => {
    const raw: UsageRaw = {
      daily: [
        { module: "bills", day: "2026-10-11", hits: 6, failed: 0 },
        { module: "bills", day: "2026-10-08", hits: 4, failed: 1 },
        { module: "bills", day: "2026-09-20", hits: 10, failed: 0 }, // inside 30 days, outside 7
        { module: "revenue", day: "2026-10-10", hits: 2, failed: 2 },
        { module: "mystery", day: "2026-10-10", hits: 99, failed: 0 }, // a module HMS has no feature for is left out
      ],
      users7: [{ module: "bills", users: 3 }],
      prev7: [{ module: "bills", hits: 5 }, { module: "revenue", hits: 0 }],
      flows: [{ from: "bills", to: "revenue", people: 2 }, { from: "bills", to: "mystery", people: 5 }],
      faults: [{ feature: "bill-master", open: 2 }, { feature: "revenue", open: 1 }],
    };
    const out = buildHealthUsage(raw, TODAY);
    const bills = out.features.find((f) => f.key === "bills")!;
    assert.deepEqual([bills.hits7, bills.hits30, bills.users7, bills.trend, bills.errors7, bills.openFaults], [10, 20, 3, 100, 1, 2]);
    assert.equal(bills.status, "degraded");
    assert.deepEqual(bills.reasons, ["1 failed action in 7 days", "2 open faults"]);
    assert.equal(bills.daily[29].hits, 6);
    assert.equal(bills.daily[26].errors, 1);
    const revenue = out.features.find((f) => f.key === "revenue")!;
    assert.equal(revenue.status, "down", "every recorded action of the week failed");
    assert.equal(revenue.trend, 100);
    assert.deepEqual(out.flows, [["bills", "revenue", 2]]);
    assert.equal(out.features.some((f) => f.key === "mystery"), false);
  });

  test("a fault on a quiet feature is shown as degraded, not idle", () => {
    const f = buildHealthUsage({ ...empty, faults: [{ feature: "frontdesk", open: 1 }] }, TODAY).features.find((x) => x.key === "frontdesk")!;
    assert.deepEqual([f.status, f.reasons], ["degraded", ["1 open fault"]]);
  });
});

function reader(over: Partial<HealthUsageReader> = {}): HealthUsageReader {
  return {
    usage: async () => ({ ...empty, daily: [{ module: "bills", day: TODAY, hits: 3, failed: 0 }] }),
    activity: async () => [{ key: "bills", label: "Bills", last24h: 2, last7d: 5, last30d: 9 }],
    server: async () => ({ hotelDataBytes: 12_345_678, dbConnections: 3 }),
    ...over,
  };
}
const service = (r = reader()) => createHealthUsageService({ reader: r, pool: () => ({ total: 4, idle: 3, waiting: 0 }), now: () => NOW });

describe("the service", () => {
  test("answers the feature map, the record counts, the pool and the database, and says what is not measured", async () => {
    const out = await service().usage(sessions.get("super")!);
    assert.equal(out.source, "system_log");
    assert.match(out.note, /no page-visit or speed log/);
    assert.equal(out.features.find((f) => f.key === "bills")!.hits30, 3);
    assert.deepEqual(out.activity, [{ key: "bills", label: "Bills", last24h: 2, last7d: 5, last30d: 9 }]);
    assert.deepEqual(out.server, { poolTotal: 4, poolIdle: 3, poolWaiting: 0, hotelDataBytes: 12_345_678, dbConnections: 3, requestP50Ms: null, requestP95Ms: null, timing: "Not measured: EasyHotelSolutions keeps no request timings." });
  });

  test("the windows are IST days: 30 days from the start of today minus 29, 7 days, and the 7 before", async () => {
    let seen: { from30: Date; from7: Date; from14: Date } | null = null;
    await service(reader({ usage: async (_w, w) => ((seen = w), empty) })).usage(sessions.get("super")!);
    assert.equal(seen!.from30.toISOString(), "2026-09-11T18:30:00.000Z");
    assert.equal(seen!.from7.toISOString(), "2026-10-04T18:30:00.000Z");
    assert.equal(seen!.from14.toISOString(), "2026-09-27T18:30:00.000Z");
  });

  test("no pool is plain nulls", async () => {
    const out = await createHealthUsageService({ reader: reader(), pool: () => null, now: () => NOW }).usage(sessions.get("super")!);
    assert.deepEqual([out.server.poolTotal, out.server.poolIdle, out.server.poolWaiting], [null, null, null]);
  });

  test("only the SuperAdmin: an admin and a viewer are refused with a fixed sentence", async () => {
    for (const who of ["admin", "viewer"]) {
      await assert.rejects(() => service().usage(sessions.get(who)!), (e: unknown) => (e as { code?: string; message?: string }).code === "FORBIDDEN" && /Only the SuperAdmin can open System Health/.test((e as Error).message));
    }
  });
});

describe("the route", () => {
  beforeEach(() => {
    configureHealthUsage(service());
    configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  });
  const call = (who: string | null) => usageRoute(new Request("https://hms.test/api/v1/system/health/usage", { headers: who ? { host: "hms.test", "x-test-session": who } : { host: "hms.test" } }), { params: Promise.resolve({}) } as never);

  test("200 for the SuperAdmin, 401 anonymous, 403 for the others, and the body carries no guest data", async () => {
    const ok = await call("super");
    assert.equal(ok.status, 200);
    const body = JSON.stringify(await ok.json());
    assert.match(body, /"features"/);
    assert.equal((await call(null)).status, 401);
    assert.equal((await call("admin")).status, 403);
    assert.equal((await call("viewer")).status, 403);
    assert.doesNotMatch(body, /guest_name|mobile|email|password/i);
  });
});

describe("the SQL of the real reader (fake client)", () => {
  type Call = { text: string; params: readonly unknown[] };
  function fake(rows: (text: string) => Record<string, unknown>[], fail?: (text: string) => boolean) {
    const calls: Call[] = [];
    const withHotel = (async (_s: unknown, work: (tx: ReturnType<typeof assumeTransaction>) => Promise<unknown>) =>
      work(
        assumeTransaction(
          {
            query: async (text: string, params: readonly unknown[] = []): Promise<SqlResult> => {
              calls.push({ text, params });
              if (fail?.(text)) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
              return { rows: rows(text), affectedRows: 0 };
            },
          },
          "hotel_x",
        ),
      )) as never;
    return { reader: createPgHealthUsageReader(withHotel), calls };
  }
  const who = { hotelId: id(900) };
  const windows = { from30: new Date("2026-09-11T18:30:00Z"), from7: new Date("2026-10-04T18:30:00Z"), from14: new Date("2026-09-27T18:30:00Z") };

  test("usage reads only the system log and the faults, by IST day, with the three windows, and converts the numbers", async () => {
    const { reader, calls } = fake((t) =>
      /GROUP BY 1, 2 ORDER BY 2, 1/.test(t) ? [{ module: "bills", day: "2026-10-11", hits: "4", failed: "1" }]
      : /count\(DISTINCT user_id\) AS users/.test(t) ? [{ module: "bills", users: "2" }]
      : /created_at < \$2/.test(t) ? [{ module: "bills", hits: "3" }]
      : /from_module/.test(t) ? [{ from_module: "bills", to_module: "revenue", people: "2" }]
      : [{ feature: "bill-master", open: "1" }],
    );
    const raw = await reader.usage(who, windows);
    assert.deepEqual(raw, { daily: [{ module: "bills", day: "2026-10-11", hits: 4, failed: 1 }], users7: [{ module: "bills", users: 2 }], prev7: [{ module: "bills", hits: 3 }], flows: [{ from: "bills", to: "revenue", people: 2 }], faults: [{ feature: "bill-master", open: 1 }] });
    assert.equal(calls.length, 5);
    assert.ok(calls.every((c) => /FROM (system_logs|s|feature_errors)|FROM s /.test(c.text) || /system_logs/.test(c.text) || /feature_errors/.test(c.text)));
    assert.match(calls[0].text, /AT TIME ZONE 'Asia\/Kolkata'/);
    assert.deepEqual(calls[0].params, [windows.from30]);
    assert.deepEqual(calls[2].params, [windows.from14, windows.from7]);
    assert.match(calls[3].text, /interval '30 minutes'/);
    assert.doesNotMatch(calls.map((c) => c.text).join(" "), /summary|details|subject_label|user_name|ip_address/, "no free text and no names leave the database");
  });

  test("activity sums the tables of a group and leaves out a group whose table is missing", async () => {
    const { reader, calls } = fake(() => [{ d1: "1", d7: "2", d30: "3" }], (t) => /FROM food_cash_deposits/.test(t));
    const out = await reader.activity(who, new Date("2026-10-11T04:30:00Z"));
    const keys = out.map((o) => o.key);
    assert.ok(keys.includes("stays") && keys.includes("bills") && keys.includes("salary"));
    assert.equal(keys.includes("revenue"), false, "food_cash_deposits is missing in this fake hotel");
    assert.deepEqual(out.find((o) => o.key === "expenses"), { key: "expenses", label: "Expense entries", last24h: 4, last7d: 8, last30d: 12 });
    assert.ok(calls.every((c) => /^SELECT count\(\*\) FILTER/.test(c.text)));
  });

  test("the server numbers are null when the database refuses", async () => {
    const down = fake(() => [], () => true);
    assert.deepEqual(await down.reader.server(who), { hotelDataBytes: null, dbConnections: null });
  });
});