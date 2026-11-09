// Website part 2 end to end through the REAL route files, the wrapper, the services and the in-memory hotel store + media store: the gallery (uploads checked
// by their content, named from the caption, ordered), the home page wording, the cards (services, house rules, nearby places) with their icons, and Website
// Settings (secrets only for those who may, never returned; logo and browser icon; the map pin; Google stubs). Rules and words: Pallav Website/*Controller.
import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import { GET as contentGet, PUT as contentPut } from "../../src/app/api/v1/website/content/route";
import { POST as googleConnect } from "../../src/app/api/v1/website/google/connect/route";
import { POST as googleDisconnect } from "../../src/app/api/v1/website/google/disconnect/route";
import { POST as googleRefresh } from "../../src/app/api/v1/website/google/refresh/route";
import { GET as mediaGet } from "../../src/app/api/v1/website/media/[file]/route";
import { GET as overviewGet } from "../../src/app/api/v1/website/overview/route";
import { GET as nearbyGet, POST as nearbyPost } from "../../src/app/api/v1/website/nearby/route";
import { DELETE as nearbyDelete, PATCH as nearbyPatch } from "../../src/app/api/v1/website/nearby/[id]/route";
import { POST as nearbyMove } from "../../src/app/api/v1/website/nearby/[id]/move/route";
import { DELETE as photoDelete, PATCH as photoPatch } from "../../src/app/api/v1/website/photos/[id]/route";
import { POST as photoMove } from "../../src/app/api/v1/website/photos/[id]/move/route";
import { GET as photosGet, POST as photosPost } from "../../src/app/api/v1/website/photos/route";
import { DELETE as policyDelete, PATCH as policyPatch } from "../../src/app/api/v1/website/policies/[id]/route";
import { POST as policyMove } from "../../src/app/api/v1/website/policies/[id]/move/route";
import { GET as policiesGet, POST as policiesPost } from "../../src/app/api/v1/website/policies/route";
import { DELETE as serviceDelete, PATCH as servicePatch } from "../../src/app/api/v1/website/services/[id]/route";
import { POST as serviceMove } from "../../src/app/api/v1/website/services/[id]/move/route";
import { GET as servicesGet, POST as servicesPost } from "../../src/app/api/v1/website/services/route";
import { GET as settingsGet, PUT as settingsPut } from "../../src/app/api/v1/website/settings/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildWebsiteServices, configureWebsite, getWebsiteSettings, memoryOAuthStates, noGoogle } from "../../src/server/compose/website";
import { platformSetupSession } from "../../src/server/auth/secretSettings";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import sharp from "sharp";
import { createMemoryMediaStore, sniffImage, svgIsSafe } from "../../src/server/media/store";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createBillService } from "../../src/server/services/billing/billService";
import { createReservationService } from "../../src/server/services/frontOffice/reservationService";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Meera Manager", roleKey: "editor", roleLevel: 2, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("manager", id(1), { roleKey: "editor", roleLevel: 2, grants: [grant("website", "full")] });
mk("super", id(2), { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("website", "full")] });
mk("secrets", id(3), { roleKey: "admin", roleLevel: 3, grants: [grant("website", "full"), grant("website.secrets", "full")] });
mk("viewer", id(4), { grants: [grant("website.gallery", "view"), grant("website.content", "view"), grant("website.settings", "view")] });
mk("nobody", id(5), {});
mk("otherHotel", id(6), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("website", "full")] });

let hotel = createMemoryHotel();
let store = createMemoryMediaStore();
const clock = new Date("2026-10-05T10:00:00+05:30");

