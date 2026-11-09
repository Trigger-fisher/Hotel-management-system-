// Daily Cash revenue, end to end through the REAL route files, the wrapper, the service and the in-memory repositories.
// Expected behaviour comes from docs/specs/cash-revenue.md (each rule there cites Pallav's file and line).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { CashDeposit, CashList } from "@shared/dashboards/cash";
import { DELETE as purgeRoute } from "../../src/app/api/v1/revenue/deposits/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/revenue/deposits/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/revenue/deposits/[id]/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/revenue/deposits/route";
import { AppError } from "../../src/server/errors";
import { configureCashRevenue } from "../../src/server/compose/cash";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryCash } from "../../src/server/repos/memory/cashDeposit";
import { guardBooks } from "../../src/server/services/cash/books";
import type { Person } from "../../src/server/services/cash/ports";
import { createRevenueService } from "../../src/server/services/cash/revenueService";
import type { VerifiedSession } from "../../src/server/auth/session";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { viewer: id(1), editor: id(2), editor2: id(3), admin: id(4), superAdmin: id(5), nobody: id(6), partOnly: id(7), adminB: id(8) };
const people = new Map<string, Person>([
  [U.viewer, { id: U.viewer, name: "Vera Viewer", roleKey: "viewer", roleLevel: 1, deleted: false }],
  [U.editor, { id: U.editor, name: "Asha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.editor2, { id: U.editor2, name: "Esha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [U.nobody, { id: U.nobody, name: "Nina Nobody", roleKey: "viewer", roleLevel: 1, deleted: false }],
  [U.partOnly, { id: U.partOnly, name: "Paul Part", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.adminB, { id: U.adminB, name: "Beena Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);

const sessions = new Map<string, VerifiedSession>();
const FORCE_GRANTS = [grant("revenue", "full"), grant("users", "full"), grant("system.backdate", "full"), grant("system.force", "full")];
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("revenue", "view")] });
mk("editor", U.editor, { grants: [grant("revenue", "edit")] });
mk("editor2", U.editor2, { grants: [grant("revenue", "edit")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("revenue", "full"), grant("users", "full"), grant("system.backdate", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("revenue", "full"), grant("users", "full"), grant("system.backdate", "full")] });
mk("force", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: FORCE_GRANTS });
sessions.set("force", { ...(sessions.get("force") as VerifiedSession), forceMode: true });
mk("nobody", U.nobody, {});
// the PLATFORM owner: account role super_admin, but only an ordinary admin role inside this hotel, so none of the hotel SuperAdmin powers
mk("platformOwner", id(10), { accountRole: "super_admin", roleKey: "admin", roleLevel: 3, grants: [grant("revenue", "full"), grant("users", "full"), grant("system.force", "full")] });
sessions.set("platformOwnerForce", { ...(sessions.get("platformOwner") as VerifiedSession), forceMode: true });
mk("deleter", id(9), { grants: [grant("revenue", "full")] });
mk("partOnly", U.partOnly, { grants: [grant("revenue.hotel", "create")] });
mk("viewerHotelWrite", U.viewer, { grants: [grant("revenue", "view"), grant("revenue.hotel", "edit")] });
mk("adminB", U.adminB, { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("revenue", "full"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let cash = createMemoryCash();
let auditEvents: { action: string; userId: string }[] = [];
const lines: string[] = [];

function wire(overrides: { failLog?: boolean } = {}): void {
  cash = createMemoryCash();
  auditEvents = [];
  const base = cash.unit;
  const unit = overrides.failLog
    ? { run: <T>(s: Parameters<typeof base.run>[0], work: Parameters<typeof base.run<T>>[1]) => base.run(s, (repos) => work({ ...repos, systemLogs: { write: async () => { throw new Error("log table is down"); } } })) }
    : base;
  configureCashRevenue(createRevenueService({ unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async (e) => void auditEvents.push(e) }, catalog, now: () => clock }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: (l) => lines.push(l) }) });
}

async function seed(hotelId = HOTEL_A): Promise<void> {
  const data = cash.store.dataFor(hotelId);
  data.lists = { revenue_depositor_hotel: ["Front desk", "Ashok Desai (Manager)"], revenue_depositor_food: ["Hitesh Parmar (Chef)"] };
  data.years = [
    { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
    { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
  ];
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, ...headers };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const body = async (res: Response) => (await res.json()) as any;

const input = (over: Record<string, unknown> = {}) => ({ book: "hotel", depositor: "Front desk", amountPaise: 150000, instruction: "", stamp: null, ...over });
const create = (who: string, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => createRoute(req("POST", "/api/v1/revenue/deposits", who, input(over), headers), ctx());
const created = async (who: string, over: Record<string, unknown> = {}): Promise<CashDeposit> => {
  const res = await create(who, over);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await body(res)).data;
};
const list = async (who: string, qs = ""): Promise<{ status: number; data: CashList<CashDeposit>; error?: { code: string } }> => {
  const res = await listRoute(req("GET", `/api/v1/revenue/deposits${qs}`, who), ctx());
  const b = await body(res);
  return { status: res.status, data: b.data, error: b.error };
};
const patch = (who: string, depositId: string, over: Record<string, unknown>) => updateRoute(req("PATCH", `/api/v1/revenue/deposits/${depositId}`, who, { ...input(), version: 1, ...over }), ctx({ id: depositId }));
const del = (who: string, depositId: string, version: number) => removeRoute(req("DELETE", `/api/v1/revenue/deposits/${depositId}`, who, { version }), ctx({ id: depositId }));
const restore = (who: string, depositId: string, version: number) => restoreRoute(req("POST", `/api/v1/revenue/deposits/${depositId}/restore`, who, { version }), ctx({ id: depositId }));
const purge = (who: string, depositId: string) => purgeRoute(req("DELETE", `/api/v1/revenue/deposits/${depositId}/purge`, who), ctx({ id: depositId }));
const fieldsOf = async (res: Response): Promise<Record<string, string>> => (await body(res)).error.details.fields;
const logs = (hotelId = HOTEL_A) => cash.store.dataFor(hotelId).systemLogs;

beforeEach(async () => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
  await seed();
});

describe("permissions: reading goes through the module, writing through the book's part", () => {
  test("no session is 401; the module's view lists; no permission is 403", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/revenue/deposits", null), ctx())).status, 401);
    assert.equal((await list("viewer")).status, 200);
    assert.equal((await list("nobody")).status, 403);
  });
  test("a viewer cannot record, edit or delete; each is 403", async () => {
    assert.equal((await create("viewer")).status, 403);
    const row = await created("editor");
    assert.equal((await patch("viewer", row.id, { amountPaise: 1 })).status, 403);
    assert.equal((await del("viewer", row.id, 1)).status, 403);
  });
  test("the part is enough to record (create on revenue.hotel) but not to read; and it covers only its own book", async () => {
    assert.equal((await create("partOnly")).status, 201);
    assert.equal((await create("partOnly", { book: "food", depositor: "Hitesh Parmar (Chef)" })).status, 403);
    assert.equal((await list("partOnly")).status, 403, "reading is through the module");
  });
  test("create does not give edit: a part holder at create level cannot correct what they recorded", async () => {
    const row = await created("partOnly");
    assert.equal((await patch("partOnly", row.id, { amountPaise: 5 })).status, 403);
  });
  test("a book-specific part grant works for one book only (view on the module + edit on revenue.hotel)", async () => {
    const row = await created("viewerHotelWrite");
    assert.equal((await patch("viewerHotelWrite", row.id, { amountPaise: 5 })).status, 200);
  });
  test("unknown fields are refused", async () => {
    assert.equal((await create("editor", { userId: id(99) })).status, 422);
    assert.equal((await create("editor", { recordedBy: { id: id(99), name: "x" } })).status, 422);
  });
});

describe("recording a deposit", () => {
  test("201 with the DTO: the next entry number, stamped now in IST, recorded by the session's person, paise as an integer", async () => {
    const a = await created("editor", { amountPaise: 2400000, instruction: "  Walk-in guests  " });
    const b = await created("editor");
    assert.deepEqual([a.entryNo, b.entryNo], [1, 2]);
    assert.equal(a.at, "2026-10-05T04:30:00.000Z");
    assert.deepEqual(a.recordedBy, { id: U.editor, name: "Asha Editor" });
    assert.equal(a.amountPaise, 2400000);
    assert.equal(a.instruction, "Walk-in guests", "trimmed");
    assert.equal(a.version, 1);
    assert.equal(a.isLatest, true, "it was the newest when it was saved");
    assert.equal(b.isLatest, true);
    assert.equal(a.book, "hotel");
  });
  test("the amount in words is worked out and stored; the recorder's name is kept (20 characters); entries are per book", async () => {
    const row = await created("editor", { amountPaise: 12345600 });
    const stored = cash.store.dataFor(HOTEL_A).deposits.hotel.find((r) => r.id === row.id);
    assert.equal(stored?.amountInWords, "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only");
    assert.equal(stored?.fullName, "Asha Editor");
    assert.equal((await created("editor", { book: "food", depositor: "Hitesh Parmar (Chef)" })).entryNo, 1);
  });
  test("an empty instruction is stored as null", async () => {
    assert.equal((await created("editor", { instruction: "   " })).instruction, null);
  });
  test("the system log gets one line in the same unit: Pallav's words, the entry number as label, money in paise", async () => {
    const row = await created("editor", { amountPaise: 150000, instruction: "cash" });
    assert.equal(logs().length, 1);
    const line = logs()[0];
    assert.deepEqual([line.module, line.action, line.entity, line.summary, line.subjectLabel, line.subjectId], ["revenue", "created", "Hotel deposit", "Added Hotel deposit: 0001", "0001", row.id]);
    assert.deepEqual(line.details, { Depositor: "Front desk", "Amount (paise)": 150000, Instruction: "cash", Date: "05-10-2026" });
    assert.deepEqual([line.userId, line.userName], [U.editor, "Asha Editor"]);
    assert.match(line.traceId ?? "", /^[A-Za-z0-9_-]{8,64}$/);
  });
  test("if the log cannot be written the deposit is not saved either (one transaction)", async () => {
    wire({ failLog: true });
    await seed();
    const res = await create("editor");
    assert.equal(res.status, 500);
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel.length, 0);
  });
  test("Idempotency-Key: the same key and request is one deposit; the second answer is a replay", async () => {
    const key = { "idempotency-key": "key-revenue-0001" };
    const first = await create("editor", {}, key);
    const second = await create("editor", {}, key);
    assert.equal(first.status, 201);
    assert.equal(second.headers.get("idempotent-replayed"), "true");
    assert.equal((await list("viewer")).data.total, 1);
  });
});

describe("validation: Pallav's messages, word for word", () => {
  const msg = async (over: Record<string, unknown>) => fieldsOf(await create("admin", over));
  test("depositor: empty, not on the book's list, too long", async () => {
    assert.equal((await msg({ depositor: "" })).depositor, "Choose who is depositing.");
    assert.equal((await msg({ depositor: "  " })).depositor, "Choose who is depositing.");
    assert.equal((await msg({ depositor: "Somebody else" })).depositor, "Choose a depositor from the Hotel list. The SuperAdmin adds names in Master Data.");
    assert.equal((await msg({ book: "food", depositor: "Front desk" })).depositor, "Choose a depositor from the Food list. The SuperAdmin adds names in Master Data.");
    assert.equal((await msg({ depositor: "x".repeat(101) })).depositor, "The depositor field must not be greater than 100 characters.");
  });
  test("amount: missing, below 0.01, above 9999999999.99", async () => {
    assert.equal((await msg({ amountPaise: null })).amount, "The amount field is required.");
    assert.equal((await msg({ amountPaise: 0 })).amount, "The amount field must be at least 0.01.");
    assert.equal((await msg({ amountPaise: -5 })).amount, "The amount field must be at least 0.01.");
    assert.equal((await msg({ amountPaise: 1_000_000_000_000 })).amount, "The amount field must not be greater than 9999999999.99.");
    assert.equal((await create("admin", { amountPaise: 999_999_999_999 })).status, 201, "the maximum is allowed");
    assert.equal((await create("admin", { amountPaise: 1 })).status, 201, "one paise is allowed");
  });
  test("instruction: more than 500 characters", async () => {
    assert.equal((await msg({ instruction: "x".repeat(501) })).instruction, "The instruction field must not be greater than 500 characters.");
    assert.equal((await create("admin", { instruction: "x".repeat(500) })).status, 201);
  });
  test("several problems are reported together, and the values are never echoed back", async () => {
    const res = await create("admin", { depositor: "secret-name-not-listed", amountPaise: 0 });
    const text = await res.text();
    assert.equal(res.status, 422);
    assert.ok(text.includes("depositor") && text.includes("amount") && !text.includes("secret-name-not-listed"));
  });
});

describe("the date and time stamp", () => {
  test("a person without system.backdate cannot choose it: the stamp is ignored and the moment of saving is used", async () => {
    const row = await created("editor", { stamp: { date: "2026-09-01", time: "08:15" } });
    assert.equal(row.at, "2026-10-05T04:30:00.000Z");
  });
  test("a person with system.backdate may choose it; HH:MM becomes HH:MM:00", async () => {
    const row = await created("admin", { stamp: { date: "2026-09-01", time: "08:15" } });
    assert.equal(row.at, "2026-09-01T02:45:00.000Z");
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel[0].time, "08:15:00");
  });
  test("a chosen date in the future, or a bad date or time, is refused with Laravel's wording", async () => {
    assert.equal((await fieldsOf(await create("admin", { stamp: { date: "2026-10-06", time: "08:15" } }))).date, "The date field must be a date before or equal to today.");
    assert.equal((await fieldsOf(await create("admin", { stamp: { date: "2026-13-40", time: "08:15" } }))).date, "The date field must be a valid date.");
    assert.equal((await fieldsOf(await create("admin", { stamp: { date: "2026-10-05", time: "25:00" } }))).time, "The time field must match the format HH:MM.");
  });
  test("an edit keeps the original date and time unless the person may choose them", async () => {
    const row = await created("editor");
    clock = new Date("2026-10-05T15:00:00+05:30");
    const res = await patch("editor", row.id, { version: 1, amountPaise: 200000, stamp: { date: "2026-09-01", time: "08:15" } });
    assert.equal((await body(res)).data.at, row.at);
  });
  test("IST midnight: 23:59:59 IST is still today, 00:00:00 IST is tomorrow", async () => {
    clock = new Date("2026-10-05T23:59:59+05:30");
    assert.equal((await created("editor")).at, "2026-10-05T18:29:59.000Z");
    clock = new Date("2026-10-06T00:00:00+05:30");
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel[0].date, "2026-10-05");
    await created("editor");
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel[1].date, "2026-10-06");
  });
});

