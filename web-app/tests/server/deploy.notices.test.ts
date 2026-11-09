// The deployment warnings (src/server/ops/notices.ts) and the photo store of a server without a lasting disk (media/store.ts createUnavailableMediaStore):
// on Vercel with MEDIA_DRIVER=local and a database, every photo upload answers a plain 409 CONFLICT (never NETWORK_OFFLINE: the browser would show its offline text) "Photo storage is not set up on this server yet" instead of a
// 500, reading a photo stays 404, and the same warning (with the database login check) is a plain sentence for the boot log and System Health.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { GET as getPhotoRoute, PUT as putPhotoRoute } from "../../src/app/api/v1/front-office/stays/[id]/id-photo/route";
import { GET as mediaGet } from "../../src/app/api/v1/website/media/[file]/route";
import { GET as photosGet, POST as photosPost } from "../../src/app/api/v1/website/photos/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureIdPhotos, getIdPhotoStore } from "../../src/server/compose/frontOffice";
import { buildWebsiteServices, configureWebsite, memoryOAuthStates, noGoogle } from "../../src/server/compose/website";
import { loadConfig, mediaDriverOf, resetConfigCache } from "../../src/server/config/env";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createUnavailableMediaStore, PHOTO_STORAGE_UNAVAILABLE } from "../../src/server/media/store";
import { databaseRole, deployNotices, PHOTO_STORAGE_NOTICE, roleNotice } from "../../src/server/ops/notices";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { createBillService } from "../../src/server/services/billing/billService";
import type { Person } from "../../src/server/services/cash/ports";
import { createIdPhotoService } from "../../src/server/services/frontOffice/idPhotoService";
import { createReservationService } from "../../src/server/services/frontOffice/reservationService";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const DB = "postgresql://someone:Sup3rSecretValue@db.example.in:5432/hms";

describe("the notices builder (pure: config + the database login)", () => {
  test("Vercel + local media + a database: the photo storage notice; s3, no Vercel or no database: none", () => {
    assert.deepEqual(deployNotices({ VERCEL: "1", MEDIA_DRIVER: "local", DATABASE_URL: DB }, "hms_app"), [PHOTO_STORAGE_NOTICE]);
    assert.equal(PHOTO_STORAGE_NOTICE, "Photo storage is not set up on this server yet: uploads of photos are refused until MEDIA_DRIVER=s3 and the S3 settings are set.");
    assert.deepEqual(deployNotices({ VERCEL: "1", MEDIA_DRIVER: "s3", DATABASE_URL: DB }, "hms_app"), []);
    assert.deepEqual(deployNotices({ VERCEL: undefined, MEDIA_DRIVER: "local", DATABASE_URL: DB }, "hms_app"), []);
    assert.deepEqual(deployNotices({ VERCEL: "1", MEDIA_DRIVER: "local", DATABASE_URL: undefined }, null), [], "no database: the in-memory store, nothing to warn");
    // MEDIA_DRIVER unset through the real config reader: a hosted server keeps photos in the database (no notice); the disk only when someone sets local on purpose
    assert.deepEqual(deployNotices(loadConfig({ VERCEL: "1", DATABASE_URL: DB }), "hms_app"), []);
    assert.deepEqual(deployNotices(loadConfig({ VERCEL: "1", DATABASE_URL: DB, MEDIA_DRIVER: "local" }), "hms_app"), [PHOTO_STORAGE_NOTICE]);
    assert.deepEqual(deployNotices({ VERCEL: "1", MEDIA_DRIVER: "db", DATABASE_URL: DB }, "hms_app"), []);
    assert.equal(mediaDriverOf(loadConfig({ VERCEL: "1", DATABASE_URL: DB })), "db");
    assert.equal(mediaDriverOf(loadConfig({})), "local");
  });

  test("a login other than hms_app is named (the name only, never the connection string); unknown or no database: nothing", () => {
    assert.deepEqual(deployNotices({ VERCEL: undefined, MEDIA_DRIVER: "local", DATABASE_URL: DB }, "neondb_owner"), ["The app is connected to the database as neondb_owner, not hms_app: use the hms_app login in DATABASE_URL."]);
    assert.equal(roleNotice("postgres"), "The app is connected to the database as postgres, not hms_app: use the hms_app login in DATABASE_URL.");
    assert.deepEqual(deployNotices({ VERCEL: undefined, MEDIA_DRIVER: "local", DATABASE_URL: DB }, null), []);
    assert.deepEqual(deployNotices({ VERCEL: undefined, MEDIA_DRIVER: "local", DATABASE_URL: undefined }, "postgres"), []);
    const both = deployNotices({ VERCEL: "1", MEDIA_DRIVER: "local", DATABASE_URL: DB }, "postgres");
    assert.deepEqual(both, [PHOTO_STORAGE_NOTICE, roleNotice("postgres")]);
    assert.ok(!JSON.stringify(both).includes("Sup3rSecretValue") && !JSON.stringify(both).includes("db.example.in"));
  });

  test("databaseRole asks SELECT current_user once on one connection, releases it, and never throws", async () => {
    const asked: string[] = [];
    let released = 0;
    const pool = (rows: unknown[]) => ({ connect: async () => ({ query: async (sql: string) => (asked.push(sql), { rows }), release: () => void (released += 1) }) });
    assert.equal(await databaseRole(pool([{ role: "hms_app" }])), "hms_app");
    assert.deepEqual([asked, released], [["SELECT current_user AS role"], 1]);
    assert.equal(await databaseRole(pool([])), null);
    assert.equal(await databaseRole({ connect: async () => Promise.reject(new Error("down")) }), null);
  });
});

