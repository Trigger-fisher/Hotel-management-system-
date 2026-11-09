// Billing, Guest Advances, end to end through the REAL route files, the wrapper, the service and the in-memory repositories.
// Expected behaviour comes from docs/specs/billing-advances.md (each rule there cites Pallav's file and line).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Advance, AdvancePreview } from "@shared/dashboards/billing";
import { GET as previewRoute } from "../../src/app/api/v1/billing/advances/[id]/preview/route";
import { GET as openRoute } from "../../src/app/api/v1/billing/advances/open/route";
import { DELETE as purgeRoute } from "../../src/app/api/v1/billing/advances/[id]/purge/route";
import { DELETE as undoRefundRoute, POST as refundRoute } from "../../src/app/api/v1/billing/advances/[id]/refund/route";
import { POST as restoreRoute } from "../../src/app/api/v1/billing/advances/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/billing/advances/[id]/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/billing/advances/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureBillingAdvances } from "../../src/server/compose/billing";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { BillRecord } from "../../src/server/repos/billing";
import { createMemoryBilling } from "../../src/server/repos/memory/billing";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import type { Person } from "../../src/server/services/cash/ports";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { viewer: id(1), creator: id(2), editor: id(3), admin: id(4), superAdmin: id(5), nobody: id(6), full: id(7), adminB: id(8) };
const COMPANY = id(100);
const people = new Map<string, Person>([
  [U.viewer, { id: U.viewer, name: "Vera Viewer", roleKey: "viewer", roleLevel: 1, deleted: false }],
  [U.creator, { id: U.creator, name: "Chetan Creator", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.editor, { id: U.editor, name: "Asha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [U.full, { id: U.full, name: "Farah Full", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.adminB, { id: U.adminB, name: "Beena Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);

const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("bills.advances", "view")] });
mk("creator", U.creator, { grants: [grant("bills.advances", "create")] });
mk("editor", U.editor, { grants: [grant("bills.advances", "edit")] });
mk("full", U.full, { grants: [grant("bills.advances", "full")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("bills", "full"), grant("users", "full")] });
mk("force", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("bills", "full"), grant("users", "full"), grant("system.force", "full")] });
sessions.set("force", { ...(sessions.get("force") as VerifiedSession), forceMode: true });
mk("nobody", U.nobody, {});
mk("cashOnly", U.nobody, { grants: [grant("revenue", "full")] });
mk("adminB", U.adminB, { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let billing = createMemoryBilling();
let auditEvents: { action: string }[] = [];

function wire(overrides: { failLog?: boolean } = {}): void {
  billing = createMemoryBilling();
  auditEvents = [];
  const base = billing.unit;
  const unit = overrides.failLog
    ? { run: <T>(s: Parameters<typeof base.run>[0], work: Parameters<typeof base.run<T>>[1]) => base.run(s, (repos) => work({ ...repos, systemLogs: { write: async () => { throw new Error("log table is down"); } } })) }
    : base;
  configureBillingAdvances(createAdvanceService({ unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async (e) => void auditEvents.push(e) }, catalog, now: () => clock }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  for (const hotel of [HOTEL_A, HOTEL_B]) {
    const data = billing.store.dataFor(hotel);
    data.companies.set(COMPANY, "Infosys Rajkot");
    data.years = [
      { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
      { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
    ];
  }
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
const json = async (res: Response) => (await res.json()) as any;

const input = (over: Record<string, unknown> = {}) => ({
  receiptNo: "814", paymentDate: "2026-10-05", guestName: "Ravi Mehta", mobile: "9876543210", companyId: null, roomNo: "204", covers: "hotel",
  hotelPaise: 500000, foodPaise: null, hotelMode: "UPI", foodMode: null, referenceName: "", referenceMobile: "", instruction: "", ...over,
});
const refundInput = (version: number, over: Record<string, unknown> = {}) => ({ date: "2026-10-06", hotelPaise: 100000, foodPaise: null, hotelMode: "Cash", foodMode: null, toName: "Ravi", toMobile: "", note: "", version, ...over });

async function create(who = "creator", over: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Response> {
  return createRoute(req("POST", "/api/v1/billing/advances", who, input(over), headers));
}
async function created(over: Record<string, unknown> = {}, who = "creator"): Promise<Advance & { version: number; entryNo: number }> {
  const res = await create(who, over);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const list = async (who: string, query = "") => listRoute(req("GET", `/api/v1/billing/advances${query}`, who));
const getOne = async (who: string, advanceId: string) => getRoute(req("GET", `/api/v1/billing/advances/${advanceId}`, who), ctx({ id: advanceId }));
const update = async (who: string, advanceId: string, body: unknown) => updateRoute(req("PATCH", `/api/v1/billing/advances/${advanceId}`, who, body), ctx({ id: advanceId }));
const remove = async (who: string, advanceId: string, version: number) => removeRoute(req("DELETE", `/api/v1/billing/advances/${advanceId}`, who, { version }), ctx({ id: advanceId }));
const refund = async (who: string, advanceId: string, body: unknown) => refundRoute(req("POST", `/api/v1/billing/advances/${advanceId}/refund`, who, body), ctx({ id: advanceId }));
const undoRefund = async (who: string, advanceId: string, version: number) => undoRefundRoute(req("DELETE", `/api/v1/billing/advances/${advanceId}/refund`, who, { version }), ctx({ id: advanceId }));
const data = (hotel = HOTEL_A) => billing.store.dataFor(hotel);
/** What a bill taking money off does to an advance (B2), set directly: balances below the amounts. */
const spend = (advanceId: string, hotelBalance: number, hotel = HOTEL_A): void => {
  const row = data(hotel).advances.find((a) => a.id === advanceId);
  if (row) row.hotelBalancePaise = BigInt(hotelBalance);
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("record an advance (storeAdvance)", () => {
  test("201: the year goes in front of the receipt, balances equal the amounts, the side not covered is empty, entry number 1", async () => {
    const a = await created({ foodPaise: 99999, foodMode: "Cash" });
    assert.equal(a.receiptNo, "2026 / 814");
    assert.equal(a.hotelPaise, 500000);
    assert.equal(a.foodPaise, 0, "covers hotel: the food amount is not taken");
    assert.equal(a.foodMode, null);
    assert.equal(a.hotelBalancePaise, 500000);
    assert.equal(a.refund, null);
    assert.equal(a.entryNo, 1);
    assert.equal(a.version, 1);
    const row = data().advances[0];
    assert.equal(row.totalPaise, BigInt(500000));
    assert.equal(row.createdBy, U.creator, "the person recording comes from the session");
  });
  test("both sides; a side of 0 has no mode", async () => {
    const a = await created({ covers: "both", hotelPaise: 0, foodPaise: 25000, foodMode: "Card" });
    assert.equal(a.hotelMode, null);
    assert.equal(a.foodMode, "Card");
    assert.equal(data().advances[0].totalPaise, BigInt(25000));
  });
  test("the receipt year is the IST year at saving, not the payment date's year", async () => {
    clock = new Date("2026-12-31T18:30:00Z"); // 1 Jan 2027 00:00 IST
    const res = await create("creator", { receiptNo: "1", paymentDate: "2026-12-31" });
    assert.equal((await json(res)).data.receiptNo, "2027 / 1");
  });
  test("a receipt number already used: Pallav's message; a soft-deleted one does not count", async () => {
    const first = await created();
    let res = await create();
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.details.fields.receiptNo, "This receipt number already exists.");
    await remove("admin", first.id, first.version);
    res = await create();
    assert.equal(res.status, 201);
  });
  test("nothing paid: 'Enter how much the guest paid.' on the hotel amount", async () => {
    const res = await create("creator", { hotelPaise: 0 });
    assert.equal(res.status, 422);
    assert.deepEqual((await json(res)).error.details.fields, { hotelPaise: "Enter how much the guest paid." });
    const res2 = await create("creator", { covers: "food", hotelPaise: 5000, foodPaise: null });
    assert.equal((await json(res2)).error.details.fields.hotelPaise, "Enter how much the guest paid.");
  });
  test("Laravel's words for every field rule", async () => {
    const res = await create("creator", {
      receiptNo: " ", guestName: "", paymentDate: "2026-02-30", mobile: "1".repeat(16), roomNo: "r".repeat(21), companyId: id(999), hotelPaise: -1,
      hotelMode: "m".repeat(21), referenceName: "n".repeat(256), referenceMobile: "2".repeat(16), instruction: "i".repeat(256),
    });
    assert.equal(res.status, 422);
    assert.deepEqual((await json(res)).error.details.fields, {
      receiptNo: "The receipt number field is required.",
      guestName: "The guest name field is required.",
      paymentDate: "The payment date field must be a valid date.",
      mobile: "The mobile number field must not be greater than 15 characters.",
      roomNo: "The room number field must not be greater than 20 characters.",
      companyId: "The selected company id is invalid.",
      hotelPaise: "The hotel amount field must be at least 0.",
      hotelMode: "The hotel mode field must not be greater than 20 characters.",
      referenceName: "The reference name field must not be greater than 255 characters.",
      referenceMobile: "The reference mobile number field must not be greater than 15 characters.",
      instruction: "The instruction field must not be greater than 255 characters.",
    });
  });
  test("long receipt and guest name; missing payment date", async () => {
    const res = await create("creator", { receiptNo: "9".repeat(51), guestName: "g".repeat(256), paymentDate: "" });
    assert.deepEqual((await json(res)).error.details.fields, {
      receiptNo: "The receipt number field must not be greater than 50 characters.",
      guestName: "The guest name field must not be greater than 255 characters.",
      paymentDate: "The payment date field is required.",
    });
  });
  test("lengths count characters, not bytes (a 15-character Gujarati name is fine)", async () => {
    const res = await create("creator", { mobile: "૧".repeat(15) });
    assert.equal(res.status, 201);
  });
  test("a company that exists gives its name; text is trimmed and empty becomes nothing", async () => {
    const a = await created({ companyId: COMPANY, guestName: "  Ravi  ", referenceName: "   " });
    assert.equal(a.companyName, "Infosys Rajkot");
    assert.equal(a.guestName, "Ravi");
    assert.equal(data().advances[0].referenceName, null);
  });
  test("identity, balances and entry numbers cannot be sent (unknown keys refused)", async () => {
    for (const extra of [{ createdBy: U.admin }, { hotelId: HOTEL_B }, { hotelBalancePaise: 1 }, { entryNo: 5 }, { version: 1 }]) {
      const res = await createRoute(req("POST", "/api/v1/billing/advances", "creator", { ...input(), ...extra }));
      assert.equal(res.status, 422, JSON.stringify(extra));
    }
  });
  test("a fraction of a paisa is refused by the shape", async () => {
    const res = await create("creator", { hotelPaise: 10.5 });
    assert.equal(res.status, 422);
  });
  test("dated in a closed year: Pallav's year message on paymentDate", async () => {
    const res = await create("creator", { paymentDate: "2026-03-31" });
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.details.fields.paymentDate, "2025-26 is closed, so nothing can be dated 31 Mar 2026. Only 2026-27 (Apr 2026 - Mar 2027) takes entries.");
  });
  test("entry numbers: one past the highest, a deleted advance keeps its number", async () => {
    const a = await created({ receiptNo: "1" });
    await created({ receiptNo: "2" });
    await remove("admin", a.id, a.version);
    const c = await created({ receiptNo: "3" });
    assert.equal(c.entryNo, 3);
  });
  test("the system log line is written in the same unit: Added Advance: {receipt} ({guest})", async () => {
    await created();
    const line = data().systemLogs[0];
    assert.equal(line.module, "bills");
    assert.equal(line.action, "created");
    assert.equal(line.summary, "Added Advance: 2026 / 814 (Ravi Mehta)");
    assert.equal((line.details as Record<string, unknown>)["Hotel amount"], 500000);
    assert.equal((line.details as Record<string, unknown>)["Payment date"], "05-10-2026");
    assert.ok(line.traceId);
  });
  test("if the log cannot be written nothing is saved", async () => {
    wire({ failLog: true });
    const res = await create();
    assert.equal(res.status, 500);
    assert.equal(data().advances.length, 0);
  });
  test("idempotent: the same key and body replays, the same key with another body is refused", async () => {
    const key = { "idempotency-key": "adv-key-0000000001" };
    const first = await create("creator", {}, key);
    const again = await create("creator", {}, key);
    assert.equal(again.status, 201);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal((await json(again)).data.id, (await json(first)).data.id);
    assert.equal(data().advances.length, 1);
    const other = await create("creator", { receiptNo: "999" }, key);
    assert.equal(other.status, 422);
    assert.equal((await json(other)).error.code, "IDEMPOTENCY_KEY_REUSED");
  });
});

describe("permissions: MJ's four levels on bills.advances", () => {
  test("no permission: 403 everywhere; view: read only; create: record; edit: correct and refund; full: delete and reverse", async () => {
    const a = await created();
    assert.equal((await list("nobody")).status, 403);
    assert.equal((await list("cashOnly")).status, 403, "another module's permission does not reach billing");
    assert.equal((await list("viewer")).status, 200);
    assert.equal((await getOne("viewer", a.id)).status, 200);
    assert.equal((await create("viewer", { receiptNo: "x1" })).status, 403);
    assert.equal((await create("creator", { receiptNo: "x2" })).status, 201);
    assert.equal((await update("creator", a.id, { ...input(), version: 1 })).status, 403);
    assert.equal((await update("editor", a.id, { ...input({ guestName: "Ravi M" }), version: 1 })).status, 200);
    assert.equal((await remove("editor", a.id, 2)).status, 403);
    assert.equal((await refund("creator", a.id, refundInput(2))).status, 403);
    assert.equal((await refund("editor", a.id, refundInput(2))).status, 200);
    assert.equal((await undoRefund("editor", a.id, 3)).status, 403);
    assert.equal((await undoRefund("full", a.id, 3)).status, 200);
  });
  test("the module's full access covers the part", async () => {
    assert.equal((await create("admin")).status, 201);
  });
  test("no session: 401", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/billing/advances", null))).status, 401);
  });
});

describe("correct an advance (updateAdvance)", () => {
  test("an unused advance: fields, amounts and balances change; the receipt number never does; the version rises", async () => {
    const a = await created();
    const res = await update("editor", a.id, { ...input({ receiptNo: "IGNORED", guestName: "Ravi Mehta Jr", hotelPaise: 600000 }), version: 1 });
    assert.equal(res.status, 200);
    const b = (await json(res)).data;
    assert.equal(b.receiptNo, "2026 / 814");
    assert.equal(b.hotelPaise, 600000);
    assert.equal(b.hotelBalancePaise, 600000);
    assert.equal(b.version, 2);
    const line = data().systemLogs[1];
    assert.equal(line.summary, "Changed Advance: 2026 / 814 (Ravi Mehta Jr) (Guest name, Hotel amount, Hotel balance, Total)");
    assert.equal((line.details as Record<string, unknown>)["Hotel amount"], "was 500000, became 600000");
  });
  test("used or refunded: CONFLICT with Pallav's words", async () => {
    const a = await created();
    spend(a.id, 100000);
    const res = await update("editor", a.id, { ...input(), version: 1 });
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This advance has already been used or refunded and cannot be edited.");
  });
  test("someone else changed it: CONFLICT with the current version", async () => {
    const a = await created();
    await update("editor", a.id, { ...input({ guestName: "One" }), version: 1 });
    const res = await update("editor", a.id, { ...input({ guestName: "Two" }), version: 1 });
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.details.currentVersion, 2);
  });
  test("an advance of a closed year cannot be corrected; nor moved into one", async () => {
    const a = await created();
    data().advances[0].paymentDate = "2026-03-20";
    let res = await update("editor", a.id, { ...input({ paymentDate: "2026-03-20" }), version: 1 });
    assert.equal(res.status, 422);
    assert.match((await json(res)).error.details.fields.paymentDate, /^2025-26 is closed, so an entry dated 20 Mar 2026 cannot be changed\./);
    data().advances[0].paymentDate = "2026-10-05";
    res = await update("editor", a.id, { ...input({ paymentDate: "2026-03-01" }), version: 1 });
    assert.match((await json(res)).error.details.fields.paymentDate, /nothing can be dated 01 Mar 2026/);
  });
  test("force mode steps past the 'used' lock and writes the force log and the platform audit", async () => {
    const a = await created();
    spend(a.id, 100000);
    const res = await update("force", a.id, { ...input({ guestName: "Fixed" }), version: 1 });
    assert.equal(res.status, 200);
    assert.equal(data().forceLogs[0].summary, "Forced past a lock: This advance has already been used or refunded");
    assert.equal(auditEvents[0].action, "force.override");
  });
  test("force mode relaxes the field rules (empty guest name accepted) but keeps the date type", async () => {
    const a = await created();
    let res = await update("force", a.id, { ...input({ guestName: "", paymentDate: "" }), version: 1 });
    assert.equal(res.status, 200);
    assert.equal(data().advances[0].paymentDate, "2026-10-05", "an empty date becomes today (ForceMode::fill)");
    res = await update("force", a.id, { ...input({ paymentDate: "05/10/2026" }), version: 2 });
    assert.equal((await json(res)).error.details.fields.paymentDate, "The payment date field must be a valid date.");
  });
});

describe("delete an advance (destroyAdvance)", () => {
  test("only someone allowed to manage the creator: an editor with full access may delete their own, not another's", async () => {
    const own = await created({ receiptNo: "1" }, "full");
    const other = await created({ receiptNo: "2" });
    assert.equal((await remove("full", own.id, 1)).status, 200);
    const res = await remove("full", other.id, 1);
    assert.equal(res.status, 403);
    assert.equal((await json(res)).error.message, "Not allowed to delete this record.");
  });
  test("an admin may delete anyone's except a super admin's", async () => {
    const mine = await created({ receiptNo: "1" });
    const supers = await created({ receiptNo: "2" }, "super");
    assert.equal((await remove("admin", mine.id, 1)).status, 200);
    assert.equal((await remove("admin", supers.id, 1)).status, 403);
    assert.equal((await remove("super", supers.id, 1)).status, 200);
  });
  test("partly used: CONFLICT 'This advance has already been partly used and cannot be deleted.'", async () => {
    const a = await created();
    spend(a.id, 1);
    const res = await remove("admin", a.id, 1);
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This advance has already been partly used and cannot be deleted.");
  });
  test("goes to the recycle bin with deleted_by; the log says Removed; restore and purge are SuperAdmin only", async () => {
    const a = await created();
    assert.equal((await remove("admin", a.id, 1)).status, 200);
    const row = data().advances[0];
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, U.admin);
    assert.equal(data().systemLogs[1].summary, "Removed Advance: 2026 / 814 (Ravi Mehta)");
    assert.equal((await getOne("admin", a.id)).status, 404);
    assert.equal((await list("admin", "?deleted=only")).status, 403);
    assert.equal((await json(await list("super", "?deleted=only"))).data.page.total, 1);
    assert.equal((await restoreRoute(req("POST", `/api/v1/billing/advances/${a.id}/restore`, "admin", { version: 2 }), ctx({ id: a.id }))).status, 403);
    const back = await restoreRoute(req("POST", `/api/v1/billing/advances/${a.id}/restore`, "super", { version: 2 }), ctx({ id: a.id }));
    assert.equal(back.status, 200);
    assert.equal(data().systemLogs[2].module, "recycle-bin");
    assert.equal((await remove("super", a.id, 3)).status, 200);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/billing/advances/${a.id}/purge`, "admin"), ctx({ id: a.id }))).status, 403);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/billing/advances/${a.id}/purge`, "super"), ctx({ id: a.id }))).status, 200);
    assert.equal(data().advances.length, 0);
  });
  test("restoring when the receipt number was reused meanwhile: refused, nothing changes", async () => {
    const a = await created();
    await remove("admin", a.id, 1);
    await created();
    const res = await restoreRoute(req("POST", `/api/v1/billing/advances/${a.id}/restore`, "super", { version: 2 }), ctx({ id: a.id }));
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.details.fields.receiptNo, "This receipt number already exists.");
  });
  test("a closed year's advance cannot be deleted", async () => {
    const a = await created();
    data().advances[0].paymentDate = "2025-12-01";
    const res = await remove("admin", a.id, 1);
    assert.equal(res.status, 422);
    assert.match((await json(res)).error.details.fields.paymentDate, /cannot be deleted/);
  });
  test("version mismatch on delete", async () => {
    const a = await created();
    assert.equal((await remove("admin", a.id, 7)).status, 409);
  });
});

