// The COMPANY PORTAL end to end through the REAL route files, the wrapper, the corporate service and the in-memory hotel store: a corporate account has
// no module permission and sees only the company its account points at (its profile, its live bills and advances through the hotel's own company
// ledger, its reservations). Another company's and another hotel's records are 404 or absent. Paying and booking wait for online payment; cancelling a
// booking before it starts is real, locked and logged.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { POST as payBillRoute } from "../../src/app/api/v1/corporate/bills/[id]/pay/route";
import { GET as billRoute } from "../../src/app/api/v1/corporate/bills/[id]/route";
import { GET as dueBillsRoute } from "../../src/app/api/v1/corporate/accounts/due-bills/route";
import { GET as ledgerRoute } from "../../src/app/api/v1/corporate/accounts/ledger/route";
import { GET as paymentHistoryRoute } from "../../src/app/api/v1/corporate/accounts/payment-history/route";
import { GET as dashboardRoute } from "../../src/app/api/v1/corporate/dashboard/route";
import { POST as payDuesRoute } from "../../src/app/api/v1/corporate/dues/pay/route";
import { GET as profileRoute, PUT as profilePut } from "../../src/app/api/v1/corporate/profile/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { ledgerWindow, PAY_OFF, periodRange } from "../../src/server/services/corporate/corporateService";
import type { Line } from "../../src/server/services/companies/ledger";
import { STATEMENT_MAX_ROWS } from "../../src/server/services/companies/ledgerService";
import { advance, bill, company, ctx, json, pid, req, reservation, room, roomType, wirePortal } from "./helpers/portalWorld";
import { grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CO = pid(21);
const CO2 = pid(22);
const OWING = pid(31); // on account, hotel side still owed
const PAID = pid(32);
const OTHER = pid(33); // the other company's
const RES_FUTURE = pid(41);
const RES_STARTED = pid(42);
const RES_OTHER = pid(43);
const TYPE = pid(61);
const STAFF = pid(700);

const sessions = new Map<string, VerifiedSession>();
const corp = (name: string, companyId: string, hotelId = HOTEL_A) =>
  sessions.set(name, makeSession({ userId: pid(900 + sessions.size), hotelId, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: companyId } }));
corp("tcs", CO);
corp("infosys", CO2);
corp("tcsInB", CO, HOTEL_B);
sessions.set("guest", makeSession({ userId: pid(980), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: pid(11) } }));
sessions.set("staff", makeSession({ userId: pid(981), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web", grants: [grant("companies", "full"), grant("bills", "full")] }));

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map([[STAFF, "Ravi Front Desk"]]));
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

function seed(): void {
  const a = data();
  a.companyProfiles.push(company({ id: CO, name: "Tata Consultancy Services" }), company({ id: CO2, name: "Infosys", gstNumber: "24AAACI1234A1Z1", contacts: [{ role: "", name: "Iyer", email: "", mobile: "9000000001" }] }));
  a.bills.push(
    // 4,725 hotel left on account (minus nothing), food paid in cash at checkout
    bill({ id: OWING, billNumber: "2026 / 2041", billDate: "2026-08-20", companyId: CO, guestName: "Rohan Mehta", hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(472500) }),
    bill({ id: PAID, billNumber: "2026 / 2058", billDate: "2026-09-25", companyId: CO, guestName: "Kavita Nair" }),
    bill({ id: OTHER, billNumber: "2026 / 2077", billDate: "2026-09-26", companyId: CO2, guestName: "Arjun Reddy", hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(472500) }),
  );
  a.advances.push(advance({ id: pid(71), receiptNumber: "ADV-0311", paymentDate: "2026-09-01", companyId: CO, hotelBalancePaise: BigInt(500000) }), advance({ id: pid(72), receiptNumber: "ADV-0400", paymentDate: "2026-09-02", companyId: CO2 }));
  a.roomTypes.push(roomType({ id: TYPE, name: "Deluxe Room", totalCount: 3 }));
  a.rooms.push(room({ id: pid(51), number: "201", roomTypeId: TYPE }), room({ id: pid(52), number: "202", roomTypeId: TYPE }));
  a.reservations.push(
    reservation({ id: RES_FUTURE, reference: "RES-26-00010", companyId: CO, roomTypeId: TYPE, checkIn: "2026-10-12", checkOut: "2026-10-15", createdBy: STAFF, createdAt: new Date("2026-10-02T06:00:00Z") }),
    reservation({ id: RES_STARTED, reference: "RES-26-00011", companyId: CO, roomTypeId: TYPE, checkIn: "2026-10-04", checkOut: "2026-10-06", status: "checked_in", createdAt: new Date("2026-09-30T06:00:00Z") }),
    reservation({ id: RES_OTHER, reference: "RES-26-00012", companyId: CO2, roomTypeId: TYPE, checkIn: "2026-10-12", checkOut: "2026-10-13" }),
  );
  const b = data(HOTEL_B);
  b.companyProfiles.push(company({ id: CO, name: "TCS at Hotel B" }));
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  world = wirePortal(sessions, () => clock, new Map([[STAFF, "Ravi Front Desk"]]));
  seed();
});

const get = async (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string | null, params: Record<string, string> = {}) => route(req("GET", path, who), ctx(params));
const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};

