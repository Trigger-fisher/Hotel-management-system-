// The Platform console repositories (repos/postgres/platformConsole.ts) on the REAL PostgreSQL instance, as hms_app, platform schema only:
// hotels and their lifecycle CHECKs, accounts, groups (one group per hotel, the unlink grant), the append-only history and audit tables.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import type { PlatformConsoleRepos, PlatformConsoleUnit } from "../../src/server/repos/platformConsole";
import { createPgPlatformConsoleUnit } from "../../src/server/repos/postgres/platformConsole";
import { RepoError } from "../../src/server/repos/types";
import { removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let unit: PlatformConsoleUnit;
let actor: string;
const run = <T>(work: (r: PlatformConsoleRepos) => Promise<T>): Promise<T> => unit.run(work);
const NOW = new Date("2026-10-05T10:00:00.000Z");
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);
const hotel = async (name: string): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ($1, $2) RETURNING id", [name, `p-${tag()}${tag()}`])).rows[0].id);
const newAccount = (over: Partial<{ roleKey: string; accountRole: "hotel_admin" | "platform_admin"; hotelId: string | null }> = {}) => {
  const t = tag() + tag();
  return { username: `u${t}`, email: `${t}@example.test`, mobile: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, displayName: `Person ${t}`, accountRole: over.accountRole ?? ("hotel_admin" as const), roleKey: over.roleKey ?? "admin", hotelId: over.hotelId ?? null };
};

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  unit = createPgPlatformConsoleUnit(pool);
  actor = randomUUID();
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Actor Platform', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'platform_admin', 'code_required', true)) AS id", [actor, `act${tag()}`, HASH, await roleId("admin")]);
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("hotels", () => {
  test("list and get show the platform facts and the admin counts; the lifecycle CHECKs hold; the history is append-only", async () => {
    const id = await hotel("Console Hotel");
    const acct = await run((r) => r.accounts.create(newAccount({ hotelId: id, roleKey: "super_admin" }), actor, NOW));
    const row = await run((r) => r.hotels.get(id, NOW));
    assert.ok(row);
    assert.deepEqual([row.name, row.status, row.adminCount, row.lockedAdminCount, row.groupId], ["Console Hotel", "active", 1, 0, null]);
    assert.ok((await run((r) => r.hotels.list({ words: ["console", "hotel"] }, NOW))).some((h) => h.id === id));
    assert.equal((await run((r) => r.hotels.list({ words: ["zzzz-no-such"] }, NOW))).length, 0);
    assert.equal(await run((r) => r.hotels.slugTaken(row.slug)), true);
    assert.equal(await run((r) => r.hotels.slugTaken("not-a-slug-yet")), false);
    assert.equal(await run((r) => r.hotels.defaultGstPercent()), 5);
    assert.deepEqual(Object.keys(await run((r) => r.hotels.invitationCounts(NOW))).sort(), ["groupsWaiting", "open"]);

    // suspend, then archive with its grace period, then restore: each move + its history row in one unit
    await run(async (r) => {
      await r.hotels.setLifecycle(id, { status: "suspended", suspendedAt: NOW, suspendReason: "Unpaid" });
      await r.hotels.addStatusHistory({ hotelId: id, fromStatus: "active", toStatus: "suspended", changedBy: actor, actorRole: "platform_admin", reason: "Unpaid", traceId: "trace-0001", at: NOW });
    });
    assert.equal((await run((r) => r.hotels.get(id, NOW)))?.status, "suspended");
    const until = new Date(NOW.getTime() + 90 * 86_400_000);
    await run((r) => r.hotels.setLifecycle(id, { status: "archived", archivedAt: NOW, archiveReason: "Closed", restoreUntil: until, statusBeforeArchive: "suspended" }));
    const arch = await run((r) => r.hotels.get(id, NOW));
    assert.deepEqual([arch?.status, arch?.restoreUntil?.toISOString(), arch?.statusBeforeArchive], ["archived", until.toISOString(), "suspended"]);
    await run((r) => r.hotels.setLifecycle(id, { status: "suspended", archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null }));
    assert.equal((await run((r) => r.hotels.get(id, NOW)))?.status, "suspended");

    // the CHECKs of 0102: archived needs its dates, rejected needs a reason, suspended needs its time
    await assert.rejects(() => run((r) => r.hotels.setLifecycle(id, { status: "archived" })), (e) => e instanceof RepoError);
    await assert.rejects(() => run((r) => r.hotels.setLifecycle(id, { status: "rejected" })), (e) => e instanceof RepoError);
    // history: a change only, and no UPDATE / DELETE for anyone
    await assert.rejects(() => run((r) => r.hotels.addStatusHistory({ hotelId: id, fromStatus: "active", toStatus: "active", changedBy: actor, actorRole: "platform_admin", reason: null, traceId: null, at: NOW })), (e) => e instanceof RepoError);
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.hotel_status_history SET reason = 'x' WHERE hotel_id = $1", [id])), null);
    assert.notEqual(await sqlStateOf(app.query("DELETE FROM platform.hotel_status_history WHERE hotel_id = $1", [id])), null);
    assert.ok(acct);
  });

  test("the list leaves out hotels that are not listed in the console (deleted)", async () => {
    const id = await hotel("Gone Hotel");
    await owner.query("UPDATE platform.hotels SET status = 'deleted', deleted_at = now() WHERE id = $1", [id]);
    assert.equal(await run((r) => r.hotels.get(id, NOW)), null);
  });
});

