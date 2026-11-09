// Deliverability and the campaign engine on the REAL PostgreSQL instance, as hms_app (platform migration 0130, hotel migration 0044): the repositories' SQL
// (repos/postgres/auth.ts mailSafety, campaignRuns and the new outbox methods; repos/postgres/companies.ts marketing) and the tables' own CHECKs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { newId } from "../../src/server/db/ids";
import type { AuthRepos, PlatformUnit } from "../../src/server/repos/auth";
import type { CompaniesRepos } from "../../src/server/repos/companies";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { createPgCompaniesUnit } from "../../src/server/repos/postgres/companies";
import type { Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let pool: SharedPool;
let platform: PlatformUnit;
let database: Database;
let companies: Unit<CompaniesRepos>;
let hotel: CreatedHotel;
let superId: string;
const USER = newId();
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const NOW = new Date();
const run = <T>(work: (r: AuthRepos) => Promise<T>): Promise<T> => platform.run(work);
const inHotel = <T>(work: (r: CompaniesRepos) => Promise<T>): Promise<T> => companies.run({ hotelId: hotel.id, userId: USER }, work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Mail Engine Hotel");
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  platform = createPgPlatformUnit(pool);
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  companies = createPgCompaniesUnit(database.withHotel);
  superId = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Mail Safety SA', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin', 'code_required', true)) AS id", [superId, `ms${tag()}`, HASH, role]);
});

