// "All hotels" in the company portal (docs/plans/PORTAL-ALL-HOTELS-PLAN-2026-10-18.md) end to end through the REAL route files, the wrapper, the corporate service and an in-memory
// store of three hotels: the merged lists with hotel id and name on every row, totals, cursor paging (stable order, signed cursors), a hotel that fails (partial answer, no leak), the
// selector summary, and IDOR (a company never sees a hotel it is not linked to, nor another company's rows). The limits themselves are in portal.gather.test.ts.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as dueBillsRoute } from "../../src/app/api/v1/corporate/accounts/due-bills/route";
import { GET as ledgerRoute } from "../../src/app/api/v1/corporate/accounts/ledger/route";
import { GET as paymentHistoryRoute } from "../../src/app/api/v1/corporate/accounts/payment-history/route";
import { GET as billRoute } from "../../src/app/api/v1/corporate/bills/[id]/route";
import { GET as dashboardRoute } from "../../src/app/api/v1/corporate/dashboard/route";
import { GET as hotelsRoute } from "../../src/app/api/v1/corporate/hotels/route";
import { GET as summaryRoute } from "../../src/app/api/v1/corporate/hotels/summary/route";
import { GET as notificationsRoute } from "../../src/app/api/v1/corporate/notifications/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { advance, bill, company, ctx, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const HOTEL_C = "33333333-3333-4333-8333-333333333333";
const CO_A = pid(21);
const CO_B = pid(22);
const CO_C = pid(23);
const OTHER_A = pid(24); // another company at hotel A

const sessions = new Map<string, VerifiedSession>();
let user = 800;
const login = (name: string, hotelId: string, companyId: string) =>
  sessions.set(name, makeSession({ userId: pid(user++), hotelId, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: companyId } }));
login("tcsAB", HOTEL_A, CO_A); // linked to hotel A and hotel B
login("tcsAB2", HOTEL_A, CO_A); // a second login with the same links
login("onlyC", HOTEL_C, CO_C); // linked to hotel C only
login("single", HOTEL_A, CO_A); // no memberships: its own hotel only

const links = (name: string): { hotelId: string; hotelName: string; subjectId: string }[] =>
  name === "tcsAB" || name === "tcsAB2" ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CO_A }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CO_B }] : name === "onlyC" ? [{ hotelId: HOTEL_C, hotelName: "Hotel C", subjectId: CO_C }] : [];
const memberships: Memberships = {
  list: async (userId, kind) => {
    const name = [...sessions].find(([, s]) => s.userId === userId)?.[0] ?? "";
    return kind === "company" ? links(name) : [];
  },
};

const clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map(), { memberships });
const data = (hotelId: string) => world.hotel.store.dataFor(hotelId);
const down = new Set<string>();

const owing = (id: string, number: string, date: string, companyId: string) => bill({ id, billNumber: number, billDate: date, companyId, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(100000), guestName: `Guest ${number}` });
const BILL = (n: number): string => pid(400 + n);

/** Hotel A: three bills (two on the same day); hotel B: two (one on that same day); hotel C: one; and another company's bill at hotel A. */
function seed(): void {
  data(HOTEL_A).companyProfiles.push(company({ id: CO_A, name: "Tata Consultancy Services" }), company({ id: OTHER_A, name: "Infosys", gstNumber: "24AAACI1234A1Z1" }));
  data(HOTEL_B).companyProfiles.push(company({ id: CO_B, name: "TCS at B" }));
  data(HOTEL_C).companyProfiles.push(company({ id: CO_C, name: "Wipro" }));
  data(HOTEL_A).bills.push(owing(BILL(1), "A / 1", "2026-09-20", CO_A), owing(BILL(2), "A / 2", "2026-09-25", CO_A), owing(BILL(3), "A / 3", "2026-09-25", CO_A), owing(BILL(9), "A / 9", "2026-09-26", OTHER_A));
  data(HOTEL_B).bills.push(owing(BILL(4), "B / 1", "2026-09-25", CO_B), owing(BILL(5), "B / 2", "2026-09-10", CO_B));
  data(HOTEL_C).bills.push(owing(BILL(6), "C / 1", "2026-09-30", CO_C));
}

