// The README of the hosted SQL parts says how many tables the platform and a hotel schema hold. Those numbers live in db/hosted-sql-reference.json;
// this test keeps them true: a new migration that adds a table fails here until the file is updated (then the export README is right again).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let hotel: CreatedHotel;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  hotel = await createTestHotel(owner, "Hosted SQL Reference Hotel");
});
after(async () => {
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("db/hosted-sql-reference.json", () => {
  test("holds the real table counts of the platform schema and of a fresh hotel schema", async () => {
    const reference = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "hosted-sql-reference.json"), "utf8")) as { platformTables: number; hotelTables: number };
    const count = async (schema: string) => Number((await owner.query("SELECT count(*) AS n FROM pg_tables WHERE schemaname = $1", [schema])).rows[0].n);
    assert.equal(await count("platform"), reference.platformTables);
    assert.equal(await count(hotel.schema), reference.hotelTables);
  });
});