function wire(): void {
  hotel = createMemoryHotel();
  store = createMemoryMediaStore();
  const now = () => clock;
  const people_ = { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) };
  const base = { unit: hotel.unit, people: people_, audit: { record: async () => undefined }, catalog, now };
  const reservations = createReservationService({ ...base, bills: createBillService(base) });
  const mail: import("../../src/server/services/website/context").SiteMail = { enquiryConfirmed: async () => "off", enquiryDeclined: async () => "off" };
  configureWebsite(buildWebsiteServices({ ...base, reservations, mail, google: noGoogle, oauthStates: memoryOAuthStates(), media: store, publicUrl: "https://hms.test" }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = async (res: Response, status = 200): Promise<any> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};

// real file bytes, as base64 (real pictures: the server decodes and compresses every upload, media/compress.ts)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let JPG = Buffer.alloc(0);
before(async () => {
  JPG = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#7c3aed" } }).jpeg().toBuffer();
});
const JPG_HEAD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF"), Buffer.alloc(20)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
const file = (name: string, bytes: Buffer) => ({ fileName: name, dataBase64: bytes.toString("base64") });
const photos = (caption: string, files: ReturnType<typeof file>[], who = "manager") => photosPost(req("POST", "/api/v1/website/photos", who, { caption, files }), ctx());
const storedNames = (h = HOTEL_A): string[] => [...store.files.keys()].filter((k) => k.startsWith(`${h}/`)).map((k) => k.slice(h.length + 1)).sort();

beforeEach(wire);

describe("what an uploaded file really is", () => {
  test("the type comes from the bytes, never from the name; an SVG with anything active is refused", () => {
    assert.deepEqual([sniffImage(PNG), sniffImage(JPG_HEAD), sniffImage(ICO), sniffImage(SVG), sniffImage(Buffer.from("MZ\x90\x00 an exe")), sniffImage(Buffer.from("<html><script>x</script>"))], ["png", "jpg", "ico", "svg", null, null]);
    assert.equal(svgIsSafe(SVG), true);
    for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="https://evil.example/x"><rect/></a></svg>', '<svg><foreignObject><div/></foreignObject></svg>', '<svg><use xlink:href="https://evil.example/s.svg#a"/></svg>', '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', '<svg><a href="javascript:alert(1)"/></svg>']) {
      assert.equal(svgIsSafe(Buffer.from(bad)), false, bad);
    }
    assert.equal(svgIsSafe(Buffer.from('<svg><use href="#a"/></svg>')), true, "an internal reference is fine");
  });
});

