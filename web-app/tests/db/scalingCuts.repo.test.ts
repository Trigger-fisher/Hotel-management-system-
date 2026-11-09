// Two statements of the scaling cuts (18 Oct 2026) on the real PostgreSQL: the bell's movementCount answers the same number as the rows movements() returns, and the daily
// summary's cursor row is accepted by platform.platform_settings (key shape, jsonb, upsert, no migration).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { pgReportsRepos } from "../../src/server/repos/postgres/reports";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000001";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 3 });
  hotel = await createTestHotel(owner, "Scaling Cuts Hotel");
});
after(async () => {
  await owner?.query("DELETE FROM platform.platform_settings WHERE key = 'cron.daily_summary_cursor'").catch(() => undefined);
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("scaling cuts on PostgreSQL", () => {
  test("movementCount equals the number of rows movements() returns for a range, across the cash tables", async () => {
    await insertRow(owner, hotel.schema, "hotel_cash_deposits", { date: "2026-10-13", deleted_at: null });
    await insertRow(owner, hotel.schema, "hotel_cash_deposits", { date: "2026-10-13", deleted_at: null });
    await insertRow(owner, hotel.schema, "food_misc_expenses", { date: "2026-10-13", deleted_at: null }).catch(() => insertRow(owner, hotel.schema, "hotel_misc_expenses", { date: "2026-10-13", deleted_at: null }));
    await insertRow(owner, hotel.schema, "hotel_cash_withdrawals", { date: "2026-10-12", deleted_at: null });
    const read = async (from: string, to: string) =>
      database.withHotel({ hotelId: hotel.id, userId: USER } as never, async (tx) => {
        const o = pgReportsRepos(tx).overview;
        return { rows: (await o.movements({ from, to })).length, count: await o.movementCount({ from, to }) };
      });
    const day = await read("2026-10-13", "2026-10-13");
    assert.equal(day.count, day.rows);
    assert.equal(day.count, 3);
    const two = await read("2026-10-12", "2026-10-13");
    assert.deepEqual([two.rows, two.count], [4, 4]);
    assert.deepEqual(await read("2026-10-20", "2026-10-21"), { rows: 0, count: 0 });
  });

  test("the daily summary's cursor row: the key and the jsonb value are accepted, written again by the upsert, read back", async () => {
    const upsert = "INSERT INTO platform.platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value";
    const key = "cron.daily_summary_cursor";
    await owner.query(upsert, [key, JSON.stringify({ day: "2026-10-13", after: "hotel-a", done: false })]);
    await owner.query(upsert, [key, JSON.stringify({ day: "2026-10-13", after: null, done: true })]);
    const rows = (await owner.query("SELECT value FROM platform.platform_settings WHERE key = $1", [key])).rows;
    assert.equal(rows.length, 1, "one row, updated in place");
    assert.deepEqual(rows[0].value, { day: "2026-10-13", after: null, done: true });
  });
});
