// The PostgreSQL sign-in repositories (repos/postgres/auth.ts) on the REAL instance, as hms_app, through the same PlatformUnit the app uses. The
// in-memory double (repos/memory/auth.ts) is held to the same rules by tests/server/auth.*.test.ts; the scenarios here are the ones only the
// database can prove: CHECKs and UNIQUE indexes turning into RepoError, row locks, the claim queue, counters, role folding in SQL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { newId } from "../../src/server/db/ids";
import { createPgAdminPlatformUnit } from "../../src/server/repos/postgres/adminPlatform";
import { createPgPlatformUnit, createPgRateLimitStore } from "../../src/server/repos/postgres/auth";
import { RepoError } from "../../src/server/repos/types";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { appUrl, connectOwner, tag, lockTestDatabase } from "./helpers/realDb";

let owner: DbClient;
let pool: SharedPool;
let unit: PlatformUnit;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const hex64 = (): string => randomBytes(32).toString("hex");
const NOW = new Date("2026-03-04T10:00:00.000Z");
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

before(async () => {
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 10 });
  unit = createPgPlatformUnit(pool);
});

after(async () => {
  await pool.end();
  await owner.end();
});

const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);

async function makeUser(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = { id: newId(), username: `u${tag()}${tag()}`, display_name: "Test Person", password_hash: HASH, role_id: await roleId("viewer"), account_role: "hotel_user", ...over };
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify(row)]);
  return String(row.id);
}
const makeHotel = async (name = "Repo Hotel"): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ($1, $2) RETURNING id", [name, `r-${tag()}${tag()}`])).rows[0].id);
const attach = (userId: string, hotelId: string, over: { role?: string | null; isDefault?: boolean; status?: string; subject?: { id: string; kind: string } } = {}) =>
  owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id, is_default, status, subject_id, subject_kind) VALUES ($1, $2, $3, $4, $5, $6, $7)", [userId, hotelId, over.role ?? null, over.isDefault ?? false, over.status ?? "active", over.subject?.id ?? null, over.subject?.kind ?? null]);

describe("users", () => {
  test("by username and email only while live; by id always; the record round-trips with its dates", async () => {
    const email = `a${tag()}@example.test`;
    const id = await makeUser({ email, locked_until: "2026-03-04T11:00:00Z", failed_attempts: 3 });
    const user = await unit.run((r) => r.users.byId(id));
    assert.ok(user);
    assert.equal(user.email, email);
    assert.equal(user.failedAttempts, 3);
    assert.equal(user.lockedUntil?.toISOString(), "2026-03-04T11:00:00.000Z");
    assert.equal((await unit.run((r) => r.users.byUsername(user.username)))?.id, id);
    assert.equal((await unit.run((r) => r.users.byEmail(email)))?.id, id);
    await owner.query("UPDATE platform.logins SET deleted_at = now() WHERE id = $1", [id]);
    assert.equal(await unit.run((r) => r.users.byUsername(user.username)), null);
    assert.equal(await unit.run((r) => r.users.byEmail(email)), null);
    assert.ok(await unit.run((r) => r.users.byId(id)), "by id still finds a deleted account");
  });

  test("update changes only what is given; a CHECK or UNIQUE rule becomes a RepoError; an unknown field is refused", async () => {
    const id = await makeUser();
    await unit.run((r) => r.users.update(id, { failedAttempts: 2, lockLevel: 1, lockedUntil: minutes(15), mustChangePassword: true }));
    const user = await unit.run((r) => r.users.byId(id));
    assert.deepEqual([user?.failedAttempts, user?.lockLevel, user?.mustChangePassword, user?.lockedUntil?.toISOString()], [2, 1, true, minutes(15).toISOString()]);
    await assert.rejects(() => unit.run((r) => r.users.update(id, { blockedAt: NOW })), (e) => e instanceof RepoError && e.kind === "check" && e.message === "users_blocked_pair");
    await assert.rejects(() => unit.run((r) => r.users.update(id, { lockLevel: 9 })), (e) => e instanceof RepoError && e.kind === "check");
    const other = await makeUser();
    await assert.rejects(() => unit.run((r) => r.users.update(other, { username: user?.username })), (e) => e instanceof RepoError && e.kind === "unique" && e.message === "users_username_key");
    await assert.rejects(() => unit.run((r) => r.users.update(id, { nope: 1 } as never)), /Not an updatable field/);
    await assert.rejects(() => unit.run((r) => r.users.update(newId(), { failedAttempts: 1 })), (e) => e instanceof RepoError);
  });

  test("a failed unit rolls everything back", async () => {
    const id = await makeUser();
    await assert.rejects(() => unit.run(async (r) => { await r.users.update(id, { failedAttempts: 4 }); throw new Error("boom"); }), /boom/);
    assert.equal((await unit.run((r) => r.users.byId(id)))?.failedAttempts, 0);
  });

  test("FOR UPDATE: two wrong passwords at once never lose a count", async () => {
    const id = await makeUser();
    const bump = () => unit.run(async (r) => {
      const u = await r.users.byId(id, { forUpdate: true });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await r.users.update(id, { failedAttempts: (u?.failedAttempts ?? 0) + 1 });
    });
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    assert.equal((await unit.run((r) => r.users.byId(id)))?.failedAttempts, 5);
  });
});

