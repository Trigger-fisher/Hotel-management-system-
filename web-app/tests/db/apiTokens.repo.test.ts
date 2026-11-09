// API access keys (platform migration 0129) on the REAL PostgreSQL instance, as hms_app: the repository's SQL (repos/postgres/auth.ts apiTokens) and the table's own CHECKs
// (a full key needs an address and a reason and lives at most 24 hours; a one-hotel key names its hotel; the key itself is never stored, only its hash); hms_app may not delete a row.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { hashApiToken, newApiToken } from "../../src/server/auth/apiTokens";
import type { ApiTokenInsert, AuthRepos, PlatformUnit } from "../../src/server/repos/auth";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let unit: PlatformUnit;
let creator: string;
let hotelId: string;
const run = <T>(work: (r: AuthRepos) => Promise<T>): Promise<T> => unit.run(work);
const KEY = randomBytes(32);
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const NOW = new Date();

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  unit = createPgPlatformUnit(pool);
  creator = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Key Maker', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin', 'code_required', true)) AS id", [creator, `km${tag()}`, HASH, role]);
  hotelId = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Key Hotel', $1) RETURNING id", [`kh-${tag()}${tag()}`])).rows[0].id);
});

after(async () => {
  await owner?.query("DELETE FROM platform.api_tokens WHERE created_by = $1", [creator]).catch(() => undefined);
  await pool?.end();
  await app?.end();
  await owner?.end();
  await releaseTestLock?.();
});

const insertRow = (over: Partial<ApiTokenInsert> = {}): ApiTokenInsert => {
  const { token, prefix } = newApiToken();
  return {
    name: `Key ${tag()}`, tokenHash: hashApiToken(KEY, token), prefix, level: "read", scope: "platform", hotelId: null, ipAllow: [], reason: null, testMode: true, testModeOffReason: null,
    callsPerMinute: 60, createdBy: creator, expiresAt: new Date(NOW.getTime() + 7 * 86_400_000), ...over,
  };
};

describe("platform.api_tokens (0129) through the repository", () => {
  test("insert, look up by hash, count a use (day count, new address kept), list, revoke; only the hash is stored", async () => {
    const { token, prefix } = newApiToken();
    const row = await run((r) => r.apiTokens.insert(insertRow({ tokenHash: hashApiToken(KEY, token), prefix, ipAllow: ["203.0.113.7"] }), NOW));
    assert.equal(row.prefix, prefix);
    const found = await run((r) => r.apiTokens.byHash(hashApiToken(KEY, token)));
    assert.deepEqual([found?.id, found?.level, found?.scope, found?.ipAllow, found?.testMode, found?.callsPerMinute], [row.id, "read", "platform", ["203.0.113.7"], true, 60]);
    const day = NOW.toISOString().slice(0, 10);
    await run((r) => r.apiTokens.recordUse(row.id, { at: NOW, day, ip: "203.0.113.7" }));
    await run((r) => r.apiTokens.recordUse(row.id, { at: NOW, day, ip: "198.51.100.9" }));
    await run((r) => r.apiTokens.recordUse(row.id, { at: NOW, day, ip: "203.0.113.7" }));
    const listed = (await run((r) => r.apiTokens.list())).find((x) => x.id === row.id)!;
    assert.deepEqual([listed.callsCount, listed.callsDay, listed.lastIp, listed.ipSeen], [3, day, "203.0.113.7", ["203.0.113.7", "198.51.100.9"]]);
    const stored = JSON.stringify((await owner.query("SELECT * FROM platform.api_tokens WHERE id = $1", [row.id])).rows[0]);
    assert.ok(!stored.includes(token), "the key itself is not in the row");
    assert.equal(await run((r) => r.apiTokens.revoke(row.id, creator, NOW)), true);
    assert.equal(await run((r) => r.apiTokens.revoke(row.id, creator, NOW)), false, "already revoked");
  });

  test("the table's CHECKs: full keys need an address, a reason and at most 24 hours; a one-hotel key names its hotel", async () => {
    const full = (over: Partial<ApiTokenInsert>) => insertRow({ level: "full", scope: "all", ipAllow: ["203.0.113.7"], reason: "Load test", expiresAt: new Date(NOW.getTime() + 6 * 3_600_000), callsPerMinute: 600, ...over });
    await run((r) => r.apiTokens.insert(full({}), NOW));
    for (const bad of [full({ ipAllow: [] }), full({ reason: null }), full({ expiresAt: new Date(NOW.getTime() + 48 * 3_600_000) }), insertRow({ scope: "hotel", hotelId: null }), insertRow({ expiresAt: new Date(NOW.getTime() + 40 * 86_400_000) }), full({ testMode: false, testModeOffReason: null })]) {
      assert.equal(await sqlStateOf(run((r) => r.apiTokens.insert(bad, NOW))), "23514", JSON.stringify({ ...bad, tokenHash: "-" }));
    }
    const one = await run((r) => r.apiTokens.insert(insertRow({ scope: "hotel", hotelId }), NOW));
    assert.equal(one.hotelId, hotelId);
  });

  test("the switch for full keys starts off; set and read back; hms_app cannot delete a key", async () => {
    assert.equal((await run((r) => r.apiTokens.accessSettings())).fullAccessEnabled, false);
    await run((r) => r.apiTokens.setFullAccess(true, creator, "Heavy testing", NOW));
    assert.equal(await run((r) => r.apiTokens.fullAccessEnabled()), true);
    await run((r) => r.apiTokens.setFullAccess(false, creator, "Done", NOW));
    assert.deepEqual(await run((r) => r.apiTokens.accessSettings()).then((s) => [s.fullAccessEnabled, s.reason, s.changedBy]), [false, "Done", creator]);
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.api_tokens WHERE created_by = $1", [creator])), "42501", "hms_app may not delete a key");
    assert.ok((await run((r) => r.apiTokens.countActive(new Date()))) >= 1);
    const n = await run((r) => r.apiTokens.revokeAll(creator, new Date()));
    assert.ok(n >= 1);
  });
});