describe("gallery", () => {
  test("upload a batch: files named from the caption (hotel-lobby.webp, hotel-lobby-2.webp: every picture is stored as WebP), caption and alt text, in order, served back to this hotel", async () => {
    assert.deepEqual(await ok(await photosGet(req("GET", "/api/v1/website/photos", "manager"), ctx())), []);
    const made = await ok(await photos("Hotel Lobby", [file("a.png", PNG), file("b.jpg", JPG)]), 201);
    assert.deepEqual(made.map((p: { file: string; caption: string; altText: string }) => [p.file, p.caption, p.altText]), [["hotel-lobby.webp", "Hotel Lobby", "Hotel Lobby"], ["hotel-lobby-2.webp", "Hotel Lobby", "Hotel Lobby"]]);
    assert.ok(made.every((p: { url: string; shade: number; id: string }) => p.url.startsWith("/api/v1/website/media/") && typeof p.shade === "number" && p.id));
    assert.deepEqual(storedNames(), ["hotel-lobby-2.webp", "hotel-lobby.webp"]);
    const again = await ok(await photos("Hotel Lobby", [file("c.png", PNG)]), 201);
    assert.equal(again[0].file, "hotel-lobby-3.webp", "a name is only taken together with its extension (Uploads::uniqueName)");
    const res = await mediaGet(req("GET", "/api/v1/website/media/hotel-lobby.webp", "manager"), ctx({ file: "hotel-lobby.webp" }));
    assert.deepEqual([res.status, res.headers.get("content-type")], [200, "image/webp"]);
    const served = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([(await sharp(served).metadata()).format, served.length <= 1_048_576], ["webp", true], "served back as the stored WebP");
    // no caption: the alt text is the file's own name
    const plain = await ok(await photos("", [file("sea-view_room.png", PNG)]), 201);
    assert.deepEqual([plain[0].caption, plain[0].altText, plain[0].file], ["", "sea view room", "sea-view-room.webp"]);
  });

  test("every file is checked first: a wrong type, a disguised file, an empty or oversize one, too many, none - nothing is kept", async () => {
    const bad = async (files: unknown[], message: RegExp | string) => {
      const res = await photosPost(req("POST", "/api/v1/website/photos", "manager", { caption: "", files }), ctx());
      assert.equal(res.status, 422);
      const f = (await fields(res)).photos as string;
      assert.match(f, message instanceof RegExp ? message : new RegExp(message));
    };
    await bad([file("a.png", PNG), file("virus.jpg", Buffer.from("MZ\x90\x00 not an image"))], /Pick a JPG, PNG, WEBP, GIF image/);
    await bad([file("logo.svg", SVG)], /Pick a JPG, PNG, WEBP, GIF image/);
    await bad([file("a.png", Buffer.alloc(0))], /empty|could not be read/);
    await bad([{ fileName: "a.png", dataBase64: "!!!not base64!!!" }], /could not be read/);
    await bad([file("big.png", Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]))], /too big: the limit is 20 MB/);
    await bad([file("broken.png", Buffer.concat([PNG.subarray(0, 20), Buffer.alloc(40)]))], /could not be read/);
    await bad([], /Pick at least one photo/);
    assert.equal((await photosPost(req("POST", "/api/v1/website/photos", "manager", { caption: "", files: Array.from({ length: 11 }, () => file("a.png", PNG)) }), ctx())).status, 422);
    assert.deepEqual(storedNames(), [], "nothing was kept by a refused batch");
    assert.deepEqual(await ok(await photosGet(req("GET", "/api/v1/website/photos", "manager"), ctx())), []);
  });

  test("details, order and delete: caption up to 150, alt up to 255, empty = none; the file goes with the photo; the ends cannot move", async () => {
    const [a, b] = await ok(await photos("Pool", [file("1.png", PNG), file("2.png", PNG)]), 201);
    const upd = await ok(await photoPatch(req("PATCH", `/api/v1/website/photos/${a.id}`, "manager", { caption: ` ${"c".repeat(200)} `, altText: "a".repeat(300) }), ctx({ id: a.id })));
    assert.deepEqual([upd.caption.length, upd.altText.length], [150, 255]);
    assert.deepEqual((await ok(await photoPatch(req("PATCH", `/api/v1/website/photos/${a.id}`, "manager", { caption: "", altText: "" }), ctx({ id: a.id })))).altText, "");
    assert.equal((await photoMove(req("POST", `/api/v1/website/photos/${a.id}/move`, "manager", { direction: "up" }), ctx({ id: a.id }))).status, 409);
    const moved = await ok(await photoMove(req("POST", `/api/v1/website/photos/${a.id}/move`, "manager", { direction: "down" }), ctx({ id: a.id })));
    assert.deepEqual(moved.map((p: { id: string }) => p.id), [b.id, a.id]);
    assert.deepEqual(await ok(await photoDelete(req("DELETE", `/api/v1/website/photos/${a.id}`, "manager"), ctx({ id: a.id }))), { id: a.id });
    assert.deepEqual(storedNames(), ["pool-2.png"].filter(() => false).concat(storedNames()).filter((n) => n !== a.file));
    assert.equal(storedNames().includes(a.file), false, "the deleted photo's file is gone");
    assert.equal((await photoDelete(req("DELETE", `/api/v1/website/photos/${a.id}`, "manager"), ctx({ id: a.id }))).status, 404);
    assert.equal(data().systemLogs.some((l) => l.module === "website" && l.entity === "Gallery photo" && l.action === "deleted"), true);
  });

  test("permissions and hotel isolation: view reads, create uploads; a file of this hotel is not reachable from another", async () => {
    const [a] = await ok(await photos("Lobby", [file("1.png", PNG)]), 201);
    assert.equal((await photosGet(req("GET", "/api/v1/website/photos", "viewer"), ctx())).status, 200);
    assert.equal((await photos("x", [file("1.png", PNG)], "viewer")).status, 403);
    assert.equal((await photoDelete(req("DELETE", `/api/v1/website/photos/${a.id}`, "viewer"), ctx({ id: a.id }))).status, 403);
    assert.equal((await photosGet(req("GET", "/api/v1/website/photos", "nobody"), ctx())).status, 403);
    assert.equal((await photosGet(req("GET", "/api/v1/website/photos", null), ctx())).status, 401);
    assert.deepEqual(await ok(await photosGet(req("GET", "/api/v1/website/photos", "otherHotel"), ctx())), []);
    assert.equal((await mediaGet(req("GET", `/api/v1/website/media/${a.file}`, "otherHotel"), ctx({ file: a.file }))).status, 404);
    assert.equal((await photoPatch(req("PATCH", `/api/v1/website/photos/${a.id}`, "otherHotel", { caption: "x", altText: "" }), ctx({ id: a.id }))).status, 404);
    for (const bad of ["../x.png", "..%2Fx.png", "a/b.png", "x.php", "X.PNG"]) assert.ok([404, 422].includes((await mediaGet(req("GET", `/api/v1/website/media/${bad}`, "manager"), ctx({ file: bad }))).status), bad);
  });
});

const data = () => hotel.store.dataFor(HOTEL_A);

