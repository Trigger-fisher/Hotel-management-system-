// Conversations on the REAL PostgreSQL (decision 66; platform migration 0139, hotel migration 0050, seed 0003): the permission row and the default grants exist on a freshly seeded database; a hotel never reads another's conversations; the uniques and CHECKs hold; the
// PostgreSQL repository keeps the in-memory one's rules (ingest twice adds nothing, unread counts only rows added, the newest message decides last_*, a reused Message-ID
// is kept apart, our own Sent copy binds to our reply); the tabs; the purge; the matcher's indexed expressions; one lease between two units at once; the platform registry
// (dueSync order, duePurge includes hotels reading nothing and hotels without a row).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { hotelRoleFor, type CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { PERMISSION_CATALOG } from "../../src/server/auth/catalog.generated";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { newId } from "../../src/server/db/ids";
import { pgConversationsRepo, pgHotelLinkMatcher } from "../../src/server/repos/postgres/conversations";
import { pgPlatformConversations } from "../../src/server/repos/postgres/platformConversations";
import { createPlatformUnit } from "../../src/server/repos/postgres/platformUnit";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let A: CreatedHotel;
let B: CreatedHotel;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  A = await createTestHotel(owner, "Conversations Alpha");
  B = await createTestHotel(owner, "Conversations Beta");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
});
after(async () => {
  await database?.close();
  await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.query("DELETE FROM platform.conv_channel_accounts WHERE hotel_id IS NOT NULL").catch(() => undefined);
  await owner?.end();
  await release?.();
});

const hub = <T>(hotel: CreatedHotel, work: (repo: ReturnType<typeof pgConversationsRepo>, tx: Parameters<Parameters<Database["withHotel"]>[1]>[0]) => Promise<T>): Promise<T> =>
  database.withHotel({ hotelId: hotel.id }, (tx) => work(pgConversationsRepo(tx, { schema: "" }), tx));
const platform = () => createPlatformUnit(database.pool, pgPlatformConversations);
const NOBODY = { byEmail: async () => null, byPhone: async () => null, search: async () => [], details: async () => null, exists: async () => null };
const T0 = new Date("2026-10-24T08:00:00Z");
const at = (min: number): Date => new Date(T0.getTime() + min * 60_000);
let n = 0;
const email = (o: Partial<InboundEntry> & { person: string }): InboundEntry => {
  n += 1;
  const out = o.direction === "out";
  return {
    channel: "email", direction: "in", externalId: `<db${n}.${Date.now()}@x.in>`, fallbackId: `uid:inbox:1:${n}`, sentAt: at(n), personName: null, from: out ? "desk@gmail.com" : o.person, replyTo: null, to: out ? [o.person] : ["desk@gmail.com"], cc: [], subject: `Subject ${n}`,
    preview: `preview ${n}`, hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: out ? "mailbox" : "contact", status: out ? "sent" : "received",
    mail: { folder: out ? "sent" : "inbox", uid: n, uidValidity: 1, mailbox: "desk@gmail.com" }, ...o,
  };
};