describe("codes", () => {
  test("one live code per person and purpose: a new one marks the old one used; attempts have a ceiling", async () => {
    const id = await makeUser();
    const first = await unit.run((r) => r.codes.replace({ purpose: "login", userId: id, codeHash: hex64(), expiresAt: minutes(10), lastSentAt: NOW }, NOW));
    const second = await unit.run((r) => r.codes.replace({ purpose: "login", userId: id, codeHash: hex64(), expiresAt: minutes(10), lastSentAt: NOW }, minutes(1)));
    assert.equal((await unit.run((r) => r.codes.byId(first.id)))?.usedAt?.toISOString(), minutes(1).toISOString());
    assert.equal((await unit.run((r) => r.codes.byId(second.id)))?.usedAt, null);
    const reset = await unit.run((r) => r.codes.replace({ purpose: "reset", userId: id, codeHash: hex64(), expiresAt: minutes(10), lastSentAt: NOW }, NOW));
    assert.equal((await unit.run((r) => r.codes.byId(reset.id)))?.usedAt, null, "the other purpose is separate");
    await unit.run((r) => r.codes.update(second.id, { attempts: 3, resendCount: 1, lastSentAt: minutes(2) }));
    const back = await unit.run((r) => r.codes.byId(second.id));
    assert.deepEqual([back?.attempts, back?.resendCount, back?.lastSentAt.toISOString()], [3, 1, minutes(2).toISOString()]);
    await assert.rejects(() => unit.run((r) => r.codes.update(second.id, { attempts: 11 })), (e) => e instanceof RepoError && e.kind === "check");
    await assert.rejects(() => unit.run((r) => r.codes.replace({ purpose: "login", userId: id, codeHash: hex64(), expiresAt: NOW, lastSentAt: NOW }, NOW)), (e) => e instanceof RepoError && e.message === "auth_codes_expiry_after_creation");
  });
});

