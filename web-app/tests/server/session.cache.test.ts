// The session cache of the real resolver (services/auth/sessionResolver.ts): a session is read from the database in ONE statement (access.loadBySession on
// unit.read, no transaction) and then trusted for SESSION_CACHE_MS; requests for the same token that arrive while the read runs share it; a revoke is seen once
// that time has passed (or at once after forgetSession); the cached copy follows the idle-window extension and marks it before the write, so a burst makes one
// UPDATE; a platform, super or group account is never cached (its Enter-hotel visit, started or ended on ANY instance, applies on the very next request); the
// access record a session was built from is kept (accessOf), and getSession gives the same answer with or without it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { hashSessionToken, SESSION_COOKIE } from "../../src/server/auth/tokens";
import type { AuthRepos, PlatformUnit } from "../../src/server/repos/auth";
import { createSessionResolver, SESSION_CACHE_MS } from "../../src/server/services/auth/sessionResolver";
import { buildWorld, HOTEL } from "./helpers/authWorld";

const token = () => randomBytes(32).toString("base64url");
const request = (t: string): Request => new Request("https://hms.test/api/v1/overview", { headers: { cookie: `${SESSION_COOKIE}=${t}` } });

/** The world's unit with the session read counted and the way in (run or read) recorded; `gate` can hold the read open. */
function counting(world: Awaited<ReturnType<typeof buildWorld>>) {
  const stats = { reads: 0, updates: 0, via: [] as ("run" | "read")[], gate: null as Promise<void> | null };
  const wrap = (r: AuthRepos): AuthRepos => ({
    ...r,
    access: { ...r.access, loadBySession: async (h, at) => { stats.reads += 1; if (stats.gate) await stats.gate; return r.access.loadBySession(h, at); } },
    sessions: { ...r.sessions, update: async (id, patch) => { stats.updates += 1; return r.sessions.update(id, patch); } },
  });
  const unit: PlatformUnit = {
    run: (work) => (stats.via.push("run"), world.mem.unit.run((r) => work(wrap(r)))),
    read: (work) => (stats.via.push("read"), world.mem.unit.read((r) => work(wrap(r)))),
  };
  return { unit, stats };
}

