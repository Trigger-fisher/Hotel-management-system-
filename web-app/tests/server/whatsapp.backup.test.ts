// The encrypted WhatsApp backup (4 Nov 2026): a copy is compressed then encrypted, bound to its scope and day, one per scope per day, retained for the keep days, and can be opened and checked.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.backup.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import type { RawObjects } from "@/server/mail/files";
import { BACKUP_PREFIX, backupDay, backupKey, backupKeyOf, decryptBackup, encryptBackup, runBackup, verifyBackups, type BackupScope, type BackupSource } from "@/server/whatsapp/backup";

const KEY = randomBytes(32);
const HOTEL = "00000000-0000-4000-8000-0000000000b1";
const HOTEL2 = "00000000-0000-4000-8000-0000000000b2";
const NOW = new Date("2026-11-04T22:00:00Z"); // 3:30 am on 5 Nov in India
const DAY = "2026-11-05";
const platform: BackupScope = { kind: "platform" };

const objects = (): RawObjects & { map: Map<string, { bytes: Uint8Array; modified: Date }> } => {
  const map = new Map<string, { bytes: Uint8Array; modified: Date }>();
  return {
    map,
    put: async (key, bytes) => void map.set(key, { bytes, modified: NOW }),
    get: async (key) => map.get(key)?.bytes ?? null,
    size: async (key) => map.get(key)?.bytes.length ?? null,
    remove: async (key) => void map.delete(key),
    list: async (prefix) => [...map].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.bytes.length, modified: v.modified })),
  };
};
const source = (hotels: string[] = [HOTEL, HOTEL2], fail: string[] = []): BackupSource => ({
  hotelIds: async () => hotels,
  exportScope: async (scope) => {
    const name = scope.kind === "hotel" ? `hotels/${scope.hotelId}` : "platform";
    if (fail.includes(name)) throw new Error("boom");
    return [JSON.stringify({ t: "_header", v: 1, scope: name, day: DAY, at: NOW.toISOString() }), JSON.stringify({ t: "conv_messages", r: { id: "m1", wa_text: "Is breakfast included?" } }), JSON.stringify({ t: "wa_optouts", r: { phone_digits: "919825041236" } })].join("\n") + "\n";
  },
});

describe("a backup file", () => {
  test("it opens with the key, scope and day it was made for, and with nothing else; the bucket never holds readable text", () => {
    const blob = encryptBackup(KEY, '{"t":"conv_messages","r":{"wa_text":"secret hello"}}\n', { kind: "hotel", hotelId: HOTEL }, DAY);
    assert.equal(blob.includes(Buffer.from("secret hello")), false, "not in the clear");
    assert.equal(blob.includes(Buffer.from("conv_messages")), false, "not even compressed text");
    assert.match(decryptBackup(KEY, blob, { kind: "hotel", hotelId: HOTEL }, DAY), /secret hello/);
    for (const [k, s, d] of [[randomBytes(32), { kind: "hotel", hotelId: HOTEL }, DAY], [KEY, { kind: "hotel", hotelId: HOTEL2 }, DAY], [KEY, platform, DAY], [KEY, { kind: "hotel", hotelId: HOTEL }, "2026-11-06"]] as const) {
      assert.throws(() => decryptBackup(k, blob, s, d), /could not be opened/);
    }
    const damaged = Buffer.from(blob);
    damaged[damaged.length - 3] ^= 0xff;
    assert.throws(() => decryptBackup(KEY, damaged, { kind: "hotel", hotelId: HOTEL }, DAY), /could not be opened/);
    assert.throws(() => decryptBackup(KEY, Buffer.from("not a backup at all, just some text here"), platform, DAY), /could not be opened/);
  });

  test("the key comes from the server's hash key (stable), or from WHATSAPP_BACKUP_KEY when it is a good 32-byte value", () => {
    const hash = randomBytes(32);
    assert.deepEqual(backupKeyOf(hash), backupKeyOf(hash));
    assert.notDeepEqual(backupKeyOf(hash), backupKeyOf(randomBytes(32)));
    const own = randomBytes(32);
    assert.deepEqual(backupKeyOf(hash, own.toString("base64")), own);
    assert.deepEqual(backupKeyOf(hash, "too short"), backupKeyOf(hash), "a bad override falls back to the derived key");
    assert.equal(backupDay(NOW), DAY, "the day is India's");
    assert.equal(backupKey({ kind: "hotel", hotelId: HOTEL }, DAY), `${BACKUP_PREFIX}hotels/${HOTEL}/2026-11-05.ndjson.gz.enc`);
  });
});

describe("running the backup", () => {
  test("one copy per scope per day; a second pass writes nothing; a long list is done a few at a time", async () => {
    const o = objects();
    const first = await runBackup({ source: source(), objects: o, key: KEY, now: NOW, limit: 2 });
    assert.deepEqual([first.written, first.remaining, first.failed], [2, 1, 0]);
    const second = await runBackup({ source: source(), objects: o, key: KEY, now: NOW, limit: 2 });
    assert.deepEqual([second.written, second.alreadyDone, second.remaining], [1, 2, 0]);
    const third = await runBackup({ source: source(), objects: o, key: KEY, now: NOW, limit: 2 });
    assert.deepEqual([third.written, third.alreadyDone], [0, 3]);
    assert.deepEqual([...o.map.keys()].sort(), [backupKey(platform, DAY), backupKey({ kind: "hotel", hotelId: HOTEL }, DAY), backupKey({ kind: "hotel", hotelId: HOTEL2 }, DAY)].sort());
  });

  test("a scope that fails is counted and the others still get theirs; copies older than the keep days are removed", async () => {
    const o = objects();
    o.map.set(`${BACKUP_PREFIX}platform/2026-10-01.ndjson.gz.enc`, { bytes: new Uint8Array(40), modified: new Date("2026-10-01T22:00:00Z") });
    const r = await runBackup({ source: source([HOTEL, HOTEL2], [`hotels/${HOTEL}`]), objects: o, key: KEY, now: NOW, limit: 5, keepDays: 14 });
    assert.deepEqual([r.written, r.failed, r.removed], [2, 1, 1]);
    assert.equal(o.map.has(`${BACKUP_PREFIX}platform/2026-10-01.ndjson.gz.enc`), false);
  });
});

describe("checking the backups", () => {
  test("the newest copy of every scope is opened and counted; none yet, a wrong key, and a copy moved to another name are said in words", async () => {
    const o = objects();
    assert.equal((await verifyBackups({ objects: o, key: KEY })).ok, false);
    await runBackup({ source: source(), objects: o, key: KEY, now: NOW, limit: 5 });
    const ok = await verifyBackups({ objects: o, key: KEY });
    assert.deepEqual([ok.ok, ok.checked, ok.lines, ok.newestDay], [true, 3, 6, DAY]);
    assert.match(ok.message, /3 backups opened/);
    const wrong = await verifyBackups({ objects: o, key: randomBytes(32) });
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /key changed|damaged/);
    // a copy renamed to another hotel's name does not open (it is bound to its own scope)
    const swapped = objects();
    await runBackup({ source: source([HOTEL]), objects: swapped, key: KEY, now: NOW, limit: 5 });
    swapped.map.set(backupKey({ kind: "hotel", hotelId: HOTEL2 }, DAY), swapped.map.get(backupKey({ kind: "hotel", hotelId: HOTEL }, DAY)) as never);
    assert.equal((await verifyBackups({ objects: swapped, key: KEY })).ok, false);
  });
});