describe("editing", () => {
  test("only the latest entry of a book can be edited; the refusal says so", async () => {
    const first = await created("editor");
    await created("editor");
    const res = await patch("editor", first.id, { version: 1, amountPaise: 5 });
    assert.equal(res.status, 403);
    assert.equal((await body(res)).error.message, "Only the latest deposit in a book can be edited.");
  });
  test("the newest entry: the owner may edit it, and so may an admin; someone else may not", async () => {
    const row = await created("editor");
    const other = await patch("editor2", row.id, { version: 1, amountPaise: 5 });
    assert.equal(other.status, 403);
    assert.equal((await body(other)).error.message, "You are not allowed to edit this deposit.");
    assert.equal((await patch("admin", row.id, { version: 1, amountPaise: 5 })).status, 200);
  });
  test("an admin cannot edit a super admin's entry; the super admin can edit anyone's", async () => {
    const mine = await created("super");
    assert.equal((await patch("admin", mine.id, { version: 1, amountPaise: 5 })).status, 403);
    const theirs = await created("editor");
    assert.equal((await patch("super", theirs.id, { version: 1, amountPaise: 5 })).status, 200);
  });
  test("a success raises the version, changes the amount in words and logs only what moved, in Pallav's words", async () => {
    const row = await created("editor", { amountPaise: 150000 });
    const res = await patch("editor", row.id, { version: 1, amountPaise: 250000, depositor: "Ashok Desai (Manager)" });
    const out = (await body(res)).data as CashDeposit;
    assert.equal(out.version, 2);
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel[0].amountInWords, "Two Thousand Five Hundred Rupees Only");
    const line = logs()[1];
    assert.equal(line.summary, "Changed Hotel deposit: 0001 (Depositor, Amount (paise))");
    assert.equal((line.details as Record<string, string>)["Amount (paise)"], "was 150000, became 250000");
    assert.equal((line.details as Record<string, string>).Depositor, "was Front desk, became Ashok Desai (Manager)");
  });
  test("saving with no change is logged as such", async () => {
    const row = await created("editor");
    await patch("editor", row.id, { version: 1 });
    assert.equal(logs()[1].summary, "Saved Hotel deposit: 0001 with no change");
  });
  test("a stale version is 409 CONFLICT with the current version; nothing changes", async () => {
    const row = await created("editor");
    await patch("editor", row.id, { version: 1, amountPaise: 200000 });
    const stale = await patch("editor", row.id, { version: 1, amountPaise: 300000 });
    assert.equal(stale.status, 409);
    assert.equal((await body(stale)).error.details.currentVersion, 2);
    assert.equal(cash.store.dataFor(HOTEL_A).deposits.hotel[0].amountPaise, BigInt(200000));
  });
  test("a body without a version is 422; the book of a saved deposit cannot change", async () => {
    const row = await created("editor");
    assert.equal((await updateRoute(req("PATCH", `/x/${row.id}`, "editor", input()), ctx({ id: row.id }))).status, 422);
    const res = await patch("editor", row.id, { version: 1, book: "food", depositor: "Hitesh Parmar (Chef)" });
    assert.equal((await fieldsOf(res)).book, "The cash book of a saved deposit cannot change.");
  });
  test("an edit may keep a depositor that has since been taken off the list; a new name must be on it", async () => {
    const row = await created("editor");
    cash.store.dataFor(HOTEL_A).lists.revenue_depositor_hotel = ["Ashok Desai (Manager)"];
    assert.equal((await patch("editor", row.id, { version: 1, amountPaise: 5 })).status, 200);
    assert.equal((await fieldsOf(await patch("editor", row.id, { version: 2, depositor: "Front desk 2" }))).depositor, "Choose a depositor from the Hotel list. The SuperAdmin adds names in Master Data.");
  });
  test("the newest entry is by date and time, not by number: a backdated newer entry does not become the newest", async () => {
    const early = await created("admin");
    const backdated = await created("admin", { stamp: { date: "2026-09-01", time: "08:00" } });
    assert.equal(backdated.isLatest, false);
    assert.equal((await getRoute(req("GET", "/x", "viewer"), ctx({ id: early.id }))).status, 200);
    assert.equal((await body(await getRoute(req("GET", "/x", "viewer"), ctx({ id: early.id })))).data.isLatest, true);
    assert.equal((await patch("admin", backdated.id, { version: 1, amountPaise: 5 })).status, 403, "entry 2 is not at the top of the book");
    assert.equal((await patch("admin", early.id, { version: 1, amountPaise: 5 })).status, 200);
  });
  test("force mode: the super admin may correct a closed entry, and it is written to the force log and the platform audit", async () => {
    const first = await created("editor");
    await created("editor");
    const res = await patch("force", first.id, { version: 1, amountPaise: 777 });
    assert.equal(res.status, 200);
    const force = cash.store.dataFor(HOTEL_A).forceLogs;
    assert.equal(force.length, 1);
    assert.equal(force[0].summary, "Forced past a lock: Edited a closed revenue entry");
    assert.deepEqual(auditEvents.map((e) => e.action), ["force.override"]);
    assert.equal((await patch("super", first.id, { version: 2, amountPaise: 5 })).status, 403, "without force mode armed it is refused");
  });
});

