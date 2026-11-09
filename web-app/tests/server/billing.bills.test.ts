// Billing, Bills and the debit settlement, end to end through the REAL route files, the wrapper, the services and the in-memory repositories.
// Expected behaviour: docs/specs/billing-bills.md (each rule cites Pallav). The four quirks run under BOTH settings where they matter.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Bill, BillingOptions, BillPreview } from "@shared/dashboards/billing";
import { GET as optionsRoute } from "../../src/app/api/v1/billing/options/route";
import { POST as restoreAdvanceRoute } from "../../src/app/api/v1/billing/advances/[id]/restore/route";
import { POST as createAdvanceRoute } from "../../src/app/api/v1/billing/advances/route";
import { GET as pdfRoute } from "../../src/app/api/v1/billing/bills/[id]/pdf/route";
import { GET as previewRoute } from "../../src/app/api/v1/billing/bills/[id]/preview/route";
import { DELETE as purgeRoute } from "../../src/app/api/v1/billing/bills/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/billing/bills/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/billing/bills/[id]/route";
import { DELETE as reverseRoute, POST as settleRoute } from "../../src/app/api/v1/billing/bills/[id]/settlement/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/billing/bills/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureBillingAdvances, configureBillingBills } from "../../src/server/compose/billing";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryBilling } from "../../src/server/repos/memory/billing";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { createBillService, type BillService } from "../../src/server/services/billing/billService";
import { billingQuirks, PALLAV_QUIRKS, type BillingQuirks } from "../../src/server/services/billing/quirks";
import type { Person } from "../../src/server/services/cash/ports";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { viewer: id(1), clerk: id(2), editor: id(3), admin: id(4), superAdmin: id(5), nobody: id(6), settler: id(7), adminB: id(8) };
const COMPANY = id(100);
const people = new Map<string, Person>([[U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }], [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("bills.bills", "view")] });
mk("clerk", U.clerk, { grants: [grant("bills.bills", "create"), grant("bills.advances", "create")] });
mk("editor", U.editor, { grants: [grant("bills.bills", "edit")] });
mk("settler", U.settler, { grants: [grant("bills.bills", "view"), grant("bills.debit-bills", "create")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("bills", "full"), grant("users", "full")] });
mk("force", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("bills", "full"), grant("users", "full"), grant("system.force", "full")] });
sessions.set("force", { ...(sessions.get("force") as VerifiedSession), forceMode: true });
mk("nobody", U.nobody, {});
mk("adminB", U.adminB, { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let billing = createMemoryBilling();
let bills: BillService;

function wire(quirks: BillingQuirks = PALLAV_QUIRKS): void {
  billing = createMemoryBilling();
  const deps = { unit: billing.unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => clock };
  bills = createBillService({ ...deps, quirks });
  configureBillingBills(bills);
  configureBillingAdvances(createAdvanceService(deps));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  for (const hotel of [HOTEL_A, HOTEL_B]) {
    const data = billing.store.dataFor(hotel);
    data.companies.set(COMPANY, "Infosys Rajkot");
    data.mealPlanRates = [{ plan: "CP", effectiveFrom: "2026-01-01", ratePaise: BigInt(25000) }, { plan: "CP", effectiveFrom: "2026-10-10", ratePaise: BigInt(27500) }, { plan: "MAP", effectiveFrom: "2026-01-01", ratePaise: BigInt(60000) }];
    data.profile = { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: null, foodGstin: null };
    data.years = [{ id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" }, { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
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
const fields = async (res: Response) => (await json(res)).error.details.fields;

const hotel = (over: Record<string, unknown> = {}) => ({ plan: "CP", roomPaise: 400000, planPaise: 50000, extraBedPaise: 80000, laundryPaise: 15050, vpoPaise: 7500, gstPaise: 66000, mode: "Cash", ...over });
const food = (over: Record<string, unknown> = {}) => ({ foodPaise: 120000, planPaise: 0, laundryPaise: 0, gstPaise: 6000, mode: "Cash", ...over });
const input = (over: Record<string, unknown> = {}) => ({
  billNo: "1188", billDate: "2026-10-05", grNo: "GR-77", advanceId: null, guestName: "Ravi Mehta", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null,
  roomNo: "204", persons: 2, arrivalAt: "2026-10-02T12:00:00Z", departureAt: "2026-10-05T05:30:00Z", hotel: hotel(), food: food(),
  stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2 }], referenceName: "", referenceMobile: "", instruction: "", ...over,
});
const advanceInput = (over: Record<string, unknown> = {}) => ({ receiptNo: "814", paymentDate: "2026-10-01", guestName: "Ravi Mehta", mobile: "", companyId: null, roomNo: "", covers: "hotel", hotelPaise: 500000, foodPaise: null, hotelMode: "UPI", foodMode: null, referenceName: "", referenceMobile: "", instruction: "", ...over });
const settleInput = (version: number, installments: unknown[], over: Record<string, unknown> = {}) => ({ installments, referenceName: "", referenceMobile: "", instruction: "", version, ...over });
const inst = (date: string, hotelPaise: number, foodPaise = 0) => ({ date, hotelPaise, hotelMode: "Cash", foodPaise, foodMode: null });

const create = (who: string, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => createRoute(req("POST", "/api/v1/billing/bills", who, input(over), headers));
async function created(over: Record<string, unknown> = {}, who = "clerk"): Promise<Bill & { version: number; entryNo: number }> {
  const res = await create(who, over);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
async function advance(over: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const res = await createAdvanceRoute(req("POST", "/api/v1/billing/advances", "clerk", advanceInput(over)));
  assert.equal(res.status, 201);
  return (await json(res)).data;
}
const getOne = (who: string, billId: string) => getRoute(req("GET", `/api/v1/billing/bills/${billId}`, who), ctx({ id: billId }));
const update = (who: string, billId: string, body: unknown) => updateRoute(req("PATCH", `/api/v1/billing/bills/${billId}`, who, body), ctx({ id: billId }));
const remove = (who: string, billId: string, version: number) => removeRoute(req("DELETE", `/api/v1/billing/bills/${billId}`, who, { version }), ctx({ id: billId }));
const settle = (who: string, billId: string, body: unknown, headers: Record<string, string> = {}) => settleRoute(req("POST", `/api/v1/billing/bills/${billId}/settlement`, who, body, headers), ctx({ id: billId }));
const reverse = (who: string, billId: string, version: number) => reverseRoute(req("DELETE", `/api/v1/billing/bills/${billId}/settlement`, who, { version }), ctx({ id: billId }));
const data = (h = HOTEL_A) => billing.store.dataFor(h);
const debit = { hotel: hotel({ mode: "Debit" }), food: food({ mode: "Debit" }) };

// A generous deadline: the PDF test proves what the route sends, never how fast; a loaded machine must not fail it.
configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 90_000 }));

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("a new bill (storeBill)", () => {
  test("totals worked out from the lines, the stay priced from the hotel's rates, the year in front of the number", async () => {
    const b = await created();
    assert.equal(b.billNo, "2026 / 1188");
    assert.equal(b.hotelTotalPaise, 400000 + 50000 + 80000 + 15050 + 7500 + 66000);
    assert.equal(b.foodTotalPaise, 126000);
    // 8, 9 Oct at 250, 10, 11 Oct at 275, two persons: the rate changed during the part
    assert.deepEqual(b.stay, [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2, nights: 4, ratePaise: null, amountPaise: 210000 }] as unknown as Bill["stay"]);
    assert.equal(b.planFoodOwedPaise, 210000);
    assert.equal(b.balanceHotelPaise, 0, "paid in Cash: nothing owed");
    assert.equal(b.grNo, "GR-77");
    assert.equal(b.entryNo, 1);
    assert.equal(data().systemLogs[0].summary, "Added Bill: 2026 / 1188 (Ravi Mehta)");
  });
  test("a side on Debit owes its total (case does not matter)", async () => {
    const b = await created({ hotel: hotel({ mode: "DEBIT" }) });
    assert.equal(b.balanceHotelPaise, b.hotelTotalPaise);
    assert.equal(b.balanceFoodPaise, 0);
  });
  test("negative adjustment lines are allowed (no minimum in Pallav)", async () => {
    const b = await created({ hotel: hotel({ roomPaise: -50000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: -2500 }) });
    assert.equal(b.hotelTotalPaise, -52500);
  });
  test("totals, balances, snapshots and stay prices cannot be sent", async () => {
    for (const extra of [{ hotelTotalPaise: 1 }, { balanceHotelPaise: 1 }, { advanceHotelAmountSnapshot: "9999" }, { planFoodOwedPaise: 0 }, { createdBy: U.admin }]) {
      assert.equal((await createRoute(req("POST", "/api/v1/billing/bills", "clerk", { ...input(), ...extra }))).status, 422, JSON.stringify(extra));
    }
    const res = await createRoute(req("POST", "/api/v1/billing/bills", "clerk", input({ stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2, amountPaise: 1 }] })));
    assert.equal(res.status, 422);
  });
  test("a bill number already used; a recycle-binned one does not count", async () => {
    const b = await created();
    assert.deepEqual(await fields(await create("clerk")), { billNo: "This bill number already exists." });
    await remove("admin", b.id, 1);
    assert.equal((await create("clerk")).status, 201);
  });
  test("Laravel's words for the bill rules", async () => {
    const res = await create("clerk", {
      billNo: "", billDate: "2026-13-01", guestName: "", mobile: "1".repeat(16), roomNo: "r".repeat(21), companyId: id(999), grNo: "g".repeat(51), address: "a".repeat(256),
      gstin: "x".repeat(21), persons: 0, arrivalAt: "2026-10-05T10:00:00Z", departureAt: "2026-10-04T10:00:00Z", referenceName: "n".repeat(101), referenceMobile: "2".repeat(16),
      hotel: hotel({ plan: "p".repeat(101), mode: "m".repeat(101) }), food: food({ mode: "f".repeat(101) }),
      stay: [{ from: "", to: "2026-10-10", plan: null, persons: 1 }, { from: "2026-10-10", to: "2026-10-09", plan: "q".repeat(101), persons: 100 }],
    });
    assert.deepEqual(await fields(res), {
      billNo: "The bill number field is required.",
      companyId: "The selected company id is invalid.",
      billDate: "The bill date field must be a valid date.",
      guestName: "The guest name field is required.",
      mobile: "The mobile number field must not be greater than 15 characters.",
      roomNo: "The room number field must not be greater than 20 characters.",
      "hotel.plan": "The hotel plan field must not be greater than 100 characters.",
      "hotel.mode": "The hotel mode of payment field must not be greater than 100 characters.",
      "food.mode": "The food mode of payment field must not be greater than 100 characters.",
      referenceName: "The reference name field must not be greater than 100 characters.",
      referenceMobile: "The reference mobile number field must not be greater than 15 characters.",
      grNo: "The gr number field must not be greater than 50 characters.",
      address: "The guest address field must not be greater than 255 characters.",
      gstin: "The guest gstin field must not be greater than 20 characters.",
      persons: "The persons field must be at least 1.",
      departureAt: "The departure at field must be a date after or equal to arrival at.",
      "stay.0.from": "The stay.0.from field is required.",
      "stay.1.to": "The stay.1.to field must be a date after stay.1.from.",
      "stay.1.plan": "The stay.1.plan field must not be greater than 100 characters.",
      "stay.1.persons": "The stay.1.persons field must not be greater than 99.",
    });
  });
  test("more than 30 stay parts; a GSTIN is only length-checked (HMS §11.7, as Pallav)", async () => {
    const parts = Array.from({ length: 31 }, (_, i) => ({ from: "2026-10-08", to: "2026-10-09", plan: "CP", persons: 1 + (i % 2) }));
    assert.equal((await fields(await create("clerk", { stay: parts }))).stay, "The stay field must not have more than 30 items.");
    assert.equal((await create("clerk", { gstin: "not a gstin" })).status, 201);
  });
  test("dated in a closed year", async () => {
    assert.match((await fields(await create("clerk", { billDate: "2026-03-31" }))).billDate, /^2025-26 is closed, so nothing can be dated 31 Mar 2026/);
  });
  test("idempotent create", async () => {
    const key = { "idempotency-key": "bill-key-0000000001" };
    const a = await create("clerk", {}, key);
    const b = await create("clerk", {}, key);
    assert.equal(b.headers.get("idempotent-replayed"), "true");
    assert.equal((await json(a)).data.id, (await json(b)).data.id);
    assert.equal(data().bills.length, 1);
  });
});

