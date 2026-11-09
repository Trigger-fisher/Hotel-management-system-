// The Admin users repositories (repos/postgres/adminUsers.ts) on the REAL PostgreSQL instance, as hms_app, through the platform unit.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { newId } from "../../src/server/db/ids";
import type { AdminUsersRepos, AdminUsersUnit } from "../../src/server/repos/adminUsers";
import { createPgAdminUsersUnit } from "../../src/server/repos/postgres/adminUsers";
import { RepoError } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let pool: SharedPool;
let unit: AdminUsersUnit;
let hotelId: string;
let actor: string;
const run = <T>(work: (r: AdminUsersRepos) => Promise<T>): Promise<T> => unit.run(work);
const NOW = new Date("2026-03-04T10:00:00.000Z");
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);

before(async () => {
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  unit = createPgAdminUsersUnit(pool);
  hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Users Hotel', $1) RETURNING id", [`u-${tag()}${tag()}`])).rows[0].id);
  actor = newId();
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Actor', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'hotel_admin')) AS id", [actor, `act${tag()}`, HASH, await roleId("viewer")]);
});

after(async () => {
  await pool?.end();
  await owner?.end();
  await releaseTestLock?.();
});

const fields = (name: string, extra: Record<string, unknown> = {}) => ({ username: `n${tag()}${tag()}`, email: `${tag()}@example.test`, mobile: null, displayName: name, roleId: "", accountRole: "hotel_user", ...extra });