describe("sessions", () => {
  const web = (userId: string, over: Record<string, unknown> = {}) => ({
    userId, hotelId: null, client: "web" as const, tokenHash: hex64(), deviceLabel: null, userAgent: "Test/1.0", ip: "203.0.113.7",
    issuedAt: NOW, lastSeenAt: NOW, expiresAt: minutes(60), ...over,
  });

  test("insert and read back (address as text), one active web session per person, token hash unique", async () => {
    const id = await makeUser();
    const s = await unit.run((r) => r.sessions.insert(web(id)));
    assert.equal(s.ip, "203.0.113.7");
    assert.equal((await unit.run((r) => r.sessions.byTokenHash(s.tokenHash)))?.id, s.id);
    await assert.rejects(() => unit.run((r) => r.sessions.insert(web(id))), (e) => e instanceof RepoError && e.kind === "unique" && e.message === "sessions_one_active_web_per_user_key");
    const other = await makeUser();
    await assert.rejects(() => unit.run((r) => r.sessions.insert(web(other, { tokenHash: s.tokenHash }))), (e) => e instanceof RepoError && e.message === "sessions_token_hash_key");
    await unit.run((r) => r.sessions.revokeById(s.id, "logout", minutes(5)));
    assert.equal((await unit.run((r) => r.sessions.byTokenHash(s.tokenHash)))?.revokedReason, "logout");
    await unit.run((r) => r.sessions.insert(web(id)));
  });

  test("the idle window is enforced by the table; a session of any other kind than web is refused (HMS has no phone app, migration 0111)", async () => {
    const id = await makeUser();
    await assert.rejects(() => unit.run((r) => r.sessions.insert(web(id, { expiresAt: minutes(121) }))), (e) => e instanceof RepoError && e.kind === "check");
    await assert.rejects(() => unit.run((r) => r.sessions.insert(web(id, { client: "mobile" }))), (e) => e instanceof RepoError && e.kind === "check");
    const ok = await unit.run((r) => r.sessions.insert(web(id, { expiresAt: minutes(120) })));
    assert.equal(ok.client, "web");
    assert.equal("deviceId" in ok, false);
  });

  test("activity moves the expiry forward together with last-seen; revoke others, revoke active, list active", async () => {
    const id = await makeUser();
    const w = await unit.run((r) => r.sessions.insert(web(id)));
    await unit.run((r) => r.sessions.update(w.id, { lastSeenAt: minutes(30), expiresAt: minutes(150) }));
    assert.equal((await unit.run((r) => r.sessions.byTokenHash(w.tokenHash)))?.expiresAt.toISOString(), minutes(150).toISOString());
    await assert.rejects(() => unit.run((r) => r.sessions.update(w.id, { expiresAt: minutes(200) })), (e) => e instanceof RepoError && e.kind === "check");
    const active = await unit.run((r) => r.sessions.listActive(id, minutes(10)));
    assert.deepEqual(active.map((s) => s.id), [w.id]);
    assert.equal(await unit.run((r) => r.sessions.revokeOthers(id, w.id, "password_changed", minutes(12))), 0, "the one session is the one in use");
    assert.equal(await unit.run((r) => r.sessions.revokeActive(id, "blocked", minutes(14))), 1);
    assert.equal((await unit.run((r) => r.sessions.listActive(id, minutes(15)))).length, 0);
    assert.equal((await unit.run((r) => r.sessions.byTokenHash(w.tokenHash)))?.revokedReason, "blocked");
  });
});