describe("taking an advance off a new bill", () => {
  test("takes the smaller of balance and total per side, writes the snapshots itself, lowers the advance and raises its version", async () => {
    const a = await advance({ companyId: COMPANY });
    const b = await created({ advanceId: a.id, hotel: hotel({ roomPaise: 300000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    assert.deepEqual(b.advance, { advanceId: a.id, receiptNo: "2026 / 814", guestName: "Ravi Mehta", hotelPaise: 300000, foodPaise: 0 });
    const row = data().bills[0];
    assert.equal(row.advanceHotelAmountSnapshot, "5000.00");
    assert.equal(row.advanceDateSnapshot, "2026-10-01");
    assert.equal(row.advanceCompanySnapshot, "Infosys Rajkot");
    const adv = data().advances[0];
    assert.equal(adv.hotelBalancePaise, BigInt(200000));
    assert.equal(adv.version, 2);
  });
  test("nothing left: Pallav's message with the receipt; a missing or recycle-binned advance is invalid (HMS §11.2)", async () => {
    const a = await advance();
    data().advances[0].hotelBalancePaise = BigInt(0);
    assert.deepEqual(await fields(await create("clerk", { advanceId: a.id })), { advanceId: "Advance 2026 / 814 has nothing left to take off." });
    assert.deepEqual(await fields(await create("clerk", { advanceId: id(777) })), { advanceId: "The selected advance id is invalid." });
    data().advances[0].hotelBalancePaise = BigInt(500000);
    data().advances[0].deletedAt = new Date();
    assert.deepEqual(await fields(await create("clerk", { advanceId: a.id })), { advanceId: "The selected advance id is invalid." });
  });
  test("HMS deviation §11.1: a side total of zero or less takes nothing from the advance", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: hotel({ roomPaise: -100000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    assert.equal(b.advance?.hotelPaise, 0);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(500000));
  });
  test("quirk (a) both ways: ₹8,000 on Debit with ₹5,000 taken owes ₹8,000 (Pallav, default) or ₹3,000 (corrected)", async () => {
    const one = hotel({ roomPaise: 800000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0, mode: "Debit" });
    let a = await advance();
    assert.equal((await created({ advanceId: a.id, hotel: one })).balanceHotelPaise, 800000);
    wire({ ...PALLAV_QUIRKS, debitBalanceIgnoresAdvance: false });
    a = await advance();
    assert.equal((await created({ advanceId: a.id, hotel: one })).balanceHotelPaise, 300000);
  });
  test("MJ #21 (a) is FIXED in what the hotel runs with: a debit side owes its total less the advance taken, never below zero", async () => {
    assert.deepEqual(billingQuirks, { ...PALLAV_QUIRKS, debitBalanceIgnoresAdvance: false });
    wire(billingQuirks);
    const one = hotel({ roomPaise: 800000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0, mode: "Debit" });
    const a = await advance();
    assert.equal((await created({ advanceId: a.id, hotel: one })).balanceHotelPaise, 300000);
  });
  test("a closed year's advance can still be taken off a bill (pending columns only)", async () => {
    const a = await advance();
    data().advances[0].paymentDate = "2026-01-15";
    assert.equal((await create("clerk", { advanceId: a.id })).status, 201);
  });
  test("deleting the bill gives the advance back; an edit never re-applies it and ignores advanceId (HMS §11.6)", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: hotel({ roomPaise: 100000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    const other = await advance({ receiptNo: "900" });
    const edited = (await json(await update("editor", b.id, { ...input({ advanceId: other.id, guestName: "Ravi M" }), version: 1 }))).data;
    assert.equal(edited.advance.advanceId, a.id);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(400000));
    assert.equal((await remove("admin", b.id, 2)).status, 200);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(500000));
  });
});

describe("edit and delete (updateBill, destroyBill)", () => {
  test("edit recomputes the totals and the stay; the number never changes; the log names what moved", async () => {
    const b = await created();
    const res = await update("editor", b.id, { ...input({ billNo: "IGNORED", hotel: hotel({ roomPaise: 500000 }), stay: [] }), version: 1 });
    const e = (await json(res)).data;
    assert.equal(e.billNo, "2026 / 1188");
    assert.equal(e.hotelTotalPaise, b.hotelTotalPaise + 100000);
    assert.deepEqual(e.stay, []);
    assert.equal(e.planFoodOwedPaise, 0);
    assert.match(data().systemLogs[1].summary, /^Changed Bill: 2026 \/ 1188 \(Ravi Mehta\) \(Hotel amount, Total hotel amount, Stay segments, Plan food amount\)$/);
  });
  test("a settled bill cannot be edited or deleted; force steps past and logs it", async () => {
    const b = await created(debit);
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", b.hotelTotalPaise, b.foodTotalPaise)]));
    let res = await update("editor", b.id, { ...input(debit), version: 2 });
    assert.equal((await json(res)).error.message, "A debit bill has already been generated for this bill; it cannot be edited.");
    res = await remove("admin", b.id, 2);
    assert.equal((await json(res)).error.message, "A debit bill has already been generated for this bill; it cannot be deleted.");
    assert.equal((await update("force", b.id, { ...input(debit), version: 2 })).status, 200);
    assert.equal(data().forceLogs[0].summary, "Forced past a lock: A debit bill has already been generated for");
  });
  test("version check; a closed year's bill cannot be edited or deleted", async () => {
    const b = await created();
    assert.equal((await update("editor", b.id, { ...input(), version: 9 })).status, 409);
    data().bills[0].billDate = "2026-02-01";
    assert.match((await fields(await update("editor", b.id, { ...input({ billDate: "2026-02-01" }), version: 1 }))).billDate, /cannot be changed/);
    assert.match((await fields(await remove("admin", b.id, 1))).billDate, /cannot be deleted/);
  });
  test("recycle bin: SuperAdmin restores and purges", async () => {
    const b = await created();
    await remove("admin", b.id, 1);
    assert.equal((await getOne("admin", b.id)).status, 404);
    assert.equal((await restoreRoute(req("POST", `/api/v1/billing/bills/${b.id}/restore`, "admin", { version: 2 }), ctx({ id: b.id }))).status, 403);
    assert.equal((await restoreRoute(req("POST", `/api/v1/billing/bills/${b.id}/restore`, "super", { version: 2 }), ctx({ id: b.id }))).status, 200);
    await remove("super", b.id, 3);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/billing/bills/${b.id}/purge`, "super"), ctx({ id: b.id }))).status, 200);
    assert.equal(data().bills.length, 0);
  });
});

describe("the GST rate stored with the bill (MJ, 5 Nov 2026)", () => {
  const defaults = (hotelPct: string | null, foodPct: string | null): void => {
    (data() as unknown as { settings: Map<string, string | null> }).settings = new Map([["checkout.hotel_gst_percent", hotelPct], ["checkout.food_gst_percent", foodPct]]);
  };
  const at12 = { hotel: hotel({ roomPaise: 1000000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 120000 }), food: food({ foodPaise: 100000, gstPaise: 5000 }), stay: [] };
  test("a bill made at 12% keeps 12% after the hotel's default changes to 18%: on reading, on an edit, on the paper; no amount moves", async () => {
    defaults("12", "5");
    const b = await created(at12);
    assert.deepEqual([b.hotelGstPercent, b.foodGstPercent, b.hotel.gstPaise, b.hotelTotalPaise, b.food.gstPaise, b.foodTotalPaise], [12, 5, 120000, 1120000, 5000, 105000]);
    assert.deepEqual([data().bills[0].hotelGstPercent, data().bills[0].foodGstPercent], ["12", "5"]);
    defaults("18", "18");
    assert.deepEqual(((await json(await getOne("viewer", b.id))).data as Bill).hotelGstPercent, 12);
    const edited = (await json(await update("editor", b.id, { ...input({ ...at12, instruction: "Late checkout" }), version: 1 }))).data as Bill;
    assert.deepEqual([edited.hotelGstPercent, edited.foodGstPercent, edited.hotelTotalPaise, edited.foodTotalPaise], [12, 5, 1120000, 105000]);
    const p = (await json(await previewRoute(req("GET", `/api/v1/billing/bills/${b.id}/preview`, "viewer"), ctx({ id: b.id })))).data as BillPreview;
    assert.deepEqual([p.bill.hotelGstPercent, p.bill.foodGstPercent], [12, 5]);
  });
  test("with no default typed the hotel's 5% is the first guess; a typed GST at another slab stores that slab; GST that fits no rate stores none; no GST stores 0", async () => {
    let b = await created({ ...at12, billNo: "1" });
    assert.deepEqual([b.hotelGstPercent, b.foodGstPercent], [12, 5]);
    b = await created({ billNo: "2", hotel: hotel({ gstPaise: 66000 }), food: food({ gstPaise: 0 }) });
    assert.deepEqual([b.hotelGstPercent, b.foodGstPercent, b.hotel.gstPaise], [null, 0, 66000]);
    b = await created({ billNo: "3", hotel: hotel({ roomPaise: 0, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }), food: food({ foodPaise: 0, gstPaise: 0 }), stay: [] });
    assert.deepEqual([b.hotelGstPercent, b.foodGstPercent], [null, null]);
  });
  test("a bill typed at the hotel's 18% default stores 18 even where 12% would also be within a rupee of a tiny amount", async () => {
    defaults("18", "5");
    const b = await created({ hotel: hotel({ roomPaise: 1000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 180 }), food: food({ foodPaise: 0, gstPaise: 0 }), stay: [] });
    assert.equal(b.hotelGstPercent, 18);
  });
  test("an older bill without a stored rate reads null (the paper then falls back to the slab)", async () => {
    const b = await created(at12);
    data().bills[0].hotelGstPercent = null;
    data().bills[0].foodGstPercent = null;
    assert.deepEqual([(await json(await getOne("viewer", b.id))).data.hotelGstPercent, (await json(await getOne("viewer", b.id))).data.foodGstPercent], [null, null]);
  });
});

describe("the SAC codes stored with the bill (MJ, 5 Nov 2026)", () => {
  test("a new bill stores rooms 996311 and food 996331; reading, the preview and an edit keep the bill's own codes", async () => {
    const b = await created({ hotel: hotel({ roomPaise: 1000000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 120000 }), food: food({ foodPaise: 100000, gstPaise: 5000 }), stay: [] });
    assert.deepEqual([b.hotelSac, b.foodSac], ["996311", "996331"]);
    assert.deepEqual([data().bills[0].hotelSac, data().bills[0].foodSac], ["996311", "996331"]);
    // a bill made under other codes keeps them, whatever HMS holds now
    data().bills[0].hotelSac = "996312";
    const edited = (await json(await update("editor", b.id, { ...input({ hotel: hotel({ roomPaise: 1000000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 120000 }), food: food({ foodPaise: 100000, gstPaise: 5000 }), stay: [], instruction: "Late checkout" }), version: 1 }))).data as Bill;
    assert.deepEqual([edited.hotelSac, edited.foodSac], ["996312", "996331"]);
    const p = (await json(await previewRoute(req("GET", `/api/v1/billing/bills/${b.id}/preview`, "viewer"), ctx({ id: b.id })))).data as BillPreview;
    assert.deepEqual([p.bill.hotelSac, p.bill.foodSac], ["996312", "996331"]);
  });
});

describe("settling a debit (storeDebitBill) and reversing it (destroyDebitBill)", () => {
  test("instalments lower the balance; the bill is settled; Pallav's text for no excess is '0'", async () => {
    const b = await created(debit);
    const res = await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 300000), inst("2026-10-06", b.hotelTotalPaise - 300000, b.foodTotalPaise)], { referenceName: "Accounts" }));
    assert.equal(res.status, 200);
    const s = (await json(res)).data;
    assert.equal(s.balanceHotelPaise, 0);
    assert.equal(s.settlement.installments.length, 2);
    assert.equal(s.settlement.referenceName, "Accounts");
    assert.equal(s.settlement.excessReceiptNo, null);
    assert.equal(data().bills[0].debitHotelAdvance, "0");
    assert.equal(data().systemLogs.at(-1)?.summary, "Added Debit bill settlement: 2026 / 1188 (Ravi Mehta)");
  });
  test("partly paid: the rest stays owed", async () => {
    const b = await created(debit);
    const s = (await json(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100000)])))).data;
    assert.equal(s.balanceHotelPaise, b.hotelTotalPaise - 100000);
    assert.equal(s.balanceFoodPaise, b.foodTotalPaise);
  });
  test("an overpayment becomes an advance 'Excessive / {bill}', dated today (quirk (d) default), logged", async () => {
    clock = new Date("2026-10-07T09:00:00+05:30");
    const b = await created(debit);
    const s = (await json(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", b.hotelTotalPaise + 50000, b.foodTotalPaise)])))).data;
    assert.equal(s.settlement.excessReceiptNo, "Excessive / 2026 / 1188");
    const excess = data().advances[0];
    assert.equal(excess.receiptNumber, "Excessive / 2026 / 1188");
    assert.equal(excess.hotelAmountPaise, BigInt(50000));
    assert.equal(excess.paymentDate, "2026-10-07");
    assert.equal(data().bills[0].debitHotelAdvance, "500");
    assert.ok(data().systemLogs.some((l) => l.summary === "Added Advance: Excessive / 2026 / 1188 (Ravi Mehta)"));
  });
  test("quirk (d) corrected: the excess advance takes the last instalment's date", async () => {
    wire({ ...PALLAV_QUIRKS, excessAdvanceDatedToday: false });
    clock = new Date("2026-10-07T09:00:00+05:30");
    const b = await created(debit);
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100), inst("2026-10-06", b.hotelTotalPaise, b.foodTotalPaise)]));
    assert.equal(data().advances[0].paymentDate, "2026-10-06");
  });
  test("already recorded: CONFLICT; the first instalment's date is required (HMS §11.3); slot words; max five", async () => {
    const b = await created(debit);
    assert.deepEqual(await fields(await settle("settler", b.id, settleInput(1, [inst("", 100)]))), { "installments.0.date": "The debit bill date field is required." });
    assert.deepEqual(await fields(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 1), { ...inst("2026-10-xx", 1), hotelMode: "m".repeat(21) }], { referenceName: "r".repeat(101), referenceMobile: "9".repeat(16) }))), {
      "installments.1.date": "The debit bill date 1 field must be a valid date.",
      "installments.1.hotelMode": "The debit hotel mode 1 field must not be greater than 20 characters.",
      referenceName: "The debit reference name field must not be greater than 100 characters.",
      referenceMobile: "The debit reference mobile number field must not be greater than 15 characters.",
    });
    assert.equal((await settle("settler", b.id, settleInput(1, Array.from({ length: 6 }, () => inst("2026-10-05", 1))))).status, 422);
    // a negative instalment would raise the balance; an all-zero one records nothing and burns a slot
    assert.deepEqual(await fields(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", -100, -1)]))), {
      "installments.0.hotelPaise": "The debit hotel amount field must be at least 0.",
      "installments.0.foodPaise": "The debit food amount field must be at least 0.",
    });
    assert.deepEqual(await fields(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 0), inst("2026-10-06", 0)]))), { installments: "Enter an amount on at least one installment." });
    assert.equal((await settle("force", b.id, settleInput(1, [inst("2026-10-05", -100)]))).status, 422, "force keeps the negative refusal");
    // H6 part payments: a first payment of 100 leaves money owing, so a second payment is taken (the instalments merge, the reference stays unless retyped),
    // the balance comes down each time, five instalments in all is the most, and once nothing is owed the bill is final
    const first = (await json(await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100)], { referenceName: "Accounts" })))).data;
    assert.deepEqual([first.settlement.installments.length, first.balanceHotelPaise, first.settlement.referenceName], [1, b.hotelTotalPaise - 100, "Accounts"]);
    const again = await settle("settler", b.id, settleInput(2, [inst("2026-10-06", 200)]));
    const againBody = await json(again);
    assert.equal(again.status, 200, JSON.stringify(againBody.error));
    const second = againBody.data;
    assert.deepEqual([second.settlement.installments.map((i: { hotelPaise: number }) => i.hotelPaise), second.balanceHotelPaise, second.settlement.referenceName], [[100, 200], b.hotelTotalPaise - 300, "Accounts"]);
    assert.deepEqual(await fields(await settle("settler", b.id, settleInput(3, Array.from({ length: 4 }, () => inst("2026-10-07", 1))))), { installments: "Up to five installments in all; 2 already recorded." });
    const rest = await settle("settler", b.id, settleInput(3, [inst("2026-10-07", second.balanceHotelPaise, second.balanceFoodPaise)]));
    assert.equal(rest.status, 200);
    const restBody = (await json(rest)).data;
    assert.equal(restBody.balanceHotelPaise + restBody.balanceFoodPaise, 0);
    const done = await settle("settler", b.id, settleInput(4, [inst("2026-10-08", 100)]));
    assert.equal(done.status, 409);
    assert.equal((await json(done)).error.message, "Debit bill already recorded for this bill.");
  });
  test("quirk (b) both ways: a Cash bill may be 'settled' and all of it becomes excess (Pallav), or is refused (corrected)", async () => {
    let b = await created();
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 70000)]));
    assert.equal(data().advances[0].hotelAmountPaise, BigInt(70000));
    wire({ ...PALLAV_QUIRKS, settleNonDebitMakesExcess: false });
    b = await created();
    const res = await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 70000)]));
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This bill is not on debit.");
  });
  test("reversal: the excess advance goes (one log line), the slots clear, the balances come back", async () => {
    const b = await created(debit);
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", b.hotelTotalPaise + 50000, b.foodTotalPaise)]));
    const res = await reverse("admin", b.id, 2);
    assert.equal(res.status, 200);
    const r = (await json(res)).data;
    assert.equal(r.settlement, null);
    assert.equal(r.balanceHotelPaise, b.hotelTotalPaise);
    assert.ok(data().advances[0].deletedAt);
    assert.ok(data().systemLogs.some((l) => l.summary === "Removed Advance: Excessive / 2026 / 1188 (Ravi Mehta)"));
    assert.equal(data().systemLogs.at(-1)?.summary, "Removed Debit bill settlement: 2026 / 1188 (Ravi Mehta)");
    // settled again later: the excess number is free again
    assert.equal((await settle("settler", b.id, settleInput(3, [inst("2026-10-05", b.hotelTotalPaise + 1, b.foodTotalPaise)]))).status, 200);
  });
  test("HMS §11.4 nothing to reverse; HMS §11.5 the overpayment's advance already used: refused, nothing changes", async () => {
    const b = await created(debit);
    assert.equal((await json(await reverse("admin", b.id, 1))).error.message, "This bill has no settlement to reverse.");
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", b.hotelTotalPaise + 50000, b.foodTotalPaise)]));
    data().advances[0].hotelBalancePaise = BigInt(10000);
    const res = await reverse("admin", b.id, 2);
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "The advance made from the overpayment has already been used.");
    assert.equal(data().advances[0].deletedAt, null);
    assert.ok(data().bills[0].debit[0].date);
  });
  test("quirk (c) both ways: reversing on a Cash bill puts the total back as owed (Pallav) or the new-bill balance (corrected)", async () => {
    let b = await created();
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100)]));
    data().advances[0].deletedAt = null;
    assert.equal((await json(await reverse("admin", b.id, 2))).data.balanceHotelPaise, b.hotelTotalPaise);
    wire({ ...PALLAV_QUIRKS, reverseResetsNonDebit: false });
    b = await created();
    await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100)]));
    assert.equal((await json(await reverse("admin", b.id, 2))).data.balanceHotelPaise, 0);
  });
  test("a closed year's bill may still be settled, with this year's dates; an instalment in the closed year is refused", async () => {
    const b = await created(debit);
    data().bills[0].billDate = "2026-03-20";
    assert.match((await json(await settle("settler", b.id, settleInput(1, [inst("2026-03-25", 100)])))).error.details.fields.date, /nothing can be dated 25 Mar 2026/);
    assert.equal((await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100)]))).status, 200);
  });
  test("permissions: bills.debit-bills create settles, full reverses; bills.bills alone cannot settle", async () => {
    const b = await created(debit);
    assert.equal((await settle("editor", b.id, settleInput(1, [inst("2026-10-05", 100)]))).status, 403);
    assert.equal((await settle("settler", b.id, settleInput(1, [inst("2026-10-05", 100)]))).status, 200);
    assert.equal((await reverse("settler", b.id, 2)).status, 403);
    assert.equal((await reverse("admin", b.id, 2)).status, 200);
  });
});

describe("the preview, the list and permissions", () => {
  test("preview (ui-shared BillPreview): the hotel's header from settings, the bill, the words; no file paths; GSTINs null while not set", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, ...debit });
    data().bills[0].invoicePdfPath = "invoices/secret.pdf";
    const p = (await json(await previewRoute(req("GET", `/api/v1/billing/bills/${b.id}/preview`, "viewer"), ctx({ id: b.id })))).data;
    assert.deepEqual(p.header, { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: null, foodGstin: null });
    assert.equal(p.bill.billNo, "2026 / 1188");
    assert.equal(p.bill.hotel.vpoPaise, 7500);
    assert.equal(p.foodWords, "One Thousand Two Hundred Sixty Rupees Only");
    assert.ok(!JSON.stringify(p).includes("secret.pdf"));
    assertMatchesContract(p, { header: { name: "x", foodName: "x", address: "x", phone: "x", gstin: null, foodGstin: null }, bill: p.bill, hotelWords: "x", foodWords: "x" } as BillPreview);
  });
  test("pdf: the bill as application/pdf, inline, never cached, with the trace id; the preview's permission; another hotel's bill is 404; errors stay JSON", async () => {
    const b = await created();
    const res = await pdfRoute(req("GET", `/api/v1/billing/bills/${b.id}/pdf`, "viewer"), ctx({ id: b.id }));
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("content-type"), res.headers.get("content-disposition"), res.headers.get("cache-control"), res.headers.get("x-content-type-options")], ["application/pdf", 'inline; filename="bill-2026-1188.pdf"', "no-store", "nosniff"]);
    assert.ok(res.headers.get("x-trace-id"));
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    assert.equal(Number(res.headers.get("content-length")), bytes.byteLength);
    assert.equal((await pdfRoute(req("GET", `/api/v1/billing/bills/${b.id}/pdf`, "nobody"), ctx({ id: b.id }))).status, 403);
    assert.equal((await pdfRoute(req("GET", `/api/v1/billing/bills/${b.id}/pdf`, null), ctx({ id: b.id }))).status, 401);
    const other = await pdfRoute(req("GET", `/api/v1/billing/bills/${b.id}/pdf`, "adminB"), ctx({ id: b.id }));
    assert.deepEqual([other.status, other.headers.get("content-type")?.startsWith("application/json")], [404, true]);
  });
  test("a hotel with no address or phone set: empty text, never null", async () => {
    data().profile = { name: "Hotel Pallav", foodName: "Pallav Food", address: null, phone: null, gstin: null, foodGstin: null };
    const b = await created();
    const p = (await json(await previewRoute(req("GET", `/api/v1/billing/bills/${b.id}/preview`, "viewer"), ctx({ id: b.id })))).data;
    assert.deepEqual(p.header, { name: "Hotel Pallav", foodName: "Pallav Food", address: "", phone: "", gstin: null, foodGstin: null });
  });
  test("options (ui-shared BillingOptions): the hotel's plans with TODAY's rate (IST), the payment modes; module view", async () => {
    data().options = {
      hotel_plan: [{ value: "EP", label: "EP - room only", isDefault: false }, { value: "CP", label: "CP - with breakfast", isDefault: true }, { value: "MAP", label: "", isDefault: false }],
      payment_mode: [{ value: "Cash", label: "Cash", isDefault: true }, { value: "Debit", label: "Debit", isDefault: false }],
    };
    const get = async (who: string) => optionsRoute(req("GET", "/api/v1/billing/options", who));
    let body = (await json(await get("viewer"))).data as BillingOptions;
    assert.deepEqual(body.plans, [{ code: "EP", label: "EP - room only", ratePaise: 0 }, { code: "CP", label: "CP - with breakfast", ratePaise: 25000 }, { code: "MAP", label: "MAP - breakfast and one meal", ratePaise: 60000 }]);
    assert.deepEqual(body.paymentModes, ["Cash", "Debit"]);
    assertMatchesContract(body, { plans: [{ code: "x", label: "x", ratePaise: 1 }], paymentModes: ["x"] } satisfies BillingOptions);
    clock = new Date("2026-10-09T18:30:00Z"); // 10 Oct 2026 00:00 IST: the new CP rate starts
    body = (await json(await get("viewer"))).data;
    assert.equal(body.plans[1].ratePaise, 27500);
    assert.equal((await get("nobody")).status, 403);
  });
  test("list: tabs, counts, KPIs and the contract shape", async () => {
    await created({ billNo: "1" });
    const due = await created({ billNo: "2", ...debit });
    const settled = await created({ billNo: "3", ...debit });
    await settle("settler", settled.id, settleInput(1, [inst("2026-10-05", settled.hotelTotalPaise, settled.foodTotalPaise)]));
    const body = (await json(await listRoute(req("GET", "/api/v1/billing/bills", "viewer")))).data;
    assert.deepEqual(body.counts, { all: 3, paid: 1, due: 1, settled: 1 });
    assert.deepEqual(body.kpis.map((k: { id: string }) => k.id), ["count", "billed", "due", "settled"]);
    assert.equal(body.kpis[0].value, 3);
    assert.equal(body.kpis[2].value, due.hotelTotalPaise + due.foodTotalPaise);
    const sample: Omit<Bill, "stay"> & { stay: unknown[]; version: number; entryNo: number; guests: { adults: number; children: number; names: string[] } } = {
      guests: { adults: 1, children: 0, names: ["x"] }, id: "x", version: 1, entryNo: 1, billNo: "x", billDate: "x", grNo: "x", guestName: "x", mobile: "x", address: "x", gstin: "x", companyId: null, companyName: null, roomNo: "x", persons: null,
      arrivalAt: null, departureAt: null, hotel: { plan: null, roomPaise: 1, planPaise: 1, extraBedPaise: 1, laundryPaise: 1, vpoPaise: 1, gstPaise: 1, mode: null },
      food: { foodPaise: 1, planPaise: 1, laundryPaise: 1, gstPaise: 1, mode: null }, hotelGstPercent: null, foodGstPercent: null, hotelSac: "x", foodSac: "x", hotelTotalPaise: 1, foodTotalPaise: 1, advance: null, balanceHotelPaise: 1, balanceFoodPaise: 1,
      stay: [{ from: "x", to: "x", plan: null, persons: 1, nights: 1, ratePaise: null, amountPaise: 1 }], planFoodOwedPaise: 1, referenceName: "x", referenceMobile: "x", instruction: "x", settlement: null, createdAt: "x",
    };
    for (const item of body.page.items) assertMatchesContract(item, sample);
    const s = body.page.items.find((b: Bill) => b.settlement).settlement;
    assertMatchesContract(s, { installments: [{ date: "x", hotelPaise: 1, hotelMode: null, foodPaise: 1, foodMode: null }], referenceName: "x", referenceMobile: "x", instruction: "x", excessReceiptNo: null, recordedAt: "x" });
    const names = async (q: string) => (await json(await listRoute(req("GET", `/api/v1/billing/bills${q}`, "viewer")))).data.page.items.map((b: Bill) => b.billNo);
    assert.deepEqual(await names("?tab=due"), ["2026 / 2"]);
    assert.deepEqual(await names("?search=gr-77%202026%20%2F%203&tab=settled"), ["2026 / 3"]);
    assert.equal((await listRoute(req("GET", "/api/v1/billing/bills?sort=x;y", "viewer"))).status, 422);
  });
  test("the four levels and none", async () => {
    const b = await created();
    assert.equal((await listRoute(req("GET", "/api/v1/billing/bills", "nobody"))).status, 403);
    assert.equal((await create("viewer", { billNo: "9" })).status, 403);
    assert.equal((await update("clerk", b.id, { ...input(), version: 1 })).status, 403);
    assert.equal((await remove("editor", b.id, 1)).status, 403);
  });
  test("hotel isolation: another hotel's bill is not found anywhere; numbers start at 1 per hotel", async () => {
    const b = await created();
    assert.equal((await getOne("adminB", b.id)).status, 404);
    assert.equal((await previewRoute(req("GET", `/api/v1/billing/bills/${b.id}/preview`, "adminB"), ctx({ id: b.id }))).status, 404);
    assert.equal((await settle("adminB", b.id, settleInput(1, [inst("2026-10-05", 1)]))).status, 404);
    assert.equal((await remove("adminB", b.id, 1)).status, 404);
    assert.equal((await created({}, "adminB")).entryNo, 1);
  });
});

describe("concurrency (one unit at a time per hotel; MySQL holds the rows FOR UPDATE)", () => {
  const meta = { traceId: "t", ip: null };
  const clerk = (): VerifiedSession => sessions.get("clerk") as VerifiedSession;
  test("two bills taking the SAME advance at once: one takes it all, the other is refused; the balance never goes below zero", async () => {
    const a = await advance();
    const big = input({ advanceId: a.id, hotel: hotel({ roomPaise: 500000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    const results = await Promise.allSettled([bills.create(clerk(), { ...big, billNo: "1" } as never, meta), bills.create(clerk(), { ...big, billNo: "2" } as never, meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const refused = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError;
    assert.equal(refused.message, "Advance 2026 / 814 has nothing left to take off.");
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(0));
  });
  test("two partial bills on one advance at once: both succeed and together take no more than it held", async () => {
    const a = await advance();
    const part = input({ advanceId: a.id, hotel: hotel({ roomPaise: 300000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    const [x, y] = await Promise.all([bills.create(clerk(), { ...part, billNo: "1" } as never, meta), bills.create(clerk(), { ...part, billNo: "2" } as never, meta)]);
    assert.equal((x.advance?.hotelPaise ?? 0) + (y.advance?.hotelPaise ?? 0), 500000);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(0));
  });
  test("the same settlement twice at once: one is recorded, the other is refused; no double excess advance", async () => {
    const b = await created(debit);
    const body = settleInput(1, [inst("2026-10-05", b.hotelTotalPaise + 1000, b.foodTotalPaise)]);
    const settler = sessions.get("settler") as VerifiedSession;
    const results = await Promise.allSettled([bills.settle(settler, b.id, body as never, meta), bills.settle(settler, b.id, body as never, meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError).code, "CONFLICT");
    assert.equal(data().advances.length, 1);
  });
  test("delete while settling: whichever runs second is refused, the money is never counted twice", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, ...debit });
    const admin = sessions.get("admin") as VerifiedSession;
    const results = await Promise.allSettled([bills.settle(admin, b.id, settleInput(1, [inst("2026-10-05", 100)]) as never, meta), bills.remove(admin, b.id, 1, meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const row = data().bills[0];
    const deleted = row.deletedAt !== null;
    assert.equal(deleted, results[1].status === "fulfilled");
    // the advance got its money back only if the delete won
    assert.equal(data().advances[0].hotelBalancePaise, deleted ? BigInt(500000) : BigInt(0));
  });
});

describe("HMS deviation §11.8: restoring a deleted bill re-takes its advance money, or is refused", () => {
  const small = () => hotel({ roomPaise: 200000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 });
  const restore = (who: string, billId: string, version: number) => restoreRoute(req("POST", `/api/v1/billing/bills/${billId}/restore`, who, { version }), ctx({ id: billId }));
  test("the advance can cover it: the bill comes back and the advance gives the money again, in one unit", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: small() });
    await remove("admin", b.id, 1);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(500000));
    assert.equal((await restore("super", b.id, 2)).status, 200);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(300000));
  });
  test("the money went to another bill meanwhile: CONFLICT 'The advance no longer has enough left to restore this bill.', nothing changes", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: small() });
    await remove("admin", b.id, 1);
    await created({ billNo: "2", advanceId: a.id, hotel: hotel({ roomPaise: 400000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    const res = await restore("super", b.id, 2);
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "The advance no longer has enough left to restore this bill.");
    assert.ok(data().bills[0].deletedAt);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(100000));
  });
  test("the advance itself is in the recycle bin: refused", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: small() });
    await remove("admin", b.id, 1);
    data().advances[0].deletedAt = new Date();
    assert.equal((await restore("super", b.id, 2)).status, 409);
  });
  test("race: a restore and a new bill on the same advance at once: never more taken than it held", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: hotel({ roomPaise: 400000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) });
    await remove("admin", b.id, 1);
    const superS = sessions.get("super") as VerifiedSession;
    const meta = { traceId: "t", ip: null };
    const results = await Promise.allSettled([
      bills.restore(superS, b.id, 2, meta),
      bills.create(sessions.get("clerk") as VerifiedSession, input({ billNo: "2", advanceId: a.id, hotel: hotel({ roomPaise: 400000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0 }) }) as never, meta),
    ]);
    assert.ok(results.some((r) => r.status === "fulfilled"));
    const live = data().bills.filter((x) => x.deletedAt === null);
    const takenTotal = live.reduce((n, x) => n + x.advanceHotelAmountPaise, BigInt(0));
    assert.ok(takenTotal + data().advances[0].hotelBalancePaise === BigInt(500000), "taken + left = what was paid");
    assert.ok(data().advances[0].hotelBalancePaise >= BigInt(0));
  });
  test("two restores of the same bill at once: one wins, the other is refused", async () => {
    const a = await advance();
    const b = await created({ advanceId: a.id, hotel: small() });
    await remove("admin", b.id, 1);
    const superS = sessions.get("super") as VerifiedSession;
    const results = await Promise.allSettled([bills.restore(superS, b.id, 2, { traceId: "t", ip: null }), bills.restore(superS, b.id, 2, { traceId: "t", ip: null })]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(data().advances[0].hotelBalancePaise, BigInt(300000));
  });
  test("restoring a recycle-binned ADVANCE that live bills claim more of than it holds: refused", async () => {
    const a = await advance();
    await created({ advanceId: a.id, hotel: small() });
    // a forced delete of the used advance, then its balance is put back by hand: restoring would count the bill's 2,000 twice
    const row = data().advances[0];
    row.deletedAt = new Date();
    row.hotelBalancePaise = BigInt(500000);
    const res = await restoreAdvanceRoute(req("POST", `/api/v1/billing/advances/${a.id}/restore`, "super", { version: row.version }), ctx({ id: a.id }));
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "The bills that used this advance now claim more than it holds.");
    // the refused unit rolled the hotel's data back to a copy: look at the row again
    const again = data().advances[0];
    again.hotelBalancePaise = BigInt(300000);
    assert.equal((await restoreAdvanceRoute(req("POST", `/api/v1/billing/advances/${a.id}/restore`, "super", { version: again.version }), ctx({ id: a.id }))).status, 200);
  });
});

const MYSQL = "needs the MySQL billing repository (Worker A, M3): un-skipped when it lands";
describe("bills on MySQL (skipped until the repository exists)", () => {
  test("two connections apply the same advance: SELECT ... FOR UPDATE makes the second wait and see the lower balance", { skip: MYSQL }, () => {});
  test("two connections settle the same bill: the second sees the recorded settlement and is refused", { skip: MYSQL }, () => {});
  test("delete and settle on two connections: one waits for the other's row lock, no lost update", { skip: MYSQL }, () => {});
  test("the bill number is unique among live rows (functional unique index); bill entry numbers under GET_LOCK", { skip: MYSQL }, () => {});
  test("EXPLAIN: the list by bill date, the carried-forward debit bills and numbersByAdvance use an index", { skip: MYSQL }, () => {});
  test("restore on two connections: the advance row is held FOR UPDATE while the bill re-takes its money; a racing bill waits", { skip: MYSQL }, () => {});
});
