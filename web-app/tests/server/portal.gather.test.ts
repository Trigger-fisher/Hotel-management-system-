// "All hotels" reads of the guest and company portals (docs/plans/PORTAL-ALL-HOTELS-PLAN-2026-10-18.md), the shared helper: each linked hotel is read in its own session
// (that hotel and that hotel's record), at most 25 hotels, 4 at a time, 10 seconds each; a hotel that fails or runs late is left out and named (id and name only) in
// `unavailable`; a hotel the login is not linked to is never reached. Limits are passed small here so the tests are quick.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../../src/server/errors";
import { gather, PORTAL_CONCURRENCY, PORTAL_HOTEL_TIMEOUT_MS, PORTAL_MAX_HOTELS, type Memberships, type PortalMembership } from "../../src/server/services/portal/multiHotel";
import { pid } from "./helpers/portalWorld";
import { makeSession } from "./helpers/session";

const hotelId = (n: number): string => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const linked = (n: number): PortalMembership[] => Array.from({ length: n }, (_, i) => ({ hotelId: hotelId(i + 1), hotelName: `Hotel ${i + 1}`, subjectId: pid(100 + i + 1) }));
const sourceOf = (list: PortalMembership[]): Memberships => ({ list: async () => list });
const company = makeSession({ userId: pid(900), accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: pid(101) } });
const code = (e: unknown): boolean => e instanceof AppError;

describe("the limits are the agreed ones", () => {
  test("25 hotels, 4 at a time, 10 seconds a hotel", () => {
    assert.deepEqual([PORTAL_MAX_HOTELS, PORTAL_CONCURRENCY, PORTAL_HOTEL_TIMEOUT_MS], [25, 4, 10_000]);
  });
});

describe("gather: each linked hotel in its own session", () => {
  test("every hotel is read with ITS hotel and ITS record, in the login's order; nothing else is reachable", async () => {
    const seen: string[] = [];
    const got = await gather(sourceOf(linked(3)), company, "company", "all", async (s, m) => {
      seen.push(`${s.hotelId}:${s.scope?.kind}:${s.scope?.id}`);
      assert.equal(s.userId, company.userId, "same login");
      return m.hotelName;
    });
    assert.deepEqual(got.parts.map((p) => p.value), ["Hotel 1", "Hotel 2", "Hotel 3"]);
    assert.deepEqual(got.unavailable, []);
    assert.deepEqual(seen.sort(), linked(3).map((m) => `${m.hotelId}:company:${m.subjectId}`).sort(), "each hotel got its own company record id, never the first hotel's");
  });

  test("one hotel by id reads only that hotel; an id the login is not linked to is 403 and nothing is read", async () => {
    let calls = 0;
    const one = await gather(sourceOf(linked(3)), company, "company", hotelId(2), async (_s, m) => (calls++, m.hotelId));
    assert.deepEqual(one.parts.map((p) => p.value), [hotelId(2)]);
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(gather(sourceOf(linked(3)), company, "company", hotelId(9), async () => (calls++, 1)), (e: unknown) => code(e) && (e as AppError).code === "FORBIDDEN");
    assert.equal(calls, 0, "no hotel was read");
    await assert.rejects(gather(sourceOf(linked(3)), company, "company", "not-an-id", async () => 1), (e: unknown) => (e as AppError).code === "FORBIDDEN");
  });

  test("at most 4 hotels run at the same time", async () => {
    let running = 0;
    let most = 0;
    const got = await gather(sourceOf(linked(12)), company, "company", "all", async (_s, m) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return m.hotelId;
    });
    assert.equal(got.parts.length, 12);
    assert.equal(most, 4);
    assert.deepEqual(got.parts.map((p) => p.hotel.hotelId), linked(12).map((m) => m.hotelId), "the answers keep the login's order whatever finished first");
  });

  test("more than 25 linked hotels: the first 25 are read, the rest are named as unavailable (their own hotels only)", async () => {
    let calls = 0;
    const got = await gather(sourceOf(linked(28)), company, "company", "all", async () => (calls++, 1));
    assert.equal(calls, 25);
    assert.deepEqual(got.unavailable, linked(28).slice(25).map((m) => ({ hotelId: m.hotelId, hotelName: m.hotelName })));
  });
});