describe("outbox", () => {
  test("enqueue, claim the due rows once each (parallel workers never share a row), finish: the payload goes when the mail is sent or lost", async () => {
    await owner.query("DELETE FROM platform.outbox");
    const uid = await makeUser();
    for (let i = 0; i < 6; i++) await unit.run((r) => r.outbox.enqueue({ userId: uid, kind: "login_code", toEmail: `m${i}@example.test`, template: "login-code", payload: JSON.stringify({ code: "123456", i }) }, minutes(i)));
    const [a, b] = await Promise.all([unit.run((r) => r.outbox.claimDue(minutes(10), 4)), unit.run((r) => r.outbox.claimDue(minutes(10), 4))]);
    const ids = [...a, ...b].map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, "no row claimed twice");
    assert.equal(ids.length, 6);
    assert.ok([...a, ...b].every((o) => o.status === "sending" && o.payload !== null));
    assert.equal((await unit.run((r) => r.outbox.claimDue(minutes(10), 4))).length, 0);
    await unit.run((r) => r.outbox.finish(a[0].id, { status: "sent", attempts: 1, sentAt: minutes(11) }));
    await unit.run((r) => r.outbox.finish(a[1].id, { status: "pending", attempts: 1, nextAttemptAt: minutes(20) }));
    await unit.run((r) => r.outbox.finish(a[2].id, { status: "failed", attempts: 5 }));
    const rows = await owner.query("SELECT id, status, payload, attempts, next_attempt_at, sent_at FROM platform.outbox WHERE id = ANY($1::uuid[])", [[a[0].id, a[1].id, a[2].id]]);
    const by = new Map(rows.rows.map((r) => [String(r.id), r]));
    assert.deepEqual([by.get(a[0].id)?.status, by.get(a[0].id)?.payload], ["sent", null]);
    assert.equal(by.get(a[0].id)?.sent_at instanceof Date, true);
    assert.deepEqual([by.get(a[1].id)?.status, by.get(a[1].id)?.payload === null], ["pending", false], "a retry keeps its payload");
    assert.deepEqual([by.get(a[2].id)?.status, by.get(a[2].id)?.payload], ["failed", null]);
    assert.equal((await unit.run((r) => r.outbox.claimDue(minutes(30), 10))).length, 1, "the pending retry comes due later");
  });

  test("a server that stopped while sending: the row is never sent again, and after ten minutes it is closed as failed with its code removed", async () => {
    await owner.query("DELETE FROM platform.outbox");
    const uid = await makeUser();
    const stuck = (minutesAgo: number) =>
      owner.query("INSERT INTO platform.outbox (user_id, kind, to_email, template, payload, status, attempts, updated_at) VALUES ($1, 'login_code', 'x@example.test', 'login-code', '{\"code\":\"123456\"}', 'sending', 1, now() - make_interval(mins => $2)) RETURNING id", [uid, minutesAgo]);
    const old = String((await stuck(30)).rows[0].id);
    const fresh = String((await stuck(2)).rows[0].id);
    assert.equal((await unit.run((r) => r.outbox.claimDue(new Date(), 10))).length, 0, "nothing in 'sending' is ever claimed again");
    const rows = await owner.query("SELECT id, status, payload FROM platform.outbox WHERE id = ANY($1::uuid[])", [[old, fresh]]);
    const by = new Map(rows.rows.map((r) => [String(r.id), r]));
    assert.deepEqual([by.get(old)?.status, by.get(old)?.payload], ["failed", null]);
    assert.deepEqual([by.get(fresh)?.status, by.get(fresh)?.payload === null], ["sending", false], "a recent one may still be going out");
  });
});

describe("events and audit", () => {
  test("an auth event and an audit row are written with their address, detail and moment", async () => {
    const uid = await makeUser();
    const hid = await makeHotel();
    await unit.run(async (r) => {
      await r.events.event({ userId: uid, hotelId: hid, event: "login_success", ip: "198.51.100.4", userAgent: "UA", detail: { level: 2 }, at: NOW });
      await r.events.event({ userId: null, hotelId: null, event: "login_failed", ip: null, userAgent: null, detail: null, at: NOW });
      await r.events.audit({ actorUserId: uid, hotelId: hid, action: "user.test", entity: "user", entityId: uid, traceId: "trace-12345678", at: NOW });
    });
    const ev = await owner.query("SELECT event, host(ip) AS ip, detail FROM platform.auth_events WHERE user_id = $1", [uid]);
    assert.deepEqual(ev.rows, [{ event: "login_success", ip: "198.51.100.4", detail: { level: 2 } }]);
    const au = await owner.query("SELECT action, entity_id::text AS e, trace_id FROM platform.audit_log WHERE actor_user_id = $1", [uid]);
    assert.deepEqual(au.rows, [{ action: "user.test", e: uid, trace_id: "trace-12345678" }]);
  });
});

