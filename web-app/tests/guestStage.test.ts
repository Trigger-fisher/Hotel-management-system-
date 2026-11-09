// Decision 71 (guest portal "user-wise"): the pure rules every guest screen reads (ui-shared/dashboards/guestStage.ts) and the mock's stages
// (guest.mock.ts scenarios, the page's own hotel choice, the ID proof save). Run with `node --test tests/guestStage.test.ts`.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const gs = await import("../../common/ui-shared/dashboards/guestStage");
const { GUEST_TODAY, stayRange } = await import("../../common/ui-shared/dashboards/guest");
const { createGuestApi } = await import("../../common/ui-shared/dashboards/guest.mock");
type GuestBill = import("../../common/ui-shared/dashboards/guest").GuestBill;
type CurrentStay = import("../../common/ui-shared/dashboards/guest").CurrentStay;
type UpcomingStay = import("../../common/ui-shared/dashboards/guest").UpcomingStay;
type GuestStage = import("../../common/ui-shared/dashboards/guestStage").GuestStage;

const TODAY = "2026-10-05";

const stay = (over: Partial<CurrentStay> = {}): CurrentStay => ({
  bookingNo: "BK-1", roomNumber: "204", roomType: "Deluxe Room", checkIn: "2026-10-03", checkOut: "2026-10-06", nights: 3, nightsDone: 2, adults: 2, children: 0, ...over,
});
const upcoming: UpcomingStay = { reference: "BK-9", hotelId: "h-1", hotelName: "Hotel Sunrise, Rajkot", checkIn: "2026-10-08", checkOut: "2026-10-10", nights: 2, roomType: "Deluxe Room", adults: 2, children: 0, advancePaise: 450000 };

let n = 0;
const bill = (over: Partial<GuestBill> = {}): GuestBill => ({
  id: `b${++n}`, number: `HS-${n}`, business: "hotel", billedTo: "Amit", issuedOn: "2026-10-01", dueOn: null, roomNumber: "204", stayFrom: "2026-09-28", stayTo: "2026-10-01",
  current: false, status: "open", lines: [{ id: "l", label: "Room", detail: null, date: "2026-09-28", kind: "room", amountPaise: 100_00 }], payments: [],
  totals: { subtotalPaise: 100_00, gstPaise: 0, totalPaise: 100_00, paidPaise: 0, duePaise: 100_00 }, hotelId: "h-1", hotelName: "Hotel Sunrise, Rajkot", ...over,
});
const totals = (total: number, paid: number) => ({ subtotalPaise: total, gstPaise: 0, totalPaise: total, paidPaise: paid, duePaise: Math.max(0, total - paid) });

describe("guestStage: where the guest is", () => {
  test("a stay going on: staying before check-out, checkoutDay on check-out day (and after it)", () => {
    assert.equal(gs.guestStage({ stay: stay() }, TODAY), "staying");
    assert.equal(gs.guestStage({ stay: stay({ checkOut: TODAY }) }, TODAY), "checkoutDay");
    assert.equal(gs.guestStage({ stay: stay({ checkOut: "2026-10-04" }) }, TODAY), "checkoutDay");
    // a stay wins over an upcoming booking
    assert.equal(gs.guestStage({ stay: stay(), upcoming }, TODAY), "staying");
  });

  test("no stay, a booking later: arriving", () => {
    assert.equal(gs.guestStage({ stay: null, upcoming }, TODAY, []), "arriving");
  });

  test("checked out within 14 days, else none; cancelled and future bills never count", () => {
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayTo: TODAY })]), "checkedOut");
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayTo: "2026-09-21" })]), "checkedOut");
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayTo: "2026-09-20" })]), "none");
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayTo: TODAY, status: "cancelled" })]), "none");
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayFrom: "2026-10-09", stayTo: "2026-10-10" })]), "none");
    // the newest of several stays decides
    assert.equal(gs.guestStage({ stay: null }, TODAY, [bill({ stayTo: "2026-08-01" }), bill({ stayTo: "2026-10-02" })]), "checkedOut");
  });

  test("bills missing or failed: never a guess", () => {
    assert.equal(gs.guestStage({ stay: null }, TODAY), "none");
    assert.equal(gs.guestStage({ stay: null }, TODAY, null), "none");
    assert.equal(gs.guestStage({ stay: stay() }, TODAY, null), "staying");
  });
});

describe("moneyOf: one calculation", () => {
  test("due, paid, charged and open count; cancelled bills count for nothing; overdue is a part of due", () => {
    const bills = [
      bill({ totals: totals(500_00, 200_00) }),
      bill({ totals: totals(300_00, 0), dueOn: "2026-10-01" }),
      bill({ totals: totals(100_00, 100_00), status: "paid" }),
      bill({ totals: totals(900_00, 0), status: "cancelled" }),
    ];
    const m = gs.moneyOf(bills, TODAY);
    assert.deepEqual(m, { duePaise: 600_00, overduePaise: 300_00, paidPaise: 300_00, chargedPaise: 900_00, openCount: 2 });
    assert.deepEqual(gs.moneyOf([], TODAY), { duePaise: 0, overduePaise: 0, paidPaise: 0, chargedPaise: 0, openCount: 0 });
  });
});

