// Notifications (hotel migration 0039) on the REAL PostgreSQL, on the throwaway hms_test database only: the repository's SQL, the table rules (one target per
// company, the CHECKs), and the row-level security as the second fence (a company's transaction sees only its own targets and the notifications that have one,
// whatever the query; a guest's sees none; staff see everything; the scope ends with the transaction). Then the REAL services over the PostgreSQL units:
// send, the company's list, unread, read, read all. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { pgNotificationRepo, createPgNotificationsUnit } from "../../src/server/repos/postgres/notifications";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { createNotificationService } from "../../src/server/services/notifications/notificationService";
import { createPortalNotifications } from "../../src/server/services/notifications/portalNotificationService";
import { catalog, grant, makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-05";
const AT = new Date("2026-10-05T10:00:00+05:30");

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Notifications Repo Hotel");
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const staff = <T>(work: (tx: TxClient) => Promise<T>): Promise<T> => database.withHotel({ hotelId: hotel.id, userId: USER } as never, work);
const asCompany = <T>(companyId: string, work: (tx: TxClient) => Promise<T>): Promise<T> => database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "company", id: companyId } } as never, work);
const asGuest = <T>(customerId: string, work: (tx: TxClient) => Promise<T>): Promise<T> => database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "guest", id: customerId } } as never, work);
type Queryable = Pick<TxClient, "query"> | Pick<DbClient, "query">;
const count = (tx: Queryable, sql: string, params: unknown[] = []): Promise<number> => tx.query(sql, params).then((r) => Number(r.rows[0]?.n ?? 0));
const ids = (tx: Queryable, sql: string, params: unknown[] = []): Promise<string[]> => tx.query(sql, params).then((r) => r.rows.map((x) => String(x.id)).sort());

const fields = (over: Record<string, unknown> = {}) => ({
  audienceKind: "selected" as const, title: "Rooms closed", body: "Third floor closed.\nSecond floor instead.", priority: "normal" as const, linkView: null, linkId: null, expiresAt: null, alsoEmail: false, createdBy: USER, ...over,
});