describe("refund (refundAdvance) and its reversal (destroyRefund)", () => {
  test("balances go down, total becomes the refund, the advance is refunded and closed for edits", async () => {
    const a = await created({ covers: "both", foodPaise: 200000, foodMode: "Cash" });
    const res = await refund("editor", a.id, refundInput(1, { hotelPaise: 100000, foodPaise: 50000 }));
    assert.equal(res.status, 200);
    const b = (await json(res)).data;
    assert.equal(b.hotelBalancePaise, 400000);
    assert.equal(b.foodBalancePaise, 150000);
    assert.deepEqual(b.refund, { date: "2026-10-06", hotelPaise: 100000, foodPaise: 50000, hotelMode: "Cash", foodMode: null, toName: "Ravi", toMobile: "", note: "" });
    assert.equal(data().advances[0].totalPaise, BigInt(150000));
    assert.equal(data().systemLogs[1].summary, "Added Advance refund: 2026 / 814 (Ravi Mehta)");
    assert.equal((await update("editor", a.id, { ...input(), version: 2 })).status, 409);
  });
  test("refunded already: CONFLICT", async () => {
    const a = await created();
    await refund("editor", a.id, refundInput(1));
    const res = await refund("editor", a.id, refundInput(2));
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This advance has already been refunded.");
  });
  test("more than the balance: Pallav's message; refused EVEN UNDER FORCE (HMS deviation: no negative balance)", async () => {
    const a = await created();
    for (const who of ["editor", "force"]) {
      const res = await refund(who, a.id, refundInput(1, { hotelPaise: 500001 }));
      assert.equal(res.status, 422, who);
      assert.equal((await json(res)).error.details.fields.hotelPaise, "Refund amount cannot exceed the available advance balance.");
    }
    const food = await refund("editor", a.id, refundInput(1, { hotelPaise: null, foodPaise: 1 }));
    assert.equal((await json(food)).error.details.fields.foodPaise, "Refund amount cannot exceed the available advance balance.");
  });
  test("a refund of nothing is accepted, as in Pallav (it closes the advance)", async () => {
    const a = await created();
    const res = await refund("editor", a.id, refundInput(1, { hotelPaise: null }));
    assert.equal(res.status, 200);
    assert.equal((await json(res)).data.hotelBalancePaise, 500000);
  });
  test("refund fields in Laravel's words", async () => {
    const a = await created();
    const res = await refund("editor", a.id, refundInput(1, { date: "", hotelPaise: -5, hotelMode: "x".repeat(21), toName: "n".repeat(256), toMobile: "9".repeat(16), note: "z".repeat(256) }));
    assert.deepEqual((await json(res)).error.details.fields, {
      hotelPaise: "The hotel refund amount field must be at least 0.",
      hotelMode: "The hotel refund mode field must not be greater than 20 characters.",
      date: "The refund payment date field is required.",
      toName: "The refund guest name field must not be greater than 255 characters.",
      toMobile: "The refund mobile number field must not be greater than 15 characters.",
      note: "The refund instruction field must not be greater than 255 characters.",
    });
  });
  test("a closed year's advance may still be refunded (pending columns), dated this year; dated in the closed year is refused", async () => {
    const a = await created();
    data().advances[0].paymentDate = "2026-03-10";
    let res = await refund("editor", a.id, refundInput(1, { date: "2026-03-15" }));
    assert.equal(res.status, 422);
    assert.match((await json(res)).error.details.fields.date, /nothing can be dated 15 Mar 2026/);
    res = await refund("editor", a.id, refundInput(1, { date: "2026-10-05" }));
    assert.equal(res.status, 200);
  });
  test("reversal: balances come back, total is the restored balances, every refund field cleared, log 'Removed Advance refund'", async () => {
    const a = await created();
    await refund("editor", a.id, refundInput(1, { hotelPaise: 120000 }));
    const res = await undoRefund("full", a.id, 2);
    assert.equal(res.status, 200);
    const b = (await json(res)).data;
    assert.equal(b.refund, null);
    assert.equal(b.hotelBalancePaise, 500000);
    const row = data().advances[0];
    assert.equal(row.totalPaise, BigInt(500000));
    assert.equal(row.refundGuestName, null);
    const line = data().systemLogs[2];
    assert.equal(line.summary, "Removed Advance refund: 2026 / 814 (Ravi Mehta)");
    assert.equal((line.details as Record<string, unknown>)["Hotel refund amount"], 120000);
  });
  test("HMS deviation: reversing when there is no refund is CONFLICT 'This advance has no refund to reverse.' (Pallav adds 0 and logs)", async () => {
    const a = await created();
    const res = await undoRefund("full", a.id, 1);
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This advance has no refund to reverse.");
    assert.equal(data().systemLogs.length, 1);
  });
  test("a refund dated in a closed year cannot be reversed", async () => {
    const a = await created();
    await refund("editor", a.id, refundInput(1));
    data().advances[0].paymentDate = "2026-02-01";
    data().advances[0].refundPaymentDate = "2026-03-01";
    const res = await undoRefund("full", a.id, 2);
    assert.equal(res.status, 422);
    assert.match((await json(res)).error.details.fields.date, /cannot be changed/);
  });
});