describe("home page wording", () => {
  test("defaults, a save with Pallav's words, rich text cleaned, bullets one per line", async () => {
    const before = await ok(await contentGet(req("GET", "/api/v1/website/content", "manager"), ctx()));
    before.heroLead = "<p>Welcome</p>"; before.enquireLead = "<p>Ask us</p>"; before.footerTagline = "<p>Rajkot</p>";
    assert.ok(before.heroTitleLine1 && Array.isArray(before.enquirePoints));
    const input = { ...before, heroTitleLine1: " A calm stay ", heroLead: '<p>Welcome <script>alert(1)</script><b>home</b></p>', enquireLead: "<p>Ask us</p>", footerTagline: "<p>Rajkot</p>", enquirePoints: [" Free cancellation ", "", "Breakfast 0", "0"] };
    const saved = await ok(await contentPut(req("PUT", "/api/v1/website/content", "manager", input), ctx()));
    assert.equal(saved.heroTitleLine1, "A calm stay");
    assert.ok(!saved.heroLead.includes("script") && saved.heroLead.includes("<b>home</b>"));
    assert.deepEqual(saved.enquirePoints, ["Free cancellation", "Breakfast 0"]);
    const empty = await contentPut(req("PUT", "/api/v1/website/content", "manager", { ...before, enquireLead: "<p>Ask us</p>", footerTagline: "<p>Rajkot</p>", heroLead: "<p>x</p>", heroTitleLine1: "  ", qcMsgError: "" }), ctx());
    assert.equal(empty.status, 422);
    assert.deepEqual(Object.keys(await fields(empty)).sort(), ["heroTitleLine1", "qcMsgError"]);
    assert.equal((await contentPut(req("PUT", "/api/v1/website/content", "viewer", before), ctx())).status, 403);
    assert.equal((await contentPut(req("PUT", "/api/v1/website/content", "manager", { ...before, extra: 1 }), ctx())).status, 422);
  });
});

