// The GUEST PORTAL end to end through the REAL route files, the wrapper, the guest service and the in-memory hotel store: a guest account has no module
// permission and sees only its own records (the customer row it points at, and the bills, advances and stays with that customer's own mobile and no
// company); another guest's, a company's and another hotel's records are 404 or simply absent. Money waits for online payment (422, nothing changes).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as billRoute } from "../../src/app/api/v1/guest/bills/[id]/route";
import { POST as emailRoute } from "../../src/app/api/v1/guest/bills/[id]/email/route";
import { POST as payRoute } from "../../src/app/api/v1/guest/bills/pay/route";
import { GET as billsRoute } from "../../src/app/api/v1/guest/bills/route";
import { GET as historyRoute } from "../../src/app/api/v1/guest/history/route";
import { GET as menuRoute } from "../../src/app/api/v1/guest/menu/route";
import { POST as orderRoute } from "../../src/app/api/v1/guest/orders/route";
import { GET as overviewRoute } from "../../src/app/api/v1/guest/overview/route";
import { PUT as passwordRoute } from "../../src/app/api/v1/guest/password/route";
import { GET as profileRoute, PUT as updateProfileRoute } from "../../src/app/api/v1/guest/profile/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { mobileForms } from "../../src/server/repos/portal";
import { PAY_OFF, idTypeOf, maskId } from "../../src/server/services/guest/guestService";
import { advance, bill, charge, company, ctx, CURRENT_PASSWORD, customer, json, pid, req, reservation, room, roomType, stay, wirePortal } from "./helpers/portalWorld";
import { grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST_A = pid(11);
const CUST_B = pid(12);
const CO = pid(21);
const B1 = pid(31); // Amit's bill: hotel paid, food on Debit and owing
const B2 = pid(32); // a COMPANY bill with Amit's number: never in the guest portal
const B3 = pid(33); // Bina's bill
const BX = pid(34); // hotel B's bill for its own Amit
const STAY = pid(41);
const ROOM = pid(51);
const TYPE = pid(61);

const sessions = new Map<string, VerifiedSession>();
const guest = (name: string, customerId: string, hotelId = HOTEL_A, userId = pid(900 + sessions.size)) =>
  sessions.set(name, makeSession({ userId, hotelId, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } }));
