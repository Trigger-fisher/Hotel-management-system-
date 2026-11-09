// Conversations, who may open a hotel's hub (decision 66, A1, A2, A14), through the REAL route files and the wrapper: 401 without a session; 403 without the Conversations
// right (View to read, Edit to change); the Hotel Admin always; never an API key, never an account outside a hotel; a Super Admin's or platform admin's visit is refused
// even for reads (C4), a Group Hotel Admin's visit may only read; another hotel's conversation is 404; the contact panel shows a stay's room and dates only with the Front
// Office right, a bill only with the Bills right, and "Link guest" offers only the kinds the viewer may see.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { conversationsCopy } from "@shared/dashboards/conversations";
import { GET as listRoute } from "../../src/app/api/v1/conversations/route";
import { GET as threadRoute, PATCH as patchRoute } from "../../src/app/api/v1/conversations/[id]/route";
import { POST as replyRoute } from "../../src/app/api/v1/conversations/[id]/reply/route";
import { POST as noteRoute } from "../../src/app/api/v1/conversations/[id]/notes/route";
import { GET as summaryRoute } from "../../src/app/api/v1/conversations/summary/route";
import { PUT as linkRoute } from "../../src/app/api/v1/conversations/[id]/link/route";
import { GET as candidatesRoute } from "../../src/app/api/v1/conversations/link-candidates/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { tokenCallVerdict } from "../../src/server/auth/apiTokens";
import { configureConversations } from "../../src/server/compose/conversations";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const C = conversationsCopy;
const sessions = new Map<string, VerifiedSession>();
const s = (name: string, session: VerifiedSession) => sessions.set(name, session);
const user = (grants: ReturnType<typeof grant>[], userId: string = STAFF.neha) => makeSession({ userId, accountRole: "hotel_user", roleKey: "editor", roleLevel: 2, grants });
s("admin", makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }));
s("none", user([]));
s("view", user([grant("conversations", "view")]));
s("viewAll", user([grant("conversations", "view"), grant("pms.stays", "view"), grant("bills.bills", "view")]));
s("edit", user([grant("conversations", "edit")]));
s("editStays", user([grant("conversations", "edit"), grant("pms.stays", "view")]));
s("otherHotel", makeSession({ userId: STAFF.admin, hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }));
s("outside", makeSession({ userId: STAFF.admin, hotelId: "", accountRole: "group_hotel_admin", roleKey: "super_admin", roleLevel: 4 }));
const visit = (by: "super_admin" | "platform_admin" | "group_hotel_admin", access: "view" | "full") => ({ ...makeSession({ userId: STAFF.admin, accountRole: by, roleKey: "super_admin", roleLevel: 4, grants: [grant("conversations", "edit")] }), visit: { id: "v1", hotelId: HOTEL_A, hotelName: "Hotel Sunrise", expiresAt: new Date("2030-01-01"), access, by } });
s("superVisit", visit("super_admin", "full"));
s("platformVisit", visit("platform_admin", "view"));
s("groupVisit", visit("group_hotel_admin", "view"));
s("key", { ...makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }), client: "token", token: { id: "k1", name: "Load test", level: "full", scope: "all", testMode: false, callsPerMinute: 600, ip: null, newIp: false } });