describe("the repository's SQL and the table rules", () => {
  test("create writes the notice and one target per company; get, targets, list (words, status, paging), withdraw", async () => {
    const tcs = await insertRow(owner, hotel.schema, "company_profiles", { name: "Tata Consultancy Services" });
    const infy = await insertRow(owner, hotel.schema, "company_profiles", { name: "Infosys" });
    const t = String(tcs.id);
    const i = String(infy.id);
    const n = await staff((tx) => pgNotificationRepo(tx).create(fields({ expiresAt: "2026-10-24", priority: "important", alsoEmail: true }), [{ companyId: t, emailStatus: "queued" }, { companyId: i, emailStatus: "skipped" }], AT));
    assert.deepEqual([n.targetCount, n.expiresAt, n.priority, n.alsoEmail, n.withdrawnAt, n.createdBy, n.createdAt.toISOString()], [2, "2026-10-24", "important", true, null, USER, AT.toISOString()]);
    const got = await staff((tx) => pgNotificationRepo(tx).get(n.id));
    assert.equal(got?.readCount, 0);
    const targets = await staff((tx) => pgNotificationRepo(tx).targets(n.id));
    assert.deepEqual(targets.map((x) => [x.companyName, x.readAt, x.emailStatus]), [["Infosys", null, "skipped"], ["Tata Consultancy Services", null, "queued"]]);

    const later = await staff((tx) => pgNotificationRepo(tx).create(fields({ title: "Statement ready", body: "September", audienceKind: "one", expiresAt: "2026-10-01" }), [{ companyId: t, emailStatus: "none" }], new Date("2026-10-05T11:00:00+05:30")));
    const list = (q: Record<string, unknown> = {}) => staff((tx) => pgNotificationRepo(tx).list({ today: TODAY, page: 1, pageSize: 25, ...q } as never));
    assert.deepEqual((await list()).rows.map((r) => r.id), [later.id, n.id], "newest first");
    assert.deepEqual((await list({ words: ["statement"] })).rows.map((r) => r.id), [later.id]);
    assert.deepEqual((await list({ words: ["THIRD", "floor"] })).rows.map((r) => r.id), [n.id], "title or text, any case");
    assert.deepEqual((await list({ status: "expired" })).rows.map((r) => r.id), [later.id], "its last day was 1 October");
    assert.deepEqual((await list({ status: "active" })).rows.map((r) => r.id), [n.id]);
    assert.deepEqual((await list({ pageSize: 1, page: 2 })).rows.map((r) => r.id), [n.id]);
    assert.equal((await list({ pageSize: 1 })).total, 2);
    assert.equal((await list({ countTotal: false })).total, -1);

    const w = await staff((tx) => pgNotificationRepo(tx).withdraw(n.id, USER, AT));
    assert.equal(w?.withdrawnAt?.toISOString(), AT.toISOString());
    const again = await staff((tx) => pgNotificationRepo(tx).withdraw(n.id, USER, new Date("2026-10-06T10:00:00Z")));
    assert.equal(again?.withdrawnAt?.toISOString(), AT.toISOString(), "the first withdrawal time stays");
    assert.deepEqual((await list({ status: "withdrawn" })).rows.map((r) => r.id), [n.id]);
    assert.equal(await staff((tx) => pgNotificationRepo(tx).withdraw("00000000-0000-4000-8000-0000000000ff", USER, AT)), null);
  });

  test("the table rules: one target per (notice, company); priority, audience and email status are checked; a company or notice that is gone takes its targets with it", async () => {
    const co = await insertRow(owner, hotel.schema, "company_profiles", { name: "Rules Co" });
    const n = await staff((tx) => pgNotificationRepo(tx).create(fields({ audienceKind: "one" }), [{ companyId: String(co.id), emailStatus: "none" }], AT));
    const s = hotel.schema;
    assert.equal(await sqlStateOf(owner.query(`INSERT INTO "${s}".notification_targets (notification_id, company_id) VALUES ($1, $2)`, [n.id, co.id])), "23505");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".notifications SET priority = 'urgent' WHERE id = $1`, [n.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".notifications SET audience_kind = 'some' WHERE id = $1`, [n.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".notifications SET audience = 'guest' WHERE id = $1`, [n.id])), "23514", "companies only today");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".notification_targets SET email_status = 'sent' WHERE notification_id = $1`, [n.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".notifications SET title = repeat('x', 121) WHERE id = $1`, [n.id])), "22001");
    assert.equal(await sqlStateOf(owner.query(`INSERT INTO "${s}".notification_targets (notification_id, company_id) VALUES ($1, $2)`, [n.id, "00000000-0000-4000-8000-0000000000fe"])), "23503");
    await owner.query(`DELETE FROM "${s}".company_profiles WHERE id = $1`, [co.id]);
    assert.equal(await count(owner, `SELECT count(*) AS n FROM "${s}".notification_targets WHERE notification_id = $1`, [n.id]), 0);
    assert.equal(await count(owner, `SELECT count(*) AS n FROM "${s}".notifications WHERE id = $1`, [n.id]), 1, "the notice stays in the history");
  });

  test("an audience of 1,300 companies is written in chunks, one target each", async () => {
    await owner.query(`INSERT INTO "${hotel.schema}".company_profiles (name) SELECT 'Bulk Co ' || g FROM generate_series(1, 1300) g`);
    const all = await staff((tx) => pgNotificationRepo(tx).liveCompanyIds());
    const bulk = all.length;
    assert.ok(bulk >= 1300);
    const n = await staff((tx) => pgNotificationRepo(tx).create(fields({ audienceKind: "all", title: "Everyone" }), all.map((companyId) => ({ companyId, emailStatus: "none" as const })), AT));
    assert.equal(n.targetCount, bulk);
    assert.equal(await count(owner, `SELECT count(*) AS n FROM "${hotel.schema}".notification_targets WHERE notification_id = $1`, [n.id]), bulk);
  });

  test("liveCompanyIds leaves a deleted company out; emailsOf takes the company's and its contacts' addresses, lower case, once, minus opt-outs and bad ones", async () => {
    const live = await insertRow(owner, hotel.schema, "company_profiles", {
      name: "Mail Co", email: "Desk@Mail.example", contacts: JSON.stringify([{ role: "A", name: "Deepa", email: "deepa@mail.example", mobile: "" }, { role: "B", name: "Dup", email: "DESK@mail.example", mobile: "" }, { role: "C", name: "Stop", email: "stop@mail.example", mobile: "" }, { role: "D", name: "Bad", email: "nonsense", mobile: "" }, { role: "E", name: "Blank", email: "", mobile: "" }]),
    });
    const none = await insertRow(owner, hotel.schema, "company_profiles", { name: "No Mail Co", email: null, contacts: "[]" });
    const gone = await insertRow(owner, hotel.schema, "company_profiles", { name: "Gone Mail Co", email: "gone@mail.example", deleted_at: "2026-09-01T00:00:00Z" });
    await insertRow(owner, hotel.schema, "mail_optouts", { email: "Stop@Mail.example" });
    const repo = <T>(work: (r: ReturnType<typeof pgNotificationRepo>) => Promise<T>) => staff((tx) => work(pgNotificationRepo(tx)));
    assert.deepEqual(await repo((r) => r.liveCompanyIds([String(live.id), String(gone.id), String(none.id)])), [String(live.id), String(none.id)].sort());
    const emails = await repo((r) => r.emailsOf([String(live.id), String(none.id), String(gone.id)]));
    assert.deepEqual([...emails.keys()], [String(live.id)], "no usable address, or deleted: absent");
    assert.deepEqual(emails.get(String(live.id)), [{ email: "desk@mail.example", name: "Mail Co" }, { email: "deepa@mail.example", name: "Deepa" }]);
    assert.equal((await repo((r) => r.emailsOf([]))).size, 0);
  });
});

describe("the company side and the row-level security (0039)", () => {
  test("a company sees only its own targets and the notices that have one, whatever the query; a guest none; staff all; the scope ends with the transaction", async () => {
    const tcs = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "TCS RLS" })).id);
    const infy = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "Infosys RLS" })).id);
    const customer = String((await insertRow(owner, hotel.schema, "customers", { name: "Amit", mobile: "9825041236" })).id);
    const mk = (title: string, to: string[]) => staff((tx) => pgNotificationRepo(tx).create(fields({ title }), to.map((companyId) => ({ companyId, emailStatus: "none" as const })), AT));
    const nBoth = await mk("RLS both", [tcs, infy]);
    const nTcs = await mk("RLS only tcs", [tcs]);
    const nInfy = await mk("RLS only infy", [infy]);
    const mine = [nBoth.id, nTcs.id, nInfy.id];
    const q = "SELECT id FROM notifications WHERE id = ANY($1::uuid[])";

    assert.deepEqual(await staff((tx) => ids(tx, q, [mine])), [...mine].sort(), "staff see all three");
    await asCompany(tcs, async (tx) => {
      assert.deepEqual(await ids(tx, q, [mine]), [nBoth.id, nTcs.id].sort(), "TCS sees the two sent to it");
      assert.deepEqual(await ids(tx, "SELECT id FROM notifications WHERE id = $1", [nInfy.id]), [], "asking for another company's notice by id finds nothing");
      assert.equal(await count(tx, "SELECT count(*) AS n FROM notification_targets WHERE company_id <> $1", [tcs]), 0, "no other company's target row");
      assert.equal(await count(tx, "SELECT count(*) AS n FROM notification_targets WHERE notification_id = $1", [nBoth.id]), 1, "of a shared notice, only its own target (not the other company's read receipt)");
      // writes: another company's target is not touched; a notice cannot be made or withdrawn from the portal
      assert.equal((await tx.query("UPDATE notification_targets SET read_at = now() WHERE company_id = $1", [infy])).affectedRows, 0);
      assert.equal((await tx.query("UPDATE notifications SET withdrawn_at = now() WHERE id = $1", [nInfy.id])).affectedRows, 0);
      // not even its own notice: only the hotel withdraws
      assert.equal((await tx.query("UPDATE notifications SET withdrawn_at = now() WHERE id = $1", [nTcs.id])).affectedRows, 0);
      // marking its own target read is allowed
      assert.equal((await tx.query("UPDATE notification_targets SET read_at = now() WHERE company_id = $1 AND notification_id = $2", [tcs, nTcs.id])).affectedRows, 1);
    });
    // a refused statement aborts its transaction, so each one gets its own
    const refused = (sql: string, params: unknown[]) => asCompany(tcs, (tx) => sqlStateOf(tx.query(sql, params))).catch((e: { code?: string }) => e.code ?? "?");
    assert.equal(await refused("INSERT INTO notification_targets (notification_id, company_id) VALUES ($1, $2)", [nInfy.id, tcs]), "42501", "cannot give itself a notice");
    assert.equal(await refused("INSERT INTO notifications (audience_kind, title, body) VALUES ('one', 'Fake', 'Fake')", []), "42501", "cannot make a notice");
    assert.equal(await refused("UPDATE notification_targets SET company_id = $1 WHERE company_id = $2 AND notification_id = $3", [infy, tcs, nTcs.id]), "42501", "cannot hand its target to another company");
    assert.equal(await count(owner, `SELECT count(*) AS n FROM "${hotel.schema}".notifications WHERE id = ANY($1::uuid[]) AND withdrawn_at IS NOT NULL`, [mine]), 0, "nothing was withdrawn from the portal");
    await asCompany(infy, async (tx) => assert.deepEqual(await ids(tx, q, [mine]), [nBoth.id, nInfy.id].sort()));
    await asGuest(customer, async (tx) => {
      assert.deepEqual(await ids(tx, q, [mine]), []);
      assert.equal(await count(tx, "SELECT count(*) AS n FROM notification_targets"), 0);
    });
    // the scope ended with its transaction: the next staff transaction on a pooled connection sees everything again
    assert.deepEqual(await staff((tx) => ids(tx, q, [mine])), [...mine].sort());
    assert.equal(await staff((tx) => count(tx, "SELECT count(*) AS n FROM notification_targets WHERE notification_id = $1", [nBoth.id])), 2);
  });

  test("forCompany, unreadCount, markRead (first read time kept), markAllRead: withdrawn and expired hidden; another company's id finds nothing", async () => {
    const a = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "Reader A" })).id);
    const b = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "Reader B" })).id);
    const mk = (over: Record<string, unknown>, to: string[], at: string) =>
      staff((tx) => pgNotificationRepo(tx).create(fields(over), to.map((companyId) => ({ companyId, emailStatus: "none" as const })), new Date(at)));
    const live1 = await mk({ title: "Live one" }, [a, b], "2026-10-05T09:00:00+05:30");
    const live2 = await mk({ title: "Live two", priority: "important" }, [a], "2026-10-05T09:30:00+05:30");
    const out = await mk({ title: "Withdrawn one" }, [a], "2026-10-05T09:40:00+05:30");
    const old = await mk({ title: "Expired one", expiresAt: "2026-10-04" }, [a], "2026-10-05T09:50:00+05:30");
    const lastDay = await mk({ title: "Last day", expiresAt: TODAY }, [a], "2026-10-05T09:55:00+05:30");
    await staff((tx) => pgNotificationRepo(tx).withdraw(out.id, USER, AT));
    const readA = <T>(work: (r: ReturnType<typeof pgNotificationRepo>) => Promise<T>) => asCompany(a, (tx) => work(pgNotificationRepo(tx)));
    const readB = <T>(work: (r: ReturnType<typeof pgNotificationRepo>) => Promise<T>) => asCompany(b, (tx) => work(pgNotificationRepo(tx)));

    const first = await readA((r) => r.forCompany(a, { today: TODAY, page: 1, pageSize: 25 }));
    assert.deepEqual(first.rows.map((x) => x.title), ["Last day", "Live two", "Live one"], "newest first; withdrawn and expired hidden; the last day still shows");
    assert.equal(first.total, 3);
    assert.deepEqual([first.rows[1].priority, first.rows[1].readAt, first.rows[1].linkView], ["important", null, null]);
    assert.equal(await readA((r) => r.unreadCount(a, TODAY)), 3);
    assert.equal(await readA((r) => r.unreadCount(a, "2026-10-06")), 2, "tomorrow the last-day notice is gone");
    assert.deepEqual((await readA((r) => r.forCompany(a, { today: TODAY, page: 2, pageSize: 2 }))).rows.map((x) => x.title), ["Live one"]);

    assert.equal(await readA((r) => r.markRead(a, live1.id, new Date("2026-10-05T12:00:00Z"), TODAY)), true);
    assert.equal(await readA((r) => r.markRead(a, live1.id, new Date("2026-10-06T12:00:00Z"), TODAY)), true, "again: still true");
    const readAt = (await readA((r) => r.forCompany(a, { today: TODAY, page: 1, pageSize: 25 }))).rows.find((x) => x.id === live1.id)?.readAt;
    assert.equal(readAt?.toISOString(), "2026-10-05T12:00:00.000Z", "the first read time stays");
    assert.equal(await readA((r) => r.markRead(a, out.id, AT, TODAY)), false, "withdrawn");
    assert.equal(await readA((r) => r.markRead(a, old.id, AT, TODAY)), false, "expired");
    assert.equal(await readA((r) => r.markRead(a, nobody(), AT, TODAY)), false, "no such notice");
    assert.equal(await readB((r) => r.markRead(b, live2.id, AT, TODAY)), false, "B asking for A's notice");
    assert.equal(await readB((r) => r.markRead(a, live2.id, AT, TODAY)), false, "B naming A's company id: the policy hides A's rows");
    assert.equal(await readB((r) => r.unreadCount(a, TODAY)), 0);
    assert.equal(await readA((r) => r.unreadCount(a, TODAY)), 2);
    assert.equal(await readA((r) => r.markAllRead(a, AT, TODAY)), 2, "the two live unread ones");
    assert.equal(await readA((r) => r.markAllRead(a, AT, TODAY)), 0);
    assert.equal(await readA((r) => r.unreadCount(a, TODAY)), 0);
    assert.equal(await readB((r) => r.unreadCount(b, TODAY)), 1, "B untouched");
    assert.equal((await readA((r) => r.forCompany(a, { today: TODAY, unread: true, page: 1, pageSize: 25 }))).total, 0);
    // a withdrawn and an expired target stay unread in the table (nothing touched them)
    assert.equal(await count(owner, `SELECT count(*) AS n FROM "${hotel.schema}".notification_targets WHERE company_id = $1 AND read_at IS NULL`, [a]), 2);
    void lastDay;
  });
});

const nobody = (): string => "00000000-0000-4000-8000-0000000000aa";

describe("the real services over the PostgreSQL units", () => {
  test("send (with a link, an expiry and an audit line), the company's list and badge, read, read all, withdraw", async () => {
    const tcs = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "Service TCS", email: "desk@svc.example", contacts: "[]" })).id);
    const infy = String((await insertRow(owner, hotel.schema, "company_profiles", { name: "Service Infosys", email: null, contacts: "[]" })).id);
    const bill = String((await insertRow(owner, hotel.schema, "bill_master_bills", { company_id: tcs })).id);
    for (const [key, value] of [["email.host", "smtp.svc.test"], ["email.from_address", "desk@svc.test"]]) {
      const updated = await owner.query(`UPDATE "${hotel.schema}".app_settings SET value = $2 WHERE key = $1`, [key, value]);
      if (updated.affectedRows === 0) await insertRow(owner, hotel.schema, "app_settings", { key, value });
    }
    const mails: string[] = [];
    const service = createNotificationService({
      unit: createPgNotificationsUnit(database.withHotel),
      people: { get: async () => new Map() },
      catalog,
      now: () => AT,
      mail: { queue: async (m) => void mails.push(`${m.kind}:${m.toEmail}`) },
    });
    const creator = makeSession({ hotelId: hotel.id, userId: USER, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full")] });
    const meta = { ip: "127.0.0.1", traceId: "trace-notifications-1" } as never;
    const sent = await service.send(creator, { companyIds: [tcs, infy], title: "Svc ledger notice", body: "Open Accounts > Ledger.", priority: "normal", expiresAt: "2026-10-31", alsoEmail: true, linkView: null, linkId: null }, meta);
    assert.deepEqual([sent.targetCount, sent.audienceKind, sent.expiresAt, sent.emailQueued, sent.emailSkipped], [2, "selected", "2026-10-31", 1, 1]);
    assert.deepEqual(mails, ["notification:desk@svc.example"]);
    const withBill = await service.send(creator, { companyIds: [tcs], title: "About your bill", body: "Please check.", priority: "important", expiresAt: null, alsoEmail: false, linkView: "corporate.bill", linkId: bill }, meta);
    assert.equal(withBill.linkId, bill);
    await assert.rejects(service.send(creator, { companyIds: [infy], title: "Wrong bill", body: "x", priority: "normal", expiresAt: null, alsoEmail: false, linkView: "corporate.bill", linkId: bill }, meta), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
    const logs = await owner.query(`SELECT summary FROM "${hotel.schema}".system_logs WHERE entity = 'Notification' AND subject_id = $1`, [sent.id]);
    assert.deepEqual(logs.rows.map((r) => r.summary), ["Added Notification: Svc ledger notice"]);
    const history = await service.list(creator, { page: 1, pageSize: 25, search: "svc ledger" } as never);
    assert.deepEqual(history.items.map((i) => i.id), [sent.id]);

    const portal = createPortalNotifications({ unit: createPgPortalUnit(database.withHotel), now: () => AT });
    const company = makeSession({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-0000000000c1", accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, scope: { kind: "company", id: tcs } });
    const page = await portal.notifications(company, { page: 1, pageSize: 25 } as never);
    assert.deepEqual(page.items.map((i) => i.title), ["About your bill", "Svc ledger notice"], "same minute: the later id first");
    assert.deepEqual([page.total, page.unread], [2, 2]);
    assert.ok(page.items.every((i) => i.hotelId === hotel.id));
    assert.deepEqual(await portal.unreadNotifications(company, {}), { count: 2, unavailable: [] });
    assert.deepEqual(await portal.readNotification(company, {}, sent.id), { id: sent.id, read: true });
    await assert.rejects(portal.readNotification(company, {}, nobody()), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
    assert.deepEqual(await portal.readAllNotifications(company, {}), { marked: 1, unavailable: [] });
    assert.deepEqual(await portal.unreadNotifications(company, {}), { count: 0, unavailable: [] });
    const seen = await service.get(creator, sent.id);
    assert.equal(seen.readCount, 1);
    assert.equal(seen.targets.find((t) => t.companyId === tcs)?.emailStatus, "queued");

    const infyAccount = makeSession({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-0000000000c2", accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, scope: { kind: "company", id: infy } });
    assert.equal((await portal.notifications(infyAccount, { page: 1, pageSize: 25 } as never)).total, 1, "Infosys got only the first");
    await assert.rejects(portal.readNotification(infyAccount, {}, withBill.id), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");

    await service.withdraw(creator, sent.id, meta);
    assert.equal((await portal.notifications(infyAccount, { page: 1, pageSize: 25 } as never)).total, 0);
    assert.equal((await portal.notifications(company, { page: 1, pageSize: 25 } as never)).total, 1);
  });
});

