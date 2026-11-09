// The WhatsApp connection manager (plan part 28.7) on the in-memory double and a fake Meta: each connect step succeeds and fails with a plain sentence, a token is never in a response, an
// audit row or an error, an attached number is refused, disconnect is refused while a hotel is attached, a token replacement works, subscribing twice is harmless, and only Super Admin and
// Platform Admin may use any of it.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryLineAdminStore } from "../../src/server/repos/memory/whatsappLines";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createConnectionService } from "../../src/server/services/whatsapp/connectionService";
import type { PlatformMeta } from "../../src/server/services/platform/access";
import type { AccountRole } from "../../src/server/auth/session";
import { createGraphClient, type FetchLike } from "../../src/server/whatsapp/graph";
import { createFakeMeta } from "../../src/server/whatsapp/fakeMeta";
import { makeSession } from "./helpers/session";

const TOKEN = "EAAGsecretTOKENvalue1234567890abcdef";
const NEW_TOKEN = "EAAGreplacedTOKENvalue0987654321zyx";
const PIN = "424242";
const SEAL = randomBytes(32);
const META: PlatformMeta = { traceId: randomUUID(), ip: "203.0.113.7", userAgent: "test" };
const HOTEL = randomUUID();
const PHONE_ID = "109876543210";
const WABA = "209876543210";

let fake = createFakeMeta();
/** Lets a test make every Graph answer a given HTTP status (an error body with Meta's code) instead of the fake's. */
let forced: { status: number; code: number } | null = null;

function build() {
  fake = createFakeMeta();
  forced = null;
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const data = auth.data();
  const role = randomUUID();
  data.roles.push({ id: role, hotelId: null, key: "viewer", level: 1, inherits: true });
  const ids: Record<string, string> = {};
  for (const accountRole of ["super_admin", "platform_admin", "hotel_admin", "group_hotel_admin"] as const) {
    const id = randomUUID();
    ids[accountRole] = id;
    data.users.push({
      id, username: accountRole, email: `${accountRole}@demo.hms`, mobile: null, displayName: accountRole.toUpperCase(), passwordHash: "x", accountRole, status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: role,
    } as never);
  }
  const lines = createMemoryLineAdminStore({ hotels: [HOTEL] });
  const fetcher: FetchLike = (input, init) => {
    if (forced) return Promise.resolve(new Response(JSON.stringify({ error: { code: forced.code, message: "fake" } }), { status: forced.status }));
    return fake.fetch(input, init);
  };
  const service = createConnectionService({
    unit: cons.unit, lines, graph: () => createGraphClient({ fetch: fetcher }), sealKey: () => SEAL,
    configStatus: () => ({ appSecret: true, verifyToken: true, sealKey: true, graphVersion: "v22.0" }), publicUrl: () => "https://hms.test/", now: () => new Date("2026-11-04T10:00:00Z"), newPin: () => PIN,
  });
  const as = (accountRole: AccountRole) => makeSession({ accountRole, userId: ids[accountRole] ?? randomUUID(), hotelId: "" });
  return { service, lines, cons, as };
}

let w: ReturnType<typeof build>;
beforeEach(() => {
  w = build();
});

const connect = (kind: "platform" | "hotel" = "platform", phoneNumberId = PHONE_ID) =>
  w.service.create(w.as("super_admin"), { kind, phoneNumberId, wabaId: WABA, token: TOKEN, ...(kind === "hotel" ? { hotelId: HOTEL } : {}) }, META);

/** Everything a test saw (responses, audit rows, stored rows' readable parts) must be free of these. */
function assertNoSecrets(...seen: unknown[]): void {
  const text = JSON.stringify(seen) + JSON.stringify(w.cons.data.audit);
  for (const secret of [TOKEN, NEW_TOKEN, PIN]) assert.ok(!text.includes(secret), "a secret leaked");
}

