// The "Set up your hotel" checklist table on the REAL PostgreSQL instance (hms_test): platform.hotel_setup through repos/postgres/auth.ts as hms_app.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let unit: PlatformUnit;
let user: string;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const hotel = async (): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Setup Hotel', $1) RETURNING id", [`h-${tag()}${tag()}`])).rows[0].id);

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  unit = createPgPlatformUnit(pool);
  user = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Setup Admin', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'hotel_admin')) AS id", [user, `su${tag()}`, HASH, role]);
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("platform.hotel_setup", () => {
  test("created once per hotel (a second create changes nothing), read back, saved with its steps and the final fields", async () => {
    const id = await hotel();
    assert.equal(await unit.run((r) => r.hotelSetup.get(id)), null);
    await unit.run((r) => r.hotelSetup.create(id));
    await unit.run((r) => r.hotelSetup.create(id));
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.hotel_setup WHERE hotel_id = $1", [id])).rows[0].n), 1);
    assert.deepEqual(await unit.run((r) => r.hotelSetup.get(id)), { hotelId: id, status: "pending", steps: {}, hidden: false, doneAt: null });

    const steps = { security: "done", profile: "visited" };
    const mid = await unit.run((r) => r.hotelSetup.save(id, { status: "in_progress", steps, hidden: true, updatedBy: user, doneAt: null }));
    assert.deepEqual([mid.status, mid.steps, mid.hidden, mid.doneAt], ["in_progress", steps, true, null]);

    const at = new Date("2026-10-05T10:00:00.000Z");
    const done = await unit.run((r) => r.hotelSetup.save(id, { status: "done", steps, hidden: true, updatedBy: user, doneAt: at }));
    assert.equal(done.doneAt?.toISOString(), at.toISOString());
    const row = (await owner.query("SELECT updated_by FROM platform.hotel_setup WHERE hotel_id = $1", [id])).rows[0];
    assert.equal(String(row.updated_by), user);
  });

  test("the database refuses a final status without a time, a time without a final status, a bad status and a step list that is not an object", async () => {
    const id = await hotel();
    await unit.run((r) => r.hotelSetup.create(id));
    const at = new Date();
    assert.equal(await sqlStateOf(unit.run((r) => r.hotelSetup.save(id, { status: "done", steps: {}, hidden: false, updatedBy: user, doneAt: null }))), "23514");
    assert.equal(await sqlStateOf(unit.run((r) => r.hotelSetup.save(id, { status: "pending", steps: {}, hidden: false, updatedBy: user, doneAt: at }))), "23514");
    assert.equal(await sqlStateOf(app.query("UPDATE platform.hotel_setup SET status = 'maybe' WHERE hotel_id = $1", [id])), "23514");
    assert.equal(await sqlStateOf(app.query("UPDATE platform.hotel_setup SET steps = '[1]'::jsonb WHERE hotel_id = $1", [id])), "23514");
  });

  test("the app can read, insert and update but never delete; saving a hotel without a row is an error, not a new row", async () => {
    const id = await hotel();
    await unit.run((r) => r.hotelSetup.create(id));
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.hotel_setup WHERE hotel_id = $1", [id])), "42501");
    await assert.rejects(() => unit.run((r) => r.hotelSetup.save(randomUUID(), { status: "pending", steps: {}, hidden: false, updatedBy: user, doneAt: null })));
  });
});
