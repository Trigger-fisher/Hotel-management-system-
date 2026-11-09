// System Log, Force Log, System Health, /health/deep, Payroll Master and Payroll Log, through the REAL route files on the in-memory double.
// Behaviour: Pallav SystemLogController, ForceLogController, SystemHealthController + Support/Health/HealthChecks.php, PayrollMasterController,
// Support/PayrollMasters.php, PayrollLogController (each "SuperAdmin only").
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { MasterItem } from "@shared/dashboards/payrollPay";
import { GET as deepRoute } from "../../src/app/api/v1/health/deep/route";
import { GET as payrollLogRoute } from "../../src/app/api/v1/payroll/log/route";
import { GET as payrollLogPdfRoute } from "../../src/app/api/v1/payroll/log/pdf/route";
import { POST as createItemRoute } from "../../src/app/api/v1/payroll/master/[list]/route";
import { DELETE as deleteItemRoute, PATCH as updateItemRoute } from "../../src/app/api/v1/payroll/master/items/[id]/route";
import { POST as toggleRoute } from "../../src/app/api/v1/payroll/master/items/[id]/toggle/route";
import { GET as masterRoute } from "../../src/app/api/v1/payroll/master/route";
import { POST as reopenRoute } from "../../src/app/api/v1/system/errors/[id]/reopen/route";
import { POST as resolveRoute } from "../../src/app/api/v1/system/errors/[id]/resolve/route";
import { GET as errorsRoute } from "../../src/app/api/v1/system/errors/route";
import { GET as forceLogRoute } from "../../src/app/api/v1/system/force-log/route";
import { POST as checksRoute } from "../../src/app/api/v1/system/health/checks/route";
import { GET as healthRoute } from "../../src/app/api/v1/system/health/route";
import { GET as systemLogPdfRoute } from "../../src/app/api/v1/system/log/pdf/route";
import { GET as systemLogRoute } from "../../src/app/api/v1/system/log/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { GET as recordHistoryRoute } from "../../src/app/api/v1/system/log/record/route";
import { buildSystemAdminServices, configureSystemAdmin } from "../../src/server/compose/systemAdmin";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemorySystemAdmin } from "../../src/server/repos/memory/systemAdmin";
import type { Person } from "../../src/server/services/cash/ports";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CO = { hotel: id(201), food: id(202), closed: id(203), other: id(204) };
const people = new Map<string, Person>([[id(5), { id: id(5), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);

const sessions = new Map<string, VerifiedSession>();
sessions.set("super", makeSession({ userId: id(5), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("users", "full"), grant("payroll", "full")] }));
sessions.set("admin", makeSession({ userId: id(4), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "full"), grant("payroll", "full")] }));
sessions.set("viewer", makeSession({ userId: id(1), grants: [grant("payroll", "view")] }));
sessions.set("cashier", makeSession({ userId: id(2), grants: [grant("revenue", "view"), grant("bills", "edit")] }));
sessions.set("guest", makeSession({ userId: id(3), accountRole: "guest_user", scope: { kind: "guest", id: id(3) } as never }));
sessions.set("superB", makeSession({ hotelId: HOTEL_B, userId: id(9), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("users", "full")] }));

let clock = new Date("2026-10-05T10:00:00+05:30");
let mem = createMemorySystemAdmin();
let disk: { freeBytes: number; totalBytes: number } | null = { freeBytes: 50 * 2 ** 30, totalBytes: 100 * 2 ** 30 };

