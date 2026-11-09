// The one-statement session read (repos/postgres/auth.ts access.loadBySession) on the REAL PostgreSQL instance, held against the plain reads it folds together
// (sessions.byTokenHash, access.load, visits.activeForSession, access.loadVisit): hotel staff with a custom-role membership and an override, a guest with a record
// scope, a platform admin outside and inside a visit, a revoked session, an unknown token. Run with:   npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { newId } from "../../src/server/db/ids";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { appUrl, connectOwner, tag, lockTestDatabase } from "./helpers/realDb";

let owner: DbClient;
let pool: SharedPool;
let unit: PlatformUnit;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const hex64 = (): string => randomBytes(32).toString("hex");
const NOW = new Date();
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  unit = createPgPlatformUnit(pool);
});

after(async () => {
  await pool?.end();
  await owner?.end();
  await releaseTestLock?.();
});

const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);
async function makeUser(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = { id: newId(), username: `u${tag()}${tag()}`, display_name: "Test Person", password_hash: HASH, role_id: await roleId("viewer"), account_role: "hotel_user", ...over };
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify(row)]);
  return String(row.id);
}
const makeHotel = async (name: string): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [name, `s-${tag()}${tag()}`])).rows[0].id);
const attach = (userId: string, hotelId: string, over: { role?: string | null; subject?: { id: string; kind: string } } = {}) =>
  owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id, is_default, status, subject_id, subject_kind) VALUES ($1, $2, $3, true, 'active', $4, $5)", [userId, hotelId, over.role ?? null, over.subject?.id ?? null, over.subject?.kind ?? null]);
const session = (userId: string, hotelId: string | null) => unit.run((r) => r.sessions.insert({ userId, hotelId, client: "web", tokenHash: hex64(), deviceLabel: null, userAgent: null, ip: "10.0.0.9", issuedAt: NOW, lastSeenAt: NOW, expiresAt: minutes(120) }));

/** What the plain reads say, composed the way the memory double does it. */
async function composed(tokenHash: string) {
  return unit.run(async (r) => {
    const s = await r.sessions.byTokenHash(tokenHash);
    if (!s) return null;
    const access = await r.access.load(s.userId, s.hotelId);
    const platform = access !== null && ["platform_admin", "super_admin", "group_hotel_admin"].includes(access.user.accountRole);
    const visit = platform ? await r.visits.activeForSession(s.id, NOW) : null;
    const visitAccess = visit ? await r.access.loadVisit(s.userId, visit.hotelId) : null;
    return { session: s, access, visit, visitAccess };
  });
}
const one = (tokenHash: string) => unit.read((r) => r.access.loadBySession(tokenHash, NOW));

describe("access.loadBySession against the plain reads", () => {
  test("hotel staff: a custom role of the hotel with grants folded over the ladder, a personal override, the hotel with its group", async () => {
    const hid = await makeHotel("One Read Hotel");
    const gid = String((await owner.query("INSERT INTO platform.hotel_groups (name, slug) VALUES ('One Read Group', $1) RETURNING id", [`g-${tag()}${tag()}`])).rows[0].id);
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [gid, hid]);
    const custom = String((await owner.query("INSERT INTO platform.roles (hotel_id, key, name, level, inherits) VALUES ($1, 'night', 'Night desk', 2, true) RETURNING id", [hid])).rows[0].id);
    const perm = String((await owner.query("SELECT id FROM platform.permissions WHERE key = 'revenue' LIMIT 1")).rows[0].id);
    await owner.query("INSERT INTO platform.role_permissions (role_id, permission_id, level) VALUES ($1, $2, 'edit')", [custom, perm]);
    const uid = await makeUser();
    await attach(uid, hid, { role: custom });
    await owner.query("INSERT INTO platform.user_permissions (user_id, hotel_id, permission_id, level, granted) VALUES ($1, $2, $3, 'full', true)", [uid, hid, perm]);
    const s = await session(uid, hid);
    const got = await one(s.tokenHash);
    assert.ok(got);
    assert.deepEqual(got, await composed(s.tokenHash));
    assert.deepEqual([got.access?.role.key, got.access?.hotel?.group?.id, got.access?.overrides.length, got.visit, got.visitAccess], ["night", gid, 1, null, null]);
    assert.ok(got.access!.grants.some((g) => g.key === "revenue" && g.level === "edit"), "the custom role's own grant");
    assert.ok(got.access!.grants.length > 1, "the built-in rungs below it are folded in");
  });

  test("a guest portal login: the record scope rides along; a session into a hotel the person left has no access", async () => {
    const hid = await makeHotel("Guest Hotel");
    const uid = await makeUser({ account_role: "guest_user" });
    const guestId = newId();
    await attach(uid, hid, { subject: { id: guestId, kind: "guest" } });
    const s = await session(uid, hid);
    const got = await one(s.tokenHash);
    assert.deepEqual(got, await composed(s.tokenHash));
    assert.deepEqual(got?.access?.scope, { kind: "guest", id: guestId });
    await owner.query("UPDATE platform.user_hotels SET status = 'disabled' WHERE user_id = $1", [uid]);
    const gone = await one(s.tokenHash);
    assert.deepEqual(gone, await composed(s.tokenHash));
    assert.equal(gone?.access, null);
  });

  test("a platform admin: outside a visit no hotel and no visit; inside one the visit (its access) and the visited hotel's SuperAdmin ladder; an ended visit is none", async () => {
    const hid = await makeHotel("Visited Hotel");
    const uid = await makeUser({ account_role: "platform_admin" });
    const s = await session(uid, null);
    const outside = await one(s.tokenHash);
    assert.deepEqual(outside, await composed(s.tokenHash));
    assert.deepEqual([outside?.access?.hotel, outside?.visit, outside?.visitAccess], [null, null, null]);
    const visitId = String((await owner.query("INSERT INTO platform.hotel_visits (user_id, hotel_id, session_id, reason, expires_at) VALUES ($1, $2, $3, 'Ticket 4412', $4) RETURNING id", [uid, hid, s.id, minutes(60)])).rows[0].id);
    const inside = await one(s.tokenHash);
    assert.deepEqual(inside, await composed(s.tokenHash));
    assert.deepEqual([inside?.visit?.id, inside?.visit?.hotelId, inside?.visit?.access, inside?.visitAccess?.role.key, inside?.visitAccess?.hotel?.id, inside?.visitAccess?.overrides], [visitId, hid, "view", "super_admin", hid, []]);
    assert.ok(inside!.visitAccess!.grants.length > 0);
    await owner.query("UPDATE platform.hotel_visits SET ended_at = now(), ended_reason = 'exit' WHERE id = $1", [visitId]);
    const after = await one(s.tokenHash);
    assert.deepEqual(after, await composed(s.tokenHash));
    assert.equal(after?.visit, null);
  });

  test("a revoked session is still returned with its revoke (the resolver decides); an unknown token is null", async () => {
    const hid = await makeHotel("Revoked Hotel");
    const uid = await makeUser();
    await attach(uid, hid);
    const s = await session(uid, hid);
    await unit.run((r) => r.sessions.revokeById(s.id, "admin", NOW));
    const got = await one(s.tokenHash);
    assert.deepEqual(got, await composed(s.tokenHash));
    assert.deepEqual([got?.session.revokedReason, got?.session.revokedAt instanceof Date], ["admin", true]);
    assert.equal(await one(hex64()), null);
  });
});
