// The Group Hotel Admin console end to end on the REAL PostgreSQL instance (hms_test): the group service on the real repositories (hms_app) with the group
// gate. What the in-memory double cannot show: the SQL of the group/hotel/admin/invitation reads, the visit trigger that lets a group admin enter only a hotel
// of their own group, and that nothing outside the group is ever readable or changeable.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createArgon2Hasher } from "../../src/server/auth/password";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPlatformServices } from "../../src/server/compose/platform";
import { createLocalProvisioner } from "../../src/server/provisioner/local";
import { createPgPlatformConsoleUnit } from "../../src/server/repos/postgres/platformConsole";
import { createPgAdminUsersUnit } from "../../src/server/repos/postgres/adminUsers";
import { createAccountService } from "../../src/server/services/admin/accountService";
import { createCatalog } from "../../src/server/auth/catalog";
import { PERMISSION_CATALOG } from "../../src/server/auth/catalog.generated";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { platformMeta } from "../../src/server/services/platform/access";
import { createTestHotel, dbDir, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, ownerUrl, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let services: ReturnType<typeof buildPlatformServices>;
const ids = { g1: "", g2: "", a1: "", a2: "", b1: "", solo: "", gadm: "", gadm2: "", ha1: "", ha2: "", hb: "", pa: "" };
const meta = () => platformMeta(new Request("https://hms.test/x", { headers: { "user-agent": "node-test" } }), `trace-${tag()}${tag()}`);
const sess = (userId: string, accountRole: VerifiedSession["accountRole"]): VerifiedSession => ({
  userId, hotelId: "", accountRole, roleId: randomUUID(), roleKey: "admin", roleLevel: 3, permissions: {}, sessionId: randomUUID(), client: "web",
});
const code = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: { code?: string }) => e.code);

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  const user = async (key: keyof typeof ids, accountRole: string, extra = ""): Promise<void> => {
    ids[key] = randomUUID();
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', $3::text, 'password_hash', $4::text, 'role_id', $5::uuid, 'account_role', $6::text, 'code_required', true, 'email', $7::text))", [ids[key], `${key}${tag()}`, `Person ${key}`, HASH, role, accountRole, `${tag()}@example.test`]);
    if (extra) await owner.query(`UPDATE platform.logins SET ${extra} WHERE id = $1`, [ids[key]]);
  };
  await user("gadm", "group_hotel_admin");
  await user("gadm2", "group_hotel_admin");
  await user("pa", "platform_admin");
  await user("ha1", "hotel_admin");
  await user("ha2", "hotel_admin", "locked_until=now() + interval '1 hour'");
  await user("hb", "hotel_admin");
  ids.a1 = (await createTestHotel(owner, "Group Hotel One")).id;
  ids.a2 = (await createTestHotel(owner, "Group Hotel Two")).id;
  ids.b1 = (await createTestHotel(owner, "Other Group Hotel")).id;
  ids.solo = (await createTestHotel(owner, "Solo Hotel")).id;
  const group = async (name: string, adminKey: "gadm" | "gadm2"): Promise<string> =>
    String((await owner.query("INSERT INTO platform.hotel_groups (name, slug, admin_user_id) VALUES ($1, $2, $3) RETURNING id", [name, `g-${tag()}${tag()}`, ids[adminKey]])).rows[0].id);
  // names are unique per run (hotel_groups.name is UNIQUE): a run that stopped before its cleanup must not block the next one
  ids.g1 = await group(`Group One ${tag()}`, "gadm");
  ids.g2 = await group(`Group Two ${tag()}`, "gadm2");
  for (const [g, h] of [[ids.g1, ids.a1], [ids.g1, ids.a2], [ids.g2, ids.b1]]) await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [g, h]);
  for (const [u, h] of [[ids.ha1, ids.a1], [ids.ha2, ids.a2], [ids.hb, ids.b1]]) await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [u, h]);
  const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
  const now = (): Date => new Date();
  services = buildPlatformServices({
    unit: createPgPlatformConsoleUnit(pool), credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: "https://hms.test",
    newToken: () => randomBytes(8).toString("hex"), hashKey: randomBytes(32), provisioner: createLocalProvisioner({ nodeEnv: "development", dbRoot: dbDir, ownerUrl: ownerUrl() }),
  });
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  if (owner) await owner.query("DELETE FROM platform.hotel_groups WHERE id = ANY($1::uuid[])", [[ids.g1, ids.g2].filter(Boolean)]).catch(() => undefined);
  if (owner) await owner.query("DELETE FROM platform.logins WHERE id = ANY($1::uuid[])", [Object.values(ids).slice(6).filter(Boolean)]).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("the group console on the real database", () => {
  test("overview, lists and details read only my group; everything outside it is a 404 or absent", async () => {
    const me = sess(ids.gadm, "group_hotel_admin");
    const g = services.group;
    const ov = await g.overview(me);
    assert.deepEqual([ov.group.id, ov.tiles.hotels, ov.tiles.hotelAdmins, ov.tiles.lockedAccounts, ov.recentHotels.length], [ids.g1, 2, 2, 1, 2]);
    const list = await g.myHotels(me, { page: 1, pageSize: 25 });
    assert.deepEqual(list.items.map((h) => h.name).sort(), ["Group Hotel One", "Group Hotel Two"]);
    assert.equal((await g.getMyHotel(me, ids.a1)).hotel.name, "Group Hotel One");
    for (const id of [ids.b1, ids.solo, randomUUID()]) assert.equal(await code(g.getMyHotel(me, id)), "NOT_FOUND", id);
    const admins = await g.myHotelAdmins(me, { page: 1, pageSize: 25 });
    assert.deepEqual(admins.items.map((a) => a.id).sort(), [ids.ha1, ids.ha2].sort());
    assert.equal(await code(g.myHotelAdmins(me, { hotelId: ids.b1, page: 1, pageSize: 25 })), "NOT_FOUND");
    assert.equal((await g.overview(sess(ids.gadm2, "group_hotel_admin"))).tiles.hotels, 1);
  });

  test("invite into my group, resend, cancel; another group's invitation is a 404; the platform's own invitation routes stay closed to a group admin", async () => {
    const me = sess(ids.gadm, "group_hotel_admin");
    const sent = await services.group.invite(me, { hotelName: `Flow Hotel ${tag()}`, contactName: "Jaya Rao", email: `${tag()}@example.test` }, meta());
    assert.deepEqual([sent.invitation.type, sent.invitation.groupId, sent.invitation.invitedByRole, sent.invitation.status], ["member_hotel", ids.g1, "group_admin", "sent"]);
    const listed = await services.group.myInvitations(me, { page: 1, pageSize: 25 });
    assert.equal(listed.total, 1);
    assert.equal((await services.group.resend(me, sent.invitation.id, meta())).invitation.resendCount, 1);
    const theirs = await services.group.invite(sess(ids.gadm2, "group_hotel_admin"), { hotelName: `Their Hotel ${tag()}`, contactName: "Om", email: `${tag()}@example.test` }, meta());
    assert.equal(await code(services.group.resend(me, theirs.invitation.id, meta())), "NOT_FOUND");
    assert.equal(await code(services.group.cancel(me, theirs.invitation.id, meta())), "NOT_FOUND");
    assert.equal((await services.group.cancel(me, sent.invitation.id, meta())).status, "cancelled");
    assert.equal(await code(services.invitations.send(me, { type: "member_hotel", hotelName: "X", contactName: "Y", email: "x@y.example" }, meta())), "FORBIDDEN");
    const audited = (await owner.query("SELECT actor_role, result FROM platform.audit_log WHERE action = 'invitation_sent' AND group_id = $1", [ids.g1])).rows;
    assert.deepEqual(audited.map((r) => [r.actor_role, r.result]), [["group_hotel_admin", "success"]]);
  });

  test("hotel admin actions work on my admins and are 404 on anyone else's; the platform person and the plain account cannot be reached", async () => {
    const me = sess(ids.gadm, "group_hotel_admin");
    assert.equal((await services.group.unlock(me, ids.ha2, meta())).status, "active");
    assert.equal((await services.group.disable(me, ids.ha1, meta())).status, "disabled");
    assert.equal((await services.group.enable(me, ids.ha1, meta())).status, "active");
    for (const id of [ids.hb, ids.pa, ids.gadm, ids.gadm2, randomUUID()]) {
      assert.equal(await code(services.group.disable(me, id, meta())), "NOT_FOUND", id);
      assert.equal(await code(services.group.resetPassword(me, id, meta())), "NOT_FOUND", id);
    }
    assert.equal(String((await owner.query("SELECT status FROM platform.people WHERE id = $1", [ids.hb])).rows[0].status), "active");
  });

  test("enter: only a hotel of my group (the database trigger agrees); the visit is read only and ends on exit; a group admin cannot reach another group's hotel even by direct insert", async () => {
    const sid = randomUUID();
    await owner.query("INSERT INTO platform.sessions (id, user_id, client, token_hash, issued_at, last_seen_at, expires_at) VALUES ($1, $2, 'web', $3, now(), now(), now() + interval '1 hour')", [sid, ids.gadm, randomBytes(32).toString("hex")]);
    const me = { ...sess(ids.gadm, "group_hotel_admin"), sessionId: sid };
    assert.equal(await code(services.group.enter(me, ids.b1, "Looking around", meta())), "NOT_FOUND");
    const entered = await services.group.enter(me, ids.a1, "Checking this month", meta());
    assert.deepEqual([entered.ok, entered.readOnly, entered.hotel.id], [true, true, ids.a1]);
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.hotel_visits WHERE user_id = $1 AND ended_at IS NULL", [ids.gadm])).rows[0].n), 1);
    await services.group.exit(me, ids.a1, meta());
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.hotel_visits WHERE user_id = $1 AND ended_at IS NULL", [ids.gadm])).rows[0].n), 0);
    // below the service: the trigger itself refuses a visit into a hotel outside the group
    await assert.rejects(() => app.query("INSERT INTO platform.hotel_visits (user_id, hotel_id, reason, expires_at) VALUES ($1, $2, 'direct', now() + interval '30 minutes')", [ids.gadm, ids.b1]), (e: { code?: string }) => e.code === "42501");
  });

  test("unlink: the hotel becomes individual and keeps its schema; archive is a 404 on a foreign hotel and refused on its own (Super Admin only); all are audited", async () => {
    const me = sess(ids.gadm, "group_hotel_admin");
    assert.equal(await code(services.group.archive(me, ids.solo, undefined, meta())), "NOT_FOUND");
    assert.equal(await code(services.group.unlink(me, ids.b1, meta())), "NOT_FOUND");
    const out = await services.group.unlink(me, ids.a2, meta());
    assert.deepEqual([out.hotel.id, out.hotel.groupId], [ids.a2, null]);
    assert.deepEqual((await owner.query("SELECT g.kind FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id WHERE gm.hotel_id = $1", [ids.a2])).rows.map((r) => r.kind), ["individual"], "it falls under the individual hotels group");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace n JOIN platform.hotels h ON h.schema_name = n.nspname WHERE h.id = $1", [ids.a2])).rows.length, 1, "nothing was dropped");
    // archiving is the Super Admin's only (MJ, 5 Nov 2026): refused on the group's own hotel too, and kept as a failed row
    assert.equal(await code(services.group.archive(me, ids.a1, "Season over", meta())), "FORBIDDEN");
    const rows = (await owner.query("SELECT action, result, actor_role FROM platform.audit_log WHERE actor_user_id = $1 AND action IN ('group_hotel_removed', 'hotel_archived') ORDER BY at", [ids.gadm])).rows;
    assert.equal(rows.filter((r) => r.action === "hotel_archived" && r.result === "failed").length, 2, "both refused archives were kept");
    assert.ok(rows.every((r) => r.actor_role === "group_hotel_admin"));
    assert.deepEqual(rows.filter((r) => r.result === "success").map((r) => r.action), ["group_hotel_removed"]);
  });

  test("My Profile works for a person with no hotel: read, edit (no membership needed), audit row without a hotel", async () => {
    const now = (): Date => new Date();
    const account = createAccountService({ platform: createPgAdminUsersUnit(pool), credentials: undefined as never, catalog: createCatalog(PERMISSION_CATALOG), now });
    const me = sess(ids.gadm, "group_hotel_admin");
    const profile = await account.profile(me);
    assert.deepEqual([profile.name, profile.hotelName, profile.emailedCode, profile.roleName], ["Person gadm", "", true, "Group Hotel Admin"]);
    const saved = await account.updateProfile(me, { name: "Gita Group Admin", email: profile.email, mobile: "9876543210", username: profile.username }, meta());
    assert.deepEqual([saved.message, saved.profile.name, saved.profile.mobile], ["Profile updated.", "Gita Group Admin", "+919876543210"]);
    const row = (await owner.query("SELECT hotel_id FROM platform.audit_log WHERE action = 'profile.updated' AND actor_user_id = $1", [ids.gadm])).rows;
    assert.deepEqual(row.map((r) => r.hotel_id), [null]);
  });

  test("only an active Group Hotel Admin passes the gate: a Platform Admin, a hotel admin and a group admin without a group are 403", async () => {
    assert.equal(await code(services.group.overview(sess(ids.pa, "platform_admin"))), "FORBIDDEN");
    assert.equal(await code(services.group.overview(sess(ids.ha1, "hotel_admin"))), "FORBIDDEN");
    const loner = randomUUID();
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'No Group', 'password_hash', $3::text, 'role_id', (SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL), 'account_role', 'group_hotel_admin', 'code_required', true)) AS id", [loner, `loner${tag()}`, HASH]);
    assert.equal(await code(services.group.overview(sess(loner, "group_hotel_admin"))), "FORBIDDEN");
    await owner.query("DELETE FROM platform.logins WHERE id = $1", [loner]);
  });
});