describe("who the SuperAdmin is: the hotel's permission role, never the account role", () => {
  test("a hotel_admin account holding the built-in super_admin role may restore and purge; the platform owner account without that role may not", async () => {
    const row = await created("editor");
    await del("admin", row.id, 1);
    assert.equal((await restore("platformOwner", row.id, 2)).status, 403);
    assert.equal((await purge("platformOwner", row.id)).status, 403);
    assert.equal((await list("platformOwner", "?deleted=only")).status, 403);
    assert.equal((await restore("super", row.id, 2)).status, 200);
  });
  test("force mode belongs to the hotel SuperAdmin role: armed on the platform owner it does nothing", async () => {
    const first = await created("editor");
    await created("editor");
    assert.equal((await patch("platformOwnerForce", first.id, { version: 1, amountPaise: 5 })).status, 403);
    assert.equal((await patch("force", first.id, { version: 1, amountPaise: 5 })).status, 200);
  });
  test("an admin may manage an entry of someone at or below their level, never a SuperAdmin's; the platform owner counts as an ordinary admin here", async () => {
    const supers = await created("super");
    assert.equal((await patch("platformOwner", supers.id, { version: 1, amountPaise: 5 })).status, 403);
    assert.equal((await del("platformOwner", supers.id, 1)).status, 403);
    const editors = await created("editor");
    assert.equal((await patch("platformOwner", editors.id, { version: 1, amountPaise: 5 })).status, 200);
  });
});