function wire(): void {
  mem = createMemorySystemAdmin();
  configureSystemAdmin(
    buildSystemAdminServices({
      unit: mem.unit,
      people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) },
      catalog,
      probes: { disk: async () => disk, mailDriver: () => "log" },
      now: () => clock,
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const at = (iso: string): Date => new Date(iso);
function seed(): void {
  const d = mem.store.dataFor(HOTEL_A);
  const sys = (n: number, module: string, action: string, when: string, extra: Partial<{ status: "success" | "failed"; userName: string; summary: string }> = {}) => ({
    id: id(1000 + n), module, userId: null, userName: extra.userName ?? "Pooja", action, status: extra.status ?? "success", entity: "Entry", subjectId: null, subjectLabel: `S${n}`, summary: extra.summary ?? `Line ${n}`, details: { Amount: 1500, Mode: "Cash" }, ipAddress: "10.0.0.1", createdAt: at(when),
  });
  d.systemLogs = [
    sys(1, "revenue", "created", "2026-10-05T09:00:00+05:30"),
    sys(2, "users", "updated", "2026-10-04T09:00:00+05:30", { userName: "Hari" }),
    sys(3, "expense", "deleted", "2026-10-01T09:00:00+05:30"),
    sys(4, "system", "emailed", "2026-09-20T09:00:00+05:30", { status: "failed", summary: "Mail 100% failed" }),
  ];
  d.forceLogs = [
    { id: id(2001), userId: null, userName: "Sonal", action: "lock", module: "revenue", summary: "Forced past a lock: Accounting year lock", details: { Lock: "Accounting year lock" }, route: null, path: null, method: null, ipAddress: null, createdAt: at("2026-10-05T09:30:00+05:30") },
    { id: id(2002), userId: null, userName: "Sonal", action: "armed", module: "system", summary: "Force mode armed", details: null, route: null, path: null, method: null, ipAddress: null, createdAt: at("2026-09-01T09:30:00+05:30") },
  ];
  d.companies = [
    { id: CO.hotel, name: "Hotel Sunrise Pvt Ltd", isActive: true },
    { id: CO.food, name: "Sunrise Food", isActive: true },
    { id: CO.closed, name: "Old Co", isActive: false },
  ];
  d.payrollLogs = [
    { id: id(3001), companyId: CO.hotel, companyName: "Hotel Sunrise Pvt Ltd", userName: "Hari", action: "created", status: "success", entity: "Advance", subjectId: null, subjectLabel: "E1", summary: "Advance given", details: { Amount: 500000 }, createdAt: at("2026-10-05T08:00:00+05:30") },
    { id: id(3002), companyId: CO.food, companyName: "Sunrise Food", userName: "Pooja", action: "emailed", status: "success", entity: "Staff email", subjectId: null, subjectLabel: "F1", summary: "Staff details sent", details: null, createdAt: at("2026-10-02T08:00:00+05:30") },
    { id: id(3003), companyId: CO.food, companyName: "Sunrise Food", userName: "Pooja", action: "emailed", status: "failed", entity: "Staff email", subjectId: null, subjectLabel: "F2", summary: "Staff details not sent", details: null, createdAt: at("2026-09-02T08:00:00+05:30") },
  ];
  d.errors = [
    { id: id(4001), feature: "bill-master", exception: "PdfRenderException", message: "Logo missing", file: "documents/bill.ts", line: 88, trace: null, method: "GET", path: "billing/bills/x/pdf", userName: null, occurrences: 6, firstSeenAt: at("2026-10-05T07:00:00+05:30"), lastSeenAt: at("2026-10-05T09:50:00+05:30"), resolvedAt: null, resolvedBy: null },
    { id: id(4002), feature: "login", exception: "Timeout", message: null, file: null, line: null, trace: null, method: null, path: null, userName: null, occurrences: 1, firstSeenAt: at("2026-09-01T07:00:00+05:30"), lastSeenAt: at("2026-09-01T07:00:00+05:30"), resolvedAt: at("2026-09-02T07:00:00+05:30"), resolvedBy: "Sonal" },
  ];
  d.settings = { "razorpay_hotel.enabled": "1", "razorpay_hotel.key_id": "rzp_test_SECRETISH", "razorpay_hotel.key_secret": "" };
}

const BILL = id(777);
const STAFF = id(779);
describe("the history of one record (N9)", () => {
  beforeEach(() => {
    const d = mem.store.dataFor(HOTEL_A);
    const line = (n: number, module: string, action: string, when: string, summary: string, details: Record<string, unknown> | null = null, status: "success" | "failed" = "success") =>
      ({ id: id(1100 + n), module, userId: null, userName: "Pooja", action, status, entity: "Bill", subjectId: BILL, subjectLabel: "Bill 2026 / 7", summary, details, ipAddress: null, createdAt: at(when) });
    d.systemLogs.push(
      line(1, "bills", "created", "2026-10-01T09:00:00+05:30", "Added Bill: Bill 2026 / 7 - Rakesh Patel", { Room: "201" }),
      line(2, "bills", "updated", "2026-10-02T09:00:00+05:30", "Changed Bill: Bill 2026 / 7 (Hotel mode of payment)", { "Hotel mode of payment": "was Cash, became UPI" }),
      line(3, "users", "updated", "2026-10-03T09:00:00+05:30", "An admin-only line about the same id"),
      line(4, "bills", "emailed", "2026-10-04T09:00:00+05:30", "Bill not emailed", null, "failed"),
    );
  });
  const history = (who: string, idOf = BILL) => get(recordHistoryRoute, `/api/v1/system/log/record?id=${idOf}`, who);

  test("newest first, the lines about that id only; the SuperAdmin sees every module, a cashier only the modules they may view; details as text", async () => {
    const r = await history("super");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((i: { action: string; at: string }) => [i.action, i.at.slice(0, 10)]), [["emailed", "2026-10-04"], ["updated", "2026-10-03"], ["updated", "2026-10-02"], ["created", "2026-10-01"]]);
    assert.deepEqual([r.data.items[0].status, r.data.items[2].userName, r.data.items[2].details, r.data.more], ["failed", "Pooja", { "Hotel mode of payment": "was Cash, became UPI" }, false]);
    const c = await history("cashier");
    assert.deepEqual(c.data.items.map((i: { action: string }) => i.action), ["emailed", "updated", "created"], "the users line is not theirs to see");
    assert.deepEqual((await history("viewer")).data.items, [], "no bills grant: nothing");
    assert.deepEqual((await history("super", id(778))).data.items, [], "another id: nothing");
  });

  test("a portal account is refused; a bad id is a 422; a line about a record of another hotel never shows", async () => {
    assert.equal((await history("guest")).status, 403);
    assert.equal((await get(recordHistoryRoute, "/api/v1/system/log/record?id=not-a-uuid", "super")).status, 422);
    assert.deepEqual((await history("superB")).data.items, []);
  });

  test("an employee's history comes from the payroll log (N9: staff): the lines about that id, mixed newest first with its system-log lines, only for people who may view Payroll", async () => {
    const d = mem.store.dataFor(HOTEL_A);
    d.payrollLogs.push(
      { id: id(3101), companyId: CO.hotel, companyName: "Hotel Sunrise Pvt Ltd", userName: "Hari", action: "created", status: "success", entity: "Employee", subjectId: STAFF, subjectLabel: "Manoj (E-1)", summary: "Employee added: Manoj (E-1)", details: { Designation: "Chef" }, createdAt: at("2026-10-01T08:00:00+05:30") },
      { id: id(3102), companyId: CO.hotel, companyName: "Hotel Sunrise Pvt Ltd", userName: "Pooja", action: "updated", status: "success", entity: "Employee", subjectId: STAFF, subjectLabel: "Manoj (E-1)", summary: "Employee updated: Manoj (E-1)", details: { Designation: "Chef → Head chef" }, createdAt: at("2026-10-03T08:00:00+05:30") },
      { id: id(3103), companyId: CO.hotel, companyName: "Hotel Sunrise Pvt Ltd", userName: "Pooja", action: "emailed", status: "failed", entity: "Staff email", subjectId: id(3999), subjectLabel: "someone else", summary: "Not about Manoj", details: null, createdAt: at("2026-10-04T08:00:00+05:30") },
    );
    d.systemLogs.push({ id: id(1200), module: "users", userId: null, userName: "Sonal", action: "updated", status: "success", entity: "User", subjectId: STAFF, subjectLabel: "Manoj", summary: "Account linked", details: null, ipAddress: null, createdAt: at("2026-10-02T08:00:00+05:30") });
    const s = await history("super", STAFF);
    assert.deepEqual(s.data.items.map((i: { summary: string; at: string }) => [i.summary, i.at.slice(0, 10)]), [["Employee updated: Manoj (E-1)", "2026-10-03"], ["Account linked", "2026-10-02"], ["Employee added: Manoj (E-1)", "2026-10-01"]]);
    assert.deepEqual([s.data.items[0].details, s.data.more], [{ Designation: "Chef → Head chef" }, false]);
    assert.deepEqual((await history("viewer", STAFF)).data.items.map((i: { summary: string }) => i.summary), ["Employee updated: Manoj (E-1)", "Employee added: Manoj (E-1)"], "payroll view: the payroll lines, not the users one");
    assert.deepEqual((await history("cashier", STAFF)).data.items, [], "no payroll grant: no payroll lines");
  });
});

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;
const get = async (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string) => {
  const res = await route(req("GET", path, who), ctx());
  return { status: res.status, ...(await json(res)) };
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  disk = { freeBytes: 50 * 2 ** 30, totalBytes: 100 * 2 ** 30 };
  wire();
  seed();
});

