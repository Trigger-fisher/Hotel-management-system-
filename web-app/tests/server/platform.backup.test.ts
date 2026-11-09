// The nightly backup copy (MJ's plan T6): every live hotel's records, read as the Super Admin export reads them, gzipped into the private store under
// backups/<hotel>/, one row per run in platform.hotel_backups; a failed hotel is recorded and the others still run; old copies are pruned (14 daily
// copies, Sundays for 8 weeks); no store = nothing happens; the cron route needs the CRON_SECRET; Platform health shows the newest copy.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, test } from "node:test";
import { GET as cronBackup } from "../../src/app/api/v1/cron/backup/route";
import { configureCron } from "../../src/server/compose/cron";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryMediaStore } from "../../src/server/media/store";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createBackupService, keepBackup } from "../../src/server/services/backup/backupService";
import { createCronService } from "../../src/server/services/cron/cronService";
import { catalog } from "./helpers/session";

const H = { sunrise: randomUUID(), gir: randomUUID(), pending: randomUUID(), old: randomUUID() };
const SECRET = "s".repeat(40);
let clock = new Date("2026-10-13T20:30:00.000Z");
const now = (): Date => clock;

function world() {
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const meta = (slug: string, over: Partial<MemHotelMeta> = {}): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-06-01T10:00:00+05:30"), provisionedAt: new Date("2026-06-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null, ...over,
  });
  const hotel = (id: string, name: string, status: string, slug: string, over: Partial<MemHotelMeta> = {}): void => {
    auth.data().hotels.push({ id, name, status } as never);
    cons.data.hotels.set(id, meta(slug, over));
  };
  hotel(H.sunrise, "Hotel Sunrise", "active", "hotel-sunrise");
  hotel(H.gir, "Gir Forest Lodge", "suspended", "gir-forest-lodge");
  hotel(H.pending, "Moonlight Inn", "pending_approval", "moonlight-inn", { provisionedAt: null });
  hotel(H.old, "Old Palace", "archived", "old-palace", { archivedAt: new Date("2026-06-27T10:00:00+05:30") });
  const store = createMemoryMediaStore();
  const reads: string[] = [];
  const failing = new Set<string>();
  const reported: string[] = [];
  const service = createBackupService({
    unit: cons.unit, store, now,
    readHotel: async (hotelId) => {
      reads.push(hotelId);
      if (failing.has(hotelId)) throw new Error("permission denied for table x");
      return { ndjson: `{"kind":"hotel","row":{"id":"${hotelId}"}}\n{"kind":"table","table":"rooms","row":{"number":"101"}}\n`, tables: 1, rows: 2 };
    },
    report: (message, _error, hotelId) => reported.push(`${message} ${hotelId === H.gir ? "gir" : "sunrise"}`),
  });
  return { auth, cons, store, reads, failing, reported, service };
}