describe("migrations, the seed and the permission", () => {
  test("0139, 0050 and seed 0003 are recorded", async () => {
    assert.equal((await owner.query("SELECT 1 FROM platform.schema_migrations WHERE version = '0139_conversations'")).rows.length, 1);
    assert.equal((await owner.query("SELECT 1 FROM platform.schema_seeds WHERE version = '0003_hms_permissions'")).rows.length, 1);
    assert.equal((await owner.query(`SELECT 1 FROM "${A.schema}".schema_migrations WHERE version = '0050_conversations'`)).rows.length, 1);
  });

  test("the conversations permission exists with View and Edit offered, the built-in Admin, SuperAdmin and (platform 0165) Editor have Edit, Viewer has View; every catalog key is a permission", async () => {
    const perm = (await owner.query("SELECT kind, label, group_name FROM platform.permissions WHERE key = 'conversations'")).rows[0];
    assert.deepEqual([perm?.kind, perm?.label, perm?.group_name], ["module", "Conversations", "Front Office"]);
    const grants = await owner.query("SELECT r.key, rp.level FROM platform.role_permissions rp JOIN platform.roles r ON r.id = rp.role_id JOIN platform.permissions p ON p.id = rp.permission_id WHERE p.key = 'conversations' AND r.hotel_id IS NULL ORDER BY r.key");
    assert.deepEqual(grants.rows.map((r) => [String(r.key), String(r.level)]), [["admin", "edit"], ["editor", "edit"], ["super_admin", "edit"], ["viewer", "view"]]);
    const keys = new Set((await owner.query("SELECT key FROM platform.permissions")).rows.map((r) => String(r.key)));
    assert.deepEqual(PERMISSION_CATALOG.filter((e) => !keys.has(e.key)).map((e) => e.key), []);
  });

  test("the platform's own mailbox and number start 'off'", async () => {
    const rows = (await owner.query("SELECT channel, status FROM platform.conv_channel_accounts WHERE hotel_id IS NULL ORDER BY channel")).rows;
    assert.deepEqual(rows.map((r) => [r.channel, r.status]), [["email", "off"], ["whatsapp", "off"]]);
  });
});

describe("the hotel tables", () => {
  test("hotel B never reads hotel A's conversations (not by its own name, not by A's schema); the hotel role may DELETE them (the purge)", async () => {
    await hub(A, (repo) => repo.ingest([email({ person: "secret-guest@guest.in" })], { mailbox: "desk@gmail.com" }, NOBODY, T0));
    assert.equal(await hub(B, async (_r, tx) => (await tx.query("SELECT count(*)::int AS n FROM conv_messages")).rows[0].n), 0);
    assert.equal(await sqlStateOf(hub(B, (_r, tx) => tx.query(`SELECT * FROM "${A.schema}".conv_messages`))), "42501");
    const del = await owner.query(`SELECT has_table_privilege($1, '"${A.schema}".conv_messages', 'DELETE') AS d`, [hotelRoleFor(A.id)]);
    assert.equal(del.rows[0].d, true);
  });

  test("uniques and CHECKs: one handle per kind and value, one message per channel and id, a quick reply title once in any case, the shapes of addresses, numbers and WhatsApp rows", async () => {
    await hub(A, async (_r, tx) => {
      const contact = await insertRow(tx, A.schema, "conv_contacts");
      await tx.query("INSERT INTO conv_contact_handles (contact_id, kind, value) VALUES ($1, 'email', 'dup@guest.in')", [contact.id]);
    });
    assert.equal(await sqlStateOf(hub(A, async (_r, tx) => tx.query("INSERT INTO conv_contact_handles (contact_id, kind, value) SELECT id, 'email', 'dup@guest.in' FROM conv_contacts LIMIT 1"))), "23505");
    assert.equal(await sqlStateOf(hub(A, async (_r, tx) => tx.query("INSERT INTO conv_contact_handles (contact_id, kind, value) SELECT id, 'email', 'Upper@Guest.in' FROM conv_contacts LIMIT 1"))), "23514");
    assert.equal(await sqlStateOf(hub(A, async (_r, tx) => tx.query("INSERT INTO conv_contact_handles (contact_id, kind, value) SELECT id, 'phone', '+91 98250' FROM conv_contacts LIMIT 1"))), "23514");
    await hub(A, (_r, tx) => tx.query("INSERT INTO conv_quick_replies (title, body) VALUES ('Directions', 'Near the station')"));
    assert.equal(await sqlStateOf(hub(A, (_r, tx) => tx.query("INSERT INTO conv_quick_replies (title, body) VALUES ('DIRECTIONS', 'x')"))), "23505");
    const conv = await hub(A, async (_r, tx) => insertRow(tx, A.schema, "conv_conversations"));
    assert.equal(await sqlStateOf(hub(A, (_r, tx) => tx.query("INSERT INTO conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from) VALUES ($1, 'whatsapp', 'in', 'received', 'wamid.1', now(), 'contact')", [conv.id]))), "23514", "a WhatsApp row needs its type");
    assert.equal(await sqlStateOf(hub(A, (_r, tx) => tx.query("INSERT INTO conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from, wa_type) VALUES ($1, 'email', 'in', 'received', '<x@y>', now(), 'contact', 'text')", [conv.id]))), "23514", "an email row has no WhatsApp type");
    await hub(A, (_r, tx) => tx.query("INSERT INTO conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from) VALUES ($1, 'email', 'in', 'received', '<u1@y>', now(), 'contact')", [conv.id]));
    assert.equal(await sqlStateOf(hub(A, (_r, tx) => tx.query("INSERT INTO conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from) VALUES ($1, 'email', 'in', 'received', '<u1@y>', now(), 'contact')", [conv.id]))), "23505");
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.conv_channel_accounts SET imap_port = 25 WHERE hotel_id IS NULL AND channel = 'email'")), "23514");
  });
});