describe("the session cache", () => {
  test("one database read per SESSION_CACHE_MS for a hotel user; a revoke is seen after it, or at once after forgetSession; the touch reaches the cached copy", async () => {
    const world = await buildWorld();
    const clock = world.clock;
    const { unit, stats } = counting(world);
    const resolver = createSessionResolver({ unit, catalog: world.catalog, now: () => new Date(clock.at.getTime()) });
    const issue = async (userId: string, hotelId: string | null) => {
      const t = token();
      await world.mem.unit.run((r) => r.sessions.insert({ userId, hotelId, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: clock.at, lastSeenAt: null, expiresAt: new Date(clock.at.getTime() + 120 * 60_000) }));
      return t;
    };

    const staff = await issue(world.users.staff.id, HOTEL);
    const first = await resolver.resolveSession(request(staff));
    assert.equal(first?.userId, world.users.staff.id);
    for (let i = 0; i < 10; i += 1) await resolver.resolveSession(request(staff));
    assert.equal(stats.reads, 1, "ten more requests within the window cost no database read");
    assert.deepEqual(stats.via, ["read"], "the session read has no BEGIN / COMMIT around it");

    // a revoke is not seen until the window has passed
    await world.mem.unit.run((r) => r.sessions.revokeById(first!.sessionId, "admin", clock.at));
    assert.ok(await resolver.resolveSession(request(staff)), "still trusted inside the window");
    clock.at = new Date(clock.at.getTime() + SESSION_CACHE_MS + 1);
    assert.equal(await resolver.resolveSession(request(staff)), null, "read again after the window: revoked");
    assert.equal(stats.reads, 2);

    // forgetSession drops it at once
    const again = await issue(world.users.anita.id, HOTEL);
    const s2 = await resolver.resolveSession(request(again));
    await world.mem.unit.run((r) => r.sessions.revokeById(s2!.sessionId, "logout", clock.at));
    resolver.forgetSession(s2!.sessionId);
    assert.equal(await resolver.resolveSession(request(again)), null);

    // the idle-window extension reaches the cached copy
    const third = await issue(world.users.sonal.id, HOTEL);
    const s3 = await resolver.resolveSession(request(third));
    clock.at = new Date(clock.at.getTime() + 61 * 60_000);
    await resolver.touchSession(s3!);
    clock.at = new Date(clock.at.getTime() + 1000);
    const touched = await resolver.resolveSession(request(third));
    assert.ok(touched && touched.expiresAt && touched.expiresAt.getTime() > s3!.expiresAt!.getTime(), "the cached session carries the new expiry");
    assert.ok(resolver.accessOf(touched!), "the touched copy still has its access record");
  });

  test("ten requests for one token while its read is still running share that read: one database read, the same session object", async () => {
    const world = await buildWorld();
    const { unit, stats } = counting(world);
    const resolver = createSessionResolver({ unit, catalog: world.catalog, now: () => new Date(world.clock.at.getTime()) });
    const t = token();
    await world.mem.unit.run((r) => r.sessions.insert({ userId: world.users.staff.id, hotelId: HOTEL, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: world.clock.at, lastSeenAt: null, expiresAt: new Date(world.clock.at.getTime() + 120 * 60_000) }));
    let open!: () => void;
    stats.gate = new Promise<void>((resolve) => { open = resolve; });
    const all = Promise.all(Array.from({ length: 10 }, () => resolver.resolveSession(request(t))));
    await new Promise((r) => setImmediate(r));
    open();
    const sessions = await all;
    assert.equal(stats.reads, 1, "one read for the whole burst");
    assert.ok(sessions.every((s) => s === sessions[0] && s?.userId === world.users.staff.id));
  });

  test("a platform account is NOT cached: every request reads the database, and a burst still shares one in-flight read", async () => {
    const world = await buildWorld();
    const { unit, stats } = counting(world);
    const resolver = createSessionResolver({ unit, catalog: world.catalog, now: () => new Date(world.clock.at.getTime()) });
    const t = token();
    await world.mem.unit.run((r) => r.sessions.insert({ userId: world.users.mihir.id, hotelId: null, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: world.clock.at, lastSeenAt: null, expiresAt: new Date(world.clock.at.getTime() + 120 * 60_000) }));
    const p = await resolver.resolveSession(request(t));
    assert.deepEqual([p?.accountRole, p?.hotelId], ["super_admin", ""]);
    await resolver.resolveSession(request(t));
    await resolver.resolveSession(request(t));
    assert.equal(stats.reads, 3, "no cache for a platform account");
    let open!: () => void;
    stats.gate = new Promise<void>((resolve) => { open = resolve; });
    const all = Promise.all(Array.from({ length: 5 }, () => resolver.resolveSession(request(t))));
    await new Promise((r) => setImmediate(r));
    open();
    await all;
    assert.equal(stats.reads, 4, "five requests at once share one read");
  });

  test("an Enter-hotel visit started or ended through ANOTHER instance is seen by this one at once, in the seed/session answer and on hotel routes", async () => {
    const world = await buildWorld();
    const clock = world.clock;
    // two function instances: each has its own resolver (and cache); visitService forgets the session only on the one that served the console call
    const a = createSessionResolver({ unit: world.mem.unit, catalog: world.catalog, now: () => new Date(clock.at.getTime()) });
    const b = createSessionResolver({ unit: world.mem.unit, catalog: world.catalog, now: () => new Date(clock.at.getTime()) });
    const t = token();
    const sessionId = (await world.mem.unit.run((r) => r.sessions.insert({ userId: world.users.mihir.id, hotelId: null, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: clock.at, lastSeenAt: null, expiresAt: new Date(clock.at.getTime() + 120 * 60_000) }))).id;
    const console_ = await a.resolveSession(request(t));
    assert.deepEqual([console_?.hotelId, console_?.visit], ["", undefined], "A has seen the console session");

    // Enter hotel lands on B: the visit row is written, B forgets the session; A is told nothing
    const visit: (typeof world.data.visits)[number] = { id: "v-1", userId: world.users.mihir.id, hotelId: HOTEL, sessionId, reason: "audit", startedAt: clock.at, expiresAt: new Date(clock.at.getTime() + 60 * 60_000), endedAt: null, endedReason: null, access: "full", endedBy: null, ip: null, userAgent: null };
    world.data.visits.push(visit);
    b.forgetSession(sessionId);
    const inside = await a.resolveSession(request(t));
    assert.equal(inside?.hotelId, HOTEL, "the very next request on A is inside the hotel");
    assert.deepEqual([inside?.visit?.id, inside?.visit?.access], ["v-1", "full"]);
    assert.ok((await b.resolveSession(request(t)))?.visit, "and on B");

    // Exit lands on B: the visit ends there; A's next hotel call must not act on the hotel any more
    clock.at = new Date(clock.at.getTime() + 1000);
    visit.endedAt = clock.at;
    visit.endedReason = "exit";
    b.forgetSession(sessionId);
    const after = await a.resolveSession(request(t));
    assert.deepEqual([after?.hotelId, after?.visit], ["", undefined], "A sees the exit at once: back in the console, no hotel");
  });

  test("ten concurrent touches of one session make one UPDATE; endedReason costs one read with no BEGIN", async () => {
    const world = await buildWorld();
    const clock = world.clock;
    const { unit, stats } = counting(world);
    const resolver = createSessionResolver({ unit, catalog: world.catalog, now: () => new Date(clock.at.getTime()) });
    const t = token();
    await world.mem.unit.run((r) => r.sessions.insert({ userId: world.users.staff.id, hotelId: HOTEL, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: clock.at, lastSeenAt: null, expiresAt: new Date(clock.at.getTime() + 120 * 60_000) }));
    const s = (await resolver.resolveSession(request(t)))!;
    clock.at = new Date(clock.at.getTime() + 61 * 60_000);
    await Promise.all(Array.from({ length: 10 }, () => resolver.touchSession(s)));
    assert.equal(stats.updates, 1, "the cached copy is marked before the write, so the burst writes once");
    assert.ok(s.expiresAt && s.expiresAt.getTime() < (await resolver.resolveSession(request(t)))!.expiresAt!.getTime(), "the session already answered keeps its old expiry; the next request has the new one");

    stats.via.length = 0;
    await world.mem.unit.run((r) => r.sessions.revokeById(s.sessionId, "replaced", clock.at));
    assert.equal(await resolver.endedReason(request(t)), "SESSION_REPLACED");
    assert.deepEqual(stats.via, ["read"], "endedReason is one read, no transaction");
  });

  test("getSession gives the same answer with the resolver's access record as without it", async () => {
    const world = await buildWorld();
    const t = token();
    await world.mem.unit.run((r) => r.sessions.insert({ userId: world.users.anita.id, hotelId: HOTEL, client: "web", tokenHash: hashSessionToken(t), deviceLabel: null, userAgent: null, ip: null, issuedAt: world.clock.at, lastSeenAt: null, expiresAt: new Date(world.clock.at.getTime() + 120 * 60_000) }));
    const s = (await world.resolver.resolveSession(request(t)))!;
    const access = world.resolver.accessOf(s);
    assert.ok(access && access.user.id === world.users.anita.id);
    assert.deepEqual(await world.service.getSession(s, access), await world.service.getSession(s));
  });
});
