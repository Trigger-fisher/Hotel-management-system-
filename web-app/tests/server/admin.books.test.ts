// Admin, slice 5: the accounting years (GET /api/v1/admin/books, POST .../start, DELETE .../latest), through the REAL route files and the wrapper, on the
// in-memory double of the books. What a year holds and what removing it deletes belong to the engine (the double takes them from the test); the rules, words
// and permissions are Pallav's and are what is proven here. Spec: docs/specs/admin.md §8.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as booksGet } from "../../src/app/api/v1/admin/books/route";
import { DELETE as latestDelete } from "../../src/app/api/v1/admin/books/latest/route";
import { POST as startPost } from "../../src/app/api/v1/admin/books/start/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { BookYear } from "../../src/server/repos/adminBooks";
import { createMemoryAdminBooks } from "../../src/server/repos/memory/adminBooks";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("root", id(1), { accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
mk("adm", id(2), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3 });
mk("ed", id(3), { roleKey: "editor", roleLevel: 2 });
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);

const year = (n: number, label: string, startsOn: string, endsOn: string, closed = true): BookYear => ({ id: id(900 + n), label, startsOn, endsOn, closedAt: closed ? new Date(`${endsOn}T18:00:00Z`) : null, startedBy: null, closedBy: null });
const TWO = (): BookYear[] => [year(1, "2025-26", "2025-04-01", "2026-03-31"), year(2, "2026-27", "2026-04-01", "2027-03-31", false)];

let clock = new Date("2026-10-05T10:00:00+05:30");
let books: ReturnType<typeof createMemoryAdminBooks>;
const removedRows: BookYear[] = [];

