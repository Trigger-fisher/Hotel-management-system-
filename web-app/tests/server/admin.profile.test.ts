// Admin, slice 3: the signed-in person's display preferences (PATCH/GET /api/v1/profile/preferences) and the global search (GET /api/v1/search),
// through the REAL route files and the wrapper. The search is tested against a stub of the repositories that records what it was asked, so the
// permission rule ("a source the person cannot read is never asked") is proven directly. Spec: docs/specs/admin.md §6.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as preferencesGet, PATCH as preferencesPatch } from "../../src/app/api/v1/profile/preferences/route";
import { GET as searchRoute } from "../../src/app/api/v1/search/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import type { SearchRepos } from "../../src/server/services/admin/searchService";
import { catalog, grant, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("anna", id(1), {});
mk("ben", id(2), {});
mk("all", id(3), { grants: [grant("bills", "view"), grant("companies", "view"), grant("payroll", "view"), grant("pms", "view"), grant("website", "view")] });
mk("billsOnly", id(4), { grants: [grant("bills.bills", "view")] });
mk("nothing", id(5), {});

const asked: string[] = [];
/** What each list was asked about its total: the search shows no total, so it must ask every list for the page only (countTotal false). */
const totals: unknown[] = [];
type Q = { words?: readonly string[]; view?: string; countTotal?: boolean };
const rows = <T>(items: T[]) => ({ rows: items, total: -1 });
const ask = (name: string, q: Q) => (asked.push(name), totals.push(q.countTotal));
const many = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i));
let billRows = many(2, (i) => ({ id: `b${i}`, billNumber: `2026 / ${1188 + i}`, guestName: "Ravi Mehta", billDate: "2026-10-05" }));

