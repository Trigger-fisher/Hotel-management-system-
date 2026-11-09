// The SQL of the website design builds (repos/postgres/auth.ts siteBuilds, platform migration 0160) on the REAL PostgreSQL instance (hms_test): the pick is queued, only one
// queued or building build per hotel can exist (the partial unique index), a build moves queued -> building -> live or failed and never back, the CHECKs refuse bad values,
// builds that never finished are failed, and deleting the hotel deletes its builds.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { appUrl, connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let unit: PlatformUnit;
const NOW = new Date("2026-11-01T10:00:00.000Z");
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  unit = createPgPlatformUnit(pool);
});
after(async () => {
  await pool?.end();
  await owner?.end();
  await releaseTestLock?.();
});

const makeHotel = async (): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ($1, $2) RETURNING id", ["Builds Hotel", `b-${tag()}${tag()}`])).rows[0].id);
const next = (status: "building" | "live" | "failed", over: Partial<{ message: string | null; runUrl: string | null; siteUrl: string | null }> = {}) => ({ status, message: null, runUrl: null, siteUrl: null, ...over });

describe("site builds on PostgreSQL", () => {
  test("queue, read back, newest first; a second queued or building build for the hotel is refused (null), another hotel is not affected", async () => {
    const hotel = await makeHotel();
    const other = await makeHotel();
    const first = await unit.run((r) => r.siteBuilds.queue(hotel, "template-3", null, NOW));
    assert.ok(first);
    assert.equal(first.status, "queued");
    assert.equal(first.templateKey, "template-3");
    assert.equal(first.requestedAt.toISOString(), NOW.toISOString());
    assert.equal(first.startedAt, null);
    assert.equal(await unit.run((r) => r.siteBuilds.queue(hotel, "template-5", null, minutes(1))), null, "one at a time");
    assert.ok(await unit.run((r) => r.siteBuilds.queue(other, "template-5", null, minutes(1))), "another hotel may build at the same time");
    assert.equal((await unit.run((r) => r.siteBuilds.byId(first.id)))?.templateKey, "template-3");
    await unit.run((r) => r.siteBuilds.advance(first.id, next("failed", { message: "x" }), minutes(2)));
    const second = await unit.run((r) => r.siteBuilds.queue(hotel, "template-5", null, minutes(3)));
    assert.ok(second, "free again once the first has finished");
    assert.deepEqual((await unit.run((r) => r.siteBuilds.recent(hotel, 10))).map((b) => b.templateKey), ["template-5", "template-3"]);
    assert.equal((await unit.run((r) => r.siteBuilds.recent(hotel, 1))).length, 1);
  });

  test("a build moves queued -> building -> live and keeps the log page and address; a final build never moves again; building is only from queued", async () => {
    const hotel = await makeHotel();
    const b = (await unit.run((r) => r.siteBuilds.queue(hotel, "template-1", null, NOW)))!;
    const building = await unit.run((r) => r.siteBuilds.advance(b.id, next("building", { runUrl: "https://github.com/acme/hms-sites/actions/runs/1" }), minutes(1)));
    assert.equal(building?.status, "building");
    assert.equal(building?.startedAt?.toISOString(), minutes(1).toISOString());
    assert.equal(building?.finishedAt, null);
    assert.equal(await unit.run((r) => r.siteBuilds.advance(b.id, next("building"), minutes(2))), null, "building again is not a move");
    const live = await unit.run((r) => r.siteBuilds.advance(b.id, next("live", { message: "Done", siteUrl: "https://sunrise.example/" }), minutes(3)));
    assert.equal(live?.status, "live");
    assert.equal(live?.runUrl, "https://github.com/acme/hms-sites/actions/runs/1", "the log page of the first report stays");
    assert.equal(live?.siteUrl, "https://sunrise.example/");
    assert.equal(live?.finishedAt?.toISOString(), minutes(3).toISOString());
    assert.equal(live?.startedAt?.toISOString(), minutes(1).toISOString(), "started_at keeps its first value");
    assert.equal(await unit.run((r) => r.siteBuilds.advance(b.id, next("failed"), minutes(4))), null, "a final build never moves");
    assert.equal((await unit.run((r) => r.siteBuilds.byId(b.id)))?.status, "live");
    assert.equal(await unit.run((r) => r.siteBuilds.advance("00000000-0000-4000-8000-0000000000aa", next("live"), minutes(4))), null);
  });

  test("failStale fails only this hotel's unfinished builds asked for before the cut-off", async () => {
    const hotel = await makeHotel();
    const other = await makeHotel();
    const old = (await unit.run((r) => r.siteBuilds.queue(hotel, "template-2", null, NOW)))!;
    const stranger = (await unit.run((r) => r.siteBuilds.queue(other, "template-2", null, NOW)))!;
    assert.equal(await unit.run((r) => r.siteBuilds.failStale(hotel, minutes(-5), "late", minutes(40))), 0, "nothing is older than the cut-off yet");
    assert.equal(await unit.run((r) => r.siteBuilds.failStale(hotel, minutes(30), "late", minutes(40))), 1);
    const row = await unit.run((r) => r.siteBuilds.byId(old.id));
    assert.deepEqual([row?.status, row?.message, row?.finishedAt?.toISOString()], ["failed", "late", minutes(40).toISOString()]);
    assert.equal((await unit.run((r) => r.siteBuilds.byId(stranger.id)))?.status, "queued", "the other hotel's build is not touched");
  });

  test("the database refuses a bad template key, status, http address and a final build without a finish time; deleting the hotel deletes its builds", async () => {
    const hotel = await makeHotel();
    const bad = (sql: string) => owner.query(sql, [hotel]).then(() => "accepted", (e: { code?: string }) => e.code);
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key) VALUES ($1, 'Template 1')"), "23514");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key) VALUES ($1, '../x')"), "23514");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key, status) VALUES ($1, 'template-1', 'done')"), "23514");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key, run_url) VALUES ($1, 'template-1', 'http://plain.example')"), "23514");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key, status) VALUES ($1, 'template-1', 'live')"), "23514", "final without a finish time");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key, status, finished_at) VALUES ($1, 'template-1', 'queued', now())"), "23514", "a finish time on an unfinished build");
    assert.equal(await bad("INSERT INTO platform.hotel_site_builds (hotel_id, template_key) VALUES ($1, 'template-custom-grandpalace')"), "accepted", "a hotel's own custom template key is fine");
    await owner.query("DELETE FROM platform.hotels WHERE id = $1", [hotel]);
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.hotel_site_builds WHERE hotel_id = $1", [hotel])).rows[0].n), 0);
  });
});