describe("deleting, the recycle bin and entry numbers", () => {
  test("only an admin may delete; the refusal says so", async () => {
    const row = await created("editor");
    assert.equal((await del("editor", row.id, 1)).status, 403, "no delete permission at all");
    const res = await del("deleter", row.id, 1);
    assert.equal(res.status, 403);
    assert.equal((await body(res)).error.message, "Only an Admin or the SuperAdmin can delete an entry.");
  });
  test("an admin may delete any entry, old or new; never over a super admin's entry; the super admin may", async () => {
    const old = await created("editor");
    await created("editor");
    assert.equal((await del("admin", old.id, 1)).status, 200);
    const supers = await created("super");
    const refused = await del("admin", supers.id, 1);
    assert.equal(refused.status, 403);
    assert.equal((await body(refused)).error.message, "You are not allowed to delete this entry.");
    assert.equal((await del("super", supers.id, 1)).status, 200);
  });
  test("a delete is a soft delete: gone from the list and the totals, in the bin for a super admin, the number still taken", async () => {
    const a = await created("editor");
    const b = await created("editor", { amountPaise: 50000 });
    await del("admin", b.id, 1);
    assert.equal((await list("viewer")).data.total, 1);
    assert.equal((await list("viewer")).data.shownTotalPaise, 150000);
    assert.equal((await getRoute(req("GET", "/x", "viewer"), ctx({ id: b.id }))).status, 404);
    assert.equal((await list("super", "?deleted=only")).data.items[0].id, b.id);
    assert.equal((await created("editor")).entryNo, 3, "entry 2 keeps its number while it is in the bin");
    assert.ok(a);
  });
  test("the recycle bin list is for the super admin only", async () => {
    assert.equal((await list("admin", "?deleted=only")).status, 403);
    assert.equal((await list("viewer", "?deleted=only")).status, 403);
  });
  test("the log line holds what the deposit held when it went", async () => {
    const row = await created("editor", { instruction: "cash" });
    await del("admin", row.id, 1);
    const line = logs()[1];
    assert.deepEqual([line.action, line.summary], ["deleted", "Removed Hotel deposit: 0001"]);
    assert.deepEqual(line.details, { Depositor: "Front desk", "Amount (paise)": 150000, Instruction: "cash", Date: "05-10-2026" });
  });
  test("a stale version on delete is 409", async () => {
    const row = await created("editor");
    await patch("editor", row.id, { version: 1, amountPaise: 2 });
    const res = await del("admin", row.id, 1);
    assert.equal(res.status, 409);
    assert.equal((await body(res)).error.details.currentVersion, 2);
  });
  test("restore: super admin only; clears the delete, raises the version, writes a recycle-bin log line", async () => {
    const row = await created("editor");
    await del("admin", row.id, 1);
    assert.equal((await restore("admin", row.id, 2)).status, 403);
    const res = await restore("super", row.id, 2);
    assert.equal(res.status, 200);
    assert.equal((await body(res)).data.version, 3);
    assert.equal((await list("viewer")).data.total, 1);
    const line = logs().at(-1);
    assert.deepEqual([line?.module, line?.summary, line?.details], ["recycle-bin", "Added Hotel deposit: 0001", { "Restored by": "Sonal Super" }]);
    assert.equal((await restore("super", row.id, 3)).status, 404, "a live deposit is not in the bin");
  });
  test("purge: super admin only; only from the bin; the last number comes round again, a middle one stays a gap", async () => {
    const a = await created("editor");
    const b = await created("editor");
    assert.equal((await purge("super", b.id)).status, 404, "a live deposit is never purged");
    await del("admin", b.id, 1);
    assert.equal((await purge("admin", b.id)).status, 403);
    assert.equal((await purge("super", b.id)).status, 200);
    assert.equal((await created("editor")).entryNo, 2, "the number of the last entry is free again");
    await del("admin", a.id, 1);
    await purge("super", a.id);
    assert.equal((await created("editor")).entryNo, 3, "entry 1 is a gap: the next is one past the highest");
  });
});