const repos: SearchRepos = {
  bills: { list: async (q: Q) => (ask(`bills:${(q.words ?? []).join("+")}`, q), rows(billRows)) },
  advances: { list: async (q: Q) => (ask("advances", q), rows([{ id: "a1", receiptNumber: "2026 / 814", guestName: "Ravi Mehta", paymentDate: "2026-10-01" }])) },
  companyProfiles: { list: async (q: Q) => (ask("companies", q), rows([{ id: "c1", name: "Infosys Rajkot", gstNumber: "24ABCDE1234F1Z5" }])) },
  customers: { list: async (q: Q) => (ask("customers", q), rows([{ id: "u1", name: "Ravi Mehta", mobile: "919876543210" }])) },
  payrollCompanies: { list: async () => (asked.push("payrollCompanies"), [{ id: "pc1", name: "Hotel Pallav" }, { id: "pc2", name: "Pallav Food" }]) },
  employees: { list: async (companyId: string, q: Q) => (ask(`staff:${companyId}`, q), rows([{ id: `e-${companyId}`, name: "Ravi Chef", employeeCode: "E-1" }])) },
  reservations: { list: async (q: Q) => (ask("reservations", q), rows([{ id: "r1", guestName: "Ravi Mehta", reference: "RES-26-00001", mobile: "9876543210" }])) },
  stays: { list: async (q: Q) => (ask(`stays:${q.view}`, q), rows([{ id: `s-${q.view}`, guestName: "Ravi Mehta", grNumber: "77", mobile: null }])) },
  siteEnquiries: { list: async (q: Q) => (ask("enquiries", q), rows([{ id: "q1", name: "Ravi Mehta", reference: "HP-05102026-00001" }])) },
} as unknown as SearchRepos;

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = () => ({ params: Promise.resolve({}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const ok = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};

beforeEach(() => {
  asked.length = 0;
  totals.length = 0;
  billRows = many(2, (i) => ({ id: `b${i}`, billNumber: `2026 / ${1188 + i}`, guestName: "Ravi Mehta", billDate: "2026-10-05" }));
  const platform = createMemoryAdminPlatform();
  configureAdmin(buildAdminServices({ unit: { run: (_s: unknown, work: (r: never) => Promise<unknown>) => work(repos as never) }, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-05T10:00:00+05:30") } as never, platform.unit));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

describe("display preferences (PATCH /api/v1/profile/preferences)", () => {
  type Prefs = { uiTheme: "light" | "dark" | null };
  const get = (who: string) => preferencesGet(req("GET", "/api/v1/profile/preferences", who), ctx());
  const patch = (who: string, body: unknown) => preferencesPatch(req("PATCH", "/api/v1/profile/preferences", who, body), ctx());

  test("no choice yet reads as null; day or night is remembered per person; null clears it; only the fields sent change", async () => {
    assert.deepEqual(await ok<Prefs>(await get("anna")), { uiTheme: null });
    assert.deepEqual(await ok<Prefs>(await patch("anna", { uiTheme: "dark" })), { uiTheme: "dark" });
    assert.deepEqual(await ok<Prefs>(await get("anna")), { uiTheme: "dark" });
    assert.deepEqual(await ok<Prefs>(await get("ben")), { uiTheme: null }, "another person's choice is theirs");
    assert.deepEqual(await ok<Prefs>(await patch("anna", {})), { uiTheme: "dark" }, "nothing sent, nothing changed");
    assert.deepEqual(await ok<Prefs>(await patch("anna", { uiTheme: "light" })), { uiTheme: "light" });
    assert.deepEqual(await ok<Prefs>(await patch("anna", { uiTheme: null })), { uiTheme: null });
  });

  test("anything but light, dark or null is refused in Pallav's plain words; an unknown field is refused; signed out is 401", async () => {
    for (const bad of ["blue", "", 1, true]) {
      const res = await patch("anna", { uiTheme: bad });
      assert.equal(res.status, 422, JSON.stringify(bad));
    }
    const unknown = await patch("anna", { uiTheme: "dark", userId: id(2) });
    assert.equal(unknown.status, 422, "no one else's id can be sent");
    assert.equal((await get("anna")).status, 200);
    assert.equal((await preferencesGet(req("GET", "/api/v1/profile/preferences", null), ctx())).status, 401);
    assert.deepEqual(await ok<Prefs>(await get("anna")), { uiTheme: null });
  });
});

describe("the global search (GET /api/v1/search)", () => {
  type Result = { query: string; hits: { kind: string; id: string; title: string; subtitle: string; companyId?: string }[]; counts: Record<string, number> };
  const search = (who: string, q: string) => searchRoute(req("GET", `/api/v1/search?q=${encodeURIComponent(q)}`, who), ctx());

  test("everything the person may read, each source asked once with the words; hits carry what the screen needs to open them", async () => {
    const r = await ok<Result>(await search("all", "  Ravi   Mehta "));
    assert.equal(r.query, "Ravi Mehta");
    assert.ok(asked.includes("bills:ravi+mehta"), "every word is passed, lower-cased, as the screens' own searches take it");
    assert.deepEqual(r.counts, { bill: 2, advance: 1, company: 1, customer: 1, staff: 2, reservation: 1, stay: 2, enquiry: 1 });
    assert.deepEqual(r.hits.find((h) => h.kind === "bill"), { kind: "bill", id: "b0", title: "Bill 2026 / 1188", subtitle: "Ravi Mehta · 05/10/2026" });
    assert.deepEqual(r.hits.find((h) => h.kind === "staff"), { kind: "staff", id: "e-pc1", title: "Ravi Chef", subtitle: "E-1 · Hotel Pallav", companyId: "pc1" });
    assert.deepEqual(r.hits.filter((h) => h.kind === "stay").map((h) => h.subtitle), ["GR 77", "GR 77"]);
    assert.deepEqual(totals, Array(10).fill(false), "every list (bills, advances, companies, customers, staff of both companies, reservations, two stay views, enquiries) is asked for its page only, never to count every match");
  });

  test("permission-aware: a source the person cannot view is never asked, so nothing leaks through the search", async () => {
    const r = await ok<Result>(await search("billsOnly", "ravi"));
    assert.deepEqual(Object.keys(r.counts), ["bill"]);
    assert.deepEqual(asked, ["bills:ravi"]);
    asked.length = 0;
    const none = await ok<Result>(await search("nothing", "ravi"));
    assert.deepEqual([none.hits, asked], [[], []]);
  });

  test("a question under two characters answers nothing and asks nothing; the question is cut at 100 characters; a repeated parameter or a stray one is refused", async () => {
    for (const q of ["", " ", "a", " r "]) {
      const r = await ok<Result>(await search("all", q));
      assert.deepEqual([r.hits, asked.length], [[], 0], JSON.stringify(q));
    }
    const long = await ok<Result>(await search("all", "x".repeat(300)));
    assert.equal(long.query.length, 100);
    assert.equal((await searchRoute(req("GET", "/api/v1/search?q=ravi&extra=1", "all"), ctx())).status, 422);
    assert.equal((await searchRoute(req("GET", "/api/v1/search?q=ravi&q=mehta", "all"), ctx())).status, 422);
    assert.equal((await searchRoute(req("GET", "/api/v1/search?q=ravi", null), ctx())).status, 401);
  });

  test("at most 50 hits whatever the sources answer, and at most 8 are asked of each source", async () => {
    billRows = many(200, (i) => ({ id: `b${i}`, billNumber: `2026 / ${i}`, guestName: "Ravi", billDate: "2026-10-05" }));
    const r = await ok<Result>(await search("all", "ravi"));
    assert.ok(r.hits.length <= 50);
    assert.ok(r.counts.bill <= 50);
  });

  test("about 20 searches a minute per person: the 21st is 429 with a retry hint, and another person is not affected", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await search("billsOnly", "ravi")).status, 200, `search ${i + 1}`);
    const refused = await search("billsOnly", "ravi");
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    assert.equal((await search("all", "ravi")).status, 200);
  });
});
