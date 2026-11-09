// The guest's documents as PDFs (guest portal round 3 c, rebuilt on main): an issued bill (the hotel's own print), the receipt of a payment-history line (an advance prints as
// the hotel's advance receipt, a payment on a bill as a simple receipt) and the statement for a period. Ownership is decided in the guest's own scoped read: another guest's
// bill or line is 404, the running stay bill 409, a guest linked to several hotels names the hotel, a period is at most a year. Through the REAL route files.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as billPdfRoute } from "../../src/app/api/v1/guest/bills/[id]/pdf/route";
import { GET as receiptRoute } from "../../src/app/api/v1/guest/history/[id]/receipt/route";
import { GET as historyRoute } from "../../src/app/api/v1/guest/history/route";
import { GET as statementRoute } from "../../src/app/api/v1/guest/history/statement/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureBillingAdvances, configureBillingBills } from "../../src/server/compose/billing";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { createBillService } from "../../src/server/services/billing/billService";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { advance, bill, ctx, customer, json, pid, req, room, stay, wirePortal } from "./helpers/portalWorld";
import { catalog, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST = pid(11);
const OTHER = pid(12);
const BILL_MINE = pid(31);
const BILL_OTHER = pid(32);
const ADV_MINE = pid(71);
const STAY = pid(41);

const sessions = new Map<string, VerifiedSession>();
const guestOf = (name: string, customerId: string, hotelId = HOTEL_A) =>
  sessions.set(name, makeSession({ userId: pid(900 + sessions.size), hotelId, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } }));
guestOf("amit", CUST);
guestOf("bina", OTHER);
guestOf("amitAB", CUST);
const memberships: Memberships = {
  list: async (userId, kind) => (kind === "guest" && userId === sessions.get("amitAB")?.userId ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CUST }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CUST }] : []),
};

const clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map(), { memberships });
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

beforeEach(() => {
  world = wirePortal(sessions, () => clock, new Map(), { memberships });
  // billing's worker-side previews read the SAME store (the PDFs are the hotel's own prints)
  const deps = { unit: world.hotel.unit as never, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => clock };
  configureBillingBills(createBillService(deps));
  configureBillingAdvances(createAdvanceService(deps));
  configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 60_000 }));
  const a = data();
  a.profile = { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "Ring Road, Rajkot", phone: "0281 245 6789", gstin: null, foodGstin: null };
  a.customers.push(customer({ id: CUST, mobile: "9876543210" }), customer({ id: OTHER, name: "Bina Shah", mobile: "9123456780" }));
  a.bills.push(
    bill({ id: BILL_MINE, billNumber: "2026 / 0412", billDate: "2026-08-14", mobileNumber: "9876543210", hotelModeOfPayment: "Cash" }),
    bill({ id: BILL_OTHER, billNumber: "2026 / 0414", billDate: "2026-09-01", mobileNumber: "9123456780", guestName: "Bina Shah" }),
  );
  a.advances.push(advance({ id: ADV_MINE, receiptNumber: "2026 / 0090", paymentDate: "2026-09-28", mobileNumber: "09876543210" }));
  a.rooms.push(room({ id: pid(51), number: "101" }));
  a.stays.push(stay({ id: STAY, roomId: pid(51), mobile: "9876543210" }));
  data(HOTEL_B).customers.push(customer({ id: CUST, name: "Amit at B", mobile: "9876543210" }));
});

const get = (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string, params: Record<string, string> = {}) => route(req("GET", path, who), ctx(params));
const isPdf = async (res: Response) => {
  assert.equal(res.status, 200, res.status === 200 ? "" : JSON.stringify(await res.clone().json()));
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
};