describe("who may use the company portal", () => {
  test("no session 401; staff with every grant and a guest account are 403; a deleted company is told so (409 PORTAL_NOT_LINKED)", async () => {
    assert.equal((await get(dashboardRoute, "/api/v1/corporate/dashboard", null)).status, 401);
    for (const who of ["staff", "guest"]) assert.equal((await get(dashboardRoute, "/api/v1/corporate/dashboard", who)).status, 403, who);
    await ok(await get(dashboardRoute, "/api/v1/corporate/dashboard", "tcs"));
    data().companyProfiles[0].deletedAt = new Date();
    const gone = await get(dashboardRoute, "/api/v1/corporate/dashboard", "tcs");
    assert.equal(gone.status, 409);
    assert.equal((await json(gone)).error.code, "PORTAL_NOT_LINKED");
  });
});

describe("the company sees only its own account", () => {
  test("dashboard and due bills: its own bills, what it owes, how old the oldest unpaid bill is", async () => {
    const d = await ok(await get(dashboardRoute, "/api/v1/corporate/dashboard", "tcs"));
    assert.equal(d.cards.totalDuePaise, 472500);
    assert.equal(d.cards.creditPaise, 27500, "the advance is more than is billed: the company is in credit");
    assert.deepEqual(d.attention.map((b: { billNumber: string }) => b.billNumber), ["2026 / 2041"]);
    assert.equal(d.recentPayments.length, 3);
    assert.ok(!JSON.stringify(d).includes("Arjun") && !JSON.stringify(d).includes("ADV-0400"), "nothing of another company");
    const due = await ok(await get(dueBillsRoute, "/api/v1/corporate/accounts/due-bills", "tcs"));
    assert.deepEqual(due.items.map((b: { id: string }) => b.id), [OWING]);
    assert.deepEqual([due.items[0].status, due.items[0].ageDays, due.items[0].duePaise], ["overdue", 46, 472500]);
    assert.deepEqual([due.summary.totalDuePaise, due.summary.openBills], [472500, 1]);
    assert.equal((await ok(await get(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?search=rohan", "tcs"))).total, 1);
    assert.equal((await ok(await get(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?search=kavita", "tcs"))).total, 0, "a paid bill is not a due bill");
  });

  test("one bill opens; another company's and another hotel's are 404", async () => {
    const detail = await ok(await get(billRoute, `/api/v1/corporate/bills/${OWING}`, "tcs", { id: OWING }));
    assert.equal(detail.bill.billNumber, "2026 / 2041");
    assert.deepEqual([detail.bill.hotelMode, detail.bill.foodMode, detail.bill.balanceHotelPaise, detail.bill.totalHotelPaise], ["On account", "Cash", 472500, 472500]);
    assert.deepEqual([detail.bill.hotelSac, detail.bill.foodSac], ["996311", "996331"], "the company's tax invoice carries the bill's HSN/SAC");
    assert.equal((await get(billRoute, `/api/v1/corporate/bills/${OTHER}`, "tcs", { id: OTHER })).status, 404);
    assert.equal((await get(billRoute, `/api/v1/corporate/bills/${OWING}`, "infosys", { id: OWING })).status, 404);
  });

  test("ledger and payment history: the hotel's own ledger lines, newest first, with periods (financial year from 1 April)", async () => {
    const all = await ok(await get(ledgerRoute, "/api/v1/corporate/accounts/ledger?period=all", "tcs"));
    assert.equal(all.total, 5);
    assert.equal(all.items[0].date, "2026-09-25");
    assert.equal(all.byHotel[0].closingPaise, -27500);
    assert.equal(all.capped, false, "a short account is not cut");
    const bills = all.items.filter((l: { detail: { kind: string } }) => l.detail.kind === "bill");
    assert.deepEqual(bills.map((l: { detail: { mode: string; billId: string } }) => [l.detail.mode, l.detail.billId]), [["Cash", PAID], ["On account", OWING]]);
    const month = await ok(await get(ledgerRoute, "/api/v1/corporate/accounts/ledger?period=month", "tcs"));
    assert.deepEqual([month.total, month.byHotel[0].openingPaise], [0, -27500]);
    const pays = await ok(await get(paymentHistoryRoute, "/api/v1/corporate/accounts/payment-history", "tcs"));
    assert.equal(pays.total, 3);
    assert.equal(pays.summary.receivedPaise, 1182500);
    assert.equal((await get(ledgerRoute, "/api/v1/corporate/accounts/ledger?period=decade", "tcs")).status, 422);
    assert.deepEqual(periodRange("year", "2026-02-10"), ["2025-04-01", "2026-02-10"]);
    assert.deepEqual(periodRange("last", "2026-03-15"), ["2026-02-01", "2026-02-28"]);
  });
  test("ledger cap (the statement rule): All time shows at most the last three years and at most the newest 5,000 lines, the opening carrying the rest", () => {
    const line = (i: number, date: string, balance: number): Line => ({ key: `bill:${i}:0`, kind: "bill", date, recordId: String(i), entry: i, ref: String(i), guest: null, room: null, mode: null, note: null, debitPaise: BigInt(100), creditPaise: BigInt(0), order: 0, balancePaise: BigInt(balance) });
    const today = "2026-10-05";
    // two old lines (2020), then 6,000 lines in 2026: the old ones go by the three-year rule, then the line cap keeps the newest 5,000
    const many: Line[] = [line(0, "2020-01-01", 100), line(1, "2020-06-01", 200)];
    for (let i = 0; i < 6000; i++) many.push(line(i + 2, i < 3000 ? "2026-03-01" : "2026-09-01", 300 + i * 100));
    const w = ledgerWindow(many, "all", today);
    assert.equal(w.lines.length, STATEMENT_MAX_ROWS);
    assert.equal(w.capped, true);
    assert.equal(w.lines[w.lines.length - 1], many[many.length - 1], "the newest line is kept");
    assert.equal(w.openingPaise, many[many.length - STATEMENT_MAX_ROWS - 1].balancePaise, "the balance just before the first line shown");
    assert.equal(w.closingPaise, many[many.length - 1].balancePaise);
    assert.equal(w.from, "2026-03-01");
    // only the three-year rule: the 2020 lines are left out, the opening is their balance, from is three years back
    const few = [line(0, "2020-01-01", 100), line(1, "2020-06-01", 200), line(2, "2026-09-01", 300)];
    const y = ledgerWindow(few, "all", today);
    assert.deepEqual([y.lines.length, y.openingPaise, y.closingPaise, y.capped], [1, BigInt(200), BigInt(300), true]);
    assert.ok(y.from !== null && y.from >= "2023-10-01" && y.from < "2023-10-06", String(y.from));
    // within the rule: nothing is cut and All time stays open-ended
    const recent = ledgerWindow([line(0, "2025-01-01", 100), line(1, "2026-09-01", 200)], "all", today);
    assert.deepEqual([recent.from, recent.to, recent.lines.length, recent.openingPaise, recent.capped], [null, null, 2, BigInt(0), false]);
  });

  test("hotel isolation: the same company id in another hotel is that hotel's company, with none of this hotel's bills", async () => {
    assert.equal((await ok(await get(profileRoute, "/api/v1/corporate/profile", "tcsInB"))).name, "TCS at Hotel B");
    assert.equal((await ok(await get(dueBillsRoute, "/api/v1/corporate/accounts/due-bills", "tcsInB"))).total, 0);
    assert.equal((await get(billRoute, `/api/v1/corporate/bills/${OWING}`, "tcsInB", { id: OWING })).status, 404);
  });

  test("profile: as the hotel recorded it", async () => {
    const p = await ok(await get(profileRoute, "/api/v1/corporate/profile", "tcs"));
    assert.deepEqual([p.gstin, p.pricing.gstPct, p.pricing.tdsPct, p.pricing.tcsPct, p.setByHotel], ["24AAACT2727Q1ZV", 12, 2, 0, true]);
    assert.equal(data().companyProfiles[0].contacts.length, 2, "nothing changed");
  });

  test("profile edit (decision 48): contact fields only, in ONE hotel; the percentages are the hotel's (422); no hotel chosen is 422", async () => {
    const put = (qs: string, body: unknown) => profilePut(req("PUT", `/api/v1/corporate/profile${qs}`, "tcs", body), ctx());
    assert.equal((await put("", { email: "accounts@tcs.example" })).status, 422, "which hotel?");
    assert.equal((await put(`?hotel=${HOTEL_A}`, { gstPct: 5 })).status, 422, "a percentage in the body");
    assert.equal((await put(`?hotel=${HOTEL_A}`, { discountPct: 1 })).status, 422);
    const saved = await ok(await put(`?hotel=${HOTEL_A}`, { email: "accounts@tcs.example", address: "Navrangpura, Ahmedabad" }));
    assert.deepEqual([saved.email, saved.address, saved.pricing.gstPct], ["accounts@tcs.example", "Navrangpura, Ahmedabad", 12]);
    assert.equal(data().companyProfiles[0].email, "accounts@tcs.example");
  });
});

describe("paying", () => {
  test("paying is checked (another's bill 404, a paid bill 409, nothing due 422) and refused while online payment is off", async () => {
    assert.equal((await payBillRoute(req("POST", `/api/v1/corporate/bills/${OTHER}/pay`, "tcs"), ctx({ id: OTHER }))).status, 404);
    assert.equal((await payBillRoute(req("POST", `/api/v1/corporate/bills/${PAID}/pay`, "tcs"), ctx({ id: PAID }))).status, 409);
    let res = await payBillRoute(req("POST", `/api/v1/corporate/bills/${OWING}/pay`, "tcs"), ctx({ id: OWING }));
    assert.equal((await json(res)).error.message, PAY_OFF);
    res = await payDuesRoute(req("POST", "/api/v1/corporate/dues/pay", "tcs", { businesses: ["food"] }), ctx());
    assert.deepEqual((await json(res)).error.details.fields, { businesses: "Nothing is due for the businesses you picked." });
    res = await payDuesRoute(req("POST", "/api/v1/corporate/dues/pay", "tcs", { businesses: ["hotel"] }), ctx());
    assert.equal((await json(res)).error.message, PAY_OFF);
    assert.equal(data().bills.find((b) => b.id === OWING)?.balanceHotelAmountPaise, BigInt(472500));
  });
});