describe("gather: a hotel that fails does not break the others", () => {
  test("an error leaves that hotel out and names it (id and name only, never the error)", async () => {
    const got = await gather(sourceOf(linked(3)), company, "company", "all", async (_s, m) => {
      if (m.hotelId === hotelId(2)) throw new Error("connection to db-secret-host:5432 refused");
      return m.hotelName;
    });
    assert.deepEqual(got.parts.map((p) => p.value), ["Hotel 1", "Hotel 3"]);
    assert.deepEqual(got.unavailable, [{ hotelId: hotelId(2), hotelName: "Hotel 2" }]);
    assert.ok(!JSON.stringify(got).includes("secret"), "no error text in the answer");
    assert.deepEqual(Object.keys(got.unavailable[0]).sort(), ["hotelId", "hotelName"]);
  });

  test("a linked hotel that no longer exists in the database (FORBIDDEN 'Hotel is not available') is unavailable too, not a refusal of the whole request", async () => {
    const got = await gather(sourceOf(linked(2)), company, "company", "all", async (_s, m) => {
      if (m.hotelId === hotelId(2)) throw new AppError("FORBIDDEN", "Hotel is not available");
      return m.hotelName;
    });
    assert.deepEqual(got.parts.map((p) => p.value), ["Hotel 1"]);
    assert.deepEqual(got.unavailable, [{ hotelId: hotelId(2), hotelName: "Hotel 2" }]);
  });

  test("a hotel that takes too long is left out the same way, and the others do not wait for it", async () => {
    const started = Date.now();
    const got = await gather(
      sourceOf(linked(3)),
      company,
      "company",
      "all",
      async (_s, m) => {
        if (m.hotelId === hotelId(3)) await new Promise((r) => setTimeout(r, 300));
        return m.hotelName;
      },
      { timeoutMs: 40 },
    );
    assert.deepEqual(got.parts.map((p) => p.value), ["Hotel 1", "Hotel 2"]);
    assert.deepEqual(got.unavailable.map((u) => u.hotelId), [hotelId(3)]);
    assert.ok(Date.now() - started < 250, "returned at the timeout, not when the slow hotel finished");
  });

  test("when every hotel fails the call is 503 with one plain sentence, not a list of causes", async () => {
    await assert.rejects(
      gather(sourceOf(linked(2)), company, "company", "all", async () => {
        throw new Error("boom");
      }),
      (e: unknown) => (e as AppError).code === "NETWORK_OFFLINE" && /None of your hotels could be reached/.test((e as AppError).message) && !/boom/.test((e as AppError).message),
    );
  });

  test("a hotel whose record is gone or switched off is left out quietly; all of them gone is told so (as before)", async () => {
    const got = await gather(sourceOf(linked(3)), company, "company", "all", async (_s, m) => {
      if (m.hotelId === hotelId(1)) throw new AppError("PORTAL_NOT_LINKED");
      if (m.hotelId === hotelId(2)) throw new AppError("PORTAL_INACTIVE");
      return m.hotelName;
    });
    assert.deepEqual(got.parts.map((p) => p.value), ["Hotel 3"]);
    assert.deepEqual(got.unavailable, [], "those two are not 'unavailable': the account is not set up there");
    await assert.rejects(gather(sourceOf(linked(2)), company, "company", "all", async () => { throw new AppError("PORTAL_NOT_LINKED"); }), (e: unknown) => (e as AppError).code === "PORTAL_NOT_LINKED");
  });

  test("a refusal every hotel would give (here FORBIDDEN) is thrown as it is, not turned into a partial answer", async () => {
    await assert.rejects(gather(sourceOf(linked(3)), company, "company", "all", async () => { throw new AppError("FORBIDDEN"); }), (e: unknown) => (e as AppError).code === "FORBIDDEN");
  });
});

describe("gather: who may ask", () => {
  test("staff and the other kind of portal account are 403 before any hotel is read", async () => {
    let calls = 0;
    const staff = makeSession({ userId: pid(901), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3 });
    const guest = makeSession({ userId: pid(902), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, scope: { kind: "guest", id: pid(11) } });
    for (const who of [staff, guest]) await assert.rejects(gather(sourceOf(linked(2)), who, "company", "all", async () => (calls++, 1)), (e: unknown) => (e as AppError).code === "FORBIDDEN");
    assert.equal(calls, 0);
  });
});