describe("the PostgreSQL repository keeps the hub's rules", () => {
  test("ingest twice adds nothing and counts nothing; the newest message decides last_*; a guest's message reopens a done thread", async () => {
    const batch = [email({ person: "asha@guest.in", sentAt: at(30) }), email({ person: "asha@guest.in", sentAt: at(31) })];
    assert.equal((await hub(B, (repo) => repo.ingest(batch, { mailbox: "desk@gmail.com" }, NOBODY, T0))).added, 2);
    assert.equal((await hub(B, (repo) => repo.ingest(batch, { mailbox: "desk@gmail.com" }, NOBODY, T0))).added, 0);
    const c = (await hub(B, (repo) => repo.list({ tab: "all", channel: "all", me: newId(), page: 1, pageSize: 25 }))).rows.find((r) => r.contact.handles[0].value === "asha@guest.in")!;
    assert.equal(c.unreadCount, 2);
    await hub(B, (repo) => repo.ingest([email({ person: "asha@guest.in", direction: "out", sentAt: at(5) })], { mailbox: "desk@gmail.com" }, NOBODY, T0));
    const after1 = (await hub(B, (repo) => repo.get(c.id)))!;
    assert.deepEqual([after1.lastMessageAt.toISOString(), after1.lastDirection, after1.unreadCount], [at(31).toISOString(), "in", 2]);
    await hub(B, (repo) => repo.setStatus(c.id, "done"));
    await hub(B, (repo) => repo.ingest([email({ person: "asha@guest.in", sentAt: at(40) })], { mailbox: "desk@gmail.com" }, NOBODY, T0));
    assert.deepEqual([(await hub(B, (repo) => repo.get(c.id)))!.status, (await hub(B, (repo) => repo.get(c.id)))!.lastInboundAt?.toISOString()], ["open", at(40).toISOString()]);
  });

  test("our own Sent copy binds to our reply; a different sender reusing the id in the same check is kept apart under its own uid id", async () => {
    const c = (await hub(B, (repo) => repo.list({ tab: "all", channel: "all", me: newId(), page: 1, pageSize: 25 }))).rows[0];
    const id = `<hms.${Date.now()}@gmail.com>`;
    await hub(B, (repo) => repo.recordOutgoing(c.id, { channel: "email", externalId: id, sentAt: at(50), sentBy: newId(), status: "sent", preview: "Hello", mailBox: "desk@gmail.com", subject: "Re: x", fromAddr: "desk@gmail.com", toAddrs: ["asha@guest.in"], ccAddrs: [], inReplyTo: null, referenceIds: [], hasAttachments: false, hasBill: false }));
    const ours = email({ person: "asha@guest.in", direction: "out", externalId: id, sentAt: at(50), sentFrom: "hms", hmsConversation: c.id, mail: { folder: "sent", uid: 77, uidValidity: 9, mailbox: "desk@gmail.com" } });
    const theirs = email({ person: "evil@attacker.example", externalId: id, sentAt: at(51), fallbackId: "uid:inbox:9:78", mail: { folder: "inbox", uid: 78, uidValidity: 9, mailbox: "desk@gmail.com" } });
    assert.equal((await hub(B, (repo) => repo.ingest([theirs, ours], { mailbox: "desk@gmail.com" }, NOBODY, T0))).added, 1);
    const rows = (await hub(B, async (_r, tx) => (await tx.query("SELECT external_id, direction, sent_from, mail_uid, mail_folder FROM conv_messages WHERE external_id IN ($1, 'uid:inbox:9:78') ORDER BY external_id", [id])).rows));
    assert.deepEqual(rows.map((r) => [r.external_id, r.direction, r.sent_from, Number(r.mail_uid), r.mail_folder]), [[id, "out", "hms", 77, "sent"], ["uid:inbox:9:78", "in", "contact", 78, "inbox"]]);
  });

  test("the tabs and their counts agree with the list; channel filter and search", async () => {
    const me = newId();
    const counts = await hub(B, (repo) => repo.counts({ channel: "all", me }));
    for (const tab of ["all", "unread", "mine", "unassigned", "waiting", "done", "other"] as const) assert.equal((await hub(B, (repo) => repo.list({ tab, channel: "all", me, page: 1, pageSize: 100 }))).total, counts[tab], tab);
    assert.equal((await hub(B, (repo) => repo.list({ tab: "all", channel: "whatsapp", me, page: 1, pageSize: 25 }))).total, 0);
    assert.ok((await hub(B, (repo) => repo.list({ tab: "all", channel: "all", me, words: ["asha"], page: 1, pageSize: 25 }))).total >= 1);
  });

  test("the purge removes messages older than the cut, then the empty conversations and contacts", async () => {
    await hub(A, (repo) => repo.ingest([email({ person: "old@guest.in", sentAt: new Date("2025-01-01T00:00:00Z") })], { mailbox: "desk@gmail.com" }, NOBODY, T0));
    const gone = await hub(A, (repo) => repo.purge(new Date("2025-10-24T00:00:00Z")));
    assert.ok(gone >= 1);
    assert.equal(await hub(A, async (_r, tx) => (await tx.query("SELECT count(*)::int AS n FROM conv_contact_handles WHERE value = 'old@guest.in'")).rows[0].n), 0);
  });

  test("the matcher finds a guest record by address (any case) and by the last 10 digits of a number", async () => {
    await hub(A, (_r, tx) => insertRow(tx, A.schema, "customers", { name: "Mehul Patel", mobile: "+91 98111-22233", email: " Mehul@Guest.in " }));
    const byEmail = await hub(A, (_r, tx) => pgHotelLinkMatcher(tx).byEmail("mehul@guest.in"));
    const byPhone = await hub(A, (_r, tx) => pgHotelLinkMatcher(tx).byPhone("919811122233"));
    assert.deepEqual([byEmail?.kind, byEmail?.label, byPhone?.kind], ["customer", "Mehul Patel", "customer"]);
  });

  test("deleting a linked guest record still works: the link is cleared (ON DELETE SET NULL) and the contact reads as not linked; a link without its source is refused", async () => {
    const customer = await hub(A, (_r, tx) => insertRow(tx, A.schema, "customers", { name: "Gone Guest", mobile: "9800011122", email: "gone@guest.in" }));
    const contact = await hub(A, (_r, tx) => insertRow(tx, A.schema, "conv_contacts", { customer_id: customer.id, link_source: "manual", linked_at: T0 }));
    await hub(A, (_r, tx) => tx.query("DELETE FROM customers WHERE id = $1", [customer.id]));
    const row = await hub(A, async (_r, tx) => (await tx.query("SELECT customer_id FROM conv_contacts WHERE id = $1", [contact.id])).rows[0]);
    assert.equal(row.customer_id, null);
    const other = await hub(A, (_r, tx) => insertRow(tx, A.schema, "customers", { name: "Kept Guest", mobile: "9800011133", email: "kept@guest.in" }));
    assert.equal(await sqlStateOf(hub(A, (_r, tx) => tx.query("UPDATE conv_contacts SET customer_id = $2, link_source = NULL WHERE id = $1", [contact.id, other.id]))), "23514");
  });

  test("two checks at once: exactly one takes the lease", async () => {
    const got = await Promise.all([hub(A, (repo) => repo.acquireLease("desk@gmail.com", T0, 60_000)), hub(A, (repo) => repo.acquireLease("desk@gmail.com", T0, 60_000))]);
    assert.deepEqual(got.sort(), [false, true]);
    await hub(A, (repo) => repo.releaseLease());
  });
});