guest("amit", CUST_A);
guest("bina", CUST_B);
guest("amitInB", CUST_A, HOTEL_B);
sessions.set("noScope", makeSession({ userId: pid(980), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web" }));
sessions.set("company", makeSession({ userId: pid(981), accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: CO } }));
sessions.set("staff", makeSession({ userId: pid(982), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web", grants: [grant("bills", "full"), grant("companies", "full"), grant("pms", "full")] }));

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock);
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

function seed(): void {
  const a = data();
  a.customers.push(customer({ id: CUST_A, mobile: "9876543210" }), customer({ id: CUST_B, name: "Bina Shah", mobile: "9123456780", email: "bina@example.com", idProofNumber: "B-PASS-77" }));
  a.companyProfiles.push(company({ id: CO, name: "Tata Consultancy Services" }));
  a.bills.push(
    bill({ id: B1, billNumber: "2026 / 0412", billDate: "2026-08-14", mobileNumber: "+91 98765 43210", foodModeOfPayment: "Debit", balanceFoodAmountPaise: BigInt(105000) }),
    bill({ id: B2, billNumber: "2026 / 0413", billDate: "2026-08-20", companyId: CO, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(472500) }),
    bill({ id: B3, billNumber: "2026 / 0414", billDate: "2026-09-01", guestName: "Bina Shah", mobileNumber: "9123456780", hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(472500) }),
  );
  a.advances.push(
    advance({ id: pid(71), receiptNumber: "2026 / 0090", paymentDate: "2026-09-28", mobileNumber: "09876543210" }),
    advance({ id: pid(72), receiptNumber: "2026 / 0091", paymentDate: "2026-09-29", guestName: "Bina Shah", mobileNumber: "9123456780" }),
    advance({ id: pid(73), receiptNumber: "2026 / 0092", paymentDate: "2026-09-30", companyId: CO }),
  );
  a.roomTypes.push(roomType({ id: TYPE, name: "Deluxe Room", totalCount: 3 }));
  a.rooms.push(room({ id: ROOM, number: "101", roomTypeId: TYPE }));
  a.stays.push(stay({ id: STAY, roomId: ROOM }), stay({ id: pid(42), roomId: pid(52), guestName: "Bina Shah", mobile: "9123456780" }));
  a.charges.push(charge({ id: pid(81), stayId: STAY }), charge({ id: pid(82), stayId: pid(42), description: "Bina's dinner", category: "food", side: "food", amountPaise: BigInt(99900) }));
  a.reservations.push(reservation({ id: pid(91), reference: "RES-26-00001", roomTypeId: TYPE, checkIn: "2026-10-10", checkOut: "2026-10-12", companyId: null }));
  const b = data(HOTEL_B);
  b.customers.push(customer({ id: CUST_A, name: "Amit of Hotel B", mobile: "9876543210" }));
  b.bills.push(bill({ id: BX, billNumber: "B / 0001", billDate: "2026-07-01" }));
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  world = wirePortal(sessions, () => clock);
  seed();
});

const get = async (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string | null, params: Record<string, string> = {}) => route(req("GET", path, who), ctx(params));
const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};

describe("who may use the guest portal", () => {
  test("no session 401; staff (even a SuperAdmin with every grant) and a company account are 403; a guest account with no record is told so (409 PORTAL_NOT_LINKED)", async () => {
    assert.equal((await get(overviewRoute, "/api/v1/guest/overview", null)).status, 401);
    for (const who of ["staff", "company"]) assert.equal((await get(overviewRoute, "/api/v1/guest/overview", who)).status, 403, who);
    const unlinked = await get(overviewRoute, "/api/v1/guest/overview", "noScope");
    assert.equal(unlinked.status, 409);
    assert.equal((await json(unlinked)).error.code, "PORTAL_NOT_LINKED");
    assert.equal((await get(overviewRoute, "/api/v1/guest/overview", "amit")).status, 200);
  });

  test("an account whose customer was switched off has no portal (409 PORTAL_INACTIVE)", async () => {
    data().customers[0].isActive = false;
    const res = await get(overviewRoute, "/api/v1/guest/overview", "amit");
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.code, "PORTAL_INACTIVE");
  });
});

describe("the guest sees only their own records", () => {
  test("overview: the profile (ID number masked), the stay going on now, and only their own bills to pay", async () => {
    const o = await ok(await get(overviewRoute, "/api/v1/guest/overview", "amit"));
    assert.equal(o.profile.mobile, "9876543210");
    assert.equal(o.profile.idProofType, "aadhaar");
    assert.equal(o.profile.idProofNumber, "XXXX 4321");
    assert.equal(o.profile.staysCount, 1);
    assert.deepEqual([o.stay.roomNumber, o.stay.roomType, o.stay.nights, o.stay.nightsDone], ["101", "Deluxe Room", 4, 2]);
    // the running hotel bill: 2 nights x 4,000 + laundry 450 = 8,450, GST 5% (the check-out default) = 422.50
    const current = o.openBills.find((b: { current: boolean }) => b.current);
    assert.equal(current.id, `stay.${STAY}.hotel`);
    assert.deepEqual(current.totals, { subtotalPaise: 845000, gstPaise: 42250, totalPaise: 887250, paidPaise: 0, duePaise: 887250 });
    const ids = o.openBills.map((b: { id: string }) => b.id);
    assert.deepEqual(ids.sort(), [`${B1}.food`, `stay.${STAY}.hotel`].sort());
    assert.ok(!JSON.stringify(o).includes("Bina"), "nothing of another guest");
  });

  test("bills: one per business, the company's bill and another guest's never listed; counts per tab", async () => {
    const page = await ok(await get(billsRoute, "/api/v1/guest/bills?tab=all", "amit"));
    assert.deepEqual(page.items.map((b: { id: string }) => b.id), [`stay.${STAY}.hotel`, `${B1}.hotel`, `${B1}.food`]);
    assert.deepEqual(page.counts, { open: 2, paid: 1, cancelled: 0, all: 3 });
    const food = page.items[2];
    assert.equal(food.status, "open");
    assert.deepEqual(food.totals, { subtotalPaise: 100000, gstPaise: 5000, totalPaise: 105000, paidPaise: 0, duePaise: 105000 });
    const hotel = page.items[1];
    assert.deepEqual(page.items.map((b: { sac: string }) => b.sac), ["996311", "996311", "996331"], "each bill carries its HSN/SAC: rooms 996311, food 996331");
    assert.deepEqual(hotel.payments.map((p: { method: string; amountPaise: number }) => [p.method, p.amountPaise]), [["cash", 472500]]);
    const paid = await ok(await get(billsRoute, "/api/v1/guest/bills?tab=paid", "amit"));
    assert.deepEqual(paid.items.map((b: { id: string }) => b.id), [`${B1}.hotel`]);
    const searched = await ok(await get(billsRoute, "/api/v1/guest/bills?search=0412", "amit"));
    assert.equal(searched.total, 2);
  });

  test("every bill carries who issued it: the hotel side with the hotel's GST number, the food side with the food one; blank when the hotel entered none", async () => {
    const a = data();
    a.profile = { name: "Hotel Pallav", foodName: "Pallav Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 123456", gstin: "24ABCDE1234F1Z5", foodGstin: "24AAKFS5678K1Z2" };
    const page = await ok(await get(billsRoute, "/api/v1/guest/bills?tab=all", "amit"));
    const by = (id: string) => page.items.find((b: { id: string }) => b.id === id).seller;
    assert.deepEqual(by(`${B1}.hotel`), { name: "Hotel Pallav", address: "150 Feet Ring Road, Rajkot", phone: "0281 123456", gstin: "24ABCDE1234F1Z5" });
    assert.deepEqual(by(`${B1}.food`), { name: "Pallav Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 123456", gstin: "24AAKFS5678K1Z2" });
    assert.equal(by(`stay.${STAY}.hotel`).gstin, "24ABCDE1234F1Z5");
    const one = await ok(await get(billRoute, `/api/v1/guest/bills/${B1}.food`, "amit", { id: `${B1}.food` }));
    assert.equal(one.seller.gstin, "24AAKFS5678K1Z2");
    a.profile = { ...a.profile, address: null, gstin: null };
    const blank = await ok(await get(billRoute, `/api/v1/guest/bills/${B1}.hotel`, "amit", { id: `${B1}.hotel` }));
    assert.deepEqual([blank.seller.address, blank.seller.gstin], [null, null]);
  });

  test("one bill: their own opens; another guest's, the company's and another hotel's are 404", async () => {
    await ok(await get(billRoute, `/api/v1/guest/bills/${B1}.food`, "amit", { id: `${B1}.food` }));
    for (const id of [`${B3}.hotel`, `${B2}.hotel`, `${BX}.hotel`, `stay.${pid(42)}.food`]) assert.equal((await get(billRoute, `/api/v1/guest/bills/${id}`, "amit", { id })).status, 404, id);
    assert.equal((await get(billRoute, "/api/v1/guest/bills/x", "amit", { id: "1 OR 1=1" })).status, 422);
  });

  test("hotel isolation: the same customer id in another hotel sees that hotel's records only", async () => {
    const page = await ok(await get(billsRoute, "/api/v1/guest/bills", "amitInB"));
    assert.deepEqual(page.items.map((b: { id: string }) => b.id), [`${BX}.hotel`, `${BX}.food`]);
    const o = await ok(await get(overviewRoute, "/api/v1/guest/overview", "amitInB"));
    assert.equal(o.profile.name, "Amit of Hotel B");
    assert.equal(o.stay, null);
  });

  test("history: their charges and payments (advance, room nights, laundry), newest first, nothing of anyone else", async () => {
    const h = await ok(await get(historyRoute, "/api/v1/guest/history", "amit"));
    const titles = h.items.map((i: { title: string }) => i.title);
    assert.ok(titles.includes("Laundry: 6 items"));
    assert.ok(titles.includes("Room 101, 2 nights so far"));
    assert.ok(titles.some((t: string) => t.startsWith("Advance received")));
    assert.ok(!JSON.stringify(h).includes("0091") && !JSON.stringify(h).includes("0092") && !JSON.stringify(h).includes("Bina"));
    const sorted = [...h.items].sort((a: { at: string }, b: { at: string }) => (a.at < b.at ? 1 : -1));
    assert.deepEqual(h.items.map((i: { at: string }) => i.at), sorted.map((i: { at: string }) => i.at));
    const payments = await ok(await get(historyRoute, "/api/v1/guest/history?tab=payments", "amit"));
    assert.ok(payments.items.every((i: { kind: string }) => i.kind === "payment"));
    assert.equal(h.counts.all, h.counts.charges + h.counts.payments);
  });
});

describe("profile and password", () => {
  test("the guest's own details: Pallav's words for bad input, the row updated, a system-log line, the masked number kept", async () => {
    const base = { name: "Amit R Joshi", email: "amit.r@example.com", city: "Rajkot", address: "Ring Road", idProofType: "aadhaar", idProofNumber: "XXXX 4321", notifyEmail: true };
    let res = await updateProfileRoute(req("PUT", "/api/v1/guest/profile", "amit", { ...base, name: "", email: "nope" }), ctx());
    assert.equal(res.status, 422);
    assert.deepEqual((await json(res)).error.details.fields, { name: "Enter your full name.", email: "Enter a valid email, like name@example.com." });
    res = await updateProfileRoute(req("PUT", "/api/v1/guest/profile", "amit", { ...base, mobile: "9000000000" }), ctx());
    assert.equal(res.status, 422, "the mobile is not the guest's to change (unknown key refused)");
    const p = await ok(await updateProfileRoute(req("PUT", "/api/v1/guest/profile", "amit", base), ctx()));
    assert.deepEqual([p.name, p.email, p.city, p.idProofNumber], ["Amit R Joshi", "amit.r@example.com", "Rajkot", "XXXX 4321"]);
    const row = data().customers.find((c) => c.id === CUST_A);
    assert.deepEqual([row?.name, row?.idProofNumber, row?.mobile], ["Amit R Joshi", "123456784321", "9876543210"]);
    const log = data().systemLogs.filter((l) => l.module === "guest-portal");
    assert.equal(log.length, 1);
    assert.ok(!JSON.stringify(log).includes("123456784321"), "an ID number never reaches the log");
    assert.equal(data().customers.find((c) => c.id === CUST_B)?.name, "Bina Shah");
    assert.equal((await ok(await get(profileRoute, "/api/v1/guest/profile", "amit"))).name, "Amit R Joshi");
  });

  test("password: a wrong current password is a field error, the right one changes it", async () => {
    let res = await passwordRoute(req("PUT", "/api/v1/guest/password", "amit", { current: "wrong", next: "New@pass123", confirm: "New@pass123" }), ctx());
    assert.equal(res.status, 422);
    assert.deepEqual((await json(res)).error.details.fields, { current: "That is not your current password." });
    res = await passwordRoute(req("PUT", "/api/v1/guest/password", "amit", { current: CURRENT_PASSWORD, next: "New@pass123", confirm: "Other@pass123" }), ctx());
    assert.deepEqual((await json(res)).error.details.fields, { confirm: "The two passwords do not match." });
    assert.deepEqual(await ok(await passwordRoute(req("PUT", "/api/v1/guest/password", "amit", { current: CURRENT_PASSWORD, next: "New@pass123", confirm: "New@pass123" }), ctx())), { changed: true });
    assert.equal(world.changed.length, 1);
  });

  test("password: ten tries a minute per guest, the 11th is 429 with Retry-After and changes nothing; another guest is not held up", async () => {
    const wrong = { current: "wrong", next: "New@pass123", confirm: "New@pass123" };
    for (let i = 0; i < 10; i++) assert.equal((await passwordRoute(req("PUT", "/api/v1/guest/password", "bina", wrong), ctx())).status, 422, `try ${i + 1}`);
    const res = await passwordRoute(req("PUT", "/api/v1/guest/password", "bina", { current: CURRENT_PASSWORD, next: "New@pass123", confirm: "New@pass123" }), ctx());
    assert.equal(res.status, 429);
    assert.equal((await json(res)).error.code, "RATE_LIMITED");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    assert.equal(world.changed.length, 0, "the refused try never reached the credential side");
    assert.equal((await passwordRoute(req("PUT", "/api/v1/guest/password", "amitInB", wrong), ctx())).status, 422, "another guest still gets through");
  });
});

describe("ordering and paying", () => {
  test("paying: their own owing bill is checked then refused (online payment off); another's is 404; a paid one 409; nothing changes", async () => {
    let res = await payRoute(req("POST", "/api/v1/guest/bills/pay", "amit", { billIds: [`${B1}.food`] }), ctx());
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.message, PAY_OFF);
    res = await payRoute(req("POST", "/api/v1/guest/bills/pay", "amit", { billIds: [`${B3}.hotel`] }), ctx());
    assert.equal(res.status, 404);
    res = await payRoute(req("POST", "/api/v1/guest/bills/pay", "amit", { billIds: [`${B1}.hotel`] }), ctx());
    assert.equal(res.status, 409);
    res = await payRoute(req("POST", "/api/v1/guest/bills/pay", "amit", { billIds: [] }), ctx());
    assert.deepEqual((await json(res)).error.details.fields, { bills: "Select at least one bill." });
    assert.equal(data().bills.find((b) => b.id === B1)?.balanceFoodAmountPaise, BigInt(105000));
    assert.equal((await emailRoute(req("POST", `/api/v1/guest/bills/${B3}.hotel/email`, "amit"), ctx({ id: `${B3}.hotel` }))).status, 404);
  });

  const MENU = { tea: pid(201), thali: pid(202), shirt: pid(203), gone: pid(204) };
  function stock(): void {
    const rows = data().menuRows;
    rows.push(
      { id: MENU.tea, group: "restaurant", name: "Tea / Coffee (2 cups)", note: null, pricePaise: BigInt(8000), available: true, sortOrder: 3 },
      { id: MENU.thali, group: "restaurant", name: "Gujarati Thali", note: "With sweet", pricePaise: BigInt(32000), available: true, sortOrder: 1 },
      { id: MENU.shirt, group: "laundry", name: "Shirt", note: null, pricePaise: BigInt(4000), available: true, sortOrder: 1 },
      { id: MENU.gone, group: "restaurant", name: "Masala Dosa", note: "Breakfast only", pricePaise: BigInt(15000), available: false, sortOrder: 2 },
    );
  }
  const order = (who: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = req("POST", "/api/v1/guest/orders", who, body);
    for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
    return orderRoute(r, ctx());
  };

  test("the menu: food only (MJ 26 Oct 2026: the Restaurant group, no laundry or other services) with the hotel's items in its order, an item switched off still listed as unavailable; nothing stocked is an empty list; another hotel has its own", async () => {
    const empty = await ok(await get(menuRoute, "/api/v1/guest/menu", "amit"));
    assert.deepEqual(empty.menu.map((g: { id: string; items: unknown[] }) => [g.id, g.items.length]), [["restaurant", 0]]);
    assert.deepEqual([empty.stay.roomNumber, empty.profileName], ["101", "Amit Joshi"]);
    stock();
    const m = await ok(await get(menuRoute, "/api/v1/guest/menu", "amit"));
    const restaurant = m.menu[0];
    assert.deepEqual([restaurant.label, restaurant.business, restaurant.kind], ["Restaurant", "food", "food"]);
    assert.deepEqual(restaurant.items.map((i: { name: string; pricePaise: number; available: boolean }) => [i.name, i.pricePaise, i.available]), [["Gujarati Thali", 32000, true], ["Masala Dosa", 15000, false], ["Tea / Coffee (2 cups)", 8000, true]]);
    assert.equal(m.menu.length, 1, "laundry and service items are not shown");
    const other = await ok(await get(menuRoute, "/api/v1/guest/menu", "amitInB"));
    assert.equal(other.menu.every((g: { items: unknown[] }) => g.items.length === 0), true, "hotel B has no menu of its own yet");
  });

  test("an order on the room bill: one stay charge per item (category and side by group), nothing else changes, the answer has the GST per business, a log line, and the stay bill grows", async () => {
    stock();
    const before = data().charges.filter((c) => c.stayId === STAY).length;
    assert.equal((await get(billRoute, `/api/v1/guest/bills/stay.${STAY}.food`, "amit", { id: `stay.${STAY}.food` })).status, 404, "no food on the running bill before the order");
    const res = await order("amit", { qty: { [MENU.tea]: 2, [MENU.thali]: 1, [MENU.gone]: 0 }, payWith: "room_bill", note: "Please knock" });
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    const r = (await json(res)).data;
    assert.match(r.orderNo, /^O-[0-9A-F]{6}$/);
    assert.deepEqual([r.payWith, r.etaMinutes], ["room_bill", 25]);
    // food side: tea 2 x 80 + thali 320 = 480; GST at the check-out setting (5 by default)
    assert.deepEqual(r.parts, [{ business: "food", subtotalPaise: 48000, gstPaise: 2400, totalPaise: 50400 }]);
    assert.equal(r.totalPaise, 50400);
    const made = data().charges.filter((c) => c.stayId === STAY).slice(before);
    assert.deepEqual(made.map((c) => [c.description, c.category, c.side, c.quantity, Number(c.unitPricePaise), Number(c.amountPaise), c.createdBy !== null]), [
      ["Order: Tea / Coffee (2 cups)", "food", "food", "2.00", 8000, 16000, true],
      ["Order: Gujarati Thali", "food", "food", "1.00", 32000, 32000, true],
    ]);
    const line = data().systemLogs.at(-1)!;
    assert.deepEqual([line.module, line.action, line.entity], ["guest-portal", "created", "Room service order"]);
    assert.ok(String(line.summary).includes(r.orderNo));
    const food = await ok(await get(billRoute, `/api/v1/guest/bills/stay.${STAY}.food`, "amit", { id: `stay.${STAY}.food` }));
    assert.equal(food.totals.subtotalPaise, 48000, "the running food bill carries the order");
  });

  test("refusals change nothing: an empty cart, an unknown or switched-off item, more than 20 of one, paying now (online payment is off), no stay", async () => {
    stock();
    const before = data().charges.length;
    const fields = async (res: Response) => (await json(res)).error.details.fields;
    for (const qty of [{}, { [MENU.tea]: 0 }, { [pid(999)]: 1 }, { [MENU.gone]: 1 }, { [MENU.tea]: 21 }, { [MENU.shirt]: 1 }]) {
      const res = await order("amit", { qty, payWith: "room_bill", note: "" });
      assert.equal(res.status, 422, JSON.stringify(qty));
      assert.deepEqual(await fields(res), { cart: "Add at least one item." });
    }
    const pay = await order("amit", { qty: { [MENU.tea]: 1 }, payWith: "pay_now", note: "" });
    assert.deepEqual([pay.status, await fields(pay)], [422, { payWith: PAY_OFF }]);
    assert.equal((await order("amitInB", { qty: { [MENU.tea]: 1 }, payWith: "room_bill", note: "" })).status, 409, "no stay in hotel B");
    assert.equal(data().charges.length, before);
  });

  test("an order after check-out is refused and adds no charge; the same Idempotency-Key twice is one order", async () => {
    stock();
    const key = { "idempotency-key": "order-key-0001" };
    const first = await order("amit", { qty: { [MENU.tea]: 1 }, payWith: "room_bill", note: "" }, key);
    const again = await order("amit", { qty: { [MENU.tea]: 1 }, payWith: "room_bill", note: "" }, key);
    assert.deepEqual([first.status, again.status, again.headers.get("idempotent-replayed")], [201, 201, "true"]);
    assert.equal(data().charges.filter((c) => c.description === "Order: Tea / Coffee (2 cups)").length, 1);
    data().stays.find((s) => s.id === STAY)!.status = "checked_out";
    assert.equal((await order("amit", { qty: { [MENU.tea]: 1 }, payWith: "room_bill", note: "" })).status, 409);
  });
});

describe("pure helpers", () => {
  test("mobile forms: 10-digit Indian numbers in three written forms; short numbers match nothing", () => {
    assert.deepEqual(mobileForms("+91 98765 43210"), ["9876543210", "919876543210", "09876543210"]);
    assert.deepEqual(mobileForms("098765-43210"), ["9876543210", "919876543210", "09876543210"]);
    assert.deepEqual(mobileForms("12345"), []);
    assert.deepEqual(mobileForms(null), []);
    assert.deepEqual(mobileForms("4479460000001"), ["4479460000001"]);
  });

  test("ID proof names and masking", () => {
    assert.deepEqual(["Aadhaar Card", "Driving License", "Voter ID", "PAN Card", null].map(idTypeOf), ["aadhaar", "driving_licence", "voter_id", "none", "none"]);
    assert.deepEqual([maskId("123456784321"), maskId("77"), maskId(null)], ["XXXX 4321", "77", ""]);
  });
});