const ORIGIN = "https://hms.test";
const req = (method: string, path: string, who: string | null, body?: unknown): Request => {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (r: Response): Promise<any> => r.json();

let w = hotelWorld();
let id = "";
const STAY = "00000000-0000-4000-8000-00000000d204";
const BILL = "00000000-0000-4000-8000-00000000b204";
const ROOM = "00000000-0000-4000-8000-00000000a204";

beforeEach(async () => {
  w = hotelWorld();
  configureConversations(w.service);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  const d = w.data();
  d.rooms.push({ id: ROOM, number: "204" } as never);
  d.bills.push({ id: BILL, billNumber: "B-204", deletedAt: null, totalHotelAmountPaise: 450000, totalFoodAmountPaise: 50000 } as never);
  d.stays.push({ id: STAY, guestName: "Asha Rao", email: "asha@guest.in", mobile: "9825012345", status: "in_house", checkInAt: new Date("2026-10-23T08:00:00Z"), roomId: ROOM, billId: BILL, expectedCheckOut: "2026-10-26", checkOutAt: null } as never);
  w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
  await w.service.sync(sessions.get("admin")!, {});
  id = d.convConversations[0].id;
});

describe("who may call the hotel's Conversations routes", () => {
  test("401 without a session; 403 without the right; View reads; Edit changes; the Hotel Admin always", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/conversations", null))).status, 401);
    assert.equal((await listRoute(req("GET", "/api/v1/conversations", "none"))).status, 403);
    assert.equal((await summaryRoute(req("GET", "/api/v1/conversations/summary", "none"))).status, 403);
    const listed = await listRoute(req("GET", "/api/v1/conversations", "view"));
    assert.equal(listed.status, 200);
    assert.deepEqual([listed.headers.get("cache-control"), listed.headers.has("etag")], ["private, no-cache", true], "the polled list carries an ETag (API audit B21)");
    assert.equal((await summaryRoute(req("GET", "/api/v1/conversations/summary", "view"))).headers.get("cache-control"), "private, no-cache", "the badge's poll too");
    assert.equal((await replyRoute(req("POST", `/api/v1/conversations/${id}/reply`, "view", { channel: "email", text: "Hi" }), ctx({ id }))).status, 403);
    assert.equal((await noteRoute(req("POST", `/api/v1/conversations/${id}/notes`, "view", { text: "n" }), ctx({ id }))).status, 403);
    assert.equal((await replyRoute(req("POST", `/api/v1/conversations/${id}/reply`, "edit", { channel: "email", text: "Hi" }), ctx({ id }))).status, 201);
    assert.equal((await patchRoute(req("PATCH", `/api/v1/conversations/${id}`, "admin", { status: "done" }), ctx({ id }))).status, 200);
    const thread = (await json(await threadRoute(req("GET", `/api/v1/conversations/${id}`, "view"), ctx({ id })))).data;
    assert.deepEqual([thread.access.canEdit, thread.access.readOnlyReason], [false, "view_only"]);
  });

  test("never an API key (the wrapper's deny list and the service), never an account outside a hotel", async () => {
    const r = await listRoute(req("GET", "/api/v1/conversations", "key"));
    assert.equal(r.status, 403);
    assert.equal(tokenCallVerdict({ level: "full", scope: "all", testMode: false }, "GET", "/api/v1/conversations").allowed, false);
    await assert.rejects(w.service.list(sessions.get("key")!, { tab: "all", channel: "all", page: 1, size: 25 }), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    assert.equal((await listRoute(req("GET", "/api/v1/conversations", "outside"))).status, 403);
  });

  test("visits (C4): the Super Admin and platform admins are refused even for reads; a Group Hotel Admin reads only, and its mail check does nothing", async () => {
    for (const who of ["superVisit", "platformVisit"]) {
      const r = await listRoute(req("GET", "/api/v1/conversations", who));
      assert.equal(r.status, 403, who);
      assert.equal((await json(r)).error.message, C.errors.visitClosed);
    }
    assert.equal((await listRoute(req("GET", "/api/v1/conversations", "groupVisit"))).status, 200);
    assert.equal((await patchRoute(req("PATCH", `/api/v1/conversations/${id}`, "groupVisit", { status: "done" }), ctx({ id }))).status, 403);
    const thread = (await json(await threadRoute(req("GET", `/api/v1/conversations/${id}`, "groupVisit"), ctx({ id })))).data;
    assert.deepEqual([thread.access.canEdit, thread.access.readOnlyReason], [false, "visit"]);
    const opened = w.imap.stats.opened;
    assert.equal((await w.service.sync(sessions.get("groupVisit")!, {})).checked, false);
    assert.equal(w.imap.stats.opened, opened, "no mail check during a visit");
    await assert.rejects(w.service.setRead(sessions.get("groupVisit")!, id, true), (e: unknown) => (e as Error).message === C.errors.readOnlyVisit);
  });

  test("another hotel's conversation is not found", async () => {
    assert.equal((await threadRoute(req("GET", `/api/v1/conversations/${id}`, "otherHotel"), ctx({ id }))).status, 404);
  });
});

describe("what the contact panel and Link guest show (A14)", () => {
  beforeEach(() => {
    w.data().convContacts[0].link = { kind: "stay", id: STAY, source: "auto" };
  });

  test("View alone: the link's name, no room, dates or bill, nothing to link; with Front Office and Bills: room, dates and the bill", async () => {
    const bare = (await json(await threadRoute(req("GET", `/api/v1/conversations/${id}`, "view"), ctx({ id })))).data;
    assert.deepEqual(bare.links, [{ kind: "stay", id: STAY, label: "Asha Rao", source: "auto" }]);
    assert.deepEqual([bare.access.canSeeStay, bare.access.canSeeBills, bare.access.canLink], [false, false, []]);
    const full = (await json(await threadRoute(req("GET", `/api/v1/conversations/${id}`, "viewAll"), ctx({ id })))).data;
    assert.deepEqual(full.links[0].detail, { room: "204", checkIn: "2026-10-23", checkOut: "2026-10-26", status: "in_house", billId: BILL, billNo: "B-204", billTotal: 500000 });
    const admin = (await json(await threadRoute(req("GET", `/api/v1/conversations/${id}`, "admin"), ctx({ id })))).data;
    assert.deepEqual(admin.access.canLink.sort(), ["company", "customer", "reservation", "stay"]);
  });

  test("Edit without the Front Office right: no stay candidates and linking a stay is refused; with it, both work", async () => {
    const none = await json(await candidatesRoute(req("GET", "/api/v1/conversations/link-candidates?search=asha&kind=stay", "edit")));
    assert.deepEqual(none.data, []);
    assert.equal((await linkRoute(req("PUT", `/api/v1/conversations/${id}/link`, "edit", { kind: "stay", targetId: STAY }), ctx({ id }))).status, 403);
    const some = await json(await candidatesRoute(req("GET", "/api/v1/conversations/link-candidates?search=asha&kind=stay", "editStays")));
    assert.deepEqual(some.data.map((c: { kind: string; id: string }) => [c.kind, c.id]), [["stay", STAY]]);
    assert.equal((await linkRoute(req("PUT", `/api/v1/conversations/${id}/link`, "editStays", { kind: "stay", targetId: STAY }), ctx({ id }))).status, 200);
    assert.equal(w.data().convContacts[0].link?.source, "manual");
  });
});
