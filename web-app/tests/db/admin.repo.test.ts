// The Admin repositories on the REAL PostgreSQL instance (repos/postgres/admin.ts): settings, plan rates and the Master Data option lists.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { AdminRepos } from "../../src/server/repos/admin";
import { createPgAdminUnit } from "../../src/server/repos/postgres/admin";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<AdminRepos>;
const ACTOR = newId();
const run = <T>(work: (r: AdminRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: ACTOR }, work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Admin Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  unit = createPgAdminUnit(database.withHotel);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe("settings", () => {
  test("only the keys that exist come back; set inserts or replaces by key, clears with null, keeps the secret flag; the seeded GST settings are there", async () => {
    const seeded = await run((r) => r.adminSettings.get(["checkout.hotel_gst_percent", "checkout.food_gst_percent", "no.such"]));
    assert.deepEqual(seeded.map((x) => [x.key, x.value, x.secret]), [["checkout.food_gst_percent", "5", false], ["checkout.hotel_gst_percent", "5", false]]);
    await run((r) => r.adminSettings.set([{ key: "general.site_name", value: "Grand", secret: false }, { key: "smtp.password", value: "s3cret", secret: true }, { key: "checkout.hotel_gst_percent", value: "12", secret: false }], ACTOR));
    await run((r) => r.adminSettings.set([], ACTOR));
    const got = await run((r) => r.adminSettings.get(["general.site_name", "smtp.password", "checkout.hotel_gst_percent"]));
    assert.deepEqual(got.map((x) => [x.key, x.value, x.secret]), [["checkout.hotel_gst_percent", "12", false], ["general.site_name", "Grand", false], ["smtp.password", "s3cret", true]]);
    await run((r) => r.adminSettings.set([{ key: "general.site_name", value: null, secret: false }], ACTOR));
    assert.deepEqual((await run((r) => r.adminSettings.get(["general.site_name"]))).map((x) => x.value), [null], "a key given with null is cleared");
    assert.deepEqual(await run((r) => r.adminSettings.get([])), []);
    const rows = await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".app_settings WHERE key = 'general.site_name'`);
    assert.equal(Number(rows.rows[0].n), 1, "one row per key");
  });
});

describe("plan rates", () => {
  test("one price per plan per date: a second one for the same date (any case) replaces it and says so; newest date first; remove; this month's plan food", async () => {
    const first = await run((r) => r.planRates.upsert({ plan: "CP", effectiveFrom: "2026-04-01", ratePaise: BigInt(150_000), note: "New year" }, ACTOR));
    assert.deepEqual([first.created, first.before, first.record.plan, first.record.ratePaise, first.record.note, first.record.createdBy], [true, null, "CP", BigInt(150_000), "New year", ACTOR]);
    const other = newId();
    const second = await run((r) => r.planRates.upsert({ plan: "cp", effectiveFrom: "2026-04-01", ratePaise: BigInt(160_000), note: null }, other));
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    assert.deepEqual([second.record.plan, second.record.ratePaise, second.record.note, second.record.createdBy, second.record.createdAt.getTime()], ["CP", BigInt(160_000), null, other, first.record.createdAt.getTime()], "keeps the first spelling and creation moment");
    assert.deepEqual([second.before?.ratePaise, second.before?.note], [BigInt(150_000), "New year"]);
    await run((r) => r.planRates.upsert({ plan: "CP", effectiveFrom: "2025-04-01", ratePaise: BigInt(120_000), note: null }, ACTOR));
    await run((r) => r.planRates.upsert({ plan: "MAP", effectiveFrom: "2026-04-01", ratePaise: BigInt(200_000), note: null }, ACTOR));
    const list = await run((r) => r.planRates.list());
    assert.deepEqual(list.map((x) => [x.plan, x.effectiveFrom]).slice(0, 2).sort(), [["CP", "2026-04-01"], ["MAP", "2026-04-01"]].sort());
    assert.equal(list.at(-1)?.effectiveFrom, "2025-04-01");
    assert.equal((await run((r) => r.planRates.get(first.record.id)))?.ratePaise, BigInt(160_000));
    assert.equal(await run((r) => r.planRates.get(newId())), null);
    assert.equal(await run((r) => r.planRates.remove(list.at(-1)?.id as string)), true);
    assert.equal(await run((r) => r.planRates.remove(list.at(-1)?.id as string)), false);
    await insertRow(owner, hotel.schema, "bill_master_bills", { bill_date: "2026-03-10", plan_food_amount_paise: 5000 });
    await insertRow(owner, hotel.schema, "bill_master_bills", { bill_date: "2026-03-31", plan_food_amount_paise: 2500 });
    const gone = await insertRow(owner, hotel.schema, "bill_master_bills", { bill_date: "2026-03-15", plan_food_amount_paise: 99_999 });
    await owner.query(`UPDATE "${hotel.schema}".bill_master_bills SET deleted_at = now(), version = version + 1 WHERE id = $1`, [gone.id]);
    await insertRow(owner, hotel.schema, "bill_master_bills", { bill_date: "2026-04-01", plan_food_amount_paise: 7777 });
    assert.equal(await run((r) => r.planRates.planFoodOwed("2026-03-01", "2026-04-01")), BigInt(7500), "bills dated in [from, to): a deleted bill and the next month's are left out");
    assert.equal(await run((r) => r.planRates.planFoodOwed("2030-01-01", "2030-02-01")), BigInt(0));
    await assert.rejects(() => run((r) => r.planRates.upsert({ plan: "BAD", effectiveFrom: "2026-05-01", ratePaise: BigInt(-1), note: null }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
  });
});

describe("option lists (Master Data)", () => {
  test("the seeded lists in their order; a list by key; items in order; items added last; defaults; value taken without regard to case", async () => {
    const sets = await run((r) => r.optionSets.sets());
    assert.equal(sets.length, 10);
    assert.ok(sets.every((s, i) => i === 0 || sets[i - 1].sortOrder <= s.sortOrder));
    const set = (await run((r) => r.optionSets.setByKey("revenue_depositor_hotel"))) as NonNullable<Awaited<ReturnType<AdminRepos["optionSets"]["setByKey"]>>>;
    assert.deepEqual([set.key, set.isSystem, ["select", "radio", "checkbox"].includes(set.input)], ["revenue_depositor_hotel", true, true]);
    assert.equal(await run((r) => r.optionSets.setByKey("nope")), null);
    assert.deepEqual(await run((r) => r.optionSets.items(set.id)), [], "a new hotel's lists are empty");
    const a = await run((r) => r.optionSets.createItem(set.id, { label: "Front desk", value: "Front desk", color: "#112233", isActive: true, isDefault: true }));
    const b = await run((r) => r.optionSets.createItem(set.id, { label: "Manager", value: "Manager", color: null, isActive: true, isDefault: false }));
    const c = await run((r) => r.optionSets.createItem(set.id, { label: "Owner", value: "Owner", color: null, isActive: false, isDefault: false }));
    assert.deepEqual([a.sortOrder, b.sortOrder, c.sortOrder], [1, 2, 3]);
    assert.deepEqual((await run((r) => r.optionSets.items(set.id))).map((x) => x.label), ["Front desk", "Manager", "Owner"]);
    assert.equal(await run((r) => r.optionSets.valueTaken(set.id, "FRONT DESK")), true);
    assert.equal(await run((r) => r.optionSets.valueTaken(set.id, "front desk", a.id)), false);
    assert.equal((await run((r) => r.optionSets.item(b.id)))?.label, "Manager");
    assert.equal(await run((r) => r.optionSets.item(newId())), null);
    await assert.rejects(() => run((r) => r.optionSets.createItem(set.id, { label: "Dup", value: "Manager", color: null, isActive: true, isDefault: false })), (e) => e instanceof RepoError && e.kind === "unique");
    assert.deepEqual((await run((r) => r.optionSets.items(set.id))).filter((i) => i.isDefault).map((i) => i.label), ["Front desk"]);
    await run((r) => r.optionSets.updateItem(b.id, { isDefault: true, label: "Floor manager", color: "#abcdef" }));
    await run((r) => r.optionSets.clearDefaultsExcept(set.id, b.id));
    assert.deepEqual((await run((r) => r.optionSets.items(set.id))).filter((i) => i.isDefault).map((i) => i.label), ["Floor manager"], "only one option of a list is pre-selected");
    await assert.rejects(() => run((r) => r.optionSets.updateItem(newId(), { label: "x" })), (e) => e instanceof RepoError);
    assert.equal((await run((r) => r.optionSets.updateItem(a.id, {}))).label, "Front desk", "an empty patch changes nothing");
  });

  test("swap moves an item one place up or down and refuses at the ends; remove an item; remove a list with its items", async () => {
    const set = (await run((r) => r.optionSets.setByKey("revenue_depositor_food"))) as { id: string };
    const items = [] as { id: string }[];
    for (const name of ["One", "Two", "Three"]) items.push(await run((r) => r.optionSets.createItem(set.id, { label: name, value: name, color: null, isActive: true, isDefault: false })));
    const labels = async () => (await run((r) => r.optionSets.items(set.id))).map((x) => x.label);
    assert.equal(await run((r) => r.optionSets.swap(items[0].id, "up")), false, "nowhere to go");
    assert.equal(await run((r) => r.optionSets.swap(items[2].id, "down")), false);
    assert.equal(await run((r) => r.optionSets.swap(items[2].id, "up")), true);
    assert.deepEqual(await labels(), ["One", "Three", "Two"]);
    assert.equal(await run((r) => r.optionSets.swap(items[0].id, "down")), true);
    assert.deepEqual(await labels(), ["Three", "One", "Two"]);
    assert.equal(await run((r) => r.optionSets.swap(newId(), "up")), false);
    assert.equal(await run((r) => r.optionSets.removeItem(items[1].id)), true);
    assert.equal(await run((r) => r.optionSets.removeItem(items[1].id)), false);
    assert.deepEqual(await labels(), ["Three", "One"]);
    const extra = await owner.query(`INSERT INTO "${hotel.schema}".option_sets (key, name) VALUES ('temp_list', 'Temp') RETURNING id`);
    const temp = String(extra.rows[0].id);
    await run((r) => r.optionSets.createItem(temp, { label: "T1", value: "T1", color: null, isActive: true, isDefault: false }));
    assert.equal(await run((r) => r.optionSets.removeSet(temp)), true);
    assert.equal(await run((r) => r.optionSets.removeSet(temp)), false);
    assert.deepEqual(await run((r) => r.optionSets.items(temp)), [], "the list's items went with it");
  });
});

after(async () => {
  await releaseTestLock?.();
});