describe("services, house rules and nearby places", () => {
  test("a service: title up to 80, line up to 255, an icon (checked by content), replace and remove the icon, order, delete takes the icon file", async () => {
    assert.deepEqual(await ok(await servicesGet(req("GET", "/api/v1/website/services", "manager"), ctx())), []);
    const none = await servicesPost(req("POST", "/api/v1/website/services", "manager", { title: "  ", description: "" }), ctx());
    assert.deepEqual([none.status, (await fields(none)).title], [422, "Enter a title."]);
    const a = await ok(await servicesPost(req("POST", "/api/v1/website/services", "manager", { title: "T".repeat(100), description: "d".repeat(300), icon: file("i.svg", SVG) }), ctx()), 201);
    assert.deepEqual([a.title.length, a.description.length, a.hasIcon, a.icon?.endsWith(".svg"), a.iconUrl?.startsWith("/api/v1/website/media/")], [80, 255, true, true, true]);
    const firstIcon = a.icon as string;
    const evil = await servicesPost(req("POST", "/api/v1/website/services", "manager", { title: "Bad", icon: file("x.svg", Buffer.from("<svg><script>1</script></svg>")) }), ctx());
    assert.deepEqual([evil.status, (await fields(evil)).icon], [422, "That SVG contains scripts or links and was not uploaded."]);
    assert.equal((await servicesPost(req("POST", "/api/v1/website/services", "manager", { title: "Big", icon: file("x.png", Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])) }), ctx())).status, 422);
    assert.equal((await ok(await servicesGet(req("GET", "/api/v1/website/services", "manager"), ctx()))).length, 1, "a refused card is not made");
    const b = await ok(await servicesPost(req("POST", "/api/v1/website/services", "manager", { title: "Wi-Fi", description: "Free" }), ctx()), 201);
    assert.equal(b.hasIcon, false);
    const replaced = await ok(await servicePatch(req("PATCH", `/api/v1/website/services/${a.id}`, "manager", { title: "Spa", description: "", icon: file("n.png", PNG) }), ctx({ id: a.id })));
    assert.notEqual(replaced.icon, firstIcon);
    assert.equal(storedNames().includes(firstIcon), false, "the old icon file is gone");
    const kept = await ok(await servicePatch(req("PATCH", `/api/v1/website/services/${a.id}`, "manager", { title: "Spa", description: "x" }), ctx({ id: a.id })));
    assert.equal(kept.icon, replaced.icon, "no new file and no remove: the icon stays");
    const removed = await ok(await servicePatch(req("PATCH", `/api/v1/website/services/${a.id}`, "manager", { title: "Spa", description: "x", removeIcon: true }), ctx({ id: a.id })));
    assert.deepEqual([removed.hasIcon, storedNames().length], [false, 0]);
    const both = await ok(await servicePatch(req("PATCH", `/api/v1/website/services/${a.id}`, "manager", { title: "Spa", description: "", icon: file("n.png", PNG), removeIcon: true }), ctx({ id: a.id })));
    assert.equal(both.hasIcon, true, "a new file wins over remove");
    assert.equal((await serviceMove(req("POST", `/api/v1/website/services/${a.id}/move`, "manager", { direction: "up" }), ctx({ id: a.id }))).status, 409);
    await ok(await serviceMove(req("POST", `/api/v1/website/services/${a.id}/move`, "manager", { direction: "down" }), ctx({ id: a.id })));
    assert.deepEqual((await ok(await servicesGet(req("GET", "/api/v1/website/services", "manager"), ctx()))).map((x: { title: string }) => x.title), ["Wi-Fi", "Spa"]);
    await ok(await serviceDelete(req("DELETE", `/api/v1/website/services/${a.id}`, "manager"), ctx({ id: a.id })));
    assert.deepEqual(storedNames(), [], "deleting the card deletes its icon file");
    assert.equal((await serviceDelete(req("DELETE", `/api/v1/website/services/${a.id}`, "manager"), ctx({ id: a.id }))).status, 404);
    assert.equal((await servicePatch(req("PATCH", `/api/v1/website/services/${b.id}`, "otherHotel", { title: "Hijack", description: "" }), ctx({ id: b.id }))).status, 404);
  });

  test("a house rule card: title up to 60, one rule per line (255 each, blank and '0' dropped, at most fifty)", async () => {
    const lines = ["No smoking", "", "  Quiet after 10 pm  ", "0", "x".repeat(300), ...Array.from({ length: 60 }, (_, i) => `Rule ${i}`)];
    const card = await ok(await policiesPost(req("POST", "/api/v1/website/policies", "manager", { title: "Rules", lines }), ctx()), 201);
    assert.equal(card.lines.length, 50);
    assert.deepEqual([card.lines[0], card.lines[1], card.lines[2].length], ["No smoking", "Quiet after 10 pm", 255]);
    const none = await policiesPost(req("POST", "/api/v1/website/policies", "manager", { title: "", lines: [] }), ctx());
    assert.equal((await fields(none)).title, "Enter a title.");
    const upd = await ok(await policyPatch(req("PATCH", `/api/v1/website/policies/${card.id}`, "manager", { title: "T".repeat(80), lines: ["One"] }), ctx({ id: card.id })));
    assert.deepEqual([upd.title.length, upd.lines], [60, ["One"]]);
    assert.equal((await ok(await policiesGet(req("GET", "/api/v1/website/policies", "viewer"), ctx()))).length, 1);
    assert.equal((await policyMove(req("POST", `/api/v1/website/policies/${card.id}/move`, "manager", { direction: "down" }), ctx({ id: card.id }))).status, 409);
    assert.equal((await policiesPost(req("POST", "/api/v1/website/policies", "viewer", { title: "x", lines: [] }), ctx())).status, 403);
    await ok(await policyDelete(req("DELETE", `/api/v1/website/policies/${card.id}`, "manager"), ctx({ id: card.id })));
  });

  test("a nearby place: name up to 80, a typed distance or one worked out from a map link and the hotel's pin, links must be http(s)", async () => {
    const list0 = await ok(await nearbyGet(req("GET", "/api/v1/website/nearby", "manager"), ctx()));
    assert.deepEqual(list0, { hotelPinned: false, places: [] });
    const typed = await ok(await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Airport", distanceLabel: " 7 km ", mapUrl: "", mapQuery: "Rajkot airport" }), ctx()), 201);
    assert.deepEqual([typed.distanceLabel, typed.location, typed.mapQuery], ["7 km", "name", "Rajkot airport"]);
    const noDistance = await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Station", distanceLabel: "", mapUrl: "", mapQuery: "" }), ctx());
    assert.deepEqual([noDistance.status, (await fields(noDistance)).distanceLabel?.startsWith("Distance is required")], [422, true]);
    const badLink = await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Mall", distanceLabel: "1 km", mapUrl: "ftp://x.y/z", mapQuery: "" }), ctx());
    assert.equal((await fields(badLink)).mapUrl, "Enter a full link starting with https://");
    assert.equal((await fields(await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "", distanceLabel: "1", mapUrl: "", mapQuery: "" }), ctx()))).title, "Enter a title.");
    const link = "https://www.google.com/maps/place/Mall/@22.30,70.80,17z/data=!3d22.3012!4d70.8021";
    const noPin = await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Mall", distanceLabel: "", mapUrl: link, mapQuery: "" }), ctx());
    assert.equal(noPin.status, 422, "a link gives a location but without the hotel's own pin no distance can be worked out");
    const withDistance = await ok(await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Mall", distanceLabel: "2 km", mapUrl: link, mapQuery: "" }), ctx()), 201);
    assert.equal(withDistance.location, "exact");
    // the hotel's pin set in Website Settings: now a missing distance is measured
    const s = await settingsBody();
    await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...s, hotelMapUrl: "https://www.google.com/maps/@22.2916,70.7771,15z" }), ctx()));
    const measured = await ok(await nearbyPost(req("POST", "/api/v1/website/nearby", "manager", { title: "Cinema", distanceLabel: "", mapUrl: link, mapQuery: "" }), ctx()), 201);
    assert.match(measured.distanceLabel, /^~\d+(\.\d)? km$/);
    assert.equal((await ok(await nearbyGet(req("GET", "/api/v1/website/nearby", "manager"), ctx()))).hotelPinned, true);
    const edited = await ok(await nearbyPatch(req("PATCH", `/api/v1/website/nearby/${typed.id}`, "manager", { title: "Rajkot Airport", distanceLabel: "7.5 km", mapUrl: "", mapQuery: "" }), ctx({ id: typed.id })));
    assert.deepEqual([edited.title, edited.distanceLabel], ["Rajkot Airport", "7.5 km"]);
    await ok(await nearbyMove(req("POST", `/api/v1/website/nearby/${typed.id}/move`, "manager", { direction: "down" }), ctx({ id: typed.id })));
    await ok(await nearbyDelete(req("DELETE", `/api/v1/website/nearby/${typed.id}`, "manager"), ctx({ id: typed.id })));
    assert.equal((await nearbyDelete(req("DELETE", `/api/v1/website/nearby/${typed.id}`, "manager"), ctx({ id: typed.id }))).status, 404);
  });
});