describe("access: the person's role, grants (own plus inherited), overrides and scope in one hotel", () => {
  async function ladderHotel() {
    const hid = await makeHotel("Access Hotel");
    const editor = await roleId("editor");
    const viewer = await roleId("viewer");
    const perm = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.permissions WHERE key = $1", [key])).rows[0].id);
    return { hid, editor, viewer, perm };
  }

  test("default hotel first, an explicit hotel on request, the role of the attachment over the person's own, grants folded down the ladder", async () => {
    const { hid, editor, viewer } = await ladderHotel();
    const other = await makeHotel("Other Hotel");
    const uid = await makeUser({ role_id: viewer });
    await attach(uid, other, { isDefault: false });
    await attach(uid, hid, { role: editor, isDefault: true });
    const access = await unit.run((r) => r.access.load(uid, null));
    assert.equal(access?.hotel?.id, hid);
    assert.equal(access?.role.key, "editor");
    const keys = new Set((access?.grants ?? []).map((g) => `${g.key}:${g.level}`));
    assert.ok(keys.size > 0);
    const viewerOnly = await unit.run((r) => r.access.load(uid, other));
    assert.equal(viewerOnly?.role.key, "viewer", "no role on the attachment: the person's own role");
    assert.ok((access?.grants.length ?? 0) >= (viewerOnly?.grants.length ?? 0), "an editor holds what a viewer holds, and more");
    const notMine = await makeHotel("Not Mine");
    assert.equal(await unit.run((r) => r.access.load(uid, notMine)), null);
    assert.equal(await unit.run((r) => r.access.load(newId(), null)), null);
  });

  test("a disabled attachment and a deleted person are not there; a person with no hotel still loads (no hotel, own role)", async () => {
    const { hid, viewer } = await ladderHotel();
    const uid = await makeUser({ role_id: viewer });
    await attach(uid, hid, { status: "disabled", isDefault: true });
    assert.equal(await unit.run((r) => r.access.load(uid, hid)), null);
    const none = await unit.run((r) => r.access.load(uid, null));
    assert.equal(none?.hotel, null);
    assert.equal(none?.role.key, "viewer");
    await owner.query("UPDATE platform.logins SET deleted_at = now() WHERE id = $1", [uid]);
    assert.equal(await unit.run((r) => r.access.load(uid, null)), null);
  });

  test("the person's own grants and revokes in this hotel only, the record scope of a guest, the hotel's group", async () => {
    const { hid, viewer, perm } = await ladderHotel();
    const uid = await makeUser({ role_id: viewer });
    const stranger = await makeHotel("Elsewhere");
    await attach(uid, hid, { isDefault: true, subject: { id: newId(), kind: "guest" } });
    await attach(uid, stranger);
    await owner.query("INSERT INTO platform.user_permissions (user_id, hotel_id, permission_id, level, granted) VALUES ($1, $2, $3, 'edit', true), ($1, $2, $4, 'view', false), ($1, $5, $3, 'full', true)", [uid, hid, await perm("payroll"), await perm("revenue"), stranger]);
    const group = String((await owner.query("INSERT INTO platform.hotel_groups (name, slug) VALUES ('Group One', $1) RETURNING id", [`g-${tag()}`])).rows[0].id);
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [group, hid]);
    const access = await unit.run((r) => r.access.load(uid, hid));
    assert.deepEqual([...(access?.overrides ?? [])].sort((a, b) => a.key.localeCompare(b.key)), [{ key: "payroll", level: "edit", granted: true }, { key: "revenue", level: "view", granted: false }]);
    assert.equal(access?.scope?.kind, "guest");
    assert.deepEqual(access?.hotel?.group, { id: group, name: "Group One" });
    assert.equal((await unit.run((r) => r.access.load(uid, stranger)))?.overrides.length, 1);
  });
});

