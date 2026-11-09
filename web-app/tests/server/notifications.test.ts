// Notifications end to end through the REAL route files, the wrapper, both services and ONE in-memory hotel store (the hotel sends, the company portal reads):
// send to one / selected / all, a company sees only its own, read is idempotent, withdrawn and expired are hidden, the unread badge, permissions, the plain-text and
// link rules, "also email" only when ticked (the hotel's mail, opt-outs left out, the 500 cap), the send limit, the audit lines, and several hotels. The database side
// (row-level security) is notifications.rls.test.ts. Plan: docs/plans/NOTIFICATIONS-PLAN-2026-10-18.md.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Notification, NotificationDetail, PortalNotificationPage } from "@shared/dashboards/notifications";
import { GET as dashboardRoute } from "../../src/app/api/v1/corporate/dashboard/route";
import { GET as portalListRoute } from "../../src/app/api/v1/corporate/notifications/route";
import { POST as readRoute } from "../../src/app/api/v1/corporate/notifications/[id]/read/route";
import { POST as readAllRoute } from "../../src/app/api/v1/corporate/notifications/read-all/route";
import { GET as unreadRoute } from "../../src/app/api/v1/corporate/notifications/unread-count/route";
import { GET as detailRoute } from "../../src/app/api/v1/companies/notifications/[id]/route";
import { POST as withdrawRoute } from "../../src/app/api/v1/companies/notifications/[id]/withdraw/route";
import { GET as historyRoute, POST as sendRoute } from "../../src/app/api/v1/companies/notifications/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureNotifications } from "../../src/server/compose/notifications";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { MAIL_LANE, MAIL_ROUTE } from "../../src/server/mail/routes";
import { bindNotificationsHotel } from "../../src/server/repos/memory/notifications";
import { createMemoryUnit } from "../../src/server/repos/memory/store";
import type { MailPayload, MailQueue } from "../../src/server/services/auth/mail";
import { renderMail } from "../../src/server/services/auth/mail";
import type { Person } from "../../src/server/services/cash/ports";
import { createNotificationService } from "../../src/server/services/notifications/notificationService";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { assertMatchesContract } from "./helpers/contract";
import { bill, company, ctx, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const TCS = pid(21);
const INFY = pid(22);
const WIPRO = pid(23);
const GONE = pid(24);
const STAFF_CLERK = pid(701);
const STAFF_EDITOR = pid(702);
const BILL_TCS = pid(31);
const BILL_INFY = pid(32);

const people = new Map<string, Person>([
  [STAFF_CLERK, { id: STAFF_CLERK, name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [STAFF_EDITOR, { id: STAFF_EDITOR, name: "Esha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
]);

const sessions = new Map<string, VerifiedSession>();
const staff = (name: string, userId: string, level: "view" | "create" | "edit" | "full", hotelId = HOTEL_A) =>
  sessions.set(name, makeSession({ userId, hotelId, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("companies", level)] }));
staff("viewer", pid(703), "view");
staff("creator", STAFF_CLERK, "create");
staff("editor", STAFF_EDITOR, "edit");
staff("editorB", pid(704), "edit", HOTEL_B);
staff("creatorB", pid(707), "create", HOTEL_B);
sessions.set("nobody", makeSession({ userId: pid(705), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" }));
let portalUser = 900;
const corp = (name: string, companyId: string, hotelId = HOTEL_A) =>
  sessions.set(name, makeSession({ userId: pid(portalUser++), hotelId, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: companyId } }));
corp("tcs", TCS);
corp("infosys", INFY);
corp("wipro", WIPRO);
corp("gone", GONE);
corp("tcsBoth", TCS); // linked to both hotels (memberships below)
sessions.set("guest", makeSession({ userId: pid(980), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: pid(11) } }));

const memberships: Memberships = {
  list: async (userId, kind) => (userId === sessions.get("tcsBoth")?.userId && kind === "company" ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: TCS }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: TCS }] : []),
};

let clock = new Date("2026-10-05T10:00:00+05:30");
const mails: { kind: string; hotelId: string | null; toEmail: string; payload: MailPayload }[] = [];
const mail: MailQueue = { queue: async (m) => void mails.push({ kind: m.kind, hotelId: m.hotelId, toEmail: m.toEmail, payload: m.payload }) };
let world = wirePortal(sessions, () => clock, new Map(), { memberships });
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

function wire(): void {
  world = wirePortal(sessions, () => clock, new Map(), { memberships });
  configureNotifications(createNotificationService({ unit: createMemoryUnit(world.hotel.store, bindNotificationsHotel), people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, catalog, now: () => clock, mail }));
  // the same routes with a send limiter (wirePortal configures none)
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

function seed(): void {
  const a = data();
  a.companyProfiles.push(
    company({ id: TCS, name: "Tata Consultancy Services", email: "desk@tcs.example", contacts: [{ role: "Travel desk", name: "Deepa Iyer", email: "deepa@tcs.example", mobile: "" }, { role: "Accounts", name: "Rajesh", email: "DESK@tcs.example", mobile: "" }] }),
    company({ id: INFY, name: "Infosys", email: "accounts@infy.example", contacts: [] }),
    company({ id: WIPRO, name: "Wipro", email: null, contacts: [{ role: "", name: "Meera", email: "", mobile: "" }] }),
    company({ id: GONE, name: "Deleted Co", email: "x@gone.example", deletedAt: new Date("2026-09-01T00:00:00Z") }),
  );
  a.bills.push(bill({ id: BILL_TCS, billNumber: "2026 / 1", billDate: "2026-09-20", companyId: TCS }), bill({ id: BILL_INFY, billNumber: "2026 / 2", billDate: "2026-09-21", companyId: INFY }));
  data(HOTEL_B).companyProfiles.push(company({ id: TCS, name: "TCS at Hotel B", email: "b@tcs.example", contacts: [] }));
  a.profile.name = "Hotel Sunrise";
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  mails.length = 0;
  wire();
  seed();
});

const letter = (over: Record<string, unknown> = {}) => ({ companyIds: [TCS], title: "Rooms closed 20 to 24 October", body: "The third floor is closed.\nBookings move to the second floor.", ...over });
const send = (who: string | null, body: unknown) => sendRoute(req("POST", "/api/v1/companies/notifications", who, body));
const sent = async (who = "creator", body: Record<string, unknown> = {}): Promise<NotificationDetail> => {
  const res = await send(who, letter(body));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const history = (who: string | null, query = "") => historyRoute(req("GET", `/api/v1/companies/notifications${query}`, who));
const portal = (who: string | null, query = "") => portalListRoute(req("GET", `/api/v1/corporate/notifications${query}`, who));
const portalPage = async (who: string, query = ""): Promise<PortalNotificationPage> => {
  const res = await portal(who, query);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const read = (who: string | null, id: string, query = "") => readRoute(req("POST", `/api/v1/corporate/notifications/${id}/read${query}`, who), ctx({ id }));
const unread = async (who: string, query = ""): Promise<number> => (await json(await unreadRoute(req("GET", `/api/v1/corporate/notifications/unread-count${query}`, who)))).data.count;
const withdraw = (who: string | null, id: string) => withdrawRoute(req("POST", `/api/v1/companies/notifications/${id}/withdraw`, who), ctx({ id }));
const fieldsOf = async (res: Response): Promise<Record<string, string>> => (await json(res)).error.details.fields;

describe("who may do what", () => {
  test("no session 401; a viewer reads the history but cannot send; sending needs 'create', withdrawing needs 'edit'; a company or guest account is 403 on the hotel side", async () => {
    assert.equal((await send(null, letter())).status, 401);
    assert.equal((await history(null)).status, 401);
    assert.equal((await history("viewer")).status, 200);
    assert.equal((await send("viewer", letter())).status, 403);
    assert.equal((await history("nobody")).status, 403);
    const n = await sent("creator");
    assert.equal((await withdraw("creator", n.id)).status, 403, "create is not enough to withdraw");
    assert.equal((await withdraw("viewer", n.id)).status, 403);
    assert.equal((await withdraw("editor", n.id)).status, 200);
    for (const who of ["tcs", "guest"]) assert.equal((await history(who)).status, 403, who);
    assert.equal((await detailRoute(req("GET", `/api/v1/companies/notifications/${n.id}`, "tcs"), ctx({ id: n.id }))).status, 403);
  });

  test("the portal side: no session 401; staff and a guest account 403; a deleted company is 409 PORTAL_NOT_LINKED", async () => {
    assert.equal((await portal(null)).status, 401);
    for (const who of ["editor", "guest"]) assert.equal((await portal(who)).status, 403, who);
    const res = await portal("gone");
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.code, "PORTAL_NOT_LINKED");
  });

  test("another hotel's staff sees none of this hotel's notifications (and a detail is 404 there)", async () => {
    const n = await sent();
    assert.equal((await json(await history("editorB"))).data.total, 0);
    assert.equal((await detailRoute(req("GET", `/api/v1/companies/notifications/${n.id}`, "editorB"), ctx({ id: n.id }))).status, 404);
    assert.equal((await withdraw("editorB", n.id)).status, 404);
  });
});

describe("sending: one, selected, all", () => {
  test("to one company: the contract shape, the audience label, who sent it", async () => {
    const n = await sent();
    const sample: NotificationDetail = {
      id: "x", title: "t", body: "b", priority: "normal", audienceKind: "one", audienceLabel: "l", targetCount: 1, deliveredCount: 1, readCount: 0, expiresAt: null, withdrawnAt: null, alsoEmail: false,
      linkView: null, linkId: null, createdAt: "t", createdBy: "n", status: "active", targets: [{ companyId: "c", companyName: "n", readAt: null, emailStatus: null }], emailQueued: 0, emailSkipped: 0,
    };
    assertMatchesContract(n, sample);
    assert.deepEqual([n.audienceKind, n.audienceLabel, n.targetCount, n.readCount, n.createdBy, n.status, n.priority], ["one", "Tata Consultancy Services", 1, 0, "Chetan Clerk", "active", "normal"]);
    assert.equal(n.body, "The third floor is closed.\nBookings move to the second floor.");
  });

  test("to selected companies (repeats counted once) and to all (live companies only: the deleted one is left out)", async () => {
    const two = await sent("creator", { companyIds: [TCS, INFY, TCS] });
    assert.deepEqual([two.audienceKind, two.targetCount, two.audienceLabel], ["selected", 2, "2 companies"]);
    const all = await sent("creator", { companyIds: "all", title: "To everyone" });
    assert.deepEqual([all.audienceKind, all.targetCount, all.audienceLabel], ["all", 3, "All companies (3)"]);
    assert.deepEqual(all.targets.map((t) => t.companyName), ["Infosys", "Tata Consultancy Services", "Wipro"]);
  });

  test("the picked companies must exist and be live; nothing picked or no companies at all is refused with a sentence", async () => {
    for (const ids of [[GONE], [pid(999)], [TCS, pid(999)]]) {
      const res = await send("creator", letter({ companyIds: ids }));
      assert.equal(res.status, 422);
      assert.ok((await fieldsOf(res)).companyIds, JSON.stringify(ids));
    }
    assert.equal((await send("creator", letter({ companyIds: [] }))).status, 422);
    data().companyProfiles.length = 0;
    const none = await send("creator", letter({ companyIds: "all" }));
    assert.equal(none.status, 422);
    assert.match((await fieldsOf(none)).companyIds, /no companies/);
    assert.equal(data().notifications.length, 0, "nothing was written");
  });

  test("a large audience: 1,200 companies get one target each (written in chunks)", async () => {
    for (let i = 0; i < 1200; i++) data().companyProfiles.push(company({ id: pid(5000 + i), name: `Company ${String(i).padStart(4, "0")}`, email: null, contacts: [] }));
    const all = await sent("creator", { companyIds: "all" });
    assert.equal(all.targetCount, 1203);
    assert.equal(data().notificationTargets.length, 1203);
    assert.equal(new Set(data().notificationTargets.map((t) => t.companyId)).size, 1203, "one per company");
  });
});

describe("what may be sent: plain text, a date, a link", () => {
  test("title and message needed and bounded; HTML tags refused; the text is stored as typed (line breaks kept, nothing escaped)", async () => {
    let res = await send("creator", letter({ title: "  ", body: "" }));
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(await fieldsOf(res)).sort(), ["body", "title"]);
    res = await send("creator", letter({ title: "x".repeat(121) }));
    assert.ok((await fieldsOf(res)).title);
    res = await send("creator", letter({ body: "y".repeat(2001) }));
    assert.ok((await fieldsOf(res)).body);
    assert.equal((await send("creator", letter({ title: "x".repeat(120), body: "y".repeat(2000) }))).status, 201);
    for (const bad of ["<b>Hello</b>", "Click <a href=\"http://x\">here</a>", "<script>alert(1)</script>", "</div>"]) {
      res = await send("creator", letter({ body: bad }));
      assert.equal(res.status, 422, bad);
      assert.match((await fieldsOf(res)).body, /Plain text/);
    }
    const title = await send("creator", letter({ title: "<i>Big news</i>" }));
    assert.match((await fieldsOf(title)).title, /Plain text/);
    const plain = await sent("creator", { body: "Rates: 5 < 6 and 7 > 3 & more", title: "Rs. 4,500 & GST" });
    assert.equal(plain.body, "Rates: 5 < 6 and 7 > 3 & more", "stored exactly as typed");
    assert.equal(plain.title, "Rs. 4,500 & GST");
  });

  test("control characters and unknown fields are refused at the door (the shape is strict)", async () => {
    assert.equal((await send("creator", letter({ title: "bad\u0000title" }))).status, 422);
    assert.equal((await send("creator", letter({ body: "bell\u0007" }))).status, 422);
    assert.equal((await send("creator", letter({ createdBy: pid(1) }))).status, 422, "no creator, hotel or status from outside");
    assert.equal((await send("creator", letter({ hotelId: HOTEL_B }))).status, 422);
    assert.equal((await send("creator", letter({ priority: "urgent" }))).status, 422);
  });

  test("an expiry date: a real date, today or later; the last day still shows; the day after it is hidden", async () => {
    for (const bad of ["2026-10-04", "2026-02-30", "soon"]) {
      const res = await send("creator", letter({ expiresAt: bad }));
      assert.equal(res.status, 422, bad);
      assert.ok((await fieldsOf(res)).expiresAt, bad);
    }
    const n = await sent("creator", { expiresAt: "2026-10-06" });
    assert.equal(n.expiresAt, "2026-10-06");
    assert.equal((await portalPage("tcs")).total, 1);
    clock = new Date("2026-10-06T23:30:00+05:30");
    assert.equal((await portalPage("tcs")).total, 1, "its last day");
    clock = new Date("2026-10-07T00:30:00+05:30");
    assert.equal((await portalPage("tcs")).total, 0, "the day after");
    assert.equal(await unread("tcs"), 0);
    const open = await json(await detailRoute(req("GET", `/api/v1/companies/notifications/${n.id}`, "viewer"), ctx({ id: n.id })));
    assert.equal(open.data.status, "expired", "the hotel still sees it, as expired");
  });

  test("a link: only the company pages; a bill link needs a bill of the one company it goes to", async () => {
    const ledger = await sent("creator", { linkView: "corporate.ledger" });
    assert.deepEqual([ledger.linkView, ledger.linkId], ["corporate.ledger", null]);
    const ok = await sent("creator", { linkView: "corporate.bill", linkId: BILL_TCS });
    assert.deepEqual([ok.linkView, ok.linkId], ["corporate.bill", BILL_TCS]);
    const item = (await portalPage("tcs")).items.find((i) => i.linkView === "corporate.bill");
    assert.equal(item?.linkId, BILL_TCS);
    const cases: [Record<string, unknown>, string][] = [
      [{ linkView: "corporate.bill" }, "linkId"],
      [{ linkId: BILL_TCS }, "linkView"],
      [{ linkView: "corporate.ledger", linkId: BILL_TCS }, "linkId"],
      [{ linkView: "corporate.bill", linkId: BILL_INFY }, "linkId"], // another company's bill
      [{ linkView: "corporate.bill", linkId: pid(998) }, "linkId"], // no such bill
      [{ linkView: "corporate.bill", linkId: BILL_TCS, companyIds: [TCS, INFY] }, "linkId"], // a bill link goes to one company only
    ];
    for (const [over, field] of cases) {
      const res = await send("creator", letter(over));
      assert.equal(res.status, 422, JSON.stringify(over));
      assert.ok((await fieldsOf(res))[field], JSON.stringify(over));
    }
    assert.equal((await send("creator", letter({ linkView: "https://evil.example" }))).status, 422, "never an address");
    assert.equal((await send("creator", letter({ linkView: "hotel.co.notifications" }))).status, 422, "never a staff page");
  });
});

describe("the company portal: its own notifications only", () => {
  test("a company sees the ones sent to it (one, selected, all) and none sent to others; the list is newest first and paged", async () => {
    const forTcs = await sent("creator", { title: "Only TCS" });
    clock = new Date("2026-10-05T11:00:00+05:30");
    const forInfy = await sent("creator", { companyIds: [INFY], title: "Only Infosys" });
    clock = new Date("2026-10-05T12:00:00+05:30");
    const both = await sent("creator", { companyIds: [TCS, INFY], title: "TCS and Infosys" });
    clock = new Date("2026-10-05T13:00:00+05:30");
    const everyone = await sent("creator", { companyIds: "all", title: "Everyone" });
    const titles = async (who: string) => (await portalPage(who)).items.map((i) => i.title);
    assert.deepEqual(await titles("tcs"), ["Everyone", "TCS and Infosys", "Only TCS"]);
    assert.deepEqual(await titles("infosys"), ["Everyone", "TCS and Infosys", "Only Infosys"]);
    assert.deepEqual(await titles("wipro"), ["Everyone"]);
    const page = await portalPage("tcs", "?pageSize=10");
    const sample: PortalNotificationPage = { items: [{ id: "x", hotelId: "h", hotelName: "n", title: "t", body: "b", priority: "normal", createdAt: "t", readAt: null, linkView: null, linkId: null }], total: 1, page: 1, pageSize: 10, unread: 0, nextCursor: null, unavailable: [] };
    assertMatchesContract(page, sample);
    assert.deepEqual([page.total, page.unread, page.page, page.pageSize], [3, 3, 1, 10]);
    assert.equal(page.items[0].id, everyone.id);
    assert.equal(page.items[0].hotelId, HOTEL_A);
    // paged: two to a page is not offered, 10 is the smallest, so make more
    for (let i = 0; i < 12; i++) {
      clock = new Date(`2026-10-05T14:${String(i).padStart(2, "0")}:00+05:30`);
      await sent("creator", { title: `Bulk ${i}` });
    }
    const first = await portalPage("tcs", "?pageSize=10");
    const second = await portalPage("tcs", "?pageSize=10&page=2");
    assert.equal(first.total, 15);
    assert.deepEqual([first.items.length, second.items.length], [10, 5]);
    assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 15, "no repeats across pages");
    assert.ok(![forInfy.id].some((id) => [...first.items, ...second.items].some((i) => i.id === id)), "another company's notice never appears");
    assert.ok([forTcs.id, both.id].every((id) => [...first.items, ...second.items].some((i) => i.id === id)));
  });

  test("another company's notification is 404 to read, whatever the id; nothing changes for its real owner", async () => {
    const mine = await sent("creator", { companyIds: [INFY] });
    assert.equal((await read("tcs", mine.id)).status, 404);
    assert.equal((await read("tcs", pid(997))).status, 404);
    assert.equal(await unread("infosys"), 1, "untouched");
    const detail = await json(await detailRoute(req("GET", `/api/v1/companies/notifications/${mine.id}`, "viewer"), ctx({ id: mine.id })));
    assert.equal(detail.data.readCount, 0);
  });

  test("mark read: idempotent, the FIRST read time is kept, the badge drops once; the hotel sees who read it and when", async () => {
    const n = await sent("creator", { companyIds: [TCS, INFY] });
    assert.equal(await unread("tcs"), 1);
    clock = new Date("2026-10-05T12:00:00+05:30");
    assert.equal((await read("tcs", n.id)).status, 200);
    clock = new Date("2026-10-06T12:00:00+05:30");
    const again = await read("tcs", n.id);
    assert.equal(again.status, 200, "reading it again is fine");
    assert.deepEqual((await json(again)).data, { id: n.id, read: true });
    assert.equal(await unread("tcs"), 0);
    assert.equal(await unread("infosys"), 1, "the other company still has it unread");
    const item = (await portalPage("tcs")).items[0];
    assert.equal(item.readAt, new Date("2026-10-05T12:00:00+05:30").toISOString(), "the first read time");
    const seen = (await json(await detailRoute(req("GET", `/api/v1/companies/notifications/${n.id}`, "viewer"), ctx({ id: n.id })))).data as NotificationDetail;
    assert.equal(seen.readCount, 1);
    assert.equal(seen.targets.find((t) => t.companyId === TCS)?.readAt, item.readAt);
    assert.equal(seen.targets.find((t) => t.companyId === INFY)?.readAt, null);
  });

  test("read all: marks only this company's live unread ones; answers how many; a second time marks none; unread filter and the badge follow", async () => {
    await sent("creator", { title: "A" });
    await sent("creator", { title: "B", companyIds: "all" });
    await sent("creator", { title: "C", companyIds: [INFY] });
    const withdrawn = await sent("creator", { title: "D" });
    await withdraw("editor", withdrawn.id);
    assert.equal(await unread("tcs"), 2);
    const unreadOnly = await portalPage("tcs", "?unread=true");
    assert.deepEqual(unreadOnly.items.map((i) => i.title).sort(), ["A", "B"]);
    const done = await readAllRoute(req("POST", "/api/v1/corporate/notifications/read-all", "tcs"));
    assert.equal(done.status, 200);
    assert.deepEqual((await json(done)).data, { marked: 2, unavailable: [] });
    assert.deepEqual((await json(await readAllRoute(req("POST", "/api/v1/corporate/notifications/read-all", "tcs")))).data, { marked: 0, unavailable: [] });
    assert.equal(await unread("tcs"), 0);
    assert.equal((await portalPage("tcs", "?unread=true")).total, 0);
    assert.equal((await portalPage("tcs")).total, 2, "read ones stay in the list");
    assert.equal(await unread("infosys"), 2, "another company is untouched");
    assert.equal(data().notificationTargets.find((t) => t.notificationId === withdrawn.id && t.companyId === TCS)?.readAt, null, "a withdrawn one is not touched");
  });

  test("the portal summary (GET /corporate/dashboard) carries the unread count", async () => {
    await sent("creator");
    await sent("creator", { companyIds: "all" });
    const res = await dashboardRoute(req("GET", "/api/v1/corporate/dashboard", "tcs"));
    assert.equal(res.status, 200);
    assert.equal((await json(res)).data.unreadNotifications, 2);
    assert.equal((await json(await dashboardRoute(req("GET", "/api/v1/corporate/dashboard", "wipro")))).data.unreadNotifications, 1);
    await readAllRoute(req("POST", "/api/v1/corporate/notifications/read-all", "tcs"));
    assert.equal((await json(await dashboardRoute(req("GET", "/api/v1/corporate/dashboard", "tcs")))).data.unreadNotifications, 0);
  });
});

describe("withdrawing and expiring", () => {
  test("a withdrawn notice disappears from the company at once (list, badge, read), stays in the history, and withdrawing twice changes nothing", async () => {
    const n = await sent("creator");
    assert.equal(await unread("tcs"), 1);
    clock = new Date("2026-10-05T11:00:00+05:30");
    const res = await withdraw("editor", n.id);
    assert.equal(res.status, 200);
    const done: NotificationDetail = (await json(res)).data;
    assert.equal(done.status, "withdrawn");
    assert.equal(done.withdrawnAt, clock.toISOString());
    assert.equal(await unread("tcs"), 0);
    assert.equal((await portalPage("tcs")).total, 0);
    assert.equal((await read("tcs", n.id)).status, 404, "it can no longer be read");
    clock = new Date("2026-10-05T15:00:00+05:30");
    const twice: NotificationDetail = (await json(await withdraw("editor", n.id))).data;
    assert.equal(twice.withdrawnAt, done.withdrawnAt, "the first time stays");
    const inHistory = (await json(await history("viewer", "?status=withdrawn"))).data;
    assert.deepEqual(inHistory.items.map((i: Notification) => i.id), [n.id]);
    assert.equal((await json(await history("viewer", "?status=active"))).data.total, 0);
    assert.equal((await withdraw("editor", pid(996))).status, 404);
  });

  test("the history: newest first, searchable in title and text, filtered by status, bounded page sizes; read counts follow the companies", async () => {
    await sent("creator", { title: "Alpha floor closed", body: "third floor" });
    clock = new Date("2026-10-05T11:00:00+05:30");
    await sent("creator", { title: "Beta rates", body: "new rate card", companyIds: "all", expiresAt: "2026-10-05" });
    clock = new Date("2026-10-06T11:00:00+05:30"); // Beta's last day was yesterday
    const rows = async (q: string): Promise<Notification[]> => (await json(await history("viewer", q))).data.items;
    assert.deepEqual((await rows("")).map((r) => r.title), ["Beta rates", "Alpha floor closed"]);
    assert.deepEqual((await rows("?search=rate")).map((r) => r.title), ["Beta rates"]);
    assert.deepEqual((await rows("?search=THIRD%20floor")).map((r) => r.title), ["Alpha floor closed"]);
    assert.deepEqual((await rows("?status=expired")).map((r) => r.title), ["Beta rates"]);
    assert.deepEqual((await rows("?status=active")).map((r) => r.title), ["Alpha floor closed"]);
    assert.equal((await history("viewer", "?pageSize=7")).status, 422, "page sizes are 10, 25, 50, 100");
    assert.equal((await history("viewer", "?status=gone")).status, 422);
    await read("tcs", (await rows("?status=active"))[0].id);
    assert.equal((await rows("?status=active"))[0].readCount, 1);
  });
});

describe("audit, rate limit, mail kind", () => {
  test("every send and the first withdraw leave one line in the system log (no message text in it)", async () => {
    const n = await sent("creator", { title: "Audit me", body: "secret rate details" });
    await withdraw("editor", n.id);
    await withdraw("editor", n.id);
    const lines = data().systemLogs.filter((l) => l.entity === "Notification");
    assert.deepEqual(lines.map((l) => [l.action, l.summary, l.userName]), [["created", "Added Notification: Audit me", "Chetan Clerk"], ["updated", "Withdrew notification: Audit me", "Esha Editor"]]);
    assert.ok(lines.every((l) => l.module === "companies" && l.subjectId === n.id));
    assert.ok(!JSON.stringify(lines).includes("secret rate details"), "the text is not copied into the log");
    // a refused send writes nothing
    await send("creator", letter({ title: "" }));
    assert.equal(data().systemLogs.filter((l) => l.entity === "Notification").length, 2);
  });

  test("20 sends an hour per person: the 21st is 429 with a retry hint and writes nothing; another person is not held up", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await send("creator", letter({ title: `Notice ${i}` }))).status, 201, `send ${i + 1}`);
    const refused = await send("creator", letter({ title: "One too many" }));
    assert.equal(refused.status, 429);
    const refusal = (await json(refused)).error;
    assert.equal(refusal.code, "RATE_LIMITED");
    assert.match(refusal.message, /20 notifications in the last hour/, "a plain sentence the screen can show");
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    assert.equal(data().notifications.length, 20);
    staff("creator2", pid(706), "create");
    assert.equal((await send("creator2", letter({ title: "Someone else" }))).status, 201);
  });

  test("the mail kind: hotel mail in the system lane, with its own subject and text", () => {
    assert.equal(MAIL_ROUTE.notification, "hotel");
    assert.equal(MAIL_LANE.notification, "system");
    const m = renderMail("notification", { name: "Deepa", hotelName: "Hotel Sunrise", subject: "Rooms closed", message: "Third floor closed." });
    assert.equal(m.subject, "Hotel Sunrise: Rooms closed");
    assert.match(m.text, /Hello Deepa,/);
    assert.match(m.text, /Third floor closed\./);
  });
});