describe("the nightly backup copy (T6)", () => {
  beforeEach(() => {
    clock = new Date("2026-10-13T20:30:00.000Z");
  });

  test("every live hotel (active, suspended with a schema) gets a gzip NDJSON copy in the store and a ready row; the rest are left out", async () => {
    const w = world();
    const r = await w.service.run();
    assert.deepEqual(r, { configured: true, hotels: 2, done: 2, failed: 0, skipped: 0, pruned: 0 });
    assert.deepEqual(w.reads.sort(), [H.sunrise, H.gir].sort());
    const rows = w.cons.data.backups;
    assert.equal(rows.length, 2);
    const sunrise = rows.find((b) => b.hotelId === H.sunrise)!;
    assert.equal(sunrise.status, "ready");
    assert.match(sunrise.fileName, /^backup-2026-10-14-[0-9a-f]{8}\.ndjson\.gz$/, "named by the IST day (02:00 IST is the next day)");
    assert.equal(sunrise.fileRef, `backups/${H.sunrise}/${sunrise.fileName}`);
    assert.deepEqual([sunrise.tableCount, sunrise.rowCount], [1, 2]);
    const file = w.store.files.get(`${H.sunrise}/${sunrise.fileName}`)!;
    assert.ok(file, "the file is in the store under the hotel's folder");
    assert.equal(file.length, sunrise.byteSize);
    assert.equal(createHash("sha256").update(file).digest("hex"), sunrise.sha256);
    assert.ok(gunzipSync(file).toString("utf8").includes('"table":"rooms"'), "the gzip holds the export lines");
    const latest = await w.cons.unit.run((repos) => repos.backups.latestOf([H.sunrise, H.gir, H.pending]));
    assert.deepEqual([...latest.keys()].sort(), [H.sunrise, H.gir].sort());
  });

  test("a hotel whose read fails is recorded as failed with the step name and the others still run; no hotel data in the report", async () => {
    const w = world();
    w.failing.add(H.gir);
    const r = await w.service.run();
    assert.deepEqual([r.done, r.failed], [1, 1]);
    const gir = w.cons.data.backups.find((b) => b.hotelId === H.gir)!;
    assert.deepEqual([gir.status, gir.errorCode], ["failed", "read"]);
    assert.deepEqual(w.reported, ["backup: the read step failed gir"]);
    assert.equal((await w.cons.unit.run((repos) => repos.backups.latestOf([H.gir]))).size, 0, "a failed run is never the newest copy");
  });

  test("pruning: the last 14 daily copies stay, a Sunday copy stays for 8 weeks, older files and rows go", async () => {
    const w = world();
    const day = (n: number): Date => new Date(clock.getTime() - n * 86_400_000);
    const seed = async (n: number): Promise<string> => {
      const fileName = `backup-old-${n}.ndjson.gz`;
      await w.store.put(H.sunrise, fileName, new Uint8Array([1, 2, 3]));
      await w.cons.unit.run((repos) => repos.backups.record({ hotelId: H.sunrise, status: "ready", fileName, fileRef: `backups/${H.sunrise}/${fileName}`, byteSize: 3, sha256: "a".repeat(64), tableCount: 1, rowCount: 1, startedAt: day(n), finishedAt: day(n) }));
      return fileName;
    };
    // 13 Oct 2026 (Tue) 20:30 UTC = 14 Oct 02:00 IST. 13 days ago stays; 20 days ago (Thu) goes; 24 Sep 20:30 UTC = Fri 25 Sep IST goes;
    // 26 Sep 2026 20:30 UTC = Sun 27 Sep IST (17 days) stays as a Sunday; 60 days ago goes even if a Sunday
    const keep13 = await seed(13);
    const go20 = await seed(20);
    const sunday17 = await seed(17);
    const go60 = await seed(60);
    assert.equal(new Date(day(17).getTime() + 330 * 60_000).getUTCDay(), 0, "the 17-day-old copy is a Sunday in IST");
    const r = await w.service.run();
    assert.equal(r.pruned, 2);
    const left = w.cons.data.backups.filter((b) => b.hotelId === H.sunrise).map((b) => b.fileName).sort();
    assert.ok(left.includes(keep13) && left.includes(sunday17) && !left.includes(go20) && !left.includes(go60), left.join(","));
    assert.equal(left.length, 3, "the two kept plus tonight's");
    assert.deepEqual([w.store.files.has(`${H.sunrise}/${go20}`), w.store.files.has(`${H.sunrise}/${keep13}`)], [false, true]);
    assert.deepEqual([keepBackup(day(0), clock), keepBackup(day(14), clock), keepBackup(day(56), clock)], [true, false, false]);
  });

  test("no store (Vercel without a bucket): configured false, nothing read, nothing recorded; the time budget skips the hotels not started", async () => {
    const w = world();
    const none = createBackupService({ unit: w.cons.unit, store: null, now, readHotel: async () => { throw new Error("never"); } });
    assert.deepEqual(await none.run(), { configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 });
    let t = 0;
    const slow = createBackupService({ unit: w.cons.unit, store: w.store, budgetMs: 1000, now: () => new Date(clock.getTime() + (t += 700)), readHotel: async (id) => ({ ndjson: `${id}\n`, tables: 0, rows: 1 }) });
    const r = await slow.run();
    assert.deepEqual([r.hotels, r.done + r.skipped, r.skipped >= 1], [2, 2, true]);
  });

  test("GET /api/v1/cron/backup: the CRON_SECRET gates it and the answer is the run's summary", async () => {
    const w = world();
    configureCron(createCronService({ secret: () => SECRET, drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => ({ hotels: 0, queued: 0, skipped: 0, failed: 0 }), backup: () => w.service.run() }));
    configureRoutes({ resolveSession: async () => null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
    const call = (authorization?: string): Promise<Response> => cronBackup(new Request("https://hms.test/api/v1/cron/backup", { method: "GET", headers: { host: "hms.test", ...(authorization ? { authorization } : {}) } }));
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer nope")).status, 401);
    const ok = await call(`Bearer ${SECRET}`);
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).data, { configured: true, hotels: 2, done: 2, failed: 0, skipped: 0, pruned: 0 });
  });
  afterEach(() => configureCron(null));
});
