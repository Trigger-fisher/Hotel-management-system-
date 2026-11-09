// Admin, slice 6: the recycle bin (GET /api/v1/admin/recycle, POST .../{key}/{id}/restore, DELETE .../{key}/{id}) through the REAL route files and the
// wrapper. The kinds are SOURCES (each module restores and removes its own records by its own rules); here they are fakes that record what the bin asked of
// them, so the bin's own rules are proven: SuperAdmin only, newest deletion first, days left from the keep-time setting, search, a module's refusal stands,
// and the nightly clean-up. Spec: docs/specs/admin.md §9.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { DELETE as purgeRoute } from "../../src/app/api/v1/admin/recycle/[key]/[id]/route";
import { POST as restoreRoute } from "../../src/app/api/v1/admin/recycle/[key]/[id]/restore/route";
import { GET as listRoute } from "../../src/app/api/v1/admin/recycle/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin, getAdminRecycle } from "../../src/server/compose/admin";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createRecycleService, type RecycleSource, type TrashedRow } from "../../src/server/services/admin/recycleService";
import { catalog, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([
  [id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [id(2), { id: id(2), name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("root", makeSession({ userId: id(1), client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }));
sessions.set("adm", makeSession({ userId: id(2), client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3 }));

const DAY = 86_400_000;
let clock = new Date("2026-10-06T10:00:00+05:30");
const ago = (days: number): Date => new Date(clock.getTime() - days * DAY - 3_600_000);
let hotel = createMemoryHotel();
const calls: string[] = [];
let tables: Record<string, TrashedRow[]>;
let refuse: string | null = null;

const row = (n: number, title: string, detail: string, deletedAt: Date, deletedBy: string | null = id(2)): TrashedRow => ({ id: id(n), title, detail, deletedAt, deletedBy });
const source = (key: string, label: string): RecycleSource => ({
  key,
  label,
  list: async () => tables[key].map((r) => ({ ...r })),
  restore: async (_s, rid) => {
    calls.push(`restore:${key}:${rid}`);
    if (refuse) throw new AppError("VALIDATION_FAILED", refuse, { fields: { date: refuse } });
    tables[key] = tables[key].filter((r) => r.id !== rid);
  },
  purge: async (_s, rid) => {
    calls.push(`purge:${key}:${rid}`);
    tables[key] = tables[key].filter((r) => r.id !== rid);
  },
  purgeBefore: async (_hotel, cutoff) => {
    const keep = tables[key].filter((r) => r.deletedAt >= cutoff);
    const gone = tables[key].length - keep.length;
    tables[key] = keep;
    return gone;
  },
});

function wire(): void {
  hotel = createMemoryHotel();
  calls.length = 0;
  refuse = null;
  tables = {
    bill: [row(11, "2026 / 1188", "Rs 12,400.00 on 05 Oct 2026", ago(1)), row(12, "2026 / 1170", "Rs 800.00 on 20 Sep 2026", ago(20))],
    company: [row(21, "Bhavani Traders", "GSTIN 24AAACB1234C1Z2", ago(5), id(1))],
    "hotel-deposit": [row(31, "HD-0042", "Rs 5,000.00 on 03 Oct 2026", ago(29.5), null)],
  };
  configureAdmin(
    buildAdminServices(
      { unit: hotel.unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) }, audit: { record: async () => undefined }, catalog, now: () => clock } as never,
      createMemoryAdminPlatform().unit,
      { unit: createMemoryAdminUsers(createMemoryAuth()).unit, credentials: {} as never },
      undefined,
      [source("bill", "Bill"), source("company", "Company"), source("hotel-deposit", "Hotel cash deposit")],
    ),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const ORIGIN = "https://hms.test";
const req = (method: string, path: string, who: string | null): Request => new Request(`${ORIGIN}${path}`, { method, headers: { host: "hms.test", origin: ORIGIN, ...(who ? { "x-test-session": who } : {}) } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response): Promise<any> => (await res.clone().json()) as any;
const ok = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 200, JSON.stringify(await json(res)));
  return (await json(res)).data as T;
};
type Item = { key: string; id: string; kind: string; label: string; detail: string; deletedBy: string; daysLeft: number };
const list = async (who: string, q = ""): Promise<{ items: Item[]; total: number }> => ok(await listRoute(req("GET", `/api/v1/admin/recycle${q}`, who), { params: Promise.resolve({}) }));
const params = (key: string, rid: string) => ({ params: Promise.resolve({ key, id: rid }) });
const restore = (who: string, key: string, rid: string) => restoreRoute(req("POST", `/api/v1/admin/recycle/${key}/${rid}/restore`, who), params(key, rid));
const purge = (who: string, key: string, rid: string) => purgeRoute(req("DELETE", `/api/v1/admin/recycle/${key}/${rid}`, who), params(key, rid));

beforeEach(() => {
  clock = new Date("2026-10-06T10:00:00+05:30");
  wire();
});

describe("the recycle bin", () => {
  test("lists every kind newest deletion first, with who deleted it and the days left of 30", async () => {
    const r = await list("root");
    assert.equal(r.total, 4);
    assert.deepEqual(r.items.map((i) => [i.kind, i.label, i.deletedBy, i.daysLeft]), [
      ["Bill", "2026 / 1188", "Hari Admin", 29],
      ["Company", "Bhavani Traders", "Sonal Super", 25],
      ["Bill", "2026 / 1170", "Hari Admin", 10],
      ["Hotel cash deposit", "HD-0042", "", 1],
    ]);
  });

  test("the keep time is the Settings number (recycle.days) and never goes below one day", async () => {
    await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) => repos.adminSettings.set([{ key: "recycle.days", value: "60", secret: false }], id(1)));
    assert.equal((await list("root")).items[0].daysLeft, 59);
    await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) => repos.adminSettings.set([{ key: "recycle.days", value: "0", secret: false }], id(1)));
    assert.equal((await list("root")).items[0].daysLeft, 29, "a nonsense value falls back to 30");
  });

  test("searches the type, the record, the line under it and the person; pages", async () => {
    assert.deepEqual((await list("root", "?search=bill")).items.map((i) => i.label), ["2026 / 1188", "2026 / 1170"]);
    assert.deepEqual((await list("root", "?search=gstin+bhavani")).items.map((i) => i.label), ["Bhavani Traders"]);
    assert.deepEqual((await list("root", "?search=hari")).items.length, 2);
    const p = await list("root", "?pageSize=10&page=2");
    assert.equal(p.items.length, 0);
    assert.equal(p.total, 4);
  });

  test("is the SuperAdmin's alone", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/admin/recycle", "adm"), { params: Promise.resolve({}) })).status, 403);
    assert.equal((await listRoute(req("GET", "/api/v1/admin/recycle", null), { params: Promise.resolve({}) })).status, 401);
    assert.equal((await restore("adm", "bill", id(11))).status, 403);
    assert.equal((await purge("adm", "bill", id(11))).status, 403);
    assert.deepEqual(calls, []);
  });
});