describe("connect a line", () => {
  test("every step succeeds, in order, and nothing secret is returned or audited", async () => {
    const s = w.as("super_admin");
    const created = await connect();
    const id = created.line.id;
    assert.equal(created.line.status, "test");
    assert.equal(created.line.tokenState, "unchecked");
    const verified = await w.service.verify(s, id, META);
    assert.equal(verified.ok, true);
    assert.equal(verified.line.displayPhone, "+1 555 000 1111");
    assert.equal(verified.line.quality, "green");
    assert.equal(verified.line.messagingTier, "TIER_250");
    assert.equal(verified.line.tokenState, "valid");
    const subscribed = await w.service.subscribe(s, id, META);
    assert.equal(subscribed.line.webhookSubscribed, true);
    assert.deepEqual(subscribed.line.subscribedFields, ["messages"]);
    const registered = await w.service.register(s, id, META);
    assert.equal(registered.line.registered, true);
    const tested = await w.service.test(s, id, "+91 98250 41236", META);
    assert.equal(tested.accepted, true);
    const live = await w.service.resume(s, id, META);
    assert.equal(live.line.status, "active");
    // Meta did get the token and the PIN; no answer or audit row carries them
    assert.ok(fake.calls.every((c) => c.authorization === `Bearer ${TOKEN}`));
    assert.equal(fake.calls.find((c) => c.path.includes("/register"))?.body?.pin, PIN);
    assertNoSecrets(created, verified, subscribed, registered, tested, live, await w.service.list(s));
    // the stored token is sealed, bound to the number
    assert.ok(!w.lines.rows[0].tokenSecret.includes(TOKEN));
    assert.match(w.lines.rows[0].tokenSecret, /^v1\./);
    assert.ok(w.lines.rows[0].pinSecret !== null && !w.lines.rows[0].pinSecret.includes(PIN));
    // the test phone appears only as its last four digits
    assert.ok(!JSON.stringify(w.cons.data.audit).includes("9825041236"));
    assert.ok(w.cons.data.audit.some((a) => a.reason === "whatsapp:line_verified: ok" && a.result === "success"));
  });

  test("subscribing twice is harmless", async () => {
    const id = (await connect()).line.id;
    const s = w.as("super_admin");
    assert.equal((await w.service.subscribe(s, id, META)).ok, true);
    const again = await w.service.subscribe(s, id, META);
    assert.equal(again.ok, true);
    assert.deepEqual(again.line.subscribedFields, ["messages"]);
  });

  test("failures come back as plain sentences and are audited as failed", async () => {
    const s = w.as("super_admin");
    const id = (await connect()).line.id;
    forced = { status: 400, code: 100 };
    const bad = await w.service.verify(s, id, META);
    assert.equal(bad.ok, false);
    assert.match(bad.message ?? "", /cannot see that phone number/);
    forced = { status: 401, code: 190 };
    const first = await w.service.verify(s, id, META);
    assert.match(first.message ?? "", /rejected the access token/);
    assert.equal(first.line.tokenState, "failing");
    const second = await w.service.verify(s, id, META);
    assert.equal(second.line.status, "needs_reconnect");
    assert.equal(second.line.tokenState, "needs_reconnect");
    forced = null;
    const badPhone = await w.service.test(s, id, "12", META).then(() => null, (e: Error) => e);
    assert.ok(badPhone, "a number that cannot be a phone number is refused");
    assert.ok(w.cons.data.audit.filter((a) => a.result === "failed").length >= 3);
    assertNoSecrets(bad, first, second, badPhone?.message);
  });

  test("a number that is already attached is refused, and so is a second platform line", async () => {
    await connect();
    await assert.rejects(connect("platform", PHONE_ID), /already attached/);
    await assert.rejects(connect("platform", "555000111222"), /already a platform line/);
    // kind rules: a hotel line needs its hotel, an unknown hotel is refused
    await assert.rejects(w.service.create(w.as("super_admin"), { kind: "hotel", phoneNumberId: "555000111333", wabaId: WABA, token: TOKEN }, META), /Choose the hotel/);
    await assert.rejects(w.service.create(w.as("super_admin"), { kind: "hotel", phoneNumberId: "555000111333", wabaId: WABA, token: TOKEN, hotelId: randomUUID() }, META), /hotel was not found/);
    await assert.rejects(w.service.create(w.as("super_admin"), { kind: "person", phoneNumberId: "555000111333", wabaId: WABA, token: TOKEN }, META), /Choose the person/);
    assertNoSecrets(w.cons.data.audit);
  });
});