beforeEach(() => {
  down.clear();
  world = wirePortal(sessions, () => clock, new Map(), { memberships });
  // a hotel that is "down": its database work fails
  const unit = world.hotel.unit;
  const run = unit.run.bind(unit);
  unit.run = ((session: { hotelId: string }, work: never) => (down.has(session.hotelId) ? Promise.reject(new Error("db-secret-host refused the connection")) : run(session as never, work))) as typeof unit.run;
  seed();
});

const call = (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string | null, params: Record<string, string> = {}) => route(req("GET", path, who), ctx(params));
const ok = async (res: Response) => {
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const dueIds = (page: { items: { id: string }[] }): string[] => page.items.map((i) => i.id);

describe("all hotels: the merged lists", () => {
  test("due bills over both linked hotels: every row has its hotel, newest first, ties by hotel then id; totals per hotel and overall; nothing of hotel C or another company", async () => {
    const page = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "tcsAB"));
    assert.deepEqual(page.items.map((i: { hotelName: string; billNumber: string }) => `${i.hotelName}:${i.billNumber}`).sort(), ["Hotel A:A / 1", "Hotel A:A / 2", "Hotel A:A / 3", "Hotel B:B / 1", "Hotel B:B / 2"]);
    assert.ok(page.items.every((i: { hotelId: string; hotelName: string }) => [HOTEL_A, HOTEL_B].includes(i.hotelId) && i.hotelName.startsWith("Hotel ")));
    assert.deepEqual([page.total, page.page, page.nextCursor, page.unavailable], [5, 1, null, []]);
    assert.equal(page.summary.openBills, 5);
    assert.equal(page.summary.totalDuePaise, 5 * 100000);
    assert.deepEqual(page.summary.byHotel.map((h: { hotelId: string; openBills: number }) => [h.hotelId, h.openBills]), [[HOTEL_A, 3], [HOTEL_B, 2]]);
    const text = JSON.stringify(page);
    assert.ok(!text.includes("C / 1") && !text.includes("A / 9"), "no row of hotel C or of another company");
  });

  test("one hotel by id reads only it; the default (no hotel) is all hotels; a single-hotel login still sees its own hotel", async () => {
    assert.deepEqual((await ok(await call(dueBillsRoute, `/api/v1/corporate/accounts/due-bills?hotel=${HOTEL_B}`, "tcsAB"))).items.map((i: { billNumber: string }) => i.billNumber).sort(), ["B / 1", "B / 2"]);
    assert.equal((await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills", "tcsAB"))).total, 5);
    const single = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills", "single"));
    assert.deepEqual([single.total, single.items[0].hotelId], [3, HOTEL_A]);
  });

  test("the dashboard and the notification badge add up over the hotels asked for", async () => {
    const dash = await ok(await call(dashboardRoute, "/api/v1/corporate/dashboard", "tcsAB"));
    assert.equal(dash.cards.totalDuePaise, 5 * 100000);
    assert.deepEqual(dash.byHotel.map((h: { hotelId: string }) => h.hotelId), [HOTEL_A, HOTEL_B]);
    assert.deepEqual(dash.unavailable, []);
    assert.equal((await ok(await call(dashboardRoute, `/api/v1/corporate/dashboard?hotel=${HOTEL_A}`, "tcsAB"))).cards.totalDuePaise, 3 * 100000);
  });
});

describe("all hotels: cursor paging", () => {
  /** 23 more bills so the two hotels hold 28 rows; many share a day across hotels. */
  function many(): void {
    for (let i = 0; i < 23; i++) {
      const hotel = i % 2 === 0 ? HOTEL_A : HOTEL_B;
      const date = `2026-08-${String(1 + (i % 6)).padStart(2, "0")}`;
      data(hotel).bills.push(owing(pid(1000 + i), `M / ${i}`, date, hotel === HOTEL_A ? CO_A : CO_B));
    }
  }
  const walk = async (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string, limit: number): Promise<{ ids: string[]; pages: number }> => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const sep = path.includes("?") ? "&" : "?";
      const page = await ok(await call(route, `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, who));
      assert.ok(page.items.length <= limit);
      ids.push(...dueIds(page));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 20, "the walk ends");
    } while (cursor);
    return { ids, pages };
  };

  test("due bills: pages of 10 over 28 rows cover every row once, in the order date newest first, then hotel, then id newest first; the last page has no cursor", async () => {
    many();
    const { ids, pages } = await walk(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "tcsAB", 10);
    assert.equal(pages, 3);
    assert.equal(ids.length, 28);
    assert.equal(new Set(ids).size, 28, "no row twice");
    const all = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&limit=100", "tcsAB"));
    assert.deepEqual(ids, dueIds(all), "the same order whatever the page size");
    const keys = all.items.map((i: { billDate: string; hotelId: string; id: string }) => [i.billDate, i.hotelId, i.id]);
    const sorted = [...keys].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? 1 : -1));
    assert.deepEqual(keys, sorted);
    assert.deepEqual([all.total, all.pageSize, all.nextCursor], [28, 100, null]);
  });

  test("a page boundary that falls exactly on the end gives no extra empty page", async () => {
    many(); // 28 rows
    const first = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&limit=25", "tcsAB"));
    assert.equal(first.items.length, 25);
    const second = await ok(await call(dueBillsRoute, `/api/v1/corporate/accounts/due-bills?hotel=all&limit=25&cursor=${encodeURIComponent(first.nextCursor)}`, "tcsAB"));
    assert.deepEqual([second.items.length, second.nextCursor], [3, null]);
    // one row with limit 10: one page, no cursor
    const small = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&limit=10", "onlyC"));
    assert.deepEqual([small.items.length, small.nextCursor], [1, null]);
  });

  test("payment history and the ledger page the same way; the ledger keeps its own order inside a day (the running balance)", async () => {
    many();
    data(HOTEL_A).advances.push(advance({ id: pid(2001), receiptNumber: "ADV-1", paymentDate: "2026-09-25", companyId: CO_A }), advance({ id: pid(2002), receiptNumber: "ADV-2", paymentDate: "2026-09-25", companyId: CO_A }));
    data(HOTEL_B).advances.push(advance({ id: pid(2003), receiptNumber: "ADV-3", paymentDate: "2026-09-25", companyId: CO_B }));
    const pays = await walk(paymentHistoryRoute, "/api/v1/corporate/accounts/payment-history?hotel=all", "tcsAB", 10);
    const allPays = await ok(await call(paymentHistoryRoute, "/api/v1/corporate/accounts/payment-history?hotel=all&limit=100", "tcsAB"));
    assert.ok(pays.ids.length >= 3, "the advances are in it");
    assert.equal(new Set(pays.ids).size, pays.ids.length);
    assert.deepEqual(pays.ids, dueIds(allPays));
    const ledger = await walk(ledgerRoute, "/api/v1/corporate/accounts/ledger?hotel=all", "tcsAB", 10);
    const byPage = await ok(await call(ledgerRoute, "/api/v1/corporate/accounts/ledger?hotel=all&pageSize=200", "tcsAB"));
    assert.ok(ledger.ids.length >= 30);
    assert.equal(new Set(ledger.ids).size, ledger.ids.length);
    assert.deepEqual(ledger.ids, dueIds(byPage), "paging by cursor lists the lines in the order the statement already shows them");
  });

  test("a cursor only works for the login, list, hotel, search and period it was made for; a changed one is 422 on cursor", async () => {
    many();
    const first = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&limit=10", "tcsAB"));
    const cursor = encodeURIComponent(first.nextCursor);
    const attempt = async (path: string, who = "tcsAB") => call(dueBillsRoute, path, who);
    assert.equal((await attempt(`/api/v1/corporate/accounts/due-bills?hotel=all&limit=10&cursor=${cursor}`)).status, 200, "the right one");
    for (const [label, path, who] of [
      ["another hotel filter", `/api/v1/corporate/accounts/due-bills?hotel=${HOTEL_A}&limit=10&cursor=${cursor}`, "tcsAB"],
      ["another search", `/api/v1/corporate/accounts/due-bills?hotel=all&search=M&limit=10&cursor=${cursor}`, "tcsAB"],
      ["another login", `/api/v1/corporate/accounts/due-bills?hotel=all&limit=10&cursor=${cursor}`, "tcsAB2"],
      ["another list", `/api/v1/corporate/accounts/payment-history?hotel=all&limit=10&cursor=${cursor}`, "tcsAB"],
    ] as const) {
      const res = label === "another list" ? await call(paymentHistoryRoute, path, who) : await attempt(path, who);
      assert.equal(res.status, 422, label);
      assert.ok((await json(res)).error.details.fields.cursor, label);
    }
    const [payload, signature] = first.nextCursor.split(".");
    const forged = Buffer.from(JSON.stringify(["2099-01-01", HOTEL_C, BILL(6)]), "utf8").toString("base64url");
    for (const bad of [`${forged}.${signature}`, `${payload}.${"A".repeat(22)}`, payload, "not-a-cursor", `${payload}.${signature}.x`]) {
      const res = await attempt(`/api/v1/corporate/accounts/due-bills?hotel=all&limit=10&cursor=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 422, bad.slice(0, 20));
    }
    assert.equal((await attempt("/api/v1/corporate/accounts/due-bills?hotel=all&limit=7")).status, 422, "limits are 10, 25, 50 or 100");
  });

  test("the old page and pageSize still work, and say there is no cursor", async () => {
    many();
    const page2 = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&page=2&pageSize=10", "tcsAB"));
    assert.deepEqual([page2.items.length, page2.page, page2.pageSize, page2.total, page2.nextCursor], [10, 2, 10, 28, null]);
  });
});

