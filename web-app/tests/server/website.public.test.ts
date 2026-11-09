// Decision 55 (R25): the PUBLIC website API of a hotel (no sign-in, found by slug) and the hotel's own "Website live" / domains settings, through the REAL route
// files, the wrapper and the in-memory hotel + platform data. Rules: docs/deploy/WEBSITE-CONNECT.md section 2 (404 for a hotel that is not live, whitelist answers, no price
// unless "show price", CORS only for the hotel's registered domains, a honeypot, the listed-files-only media route).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as availabilityRoute } from "../../src/app/api/v1/public/hotels/[slug]/availability/route";
import { GET as brandRoute } from "../../src/app/api/v1/public/hotels/[slug]/brand/route";
import { GET as contentRoute } from "../../src/app/api/v1/public/hotels/[slug]/content/route";
import { OPTIONS as enquiriesOptions, POST as enquiriesPost } from "../../src/app/api/v1/public/hotels/[slug]/enquiries/route";
import { GET as mediaRoute } from "../../src/app/api/v1/public/hotels/[slug]/media/[file]/route";
import { GET as roomsRoute } from "../../src/app/api/v1/public/hotels/[slug]/rooms/route";
import { GET as siteRoute } from "../../src/app/api/v1/public/hotels/[slug]/site/route";
import { POST as createPlanRoute } from "../../src/app/api/v1/website/rooms/[id]/plans/route";
import { POST as createRoomRoute } from "../../src/app/api/v1/website/rooms/route";
import { GET as siteAccessGet, PUT as siteAccessPut } from "../../src/app/api/v1/website/site/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildWebsiteServices, configureWebsite, memoryOAuthStates, noGoogle } from "../../src/server/compose/website";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryMediaStore } from "../../src/server/media/store";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createBillService } from "../../src/server/services/billing/billService";
import { createReservationService } from "../../src/server/services/frontOffice/reservationService";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Meera Manager", roleKey: "editor", roleLevel: 2, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("manager", makeSession({ userId: id(1), client: "web", roleKey: "editor", roleLevel: 2, grants: [grant("website", "full")] }));
sessions.set("viewer", makeSession({ userId: id(2), client: "web", grants: [grant("website.settings", "view")] }));
sessions.set("nobody", makeSession({ userId: id(3), client: "web", grants: [] }));

const SLUG = "hotel-sunrise";
const SITE = "https://www.sunrise.example";
const clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let platform = createMemoryAuth();
let media = createMemoryMediaStore();
const audited: string[] = [];