describe("token, pause and disconnect", () => {
  test("replacing the token on an active line needs the line's name; it resets the failures and keeps the line", async () => {
    const s = w.as("super_admin");
    const id = (await connect()).line.id;
    await w.service.verify(s, id, META);
    await w.service.resume(s, id, META);
    forced = { status: 401, code: 190 };
    await w.service.verify(s, id, META);
    forced = null;
    await assert.rejects(w.service.replaceToken(s, id, { token: NEW_TOKEN }, META), /to confirm/);
    const done = await w.service.replaceToken(s, id, { token: NEW_TOKEN, confirm: "fake hotel" }, META);
    assert.equal(done.line.tokenState, "unchecked");
    assert.equal(done.line.status, "active");
    assert.equal(w.lines.rows[0].tokenFailures, 0);
    fake.calls.length = 0;
    assert.equal((await w.service.verify(s, id, META)).ok, true);
    assert.equal(fake.calls[0].authorization, `Bearer ${NEW_TOKEN}`);
    assertNoSecrets(done);
  });

  test("disconnect is refused while a hotel is attached; a free line disconnects after its name is typed", async () => {
    const s = w.as("super_admin");
    const hotelLine = (await connect("hotel")).line;
    assert.equal(hotelLine.hotelsAttached, 1);
    await assert.rejects(w.service.disconnect(s, hotelLine.id, { confirm: hotelLine.label }, META), /still used by 1 hotel/);
    const free = (await connect("platform", "555000111444")).line;
    await assert.rejects(w.service.disconnect(s, free.id, { confirm: "wrong" }, META), /to confirm/);
    const gone = await w.service.disconnect(s, free.id, { confirm: free.label }, META);
    assert.equal(gone.line.tokenState, "disconnected");
    assert.equal(gone.line.status, "paused");
    await assert.rejects(w.service.verify(s, free.id, META), /disconnected/);
    assert.ok(!w.lines.rows.find((r) => r.id === free.id)?.tokenSecret.includes(TOKEN));
  });

  test("pause and resume; the app status names the callback address and no secret", async () => {
    const s = w.as("super_admin");
    const id = (await connect()).line.id;
    assert.equal((await w.service.pause(s, id, META)).line.status, "paused");
    assert.equal((await w.service.resume(s, id, META)).line.status, "active");
    const status = await w.service.appStatus(s);
    assert.equal(status.callbackUrl, "https://hms.test/api/v1/whatsapp/webhook");
    assert.deepEqual(Object.keys(status).sort(), ["appSecret", "callbackUrl", "fields", "graphVersion", "lastVerifiedAt", "lines", "sealKey", "verifyToken"]);
  });
});

describe("who may use it", () => {
  test("only the Super Admin (MJ, 5 Nov 2026); a Platform Admin, an API key, a hotel visit and every other role are refused", async () => {
    const id = (await connect()).line.id;
    const refused = [w.as("platform_admin"), w.as("hotel_admin"), w.as("group_hotel_admin"), { ...w.as("super_admin"), token: { id: "k", name: "key", level: "full", scope: "platform", testMode: false, callsPerMinute: 60, ip: null, newIp: false } } as never, { ...w.as("super_admin"), visit: { id: "v", hotelId: HOTEL, hotelName: "H", expiresAt: new Date(), access: "full", by: "super_admin" } } as never];
    for (const session of refused) {
      await assert.rejects(w.service.list(session), (e: { code?: string }) => e.code === "FORBIDDEN");
      await assert.rejects(w.service.appStatus(session), (e: { code?: string }) => e.code === "FORBIDDEN");
      await assert.rejects(w.service.create(session, { kind: "platform", phoneNumberId: "555000111999", wabaId: WABA, token: TOKEN }, META), (e: { code?: string }) => e.code === "FORBIDDEN");
      await assert.rejects(w.service.verify(session, id, META), (e: { code?: string }) => e.code === "FORBIDDEN");
      await assert.rejects(w.service.replaceToken(session, id, { token: NEW_TOKEN }, META), (e: { code?: string }) => e.code === "FORBIDDEN");
    }
    assert.equal(w.lines.rows.length, 1);
    assert.equal((await w.service.list(w.as("super_admin"))).lines.length, 1);
    assertNoSecrets();
  });
});
