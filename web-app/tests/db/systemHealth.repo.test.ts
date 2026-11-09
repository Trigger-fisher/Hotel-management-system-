// The SQL of the System Health usage reader (repos/postgres/healthUsage.ts) on the REAL PostgreSQL instance (hms_test): the system log by IST day, people,
// the week before, journeys within 30 minutes, open faults, the record counts of the busy tables, the Pathik queue and the database numbers.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgHealthUsageReader } from "../../src/server/repos/postgres/healthUsage";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const U1 = "00000000-0000-4000-8000-000000000011";
const U2 = "00000000-0000-4000-8000-000000000012";

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Health Hotel");
  const s = `"${hotel.schema}"`;
  const log = (module: string, user: string, status: string, at: string) =>
    owner.query(`INSERT INTO ${s}.system_logs (module, user_id, action, status, entity, summary, created_at) VALUES ($1, $2, 'created', $3, 'Entry', 'x', $4::timestamptz)`, [module, user, status, at]);
  // IST day 2026-10-11: bills then revenue by U1 within 30 minutes; U2 only bills; a failed bills line at 23:50 on the 10th; one line 20 days ago;
  // one revenue line on 2 Oct (the week before the last 7 days)
  await log("bills", U1, "success", "2026-10-11T09:00:00+05:30");
  await log("revenue", U1, "success", "2026-10-11T09:20:00+05:30");
  await log("bills", U2, "success", "2026-10-11T09:25:00+05:30");
  await log("bills", U2, "failed", "2026-10-10T23:50:00+05:30");
  await log("bills", U1, "success", "2026-09-21T09:00:00+05:30");
  await log("revenue", U1, "success", "2026-10-02T09:00:00+05:30");
  await owner.query(`INSERT INTO ${s}.feature_errors (feature, fingerprint, exception) VALUES ('bill-master', 'fp1', 'X'), ('bill-master', 'fp2', 'Y')`);
  await owner.query(`UPDATE ${s}.feature_errors SET resolved_at = now() WHERE fingerprint = 'fp2'`);
});

after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

const who = () => ({ hotelId: hotel.id });
const windows = { from30: new Date("2026-09-11T18:30:00Z"), from7: new Date("2026-10-04T18:30:00Z"), from14: new Date("2026-09-27T18:30:00Z") };

describe("System Health usage on PostgreSQL", () => {
  test("usage: actions by IST day (23:50 on the 10th stays on the 10th)", async () => {
    const raw = await createPgHealthUsageReader(database.withHotel).usage(who(), windows);
    const bills = raw.daily.filter((d) => d.module === "bills");
    assert.deepEqual(bills.map((d) => [d.day, d.hits, d.failed]), [["2026-09-21", 1, 0], ["2026-10-10", 1, 1], ["2026-10-11", 2, 0]]);
  });

  test("people, the week before, one journey, open faults", async () => {
    const raw = await createPgHealthUsageReader(database.withHotel).usage(who(), windows);
    assert.deepEqual(raw.users7.find((u) => u.module === "bills"), { module: "bills", users: 2 }, "U1 and U2 both have a bills line this week");
    assert.equal(raw.users7.find((u) => u.module === "revenue")?.users, 1);
    assert.deepEqual(raw.prev7, [{ module: "revenue", hits: 1 }]);
    assert.deepEqual(raw.flows, [{ from: "bills", to: "revenue", people: 1 }], "U1: bills then revenue 20 minutes later; U2 stayed in bills; U1's lines weeks apart are not a journey");
    assert.deepEqual(raw.faults, [{ feature: "bill-master", open: 1 }]);
  });

  test("activity counts the busy tables (a fresh hotel: zeros) and the numbers of the hotel's data and connections", async () => {
    const reader = createPgHealthUsageReader(database.withHotel);
    const act = await reader.activity(who(), new Date("2026-10-11T10:00:00+05:30"));
    assert.ok(act.length >= 5, "every busy table group exists in a fresh hotel");
    assert.ok(act.every((a) => a.last24h === 0 && a.last7d === 0 && a.last30d === 0));
    const server = await reader.server(who());
    assert.ok((server.hotelDataBytes ?? 0) > 0, "the hotel's own tables take some space");
    assert.ok((server.dbConnections ?? 0) >= 1);
  });
});
