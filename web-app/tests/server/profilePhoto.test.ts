// Every login's own profile photo (platform migration 0131), end to end through the REAL route file: a staff member, a guest and a company login each add, replace and
// remove their OWN photo; it is kept as WebP in the private profile-photo store under the person's own id, GET /profile carries its address, and nobody reads another's.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import sharp from "sharp";
import { DELETE as photoDelete, GET as photoGet, PUT as photoPut } from "../../src/app/api/v1/profile/photo/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { configureProfilePhotoStore } from "../../src/server/compose/profilePhotos";
import { createMemoryMediaStore } from "../../src/server/media/store";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import type { Person } from "../../src/server/services/cash/ports";
import { createProfileService, profilePhotoUrl } from "../../src/server/services/admin/profileService";
import { ctx, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>();
sessions.set("staff", makeSession({ userId: pid(1), accountRole: "hotel_user", grants: [grant("masters", "view")] }));
sessions.set("guest", makeSession({ userId: pid(900), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: pid(11) } }));
sessions.set("company", makeSession({ userId: pid(901), accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: pid(12) } }));

let store = createMemoryMediaStore();
let platform = createMemoryAdminPlatform();
let png: Uint8Array;

beforeEach(async () => {
  const world = wirePortal(sessions, () => new Date("2026-10-18T10:00:00+05:30"));
  store = createMemoryMediaStore();
  platform = createMemoryAdminPlatform();
  configureProfilePhotoStore(store);
  const people = { get: async (ids: readonly string[]) => new Map<string, Person>(ids.map((i) => [i, { id: i, name: "Person", roleKey: "admin", roleLevel: 3, deleted: false }])) };
  configureAdmin(buildAdminServices({ unit: world.hotel.unit as never, people, catalog, audit: { record: async () => undefined }, now: () => new Date("2026-10-18T10:00:00+05:30") }, platform.unit));
  png ??= new Uint8Array(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#2e86de" } }).png().toBuffer());
});

const call = (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, method: string, who: string, body?: unknown) => route(req(method, "/api/v1/profile/photo", who, body), ctx({}));
const upload = (who: string, bytes: Uint8Array = png) => call(photoPut, "PUT", who, { fileName: "me.png", dataBase64: Buffer.from(bytes).toString("base64") });
const data = async (res: Response, status = 200) => {
  assert.equal(res.status, status, res.headers.get("content-type")?.includes("json") ? JSON.stringify(await res.clone().json()) : String(res.status));
  return (await json(res)).data;
};

describe("profile photo", () => {
  test("each login adds, replaces and removes its OWN photo; it is a WebP under its own id; the address changes with every photo", async () => {
    for (const who of ["staff", "guest", "company"]) {
      const userId = sessions.get(who)!.userId;
      assert.equal((await call(photoGet, "GET", who)).status, 404, `${who}: no photo yet`);
      const first = await data(await upload(who));
      assert.equal(first.hasPhoto, true);
      assert.match(first.photoUrl, /^\/api\/v1\/profile\/photo\?v=[0-9a-f]{12}$/);
      const seen = await call(photoGet, "GET", who);
      assert.equal(seen.status, 200);
      assert.equal(seen.headers.get("content-type"), "image/webp");
      assert.equal(seen.headers.get("cache-control"), "no-store", "never kept by the browser (review L7)");
      const bytes = new Uint8Array(await seen.arrayBuffer());
      assert.ok(bytes.length <= 1_048_576, "at most 1 MB");
      const meta = await sharp(bytes).metadata();
      assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= 1024, "drawn no larger than 1024 px");
      assert.deepEqual([...store.files.keys()].filter((k) => k.startsWith(`${userId}/`)).length, 1);
      const second = await data(await upload(who));
      assert.notEqual(second.photoUrl, first.photoUrl, "a new photo is a new address");
      assert.deepEqual([...store.files.keys()].filter((k) => k.startsWith(`${userId}/`)).length, 1, "the replaced file is removed");
      assert.deepEqual(await data(await call(photoDelete, "DELETE", who)), { hasPhoto: false, photoUrl: null });
      assert.equal([...store.files.keys()].filter((k) => k.startsWith(`${userId}/`)).length, 0);
      assert.equal((await call(photoGet, "GET", who)).status, 404);
      assert.deepEqual(await data(await call(photoDelete, "DELETE", who)), { hasPhoto: false, photoUrl: null }, "removing nothing is fine");
    }
  });

  test("one person's photo is never another's; not a picture, or too big, is a field error and keeps nothing", async () => {
    await data(await upload("guest"));
    assert.equal((await call(photoGet, "GET", "company")).status, 404, "the company login has none of its own");
    const bad = await upload("staff", new TextEncoder().encode("not a picture"));
    assert.equal(bad.status, 422);
    assert.ok((await json(bad)).error.details.fields.photo);
    const big = await call(photoPut, "PUT", "staff", { fileName: "big.png", dataBase64: Buffer.alloc(10 * 1024 * 1024 + 10, 1).toString("base64") });
    assert.equal(big.status, 422);
    assert.equal([...store.files.keys()].filter((k) => k.startsWith(`${pid(1)}/`)).length, 0);
  });

  test("a failed save leaves no new file behind; without a store the server answers 503 with a sentence", async () => {
    const failing = createProfileService({ platform: { run: async () => { throw new Error("database down"); } }, photos: () => store });
    await assert.rejects(failing.putPhoto(sessions.get("guest")!, { fileName: "me.png", dataBase64: Buffer.from(png).toString("base64") }, { ip: null, traceId: "t" } as never));
    assert.equal(store.files.size, 0);
    const noStore = createProfileService({ platform: platform.unit });
    await assert.rejects(noStore.putPhoto(sessions.get("guest")!, { fileName: "me.png", dataBase64: Buffer.from(png).toString("base64") }, { ip: null, traceId: "t" } as never), /Photo storage is not set up/);
    assert.equal(profilePhotoUrl(null), null);
  });
});

void HOTEL_A;