describe("the accounting-year lock", () => {
  test("an entry dated in a closed year cannot be recorded", async () => {
    const res = await create("admin", { stamp: { date: "2026-03-15", time: "10:00" } });
    assert.equal(res.status, 422);
    assert.equal((await fieldsOf(res)).date, "2025-26 is closed, so nothing can be dated 15 Mar 2026. Only 2026-27 (Apr 2026 - Mar 2027) takes entries.");
  });
  test("an entry of a closed year cannot be changed or deleted", async () => {
    const data = cash.store.dataFor(HOTEL_A);
    const row = await created("admin");
    data.deposits.hotel[0].date = "2026-03-15";
    const edit = await patch("admin", row.id, { version: 1, amountPaise: 5 });
    assert.equal((await fieldsOf(edit)).date, "2025-26 is closed, so an entry dated 15 Mar 2026 cannot be changed. Only 2026-27 (Apr 2026 - Mar 2027) takes entries.");
    const gone = await del("admin", row.id, 1);
    assert.equal((await fieldsOf(gone)).date, "2025-26 is closed, so an entry dated 15 Mar 2026 cannot be deleted. Only 2026-27 (Apr 2026 - Mar 2027) takes entries.");
  });
  test("dates before the first year are history the years never covered: not locked", async () => {
    assert.equal((await create("admin", { stamp: { date: "2025-01-10", time: "10:00" } })).status, 201);
  });
  test("with no accounting year there is no lock", async () => {
    cash.store.dataFor(HOTEL_A).years = [];
    assert.equal((await create("admin", { stamp: { date: "2020-01-10", time: "10:00" } })).status, 201);
  });
  test("force mode steps past the lock and writes it to the force log", async () => {
    const res = await create("force", { stamp: { date: "2026-03-15", time: "10:00" } });
    assert.equal(res.status, 201);
    assert.equal(cash.store.dataFor(HOTEL_A).forceLogs[0].summary, "Forced past a lock: Accounting year lock");
  });
  test("the message for a date in a year not started yet", () => {
    const years = [
      { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
      { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
    ];
    assert.throws(
      () => guardBooks({ years, was: null, now: "2027-04-02", action: "save" }),
      (e: unknown) => e instanceof AppError && e.details?.fields?.date === "02 Apr 2027 is in 2027-28, which has not been started yet. An Admin can start it from the year menu in the header. Until then, entries up to 31 Mar 2027 can still be made.",
    );
  });
});

describe("the list screen", () => {
  test("newest first by date and time; books, counts and the total of every page", async () => {
    await created("admin", { amountPaise: 100000, stamp: { date: "2026-10-01", time: "09:00" } });
    await created("admin", { amountPaise: 200000, stamp: { date: "2026-10-03", time: "09:00" } });
    await created("admin", { amountPaise: 300000, book: "food", depositor: "Hitesh Parmar (Chef)", stamp: { date: "2026-10-02", time: "09:00" } });
    const all = (await list("viewer")).data;
    assert.deepEqual(all.items.map((i) => [i.book, i.entryNo]), [["hotel", 2], ["food", 1], ["hotel", 1]]);
    assert.deepEqual(all.counts, { all: 3, hotel: 2, food: 1 });
    assert.equal(all.shownTotalPaise, 600000);
    const food = (await list("viewer", "?book=food")).data;
    assert.equal(food.total, 1);
    assert.equal(food.shownTotalPaise, 300000);
    assert.deepEqual(food.counts, { all: 3, hotel: 2, food: 1 }, "the tabs keep their own counts");
  });
  test("the numbers on top: today and this month in IST, hotel and food separately", async () => {
    await created("admin", { amountPaise: 100000 });
    await created("admin", { amountPaise: 20000, stamp: { date: "2026-10-01", time: "09:00" } });
    await created("admin", { amountPaise: 3000, book: "food", depositor: "Hitesh Parmar (Chef)" });
    await created("admin", { amountPaise: 400, stamp: { date: "2026-09-30", time: "23:59" } });
    const stats = (await list("viewer")).data.stats;
    assert.deepEqual(stats, { todayPaise: 103000, monthPaise: 123000, hotelMonthPaise: 120000, foodMonthPaise: 3000 });
    const foodOnly = (await list("viewer", "?book=food")).data.stats;
    assert.deepEqual(foodOnly, { todayPaise: 3000, monthPaise: 3000, hotelMonthPaise: 120000, foodMonthPaise: 3000 });
  });
  test("this month rolls over at IST midnight", async () => {
    clock = new Date("2026-10-31T23:00:00+05:30");
    await created("admin", { amountPaise: 700, stamp: { date: "2026-10-31", time: "23:59" } });
    clock = new Date("2026-10-31T18:29:59Z");
    assert.equal((await list("viewer")).data.stats.monthPaise, 700);
    clock = new Date("2026-10-31T18:30:00Z");
    assert.equal((await list("viewer")).data.stats.monthPaise, 0, "it is 1 November in IST");
  });
  test("search is Pallav's: words in any order, quotes, -word, amounts, the recorder's name, #0001; and it is only text", async () => {
    await created("admin", { amountPaise: 2400000, instruction: "Walk-in guests, 3 rooms" });
    await created("editor", { amountPaise: 150050, instruction: "50% advance" });
    await created("editor", { amountPaise: 999, instruction: "o'brien'; DROP TABLE x;--" });
    const q = async (s: string) => (await list("viewer", `?search=${encodeURIComponent(s)}`)).data.items.map((i) => i.entryNo).sort();
    assert.deepEqual(await q("rooms walk-in"), [1]);
    assert.deepEqual(await q('"walk-in guests"'), [1]);
    assert.deepEqual(await q("-asha"), [1], "Asha Editor recorded entries 2 and 3");
    assert.deepEqual(await q("asha"), [2, 3]);
    assert.deepEqual(await q(">10000"), [1]);
    assert.deepEqual(await q("1500-1600"), [2]);
    assert.deepEqual(await q("24,000"), [1]);
    assert.deepEqual(await q("#0003"), [3]);
    assert.deepEqual(await q("50%"), [2]);
    assert.deepEqual(await q("%"), [1, 2, 3], "a lone % is only punctuation: nothing to match, so every row");
    assert.deepEqual(await q("'; drop table"), [3]);
    assert.deepEqual(await q("twenty four thousand"), [1]);
  });
  test("paging: 10, 25, 50 or 100 per page; page 2; anything else is refused", async () => {
    for (let i = 0; i < 12; i++) await created("admin", { amountPaise: 100 + i });
    const page2 = (await list("viewer", "?pageSize=10&page=2")).data;
    assert.deepEqual([page2.items.length, page2.total, page2.page, page2.pageSize], [2, 12, 2, 10]);
    for (const qs of ["?pageSize=7", "?pageSize=1000", "?page=0", "?pageSize=abc"]) assert.equal((await list("viewer", qs)).status, 422, qs);
  });
  test("sort is a whitelist; a hostile sort, a repeated name or an unknown filter is refused", async () => {
    await created("admin", { amountPaise: 500 });
    await created("admin", { amountPaise: 100 });
    assert.deepEqual((await list("viewer", "?sort=amountPaise&dir=asc")).data.items.map((i) => i.amountPaise), [100, 500]);
    for (const qs of ["?sort=password_hash", "?sort=amountPaise;DROP TABLE x", "?dir=up", "?book=all&book=hotel", "?year=2026", "?search=a%00b"]) assert.equal((await list("viewer", qs)).status, 422, qs);
  });
  test("the date range and isLatest", async () => {
    await created("admin", { stamp: { date: "2026-09-01", time: "09:00" } });
    await created("admin", { stamp: { date: "2026-10-02", time: "09:00" } });
    const ranged = (await list("viewer", "?from=2026-10-01&to=2026-10-05")).data;
    assert.equal(ranged.total, 1);
    assert.equal(ranged.items[0].isLatest, true);
  });
});

describe("hotel isolation", () => {
  test("hotel B cannot read, edit, delete, restore or purge hotel A's deposit (404); each hotel numbers from 1", async () => {
    await seed(HOTEL_B);
    const row = await created("editor", { instruction: "A only" });
    for (const res of [
      await getRoute(req("GET", "/x", "adminB"), ctx({ id: row.id })),
      await patch("adminB", row.id, { version: 1 }),
      await del("adminB", row.id, 1),
    ]) assert.equal(res.status, 404);
    assert.equal((await list("adminB")).data.total, 0);
    const mine = await (async () => {
      const res = await create("adminB");
      return ((await body(res)).data as CashDeposit).entryNo;
    })();
    assert.equal(mine, 1);
    assert.equal(logs(HOTEL_B).length, 1);
    assert.equal(logs(HOTEL_A).length, 1);
  });
});

describe("contract: the answers against ui-shared", () => {
  const dto: CashDeposit = {
    id: "x", version: 1, entryNo: 1, at: "2026-10-05T04:30:00.000Z", recordedBy: { id: "x", name: "x" }, createdAt: "x", updatedAt: "x", isLatest: true,
    book: "hotel", depositor: "x", amountPaise: 1, instruction: null,
  };
  test("a deposit has exactly the CashDeposit keys", async () => {
    assertMatchesContract(await created("editor", { instruction: "note" }), dto, "deposit");
  });
  test("the list has exactly the CashList keys (items, total, page, pageSize, stats, counts, shownTotalPaise)", async () => {
    await created("editor");
    const sample: CashList<CashDeposit> = {
      items: [dto], total: 1, page: 1, pageSize: 25,
      stats: { todayPaise: 1, monthPaise: 1, hotelMonthPaise: 1, foodMonthPaise: 1 },
      counts: { all: 1, hotel: 1, food: 1 },
      shownTotalPaise: 1,
    };
    assertMatchesContract((await list("viewer")).data, sample, "list");
  });
  test("a conflict carries currentVersion and a validation error carries fields, as ui-shared DashError says", async () => {
    const row = await created("editor");
    await patch("editor", row.id, { version: 1 });
    const conflict = (await body(await patch("editor", row.id, { version: 1 }))).error;
    assert.deepEqual(Object.keys(conflict).sort(), ["code", "details", "message", "traceId"]);
    assert.deepEqual(Object.keys(conflict.details), ["currentVersion"]);
  });
});