describe("rate limits (platform.rate_limits)", () => {
  const key = Buffer.from(randomBytes(32));

  test("fixed windows: one upsert counts, 20 parallel hits are 20, a new window starts again, reset forgets, the stored key is a hash", async () => {
    let clock = Date.UTC(2026, 2, 4, 10, 0, 0);
    const store = createPgRateLimitStore(pool, key, () => clock);
    const name = `login|${tag()}`;
    const hits = await Promise.all(Array.from({ length: 20 }, () => store.hit(name, 60)));
    assert.deepEqual(hits.map((h) => h.count).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(hits[0].resetInSeconds, 60);
    assert.equal(await store.peek(name, 60), 20);
    clock += 61_000;
    assert.equal(await store.peek(name, 60), 0);
    assert.equal((await store.hit(name, 60)).count, 1);
    const stored = await owner.query("SELECT key_hash FROM platform.rate_limits ORDER BY window_start DESC LIMIT 1");
    assert.match(String(stored.rows[0].key_hash), /^[0-9a-f]{64}$/);
    await store.reset(name);
    assert.equal(await store.peek(name, 60), 0);
  });
});

describe("the person's own preferences (platform.users.ui_theme)", () => {
  test("none until chosen; set, change and clear; only light or dark is accepted; other people are untouched", async () => {
    const prefs = createPgAdminPlatformUnit(pool);
    const me = await makeUser();
    const other = await makeUser();
    assert.deepEqual(await prefs.run((r) => r.preferences.get(me)), { uiTheme: null });
    assert.deepEqual(await prefs.run((r) => r.preferences.set(me, { uiTheme: "dark" })), { uiTheme: "dark" });
    assert.deepEqual(await prefs.run((r) => r.preferences.get(me)), { uiTheme: "dark" });
    assert.deepEqual(await prefs.run((r) => r.preferences.set(me, { uiTheme: "light" })), { uiTheme: "light" });
    assert.deepEqual(await prefs.run((r) => r.preferences.get(other)), { uiTheme: null });
    assert.deepEqual(await prefs.run((r) => r.preferences.set(me, {})), { uiTheme: "light" }, "an empty patch changes nothing");
    assert.deepEqual(await prefs.run((r) => r.preferences.set(me, { uiTheme: null })), { uiTheme: null });
    await assert.rejects(() => prefs.run((r) => r.preferences.set(me, { uiTheme: "purple" as never })), (e) => e instanceof RepoError && e.kind === "check");
    assert.deepEqual(await prefs.run((r) => r.preferences.get(newId())), { uiTheme: null }, "an unknown person has no choice");
  });
});

after(async () => {
  await releaseTestLock?.();
});

describe("outbox kinds added later (migrations 0109 and 0112)", () => {
  test("the website enquiry mails are accepted without an account behind them (they name their hotel); an unknown kind is refused, by the app and by the table", async () => {
    const hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Enquiry Hotel', $1) RETURNING id", [`e-${tag()}${tag()}`])).rows[0].id);
    for (const kind of ["enquiry_confirmed", "enquiry_declined", "invitation"] as const) {
      await unit.run((r) => r.outbox.enqueue({ userId: null, hotelId: kind === "invitation" ? null : hotelId, kind, toEmail: `${kind}@example.test`, template: kind.replace(/_/g, "-"), payload: JSON.stringify({ name: "Asha" }) }, minutes(0)));
    }
    await assert.rejects(() => unit.run((r) => r.outbox.enqueue({ userId: null, kind: "spam" as never, toEmail: "x@example.test", template: "spam", payload: "{}" }, minutes(0))), (e: unknown) => (e as Error).name === "MailRouteError");
    await assert.rejects(() => owner.query("INSERT INTO platform.outbox (kind, to_email, template, payload) VALUES ('spam', 'x@example.test', 'spam', '{}')"), "the table refuses an unknown kind too");
  });
});

describe("outbox: mail routing and why a mail failed (migration 0124)", () => {
  test("a hotel kind needs its hotel and a platform kind has none (the app refuses first, the database holds the invoice kinds); the reason of a failure is kept as a code and cleared by a success; the newest result of a hotel is asked for", async () => {
    await owner.query("DELETE FROM platform.outbox");
    const hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Mail Hotel', $1) RETURNING id", [`m-${tag()}${tag()}`])).rows[0].id);
    const queue = (kind: string, hotel: string | null) => unit.run((r) => r.outbox.enqueue({ userId: null, hotelId: hotel, kind: kind as never, toEmail: "g@example.test", template: kind.replace(/_/g, "-"), payload: JSON.stringify({ name: "G", billId: "b1" }) }, minutes(0)));
    await assert.rejects(() => queue("bill_invoice", null), (e: unknown) => (e as Error).name === "MailRouteError");
    await assert.rejects(() => queue("login_code", hotelId), (e: unknown) => (e as Error).name === "MailRouteError");
    await assert.rejects(() => owner.query("INSERT INTO platform.outbox (kind, to_email, template, payload) VALUES ('bill_invoice', 'g@example.test', 'bill-invoice', '{}')"), "the database also refuses an invoice with no hotel");
    await queue("bill_invoice", hotelId);
    await queue("advance_receipt", hotelId);
    // both are due at the same moment, so the claim order between them is the ids' order (uuidv7 made in two transactions): pick each by its kind
    const claimed = await unit.run((r) => r.outbox.claimDue(minutes(1), 10));
    assert.equal(claimed.length, 2);
    const first = claimed.find((m) => m.kind === "bill_invoice")!;
    const second = claimed.find((m) => m.kind === "advance_receipt")!;
    assert.deepEqual([first.kind, first.hotelId, first.lastError], ["bill_invoice", hotelId, null]);
    assert.equal(await unit.run((r) => r.outbox.lastFailure(hotelId)), null, "nothing failed yet");
    await unit.run((r) => r.outbox.finish(first.id, { status: "pending", attempts: 1, nextAttemptAt: minutes(5), error: "AUTH" }));
    assert.equal((await unit.run((r) => r.outbox.lastFailure(hotelId)))?.code, "AUTH");
    const otherId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Other', $1) RETURNING id", [`o-${tag()}${tag()}`])).rows[0].id);
    assert.equal(await unit.run((r) => r.outbox.lastFailure(otherId)), null, "another hotel sees nothing");
    await owner.query("UPDATE platform.outbox SET last_error = 'lowercase' WHERE id = $1", [first.id]).then(() => assert.fail("the code shape is checked"), () => undefined);
    // the second mail goes: the newest result of the hotel is a success, so no failure is shown
    await new Promise((r) => setTimeout(r, 15));
    await unit.run((r) => r.outbox.finish(second.id, { status: "sent", attempts: 1, sentAt: minutes(6) }));
    assert.equal(await unit.run((r) => r.outbox.lastFailure(hotelId)), null);
    const [retry] = await unit.run((r) => r.outbox.claimDue(minutes(10), 10));
    await new Promise((r) => setTimeout(r, 15));
    await unit.run((r) => r.outbox.finish(retry.id, { status: "failed", attempts: 5, error: "CONNECT" }));
    assert.equal((await unit.run((r) => r.outbox.lastFailure(hotelId)))?.code, "CONNECT");
    assert.equal((await owner.query("SELECT payload, last_error FROM platform.outbox WHERE id = $1", [retry.id])).rows[0].payload, null, "a mail given up keeps no payload");
  });
});

describe("outbox lanes, daily counts, caps and sender identities (migrations 0126 and 0128)", () => {
  const ready = async (): Promise<boolean> => (await owner.query("SELECT to_regclass('platform.mail_send_counts') IS NOT NULL AND to_regclass('platform.sender_identities') IS NOT NULL AS ok")).rows[0].ok === true;

  test("the system lane is claimed apart from campaign mail and campaign mail per hotel; counts add up by owner and day; a cap is set and removed", async (t) => {
    if (!(await ready())) return t.skip("hms_test is not at 0126 / 0128 yet");
    await owner.query("DELETE FROM platform.outbox");
    const hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Lane Hotel', $1) RETURNING id", [`l-${tag()}${tag()}`])).rows[0].id);
    const queue = (kind: string, hotel: string | null) => unit.run((r) => r.outbox.enqueue({ userId: null, hotelId: hotel, kind: kind as never, toEmail: "g@example.test", template: kind, payload: JSON.stringify({ name: "G", subject: "S", text: "t" }) }, minutes(0)));
    for (let i = 0; i < 3; i += 1) await queue("campaign", hotelId);
    await queue("login_code", null);
    assert.deepEqual(await unit.run((r) => r.outbox.bulkHotels(minutes(1))), [hotelId]);
    const system = await unit.run((r) => r.outbox.claimLane(minutes(1), "system", 10));
    assert.deepEqual(system.map((x) => x.kind), ["login_code"]);
    const bulk = await unit.run((r) => r.outbox.claimLane(minutes(1), "bulk", 2, hotelId));
    assert.deepEqual([bulk.length, bulk.every((x) => x.kind === "campaign" && x.hotelId === hotelId)], [2, true]);
    assert.equal((await unit.run((r) => r.outbox.claimLane(minutes(1), "bulk", 10, randomUUIDLike()))).length, 0, "another hotel's lane is empty");
    await unit.run((r) => r.outbox.addSent([{ scope: hotelId, day: "2026-03-04", sent: 2 }, { scope: "platform", day: "2026-03-04", sent: 1 }]));
    await unit.run((r) => r.outbox.addSent([{ scope: hotelId, day: "2026-03-04", sent: 3 }, { scope: hotelId, day: "2026-03-05", sent: 4 }]));
    assert.deepEqual([...(await unit.run((r) => r.outbox.sentToday([hotelId, "platform"], "2026-03-04"))).entries()].sort(), [[hotelId, 5], ["platform", 1]].sort());
    assert.equal((await unit.run((r) => r.outbox.usage("2026-03-01", "2026-04-01", [hotelId]))).get(hotelId), 9);
    await owner.query("INSERT INTO platform.mail_send_counts (scope, day, sent) VALUES ('not-a-scope', '2026-03-04', 1)").then(() => assert.fail("the owner shape is checked"), () => undefined);
    assert.equal(await unit.run((r) => r.outbox.setCap(hotelId, 250)), true);
    assert.equal((await unit.run((r) => r.outbox.caps([hotelId]))).get(hotelId), 250);
    await unit.run((r) => r.outbox.setCap(hotelId, null));
    assert.equal((await unit.run((r) => r.outbox.caps([hotelId]))).size, 0);
    await owner.query("DELETE FROM platform.mail_send_counts WHERE scope IN ($1, 'platform') AND day BETWEEN '2026-03-01' AND '2026-03-31'", [hotelId]);
  });

  test("a sender identity: one for the platform and one per hotel; a new domain starts again; the DKIM names must be three; removed with the hotel's choice", async (t) => {
    if (!(await ready())) return t.skip("hms_test is not at 0126 / 0128 yet");
    await owner.query("DELETE FROM platform.sender_identities");
    const hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Domain Hotel', $1) RETURNING id", [`d-${tag()}${tag()}`])).rows[0].id);
    const tokens = ["abcdefghijk1", "abcdefghijk2", "abcdefghijk3"];
    const p = await unit.run((r) => r.identities.save("platform", { domain: "mail.example.test" }));
    assert.deepEqual([p?.scope, p?.status, p?.dkimTokens], ["platform", "pending", []]);
    const h = await unit.run((r) => r.identities.save(hotelId, { domain: "grandhotel.test", fromAddress: "front@grandhotel.test", dkimTokens: tokens, sesConfirmed: true }));
    assert.deepEqual([h?.scope, h?.fromAddress, h?.dkimTokens, h?.sesConfirmed], [hotelId, "front@grandhotel.test", tokens, true]);
    const checked = await unit.run((r) => r.identities.save(hotelId, { status: "verified", checkedAt: minutes(1), result: { at: minutes(1).toISOString(), requiredOk: true, records: [{ id: "dkim1", state: "ok" }] } }));
    assert.deepEqual([checked?.status, checked?.result?.requiredOk, checked?.checkedAt?.toISOString()], ["verified", true, minutes(1).toISOString()]);
    const moved = await unit.run((r) => r.identities.save(hotelId, { domain: "other.test", fromAddress: "front@other.test" }));
    assert.deepEqual([moved?.domain, moved?.dkimTokens, moved?.sesConfirmed, moved?.status, moved?.result], ["other.test", [], false, "pending", null], "a new domain starts again");
    assert.deepEqual((await unit.run((r) => r.identities.list())).map((x) => x.scope), ["platform", hotelId]);
    await owner.query("UPDATE platform.sender_identities SET dkim_tokens = '{a,b}' WHERE hotel_id = $1", [hotelId]).then(() => assert.fail("three DKIM names or none"), () => undefined);
    await owner.query("INSERT INTO platform.sender_identities (domain) VALUES ('second.platform.test')").then(() => assert.fail("one platform identity"), () => undefined);
    await unit.run((r) => r.identities.remove(hotelId));
    await unit.run((r) => r.identities.remove("platform"));
    assert.deepEqual(await unit.run((r) => r.identities.list()), []);
  });
});

/** A UUID that names no hotel. */
function randomUUIDLike(): string {
  const h = randomBytes(16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}