describe("restoring and removing", () => {
  test("restore asks the module (which writes its own recycle-bin log line) and takes the record out of the bin", async () => {
    const r = await ok<{ message: string }>(await restore("root", "bill", id(11)));
    assert.equal(r.message, "Bill 2026 / 1188 restored.");
    assert.deepEqual(calls, [`restore:bill:${id(11)}`]);
    assert.equal((await list("root")).total, 3);
  });

  test("a module's refusal stands: the record stays in the bin", async () => {
    refuse = "2025-26 is closed, so an entry dated 05 Oct 2025 cannot be changed.";
    const res = await restore("root", "bill", id(12));
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.message, refuse);
    assert.equal((await list("root")).total, 4);
  });

  test("remove for good asks the module's own removal", async () => {
    const r = await ok<{ message: string }>(await purge("root", "company", id(21)));
    assert.equal(r.message, "Company Bhavani Traders removed for good.");
    assert.deepEqual(calls, [`purge:company:${id(21)}`]);
    assert.equal((await list("root")).total, 3);
  });

  test("an unknown kind, a record that is not in the bin and a malformed id are refused", async () => {
    assert.equal((await restore("root", "nothing", id(11))).status, 404);
    assert.equal((await restore("root", "bill", id(99))).status, 404);
    assert.equal((await purge("root", "bill", id(31))).status, 404, "another kind's record is not reachable through this kind");
    assert.equal((await restore("root", "bill", "not-an-id")).status, 422);
    assert.deepEqual(calls, []);
  });
});

describe("the nightly clean-up", () => {
  test("removes for good what has sat longer than the keep time, in every kind", async () => {
    clock = new Date(clock.getTime() + 2 * DAY);
    const n = await getAdminRecycle().purgeExpired(HOTEL_A);
    assert.equal(n, 1, "only the deposit deleted 29.5 days ago has passed 30 days now");
    assert.deepEqual(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), { bill: 2, company: 1, "hotel-deposit": 0 });
  });

  test("one kind failing never blocks the kinds after it; the failure is a warning line with the kind and hotel only", async () => {
    clock = new Date(clock.getTime() + 2 * DAY);
    const warned: { message: string; fields: unknown }[] = [];
    const broken: RecycleSource = { ...source("bill", "Bill"), purgeBefore: async () => Promise.reject(new Error("the database refused: Bina's secret row")) };
    const recycle = createRecycleService({
      unit: hotel.unit as never,
      people: { get: async () => new Map() },
      now: () => clock,
      sources: [broken, source("company", "Company"), source("hotel-deposit", "Hotel cash deposit")],
      logger: { warn: (message, fields) => void warned.push({ message, fields }) },
    });
    assert.equal(await recycle.purgeExpired(HOTEL_A), 1, "the deposit after the broken kind still goes");
    assert.equal(tables["hotel-deposit"].length, 0);
    assert.equal(warned.length, 1);
    assert.deepEqual(warned[0].fields, { hotelId: HOTEL_A, kind: "bill", error: "Error" });
    assert.ok(!JSON.stringify(warned).includes("Bina"), "no record contents in the log");
  });
});