describe("also email (the hotel's own mail, only when ticked)", () => {
  const mailOn = () => {
    data().settings.set("email.host", "smtp.hotel.test");
    data().settings.set("email.from_address", "desk@hotel.test");
  };

  test("not ticked: nothing is queued, even with mail set up; every target says 'none' (null to the screen)", async () => {
    mailOn();
    const n = await sent("creator", { companyIds: "all" });
    assert.equal(mails.length, 0);
    assert.equal(n.alsoEmail, false);
    assert.ok(n.targets.every((t) => t.emailStatus === null));
    assert.ok(data().notificationTargets.every((t) => t.emailStatus === "none"));
  });

  test("ticked with no mail setup of the hotel's own: it is allowed (a hotel's mail goes out through the platform's Amazon SES)", async () => {
    const res = await send("creator", letter({ alsoEmail: true }));
    assert.notEqual(res.status, 422, "no 'set up your mail server' refusal any more");
  });

  test("ticked: one hotel mail per usable address (the company's and its contacts', each once, any case), none for an unsubscribed one; a company with no address is 'skipped'", async () => {
    mailOn();
    data().optOuts.add("deepa@tcs.example");
    const n = await sent("creator", { companyIds: "all", alsoEmail: true });
    // TCS: desk@tcs.example (also typed DESK@ on a contact: once), deepa@ unsubscribed; Infosys: accounts@; Wipro: nothing usable
    assert.deepEqual(mails.map((m) => m.toEmail).sort(), ["accounts@infy.example", "desk@tcs.example"]);
    assert.ok(mails.every((m) => m.kind === "notification" && m.hotelId === HOTEL_A), "hotel mail, from THIS hotel");
    assert.deepEqual(mails.find((m) => m.toEmail === "desk@tcs.example")?.payload, { name: "Tata Consultancy Services", hotelName: "Hotel Sunrise", subject: "Rooms closed 20 to 24 October", message: "The third floor is closed.\nBookings move to the second floor." });
    const status = Object.fromEntries(n.targets.map((t) => [t.companyName, t.emailStatus]));
    assert.deepEqual(status, { Infosys: "queued", "Tata Consultancy Services": "queued", Wipro: "skipped" });
    assert.deepEqual([n.emailQueued, n.emailSkipped, n.alsoEmail], [2, 1, true]);
  });

  test("more than 500 addresses at once is refused with a sentence and sends nothing", async () => {
    mailOn();
    for (let i = 0; i < 501; i++) data().companyProfiles.push(company({ id: pid(7000 + i), name: `Mail Co ${i}`, email: `a${i}@bulk.example`, contacts: [] }));
    const res = await send("creator", letter({ companyIds: "all", alsoEmail: true }));
    assert.equal(res.status, 422);
    assert.match((await fieldsOf(res)).alsoEmail, /limit is 500/);
    assert.equal(mails.length, 0);
    assert.equal(data().notifications.length, 0);
    // the same audience in-app only is fine
    assert.equal((await send("creator", letter({ companyIds: "all" }))).status, 201);
  });

  test("one mail failing to queue does not undo the notice or stop the others", async () => {
    mailOn();
    let calls = 0;
    const flaky: MailQueue = { queue: async (m) => { calls += 1; if (m.toEmail.startsWith("accounts@")) throw new Error("outbox down"); mails.push({ kind: m.kind, hotelId: m.hotelId, toEmail: m.toEmail, payload: m.payload }); } };
    configureNotifications(createNotificationService({ unit: createMemoryUnit(world.hotel.store, bindNotificationsHotel), people: { get: async () => new Map() }, catalog, now: () => clock, mail: flaky }));
    const res = await send("creator", letter({ companyIds: "all", alsoEmail: true }));
    assert.equal(res.status, 201);
    assert.equal(calls, 3, "every address was tried");
    assert.deepEqual(mails.map((m) => m.toEmail).sort(), ["deepa@tcs.example", "desk@tcs.example"]);
    assert.equal(data().notifications.length, 1);
  });
});