describe("the list, the picker and one advance", () => {
  async function seedList(): Promise<void> {
    await created({ receiptNo: "1", guestName: "Ravi Mehta", hotelPaise: 500000, hotelMode: "UPI" });
    await created({ receiptNo: "2", guestName: "Neha Shah", companyId: COMPANY, covers: "food", hotelPaise: null, foodPaise: 150050, foodMode: "Cash", paymentDate: "2026-09-12" });
    const c = await created({ receiptNo: "3", guestName: "Arjun Rao", hotelPaise: 200000, hotelMode: "Card", paymentDate: "2026-10-01" });
    await refund("editor", c.id, refundInput(1, { hotelPaise: 50000 }));
    const d = await created({ receiptNo: "4", guestName: "Om Patel", hotelPaise: 100000, paymentDate: "2026-10-02" });
    spend(d.id, 0);
  }
  test("tabs, counts, KPIs, filter options and the contract shape", async () => {
    await seedList();
    const body = (await json(await list("viewer"))).data;
    assert.equal(body.page.total, 4);
    assert.deepEqual(body.counts, { all: 4, unused: 2, partly: 0, used: 1, refunded: 1 });
    assert.deepEqual(body.kpis.map((k: { id: string; value: number }) => [k.id, k.value]), [["month", 800000], ["held", 650050], ["unused", 2], ["refunded", 50000]]);
    assert.deepEqual(body.options.companies, [{ id: COMPANY, name: "Infosys Rajkot" }]);
    assert.deepEqual(body.options.months, ["2026-10", "2026-09"]);
    assert.equal(body.all, 4);
    const sample: Advance = {
      id: "x", entryNo: 1, version: 1, receiptNo: "x", paymentDate: "x", guestName: "x", mobile: "x", companyId: null, companyName: null, roomNo: "x",
      hotelPaise: 1, foodPaise: 1, hotelMode: null, foodMode: null, hotelBalancePaise: 1, foodBalancePaise: 1, referenceName: "x", referenceMobile: "x", instruction: "x",
      refund: null, usedOn: ["x"], fromBillNo: null, createdAt: "x",
    };
    for (const item of body.page.items) assertMatchesContract(item, sample);
    const refunded = body.page.items.find((a: Advance) => a.refund);
    assertMatchesContract(refunded.refund, { date: "x", hotelPaise: 1, foodPaise: 1, hotelMode: null, foodMode: null, toName: "x", toMobile: "x", note: "x" });
  });
  test("newest payment date first; tab, mode, company, walk-in and month filters", async () => {
    await seedList();
    const names = async (q: string) => (await json(await list("viewer", q))).data.page.items.map((a: Advance) => a.guestName);
    assert.deepEqual(await names(""), ["Ravi Mehta", "Om Patel", "Arjun Rao", "Neha Shah"]);
    assert.deepEqual(await names("?tab=refunded"), ["Arjun Rao"]);
    assert.deepEqual(await names("?mode=cash"), ["Neha Shah"]);
    assert.deepEqual(await names(`?companyId=${COMPANY}`), ["Neha Shah"]);
    assert.deepEqual(await names("?companyId=walkin&sort=guestName&dir=asc"), ["Arjun Rao", "Om Patel", "Ravi Mehta"]);
    assert.deepEqual(await names("?month=2026-09"), ["Neha Shah"]);
  });
  test("search: every word must match, in receipt, guest, company or walk-in, mode or the amount", async () => {
    await seedList();
    const names = async (s: string) => (await json(await list("viewer", `?search=${encodeURIComponent(s)}`))).data.page.items.map((a: Advance) => a.guestName).sort();
    assert.deepEqual(await names("ravi"), ["Ravi Mehta"]);
    assert.deepEqual(await names("infosys"), ["Neha Shah"]);
    assert.deepEqual(await names("walk-in card"), ["Arjun Rao"]);
    assert.deepEqual(await names("1500.50"), ["Neha Shah"]);
    assert.deepEqual(await names("rao 2000.00"), ["Arjun Rao"]);
    assert.deepEqual(await names("mehta 1500.50"), []);
  });
  test("hostile search and sort: plain text, whitelisted sort, bounded page size", async () => {
    await seedList();
    for (const s of ["%", "_", "' OR 1=1 --", "\"; DROP TABLE x"]) {
      const res = await list("viewer", `?search=${encodeURIComponent(s)}`);
      assert.equal(res.status, 200, s);
      assert.equal((await json(res)).data.page.total, 0, s);
    }
    assert.equal((await list("viewer", "?sort=guest_name;drop")).status, 422);
    assert.equal((await list("viewer", "?pageSize=1000")).status, 422);
    assert.equal((await list("viewer", "?search=" + "a".repeat(201))).status, 422);
    assert.equal((await list("viewer", "?search=a&search=b")).status, 422);
  });
  test("paging", async () => {
    for (let i = 1; i <= 12; i++) await created({ receiptNo: String(i) });
    const body = (await json(await list("viewer", "?pageSize=10&page=2&sort=receiptNumber&dir=asc"))).data;
    assert.equal(body.page.total, 12);
    assert.equal(body.page.items.length, 2);
  });
  test("the year window carries older advances that still hold money", async () => {
    await created({ receiptNo: "1", guestName: "Old open" });
    await created({ receiptNo: "2", guestName: "Old used" });
    await created({ receiptNo: "3", guestName: "This year" });
    const [open, used] = data().advances;
    open.paymentDate = "2025-11-01";
    used.paymentDate = "2025-11-02";
    used.hotelBalancePaise = BigInt(0);
    const names = (await json(await list("viewer", "?from=2026-04-01&to=2027-03-31"))).data.page.items.map((a: Advance) => a.guestName);
    assert.deepEqual(names.sort(), ["Old open", "This year"]);
  });
  test("the picker lists advances with money left, by guest name", async () => {
    await seedList();
    const res = await openRoute(req("GET", "/api/v1/billing/advances/open", "viewer"));
    assert.deepEqual((await json(res)).data.map((a: Advance) => a.guestName), ["Arjun Rao", "Neha Shah", "Ravi Mehta"]);
  });
  test("one advance shows the bills it was taken off and, for an excess advance, the bill it came from", async () => {
    const a = await created();
    data().bills.push({ id: id(500), billNumber: "2026 / 1188", advanceId: a.id, deletedAt: null } as unknown as BillRecord);
    data().bills.push({ id: id(501), billNumber: "2026 / 1189", advanceId: a.id, deletedAt: new Date() } as unknown as BillRecord);
    const one = (await json(await getOne("viewer", a.id))).data;
    assert.deepEqual(one.usedOn, ["2026 / 1188"]);
    data().advances[0].receiptNumber = "Excessive / 2026 / 1174";
    assert.equal((await json(await getOne("viewer", a.id))).data.fromBillNo, "2026 / 1174");
  });
  test("a path id that is not a UUID is refused", async () => {
    assert.equal((await getOne("viewer", "1 OR 1=1")).status, 422);
  });
});