/* ---------------------------------------------------------------- the routes with the unavailable store */

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Meera Manager", roleKey: "editor", roleLevel: 2, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("manager", makeSession({ userId: id(1), client: "web", roleKey: "editor", roleLevel: 2, grants: [grant("website", "full"), grant("pms.stays", "full")] }));

function wire(): void {
  const hotel = createMemoryHotel();
  const store = createUnavailableMediaStore();
  const people_ = { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) };
  const base = { unit: hotel.unit, people: people_, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-05T10:00:00+05:30") };
  configureWebsite(buildWebsiteServices({ ...base, reservations: createReservationService({ ...base, bills: createBillService(base) }), mail: { enquiryConfirmed: async () => "off", enquiryDeclined: async () => "off" }, google: noGoogle, oauthStates: memoryOAuthStates(), media: store, publicUrl: "https://hms.test" }));
  configureIdPhotos({ store, service: createIdPhotoService({ unit: hotel.unit, people: people_, catalog, photos: store }) });
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "x-test-session": "manager" };
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
const refused = async (res: Response): Promise<void> => {
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.deepEqual([res.status, body.error.code, body.error.message], [409, "CONFLICT", PHOTO_STORAGE_UNAVAILABLE]);
};

describe("photo storage not set up (Vercel, MEDIA_DRIVER=local)", () => {
  beforeEach(wire);
  afterEach(() => {
    configureIdPhotos(null);
    configureWebsite(null);
  });

  test("the guest ID photo upload answers a plain 409 CONFLICT (never NETWORK_OFFLINE: the browser would show its offline text) with the sentence; reading one stays 404", async () => {
    const stay = id(500);
    await refused(await putPhotoRoute(req("PUT", `/api/v1/front-office/stays/${stay}/id-photo`, { fileName: "id.png", dataBase64: PNG, version: 1 }), ctx({ id: stay })));
    assert.equal((await getPhotoRoute(req("GET", `/api/v1/front-office/stays/${stay}/id-photo`), ctx({ id: stay }))).status, 404);
  });

  test("a website gallery upload answers a plain 409 CONFLICT (never NETWORK_OFFLINE: the browser would show its offline text) with the sentence (no row is kept); a media file answers 404", async () => {
    await refused(await photosPost(req("POST", "/api/v1/website/photos", { caption: "Lobby", files: [{ fileName: "a.png", dataBase64: PNG }] }), ctx()));
    const list = await photosGet(req("GET", "/api/v1/website/photos"), ctx());
    assert.deepEqual(((await list.json()) as { data: unknown[] }).data, []);
    assert.equal((await mediaGet(req("GET", "/api/v1/website/media/lobby.png"), ctx({ file: "lobby.png" }))).status, 404);
  });

  test("the composition root picks it on Vercel with MEDIA_DRIVER=local and a database (no connection is made)", async () => {
    const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, MEDIA_DRIVER: process.env.MEDIA_DRIVER };
    const restore = (key: keyof typeof saved): void => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    };
    try {
      Object.assign(process.env, { VERCEL: "1", DATABASE_URL: DB, MEDIA_DRIVER: "local" });
      resetConfigCache();
      configureIdPhotos(null);
      await assert.rejects(getIdPhotoStore().put(HOTEL_A, "id-abc.png", new Uint8Array([1])), (e: Error & { code?: string }) => e.code === "CONFLICT" && e.message === PHOTO_STORAGE_UNAVAILABLE);
      assert.equal(await getIdPhotoStore().get(HOTEL_A, "id-abc.png"), null);
    } finally {
      restore("VERCEL");
      restore("DATABASE_URL");
      restore("MEDIA_DRIVER");
      resetConfigCache();
      configureIdPhotos(null);
    }
  });
});