describe("all hotels: a hotel that cannot be reached", () => {
  test("its rows are left out and it is named (id and name only); the other hotel's rows, totals and the status are normal; no error text anywhere", async () => {
    down.add(HOTEL_B);
    const res = await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "tcsAB");
    assert.equal(res.status, 200);
    const page = (await json(res)).data;
    assert.deepEqual(page.items.map((i: { hotelId: string }) => i.hotelId), [HOTEL_A, HOTEL_A, HOTEL_A]);
    assert.deepEqual(page.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
    assert.equal(page.summary.totalDuePaise, 3 * 100000);
    assert.ok(!JSON.stringify(page).includes("secret"), "no error text");
    const dash = await ok(await call(dashboardRoute, "/api/v1/corporate/dashboard", "tcsAB"));
    assert.deepEqual(dash.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
    assert.equal(dash.cards.totalDuePaise, 3 * 100000);
    const walkPage = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all&limit=10", "tcsAB"));
    assert.deepEqual(walkPage.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }], "cursor lists say so too");
  });

  test("every hotel down: 503 with one plain sentence; one hotel by id that is down fails the same way", async () => {
    down.add(HOTEL_A).add(HOTEL_B);
    const res = await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "tcsAB");
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.match(body, /None of your hotels could be reached/);
    assert.ok(!body.includes("secret"));
    assert.equal((await call(dueBillsRoute, `/api/v1/corporate/accounts/due-bills?hotel=${HOTEL_A}`, "tcsAB")).status, 503);
  });
});

