// Round 3 d (guest portal, rebuilt on main): the guest edits their own details and the change goes to their customer record in EVERY linked hotel (a hotel that cannot be
// reached is named and keeps its details); the mobile stays reception's; 20 changes an hour; and the guest's own sign-in history (staff and company accounts are refused).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { PUT as profilePut } from "../../src/app/api/v1/guest/profile/route";
import { GET as signInsRoute } from "../../src/app/api/v1/guest/sign-ins/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { ctx, customer, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { catalog, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST_A = pid(11);
const CUST_B = pid(12);
const sessions = new Map<string, VerifiedSession>();
sessions.set("amitAB", makeSession({ userId: pid(901), hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST_A } }));
sessions.set("company", makeSession({ userId: pid(902), accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: pid(21) } }));
sessions.set("staff", makeSession({ userId: pid(903), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" }));
const memberships: Memberships = {
  list: async (userId, kind) => (kind === "guest" && userId === pid(901) ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CUST_A }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CUST_B }] : []),
};

let world = wirePortal(sessions, () => new Date("2026-10-05T10:00:00+05:30"), new Map(), { memberships });
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);
const down = new Set<string>();

beforeEach(() => {
  down.clear();
  world = wirePortal(sessions, () => new Date("2026-10-05T10:00:00+05:30"), new Map(), { memberships });
  const unit = world.hotel.unit;
  const run = unit.run.bind(unit);
  unit.run = ((session: { hotelId: string }, work: never) => (down.has(session.hotelId) ? Promise.reject(new Error("down")) : run(session as never, work))) as typeof unit.run;
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  data().customers.push(customer({ id: CUST_A, mobile: "9876543210", name: "Amit Joshi", city: "Rajkot" }));
  data(HOTEL_B).customers.push(customer({ id: CUST_B, mobile: "9876543210", name: "Amit at B", city: "Surat" }));
});

const body = (over: Record<string, unknown> = {}) => ({ name: "Amit R. Joshi", email: "amit.joshi@example.com", city: "Ahmedabad", address: "Satellite Road", idProofType: "none", idProofNumber: "", notifyEmail: true, ...over });
const put = (who = "amitAB", b: unknown = body()) => profilePut(req("PUT", "/api/v1/guest/profile", who, b), ctx());

describe("profile editing reaches every linked hotel", () => {
  test("a change goes to the guest's record in both hotels; the answer is the session's hotel's profile; each hotel logs field names only", async () => {
    const res = await put();
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const r = (await json(res)).data;
    assert.deepEqual([r.name, r.updatedHotels, r.unavailable], ["Amit R. Joshi", 2, []]);
    for (const hotel of [HOTEL_A, HOTEL_B]) {
      const c = data(hotel).customers[0];
      assert.deepEqual([c.name, c.city, c.email], ["Amit R. Joshi", "Ahmedabad", "amit.joshi@example.com"], hotel);
      assert.equal(c.mobile, "9876543210", "the mobile is reception's to change");
      const log = data(hotel).systemLogs.filter((l) => l.entity === "Customer");
      assert.equal(log.length, 1, hotel);
      assert.ok(!JSON.stringify(log).includes("Satellite"), "values are not logged");
    }
  });

  test("a hotel that cannot be reached keeps its details and is named; the strict body refuses a mobile or a record id", async () => {
    down.add(HOTEL_B);
    const r = (await json(await put())).data;
    assert.deepEqual([r.updatedHotels, r.unavailable], [1, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]]);
    assert.equal(data(HOTEL_B).customers[0].name, "Amit at B");
    for (const extra of [{ mobile: "9000000000" }, { customerId: CUST_B }, { hotelId: HOTEL_B }]) assert.equal((await put("amitAB", body(extra))).status, 422, JSON.stringify(extra));
  });

  test("20 changes an hour, then 429 with a sentence; staff and company accounts are refused", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await put("amitAB", body({ city: `City ${i}` }))).status, 200, `change ${i + 1}`);
    const refused = await put();
    assert.equal(refused.status, 429);
    assert.match((await json(refused)).error.message, /changed your details many times/);
    for (const who of ["company", "staff"]) assert.equal((await put(who)).status, 403, who);
  });
});

describe("the guest's own sign-in history", () => {
  test("a guest gets a list (newest first, their own); staff and company accounts are 403; no session is 401", async () => {
    const res = await signInsRoute(req("GET", "/api/v1/guest/sign-ins?pageSize=10", "amitAB"), ctx());
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const d = (await json(res)).data;
    assert.ok(Array.isArray(d.items));
    assert.deepEqual([d.page, d.pageSize], [1, 10]);
    for (const who of ["company", "staff"]) assert.equal((await signInsRoute(req("GET", "/api/v1/guest/sign-ins", who), ctx())).status, 403, who);
    assert.equal((await signInsRoute(req("GET", "/api/v1/guest/sign-ins", null), ctx())).status, 401);
    assert.equal((await signInsRoute(req("GET", "/api/v1/guest/sign-ins?pageSize=7", "amitAB"), ctx())).status, 422);
  });
});