after(async () => {
  await owner?.query("DELETE FROM platform.mail_suppressions WHERE created_by = $1 OR email LIKE '%@mail-engine.test'", [superId]).catch(() => undefined);
  await owner?.query("DELETE FROM platform.mail_send_counts WHERE scope = $1", [hotel?.id ?? ""]).catch(() => undefined);
  await owner?.query("DELETE FROM platform.outbox WHERE hotel_id = $1", [hotel?.id]).catch(() => undefined);
  await owner?.query("DELETE FROM platform.logins WHERE id = $1", [superId]).catch(() => undefined);
  await pool?.end();
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("platform 0130 through the repository", () => {
  test("suppressions: one per address and hotel (every hotel = null), lower case only, found for the right hotel, searched and paged, lifted", async () => {
    const e = `bounce${tag()}@mail-engine.test`;
    assert.equal(await run((r) => r.mailSafety.ready()), true);
    assert.equal(await run((r) => r.mailSafety.suppress({ email: e.toUpperCase(), hotelId: null, reason: "bounce", source: "ses", detail: "Permanent/General", createdBy: null }, NOW)), true);
    assert.equal(await run((r) => r.mailSafety.suppress({ email: e, hotelId: null, reason: "bounce", source: "brevo", detail: null, createdBy: null }, NOW)), false, "the same address for every hotel again");
    assert.equal(await run((r) => r.mailSafety.suppress({ email: e, hotelId: hotel.id, reason: "complaint", source: "brevo", detail: null, createdBy: superId }, NOW)), true, "the same address for one hotel is its own row");
    const other = `spam${tag()}@mail-engine.test`;
    await run((r) => r.mailSafety.suppress({ email: other, hotelId: hotel.id, reason: "complaint", source: "ses", detail: null, createdBy: null }, NOW));
    assert.deepEqual([...(await run((r) => r.mailSafety.suppressedAmong(hotel.id, [e, other, "fine@mail-engine.test"])))].sort(), [e, other].sort());
    assert.deepEqual([...(await run((r) => r.mailSafety.suppressedAmong(randomUUID(), [e, other])))], [e], "another hotel: only the every-hotel row");
    const found = await run((r) => r.mailSafety.suppressions({ search: e.slice(0, 10), limit: 10 }));
    assert.ok(found.length >= 2 && found.every((s) => s.email.includes(e.slice(0, 10))));
    const page1 = await run((r) => r.mailSafety.suppressions({ search: "@mail-engine.test", limit: 1 }));
    const page2 = await run((r) => r.mailSafety.suppressions({ search: "@mail-engine.test", limit: 1, before: { at: page1[0].createdAt, id: page1[0].id } }));
    assert.notEqual(page2[0]?.id, page1[0].id);
    const lifted = await run((r) => r.mailSafety.unsuppress(found[0].id));
    assert.equal(lifted?.id, found[0].id);
    assert.equal(await run((r) => r.mailSafety.unsuppress(found[0].id)), null);
    // the table's own CHECKs: lower case, a known reason
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.mail_suppressions (email, reason, source) VALUES ('Upper@X.in', 'bounce', 'ses')")), "23514");
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.mail_suppressions (email, reason, source) VALUES ('a@x.in', 'other', 'ses')")), "23514");
  });

  test("bounce and complaint counts sit next to the sent count; the rates sum the days from a given day", async () => {
    const today = NOW.toISOString().slice(0, 10);
    const old = new Date(NOW.getTime() - 9 * 86_400_000).toISOString().slice(0, 10);
    await run((r) => r.outbox.addSent([{ scope: hotel.id, day: today, sent: 300 }, { scope: hotel.id, day: old, sent: 1000 }]));
    await run((r) => r.mailSafety.addEvents([{ scope: hotel.id, day: today, bounced: 12, complained: 1 }, { scope: hotel.id, day: old, bounced: 500, complained: 0 }]));
    await run((r) => r.mailSafety.addEvents([{ scope: hotel.id, day: today, bounced: 3, complained: 0 }]));
    const from = new Date(NOW.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(await run((r) => r.mailSafety.rates(hotel.id, from)), { sent: 300, bounced: 15, complained: 1 });
    assert.deepEqual(await run((r) => r.mailSafety.rates(hotel.id, old)), { sent: 1300, bounced: 515, complained: 1 });
  });

  test("holds: held once, released with a reason (counted from then), held again; the release needs its reason (CHECK)", async () => {
    assert.equal(await run((r) => r.mailSafety.putOnHold({ hotelId: hotel.id, reason: "bounces", detail: "bounces 6% of 300 mails", heldBy: null }, NOW)), true);
    assert.equal(await run((r) => r.mailSafety.putOnHold({ hotelId: hotel.id, reason: "manual", detail: "again", heldBy: superId }, NOW)), false);
    assert.deepEqual([...(await run((r) => r.mailSafety.heldAmong([hotel.id, randomUUID()])))], [hotel.id]);
    assert.equal(await run((r) => r.mailSafety.release(hotel.id, superId, "List cleaned", NOW)), true);
    assert.equal(await run((r) => r.mailSafety.release(hotel.id, superId, "again", NOW)), false);
    const h = await run((r) => r.mailSafety.hold(hotel.id));
    assert.deepEqual([h?.releasedBy, h?.releaseReason, h?.countedFrom?.getTime()], [superId, "List cleaned", NOW.getTime()]);
    assert.equal((await run((r) => r.mailSafety.heldAmong([hotel.id]))).size, 0);
    assert.equal(await run((r) => r.mailSafety.putOnHold({ hotelId: hotel.id, reason: "manual", detail: "by hand", heldBy: superId }, NOW)), true, "a released hotel can be held again");
    assert.ok((await run((r) => r.mailSafety.holds())).some((x) => x.hotelId === hotel.id && x.releasedAt === null && x.reason === "manual"));
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotel_mail_holds SET released_at = now() WHERE hotel_id = $1", [hotel.id])), "23514");
  });

  test("the running list and the new outbox reads: waiting campaign mail per hotel, cancel a campaign's waiting mail, the hotel of a row, the last hotel that mailed an address", async () => {
    const campaignId = randomUUID();
    await run((r) => r.campaignRuns.start(hotel.id, campaignId, NOW));
    await run((r) => r.campaignRuns.setState(hotel.id, campaignId, "paused"));
    assert.deepEqual((await run((r) => r.campaignRuns.active())).filter((x) => x.campaignId === campaignId).map((x) => x.state), ["paused"]);
    await run((r) => r.campaignRuns.start(hotel.id, campaignId, NOW));
    assert.deepEqual((await run((r) => r.campaignRuns.active())).filter((x) => x.campaignId === campaignId).map((x) => x.state), ["sending"]);
    await run((r) => r.campaignRuns.end(hotel.id, campaignId));
    assert.equal((await run((r) => r.campaignRuns.active())).filter((x) => x.campaignId === campaignId).length, 0);

    const template = `campaign-${campaignId}`;
    const to = `guest${tag()}@mail-engine.test`;
    for (const e of [to, `b${tag()}@mail-engine.test`, `c${tag()}@mail-engine.test`]) {
      await run((r) => r.outbox.enqueue({ userId: null, hotelId: hotel.id, kind: "campaign", toEmail: e, template, payload: JSON.stringify({ name: "G", subject: "S", text: "t" }) }, NOW));
    }
    assert.equal((await run((r) => r.outbox.bulkWaiting([hotel.id]))).get(hotel.id), 3);
    const [row] = await run((r) => r.outbox.claimLane(NOW, "bulk", 1, hotel.id));
    await run((r) => r.outbox.finish(row.id, { status: "sent", attempts: 1, sentAt: NOW }));
    assert.equal(await run((r) => r.outbox.hotelOf(row.id)), hotel.id);
    assert.equal(await run((r) => r.outbox.hotelOf(randomUUID())), undefined);
    assert.equal(await run((r) => r.outbox.hotelOf("not-a-uuid")), undefined);
    assert.equal(await run((r) => r.outbox.lastHotelMailedTo(row.toEmail.toUpperCase(), new Date(NOW.getTime() - 60_000))), hotel.id);
    assert.equal(await run((r) => r.outbox.lastHotelMailedTo(row.toEmail, new Date(NOW.getTime() + 60_000))), null, "nothing since then");
    assert.equal(await run((r) => r.outbox.cancelTemplate(hotel.id, template)), 2);
    const states = (await owner.query("SELECT status, last_error, payload FROM platform.outbox WHERE template = $1 ORDER BY status", [template])).rows;
    assert.deepEqual(states.map((s) => [s.status, s.last_error, s.payload]), [["failed", "CANCELLED", null], ["failed", "CANCELLED", null], ["sent", null, null]]);
    assert.equal((await run((r) => r.outbox.bulkWaiting([hotel.id]))).get(hotel.id), undefined);
  });
});

describe("hotel 0044: a campaign sent a little at a time", () => {
  test("begin keeps the recipients; next / queued / skipped move through them once; pause, resume, finish; the CHECKs hold the states", async () => {
    const c = await inHotel((r) => r.marketing.create({ subject: "Diwali", body: "Hello", audience: "all", createdBy: USER }));
    assert.deepEqual([c.status, c.queued, c.leftOut, c.finishedAt], ["draft", 0, 0, null]);
    const people = Array.from({ length: 7 }, (_, i) => ({ email: `p${i}@mail-engine.test`, name: `P ${i}` }));
    const begun = await inHotel((r) => r.marketing.begin(c.id, people, 2, NOW, USER));
    assert.deepEqual([begun?.status, begun?.recipients, begun?.leftOut, begun?.queued], ["sending", 7, 2, 0]);
    const first = await inHotel((r) => r.marketing.nextRecipients(c.id, 3));
    assert.deepEqual(first.map((x) => x.email), ["p0@mail-engine.test", "p1@mail-engine.test", "p2@mail-engine.test"]);
    await inHotel((r) => r.marketing.markQueued(c.id, first.map((x) => x.id), NOW));
    await inHotel((r) => r.marketing.markQueued(c.id, first.map((x) => x.id), NOW));
    const second = await inHotel((r) => r.marketing.nextRecipients(c.id, 10));
    assert.equal(second.length, 4, "queued ones are not read again");
    await inHotel((r) => r.marketing.markSkipped(c.id, [second[0].id], "opted_out"));
    await inHotel((r) => r.marketing.markSkipped(c.id, [second[1].id], "cancelled"));
    await inHotel((r) => r.marketing.markQueued(c.id, second.slice(2).map((x) => x.id), NOW));
    const now = await inHotel((r) => r.marketing.get(c.id));
    assert.deepEqual([now?.queued, now?.leftOut], [5, 3], "queued once each; a cancelled skip is not 'left out'");
    assert.deepEqual(await inHotel((r) => r.marketing.nextRecipients(c.id, 10)), []);
    await inHotel((r) => r.marketing.optOut("P5@mail-engine.test"));
    assert.deepEqual([...(await inHotel((r) => r.marketing.optedOutAmong(["p5@mail-engine.test", "p6@mail-engine.test"])))], ["p5@mail-engine.test"]);

    const paused = await inHotel((r) => r.marketing.setStatus(c.id, "paused", NOW, USER));
    assert.deepEqual([paused?.status, paused?.pausedAt?.getTime()], ["paused", NOW.getTime()]);
    const resumed = await inHotel((r) => r.marketing.setStatus(c.id, "sending", NOW, USER));
    assert.deepEqual([resumed?.status, resumed?.pausedAt], ["sending", null]);
    const sent = await inHotel((r) => r.marketing.setStatus(c.id, "sent", NOW, null));
    assert.deepEqual([sent?.status, sent?.finishedAt?.getTime(), sent?.updatedBy], ["sent", NOW.getTime(), USER]);

    // the CHECKs of 0044 (as the hotel's owner role through the owner connection)
    const schema = `"${hotel.schema}"`;
    assert.equal(await sqlStateOf(owner.query(`UPDATE ${schema}.mail_campaigns SET status = 'cancelled', finished_at = NULL WHERE id = $1`, [c.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE ${schema}.mail_campaigns SET status = 'paused', paused_at = NULL WHERE id = $1`, [c.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE ${schema}.mail_campaigns SET queued = recipients + 1 WHERE id = $1`, [c.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE ${schema}.mail_campaign_recipients SET skipped = 'other' WHERE campaign_id = $1`, [c.id])), "23514");
  });

  test("cancel: status cancelled with when and by whom", async () => {
    const c = await inHotel((r) => r.marketing.create({ subject: "Offer", body: "Hi", audience: "guests", createdBy: USER }));
    await inHotel((r) => r.marketing.begin(c.id, [{ email: "x@mail-engine.test", name: "X" }], 0, NOW, USER));
    const cancelled = await inHotel((r) => r.marketing.setStatus(c.id, "cancelled", NOW, USER));
    assert.deepEqual([cancelled?.status, cancelled?.finishedAt?.getTime()], ["cancelled", NOW.getTime()]);
    const raw = (await owner.query(`SELECT cancelled_by FROM "${hotel.schema}".mail_campaigns WHERE id = $1`, [c.id])).rows[0];
    assert.equal(raw.cancelled_by, USER);
  });
});
