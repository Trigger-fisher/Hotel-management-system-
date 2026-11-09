// Decision 52 and 54 on the real PostgreSQL: who stayed on a bill (guestsOf reads the stay's counts and the names kept), and the
// SQL word search of the platform activity and the system-error list. (The Add member upload table tests were removed, decision 59; the table guest_id_scans stays in the database.)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgBillingUnit } from "../../src/server/repos/postgres/billing";
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
  hotel = await createTestHotel(owner, "Guest Portal Repo Hotel");
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});


describe("bills: who stayed (guestsOf)", () => {
  test("a bill that came from a stay takes the stay's counts and the names kept; a bill with no stay is left out", async () => {
    const bill = await insertRow(owner, hotel.schema, "bill_master_bills");
    const lone = await insertRow(owner, hotel.schema, "bill_master_bills");
    await insertRow(owner, hotel.schema, "pms_stays", { bill_id: bill.id, guest_name: "Amit Joshi", adults: 2, children: 1, guest_details: JSON.stringify({ members: [{ fullName: "Meera Sharma Joshi" }, { fullName: "Little Joshi" }] }) });
    const units = createPgBillingUnit(database.withHotel);
    const got = await units.run({ hotelId: hotel.id, userId: USER } as never, (r) => r.bills.guestsOf([String(bill.id), String(lone.id)]));
    assert.deepEqual([...got.keys()], [String(bill.id)]);
    assert.deepEqual(got.get(String(bill.id)), { adults: 2, children: 1, names: ["Amit Joshi", "Meera Sharma Joshi", "Little Joshi"] });
    assert.equal((await units.run({ hotelId: hotel.id, userId: USER } as never, (r) => r.bills.guestsOf([]))).size, 0);
  });
});