describe("several hotels (the company is linked to both)", () => {
  async function bothHotels(): Promise<{ a: NotificationDetail; b: NotificationDetail }> {
    const a = await sent("creator", { title: "From Hotel A" });
    clock = new Date("2026-10-05T11:00:00+05:30");
    const b = await sent("creatorB", { title: "From Hotel B" });
    return { a, b };
  }

  test("'all hotels' merges both, newest first, each row with its hotel; one hotel narrows; a hotel it is not linked to is 403", async () => {
    const { a } = await bothHotels();
    const all = await portalPage("tcsBoth");
    assert.deepEqual(all.items.map((i) => [i.title, i.hotelId, i.hotelName]), [["From Hotel B", HOTEL_B, "Hotel B"], ["From Hotel A", HOTEL_A, "Hotel A"]]);
    assert.deepEqual([all.total, all.unread], [2, 2]);
    assert.deepEqual((await portalPage("tcsBoth", `?hotel=${HOTEL_A}`)).items.map((i) => i.id), [a.id]);
    assert.equal((await portalPage("tcsBoth", `?hotel=${HOTEL_B}`)).total, 1);
    assert.equal((await portal("tcsBoth", `?hotel=${pid(123)}`)).status, 403);
    assert.equal(await unread("tcsBoth"), 2);
    assert.equal(await unread("tcsBoth", `?hotel=${HOTEL_B}`), 1);
  });

  test("mark read finds the right hotel without being told; with a hotel it only looks there; read all covers both", async () => {
    const { a, b } = await bothHotels();
    assert.equal((await read("tcsBoth", b.id)).status, 200, "hotel B's notice, no hotel named");
    assert.equal((await read("tcsBoth", a.id, `?hotel=${HOTEL_B}`)).status, 404, "named the wrong hotel");
    assert.equal(await unread("tcsBoth"), 1);
    const res = await readAllRoute(req("POST", "/api/v1/corporate/notifications/read-all", "tcsBoth"));
    assert.deepEqual((await json(res)).data, { marked: 1, unavailable: [] });
    assert.equal(await unread("tcsBoth"), 0);
  });

  test("a single-hotel login (no memberships) reads its own hotel only, even when the same company id exists at another hotel", async () => {
    await sent("creator");
    await sent("creatorB", { title: "Hotel B only" });
    assert.deepEqual((await portalPage("tcs")).items.map((i) => i.title), ["Rooms closed 20 to 24 October"]);
    const one = await dashboardRoute(req("GET", "/api/v1/corporate/dashboard", "tcsBoth"));
    assert.equal((await json(one)).data.unreadNotifications, 2, "linked to both: the badge counts both");
  });
});
