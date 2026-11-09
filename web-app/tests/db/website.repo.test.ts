// The Website repositories on the REAL PostgreSQL instance (repos/postgres/website.ts): enquiries and their reference counter, rooms, plans, the
// calendar, the wording, the card lists, the settings and the change log.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { createPgWebsiteUnit } from "../../src/server/repos/postgres/website";
import { RepoError, type Unit } from "../../src/server/repos/types";
import type { WebsiteRepos } from "../../src/server/repos/website";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<WebsiteRepos>;
const ACTOR = newId();
const run = <T>(work: (r: WebsiteRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: ACTOR }, work);
const room = (over: Record<string, unknown> = {}) => ({ slug: `room-${Math.random().toString(36).slice(2, 7)}`, name: "Deluxe", size: "300 sq ft", bedType: "King", maxGuests: 3, totalCount: 5, note: null, badgeLabel: null, showPrice: true, available: true, photos: [{ path: "a.jpg", name: "A", alt: null }], ...over });

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Web Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 14 });
  unit = createPgWebsiteUnit(database.withHotel);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe("enquiries", () => {
  const base = { name: "Asha", phone: "9876543210", email: "a@x.test", message: "Hello", roomId: null as string | null, checkIn: "2026-05-01", checkOut: "2026-05-03", guests: 2, children: 0 };
  const make = (over: Record<string, unknown> = {}) => run((r) => r.siteEnquiries.create({ ...base, reference: `ENQ-${Math.random().toString(36).slice(2, 8)}`, ipAddress: "10.0.0.1", createdAt: new Date(), ...over }));

  test("create (new, with its arrival moment and address), unique reference, dates checked, update, get and getMany", async () => {
    const e = await make({ reference: "ENQ-26-1", createdAt: new Date("2026-03-01T05:00:00Z") });
    assert.deepEqual([e.status, e.reference, e.ipAddress, e.createdAt.toISOString(), e.decidedAt, e.checkIn, e.guests], ["new", "ENQ-26-1", "10.0.0.1", "2026-03-01T05:00:00.000Z", null, "2026-05-01", 2]);
    await assert.rejects(() => make({ reference: "ENQ-26-1" }), (x) => x instanceof RepoError && x.kind === "unique");
    await assert.rejects(() => make({ checkIn: "2026-05-05", checkOut: "2026-05-01" }), (x) => x instanceof RepoError && x.kind === "check");
    const upd = await run((r) => r.siteEnquiries.update(e.id, { phone: "9000000000", guests: 4 }, ACTOR));
    assert.deepEqual([upd.phone, upd.guests], ["9000000000", 4]);
    await assert.rejects(() => run((r) => r.siteEnquiries.update(newId(), { phone: "x" }, ACTOR)), (x) => x instanceof RepoError);
    assert.deepEqual(await run((r) => r.siteEnquiries.get(e.id)), upd);
    assert.equal((await run((r) => r.siteEnquiries.get(e.id, { forUpdate: true })))?.id, e.id);
    assert.equal((await run((r) => r.siteEnquiries.getMany([e.id, newId()]))).length, 1);
    assert.deepEqual(await run((r) => r.siteEnquiries.getMany([])), []);
  });

  test("tabs, order (decisions by when they were made), words, promote new to pending, counts, stays, arrivals, recent, remove", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".site_enquiries`);
    const rm = await run((r) => r.siteRooms.create(room({ name: "Suite", slug: "suite" }), ACTOR));
    const old = await make({ name: "Old New", reference: "E-1", createdAt: new Date("2026-02-01T05:00:00Z"), roomId: rm.id });
    const fresh = await make({ name: "Fresh New", reference: "E-2", createdAt: new Date("2026-03-10T05:00:00Z") });
    const confirmed = await make({ name: "Confirmed Guest", reference: "E-3", createdAt: new Date("2026-02-15T05:00:00Z"), roomId: rm.id, checkIn: "2026-06-01", checkOut: "2026-06-04" });
    const declined = await make({ name: "Declined Guest", reference: "E-4", createdAt: new Date("2026-02-16T05:00:00Z") });
    await run((r) => r.siteEnquiries.decide(confirmed.id, { status: "confirmed", by: ACTOR, byName: "Asha", at: new Date("2026-03-05T05:00:00Z"), note: "OK" }));
    await run((r) => r.siteEnquiries.decide(declined.id, { status: "declined", by: ACTOR, byName: "Asha", at: new Date("2026-03-06T05:00:00Z"), note: null }));
    const names = async (tab: string, words?: string[]) => (await run((r) => r.siteEnquiries.list({ tab: tab as never, words, page: 1, pageSize: 10 }))).rows.map((x) => x.name);
    assert.deepEqual(await names("all"), ["Fresh New", "Declined Guest", "Confirmed Guest", "Old New"], "by arrival, newest first");
    assert.deepEqual(await names("pending"), ["Fresh New", "Old New"]);
    assert.deepEqual(await names("confirmed"), ["Confirmed Guest"]);
    assert.deepEqual(await names("declined"), ["Declined Guest"]);
    assert.deepEqual(await names("all", ["declined", "guest"]), ["Declined Guest"]);
    assert.deepEqual(await names("all", ["e-3"]), ["Confirmed Guest"], "by reference");
    assert.deepEqual(await names("all", ["9876"]), ["Fresh New", "Declined Guest", "Confirmed Guest", "Old New"], "by phone");
    const decided = (await run((r) => r.siteEnquiries.get(confirmed.id))) as { decidedBy: string; decidedByName: string; decisionNote: string; status: string };
    assert.deepEqual([decided.status, decided.decidedBy, decided.decidedByName, decided.decisionNote], ["confirmed", ACTOR, "Asha", "OK"]);
    assert.equal(await run((r) => r.siteEnquiries.promoteNew(new Date("2026-03-01T00:00:00Z"))), 1, "only the one from an earlier day");
    assert.deepEqual((await run((r) => r.siteEnquiries.get(old.id)))?.status, "pending");
    assert.deepEqual((await run((r) => r.siteEnquiries.get(fresh.id)))?.status, "new");
    assert.deepEqual(await run((r) => r.siteEnquiries.counts()), { all: 4, pending: 2, confirmed: 1, declined: 1 });
    assert.deepEqual(await run((r) => r.siteEnquiries.counts({ from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-31T00:00:00Z") })), { all: 1, pending: 1, confirmed: 0, declined: 0 });
    assert.deepEqual(await run((r) => r.siteEnquiries.confirmedStays(rm.id, "2026-06-02", "2026-06-02")), [{ checkIn: "2026-06-01", checkOut: "2026-06-04" }]);
    assert.deepEqual(await run((r) => r.siteEnquiries.confirmedStays(rm.id, "2026-06-04", "2026-06-05")), [], "the check-out day is free");
    assert.deepEqual(await run((r) => r.siteEnquiries.confirmedStays(rm.id, "2026-06-02", "2026-06-02", confirmed.id)), []);
    assert.deepEqual((await run((r) => r.siteEnquiries.arrivals("2026-06-01", "2026-06-30"))).map((x) => [x.name, x.roomName]), [["Confirmed Guest", "Suite"]]);
    assert.deepEqual((await run((r) => r.siteEnquiries.recent({ from: new Date("2026-02-10T00:00:00Z"), to: new Date("2026-03-31T00:00:00Z") }, 2))).map((x) => x.name), ["Fresh New", "Declined Guest"]);
    assert.equal(await run((r) => r.siteEnquiries.hasForRoom(rm.id)), true);
    assert.equal(await run((r) => r.siteEnquiries.hasForRoom(newId())), false);
    assert.equal(await run((r) => r.siteEnquiries.remove(declined.id)), true);
    assert.equal(await run((r) => r.siteEnquiries.remove(declined.id)), false);
  });

  test("the reference counter: one number per call per fiscal year, five at once are five different numbers", async () => {
    assert.equal(await run((r) => r.references.next(2026)), 1);
    assert.equal(await run((r) => r.references.next(2026)), 2);
    assert.equal(await run((r) => r.references.next(2027)), 1);
    const many = await Promise.all(Array.from({ length: 5 }, () => run((r) => r.references.next(2030))));
    assert.deepEqual([...many].sort((a, b) => a - b), Array.from({ length: 5 }, (_, i) => i + 1));
  });
});

describe("rooms, plans and the calendar", () => {
  test("rooms: slug unique, ordered, photos kept, plan counts, order set, removal takes plans and dated rates with it", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".site_enquiries`);
    await owner.query(`DELETE FROM "${hotel.schema}".site_rooms`);
    const a = await run((r) => r.siteRooms.create(room({ name: "Alpha", slug: "alpha" }), ACTOR));
    const b = await run((r) => r.siteRooms.create(room({ name: "Beta", slug: "beta", photos: [] }), ACTOR));
    assert.deepEqual([a.slug, a.sortOrder, b.sortOrder, a.photos, a.showPrice, a.plans], ["alpha", 1, 2, [{ path: "a.jpg", name: "A", alt: null }], true, []]);
    await assert.rejects(() => run((r) => r.siteRooms.create(room({ slug: "alpha" }), ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal(await run((r) => r.siteRooms.slugTaken("alpha")), true);
    assert.equal(await run((r) => r.siteRooms.slugTaken("alpha", a.id)), false);
    const plan = await run((r) => r.sitePlans.create(a.id, { name: "Room only", code: "EP", tiers: [{ guests: 1, pricePaise: BigInt(250_000) }, { guests: 2, pricePaise: BigInt(300_000) }], doublePaise: BigInt(300_000), singlePaise: BigInt(250_000), extraPersonPaise: null }, ACTOR));
    assert.deepEqual([plan.tiers, plan.doublePaise, plan.singlePaise, plan.extraPersonPaise, plan.active, plan.sortOrder], [[{ guests: 1, pricePaise: BigInt(250_000) }, { guests: 2, pricePaise: BigInt(300_000) }], BigInt(300_000), BigInt(250_000), null, true, 1]);
    assert.deepEqual((await run((r) => r.siteRooms.list())).map((x) => [x.name, x.plansCount]), [["Alpha", 1], ["Beta", 0]]);
    const upd = await run((r) => r.siteRooms.update(b.id, { totalCount: 9, photos: [{ path: "b.jpg", name: null, alt: "B" }] }, ACTOR));
    assert.deepEqual([upd.totalCount, upd.photos], [9, [{ path: "b.jpg", name: null, alt: "B" }]]);
    assert.equal((await run((r) => r.siteRooms.getMany([a.id, b.id, newId()]))).length, 2);
    assert.equal(await run((r) => r.siteRooms.setOrder([b.id, a.id])), true);
    assert.deepEqual((await run((r) => r.siteRooms.list())).map((x) => x.name), ["Beta", "Alpha"]);
    assert.equal(await run((r) => r.siteRooms.setOrder([b.id, newId()])), false, "every id must exist");
    assert.equal(await run((r) => r.siteRooms.setOrder([])), false);
    await run((r) => r.calendar.upsertRates([{ planId: plan.id, date: "2026-06-01", doublePaise: BigInt(1), planDouble: BigInt(300_000), planSingle: null }]));
    assert.equal(await run((r) => r.siteRooms.remove(a.id)), true);
    assert.equal(await run((r) => r.sitePlans.get(plan.id)), null, "plans go with their room");
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".site_plan_date_rates`)).rows[0].n), 0, "and their dated rates");
    assert.equal(await run((r) => r.siteRooms.remove(a.id)), false);
  });

  test("plans: by room in order, active only, names, update (including the ladder), order, remove", async () => {
    const r1 = await run((r) => r.siteRooms.create(room({ slug: "plans-room" }), ACTOR));
    const p = (name: string, code = "EP") => run((r) => r.sitePlans.create(r1.id, { name, code, tiers: [], doublePaise: BigInt(100), singlePaise: null, extraPersonPaise: BigInt(50) }, ACTOR));
    const p1 = await p("Plan One");
    const p2 = await p("Plan Two", "CP");
    const upd = await run((r) => r.sitePlans.update(p2.id, { active: false, singlePaise: BigInt(90), tiers: [{ guests: 3, pricePaise: BigInt(150) }], name: "Plan Two B" }, ACTOR));
    assert.deepEqual([upd.active, upd.singlePaise, upd.tiers, upd.name, upd.extraPersonPaise], [false, BigInt(90), [{ guests: 3, pricePaise: BigInt(150) }], "Plan Two B", BigInt(50)]);
    assert.deepEqual((await run((r) => r.sitePlans.forRooms([r1.id]))).map((x) => x.name), ["Plan One", "Plan Two B"]);
    assert.deepEqual((await run((r) => r.sitePlans.forRooms([r1.id], { activeOnly: true }))).map((x) => x.name), ["Plan One"]);
    assert.deepEqual(await run((r) => r.sitePlans.forRooms([])), []);
    assert.ok((await run((r) => r.sitePlans.names())).includes("Plan One"));
    assert.equal(await run((r) => r.sitePlans.setOrder([p2.id, p1.id])), true);
    assert.deepEqual((await run((r) => r.sitePlans.forRooms([r1.id]))).map((x) => x.name), ["Plan Two B", "Plan One"]);
    assert.equal((await run((r) => r.sitePlans.get(p1.id, { forUpdate: true })))?.name, "Plan One");
    await assert.rejects(() => run((r) => r.sitePlans.update(newId(), { active: true }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.sitePlans.remove(p1.id)), true);
    assert.equal(await run((r) => r.sitePlans.remove(p1.id)), false);
  });

  test("calendar: an existing dated rate changes only the given field, a new one takes the rest from the plan; inventory; blocking", async () => {
    const rm = await run((r) => r.siteRooms.create(room({ slug: "cal-room", totalCount: 4, name: "Calendar Room" }), ACTOR));
    const plan = await run((r) => r.sitePlans.create(rm.id, { name: "Cal", code: "EP", tiers: [], doublePaise: BigInt(300), singlePaise: BigInt(250), extraPersonPaise: null }, ACTOR));
    const rate = (over: Record<string, unknown>) => ({ planId: plan.id, date: "2026-07-01", planDouble: BigInt(300), planSingle: BigInt(250), ...over });
    await run((r) => r.calendar.upsertRates([rate({ doublePaise: BigInt(999) }), rate({ date: "2026-07-02", singlePaise: BigInt(111) }), rate({ date: "2026-07-03", singlePaise: null, doublePaise: BigInt(5) })] as never));
    const first = await run((r) => r.calendar.rates([plan.id], "2026-07-01", "2026-07-31"));
    assert.deepEqual(first.map((x) => [x.date, x.doublePaise, x.singlePaise]), [["2026-07-01", BigInt(999), BigInt(250)], ["2026-07-02", BigInt(300), BigInt(111)], ["2026-07-03", BigInt(5), null]], "a new row takes the plan's other field");
    await run((r) => r.calendar.upsertRates([rate({ singlePaise: BigInt(7) }), rate({ date: "2026-07-03", doublePaise: BigInt(6) })] as never));
    const second = await run((r) => r.calendar.rates([plan.id], "2026-07-01", "2026-07-31"));
    assert.deepEqual(second.map((x) => [x.doublePaise, x.singlePaise]), [[BigInt(999), BigInt(7)], [BigInt(300), BigInt(111)], [BigInt(6), null]], "an existing row changes only the field given");
    assert.deepEqual(await run((r) => r.calendar.rates([plan.id], "2026-08-01", "2026-08-31")), []);
    assert.deepEqual(await run((r) => r.calendar.rates([], "2026-07-01", "2026-07-31")), []);
    await run((r) => r.calendar.upsertInventory([{ roomId: rm.id, date: "2026-07-01", roomsLeft: 2, blocked: false }, { roomId: rm.id, date: "2026-07-02", roomsLeft: 0, blocked: true }]));
    await run((r) => r.calendar.upsertInventory([{ roomId: rm.id, date: "2026-07-01", roomsLeft: 1, blocked: false }]));
    assert.deepEqual((await run((r) => r.calendar.inventory([rm.id], "2026-07-01", "2026-07-31"))).map((x) => [x.date, x.roomsLeft, x.blocked]), [["2026-07-01", 1, false], ["2026-07-02", 0, true]]);
    await run((r) => r.calendar.setBlocked([{ roomId: rm.id, date: "2026-07-01", blocked: true, totalCount: 4 }, { roomId: rm.id, date: "2026-07-09", blocked: true, totalCount: 4 }, { roomId: rm.id, date: "2026-07-02", blocked: false, totalCount: 4 }]));
    const inv = await run((r) => r.calendar.inventory([rm.id], "2026-07-01", "2026-07-31"));
    assert.deepEqual(inv.map((x) => [x.date, x.roomsLeft, x.blocked]), [["2026-07-01", 1, true], ["2026-07-02", 0, false], ["2026-07-09", 4, true]], "a new blocked day starts with the room's total");
    assert.deepEqual((await run((r) => r.calendar.blockedFrom("2026-07-02"))).map((x) => [x.roomName, x.date]), [["Calendar Room", "2026-07-09"]]);
    await assert.rejects(() => run((r) => r.calendar.upsertInventory([{ roomId: rm.id, date: "2026-07-05", roomsLeft: 300, blocked: false }])), (e) => e instanceof RepoError && e.kind === "check");
  });
});

describe("the wording, the card lists, the settings and the change log", () => {
  test("page content: the hotel's one row with its defaults, patched, the list of points kept", async () => {
    const first = await run((r) => r.content.get());
    assert.equal(first.heroTitleLine1, "Where every stay");
    assert.deepEqual(first.enquirePoints, []);
    const upd = await run((r) => r.content.update({ heroTitleLine1: "Welcome", aboutP2: "Second paragraph", enquirePoints: ["Free cancellation", "No hidden fees"], footerTagline: null }, ACTOR));
    assert.deepEqual([upd.heroTitleLine1, upd.aboutP2, upd.enquirePoints, upd.footerTagline, upd.heroTitleEmphasis], ["Welcome", "Second paragraph", ["Free cancellation", "No hidden fees"], null, first.heroTitleEmphasis]);
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".site_page_content`)).rows[0].n), 1);
    assert.deepEqual(await run((r) => r.content.get()), upd);
  });

  test("the ordered lists (gallery, services, house rules, nearby places): added last, updated, ordered, counted, removed", async () => {
    const a = await run((r) => r.gallery.create({ path: "1.jpg", caption: "One", altText: null }, ACTOR));
    const b = await run((r) => r.gallery.create({ path: "2.jpg", caption: null, altText: "Two" }, ACTOR));
    assert.deepEqual([a.sortOrder, b.sortOrder, await run((r) => r.gallery.count())], [1, 2, 2]);
    assert.equal(await run((r) => r.gallery.setOrder([b.id, a.id])), true);
    assert.deepEqual((await run((r) => r.gallery.list())).map((x) => x.path), ["2.jpg", "1.jpg"]);
    assert.equal((await run((r) => r.gallery.update(a.id, { caption: "Changed" }, ACTOR))).caption, "Changed");
    await assert.rejects(() => run((r) => r.gallery.update(newId(), { caption: "x" }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.gallery.remove(a.id)), true);
    assert.equal(await run((r) => r.gallery.get(a.id)), null);
    const s = await run((r) => r.services.create({ title: "Wi-Fi", description: "Fast" }, ACTOR));
    assert.deepEqual([s.title, s.iconPath], ["Wi-Fi", null]);
    const pol = await run((r) => r.policies.create({ title: "Check-in", lines: ["From 12 PM", "ID needed"] }, ACTOR));
    assert.deepEqual(pol.lines, ["From 12 PM", "ID needed"]);
    assert.deepEqual((await run((r) => r.policies.update(pol.id, { lines: ["Only one"] }, ACTOR))).lines, ["Only one"]);
    const n = await run((r) => r.nearby.create({ title: "Beach", distanceLabel: "2 km", mapQuery: "beach", mapUrl: null, originLat: 21.17, originLng: 72.83 }, ACTOR));
    assert.deepEqual([n.originLat, n.originLng, n.distanceLabel], [21.17, 72.83, "2 km"]);
    await assert.rejects(() => run((r) => r.nearby.create({ title: "Bad", distanceLabel: "x", mapQuery: null, mapUrl: null, originLat: 95, originLng: 0 }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
  });

  test("settings: defaults, a patch of the plain fields, the secrets kept apart and in plain text, a list of recipients, the Google fetch figures", async () => {
    const first = await run((r) => r.siteSettings.get());
    assert.deepEqual([first.fields.address, first.fields.checkinTime, first.fields.googleMinReviewRating, first.fields.recipients, first.fields.googleReviewCount, first.fields.googleLastFetchedAt, first.secrets.smtpPassword], ["", "12:00 PM", 3, [], 0, null, null]);
    const at = new Date("2026-03-04T10:00:00Z");
    const upd = await run((r) =>
      r.siteSettings.update({ email: "info@hotel.test", mapLat: 21.1702, mapLng: 72.8311, recipients: [{ name: "Owner", email: "o@hotel.test" }], smtpHost: "smtp.test", smtpPort: 587, googleLastFetchedAt: at, googleReviewCount: 42, secrets: { smtpPassword: "pw-1", googleMapsApiKey: "key-1" } }, ACTOR),
    );
    assert.deepEqual([upd.fields.email, upd.fields.mapLat, upd.fields.mapLng, upd.fields.recipients, upd.fields.smtpPort, upd.fields.googleLastFetchedAt?.toISOString(), upd.fields.googleReviewCount], ["info@hotel.test", 21.1702, 72.8311, [{ name: "Owner", email: "o@hotel.test" }], 587, "2026-03-04T10:00:00.000Z", 42]);
    assert.deepEqual([upd.secrets.smtpPassword, upd.secrets.googleMapsApiKey, upd.secrets.gbpOauthClientSecret], ["pw-1", "key-1", null]);
    const again = await run((r) => r.siteSettings.update({ secrets: { smtpPassword: null }, checkinTime: "2:00 PM" }, ACTOR));
    assert.deepEqual([again.secrets.smtpPassword, again.secrets.googleMapsApiKey, again.fields.checkinTime, again.fields.email], [null, "key-1", "2:00 PM", "info@hotel.test"]);
    await assert.rejects(() => run((r) => r.siteSettings.update({ googleMinReviewRating: 9 }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal((await run((r) => r.siteSettings.get({ forUpdate: true }))).fields.smtpHost, "smtp.test");
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".site_settings`)).rows[0].n), 1);
  });

  test("the module's change log: the latest website lines, newest first", async () => {
    for (const [i, module] of [["one", "website"], ["two", "revenue"], ["three", "website"]] as const) {
      await owner.query(`INSERT INTO "${hotel.schema}".system_logs (module, action, entity, summary, user_name) VALUES ($1, 'updated', 'x', $2, 'Asha')`, [module, i]);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual((await run((r) => r.websiteChanges.recent(10))).map((x) => [x.summary, x.userName]), [["three", "Asha"], ["one", "Asha"]]);
    assert.equal((await run((r) => r.websiteChanges.recent(1))).length, 1);
  });
});

after(async () => {
  await releaseTestLock?.();
});