describe("the bill PDF", () => {
  test("one of the guest's own issued bills prints (the hotel's own print); another guest's is 404; the running stay bill is 409", async () => {
    await isPdf(await get(billPdfRoute, `/api/v1/guest/bills/${BILL_MINE}.hotel/pdf`, "amit", { id: `${BILL_MINE}.hotel` }));
    assert.equal((await get(billPdfRoute, `/api/v1/guest/bills/${BILL_OTHER}.hotel/pdf`, "amit", { id: `${BILL_OTHER}.hotel` })).status, 404);
    const running = await get(billPdfRoute, `/api/v1/guest/bills/stay.${STAY}.hotel/pdf`, "amit", { id: `stay.${STAY}.hotel` });
    assert.equal(running.status, 409);
    assert.match((await json(running)).error.message, /still running/);
    assert.equal((await get(billPdfRoute, "/api/v1/guest/bills/not-an-id/pdf", "amit", { id: "not-an-id" })).status, 422);
  });

  test("a guest linked to several hotels names the hotel; the bill of hotel A asked at hotel B is 404", async () => {
    assert.equal((await get(billPdfRoute, `/api/v1/guest/bills/${BILL_MINE}.hotel/pdf`, "amitAB", { id: `${BILL_MINE}.hotel` })).status, 422);
    await isPdf(await get(billPdfRoute, `/api/v1/guest/bills/${BILL_MINE}.hotel/pdf?hotel=${HOTEL_A}`, "amitAB", { id: `${BILL_MINE}.hotel` }));
    assert.equal((await get(billPdfRoute, `/api/v1/guest/bills/${BILL_MINE}.hotel/pdf?hotel=${HOTEL_B}`, "amitAB", { id: `${BILL_MINE}.hotel` })).status, 404);
  });
});

describe("the receipt of a payment-history line", () => {
  test("an advance prints as the hotel's advance receipt; a payment on a bill as a simple receipt; anything else is 404", async () => {
    const lines = (await json(await get(historyRoute, "/api/v1/guest/history?tab=payments&pageSize=50", "amit"))).data.items as { id: string }[];
    const adv = lines.find((l) => l.id.startsWith(`adv:${ADV_MINE}`));
    assert.ok(adv, JSON.stringify(lines.map((l) => l.id)));
    await isPdf(await get(receiptRoute, `/api/v1/guest/history/${encodeURIComponent(adv.id)}/receipt`, "amit", { id: adv.id }));
    const pay = lines.find((l) => l.id.startsWith("pay:"));
    if (pay) await isPdf(await get(receiptRoute, `/api/v1/guest/history/${encodeURIComponent(pay.id)}/receipt`, "amit", { id: pay.id }));
    for (const id of [`adv:${pid(99)}:hotel`, `pay:${BILL_OTHER}:p1`]) assert.equal((await get(receiptRoute, `/api/v1/guest/history/${encodeURIComponent(id)}/receipt`, "amit", { id })).status, 404, id);
    assert.equal((await get(receiptRoute, `/api/v1/guest/history/${encodeURIComponent(adv.id)}/receipt`, "bina", { id: adv.id })).status, 404, "another guest's advance");
    assert.equal((await get(receiptRoute, "/api/v1/guest/history/bill:x/receipt", "amit", { id: "bill:x" })).status, 422, "only payment lines have receipts");
  });
});

describe("the statement", () => {
  test("a period prints; from after to, or more than a year, is 422; a bad date is 422", async () => {
    await isPdf(await get(statementRoute, "/api/v1/guest/history/statement?from=2026-08-01&to=2026-10-05", "amit"));
    await isPdf(await get(statementRoute, "/api/v1/guest/history/statement?from=2026-01-01&to=2026-01-31", "amit"));
    assert.equal((await get(statementRoute, "/api/v1/guest/history/statement?from=2026-10-05&to=2026-08-01", "amit")).status, 422);
    assert.equal((await get(statementRoute, "/api/v1/guest/history/statement?from=2025-01-01&to=2026-10-05", "amit")).status, 422);
    assert.equal((await get(statementRoute, "/api/v1/guest/history/statement?from=yesterday&to=2026-10-05", "amit")).status, 422);
  });
});