describe("staysFromBills, sellerName, the status line and the tabs", () => {
  test("bills of one stay group together, newest stay first", () => {
    const a = bill({ stayFrom: "2026-10-03", stayTo: "2026-10-06", current: true });
    const b = bill({ stayFrom: "2026-10-03", stayTo: "2026-10-06", business: "food", current: true });
    const c = bill({ stayFrom: "2026-08-12", stayTo: "2026-08-14", status: "cancelled", totals: totals(0, 0) });
    const stays = gs.staysFromBills([c, a, b], TODAY);
    assert.equal(stays.length, 2);
    assert.deepEqual([stays[0]?.from, stays[0]?.bills.length, stays[0]?.nights, stays[0]?.current, stays[0]?.money.duePaise], ["2026-10-03", 2, 3, true, 200_00]);
    assert.equal(stays[1]?.cancelled, true);
  });

  test("the seller's real name; the hotel's name before the placeholder", () => {
    assert.equal(gs.sellerName({ business: "food", seller: { name: "Sunrise Foods", address: null, phone: null, gstin: null }, hotelName: "Hotel Sunrise" }), "Sunrise Foods");
    assert.equal(gs.sellerName({ business: "hotel", seller: { name: "Your hotel", address: null, phone: null, gstin: null }, hotelName: "Hotel Sunrise" }), "Hotel Sunrise");
    assert.equal(gs.sellerName({ business: "hotel", hotelName: "  " }), "Your hotel");
  });

  test("the status line of each stage", () => {
    assert.equal(gs.stageStatusLine("staying", { stay: stay(), today: TODAY }), "In stay · Room 204 · checks out tomorrow");
    assert.equal(gs.stageStatusLine("staying", { stay: stay({ checkOut: "2026-10-09" }), today: TODAY }), "In stay · Room 204 · checks out 09 Oct 2026");
    assert.equal(gs.stageStatusLine("checkoutDay", { stay: stay({ checkOut: TODAY }), today: TODAY }), "Check-out day · Room 204");
    assert.equal(gs.stageStatusLine("arriving", { upcoming, today: TODAY }), "Arriving 08 Oct 2026 · in 3 days");
    assert.equal(gs.stageStatusLine("checkedOut", { lastStayTo: "2026-10-01", today: TODAY }), "Checked out 01 Oct 2026");
    assert.equal(gs.stageStatusLine("none", { today: TODAY }), "No stay right now");
  });

  test("the lit tab: Bills for the bills and one bill, Payments its own tab (MJ 26 Oct 2026)", () => {
    assert.deepEqual(
      ["guest.home", "guest.order", "guest.bills", "guest.bill", "guest.history", "guest.profile", "hotel.dashboard"].map(gs.guestTabFor),
      ["guest.home", "guest.order", "guest.bills", "guest.bills", "guest.history", "guest.profile", null],
    );
    assert.deepEqual(gs.guestTabs.map((t) => t.label), ["Home", "Dining", "Bills", "Payments", "Account"]);
  });
});

describe("guest mock: the five stages, the page's own hotel, the ID proof", () => {
  const api = (scenario: GuestStage) => createGuestApi({ latencyMs: 0 }, undefined, undefined, { scenario: () => scenario });
  const stageOf = async (scenario: GuestStage): Promise<GuestStage> => {
    const a = api(scenario);
    const ov = await a.getOverview();
    const bills = await a.listBills({ tab: "all", limit: 25 });
    assert.ok(ov.ok && bills.ok);
    return gs.guestStage(ov.data, GUEST_TODAY, bills.data.items);
  };

  test("each scenario reads as its own stage", async () => {
    for (const s of gs.GUEST_STAGES) assert.equal(await stageOf(s), s, s);
  });

  test("arriving: the booking, no stay, no menu ordering, nothing of this stay on the bills", async () => {
    const a = api("arriving");
    const ov = await a.getOverview();
    assert.ok(ov.ok);
    assert.equal(ov.data.stay, null);
    assert.equal(ov.data.upcoming?.reference, "BK-26-1061");
    const menu = await a.getMenu();
    assert.ok(menu.ok && menu.data.stay === null);
    const order = await a.placeOrder({ qty: { "m-tea": 1 }, payWith: "room_bill", note: "" });
    assert.equal(order.ok, false);
    const bills = await a.listBills({ tab: "all" });
    assert.ok(bills.ok && bills.data.items.every((b) => !b.current));
  });

  test("the page's hotel chips: one hotel, or every hotel", async () => {
    const a = api("staying");
    const one = await a.listBills({ tab: "all", hotel: "h-2" });
    const all = await a.listBills({ tab: "all", hotel: "all" });
    assert.ok(one.ok && all.ok);
    assert.ok(one.data.items.length > 0 && one.data.items.every((b) => b.hotelId === "h-2"));
    assert.ok(all.data.items.length > one.data.items.length);
    const hotels = await a.listHotels();
    assert.ok(hotels.ok && hotels.data.every((h) => typeof h.slug === "string"));
  });

  test("the ID proof: the masked number sent back keeps it; a new number is kept masked", async () => {
    const a = api("staying");
    const p = await a.getProfile();
    assert.ok(p.ok);
    const base = { name: p.data.name, email: p.data.email, city: p.data.city, address: p.data.address, notifyEmail: true };
    const same = await a.updateProfile({ ...base, idProofType: "passport", idProofNumber: p.data.idProofNumber });
    assert.ok(same.ok);
    assert.deepEqual([same.data.idProofType, same.data.idProofNumber], ["passport", "XXXX XXXX 4321"]);
    const next = await a.updateProfile({ ...base, idProofType: "passport", idProofNumber: "Z1234567" });
    assert.ok(next.ok && next.data.idProofNumber === "XXXX XXXX 4567");
  });
});

test("stayRange: the short form of a stay (one month, two months, two years, one day)", () => {
  assert.equal(stayRange("2026-10-03", "2026-10-06"), "03 – 06 Oct 2026");
  assert.equal(stayRange("2026-09-28", "2026-10-02"), "28 Sep – 02 Oct 2026");
  assert.equal(stayRange("2025-12-30", "2026-01-02"), "30 Dec 2025 – 02 Jan 2026");
  assert.equal(stayRange("2026-10-05", "2026-10-05"), "05 Oct 2026");
});