describe("system log and force log", () => {
  test("SuperAdmin only: none 401, an Admin 403 with Pallav's gate", async () => {
    assert.equal((await systemLogRoute(req("GET", "/api/v1/system/log", null), ctx())).status, 401);
    const admin = await get(systemLogRoute, "/api/v1/system/log", "admin");
    assert.equal(admin.status, 403);
    assert.equal(admin.error.message, "Only the SuperAdmin can open the System Log.");
    assert.equal((await get(forceLogRoute, "/api/v1/system/force-log", "admin")).status, 403);
  });

  test("newest first, the numbers on top, modules and people with lines, details as text", async () => {
    const r = await get(systemLogRoute, "/api/v1/system/log", "super");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((x: { subject: string }) => x.subject), ["S1", "S2", "S3", "S4"]);
    assert.deepEqual(r.data.stats, { total: 4, today: 1, people: 2, failed: 1 });
    assert.deepEqual(r.data.people, ["Hari", "Pooja"]);
    assert.deepEqual(r.data.items[0].details, { Amount: "1500", Mode: "Cash" });
    assertMatchesContract(r.data.items[0], { id: "x", module: "x", userName: null, action: "x", status: "success", entity: "x", subject: null, summary: "x", details: null, ip: null, at: "x" });
  });

  test("quick views, filters, IST dates and a plain-text search", async () => {
    const count = async (qs: string) => (await get(systemLogRoute, `/api/v1/system/log?${qs}`, "super")).data.total;
    assert.equal(await count("view=today"), 1);
    assert.equal(await count("view=week"), 3);
    assert.equal(await count("view=money"), 2);
    assert.equal(await count("view=access"), 1);
    assert.equal(await count("view=deletions"), 1);
    assert.equal(await count("view=problems"), 1);
    assert.equal(await count("view=problems&status=success"), 0);
    assert.equal(await count("from=2026-10-04&to=2026-10-04"), 1);
    assert.equal(await count("module=revenue&user=Pooja"), 1);
    assert.equal(await count("search=100%25"), 1, "% is a plain character");
    assert.equal(await count("search=CASH"), 4, "case ignored, details searched");
    assert.equal((await get(systemLogRoute, "/api/v1/system/log?pageSize=7", "super")).status, 422);
    assert.equal((await get(systemLogRoute, "/api/v1/system/log?view=hack", "super")).status, 422);
    assert.equal((await get(systemLogRoute, "/api/v1/system/log?drop=1", "super")).status, 422);
  });

  test("force log: views and numbers", async () => {
    const r = await get(forceLogRoute, "/api/v1/system/force-log", "super");
    assert.deepEqual(r.data.stats, { total: 2, today: 1, locks: 1, checks: 0 });
    assert.equal((await get(forceLogRoute, "/api/v1/system/force-log?view=sessions", "super")).data.total, 1);
    assert.equal((await get(forceLogRoute, "/api/v1/system/force-log?view=locks", "super")).data.items[0].summary, "Forced past a lock: Accounting year lock");
  });

  test("the printed system log is a PDF", async () => {
    configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 120_000 }));
    const res = await systemLogPdfRoute(req("GET", "/api/v1/system/log/pdf?view=week", "super"), ctx());
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get("content-type"), "application/pdf");
  });

  test("isolation: another hotel sees only its own lines", async () => {
    assert.equal((await get(systemLogRoute, "/api/v1/system/log", "superB")).data.total, 0);
  });
});