function wire(years: BookYear[]): void {
  removedRows.length = 0;
  books = createMemoryAdminBooks(years, {
    counts: (y): Record<string, number> => (y.label === "2026-27" ? { bill_master_bills: 12, hotel_cash_deposits: 30, salary_processings: 0 } : { bill_master_bills: 400, hotel_cash_deposits: 900 }),
    carried: () => ({ cashPaise: 1_250_000, bills: { count: 2, amountPaise: 480_000 }, advances: { count: 1, amountPaise: 50_000 }, payroll: { count: 0, amountPaise: 0 }, salaries: { count: 3, amountPaise: 9_000_000 } }),
    onRemove: (y) => (removedRows.push(y), { bill_master_bills: 12, hotel_cash_deposits: 30 }),
  });
  configureAdmin(
    buildAdminServices(
      { people: { get: async (ids: readonly string[]) => new Map(ids.flatMap((i) => (people.has(i) ? [[i, people.get(i)!] as const] : []))) }, catalog, now: () => clock } as never,
      createMemoryAdminPlatform().unit,
      { unit: createMemoryAdminUsers(createMemoryAuth()).unit, credentials: {} as never },
      books.unit,
    ),
  );
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = () => ({ params: Promise.resolve({}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response): Promise<any> => (await res.clone().json()) as any;
const ok = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 200, JSON.stringify(await json(res)));
  return (await json(res)).data as T;
};
const failure = async (res: Response, status: number): Promise<{ message: string; fields: Record<string, string> }> => {
  const body = await json(res);
  assert.equal(res.status, status, JSON.stringify(body));
  return { message: body.error.message as string, fields: (body.error.details?.fields ?? {}) as Record<string, string> };
};

type Panel = { years: { id: string; label: string; current: boolean; closedAt: string | null; counts: { key: string; name: string; count: number }[] }[]; next: { label: string; startsOn: string; endsOn: string }; cannotStart: string | null; cannotRemove: string | null; carried: { cashPaise: number | null; bills: { count: number } } | null };
const panel = (who: string) => booksGet(req("GET", "/api/v1/admin/books", who), ctx());
const start = (who: string) => startPost(req("POST", "/api/v1/admin/books/start", who, undefined), ctx());
const remove = (who: string, confirm: string) => latestDelete(req("DELETE", "/api/v1/admin/books/latest", who, { confirm }), ctx());

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire(TWO());
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

describe("the accounting years panel", () => {
  test("lists the years newest first with what each holds, the next year and what the last one carried", async () => {
    const p = await ok<Panel>(await panel("adm"));
    assert.deepEqual(p.years.map((y) => [y.label, y.current]), [["2026-27", true], ["2025-26", false]]);
    assert.deepEqual(p.years[0].counts, [{ key: "hotel_cash_deposits", name: "Hotel deposits", count: 30 }, { key: "bill_master_bills", name: "Bills", count: 12 }, { key: "salary_processings", name: "Salary runs", count: 0 }]);
    assert.equal(p.years[1].closedAt !== null, true);
    assert.deepEqual(p.next, { label: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31" });
    assert.equal(p.carried?.cashPaise, 0, "the cash a year carries in is the Daily Report's opening on its first day (here an empty sheet), not the repository's own figure");
    assert.equal(p.carried?.bills.count, 2);
  });

  test("while the year runs, starting the next is refused with Pallav's sentence; removing is for the SuperAdmin", async () => {
    const p = await ok<Panel>(await panel("adm"));
    assert.equal(p.cannotStart, "2026-27 runs until 31 Mar 2027. The next year can be started from 01 Apr 2027.");
    assert.equal(p.cannotRemove, "Only the SuperAdmin can remove an accounting year.");
    const s = await ok<Panel>(await panel("root"));
    assert.equal(s.cannotRemove, null);
  });

  test("only an Admin or the SuperAdmin may open it", async () => {
    assert.equal((await panel("ed")).status, 403);
    assert.equal((await panel("")).status, 401);
  });

  test("before any year exists the next one is the financial year of today", async () => {
    wire([]);
    const p = await ok<Panel>(await panel("adm"));
    assert.deepEqual(p.years, []);
    assert.equal(p.next.label, "2026-27");
    assert.equal(p.cannotStart, null);
    assert.equal(p.carried, null);
    clock = new Date("2027-02-10T10:00:00+05:30");
    assert.equal((await ok<Panel>(await panel("adm"))).next.label, "2026-27", "January to March belong to the year that began the April before");
  });
});

describe("starting the next year", () => {
  test("is refused before the current year is over", async () => {
    const f = await failure(await start("adm"), 409);
    assert.match(f.message, /runs until 31 Mar 2027/);
    assert.equal(books.data.years.length, 2);
  });

  test("after 31 March an Admin starts it: the old year is closed, the new one open, one line in the system log", async () => {
    clock = new Date("2027-04-02T10:00:00+05:30");
    const r = await ok<{ year: { label: string }; message: string }>(await start("adm"));
    assert.equal(r.year.label, "2027-28");
    assert.equal(r.message, "Accounting year 2027-28 has started. 01 Apr 2027 onwards is open; earlier years are now read-only.");
    const years = books.data.years.sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
    assert.deepEqual(years.map((y) => [y.label, y.closedAt !== null]), [["2025-26", true], ["2026-27", true], ["2027-28", false]]);
    assert.equal(years[1].closedBy, id(2));
    assert.equal(books.data.logs.length, 1);
    assert.deepEqual([books.data.logs[0].module, books.data.logs[0].action, books.data.logs[0].summary], ["system", "created", "Started accounting year 2027-28"]);
    assert.equal((await start("adm")).status, 409, "the new year has only just begun");
  });

  test("a person who is not an Admin cannot start a year", async () => {
    clock = new Date("2027-04-02T10:00:00+05:30");
    assert.equal((await start("ed")).status, 403);
    assert.equal(books.data.years.length, 2);
  });
});

describe("removing the newest year", () => {
  test("needs the SuperAdmin and the exact words, then removes the year and opens the one before", async () => {
    assert.equal((await remove("adm", "DELETE 2026-27")).status, 403);
    const wrong = await failure(await remove("root", "delete 2026-27"), 422);
    assert.equal(wrong.fields.confirm, "Type DELETE 2026-27 exactly to remove the year.");
    assert.equal(books.data.years.length, 2);
    const r = await ok<{ removed: Record<string, number>; message: string }>(await remove("root", "DELETE 2026-27"));
    assert.equal(r.message, "Accounting year 2026-27 was removed with its 42 entries. 2025-26 is open again.");
    assert.deepEqual(books.data.years.map((y) => [y.label, y.closedAt]), [["2025-26", null]]);
    assert.deepEqual(removedRows.map((y) => y.label), ["2026-27"]);
    assert.equal(books.data.logs[0].userName, "Sonal Super");
    assert.equal(books.data.logs[0].action, "deleted");
  });

  test("the only year cannot be removed", async () => {
    wire([year(2, "2026-27", "2026-04-01", "2027-03-31", false)]);
    const f = await failure(await remove("root", "DELETE 2026-27"), 409);
    assert.equal(f.message, "This is the only year. There is no earlier year to go back to.");
  });

  test("a removal that fails half way leaves every year as it was", async () => {
    books.inputs.onRemove = () => {
      throw new Error("disk full");
    };
    assert.equal((await remove("root", "DELETE 2026-27")).status, 500);
    assert.deepEqual(books.data.years.map((y) => [y.label, y.closedAt !== null]), [["2025-26", true], ["2026-27", false]]);
    assert.equal(books.data.logs.length, 0);
  });

  test("the body takes only the confirmation", async () => {
    const res = await latestDelete(req("DELETE", "/api/v1/admin/books/latest", "root", { confirm: "DELETE 2026-27", year: "2025-26" }), ctx());
    assert.equal(res.status, 422);
  });
});
