// The room-service menu's category, veg mark and photo (guest portal round 3 a, the last part; hotel migrations 0041 and 0043), end to end through the REAL route files:
// the hotel sets them under Master Data (masters: view to see, edit to change), the photo is kept as WebP in the private menu-photo store, and a signed-in guest of that hotel
// sees all three on the menu. Another hotel's guest and staff cannot reach the photo; a removed photo is gone for everyone.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import sharp from "sharp";
import { POST as itemsPost } from "../../src/app/api/v1/admin/menu/items/route";
import { PATCH as itemPatch } from "../../src/app/api/v1/admin/menu/items/[id]/route";
import { DELETE as photoDelete, GET as photoGet, PUT as photoPut } from "../../src/app/api/v1/admin/menu/items/[id]/photo/route";
import { GET as menuGet } from "../../src/app/api/v1/admin/menu/route";
import { GET as guestMenuGet } from "../../src/app/api/v1/guest/menu/route";
import { GET as guestPhotoGet } from "../../src/app/api/v1/guest/menu/[id]/photo/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { configureMenuPhotos } from "../../src/server/compose/menuPhotos";
import { createMemoryMediaStore } from "../../src/server/media/store";
import type { Person } from "../../src/server/services/cash/ports";
import { createMenuPhotoService } from "../../src/server/services/menu/menuPhotoService";
import { ctx, customer, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const people = new Map<string, Person>([[pid(1), { id: pid(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("editor", makeSession({ userId: pid(1), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] }));
sessions.set("viewer", makeSession({ userId: pid(2), accountRole: "hotel_user", grants: [grant("masters", "view")] }));
sessions.set("editorB", makeSession({ userId: pid(4), hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] }));
sessions.set("guest", makeSession({ userId: pid(900), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: pid(11) } }));
sessions.set("guestB", makeSession({ userId: pid(901), hotelId: HOTEL_B, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: pid(12) } }));

let world = wirePortal(sessions, () => new Date("2026-10-05T10:00:00+05:30"));
let store = createMemoryMediaStore();
let png: Uint8Array;

beforeEach(async () => {
  world = wirePortal(sessions, () => new Date("2026-10-05T10:00:00+05:30"));
  store = createMemoryMediaStore();
  const deps = { people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, catalog };
  configureAdmin(buildAdminServices({ unit: world.hotel.unit as never, ...deps, audit: { record: async () => undefined }, now: () => new Date("2026-10-05T10:00:00+05:30") }));
  configureMenuPhotos({ store, service: createMenuPhotoService({ unit: world.hotel.unit, ...deps, photos: store }) });
  world.hotel.store.dataFor(HOTEL_A).customers.push(customer({ id: pid(11), mobile: "9876543210" }));
  world.hotel.store.dataFor(HOTEL_B).customers.push(customer({ id: pid(12), mobile: "9123456780" }));
  png ??= new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c0392b" } }).png().toBuffer());
});

const call = async (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, method: string, path: string, who: string, body?: unknown, params: Record<string, string> = {}) => route(req(method, path, who, body), ctx(params));
const data = async (res: Response, status = 200) => {
  assert.equal(res.status, status, res.headers.get("content-type")?.includes("json") ? JSON.stringify(await res.clone().json()) : String(res.status));
  return (await json(res)).data;
};
const addThali = async () => (await data(await call(itemsPost, "POST", "/api/v1/admin/menu/items", "editor", { group: "restaurant", name: "Gujarati Thali", note: null, pricePaise: 32000, available: true, category: "Lunch", veg: "yes" }), 201)) as { id: string };
const upload = (id: string, who = "editor", bytes: Uint8Array = png) => call(photoPut, "PUT", `/api/v1/admin/menu/items/${id}/photo`, who, { fileName: "thali.png", dataBase64: Buffer.from(bytes).toString("base64") }, { id });

describe("category and veg on the menu", () => {
  test("the hotel sets them (left out on a later save = unchanged); the guest's menu shows them", async () => {
    const item = await addThali();
    const admin = await data(await call(menuGet, "GET", "/api/v1/admin/menu", "viewer"));
    const row = admin.find((g: { id: string }) => g.id === "restaurant").items[0];
    assert.deepEqual([row.category, row.veg, row.hasPhoto], ["Lunch", "yes", false]);
    await data(await call(itemPatch, "PATCH", `/api/v1/admin/menu/items/${item.id}`, "editor", { name: "Gujarati Thali", note: "With sweet", pricePaise: 34000, available: true }, { id: item.id }));
    const guest = await data(await call(guestMenuGet, "GET", "/api/v1/guest/menu", "guest"));
    const seen = guest.menu.find((g: { id: string }) => g.id === "restaurant").items[0];
    assert.deepEqual([seen.category, seen.veg, seen.photoUrl, seen.note], ["Lunch", "yes", null, "With sweet"], "an older save leaves category and veg alone");
    assert.equal((await call(itemPatch, "PATCH", `/api/v1/admin/menu/items/${item.id}`, "editor", { name: "Gujarati Thali", note: null, pricePaise: 34000, available: true, veg: "maybe" }, { id: item.id })).status, 422);
    assert.equal((await call(itemPatch, "PATCH", `/api/v1/admin/menu/items/${item.id}`, "editor", { name: "Gujarati Thali", note: null, pricePaise: 34000, available: true, category: "x".repeat(61) }, { id: item.id })).status, 422);
  });
});

describe("the photo", () => {
  test("added as WebP in the private store; the hotel and its guests see it; replacing removes the old file; removing makes it 404", async () => {
    const item = await addThali();
    assert.deepEqual(await data(await upload(item.id)), { id: item.id, hasPhoto: true });
    assert.equal(store.files.size, 1);
    const staff = await call(photoGet, "GET", `/api/v1/admin/menu/items/${item.id}/photo`, "viewer", undefined, { id: item.id });
    assert.equal(staff.status, 200);
    assert.equal(staff.headers.get("content-type"), "image/webp");
    const guest = await data(await call(guestMenuGet, "GET", "/api/v1/guest/menu", "guest"));
    const url: string = guest.menu.find((g: { id: string }) => g.id === "restaurant").items[0].photoUrl;
    assert.equal(url, `/api/v1/guest/menu/${item.id}/photo?hotel=${HOTEL_A}`);
    const seen = await call(guestPhotoGet, "GET", url, "guest", undefined, { id: item.id });
    assert.equal(seen.status, 200);
    assert.equal(seen.headers.get("content-type"), "image/webp");
    await data(await upload(item.id));
    assert.equal(store.files.size, 1, "the replaced file is removed");
    assert.deepEqual(await data(await call(photoDelete, "DELETE", `/api/v1/admin/menu/items/${item.id}/photo`, "editor", undefined, { id: item.id })), { id: item.id, hasPhoto: false });
    assert.equal(store.files.size, 0);
    assert.equal((await call(guestPhotoGet, "GET", url, "guest", undefined, { id: item.id })).status, 404);
    const logs = world.hotel.store.dataFor(HOTEL_A).systemLogs.filter((l) => /photo/.test(l.summary));
    assert.equal(logs.length, 3);
  });

  test("not a picture, too big, or a type not allowed is a field error; view cannot change it; another hotel's staff and guests cannot reach it", async () => {
    const item = await addThali();
    assert.equal((await upload(item.id, "editor", new TextEncoder().encode("not an image"))).status, 422);
    assert.equal((await upload(item.id, "viewer")).status, 403);
    await data(await upload(item.id));
    assert.equal((await upload(item.id, "editorB")).status, 404, "hotel B has no such item");
    assert.equal((await call(photoGet, "GET", `/api/v1/admin/menu/items/${item.id}/photo`, "editorB", undefined, { id: item.id })).status, 404);
    assert.equal((await call(guestPhotoGet, "GET", `/api/v1/guest/menu/${item.id}/photo`, "guestB", undefined, { id: item.id })).status, 404, "a guest of hotel B");
    assert.equal((await call(guestPhotoGet, "GET", `/api/v1/guest/menu/${item.id}/photo?hotel=${HOTEL_A}`, "guestB", undefined, { id: item.id })).status, 403, "naming a hotel they are not linked to");
    assert.equal((await call(guestPhotoGet, "GET", `/api/v1/guest/menu/${item.id}/photo`, "editor", undefined, { id: item.id })).status, 403, "staff use the Master Data address");
  });
});