const settingsBody = async (who = "super") => {
  const s = await ok(await settingsGet(req("GET", "/api/v1/website/settings", who), ctx()));
  return {
    gmPhone: "9825735404", receptionPhone: "02812345678", email: "stay@hotel.in", openedYear: 2005, address: "KKV Chowk, Rajkot", checkinTime: "12:00 pm", checkoutTime: "11:00 am",
    hotelMapUrl: "", metaTitle: "", metaDescription: "", metaKeywords: "", gbpLink: "", facebookLink: "", instagramLink: "", recipients: [{ name: "GM", email: "gm@hotel.in" }],
    smtpHost: "", smtpPort: 587, smtpUsername: "", newSmtpPassword: "", smtpFromEmail: "", smtpFromName: "", newGoogleMapsApiKey: "", googlePlaceId: "", googleMinReviewRating: 4, gbpOauthClientId: "", newGbpOauthClientSecret: "",
    ...(s.openedYear ? {} : {}),
  };
};

describe("website settings", () => {
  test("a first read has defaults and the shape of the contract; no hotel session sees the secret fields (the Set-up centre's)", async () => {
    const s = await ok(await settingsGet(req("GET", "/api/v1/website/settings", "super"), ctx()));
    assert.deepEqual([s.secretsVisible, s.smtpPasswordSet, s.googleMapsApiKeySet, s.gbpOauthClientSecretSet, s.googleStatus, s.hasLogo, s.hasFavicon, s.mapLat], [false, false, false, false, "notSetUp", false, false, null]);
    assert.match(s.gbpRedirectUrl, /^https:\/\/hms\.test\//);
    const m = await ok(await settingsGet(req("GET", "/api/v1/website/settings", "manager"), ctx()));
    assert.equal(m.secretsVisible, false);
    assert.equal((await settingsGet(req("GET", "/api/v1/website/settings", "nobody"), ctx())).status, 403);
  });

  test("a save: contract validation, phones kept as typed, recipients once each, the pin from a pasted link only, a short link and a bad link refused", async () => {
    const body = await settingsBody();
    const saved = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...body, recipients: [{ name: "GM", email: "gm@hotel.in" }, { name: "Dup", email: "GM@hotel.in" }, { name: "FD", email: "fd@hotel.in" }], hotelMapUrl: "https://www.google.com/maps/@22.2916,70.7771,15z" }), ctx()));
    assert.deepEqual([saved.gmPhone, saved.recipients.map((r: { email: string }) => r.email), saved.mapLat, saved.mapLng], ["9825735404", ["gm@hotel.in", "fd@hotel.in"], 22.2916, 70.7771]);
    const keep = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "super", body), ctx()));
    assert.deepEqual([keep.mapLat, keep.mapLng], [22.2916, 70.7771], "an empty link leaves the pin where it was");
    const short = await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...body, hotelMapUrl: "https://maps.app.goo.gl/abc123" }), ctx());
    assert.equal(short.status, 422);
    assert.match((await fields(short)).hotelMapUrl, /short Google Maps link/);
    const nothing = await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...body, hotelMapUrl: "https://example.com/nowhere" }), ctx());
    assert.match((await fields(nothing)).hotelMapUrl, /Couldn't work out a location/);
    const invalid = await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...body, gmPhone: "1", email: "nope", openedYear: 1700, checkinTime: " ", gbpLink: "ftp://x" }), ctx());
    assert.deepEqual(Object.keys(await fields(invalid)).sort(), ["checkinTime", "email", "gbpLink", "gmPhone", "openedYear"]);
    assert.equal((await settingsPut(req("PUT", "/api/v1/website/settings", "viewer", body), ctx())).status, 403);
    const log = data().systemLogs.filter((l) => l.entity === "Website settings");
    assert.ok(log.length >= 2);
  });

  test("secrets are the Set-up centre's (MJ, 5 Nov 2026): a hotel session never reads or writes them; the set-up session saves the Google keys, never returned, kept when the box is empty", async () => {
    const body = await settingsBody();
    const setup = platformSetupSession(makeSession({ userId: id(2), hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), HOTEL_A);
    const tried = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "super", { ...body, smtpHost: "evil.example", smtpUsername: "x", newSmtpPassword: "p4ssw0rd!", newGoogleMapsApiKey: "AIzaSyKEY", gbpOauthClientId: "cid", newGbpOauthClientSecret: "GOCSPX-secret" }), ctx()));
    assert.deepEqual([tried.smtpHost, tried.smtpPasswordSet, tried.googleMapsApiKeySet, tried.gbpOauthClientId, tried.gbpOauthClientSecretSet, tried.secretsVisible], ["", false, false, "", false, false], "the hotel's own top role cannot set a secret");
    for (const who of ["super", "secrets"]) assert.equal((await ok(await settingsGet(req("GET", "/api/v1/website/settings", who), ctx()))).secretsVisible, false, who);
    const svc = getWebsiteSettings();
    const keys = await svc.setupSave(setup, { gbpOauthClientId: "cid.apps.googleusercontent.com", newGoogleMapsApiKey: "AIzaSyKEY", newGbpOauthClientSecret: "GOCSPX-secret" }, { traceId: "t", ip: null });
    assert.deepEqual([keys.googleMapsApiKeySet, keys.gbpOauthClientId, keys.gbpOauthClientSecretSet, keys.googleStatus], [true, "cid.apps.googleusercontent.com", true, "ready"]);
    for (const secret of ["AIzaSyKEY", "GOCSPX-secret"]) assert.ok(!JSON.stringify(keys).includes(secret), "a secret is never returned");
    const again = await svc.setupSave(setup, { gbpOauthClientId: "cid.apps.googleusercontent.com" }, { traceId: "t", ip: null });
    assert.deepEqual([again.googleMapsApiKeySet, again.gbpOauthClientSecretSet], [true, true], "empty boxes keep what is saved");
    await assert.rejects(svc.setupView(sessions.get("super")!), (e: { code?: string }) => e.code === "FORBIDDEN");
    const after = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "super", body), ctx()));
    assert.equal(after.googleStatus, "ready", "a hotel's save never blanks the keys");
    assert.ok(!JSON.stringify(data().systemLogs.map((l) => l.details)).includes("GOCSPX"), "no secret in the log");
  });

  test("logo and browser icon: uploaded by content (an ico is fine), a new file wins over remove, remove deletes the file", async () => {
    const body = await settingsBody();
    const withLogo = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "manager", { ...body, logo: file("l.png", PNG), favicon: file("f.ico", ICO) }), ctx()));
    assert.deepEqual([withLogo.hasLogo, withLogo.hasFavicon, storedNames().length], [true, true, 2]);
    assert.match(withLogo.logoUrl, /^\/api\/v1\/website\/media\//);
    const bad = await settingsPut(req("PUT", "/api/v1/website/settings", "manager", { ...body, logo: file("l.png", Buffer.from("not an image")) }), ctx());
    assert.equal(bad.status, 422);
    assert.ok((await fields(bad)).logo);
    assert.equal(storedNames().length, 2, "a refused save keeps nothing new and loses nothing");
    const swapped = await ok(await settingsPut(req("PUT", "/api/v1/website/settings", "manager", { ...body, logo: file("l2.jpg", JPG), removeLogo: true, removeFavicon: true }), ctx()));
    assert.deepEqual([swapped.hasLogo, swapped.hasFavicon, storedNames().length], [true, false, 1]);
  });

  test("Google: connecting and disconnecting are the Set-up centre's; connect needs the OAuth client saved first (409); refresh stays with the hotel and needs a connection", async () => {
    const setup = platformSetupSession(makeSession({ userId: id(2), hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), HOTEL_A);
    for (const who of ["manager", "super"]) assert.equal((await googleConnect(req("POST", "/api/v1/website/google/connect", who), ctx())).status, 403, who);
    const svc = getWebsiteSettings();
    await assert.rejects(svc.googleConnect(setup), /Save the Google client ID and secret first/);
    await svc.setupSave(setup, { gbpOauthClientId: "cid", newGbpOauthClientSecret: "sec" }, { traceId: "t", ip: null });
    await assert.rejects(svc.googleConnect(setup), /not set up yet/);
    const refresh = await googleRefresh(req("POST", "/api/v1/website/google/refresh", "super"), ctx());
    assert.deepEqual([refresh.status, (await json(refresh)).error.message], [409, "Google is not connected yet."]);
    assert.equal((await svc.googleDisconnect(setup, { traceId: "t", ip: null })).googleStatus, "ready");
    assert.equal((await googleDisconnect(req("POST", "/api/v1/website/google/disconnect", "super"), ctx())).status, 403);
  });
});

