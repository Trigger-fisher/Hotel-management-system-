// Shift Handover, end to end through the REAL route files, the wrapper, the service and the in-memory repositories.
// Behaviour comes from Pallav ShiftHandoverController.php and Models/ShiftHandover.php (cited in services/handover/*).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { ShiftHandover } from "@shared/dashboards/cash";
import { GET as pdfRoute } from "../../src/app/api/v1/handover/[id]/pdf/route";
import { DELETE as purgeRoute } from "../../src/app/api/v1/handover/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/handover/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/handover/[id]/route";
import { GET as optionsRoute } from "../../src/app/api/v1/handover/options/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/handover/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureHandovers } from "../../src/server/compose/handover";
import { handoverRecycleSources } from "../../src/server/compose/handoverRecycle";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHandovers } from "../../src/server/repos/memory/handovers";
import type { Person } from "../../src/server/services/cash/ports";
import { createHandoverService, type HandoverService } from "../../src/server/services/handover/handoverService";
import { asDate, matchesHandover, shiftAt } from "../../src/server/services/handover/rules";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { viewer: id(1), clerk: id(2), clerk2: id(3), admin: id(4), superAdmin: id(5), nobody: id(6), adminB: id(8) };
const STAFF = { asha: id(101), ravi: id(102), food: id(103), gone: id(104) };
const people = new Map<string, Person>([
  [U.viewer, { id: U.viewer, name: "Vera Viewer", roleKey: "viewer", roleLevel: 1, deleted: false }],
  [U.clerk, { id: U.clerk, name: "Asha Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.clerk2, { id: U.clerk2, name: "Esha Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [U.adminB, { id: U.adminB, name: "Beena Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);

const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("handover", "view")] });
mk("clerk", U.clerk, { roleKey: "editor", roleLevel: 2, grants: [grant("handover", "edit")] });
mk("clerk2", U.clerk2, { roleKey: "editor", roleLevel: 2, grants: [grant("handover", "edit")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("handover", "full"), grant("users", "full"), grant("system.backdate", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("handover", "full"), grant("users", "full"), grant("system.backdate", "full"), grant("system.force", "full")] });
sessions.set("force", { ...(sessions.get("super") as VerifiedSession), forceMode: true });
mk("nobody", U.nobody, {});
mk("adminB", U.adminB, { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("handover", "full"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let data = createMemoryHandovers();
let service: HandoverService;

function wire(failLog = false): void {
  data = createMemoryHandovers();
  const base = data.unit;
  const unit = failLog ? { run: <T>(s: Parameters<typeof base.run>[0], work: Parameters<typeof base.run<T>>[1]) => base.run(s, (repos) => work({ ...repos, systemLogs: { write: async () => { throw new Error("log table is down"); } } })) } : base;
  service = createHandoverService({ unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => clock });
  configureHandovers(service);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

function seed(hotelId = HOTEL_A): void {
  const d = data.store.dataFor(hotelId);
  d.lists = { shift: ["Morning", "Afternoon", "Evening", "Night"] };
  d.years = [
    { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
    { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
  ];
  d.staff = [
    { id: STAFF.asha, name: "Asha Patel", code: "E1", companyCode: "HP01", email: "asha@x.in", mobile: "9876500001" },
    { id: STAFF.ravi, name: "Ravi Shah", code: "E2", companyCode: "HP01", email: null, mobile: null },
    { id: STAFF.food, name: "Asha Patel", code: "F1", companyCode: "PF01", email: "asha@x.in", mobile: "9876500001" },
  ];
  d.hotelName = "Hotel Sunrise";
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const body = async (res: Response) => (await res.json()) as any;
const counts = (over: Record<string, number> = {}) => ({ d500: 2, d200: 0, d100: 3, d50: 0, d20: 0, d10: 0, d5: 0, coins: 7, ...over });
const input = (over: Record<string, unknown> = {}) => ({ shift: "Morning", handedToId: STAFF.asha, counts: counts(), notes: [" Laundry at 4 ", ""], instructions: ["VIP in 301"], stamp: null, ...over });
const create = (who: string, over: Record<string, unknown> = {}) => createRoute(req("POST", "/api/v1/handover", who, input(over)), ctx());
const created = async (who: string, over: Record<string, unknown> = {}): Promise<ShiftHandover & { version: number }> => {
  const res = await create(who, over);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await body(res)).data;
};
const patch = (who: string, hid: string, over: Record<string, unknown> = {}) => updateRoute(req("PATCH", `/api/v1/handover/${hid}`, who, { ...input(), version: 1, ...over }), ctx({ id: hid }));
const del = (who: string, hid: string, version: number) => removeRoute(req("DELETE", `/api/v1/handover/${hid}`, who, { version }), ctx({ id: hid }));
const list = async (who: string, qs = "") => {
  const res = await listRoute(req("GET", `/api/v1/handover${qs}`, who), ctx());
  return { status: res.status, ...(await body(res)) };
};
const logs = (hotelId = HOTEL_A) => data.store.dataFor(hotelId).systemLogs;

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
  seed();
});

describe("handover: record", () => {
  test("a clerk records one: total in paise, the taker kept by name, notes tidied, stamped now, entry number 1, a log line", async () => {
    const h = await created("clerk");
    assert.equal(h.entryNo, 1);
    assert.equal(h.totalPaise, (2 * 500 + 3 * 100 + 7) * 100);
    assert.deepEqual(h.handedTo, { id: STAFF.asha, name: "Asha Patel" });
    assert.deepEqual(h.handedBy, { id: U.clerk, name: "Asha Clerk" });
    assert.deepEqual(h.notes, ["Laundry at 4"]);
    assert.equal(h.at, new Date("2026-10-05T10:00:00+05:30").toISOString());
    assert.equal(h.isLatest, true);
    assert.equal(h.version, 1);
    const line = logs().at(-1);
    assert.equal(line?.module, "handover");
    assert.equal(line?.summary, "Added Handover: 0001");
    assert.deepEqual(line?.details, { Shift: "Morning", Date: "05-10-2026", Time: "10:00", "Total cash": 130700 });
  });

  test("the DTO matches the ui-shared ShiftHandover shape (plus version)", async () => {
    const h = await created("clerk");
    const sample: ShiftHandover & { version: number } = {
      id: "x", entryNo: 1, at: "x", shift: "Morning", handedBy: { id: "x", name: "x" }, handedTo: null, counts: counts(), totalPaise: 0, notes: ["x"], instructions: ["x"], createdAt: "x", updatedAt: "x", isLatest: true, version: 1,
    };
    assertMatchesContract(h, sample);
  });

  test("Pallav's words: shift required and from Master Data, an active employee, whole counts within range, list sizes", async () => {
    const res = await create("clerk", { shift: "Graveyard", handedToId: STAFF.gone, counts: counts({ d500: -1, d10: 1_000_001 }), notes: Array.from({ length: 101 }, () => "n") });
    assert.equal(res.status, 422);
    const f = (await body(res)).error.details.fields;
    assert.equal(f.shift, "The selected shift is invalid.");
    assert.equal(f.handedToId, "The selected employee id is invalid.");
    assert.equal(f["count.d500"], "The d500 count field must be at least 0.");
    assert.equal(f["count.d10"], "The d10 count field must not be greater than 1000000.");
    assert.equal(f.notes, "The notes field must not have more than 100 items.");
    const empty = await body(await create("clerk", { shift: "", handedToId: "" }));
    assert.equal(empty.error.details.fields.shift, "The shift field is required.");
    assert.equal(empty.error.details.fields.handedToId, "The employee id field is required.");
  });

  test("a hand-picked stamp counts only with system.backdate; a future date is refused; a closed year is refused", async () => {
    const plain = await created("clerk", { stamp: { date: "2026-10-01", time: "08:15" } });
    assert.equal(plain.at, new Date("2026-10-05T10:00:00+05:30").toISOString(), "ignored without the ability");
    const picked = await created("admin", { stamp: { date: "2026-10-01", time: "08:15" } });
    assert.equal(picked.at, new Date("2026-10-01T08:15:00+05:30").toISOString());
    const future = await body(await create("admin", { stamp: { date: "2026-10-06", time: "08:15" } }));
    assert.equal(future.error.details.fields.date, "The date field must be a date before or equal to today.");
    const closed = await create("admin", { stamp: { date: "2026-03-01", time: "08:15" } });
    assert.equal(closed.status, 422);
    assert.match((await body(closed)).error.details.fields.date, /2025-26 is closed/);
  });

  test("unknown keys are refused; a failing log write leaves nothing behind", async () => {
    assert.equal((await createRoute(req("POST", "/api/v1/handover", "clerk", { ...input(), userId: U.admin }), ctx())).status, 422);
    wire(true);
    seed();
    assert.equal((await create("clerk")).status, 500);
    assert.equal(data.store.dataFor(HOTEL_A).handovers.length, 0);
  });

  test("parallel saves get distinct running numbers", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => created("clerk")));
    assert.deepEqual(results.map((r) => r.entryNo).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("handover: permissions", () => {
  test("none is 401, no permission 403, view reads but cannot write, create cannot edit", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/handover", null), ctx())).status, 401);
    assert.equal((await list("nobody")).status, 403);
    assert.equal((await list("viewer")).status, 200);
    assert.equal((await create("viewer")).status, 403);
    mk("creator", id(20), { grants: [grant("handover", "create")] });
    const h = await created("creator");
    assert.equal((await patch("creator", h.id)).status, 403);
  });

  test("only the newest can be edited, by its recorder, an Admin or the SuperAdmin; force mode opens any, audited", async () => {
    const first = await created("clerk");
    clock = new Date("2026-10-05T11:00:00+05:30");
    const second = await created("clerk");
    const old = await patch("clerk", first.id);
    assert.equal(old.status, 403);
    assert.equal((await body(old)).error.message, "Only the latest Handover can be edited.");
    const other = await patch("clerk2", second.id);
    assert.equal((await body(other)).error.message, "Not allowed to edit this Handover.");
    assert.equal((await patch("admin", second.id, { shift: "Evening" })).status, 200);
    const forced = await patch("force", first.id, { shift: "Night" });
    assert.equal(forced.status, 200);
    assert.equal(data.store.dataFor(HOTEL_A).forceLogs.at(-1)?.summary, "Forced past a lock: Edited a closed Handover");
  });

  test("an edit keeps the recorder and the stamp, logs only what changed, and refuses a stale version", async () => {
    const h = await created("clerk");
    clock = new Date("2026-10-05T12:00:00+05:30");
    const res = await patch("admin", h.id, { counts: counts({ d500: 3 }) });
    const saved = (await body(res)).data;
    assert.equal(saved.handedBy.id, U.clerk);
    assert.equal(saved.at, h.at);
    assert.equal(saved.version, 2);
    assert.equal(logs().at(-1)?.summary, "Changed Handover: 0001 (total)");
    const stale = await patch("admin", h.id, { version: 1 });
    assert.equal(stale.status, 409);
    assert.equal((await body(stale)).error.details.currentVersion, 2);
  });

  test("delete: an Admin or the SuperAdmin only; never an Admin over the SuperAdmin's record; to the recycle bin", async () => {
    const mine = await created("clerk");
    assert.equal((await del("clerk", mine.id, 1)).status, 403, "the route needs full");
    mk("fullClerk", U.clerk2, { roleKey: "editor", roleLevel: 2, grants: [grant("handover", "full")] });
    const refused = await del("fullClerk", mine.id, 1);
    assert.equal((await body(refused)).error.message, "Only an Admin can delete a Handover.");
    const supers = await created("super");
    assert.equal((await del("admin", supers.id, 1)).status, 403);
    assert.equal((await del("admin", mine.id, 2)).status, 409);
    assert.equal((await del("admin", mine.id, 1)).status, 200);
    assert.equal((await getRoute(req("GET", `/api/v1/handover/${mine.id}`, "admin"), ctx({ id: mine.id }))).status, 404);
    assert.equal(logs().at(-1)?.summary, "Removed Handover: 0001");
  });

  test("recycle bin: SuperAdmin only to list, restore and purge; the number is not reused", async () => {
    const h = await created("clerk");
    await del("admin", h.id, 1);
    assert.equal((await list("admin", "?deleted=only")).status, 403);
    const bin = await list("super", "?deleted=only");
    assert.equal(bin.data.items.length, 1);
    assert.equal((await restoreRoute(req("POST", `/api/v1/handover/${h.id}/restore`, "admin", { version: 2 }), ctx({ id: h.id }))).status, 403);
    const restored = await restoreRoute(req("POST", `/api/v1/handover/${h.id}/restore`, "super", { version: 2 }), ctx({ id: h.id }));
    assert.equal(restored.status, 200);
    assert.equal(logs().at(-1)?.module, "recycle-bin");
    await del("admin", h.id, 3);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/handover/${h.id}/purge`, "admin"), ctx({ id: h.id }))).status, 403);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/handover/${h.id}/purge`, "super"), ctx({ id: h.id }))).status, 200);
    assert.equal((await created("clerk")).entryNo, 1, "purging the last frees its number (max + 1)");
  });

  test("isolation: another hotel's id is 404 and its list is empty", async () => {
    const h = await created("clerk");
    seed(HOTEL_B);
    assert.equal((await getRoute(req("GET", `/api/v1/handover/${h.id}`, "adminB"), ctx({ id: h.id }))).status, 404);
    assert.equal((await patch("adminB", h.id)).status, 404);
    assert.equal((await del("adminB", h.id, 1)).status, 404);
    assert.equal((await list("adminB")).data.total, 0);
  });
});

describe("handover: list, options, PDF, recycle adapter", () => {
  test("search (name, shift, note, number, amount, date), newest first, the numbers on top", async () => {
    await created("clerk");
    clock = new Date("2026-10-05T18:00:00+05:30");
    await created("clerk", { shift: "Evening", notes: ["Gas cylinder"], counts: counts({ d500: 0, d100: 0, coins: 50 }) });
    const all = await list("viewer");
    assert.deepEqual(all.data.items.map((h: ShiftHandover) => h.entryNo), [2, 1]);
    assert.equal(all.data.stats.todayCount, 2);
    assert.equal(all.data.stats.todayCashPaise, 130700 + 5000);
    assert.equal(all.data.stats.latest.entryNo, 2);
    for (const [q, n] of [["gas", 1], ["evening", 1], ["#1", 1], ["1,307", 1], ["05-10-2026", 2], ["asha", 2], ["nothing", 0]] as const) {
      assert.equal((await list("viewer", `?search=${encodeURIComponent(q)}`)).data.total, n, q);
    }
    assert.equal((await list("viewer", "?pageSize=7")).status, 422);
    assert.equal((await list("viewer", "?sort=drop")).status, 422);
  });

  test("options: active staff of both payrolls with the same person once, the Master Data shifts and the one the clock is in", async () => {
    const res = await optionsRoute(req("GET", "/api/v1/handover/options", "viewer"), ctx());
    const d = (await body(res)).data;
    assert.deepEqual(d.staff.map((s: { name: string }) => s.name), ["Asha Patel", "Ravi Shah"]);
    assert.equal(d.currentShift, "Morning");
  });

  test("the PDF is a real PDF with the handover's numbers", async () => {
    configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 120_000 }));
    const h = await created("clerk");
    const res = await pdfRoute(req("GET", `/api/v1/handover/${h.id}/pdf`, "viewer"), ctx({ id: h.id }));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    assert.equal((await pdfRoute(req("GET", `/api/v1/handover/${h.id}/pdf`, "nobody"), ctx({ id: h.id }))).status, 403);
  });

  test("the recycle adapter lists deleted handovers and restores / purges through the service", async () => {
    const h = await created("clerk");
    await del("admin", h.id, 1);
    const [source] = handoverRecycleSources({ unit: data.unit, handovers: () => service });
    const rows = await source.list(sessions.get("super") as VerifiedSession);
    assert.equal(rows[0].title, "0001");
    await assert.rejects(source.restore(sessions.get("admin") as VerifiedSession, h.id, { traceId: "trace-0001", ip: null }));
    await source.restore(sessions.get("super") as VerifiedSession, h.id, { traceId: "trace-0001", ip: null });
    assert.equal((await source.list(sessions.get("super") as VerifiedSession)).length, 0);
    await del("admin", h.id, 3);
    assert.equal(await source.purgeBefore(HOTEL_A, new Date(Date.now() + 60_000)), 1);
  });
});

describe("handover: pure rules", () => {
  test("shiftAt matches by word, night wraps midnight", () => {
    const shifts = ["Morning Shift", "Afternoon", "Evening", "Night"];
    assert.equal(shiftAt("06:00:00", shifts), "Morning Shift");
    assert.equal(shiftAt("23:30:00", shifts), "Night");
    assert.equal(shiftAt("02:00:00", shifts), "Night");
    assert.equal(shiftAt("13:00:00", ["Day"]), null);
  });
  test("asDate takes only real dates in the three shapes", () => {
    assert.equal(asDate("19-09-2026"), "2026-09-19");
    assert.equal(asDate("19/09/2026"), "2026-09-19");
    assert.equal(asDate("2026-09-19"), "2026-09-19");
    assert.equal(asDate("31-02-2026"), null);
    assert.equal(asDate("19-09/2026"), null);
  });
  test("hostile search text is plain text", () => {
    const r = { id: "x", entryNo: 1, date: "2026-10-05", time: "10:00:00", userId: "u", fullName: "A", shift: "Morning", counts: counts(), totalPaise: BigInt(100), totalInWords: null, notes: [], instructions: [], employeeId: null, handoverToName: null, createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: new Date(), updatedAt: new Date(), version: 1 };
    assert.equal(matchesHandover(r, null, "'; DROP TABLE shift_handovers; --"), false);
    assert.equal(matchesHandover(r, null, ".*"), false);
  });
});
