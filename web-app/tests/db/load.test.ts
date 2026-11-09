// A light load test on the REAL PostgreSQL instance (hms_test): many hotels, many parallel requests, one small shared pool.
// What it proves: no cross-talk between hotels under load, every request is answered, the pool never exceeds its cap and drains back, and
// the unit of work stays fast. 20 hotels x 10 parallel requests (200 units of work) through a pool of 8 connections.
// Run with:   npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { nextEntryNo } from "../../src/server/data/entryNo";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

const HOTELS = 20;
const PER_HOTEL = 10;
const POOL_CAP = 8;

let owner: DbClient;
const hotels: CreatedHotel[] = [];
let database: Database;

let releaseTestLock: (() => Promise<void>) | undefined;

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  for (let i = 0; i < HOTELS; i += 1) hotels.push(await createTestHotel(owner, `Load ${i}`));
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: POOL_CAP });
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe(`${HOTELS} hotels x ${PER_HOTEL} parallel requests through ${POOL_CAP} connections`, () => {
  test("every write lands in its own hotel, numbers are gap-free per hotel, the pool stays under its cap and drains", async () => {
    let peak = 0;
    const sampler = setInterval(() => {
      peak = Math.max(peak, database.pool.totalCount);
    }, 5);
    const started = Date.now();
    const took: number[] = [];
    const jobs: Promise<void>[] = [];
    // interleave the hotels so neighbours are really in flight together
    for (let n = 0; n < PER_HOTEL; n += 1) {
      for (const hotel of hotels) {
        jobs.push(
          (async () => {
            const t0 = Date.now();
            await database.withHotel({ hotelId: hotel.id }, async (tx) => {
              const no = await nextEntryNo(tx, "hotel_cash_deposits");
              await insertRow(tx, tx.schema, "hotel_cash_deposits", { entry_no: no });
            });
            took.push(Date.now() - t0);
          })(),
        );
      }
    }
    await Promise.all(jobs);
    clearInterval(sampler);
    const seconds = (Date.now() - started) / 1000;

    for (const hotel of hotels) {
      const res = await database.withHotel({ hotelId: hotel.id }, (tx) => tx.query("SELECT count(*) AS n, min(entry_no) AS lo, max(entry_no) AS hi FROM hotel_cash_deposits"));
      assert.equal(Number(res.rows[0]!.n), PER_HOTEL, "exactly its own requests, nobody else's");
      assert.equal(Number(res.rows[0]!.lo), 1);
      assert.equal(Number(res.rows[0]!.hi), PER_HOTEL);
    }
    assert.ok(peak <= POOL_CAP, `the pool peaked at ${peak}, above its cap of ${POOL_CAP}`);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(database.pool.waitingCount, 0, "nobody is left waiting for a connection");
    took.sort((a, b) => a - b);
    const p95 = took[Math.floor(took.length * 0.95)] ?? 0;
    console.log(`load: ${HOTELS * PER_HOTEL} units in ${seconds.toFixed(1)} s, p95 ${p95} ms, pool peak ${peak}`);
    assert.ok(p95 < 5000, `p95 of a unit was ${p95} ms`);
  });

  test("a second wave of 200 reads after the first leaves the pool healthy", async () => {
    const jobs: Promise<unknown>[] = [];
    for (let n = 0; n < PER_HOTEL; n += 1) {
      for (const hotel of hotels) jobs.push(database.withHotel({ hotelId: hotel.id }, (tx) => tx.query("SELECT count(*) FROM hotel_cash_deposits")));
    }
    await Promise.all(jobs);
    const client = await database.pool.connect();
    try {
      const res = await client.query("SELECT current_user AS u, current_setting('search_path') AS p");
      assert.equal(res.rows[0]!.u, "hms_app");
      assert.doesNotMatch(String(res.rows[0]!.p), /hotel_/);
    } finally {
      client.release();
    }
  });
});

// registered last, so it runs last: parallel runs on hms_test queue instead of wiping each other's hotels
after(async () => {
  await releaseTestLock?.();
});