describe("overview", () => {
  const as = { hotelId: HOTEL_A, userId: id(1) };
  test("counts for a financial year, today's and this week's arrivals, the latest enquiries, closed dates in ranges, the latest changes, the facts", async () => {
    const room = await hotel.unit.run(as, (r) => r.siteRooms.create({ name: "Deluxe", size: null, bedType: null, maxGuests: 3, totalCount: 2, note: null, badgeLabel: null, showPrice: true, available: true, photos: [], slug: "deluxe" }, id(1)));
    const enq = (name: string, checkIn: string, status?: "confirmed" | "declined") =>
      hotel.unit.run(as, async (r) => {
        const e = await r.siteEnquiries.create({ name, phone: "+919876543210", email: null, message: "Hi", roomId: room.id, checkIn, checkOut: "2026-10-30", guests: 3, children: 1, reference: `HP-${name}`, ipAddress: null, createdAt: clock });
        return status ? r.siteEnquiries.decide(e.id, { status, by: id(1), byName: "Meera Manager", at: clock, note: null }) : e;
      });
    await enq("Today", "2026-10-05", "confirmed");
    await enq("Soon", "2026-10-09", "confirmed");
    await enq("Later", "2026-10-20", "confirmed");
    await enq("Waiting", "2026-10-08");
    await enq("No", "2026-10-08", "declined");
    await hotel.unit.run(as, (r) => r.siteEnquiries.create({ name: "Last year", phone: null, email: null, message: null, roomId: null, checkIn: null, checkOut: null, guests: null, children: null, reference: "HP-old", ipAddress: null, createdAt: new Date("2025-06-01T10:00:00+05:30") }));
    await hotel.unit.run(as, (r) => r.calendar.setBlocked(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-20"].map((date) => ({ roomId: room.id, date, blocked: true, totalCount: 2 }))));
    await photos("Lobby", [file("a.png", PNG)]);
    const o = await ok(await overviewGet(req("GET", "/api/v1/website/overview", "manager"), ctx()));
    assert.deepEqual([o.fy, o.currentFy, o.years], [2026, 2026, [2026, 2025, 2024]]);
    assert.deepEqual(o.stats, { all: 5, pending: 1, confirmed: 3, declined: 1 });
    assert.deepEqual(o.arrivingToday.map((a: { name: string; guests: number; children: number }) => [a.name, a.guests, a.children]), [["Today", 2, 1]]);
    assert.deepEqual(o.arrivingWeek.map((a: { name: string }) => a.name), ["Soon"]);
    assert.equal(o.recent.length, 5);
    assert.deepEqual(o.blocked.map((b: { start: string; end: string; nights: number; roomName: string }) => [b.start, b.end, b.nights, b.roomName]), [["2026-10-12", "2026-10-14", 3, "Deluxe"], ["2026-10-20", "2026-10-20", 1, "Deluxe"]]);
    assert.ok(o.changes.some((c: { summary: string }) => /gallery photo/.test(c.summary)));
    assert.deepEqual(o.facts, { rooms: 1, photos: 1 });
    assert.equal(o.siteUrl, "https://hms.test");
    const lastYear = await ok(await overviewGet(req("GET", "/api/v1/website/overview?fy=2025", "manager"), ctx()));
    assert.deepEqual([lastYear.fy, lastYear.stats.all, lastYear.recent.length], [2025, 1, 1]);
    assert.equal((await overviewGet(req("GET", "/api/v1/website/overview?fy=1800", "manager"), ctx())).status, 422);
    assert.equal((await overviewGet(req("GET", "/api/v1/website/overview?fy=abc", "manager"), ctx())).status, 422);
    assert.equal((await overviewGet(req("GET", "/api/v1/website/overview", "nobody"), ctx())).status, 403);
    const other = await ok(await overviewGet(req("GET", "/api/v1/website/overview", "otherHotel"), ctx()));
    assert.deepEqual([other.stats.all, other.facts, other.blocked.length], [0, { rooms: 0, photos: 0 }, 0]);
  });
});