describe("system health and /health/deep", () => {
  test("the checks run when none is fresh, are filed, and say only whether a setting is set", async () => {
    const r = await get(healthRoute, "/api/v1/system/health", "super");
    assert.equal(r.status, 200);
    const byName = Object.fromEntries(r.data.checks.map((c: { name: string }) => [c.name, c]));
    assert.equal(byName.database.status, "ok");
    assert.equal(byName.storage.message, "50 GB free (50%)");
    assert.equal(byName.mail.status, "warn");
    assert.equal(byName.backup.message, "Automatic backups are switched off");
    assert.equal(byName.razorpay.message, "Online payments are on for hotel but its keys are missing");
    assert.equal(byName.faults.status, "warn");
    assert.equal(r.data.overall, "down");
    assert.equal(r.data.openErrors, 1);
    assert.deepEqual(r.data.notices, [], "no deployment notice without the probe");
    assert.equal(JSON.stringify(r).includes("SECRETISH"), false, "no setting value leaves");
    assert.equal(mem.store.dataFor(HOTEL_A).checks.length, 6);
    await get(healthRoute, "/api/v1/system/health", "super");
    assert.equal(mem.store.dataFor(HOTEL_A).checks.length, 6, "a fresh result is reused");
    const ran = await checksRoute(req("POST", "/api/v1/system/health/checks", "super"), ctx());
    assert.equal((await json(ran)).data.message, "All checks ran just now.");
    assert.equal(mem.store.dataFor(HOTEL_A).checks.length, 12);
  });

  test("a failing database ping is down with a safe sentence; a full disk is down", async () => {
    mem.store.dataFor(HOTEL_A).pingFails = true;
    disk = { freeBytes: 1, totalBytes: 100 };
    const r = await get(deepRoute, "/api/v1/health/deep", "admin");
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "down");
    const db = r.data.checks.find((c: { name: string }) => c.name === "database");
    assert.deepEqual([db.status, db.message], ["down", "The database did not answer"]);
    assert.match(r.data.checks.find((c: { name: string }) => c.name === "storage").message, /^Almost full/);
  });

  test("/health/deep never shows a setting's value (the stored backup result included), only a fixed word", async () => {
    const d = mem.store.dataFor(HOTEL_A);
    d.settings = { ...d.settings, "backup.enabled": "1", "backup.last_at": new Date(clock.getTime() - 2 * 3_600_000).toISOString(), "backup.last_result": "Uploaded to s3://LEAKY-BUCKET with key AKIAEXAMPLE" };
    const r = await get(deepRoute, "/api/v1/health/deep", "admin");
    assert.equal(r.status, 200);
    const body = JSON.stringify(r);
    for (const v of Object.values(mem.store.dataFor(HOTEL_A).settings)) if (v && !["1", "0"].includes(v)) assert.equal(body.includes(v), false, "a setting value left");
    for (const piece of ["LEAKY-BUCKET", "AKIAEXAMPLE", "SECRETISH"]) assert.equal(body.includes(piece), false, piece);
    assert.equal(r.data.checks.find((c: { name: string }) => c.name === "backup").message, "Last backup 2 hours ago: ok");
    mem.store.dataFor(HOTEL_A).settings["backup.last_result"] = "FAILED: could not reach host db.internal.example";
    const failed = (await get(deepRoute, "/api/v1/health/deep", "admin")).data.checks.find((c: { name: string }) => c.name === "backup");
    assert.deepEqual([failed.status, failed.message], ["warn", "Last backup 2 hours ago: failed"]);
  });

  test("/health/deep is read-only: two calls file no health_checks rows; the response keeps its shape", async () => {
    const first = await get(deepRoute, "/api/v1/health/deep", "admin");
    await get(deepRoute, "/api/v1/health/deep", "admin");
    assert.equal(mem.store.dataFor(HOTEL_A).checks.length, 0);
    assert.deepEqual(Object.keys(first.data).sort(), ["checkedAt", "checks", "status"]);
    assert.equal(first.data.checks.length, 6);
    assertMatchesContract(first.data.checks[0], { name: "x", status: "ok", message: "x", latencyMs: 0 });
  });

  test("/health/deep needs an Admin; System Health needs the SuperAdmin", async () => {
    assert.equal((await get(deepRoute, "/api/v1/health/deep", "viewer")).status, 403);
    assert.equal((await deepRoute(req("GET", "/api/v1/health/deep", null), ctx())).status, 401);
    assert.equal((await get(healthRoute, "/api/v1/system/health", "admin")).status, 403);
  });

  test("faults: open by default, resolve and reopen are SETs with a log line, unknown id 404", async () => {
    const open = await get(errorsRoute, "/api/v1/system/errors", "super");
    assert.equal(open.data.page.total, 1);
    assert.deepEqual(open.data.counts, { open: 1, resolved: 1 });
    assert.equal((await get(errorsRoute, "/api/v1/system/errors?show=all", "super")).data.page.total, 2);
    const fid = id(4001);
    const done = await json(await resolveRoute(req("POST", `/api/v1/system/errors/${fid}/resolve`, "super"), ctx({ id: fid })));
    assert.equal(done.data.fault.resolved, true);
    assert.equal(done.data.fault.resolvedBy, "Sonal Super");
    assert.equal(done.data.message, "Marked as fixed. It will reopen by itself if it happens again.");
    assert.equal(mem.store.dataFor(HOTEL_A).written.at(-1)?.summary, "Marked as fixed: PdfRenderException");
    const again = await json(await reopenRoute(req("POST", `/api/v1/system/errors/${fid}/reopen`, "super"), ctx({ id: fid })));
    assert.equal(again.data.fault.resolved, false);
    assert.equal((await resolveRoute(req("POST", `/api/v1/system/errors/${id(9999)}/resolve`, "super"), ctx({ id: id(9999) }))).status, 404);
    assert.equal((await resolveRoute(req("POST", `/api/v1/system/errors/${fid}/resolve`, "admin"), ctx({ id: fid }))).status, 403);
  });
});