describe("the platform registry", () => {
  test("a hotel's reading switch keeps its row when off; dueSync lists the never-checked first; duePurge includes hotels reading nothing and hotels without a row", async () => {
    const provisioned = (await owner.query("SELECT id FROM platform.hotels WHERE id IN ($1, $2) AND provisioned_at IS NOT NULL", [A.id, B.id])).rows.map((r) => String(r.id));
    await platform().run((r) => r.accounts.setHotelReading(A.id, true));
    await platform().run((r) => r.accounts.setHotelReading(A.id, false));
    assert.equal((await owner.query("SELECT status FROM platform.conv_channel_accounts WHERE hotel_id = $1", [A.id])).rows[0].status, "off");
    await platform().run((r) => r.accounts.setHotelReading(A.id, true));
    await platform().run((r) => r.accounts.setHotelReading(B.id, true));
    await platform().run((r) => r.accounts.report(B.id, { at: new Date("2026-10-23T00:00:00Z"), ok: true, error: null }));
    const due = await platform().run((r) => r.accounts.dueSync(new Date("2026-10-24T10:00:00Z"), 10));
    assert.deepEqual(due.filter((h) => provisioned.includes(h)), [A.id, B.id].filter((h) => provisioned.includes(h)), "never checked first");
    await platform().run((r) => r.accounts.setHotelReading(B.id, false));
    await owner.query("DELETE FROM platform.conv_channel_accounts WHERE hotel_id = $1", [A.id]);
    const purge = await platform().run((r) => r.accounts.duePurge(new Date("2026-10-24T00:00:00Z"), 50));
    for (const h of provisioned) assert.ok(purge.includes(h), "every provisioned hotel, with a row or without");
    for (const h of provisioned) await platform().run((r) => r.accounts.markPurged(h, new Date("2026-10-24T10:00:00Z")));
    const after2 = await platform().run((r) => r.accounts.duePurge(new Date("2026-10-24T00:00:00Z"), 50));
    for (const h of provisioned) assert.ok(!after2.includes(h), "purged today");
    assert.equal((await owner.query("SELECT status FROM platform.conv_channel_accounts WHERE hotel_id = $1", [A.id])).rows[0]?.status, provisioned.includes(A.id) ? "off" : undefined);
  });

  test("the platform hub uses the same repository on the platform tables", async () => {
    const r = await platform().run((repos) => repos.conversations.ingest([email({ person: "owner@sunrise.in" })], { mailbox: "hello@easyhotel.example" }, repos.matcher, T0));
    assert.equal(r.added, 1);
    assert.ok(Number((await owner.query("SELECT count(*)::int AS n FROM platform.conv_messages")).rows[0].n) >= 1);
    await owner.query("DELETE FROM platform.conv_contacts");
  });

  test("platform 0171: a desk's mail through Amazon SES (no mailbox) keeps its whole email with its message; a repeat keeps the first; it goes with its message", async () => {
    const e = email({ person: "lead@kochiinn.com" });
    await platform().run((repos) => repos.conversations.ingest([e], { mailbox: null }, repos.matcher, T0));
    const m = await platform().run((repos) => repos.conversations.messageByExternal("email", e.externalId));
    assert.ok(m);
    await platform().run((repos) => repos.conversations.saveMailSource(m.id, Buffer.from("first copy")));
    await platform().run((repos) => repos.conversations.saveMailSource(m.id, Buffer.from("second copy")));
    assert.equal((await platform().run((repos) => repos.conversations.mailSource(m.id)))?.toString(), "first copy");
    await owner.query("DELETE FROM platform.conv_contacts");
    assert.equal(Number((await owner.query("SELECT count(*)::int AS n FROM platform.conv_mail_sources")).rows[0].n), 0);
  });
});