function wire(): void {
  hotel = createMemoryHotel();
  platform = createMemoryAuth();
  media = createMemoryMediaStore();
  audited.length = 0;
  platform.data().hotels.push({ id: HOTEL_A, name: "Hotel Sunrise, Rajkot", group: null });
  platform.data().sites.push({ hotelId: HOTEL_A, slug: SLUG, live: true, domains: ["www.sunrise.example"] });
  const now = () => clock;
  const people_ = { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) };
  const base = { unit: hotel.unit, people: people_, audit: { record: async (e: { action: string }) => void audited.push(e.action) }, catalog, now };
  const reservations = createReservationService({ ...base, bills: createBillService(base) });
  const mail = { enquiryConfirmed: async () => "off" as const, enquiryDeclined: async () => "off" as const };
  configureWebsite(buildWebsiteServices({ ...base, reservations, mail, google: noGoogle, oauthStates: memoryOAuthStates(), media, platform: platform.unit, publicUrl: "https://hms.test" }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }), clientIp: (r) => r.headers.get("x-test-ip") ?? "10.0.0.1" });
  hotel.store.dataFor(HOTEL_A).years = [{ id: "y1", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
}
beforeEach(wire);

const ORIGIN = "https://hms.test";
let ipSeq = 0;
function req(method: string, path: string, opts: { who?: string; body?: unknown; origin?: string | null } = {}): Request {
  const h: Record<string, string> = { host: "hms.test", "x-test-ip": `10.1.${++ipSeq}.1` };
  const origin = opts.origin === undefined ? (opts.who ? ORIGIN : null) : opts.origin;
  if (origin) h.origin = origin;
  if (opts.who) h["x-test-session"] = opts.who;
  if (opts.body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.clone().json()) as any;
const pub = (path: string, slug = SLUG, origin: string | null = null) => req("GET", `/api/v1/public/hotels/${slug}/${path}`, { origin });
const data = () => hotel.store.dataFor(HOTEL_A);

async function room(over: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const res = await createRoomRoute(req("POST", "/api/v1/website/rooms", { who: "manager", body: { name: "Deluxe", bedType: "King", size: "250 sq.ft", maxGuests: 3, totalCount: 2, badgeLabel: "", note: "", showPrice: true, available: true, photos: [], ...over } }), ctx());
  assert.equal(res.status, 201, JSON.stringify(await json(res)));
  const r = (await json(res)).data;
  const plan = await createPlanRoute(req("POST", `/api/v1/website/rooms/${r.id}/plans`, { who: "manager", body: { name: "Room Only", code: "EP", tiers: [{ guests: 2, pricePaise: 400000 }, { guests: 1, pricePaise: 320000 }], extraPersonPaise: 50000 } }), ctx({ id: r.id }));
  assert.equal(plan.status, 201, JSON.stringify(await json(plan)));
  return { id: r.id, slug: data().roomTypes.find((t) => t.id === r.id) ? (r.slug ?? "") : "" };
}

describe("a hotel whose website is not live is the same 404 as one that does not exist", () => {
  test("unknown slug, a malformed slug, not live, and a suspended hotel all answer 404 with the same body", async () => {
    const answers: unknown[] = [];
    for (const [slug, mutate] of [["no-such-hotel", () => undefined], ["Bad Slug", () => undefined], [SLUG, () => { platform.data().sites[0].live = false; }], [SLUG, () => { platform.data().sites[0].live = true; platform.data().hotels[0].status = "suspended"; }]] as const) {
      mutate();
      const res = await brandRoute(pub("brand", slug), ctx({ slug }));
      assert.ok(res.status === 404 || res.status === 422, `${slug}: ${res.status}`);
      if (res.status === 404) answers.push((await json(res)).error.message);
    }
    assert.equal(new Set(answers).size, 1, "one sentence for every 404");
  });

  test("live: brand names the hotel and the first registered domain", async () => {
    const res = await brandRoute(pub("brand"), ctx({ slug: SLUG }));
    assert.equal(res.status, 200);
    const body = (await json(res)).data;
    assert.deepEqual([body.name, body.slug, body.websiteUrl], ["Hotel Sunrise, Rajkot", SLUG, SITE]);
    assert.equal(res.headers.get("cache-control"), "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  });
});

describe("rooms, prices and availability", () => {
  test("only rooms that are available; a price only where 'show price' is ticked; no total_count, no ids of the admin DTO", async () => {
    await room({ name: "Deluxe", showPrice: true });
    await room({ name: "Suite", showPrice: false });
    await room({ name: "Hidden", available: false });
    const rooms = (await json(await roomsRoute(pub("rooms"), ctx({ slug: SLUG })))).data;
    assert.deepEqual(rooms.map((r: { name: string }) => r.name).sort(), ["Deluxe", "Suite"]);
    const deluxe = rooms.find((r: { name: string }) => r.name === "Deluxe");
    const suite = rooms.find((r: { name: string }) => r.name === "Suite");
    assert.equal(typeof deluxe.plans[0].priceDouble, "number");
    assert.deepEqual(Object.keys(suite.plans[0]).sort(), ["code", "name"], "no price anywhere for a room that hides it");
    for (const r of rooms) assert.ok(!("totalCount" in r) && !("id" in r));
    assert.ok(!JSON.stringify(rooms).includes("totalCount"));
  });

  test("availability: a free room, the dates are checked, and the count is capped", async () => {
    await room({ totalCount: 5 });
    const ok = await availabilityRoute(pub("availability?checkIn=2026-10-10&checkOut=2026-10-12&adults=2&children=0"), ctx({ slug: SLUG }));
    assert.equal(ok.status, 200, JSON.stringify(await json(ok)));
    const body = (await json(ok)).data;
    assert.equal(body.nights, 2);
    assert.equal(body.rooms[0].available, true);
    assert.ok(body.rooms[0].roomsLeft <= 3);
    const past = await availabilityRoute(pub("availability?checkIn=2026-10-01&checkOut=2026-10-03"), ctx({ slug: SLUG }));
    assert.equal(past.status, 422);
    const long = await availabilityRoute(pub("availability?checkIn=2026-10-10&checkOut=2026-12-30"), ctx({ slug: SLUG }));
    assert.equal(long.status, 422);
  });
});

describe("the other public answers carry only the whitelist", () => {
  test("site and content answer; the secret columns never appear", async () => {
    const site = await json(await siteRoute(pub("site"), ctx({ slug: SLUG })));
    const content = await json(await contentRoute(pub("content"), ctx({ slug: SLUG })));
    const text = JSON.stringify([site, content]).toLowerCase();
    for (const word of ["password", "secret", "token", "smtp", "apikey", "api_key", "recipients"]) assert.ok(!text.includes(word), word);
    assert.equal(site.data.name, "Hotel Sunrise, Rajkot");
  });

  test("media: only a file the public pages list; anything else is the same 404", async () => {
    await hotel.unit.run(sessions.get("manager") as VerifiedSession, (repos) => repos.gallery.create({ path: "room-1.jpg", caption: "Lobby", altText: null }, id(1)));
    await media.put(HOTEL_A, "room-1.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    await media.put(HOTEL_A, "secret-id-photo.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]));
    const listed = await mediaRoute(pub("media/room-1.jpg"), ctx({ slug: SLUG, file: "room-1.jpg" }));
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800");
    const other = await mediaRoute(pub("media/secret-id-photo.jpg"), ctx({ slug: SLUG, file: "secret-id-photo.jpg" }));
    assert.equal(other.status, 404);
  });
});

describe("CORS and enquiries", () => {
  const body = (over: Record<string, unknown> = {}) => ({ name: "Asha Patel", phone: "+919876543210", email: "asha@example.com", message: "Do you have a room for two?", adults: 2, children: 0, acceptedTerms: true, ...over });
  const post = (b: unknown, origin: string | null = SITE) => enquiriesPost(req("POST", `/api/v1/public/hotels/${SLUG}/enquiries`, { body: b, origin }), ctx({ slug: SLUG }));

  test("a registered domain gets the CORS headers; any other origin gets none and a cross-site POST is refused", async () => {
    const read = await brandRoute(pub("brand", SLUG, SITE), ctx({ slug: SLUG }));
    assert.equal(read.headers.get("access-control-allow-origin"), SITE);
    assert.match(read.headers.get("vary") ?? "", /Origin/);
    const stranger = await brandRoute(pub("brand", SLUG, "https://evil.example"), ctx({ slug: SLUG }));
    assert.equal(stranger.headers.get("access-control-allow-origin"), null);
    assert.equal((await post(body(), "https://evil.example")).status, 403);
    const pre = await enquiriesOptions(req("OPTIONS", `/api/v1/public/hotels/${SLUG}/enquiries`, { origin: SITE }), ctx({ slug: SLUG }));
    assert.equal(pre.headers.get("access-control-allow-origin"), SITE);
    assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
  });

  test("an enquiry from the registered domain is kept as a new enquiry with a reference; the honeypot is answered as success and dropped; bad input is a 422", async () => {
    const res = await post(body({ checkIn: "2026-10-20", checkOut: "2026-10-22" }));
    assert.equal(res.status, 201, JSON.stringify(await json(res)));
    const { reference } = (await json(res)).data;
    assert.match(reference, /^WEB-\d{8}-\d{5}$/);
    assert.equal(data().enquiries.length, 1);
    assert.equal(data().enquiries[0].reference, reference);
    const trap = await post(body({ website: "http://spam.example" }));
    assert.equal(trap.status, 201);
    assert.equal(data().enquiries.length, 1, "the honeypot row is dropped");
    for (const bad of [body({ phone: "12" }), body({ name: "" }), body({ acceptedTerms: false }), body({ checkIn: "2026-10-22", checkOut: "2026-10-20" }), { ...body(), role: "admin" }]) {
      assert.equal((await post(bad)).status, 422);
    }
    assert.equal(data().enquiries.length, 1);
  });
  test("the hotel's recipients get a mail row for a new enquiry (guest details only inside the payload); the honeypot and a bad enquiry send none", async () => {
    await hotel.unit.run(sessions.get("manager") as VerifiedSession, (repos) => repos.siteSettings.update({ recipients: [{ name: "Reception", email: "Reception@Sunrise.example" }, { name: "Dup", email: "reception@sunrise.example" }, { name: "Bad", email: "not-an-address" }] }, id(1)));
    await post(body({ website: "x" }));
    await post(body({ phone: "12" }));
    assert.equal(platform.data().outbox.length, 0);
    const res = await post(body({ checkIn: "2026-10-20", checkOut: "2026-10-22" }));
    assert.equal(res.status, 201);
    const rows = platform.data().outbox;
    assert.equal(rows.length, 1, "one address once, the invalid one skipped");
    assert.deepEqual([rows[0].kind, rows[0].toEmail, rows[0].status], ["enquiry_new", "reception@sunrise.example", "pending"]);
    const payload = JSON.parse(rows[0].payload as string);
    assert.deepEqual([payload.name, payload.guestName, payload.hotelName, payload.checkIn], ["Reception", "Asha Patel", "Hotel Sunrise, Rajkot", "2026-10-20"]);
    assert.match(payload.reference, /^WEB-/);
  });
});

describe("the hotel's own settings: Website live and the registered domains", () => {
  const put = (who: string, b: unknown) => siteAccessPut(req("PUT", "/api/v1/website/site", { who, body: b }), ctx());

  test("read: slug, switch, domains and the Sign in address; needs the website settings", async () => {
    const res = await siteAccessGet(req("GET", "/api/v1/website/site", { who: "viewer" }), ctx());
    assert.equal(res.status, 200);
    assert.deepEqual((await json(res)).data, { live: true, domains: ["www.sunrise.example"], slug: SLUG, signInUrl: `https://hms.test/?hotel=${SLUG}` });
    assert.equal((await siteAccessGet(req("GET", "/api/v1/website/site", { who: "nobody" }), ctx())).status, 403);
    assert.equal((await put("viewer", { live: false, domains: [] })).status, 403, "a viewer cannot change it");
  });

  test("save: lower-cased and cleaned, audited once, and a no-op change is not audited", async () => {
    const res = await put("manager", { live: false, domains: ["WWW.Sunrise.example", "sunrise.example"] });
    assert.equal(res.status, 200, JSON.stringify(await json(res)));
    assert.deepEqual((await json(res)).data.domains, ["www.sunrise.example", "sunrise.example"]);
    assert.equal(platform.data().sites[0].live, false);
    assert.deepEqual(audited, ["website.site_changed"]);
    await put("manager", { live: false, domains: ["www.sunrise.example", "sunrise.example"] });
    assert.equal(audited.length, 1);
  });

  test("bad addresses are a 422 on domains with a plain sentence: scheme, path, port, empty, duplicate, more than 5, another hotel's", async () => {
    platform.data().hotels.push({ id: id(77), name: "Other", group: null });
    platform.data().sites.push({ hotelId: id(77), slug: "other", live: true, domains: ["taken.example"] });
    for (const domains of [["https://www.x.example"], ["www.x.example/path"], ["www.x.example:8080"], [""], ["a.example", "A.example"], ["a.example", "b.example", "c.example", "d.example", "e.example", "f.example"], ["nodot"], ["taken.example"]]) {
      const res = await put("manager", { live: true, domains });
      assert.equal(res.status, 422, JSON.stringify(domains));
      assert.ok((await json(res)).error.details.fields.domains, JSON.stringify(domains));
    }
    assert.deepEqual(platform.data().sites.find((s) => s.hotelId === HOTEL_A)?.domains, ["www.sunrise.example"], "nothing changed");
    assert.equal((await put("manager", { live: true, domains: [] })).status, 200, "live with no address is allowed");
  });
});