describe("users", () => {
  test("create makes an invited member with an unusable password and a default membership; lists, tabs, counts, update, status, unlock, close", async () => {
    const viewer = await roleId("viewer");
    const made = await run((r) => r.users.create(hotelId, fields("Zed Person", { roleId: viewer }), actor, NOW));
    assert.deepEqual([made.status, made.displayName, made.createdBy, made.codeRequired, made.roleKey], ["invited", "Zed Person", actor, false, "viewer"]);
    const row = (await owner.query("SELECT must_change_password, password_hash, created_by FROM platform.people WHERE id = $1", [made.id])).rows[0];
    assert.equal(row.must_change_password, true);
    assert.match(String(row.password_hash), /^\$argon2id\$/);
    const admin = await run((r) => r.users.create(hotelId, fields("Amy Admin", { roleId: viewer, accountRole: "hotel_admin" }), actor, NOW));
    assert.equal(admin.codeRequired, false, "decision 46: no account is created with the emailed code on, administrators included");
    assert.equal((await owner.query("SELECT is_default FROM platform.user_hotels WHERE user_id = $1", [made.id])).rows[0].is_default, true);
    await assert.rejects(() => run((r) => r.users.create(hotelId, fields("Dup", { roleId: viewer, username: made.username }), actor, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal(await run((r) => r.users.usernameTaken(made.username)), true);
    assert.equal(await run((r) => r.users.usernameTaken(made.username, made.id)), false);
    assert.equal(await run((r) => r.users.emailTaken(String(made.email))), true);

    const listed = await run((r) => r.users.list(hotelId, { words: [], tab: "all" }, NOW));
    assert.equal(listed.length, 2);
    assert.deepEqual((await run((r) => r.users.list(hotelId, { words: ["zed", "VIEW"], tab: "all" }, NOW))).map((x) => x.id), [made.id]);

    await run((r) => r.users.update(hotelId, made.id, { displayName: "Zed Renamed", mobile: "+919876543210" }));
    assert.equal((await run((r) => r.users.get(hotelId, made.id)))?.mobile, "+919876543210");
    assert.equal(await run((r) => r.users.get(hotelId, newId())), null);
    assert.deepEqual((await run((r) => r.users.own(made.id)))?.roleKey, "viewer", "own account, found without any hotel");
    assert.equal(await run((r) => r.users.own(newId())), null);

    await run((r) => r.users.setMemberStatus(hotelId, made.id, "disabled"));
    assert.deepEqual(await run((r) => r.users.counts(hotelId, NOW)), { all: 2, active: 1, inactive: 1, locked: 0 });
    assert.deepEqual((await run((r) => r.users.list(hotelId, { words: [], tab: "inactive" }, NOW))).map((x) => x.id), [made.id]);
    await owner.query("UPDATE platform.logins SET locked_until = $2, failed_attempts = 5, lock_level = 1 WHERE id = $1", [admin.id, new Date(NOW.getTime() + 600_000)]);
    assert.deepEqual((await run((r) => r.users.list(hotelId, { words: [], tab: "locked" }, NOW))).map((x) => x.id), [admin.id]);
    await run((r) => r.users.unlock(admin.id));
    assert.equal((await run((r) => r.users.counts(hotelId, NOW))).locked, 0);

    assert.equal((await run((r) => r.users.names([made.id, actor]))).get(actor), "Actor");
    assert.equal(await run((r) => r.users.hotelName(hotelId)), "Users Hotel");
    await run((r) => r.users.close(made.id, actor, NOW));
    assert.equal(await run((r) => r.users.get(hotelId, made.id)), null);
  });
});

describe("roles, grants and overrides", () => {
  test("custom roles: create, rename, grants replaced, in-use removal refused, portal roles hidden; overrides set, none, clear", async () => {
    const role = await run((r) => r.roles.create(hotelId, { name: "Night Auditor", description: "Nights", level: 20, icon: "bi-person", accent: "#7C3AED", inherits: true }));
    assert.match(role.key, /^custom_/);
    assert.equal(await run((r) => r.roles.nameTaken(hotelId, "night auditor")), true);
    assert.equal(await run((r) => r.roles.nameTaken(hotelId, "night auditor", role.id)), false);
    const keys = (await owner.query("SELECT key FROM platform.permissions ORDER BY key LIMIT 2")).rows.map((x) => String(x.key));
    await run((r) => r.roles.setGrants(role.id, [{ key: keys[0], level: "view" }, { key: keys[1], level: "edit" }]));
    await run((r) => r.roles.setGrants(role.id, [{ key: keys[0], level: "full" }]));
    assert.deepEqual(await run((r) => r.roles.grants(role.id)), [{ key: keys[0], level: "full" }]);
    await assert.rejects(() => run((r) => r.roles.setGrants(role.id, [{ key: "no.such.key", level: "view" }])), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal((await run((r) => r.roles.update(role.id, { name: "Night Lead" }))).name, "Night Lead");
    const list = await run((r) => r.roles.list(hotelId));
    assert.ok(list.some((x) => x.id === role.id));
    assert.ok(!list.some((x) => x.key === "guest" || x.key === "corporate"));

    const user = await run((r) => r.users.create(hotelId, fields("Role Holder", { roleId: role.id }), actor, NOW));
    assert.equal(await run((r) => r.roles.holders(hotelId, role.id)), 1);
    const nobody = "00000000-0000-4000-8000-00000000ffff";
    assert.deepEqual([...(await run((r) => r.roles.holdersOf(hotelId, [role.id, nobody])))], [[role.id, 1]], "one grouped count; a role nobody holds is absent");
    assert.deepEqual([...(await run((r) => r.roles.grantsOf([role.id, nobody])))], [[role.id, [{ key: keys[0], level: "full" }]]], "one read for every role; a role with no ticks is absent");
    assert.deepEqual([...(await run((r) => r.roles.grantsOf([])))], []);
    await assert.rejects(() => run((r) => r.roles.remove(role.id)), (e) => e instanceof RepoError && e.kind === "check");

    await run((r) => r.overrides.set(hotelId, user.id, keys[0], "edit", actor));
    await run((r) => r.overrides.set(hotelId, user.id, keys[1], "none", actor));
    assert.deepEqual(await run((r) => r.overrides.list(hotelId, user.id)), [{ key: keys[0], level: "edit" }, { key: keys[1], level: "none" }]);
    await run((r) => r.overrides.set(hotelId, user.id, keys[0], null, actor));
    assert.equal((await run((r) => r.overrides.list(hotelId, user.id))).length, 1);
    await assert.rejects(() => run((r) => r.overrides.set(hotelId, user.id, "no.such.key", "view", actor)), (e) => e instanceof RepoError && e.kind === "check");

    await run((r) => r.users.close(user.id, actor, NOW));
    await owner.query("UPDATE platform.user_hotels SET role_id = (SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL) WHERE user_id = $1", [user.id]);
    await owner.query("UPDATE platform.logins SET role_id = (SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL) WHERE id = $1", [user.id]);
    await run((r) => r.roles.remove(role.id));
    assert.equal(await run((r) => r.roles.get(hotelId, role.id)), null);
  });
});

describe("sign-in history and audit", () => {
  test("list newest first with ended derived from sessions; only ended rows are removable; live devices; audit round-trips without sign-in actions", async () => {
    const id = newId();
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Signer', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'hotel_user')) AS id", [id, `sg${tag()}`, HASH, await roleId("viewer")]);
    const t0 = new Date(NOW.getTime() - 3_600_000);
    const t1 = new Date(NOW.getTime() - 600_000);
    const ok1 = String((await owner.query("INSERT INTO platform.auth_events (user_id, event, ip, at) VALUES ($1, 'login_success', '10.1.1.1', $2) RETURNING id", [id, t0])).rows[0].id);
    const bad = String((await owner.query("INSERT INTO platform.auth_events (user_id, event, ip, at) VALUES ($1, 'login_failed', '10.1.1.2', $2) RETURNING id", [id, new Date(t0.getTime() + 1000)])).rows[0].id);
    const ok2 = String((await owner.query("INSERT INTO platform.auth_events (user_id, event, ip, at) VALUES ($1, 'login_success', '10.1.1.3', $2) RETURNING id", [id, t1])).rows[0].id);
    await owner.query("INSERT INTO platform.auth_events (user_id, event, at) VALUES ($1, 'logout', $2)", [id, t1]);
    const sid = newId();
    await owner.query("INSERT INTO platform.sessions (id, user_id, client, token_hash, issued_at, last_seen_at, expires_at) VALUES ($1, $2, 'web', $3, $4, $4, $5)", [sid, id, randomBytes(32).toString("hex"), t1, new Date(NOW.getTime() + 3_600_000)]);

    const rows = await run((r) => r.signIns.list(id, NOW));
    assert.deepEqual(rows.map((x) => [x.id, x.result, x.ended]), [[ok2, "success", false], [bad, "failed", true], [ok1, "success", true]]);
    assert.equal(await run((r) => r.signIns.removeEnded(id, ok2, NOW)), false, "a live sign-in stays");
    assert.equal(await run((r) => r.signIns.removeEnded(id, ok1, NOW)), true);
    assert.equal(await run((r) => r.signIns.removeEnded(id, ok1, NOW)), false, "already gone");
    assert.deepEqual((await run((r) => r.signIns.list(id, NOW))).map((x) => x.id), [ok2, bad]);

    const devices = await run((r) => r.signIns.liveDevices(id, sid, NOW));
    assert.deepEqual(devices.map((x) => [x.id, x.current]), [[sid, true]]);
    assert.equal(await run((r) => r.users.endSessions(id, "admin", NOW)), 1);
    assert.equal((await run((r) => r.signIns.liveDevices(id, sid, NOW))).length, 0);

    await run((r) => r.audit.write({ actorUserId: actor, hotelId, action: "user.update", entity: "user", entityId: id, traceId: null, detail: { field: "name" } }, NOW));
    await run((r) => r.audit.write({ actorUserId: actor, hotelId, action: "signin.noise", entity: "user", entityId: id, traceId: null, detail: null }, NOW));
    const about = await run((r) => r.audit.aboutUser(id, 10));
    assert.deepEqual(about.map((x) => [x.action, x.detail]), [["user.update", { field: "name" }]]);
  });
});