describe("hotel isolation", () => {
  test("hotel B can neither see, change, refund, delete nor restore hotel A's advance; each hotel numbers from 1", async () => {
    const a = await created();
    assert.equal((await getOne("adminB", a.id)).status, 404);
    assert.equal((await update("adminB", a.id, { ...input(), version: 1 })).status, 404);
    assert.equal((await refund("adminB", a.id, refundInput(1))).status, 404);
    assert.equal((await remove("adminB", a.id, 1)).status, 404);
    assert.equal((await json(await list("adminB"))).data.page.total, 0);
    const b = await created({}, "adminB");
    assert.equal(b.entryNo, 1);
    assert.equal(b.receiptNo, "2026 / 814", "the same receipt number is free in another hotel");
    assert.equal(data(HOTEL_A).advances.length, 1);
    assert.equal(data(HOTEL_B).advances.length, 1);
  });
});

describe("the advance receipt preview (ui-shared AdvancePreview)", () => {
  const preview = (who: string, advanceId: string) => previewRoute(req("GET", `/api/v1/billing/advances/${advanceId}/preview`, who), ctx({ id: advanceId }));
  test("the header from hotel settings, the advance, the amount taken in words; the contract shape", async () => {
    data().profile = { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "Rajkot", phone: null, gstin: "24ABCDE1234F1Z5", foodGstin: "24ABCDE1234F2Z4" };
    const a = await created({ covers: "both", hotelPaise: 1250000, foodPaise: 50, foodMode: "Cash" });
    const p = (await json(await preview("viewer", a.id))).data;
    // MJ #20 A: the hotel's and the food business's GSTIN are hotel settings and print in the header
    assert.deepEqual(p.header, { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "Rajkot", phone: "", gstin: "24ABCDE1234F1Z5", foodGstin: "24ABCDE1234F2Z4" });
    assert.equal(p.advance.receiptNo, "2026 / 814");
    assert.equal(p.amountWords, "Twelve Thousand Five Hundred Rupees and Fifty Paise Only");
    assertMatchesContract(p, { header: { name: "x", foodName: "x", address: "x", phone: "x", gstin: null, foodGstin: null }, advance: p.advance, amountWords: "x" } as AdvancePreview);
  });
  test("the words match REAL PHP (NumberToWords::convert fixtures) for many amounts, Lakh and Crore included", async () => {
    const words = (JSON.parse(readFileSync(path.join(__dirname, "fixtures", "cash-revenue.json"), "utf8")) as { words: { paise: number; words: string }[] }).words;
    const usable = words.filter((w) => w.paise > 0 && w.paise <= 99_999_999_999);
    const pick = (re: RegExp, n: number) => usable.filter((w) => re.test(w.words)).slice(0, n);
    const cases = [...pick(/Crore/, 4), ...pick(/Lakh/, 4), ...pick(/Paise Only$/, 3), ...pick(/^One Rupee Only$/, 1), ...pick(/^\w+ Thousand/, 2)];
    assert.ok(cases.some((c) => /Crore/.test(c.words)) && cases.some((c) => /Lakh/.test(c.words)), "covers Lakh and Crore");
    for (const [i, c] of cases.entries()) {
      const a = await created({ receiptNo: `w${i}`, hotelPaise: c.paise });
      assert.equal((await json(await preview("viewer", a.id))).data.amountWords, c.words, String(c.paise));
    }
  });
  test("a recycle-binned advance: only for recycle-bin users; another hotel: not found; no permission: 403", async () => {
    const a = await created();
    await remove("admin", a.id, 1);
    assert.equal((await preview("admin", a.id)).status, 404);
    assert.equal((await preview("super", a.id)).status, 200);
    const b = await created({ receiptNo: "2" });
    assert.equal((await preview("adminB", b.id)).status, 404);
    assert.equal((await preview("nobody", b.id)).status, 403);
  });
});