describe("accounts", () => {
  test("create makes an invited account with an unusable password and its membership; the unique rules hold; status, unlock, super admin checks", async () => {
    const h = await hotel("Accounts Hotel");
    assert.equal(await run((r) => r.accounts.hotelHasSuperAdmin(h)), false);
    const f = newAccount({ hotelId: h, roleKey: "super_admin" });
    const id = await run((r) => r.accounts.create(f, actor, NOW));
    const row = (await owner.query("SELECT status, must_change_password, code_required, created_by, password_hash FROM platform.people WHERE id = $1", [id])).rows[0];
    assert.deepEqual([row.status, row.must_change_password, row.code_required, row.created_by], ["invited", true, false, actor]);
    assert.match(String(row.password_hash), /^\$argon2id\$/, "an unusable placeholder in the hash format until the temporary password is issued");
    assert.equal(await run((r) => r.accounts.hotelHasSuperAdmin(h)), true);
    assert.equal(await run((r) => r.accounts.usernameTaken(f.username)), true);
    assert.equal(await run((r) => r.accounts.emailTaken(f.email)), true);
    assert.equal(await run((r) => r.accounts.mobileTaken(f.mobile)), true);
    await assert.rejects(() => run((r) => r.accounts.create({ ...newAccount({ hotelId: h }), username: f.username }, actor, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    const got = await run((r) => r.accounts.get(id));
    assert.deepEqual([got?.accountRole, got?.hotelId, got?.hotelName, got?.status], ["hotel_admin", h, "Accounts Hotel", "invited"]);
    const listed = await run((r) => r.accounts.list({ words: [], accountRoles: ["hotel_admin"], hotelId: h }, NOW));
    assert.deepEqual(listed.map((a) => a.id), [id]);
    await run((r) => r.accounts.setStatus(id, "disabled", h));
    assert.equal((await run((r) => r.accounts.get(id)))?.status, "disabled");
    await run((r) => r.accounts.setStatus(id, "active", h));
    await owner.query("UPDATE platform.logins SET failed_attempts = 4, lock_level = 1, locked_until = now() + interval '1 hour' WHERE id = $1", [id]);
    await run((r) => r.accounts.unlock(id));
    const un = (await owner.query("SELECT failed_attempts, lock_level, locked_until FROM platform.people WHERE id = $1", [id])).rows[0];
    assert.deepEqual([un.failed_attempts, un.lock_level, un.locked_until], [0, 0, null]);
    assert.ok((await run((r) => r.accounts.activeSuperAdmins())) >= 0);
  });

  test("a platform staff account has no hotel", async () => {
    const id = await run((r) => r.accounts.create(newAccount({ accountRole: "platform_admin", roleKey: "admin" }), actor, NOW));
    const got = await run((r) => r.accounts.get(id));
    assert.deepEqual([got?.accountRole, got?.hotelId], ["platform_admin", null]);
  });
});

describe("groups", () => {
  test("create, link (one group per hotel), the group admin, unlink (hms_app may delete a membership), history", async () => {
    const h1 = await hotel("Member One");
    const h2 = await hotel("Member Two");
    const slug = `g-${tag()}${tag()}`;
    const name = `Group ${tag()}`;
    const g = await run((r) => r.groups.create({ name, slug }, NOW));
    assert.equal(await run((r) => r.groups.nameTaken(name.toUpperCase())), true, "case-insensitive");
    assert.equal(await run((r) => r.groups.slugTaken(slug)), true);
    await assert.rejects(() => run((r) => r.groups.create({ name, slug: `${slug}x` }, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    await run(async (r) => {
      await r.groups.link(g, h1, actor, NOW);
      await r.groups.addHistory({ groupId: g, event: "hotel_linked", fromStatus: null, toStatus: null, hotelId: h1, adminUserId: null, changedBy: actor, actorRole: "platform_admin", reason: null, traceId: null, at: NOW });
    });
    await assert.rejects(() => run(async (r) => r.groups.link((await r.groups.create({ name: `Other ${tag()}`, slug: `o-${tag()}${tag()}` }, NOW)), h1, actor, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.deepEqual(await run((r) => r.groups.groupOfHotel(h1)), { id: g, name });
    await run((r) => r.groups.link(g, h2, actor, NOW));
    const admin = await run((r) => r.accounts.create(newAccount({ hotelId: h1 }), actor, NOW));
    await run((r) => r.groups.setAdmin(g, admin));
    const row = await run((r) => r.groups.get(g));
    assert.deepEqual([row?.hotelIds.length, row?.admin?.id, row?.admin?.hotelId, row?.status], [2, admin, h1, "active"]);
    assert.equal((await run((r) => r.hotels.get(h1, NOW)))?.groupName, name);
    assert.equal(await run((r) => r.groups.unlink(g, h2)), true);
    assert.equal(await run((r) => r.groups.unlink(g, h2)), false);
    await run((r) => r.groups.setAdmin(g, null));
    assert.equal((await run((r) => r.groups.get(g)))?.admin, null);
    assert.ok((await run((r) => r.groups.list())).some((x) => x.id === g));
    assert.notEqual(await sqlStateOf(app.query("DELETE FROM platform.group_history WHERE group_id = $1", [g])), null, "history is append-only");
  });
});

describe("audit", () => {
  test("write is append-only; activity lists the successful rows about a hotel newest first and leaves failed ones out", async () => {
    const h = await hotel("Audit Hotel");
    const base = { actorUserId: actor, actorName: "Actor Platform", actorRole: "platform_admin" as const, entity: "hotel" as const, entityId: h, hotelId: h, groupId: null, targetLabel: "Audit Hotel", reason: null, before: null, after: null, ip: "10.0.0.7", userAgent: "node-test", traceId: "trace-1234" };
    await run(async (r) => {
      await r.audit.write({ ...base, action: "hotel_suspended", result: "success", reason: "Unpaid", at: new Date(NOW.getTime() + 1000) });
      await r.audit.write({ ...base, action: "hotel_reactivated", result: "success", at: new Date(NOW.getTime() + 2000) });
      await r.audit.write({ ...base, action: "hotel_archived", result: "failed", reason: "Only the Super Admin can do this.", at: new Date(NOW.getTime() + 3000) });
    });
    const page = await run((r) => r.audit.activity({ hotelId: h }, { offset: 0, limit: 10 }));
    assert.equal(page.total, 2);
    assert.deepEqual(page.rows.map((x) => x.action), ["hotel_reactivated", "hotel_suspended"]);
    assert.equal(page.rows[1].reason, "Unpaid");
    assert.equal(page.rows[0].hotelName, "Audit Hotel");
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.audit_log SET reason = 'x' WHERE hotel_id = $1", [h])), null);
    assert.notEqual(await sqlStateOf(app.query("DELETE FROM platform.audit_log WHERE hotel_id = $1", [h])), null);
  });

  test("a failing audit write rolls the whole unit back (no half change)", async () => {
    const h = await hotel("Rollback Hotel");
    await assert.rejects(() =>
      run(async (r) => {
        await r.hotels.setLifecycle(h, { status: "suspended", suspendedAt: NOW, suspendReason: "x" });
        await r.audit.write({ actorUserId: actor, actorName: "", actorRole: "platform_admin", action: "hotel_suspended", entity: "hotel", entityId: h, hotelId: h, groupId: null, targetLabel: null, reason: null, result: "success", before: null, after: null, ip: null, userAgent: null, traceId: null, at: NOW });
      }),
    );
    assert.equal((await run((r) => r.hotels.get(h, NOW)))?.status, "active");
  });
});

describe("visits (Enter hotel)", () => {
  const session = async (userId: string): Promise<string> => {
    const r = await owner.query("INSERT INTO platform.sessions (user_id, client, token_hash, expires_at) VALUES ($1, 'web', $2, now() + interval '2 hours') RETURNING id", [userId, createHash("sha256").update(randomUUID()).digest("hex")]);
    return String(r.rows[0].id);
  };
  const in60 = (): Date => new Date(Date.now() + 59 * 60_000);

  test("start, open, the session lookups, the audit link and end; the trigger and the unique index hold", async () => {
    const hotelId = await hotel("Visited Hotel");
    const sessionId = await session(actor);
    const start = (over: Partial<{ userId: string; hotelId: string; sessionId: string | null; reason: string; expiresAt: Date }> = {}) =>
      run((r) => r.visits.start({ userId: actor, hotelId, sessionId, reason: "Support ticket 4412", expiresAt: in60(), ip: "10.0.0.9", userAgent: "node-test", access: "view", ...over }, new Date()));
    const id = await start();
    const open = await run((r) => r.visits.open(actor));
    assert.deepEqual(open.map((v) => [v.id, v.hotelId, v.hotelName, v.sessionId, v.reason]), [[id, hotelId, "Visited Hotel", sessionId, "Support ticket 4412"]]);
    // one visit at a time (a unique index), a 60 minute ceiling, a live hotel, active platform staff
    await assert.rejects(() => start(), (e) => e instanceof RepoError && e.kind === "unique");
    await run((r) => r.visits.end(id, "replaced", actor, new Date()));
    await assert.rejects(() => start({ expiresAt: new Date(Date.now() + 61 * 60_000) }), (e) => e instanceof RepoError);
    const pending = String((await owner.query("INSERT INTO platform.hotels (name, slug, status, provisioned_at) VALUES ('Waiting Hotel', $1, 'pending_approval', NULL) RETURNING id", [`w-${tag()}${tag()}`])).rows[0].id);
    await assert.rejects(() => start({ hotelId: pending }), (e) => e instanceof RepoError, "a hotel that is not live cannot be entered");
    const staff = await run((r) => r.accounts.create(newAccount({ hotelId, roleKey: "admin" }), actor, new Date()));
    await assert.rejects(() => start({ userId: staff }), (e) => e instanceof RepoError, "a Hotel Admin is not platform staff");
    // the session resolver's two lookups, on the real SQL
    const visitId = await start();
    const seen = await run((r) => r.auth.visits.activeForSession(sessionId, new Date()));
    assert.deepEqual([seen?.id, seen?.hotelId, seen?.hotelName], [visitId, hotelId, "Visited Hotel"]);
    assert.equal(await run((r) => r.auth.visits.activeForSession(sessionId, new Date(Date.now() + 2 * 3_600_000))), null, "past its time");
    assert.equal(await run((r) => r.auth.visits.activeForSession(randomUUID(), new Date())), null);
    const inside = await run((r) => r.auth.access.loadVisit(actor, hotelId));
    assert.deepEqual([inside?.hotel?.id, inside?.role.key, inside?.role.level, inside?.overrides.length, inside?.scope], [hotelId, "super_admin", 4, 0, undefined]);
    assert.ok(inside?.grants.some((g) => g.key === "revenue"), "it holds the SuperAdmin grants");
    assert.equal(await run((r) => r.auth.access.loadVisit(actor, randomUUID())), null);
    // the audit row of a visit is stamped inside_hotel, and its id comes back
    const auditId = await run((r) => r.audit.write({ actorUserId: actor, actorName: "Actor Platform", actorRole: "platform_admin", action: "hotel_entered", entity: "hotel", entityId: hotelId, hotelId, groupId: null, targetLabel: "Visited Hotel", reason: "Support ticket 4412", result: "success", before: null, after: null, ip: null, userAgent: null, traceId: "trace-9876", at: new Date(), visitId }));
    const row = (await owner.query("SELECT inside_hotel, visit_id FROM platform.audit_log WHERE id = $1", [auditId])).rows[0];
    assert.deepEqual([row.inside_hotel, row.visit_id], [true, visitId]);
    await run((r) => r.visits.end(visitId, "exit", actor, new Date()));
    assert.equal(await run((r) => r.auth.visits.activeForSession(sessionId, new Date())), null, "ended");
    assert.deepEqual(await run((r) => r.visits.open(actor)), []);
    // a visit cannot be moved or reopened, and the app never deletes one
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.hotel_visits SET hotel_id = $2 WHERE id = $1", [visitId, pending])), null);
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.hotel_visits SET ended_at = NULL, ended_reason = NULL WHERE id = $1", [visitId])), null);
    assert.notEqual(await sqlStateOf(app.query("DELETE FROM platform.hotel_visits WHERE id = $1", [visitId])), null);
  });
});
describe("the Super Admin's extras (P5)", () => {
  test("audit search: filters, paging, refused rows, actors, last archiver; sign-in events; settings with their CHECKs", async () => {
    const h = await hotel("Audit Hotel");
    const other = await hotel("Other Hotel");
    const base = { actorUserId: actor, actorName: `Zed ${tag()}`, actorRole: "platform_admin" as const, entity: "hotel" as const, entityId: h, groupId: null, targetLabel: "Audit Hotel", reason: null, before: null, after: null, ip: "10.1.2.3", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36", traceId: "trace-0002" };
    const who = base.actorName;
    await run(async (r) => {
      await r.audit.write({ ...base, action: "hotel_archived", hotelId: h, result: "success", reason: "Closed", at: new Date("2026-10-01T10:00:00Z") });
      await r.audit.write({ ...base, action: "hotel_suspended", hotelId: h, result: "failed", reason: "Only the Super Admin can do this.", at: new Date("2026-10-02T10:00:00Z") });
      await r.audit.write({ ...base, action: "hotel_archived", hotelId: other, result: "success", at: new Date("2026-10-03T10:00:00Z") });
    });
    const all = await run((r) => r.auditLog.search({ actor: who }, { offset: 0, limit: 10 }));
    assert.deepEqual([all.total, all.rows.map((x) => x.action), all.rows.map((x) => x.result)], [3, ["hotel_archived", "hotel_suspended", "hotel_archived"], ["success", "failed", "success"]]);
    assert.deepEqual([all.rows[1].ip, all.rows[1].actorRole, all.rows[1].insideHotel, all.rows[1].hotelName, all.rows[1].reason], ["10.1.2.3", "platform_admin", false, "Audit Hotel", "Only the Super Admin can do this."]);
    assert.equal((await run((r) => r.auditLog.search({ actor: who, action: "hotel_archived" }, { offset: 0, limit: 1 }))).rows.length, 1);
    assert.equal((await run((r) => r.auditLog.search({ actor: who, action: "hotel_archived" }, { offset: 0, limit: 1 }))).total, 2);
    assert.equal((await run((r) => r.auditLog.search({ actor: who, hotelId: h }, { offset: 0, limit: 10 }))).total, 2);
    assert.equal((await run((r) => r.auditLog.search({ actor: who, from: new Date("2026-10-02T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") }, { offset: 0, limit: 10 }))).total, 1, "from inclusive, to exclusive");
    assert.ok((await run((r) => r.auditLog.actors())).includes(who));
    assert.equal((await run((r) => r.auditLog.lastActors("hotel_archived", [h, other]))).get(h), who);
    assert.equal((await run((r) => r.auditLog.lastActors("hotel_archived", []))).size, 0);

    // sign-in events: a known person, an unknown username (no user), a refused sign-in with its reason
    const person = await run((r) => r.accounts.create(newAccount({ hotelId: h }), actor, NOW));
    await owner.query("INSERT INTO platform.auth_events (user_id, event, ip, detail, at) VALUES ($1, 'login_success', '10.9.9.9', '{}'::jsonb, '2026-10-04T10:00:00Z'), (NULL, 'login_failed', '10.9.9.8', '{\"known\":false}'::jsonb, '2026-10-04T10:01:00Z'), ($1, 'login_failed', '10.9.9.7', '{\"reason\":\"hotel_suspended\"}'::jsonb, '2026-10-04T10:02:00Z'), ($1, 'logout', '10.9.9.9', NULL, '2026-10-04T10:03:00Z')", [person]);
    const seen = (await run((r) => r.signIns.recent(5000))).filter((e) => ["10.9.9.9", "10.9.9.8", "10.9.9.7"].includes(String(e.ip)));
    assert.deepEqual(seen.map((e) => [e.event, e.ip, e.username === null, e.hotelName]), [["login_failed", "10.9.9.7", false, "Audit Hotel"], ["login_failed", "10.9.9.8", true, null], ["login_success", "10.9.9.9", false, "Audit Hotel"]], "newest first, logout left out");
    assert.equal(seen[0].detail?.reason, "hotel_suspended");

    // settings
    const rows = await run((r) => r.settings.all());
    // mail.daily_limit is seeded by platform migration 0125, the backup and failover rows by 0141 (mail.provider and mail.sending_domain are written only when chosen)
    assert.deepEqual(rows.map((x) => x.key), ["mail.backup_test_result", "mail.backup_user", "mail.daily_limit", "mail.failover_enabled", "mail.failover_return_minutes", "mail.failover_state", "mail.files_keep_hours", "mail.from_email", "mail.from_name", "mail.reply_to", "mail.smtp_host", "mail.smtp_port", "mail.smtp_security", "mail.smtp_user", "mail.test_result", "new_hotel.gst_percent", "new_hotel.role_keys", "new_hotel.time_zone"]);
    await run((r) => r.settings.set("new_hotel.gst_percent", 12, actor, NOW));
    const after = (await run((r) => r.settings.all())).find((x) => x.key === "new_hotel.gst_percent");
    assert.deepEqual([after?.value, after?.updatedBy, after?.updatedByName], [12, actor, "Actor Platform"]);
    assert.equal(await run((r) => r.hotels.defaultGstPercent()), 12);
    await assert.rejects(() => run((r) => r.settings.set("new_hotel.gst_percent", 7, actor, NOW)), (e) => e instanceof RepoError);
    await assert.rejects(() => run((r) => r.settings.set("new_hotel.role_keys", ["admin"], actor, NOW)), (e) => e instanceof RepoError, "Super Admin must stay in the list");
    await run((r) => r.settings.set("new_hotel.gst_percent", 5, actor, NOW));
  });

  test("exports and the permanent delete: the database refuses a non-Super-Admin, a hotel that is not archived, a grace period not over, a wrong address and a missing export; then marks, closes accounts, health", async () => {
    const superId = randomUUID();
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Super Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin', 'code_required', true)) AS id", [superId, `sup${tag()}`, HASH, await roleId("admin")]);
    const h = await hotel("Doomed Hotel");
    const slug = String((await owner.query("SELECT slug FROM platform.hotels WHERE id = $1", [h])).rows[0].slug);
    const schema = await run((r) => r.exports.schemaOf(h));
    assert.match(String(schema), /^hotel_[0-9a-f]{32}$/);
    const mine = await run((r) => r.accounts.create(newAccount({ hotelId: h }), actor, NOW));
    const shared = await run((r) => r.accounts.create(newAccount({ hotelId: h }), actor, NOW));
    const safeHotel = await hotel("Safe Hotel");
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, false)", [shared, safeHotel]);
    const record = (over: Partial<{ deletedBy: string; confirmSlug: string; at: Date; exportId: string }> = {}) =>
      run((r) => r.exports.recordDeletion({ hotelId: h, hotelName: "Doomed Hotel", slug, schemaName: String(schema), confirmSlug: over.confirmSlug ?? slug, exportId: over.exportId ?? exportId, deletedBy: over.deletedBy ?? superId, reason: "Closed", traceId: "trace-0003", at: over.at ?? NOW }));
    const file = { hotelId: h, requestedBy: superId, fileName: `${slug}-export-2026-10-05-ab12cd34.ndjson.gz`, fileRef: "exports/x", byteSize: 120, sha256: createHash("sha256").update("x").digest("hex"), startedAt: NOW, finishedAt: NOW };
    const exportId = await run((r) => r.exports.record(file));
    assert.equal((await run((r) => r.exports.readyOf([h]))).get(h)?.fileName, file.fileName);
    assert.equal((await run((r) => r.exports.readyOf([]))).size, 0);

    await assert.rejects(() => record(), (e) => e instanceof RepoError, "the hotel is not archived yet");
    await run((r) => r.hotels.setLifecycle(h, { status: "archived", archivedAt: new Date(NOW.getTime() - 100 * 86_400_000), archiveReason: "Closed", restoreUntil: new Date(NOW.getTime() - 10 * 86_400_000), statusBeforeArchive: "active" }));
    await assert.rejects(() => record({ deletedBy: actor }), (e) => e instanceof RepoError, "a Platform Admin cannot delete");
    await assert.rejects(() => record({ confirmSlug: `${slug}x` }), (e) => e instanceof RepoError, "the typed address must match");
    await assert.rejects(() => record({ at: new Date(NOW.getTime() - 20 * 86_400_000) }), (e) => e instanceof RepoError, "the grace period is not over at that moment");
    const otherHotel = await hotel("Other Export");
    const otherExport = await run((r) => r.exports.record({ ...file, hotelId: otherHotel, fileName: `o-export-2026-10-05-ab12cd35.ndjson.gz` }));
    await assert.rejects(() => record({ exportId: otherExport }), (e) => e instanceof RepoError, "the export must belong to this hotel");
    assert.equal(Number((await owner.query("SELECT COUNT(*) AS n FROM platform.hotel_deletions WHERE hotel_id = $1", [h])).rows[0].n), 0);

    await record();
    await assert.rejects(() => record(), (e) => e instanceof RepoError, "one deletion record per hotel");
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.hotel_deletions SET reason = 'x' WHERE hotel_id = $1", [h])), null, "the deletion record is append-only");
    await run(async (r) => {
      await r.hotels.markDeleted(h, NOW);
      assert.equal(await r.accounts.closeOfHotel(h, superId, NOW), 1, "only the account that belonged to nothing else");
    });
    assert.equal(await run((r) => r.hotels.get(h, NOW)), null);
    assert.equal(await run((r) => r.accounts.get(mine)), null);
    assert.ok(await run((r) => r.accounts.get(shared)), "an account of another live hotel stays");
    assert.equal(await run((r) => r.hotels.slugTaken(slug)), false, "the address is free again");
    await assert.rejects(() => run((r) => r.hotels.markDeleted(h, NOW)), (e) => e instanceof RepoError);

    // health: failed mail of a hotel's people, in the last day only
    const person = await run((r) => r.accounts.create(newAccount({ hotelId: safeHotel }), actor, NOW));
    await owner.query("INSERT INTO platform.outbox (user_id, kind, to_email, template, status, attempts) VALUES ($1, 'login_code', 'a@b.test', 'login_code', 'failed', 5)", [person]);
    const failing = await run((r) => r.health.hotelsWithFailedMail(new Date(Date.now() - 86_400_000)));
    assert.ok(failing.has(safeHotel) && !failing.has(otherHotel));
    assert.equal((await run((r) => r.health.hotelsWithFailedMail(new Date(Date.now() + 60_000)))).has(safeHotel), false);
    assert.ok((await run((r) => r.health.ping())) >= 0);
  });
});

describe("platform mail server settings (migration 0123)", () => {
  const SEALED = "v1.aXZpdmVyeXZl.dGFndGFndGFndGFn.Y2lwaGVydGV4dA";
  test("the new keys are seeded, their shapes are checked by the database, the password is always a secret row and never listed", async () => {
    const rows = await run((r) => r.settings.all());
    const by = new Map(rows.map((x) => [x.key, x.value]));
    assert.deepEqual([by.get("mail.smtp_host"), by.get("mail.smtp_port"), by.get("mail.smtp_security"), by.get("mail.reply_to"), by.get("mail.test_result")], [null, 587, "starttls", null, null]);
    assert.ok(!rows.some((x) => x.key === "mail.smtp_password"), "a secret row is not in the list");
    assert.equal((await run((r) => r.settings.secrets(["mail.smtp_password"]))).get("mail.smtp_password") ?? null, null);
    const bad = async (key: string, value: unknown, secret = false) => assert.rejects(() => run((r) => r.settings.set(key, value, actor, NOW, { secret })), (e) => e instanceof RepoError, `${key} = ${JSON.stringify(value)}`);
    await bad("mail.smtp_host", "bad host!");
    await bad("mail.smtp_host", "-x.com");
    await bad("mail.smtp_port", 0);
    await bad("mail.smtp_port", 70000);
    await bad("mail.smtp_port", "587");
    await bad("mail.smtp_security", "tls13");
    await bad("mail.smtp_user", "a\nb");
    await bad("mail.reply_to", "nope");
    await bad("mail.test_result", { ok: true });
    await bad("mail.smtp_password", "plain text password", true);
    await bad("mail.smtp_password", SEALED, false);
    await bad("mail.smtp_host", "smtp.example.com", true);
    await run((r) => r.settings.set("mail.smtp_host", "smtp.example.com", actor, NOW));
    await run((r) => r.settings.set("mail.smtp_port", 465, actor, NOW));
    await run((r) => r.settings.set("mail.smtp_security", "ssl", actor, NOW));
    await run((r) => r.settings.set("mail.test_result", { at: NOW.toISOString(), ok: false, message: "535" }, actor, NOW));
    await run((r) => r.settings.set("mail.smtp_password", SEALED, actor, NOW, { secret: true }));
    assert.equal((await run((r) => r.settings.secrets(["mail.smtp_password"]))).get("mail.smtp_password"), SEALED);
    assert.ok(!(await run((r) => r.settings.all())).some((x) => x.key === "mail.smtp_password"));
    assert.equal((await owner.query("SELECT is_secret FROM platform.platform_settings WHERE key = 'mail.smtp_password'")).rows[0].is_secret, true);
    await run((r) => r.settings.set("mail.smtp_password", null, actor, NOW, { secret: true }));
    assert.equal((await run((r) => r.settings.secrets(["mail.smtp_password"]))).get("mail.smtp_password") ?? null, null);
    for (const [k, v] of [["mail.smtp_host", null], ["mail.smtp_port", 587], ["mail.smtp_security", "starttls"], ["mail.test_result", null]] as const) await run((r) => r.settings.set(k, v, actor, NOW));
  });
});