describe("payroll master", () => {
  const add = (scope: string, list: string, body: unknown, who = "super") => createItemRoute(req("POST", `/api/v1/payroll/master/${list}?scope=${scope}`, who, body), ctx({ list }));

  test("SuperAdmin only; a scope must be this hotel's active company", async () => {
    assert.equal((await get(masterRoute, "/api/v1/payroll/master", "admin")).status, 403);
    const closed = await get(masterRoute, `/api/v1/payroll/master?scope=${CO.closed}`, "super");
    assert.equal(closed.status, 404);
    assert.equal(closed.error.message, "Select a company first.");
    assert.equal((await get(masterRoute, `/api/v1/payroll/master?scope=${CO.other}`, "super")).status, 404);
    assert.equal((await get(masterRoute, "/api/v1/payroll/master?list=nope", "super")).status, 422);
  });

  test("add shared and per company; a company page inherits the shared ones; counts per list in the scope; a user-audit row", async () => {
    const shared = await add("all", "designations", { label: "  Chef ", value: "" });
    assert.equal(shared.status, 201);
    const item: MasterItem = (await json(shared)).data;
    assertMatchesContract(item, { id: "x", list: "designations", scope: "all", label: "x", value: null, isActive: true, sortOrder: 1 });
    assert.equal(item.label, "Chef");
    await add(CO.hotel, "designations", { label: "Waiter", value: "" });
    const view = (await get(masterRoute, `/api/v1/payroll/master?scope=${CO.hotel}&list=designations`, "super")).data;
    assert.deepEqual(view.own.map((i: MasterItem) => i.label), ["Waiter"]);
    assert.deepEqual(view.inherited.map((i: MasterItem) => i.label), ["Chef"]);
    assert.equal(view.counts.designations, 1);
    assert.equal(view.counts.gender, 0);
    assert.deepEqual(mem.store.dataFor(HOTEL_A).userAudit.map((a) => a.action), ["payroll_master.added", "payroll_master.added"]);
  });

  test("Pallav's words: label required and max 120; an email list needs a valid address, lower-cased; the same entry twice in a scope is refused", async () => {
    const f = async (res: Response) => (await json(res)).error.details.fields;
    assert.equal((await f(await add("all", "gender", { label: " ", value: "" }))).label, "The label field is required.");
    assert.equal((await f(await add("all", "gender", { label: "x".repeat(121), value: "" }))).label, "The label field must not be greater than 120 characters.");
    assert.equal((await f(await add("all", "share_emails", { label: "Owner", value: "nope" }))).value, "The value field must be a valid email address.");
    const ok = await json(await add("all", "share_emails", { label: "Owner", value: " OWNER@Hotel.in " }));
    assert.equal(ok.data.value, "owner@hotel.in");
    assert.equal((await f(await add("all", "share_emails", { label: "Again", value: "owner@hotel.in" }))).value, "That is already in this list.");
    await add("all", "gender", { label: "Male", value: "" });
    assert.equal((await f(await add("all", "gender", { label: "MALE", value: "" }))).label, "That is already in this list.");
    assert.equal((await add(CO.hotel, "gender", { label: "Male", value: "" })).status, 201, "another scope may hold it");
  });

  test("an item changes only from its own scope; toggle is a SET when isActive is sent; delete is for good", async () => {
    const item: MasterItem = (await json(await add("all", "departments", { label: "Kitchen", value: "" }))).data;
    const wrong = await updateItemRoute(req("PATCH", `/api/v1/payroll/master/items/${item.id}?scope=${CO.hotel}`, "super", { label: "Kitchens", value: "" }), ctx({ id: item.id }));
    assert.equal(wrong.status, 409);
    assert.equal((await json(wrong)).error.message, "This one applies to every company. Switch the scope to All companies to change it.");
    const saved = await json(await updateItemRoute(req("PATCH", `/api/v1/payroll/master/items/${item.id}?scope=all`, "super", { label: "Kitchens", value: "" }), ctx({ id: item.id })));
    assert.equal(saved.data.label, "Kitchens");
    const off = await json(await toggleRoute(req("POST", `/api/v1/payroll/master/items/${item.id}/toggle?scope=all`, "super", {}), ctx({ id: item.id })));
    assert.equal(off.data.isActive, false);
    const stillOff = await json(await toggleRoute(req("POST", `/api/v1/payroll/master/items/${item.id}/toggle?scope=all`, "super", { isActive: false }), ctx({ id: item.id })));
    assert.equal(stillOff.data.isActive, false);
    assert.equal((await deleteItemRoute(req("DELETE", `/api/v1/payroll/master/items/${item.id}?scope=all`, "super"), ctx({ id: item.id }))).status, 200);
    assert.equal((await deleteItemRoute(req("DELETE", `/api/v1/payroll/master/items/${item.id}?scope=all`, "super"), ctx({ id: item.id }))).status, 404);
    assert.deepEqual(mem.store.dataFor(HOTEL_A).userAudit.map((a) => a.action), ["payroll_master.added", "payroll_master.updated", "payroll_master.toggled", "payroll_master.toggled", "payroll_master.removed"]);
    const toggled = mem.store.dataFor(HOTEL_A).userAudit.find((a) => a.action === "payroll_master.toggled")!;
    assert.deepEqual([toggled.actorId, toggled.details], [id(5), { list: "departments", item: "Kitchens" }]);
  });

  test("toggle writes its user-audit row in the same unit: a failing write undoes the switch", async () => {
    const item: MasterItem = (await json(await add("all", "departments", { label: "Laundry", value: "" }))).data;
    mem.store.dataFor(HOTEL_A).userAuditFails = true;
    const res = await toggleRoute(req("POST", `/api/v1/payroll/master/items/${item.id}/toggle?scope=all`, "super", {}), ctx({ id: item.id }));
    assert.equal(res.status, 500);
    const d = mem.store.dataFor(HOTEL_A);
    assert.equal(d.masterItems.find((i) => i.id === item.id)!.isActive, true, "the switch was rolled back");
    assert.deepEqual(d.userAudit.map((a) => a.action), ["payroll_master.added"]);
  });
});