describe("all hotels: the selector summary", () => {
  test("each linked hotel with what is owed, open bills and unread notices, and the totals; the plain hotel list is unchanged", async () => {
    const sum = await ok(await call(summaryRoute, "/api/v1/corporate/hotels/summary", "tcsAB"));
    assert.deepEqual(sum.hotels.map((h: { hotelId: string; name: string; outstandingPaise: number; openBills: number; unreadNotifications: number }) => [h.hotelId, h.name, h.outstandingPaise, h.openBills, h.unreadNotifications]), [[HOTEL_A, "Hotel A", 300000, 3, 0], [HOTEL_B, "Hotel B", 200000, 2, 0]]);
    assert.ok(sum.hotels.every((h: { phone: unknown }) => h.phone === null || typeof h.phone === "string"));
    assert.deepEqual(sum.totals, { outstandingPaise: 500000, openBills: 5, unreadNotifications: 0 });
    assert.deepEqual(sum.unavailable, []);
    const plain = await ok(await call(hotelsRoute, "/api/v1/corporate/hotels", "tcsAB"));
    assert.deepEqual(plain.map((h: { hotelId: string }) => h.hotelId), [HOTEL_A, HOTEL_B]);
    assert.deepEqual(plain.map((h: { onlinePayment: unknown }) => h.onlinePayment), [false, false], "no hotel takes portal payments yet: Pay at the front desk");
    assert.ok(!JSON.stringify(plain).includes("rzp_"), "never a key");
  });

  test("a hotel that is down is named and left out of the totals; unread notices count per hotel", async () => {
    data(HOTEL_A).notifications.push({ id: pid(3001), audienceKind: "all", title: "Pool closed", body: "x", priority: "normal", linkView: null, linkId: null, expiresAt: null, alsoEmail: false, targetCount: 1, withdrawnAt: null, withdrawnBy: null, createdBy: null, createdAt: new Date("2026-10-01T00:00:00Z") });
    data(HOTEL_A).notificationTargets.push({ notificationId: pid(3001), companyId: CO_A, readAt: null, emailStatus: "none", createdAt: new Date("2026-10-01T00:00:00Z") });
    down.add(HOTEL_B);
    const sum = await ok(await call(summaryRoute, "/api/v1/corporate/hotels/summary", "tcsAB"));
    assert.deepEqual(sum.hotels.map((h: { hotelId: string; unreadNotifications: number }) => [h.hotelId, h.unreadNotifications]), [[HOTEL_A, 1]]);
    assert.deepEqual(sum.totals, { outstandingPaise: 300000, openBills: 3, unreadNotifications: 1 });
    assert.deepEqual(sum.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
  });

  test("staff and guest accounts are 403; no session is 401", async () => {
    sessions.set("staffer", makeSession({ userId: pid(990), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" }));
    assert.equal((await call(summaryRoute, "/api/v1/corporate/hotels/summary", null)).status, 401);
    assert.equal((await call(summaryRoute, "/api/v1/corporate/hotels/summary", "staffer")).status, 403);
  });
});

describe("all hotels: nobody sees what is not theirs (IDOR)", () => {
  test("a hotel the login is not linked to is 403 on every list; the same company id at another hotel is never read", async () => {
    for (const [route, path] of [
      [dueBillsRoute, "/api/v1/corporate/accounts/due-bills"],
      [paymentHistoryRoute, "/api/v1/corporate/accounts/payment-history"],
      [ledgerRoute, "/api/v1/corporate/accounts/ledger"],
      [notificationsRoute, "/api/v1/corporate/notifications"],
    ] as const) {
      assert.equal((await call(route, `${path}?hotel=${HOTEL_C}`, "tcsAB")).status, 403, path);
      assert.equal((await call(route, `${path}?hotel=${pid(555)}`, "tcsAB")).status, 403, `${path} an id that is no hotel`);
    }
    assert.equal((await call(summaryRoute, "/api/v1/corporate/hotels/summary", "onlyC")).status, 200);
    const onlyC = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "onlyC"));
    assert.deepEqual(onlyC.items.map((i: { billNumber: string }) => i.billNumber), ["C / 1"]);
  });

  test("a bill of another hotel or another company is 404 whatever hotel is named, and hotel=all is refused on a single bill", async () => {
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(1)}?hotel=${HOTEL_A}`, "tcsAB", { id: BILL(1) })).status, 200);
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(4)}?hotel=${HOTEL_B}`, "tcsAB", { id: BILL(4) })).status, 200, "its own bill at hotel B");
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(4)}?hotel=${HOTEL_A}`, "tcsAB", { id: BILL(4) })).status, 404, "hotel B's bill asked at hotel A");
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(9)}?hotel=${HOTEL_A}`, "tcsAB", { id: BILL(9) })).status, 404, "another company's bill at hotel A");
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(6)}?hotel=${HOTEL_C}`, "tcsAB", { id: BILL(6) })).status, 403, "hotel C: not linked");
    assert.equal((await call(billRoute, `/api/v1/corporate/bills/${BILL(1)}?hotel=all`, "tcsAB", { id: BILL(1) })).status, 422, "one hotel for one bill");
  });

  test("the record id is the login's own at EACH hotel, never the first hotel's: hotel B's rows come from B's company record", async () => {
    // the company id at hotel A has no bills at hotel B, and the one at B none at A: if the first hotel's id were reused, one of the two hotels would show nothing
    const page = await ok(await call(dueBillsRoute, "/api/v1/corporate/accounts/due-bills?hotel=all", "tcsAB"));
    assert.equal(page.items.filter((i: { hotelId: string }) => i.hotelId === HOTEL_B).length, 2);
    assert.equal(page.items.filter((i: { hotelId: string }) => i.hotelId === HOTEL_A).length, 3);
  });
});

describe("all hotels: notifications", () => {
  /** n notices at each hotel; several share the very same moment across the two hotels (a bulk send at a minute's start). */
  function notices(perHotel: number): void {
    let seq = 0;
    for (const [hotel, company] of [[HOTEL_A, CO_A], [HOTEL_B, CO_B]] as const) {
      for (let i = 0; i < perHotel; i++) {
        const id = pid(5000 + ++seq);
        const at = new Date(`2026-10-0${1 + (i % 3)}T10:00:00Z`);
        data(hotel).notifications.push({ id, audienceKind: "all", title: `N ${seq}`, body: "x", priority: "normal", linkView: null, linkId: null, expiresAt: null, alsoEmail: false, targetCount: 1, withdrawnAt: null, withdrawnBy: null, createdBy: null, createdAt: at });
        data(hotel).notificationTargets.push({ notificationId: id, companyId: company, readAt: null, emailStatus: "none", createdAt: at });
      }
    }
  }
  const ids = (page: { items: { id: string }[] }): string[] => page.items.map((i) => i.id);

  test("by cursor over two hotels with ties on the same moment: every notice once, newest first then hotel then id, the same as one big page; total and badge cover both hotels", async () => {
    notices(14);
    const all = await ok(await call(notificationsRoute, "/api/v1/corporate/notifications?hotel=all&limit=100", "tcsAB"));
    assert.deepEqual([all.total, all.unread, all.items.length, all.nextCursor], [28, 28, 28, null]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await ok(await call(notificationsRoute, `/api/v1/corporate/notifications?hotel=all&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "tcsAB"));
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.equal(pages, 3);
    assert.deepEqual(seen, ids(all), "the same order whatever the page size");
    assert.equal(new Set(seen).size, 28);
    const keys = all.items.map((i: { createdAt: string; hotelId: string; id: string }) => [i.createdAt, i.hotelId, i.id]);
    assert.deepEqual(keys, [...keys].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? 1 : -1)));
    assert.equal(all.items[0].hotelName.startsWith("Hotel "), true);
  });

  test("the unread filter and one hotel narrow it; a cursor is tied to them; page mode still works", async () => {
    notices(12);
    const first = await ok(await call(notificationsRoute, `/api/v1/corporate/notifications?hotel=${HOTEL_B}&limit=10`, "tcsAB"));
    assert.ok(first.items.every((i: { hotelId: string }) => i.hotelId === HOTEL_B));
    assert.equal(first.total, 12);
    assert.ok(first.nextCursor);
    const wrong = await call(notificationsRoute, `/api/v1/corporate/notifications?hotel=${HOTEL_A}&limit=10&cursor=${encodeURIComponent(first.nextCursor)}`, "tcsAB");
    assert.equal(wrong.status, 422);
    const oldWay = await ok(await call(notificationsRoute, "/api/v1/corporate/notifications?hotel=all&page=2&pageSize=10", "tcsAB"));
    assert.deepEqual([oldWay.items.length, oldWay.page, oldWay.total, oldWay.nextCursor], [10, 2, 24, null]);
  });

  test("a hotel that is down is named and its notices left out of the list, the total and the badge", async () => {
    notices(3);
    down.add(HOTEL_B);
    const page = await ok(await call(notificationsRoute, "/api/v1/corporate/notifications?hotel=all", "tcsAB"));
    assert.deepEqual([page.total, page.unread, page.items.every((i: { hotelId: string }) => i.hotelId === HOTEL_A)], [3, 3, true]);
    assert.deepEqual(page.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
  });
});