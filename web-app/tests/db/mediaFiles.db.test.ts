// The database-backed media store (MEDIA_DRIVER=db, platform migration 0137, platform.media_files) on the real PostgreSQL, as the app's own login (hms_app): put, get, replace,
// has, remove; an owner and a bucket never see another's file; the CHECKs; and a database without 0137 answers a plain sentence (no 500).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createDbMediaStore, MEDIA_TABLE_MISSING } from "../../src/server/media/db";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
const HOTEL_A = "00000000-0000-4000-8000-0000000000a1";
const HOTEL_B = "00000000-0000-4000-8000-0000000000b2";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 3 });
});
after(async () => {
  await owner?.query("DELETE FROM platform.media_files WHERE owner_id IN ($1, $2)", [HOTEL_A, HOTEL_B]).catch(() => undefined);
  await database?.close();
  await owner?.end();
  await release?.();
});

describe("platform.media_files (0137) through createDbMediaStore", () => {
  test("the migration is recorded", async () => {
    assert.equal((await owner.query("SELECT 1 FROM platform.schema_migrations WHERE version = '0137_media_files'")).rows.length, 1);
  });

  test("put, get, has, replace, remove; the content type follows the name; a second put replaces", async () => {
    const store = createDbMediaStore(database.pool, "id-photos");
    assert.equal(await store.has(HOTEL_A, "id-aaa.jpg"), false);
    assert.equal(await store.get(HOTEL_A, "id-aaa.jpg"), null);
    assert.equal(await store.put(HOTEL_A, "id-aaa.jpg", JPG), "id-aaa.jpg");
    const got = await store.get(HOTEL_A, "id-aaa.jpg");
    assert.deepEqual([Array.from(got!.bytes), got!.contentType], [Array.from(JPG), "image/jpeg"]);
    assert.equal(await store.has(HOTEL_A, "id-aaa.jpg"), true);
    await store.put(HOTEL_A, "id-aaa.jpg", new Uint8Array([9, 9, 9]));
    assert.deepEqual(Array.from((await store.get(HOTEL_A, "id-aaa.jpg"))!.bytes), [9, 9, 9], "replaced, not duplicated");
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.media_files WHERE owner_id = $1", [HOTEL_A])).rows[0].n), 1);
    await store.remove(HOTEL_A, "id-aaa.jpg");
    assert.equal(await store.has(HOTEL_A, "id-aaa.jpg"), false);
    await store.remove(HOTEL_A, "id-aaa.jpg");
  });

  test("another hotel and another store never see the file; an unsafe name or owner is refused before any query", async () => {
    const ids = createDbMediaStore(database.pool, "id-photos");
    const menu = createDbMediaStore(database.pool, "menu-photos");
    await ids.put(HOTEL_A, "same.jpg", JPG);
    assert.equal(await ids.get(HOTEL_B, "same.jpg"), null, "the other hotel");
    assert.equal(await menu.get(HOTEL_A, "same.jpg"), null, "the other store of the same hotel");
    await menu.put(HOTEL_A, "same.jpg", new Uint8Array([7]));
    assert.deepEqual(Array.from((await ids.get(HOTEL_A, "same.jpg"))!.bytes), Array.from(JPG), "each store keeps its own");
    await ids.remove(HOTEL_B, "same.jpg");
    assert.equal(await ids.has(HOTEL_A, "same.jpg"), true, "the other hotel's remove touched nothing");
    await assert.rejects(() => ids.get(HOTEL_A, "../x.jpg"), /Not a stored file name/);
    await assert.rejects(() => ids.put("not-a-uuid", "a.jpg", JPG), /Not a stored file name/);
    await assert.rejects(() => ids.put(HOTEL_A, "script.php", JPG), /Not a stored file name/);
  });

  test("the table's own CHECKs hold (bucket, name, size, content type)", async () => {
    const bad = (sql: string, params: unknown[] = []) => sqlStateOf(owner.query(`INSERT INTO platform.media_files (owner_id, bucket, name, content_type, bytes, size) VALUES ($1, ${sql}`, [HOTEL_A, ...params]));
    assert.equal(await bad("'other', 'a.jpg', 'image/jpeg', '\\x01', 1)"), "23514", "bucket");
    assert.equal(await bad("'id-photos', 'A B.jpg', 'image/jpeg', '\\x01', 1)"), "23514", "name");
    assert.equal(await bad("'id-photos', 'a.jpg', 'text/html', '\\x01', 1)"), "23514", "content type");
    assert.equal(await bad("'id-photos', 'a.jpg', 'image/jpeg', '\\x01', 2)"), "23514", "size must match the bytes");
    assert.equal(await bad("'id-photos', 'big.jpg', 'image/jpeg', '\\x01', 99999999)"), "23514", "size bound");
  });

  test("a database without 0137: put answers the plain sentence (409 CONFLICT, never the offline code), get and has answer nothing, remove does nothing; no 500, no savepoint", async () => {
    await owner.query("ALTER TABLE platform.media_files RENAME TO media_files_hidden");
    try {
      const store = createDbMediaStore(database.pool, "id-photos");
      await assert.rejects(() => store.put(HOTEL_A, "x.jpg", JPG), (e: Error & { code?: string }) => e.code === "CONFLICT" && e.message === MEDIA_TABLE_MISSING);
      assert.equal(await store.get(HOTEL_A, "x.jpg"), null);
      assert.equal(await store.has(HOTEL_A, "x.jpg"), false);
      await store.remove(HOTEL_A, "x.jpg");
    } finally {
      await owner.query("ALTER TABLE platform.media_files_hidden RENAME TO media_files");
    }
  });
});