describe("payroll log", () => {
  test("SuperAdmin only; across every company or one; views and numbers; entities and people", async () => {
    assert.equal((await get(payrollLogRoute, "/api/v1/payroll/log", "admin")).status, 403);
    const all = (await get(payrollLogRoute, "/api/v1/payroll/log", "super")).data;
    assert.equal(all.page.total, 3);
    assert.deepEqual(all.stats, { total: 3, today: 1, emails: 1, failed: 1 });
    assert.deepEqual(all.entities, ["Advance", "Staff email"]);
    assertMatchesContract(all.page.items[0], { id: "x", at: "x", companyId: null, companyName: "x", userName: "x", action: "created", entity: "x", subject: "x", summary: "x", details: "x", status: "success" });
    const food = (await get(payrollLogRoute, `/api/v1/payroll/log?scope=${CO.food}`, "super")).data;
    assert.equal(food.page.total, 2);
    assert.deepEqual(food.people, ["Pooja"]);
    const count = async (qs: string) => (await get(payrollLogRoute, `/api/v1/payroll/log?${qs}`, "super")).data.page.total;
    assert.equal(await count("view=money"), 1);
    assert.equal(await count("view=emails"), 2);
    assert.equal(await count("view=week"), 2);
    assert.equal(await count("view=problems"), 1);
    assert.equal(await count("search=SENT"), 2);
    assert.equal(await count("action=&entity=&status="), 3, "empty filters are no filter");
    assert.equal((await get(payrollLogRoute, "/api/v1/payroll/log?pageSize=1000", "super")).status, 422);
  });

  test("the printed payroll log is a PDF with the same filters; SuperAdmin only; the page-size is not an input", async () => {
    configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 120_000 }));
    assert.equal((await payrollLogPdfRoute(req("GET", "/api/v1/payroll/log/pdf", "admin"), ctx())).status, 403);
    assert.equal((await payrollLogPdfRoute(req("GET", "/api/v1/payroll/log/pdf", null), ctx())).status, 401);
    for (const qs of ["", "?view=problems", `?scope=${CO.food}&view=emails`, "?search=nothing-matches-this"]) {
      const res = await payrollLogPdfRoute(req("GET", `/api/v1/payroll/log/pdf${qs}`, "super"), ctx());
      assert.equal(res.status, 200, qs + (await res.clone().text()).slice(0, 200));
      assert.equal(res.headers.get("content-type"), "application/pdf", qs);
      assert.equal(Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-", qs);
    }
    assert.equal((await payrollLogPdfRoute(req("GET", "/api/v1/payroll/log/pdf?pageSize=5", "super"), ctx())).status, 422);
  });
});
