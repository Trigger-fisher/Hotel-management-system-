// Central first on the REAL PostgreSQL instance (hms_test only): finding the ONE profile by mobile (guests) or GSTIN (companies) through the real repository: the oldest live profile, never
// a merged one; a link joins a hotel's record to it; the app's role can link but never delete a profile. Run with: npm run test:db
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createPgCentralProfilesUnit } from "../../src/server/repos/postgres/centralProfiles";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let hotel: CreatedHotel;
const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const letters = (n: number): string => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 2 });
  hotel = await createTestHotel(owner, "Central First");
});

after(async () => {
  await pool?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("find by mobile and by GSTIN", () => {
  const unit = () => createPgCentralProfilesUnit(pool);

  test("the oldest live profile with the mobile is found; a merged one is not; an unknown mobile finds nothing", async () => {
    const mobile = `+919${digits(9)}`;
    const old = String((await owner.query("INSERT INTO platform.guests (display_name, mobile, created_at) VALUES ('Older', $1, now() - interval '2 days') RETURNING id", [mobile])).rows[0].id);
    const young = String((await owner.query("INSERT INTO platform.guests (display_name, mobile) VALUES ('Younger', $1) RETURNING id", [mobile])).rows[0].id);
    assert.equal((await unit().run((r) => r.guests.byMobile(mobile)))?.id, old);
    await owner.query("UPDATE platform.guests SET merged_into = $1, merged_at = now() WHERE id = $2", [young, old]);
    assert.equal((await unit().run((r) => r.guests.byMobile(mobile)))?.id, young, "the merged one is history");
    assert.equal(await unit().run((r) => r.guests.byMobile(`+919${digits(9)}`)), null);
  });

  test("the oldest live company with the GSTIN is found; a hotel's record joins it by a link, and the app's role cannot delete the profile", async () => {
    const gstin = `24${letters(5)}${digits(4)}F1Z5`;
    const id = String((await owner.query("INSERT INTO platform.companies (name, gstin) VALUES ($1, $2) RETURNING id", [`First ${digits(6)}`, gstin])).rows[0].id);
    const found = await unit().run((r) => r.companies.byGstin(gstin));
    assert.equal(found?.id, id);
    const record = randomUUID();
    assert.equal(await unit().run((r) => r.companies.link(hotel.id, record, id)), true);
    assert.equal((await unit().run((r) => r.companies.ofRecord(hotel.id, record)))?.id, id);
    assert.equal(await unit().run((r) => r.companies.hotelCount(id)), 1);
    const app = await connectApp();
    try {
      assert.equal(await sqlStateOf(app.query("DELETE FROM platform.companies WHERE id = $1", [id])), "42501", "no DELETE on the profile table");
    } finally {
      await app.end();
    }
    assert.equal(await unit().run((r) => r.companies.byGstin(`24${letters(5)}${digits(4)}F1Z5`)), null);
  });
});
