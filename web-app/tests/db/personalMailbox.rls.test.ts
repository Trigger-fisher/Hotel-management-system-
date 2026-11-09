// A personal mailbox (platform migrations 0178 and 0179) on the REAL PostgreSQL, as hms_app: two staff logins (a Super Admin and a Platform Admin) each keep their own mailbox rows and see nothing of
// the other's. Proved by running queries with the other login's id, an unset and an empty setting, an INSERT for someone else and an UPDATE that moves a row to someone else; not by reading the
// policies. Also: the address table is unique per login and per address, and the migration's guard refuses to drop the old account table when it holds a row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { newId } from "../../src/server/db/ids";
import type { PersonalMailboxRepos } from "../../src/server/repos/personalMailbox";
import { createPgPersonalUnit } from "../../src/server/repos/postgres/personalMailbox";
import type { Unit } from "../../src/server/repos/types";
import { connectPg } from "../../../common/db/scripts/pg-db";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, superUrl, tag } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
/** The database superuser: the only login that sees every row (FORCE ROW LEVEL SECURITY fences the table owner too). Used to look, never to write. */
let sup: DbClient;
let app: DbClient;
let database: Database;
let unit: Unit<PersonalMailboxRepos>;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const TABLES = ["pmail_addresses","pmail_conv_contacts", "pmail_conv_contact_handles", "pmail_conv_conversations", "pmail_conv_messages", "pmail_conv_mail_sources", "pmail_conv_notes", "pmail_conv_quick_replies", "pmail_conv_mail_positions", "pmail_conv_logs"];
let SA: string;
let PA: string;

const roleId = async (): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL")).rows[0].id);
async function makeUser(accountRole: string): Promise<string> {
  const id = newId();
  const row = { id, username: `m${tag()}${tag()}`, display_name: "Mailbox Person", password_hash: HASH, role_id: await roleId(), account_role: accountRole, code_required: true };
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify(row)]);
  return id;
}
const session = (id: string) => ({ hotelId: id, userId: id, visit: undefined, scope: undefined }) as unknown as Parameters<Unit<PersonalMailboxRepos>["run"]>[0];

/** One transaction of the app login with `setting` as hms.pmail_login_id (undefined = never set); always rolled back unless `commit`. */
async function asApp<T>(setting: string | undefined, work: () => Promise<T>, commit = false): Promise<T> {
  await app.query("BEGIN");
  try {
    if (setting !== undefined) await app.query("SELECT set_config('hms.pmail_login_id', $1, true)", [setting]);
    const out = await work();
    await app.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
}
const count = (setting: string | undefined, table: string): Promise<number> => asApp(setting, async () => Number((await app.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n));
const stateOf = (setting: string | undefined, sql: string, args: unknown[] = []): Promise<string | null> => asApp(setting, async () => (await sqlStateOf(app.query(sql, args))) ?? "accepted").catch((e: { code?: string }) => String(e.code ?? "?"));

let n = 0;
const email = (person: string, own: string): InboundEntry => {
  n += 1;
  return {
    channel: "email", direction: "in", externalId: `<pm${n}.${Date.now()}@x.in>`, fallbackId: `uid:inbox:1:${n}`, sentAt: new Date(Date.UTC(2026, 10, 3, 8, n)), person, personName: null, from: person, replyTo: null, to: [own], cc: [], subject: `Subject ${n}`,
    preview: `preview ${n}`, hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received", mail: { folder: "inbox", uid: n, uidValidity: 1, mailbox: own },
  };
};
const at = new Date("2026-11-03T08:00:00Z");

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  sup = await connectPg(superUrl());
  app = await connectApp();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  unit = createPgPersonalUnit(database.pool);
  SA = await makeUser("super_admin");
  PA = await makeUser("platform_admin");
  for (const [id, address, people] of [[SA, "sa@gmail.com", ["a1@x.in", "a2@x.in"]], [PA, "pa@gmail.com", ["b1@x.in"]]] as const) {
    await unit.run(session(id), async (repos) => {
      assert.equal(await repos.address.save(`${address.split("@")[0]}-${tag()}@mail.example.in`), true);
      await repos.conversations.ingest(people.map((p) => email(p, address)), { mailbox: address }, repos.matcher, at);
      const entry = email(`kept-${people[0]}`, address);
      await repos.conversations.ingest([entry], { mailbox: address }, repos.matcher, at);
      const kept = await repos.conversations.messageByExternal("email", entry.externalId);
      assert.ok(kept);
      await repos.conversations.saveMailSource(kept.id, Buffer.from("From: a@x.in\r\n\r\nbody"));
      await repos.conversations.addNote(kept.conversationId, id, "a note", at);
      await repos.conversations.addQuickReply({ title: "Thanks", body: "Thank you", channel: "any", sortOrder: 0 }, id);
      assert.equal(await repos.conversations.acquireLease(address, at, 60_000), true);
      await repos.conversations.savePositions(address, [{ folder: "inbox", uidValidity: 1, lastUid: 5 }], { checkedAt: at, ok: true, error: null });
      await repos.systemLogs.write({ module: "conversations", action: "updated", entity: "Conversation", subjectId: null, subjectLabel: null, summary: "Mailbox connected", details: null, userId: id, userName: "x", ipAddress: null, traceId: null });
    });
  }
});
after(async () => {
  for (const id of [SA, PA]) if (id) await owner?.query("DELETE FROM platform.logins WHERE id = $1", [id]).catch(() => undefined);
  await database?.close();
  await app?.end();
  await sup?.end();
  await owner?.end();
  await release?.();
});

describe("every pmail_ table is fenced by the database", () => {
  test("row level security is enabled AND forced on every pmail_ table, and a table added later without it fails here", async () => {
    const rows = (await sup.query("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'platform' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'pmail\\_%'")).rows;
    assert.deepEqual(rows.map((r) => r.relname as string).sort(), [...TABLES].sort(), "every pmail_ table is in this test's list");
    for (const r of rows) assert.deepEqual([r.relname, r.relrowsecurity, r.relforcerowsecurity], [r.relname, true, true]);
    for (const t of TABLES) assert.equal((await owner.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = $1 AND column_name = 'login_id' AND is_nullable = 'NO'", [t])).rows.length, 1, `${t}.login_id`);
  });

  test("each login sees exactly its own rows in every table", async () => {
    for (const t of TABLES) {
      const a = await count(SA, t);
      const b = await count(PA, t);
      assert.ok(a >= 1 && b >= 1, `${t}: both have rows (${a}, ${b})`);
      const total = Number((await sup.query(`SELECT count(*)::int AS n FROM platform.${t} WHERE login_id = ANY($1::uuid[])`, [[SA, PA]])).rows[0].n);
      assert.equal(a + b, total, `${t}: nothing is seen twice or lost`);
    }
    assert.deepEqual([await count(SA, "pmail_conv_conversations"), await count(PA, "pmail_conv_conversations")], [3, 2]);
    assert.deepEqual([await count(SA, "pmail_addresses"), await count(PA, "pmail_addresses")], [1, 1]);
  });

  test("the same query as the OTHER login, or with the other's row id, returns nothing", async () => {
    const aMessage = String((await sup.query("SELECT id FROM platform.pmail_conv_messages WHERE login_id = $1 LIMIT 1", [SA])).rows[0].id);
    const aAddress = String((await sup.query("SELECT id FROM platform.pmail_addresses WHERE login_id = $1", [SA])).rows[0].id);
    assert.equal(await asApp(PA, async () => (await app.query("SELECT id FROM platform.pmail_conv_messages WHERE id = $1", [aMessage])).rows.length), 0);
    assert.equal(await asApp(PA, async () => (await app.query("SELECT id FROM platform.pmail_addresses WHERE id = $1", [aAddress])).rows.length), 0);
    assert.equal(await asApp(SA, async () => (await app.query("SELECT id FROM platform.pmail_conv_messages WHERE id = $1", [aMessage])).rows.length), 1);
    assert.equal(await asApp(PA, async () => (await app.query("SELECT id FROM platform.pmail_conv_messages WHERE login_id = $1", [SA])).rows.length), 0, "asking for the other's login_id by name shows nothing");
  });

  test("an unset, an empty and a half-written setting show NO rows; a malformed one is an error, never rows", async () => {
    for (const t of TABLES) {
      assert.equal(await count(undefined, t), 0, `${t} unset`);
      assert.equal(await count("", t), 0, `${t} empty`);
      assert.equal(await count(newId(), t), 0, `${t} an unknown login`);
    }
    assert.notEqual(await stateOf("not-a-uuid", "SELECT count(*) FROM platform.pmail_conv_messages"), "accepted");
  });

  test("an INSERT for another login, or with no login set, is refused", async () => {
    const sql = "INSERT INTO platform.pmail_conv_quick_replies (login_id, title, body) VALUES ($1, 'x', 'y')";
    assert.equal(await stateOf(PA, sql, [SA]), "42501", "A's id while B is set");
    assert.equal(await stateOf(undefined, sql, [SA]), "42501", "no setting");
    assert.equal(await stateOf(PA, "INSERT INTO platform.pmail_conv_quick_replies (title, body) VALUES ('x2', 'y')"), "accepted", "its own, the id filled by the database");
    assert.notEqual(await stateOf(undefined, "INSERT INTO platform.pmail_conv_quick_replies (title, body) VALUES ('x3', 'y')"), "accepted", "no login to fill in: refused");
  });

  test("an UPDATE that moves a row to another login is refused, and so is changing it to its own id's twin", async () => {
    assert.equal(await stateOf(SA, "UPDATE platform.pmail_conv_quick_replies SET login_id = $1", [PA]), "42501");
    assert.equal(await stateOf(SA, "UPDATE platform.pmail_addresses SET login_id = $1", [PA]), "42501");
    // an update of the other's row finds no row to change
    const changed = await asApp(PA, async () => (await app.query("UPDATE platform.pmail_conv_conversations SET starred = true WHERE login_id = $1", [SA])).affectedRows);
    assert.equal(changed, 0);
    const deleted = await asApp(PA, async () => (await app.query("DELETE FROM platform.pmail_conv_messages WHERE login_id = $1", [SA])).affectedRows);
    assert.equal(deleted, 0);
  });

  test("pmail_addresses: one row per login and one login per address; an INSERT for another login is refused; a malformed or upper-case address is refused; nothing secret is stored", async () => {
    const cols = (await owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'pmail_addresses' ORDER BY column_name")).rows.map((r) => String(r.column_name));
    assert.deepEqual(cols, ["address", "created_at", "id", "login_id", "updated_at"], "no password, no secret, no host");
    const mine = String((await sup.query("SELECT address FROM platform.pmail_addresses WHERE login_id = $1", [SA])).rows[0].address);
    // a second row for the same login
    assert.equal(await stateOf(SA, "INSERT INTO platform.pmail_addresses (address) VALUES ($1)", [`second-${tag()}@mail.example.in`]), "23505", "unique per login");
    // the same address for the other login
    assert.equal(await stateOf(PA, "INSERT INTO platform.pmail_addresses (address) VALUES ($1) ON CONFLICT (login_id) DO UPDATE SET address = EXCLUDED.address", [mine]), "23505", "unique per address");
    // an INSERT carrying another login's id, or with none set
    assert.equal(await stateOf(PA, "INSERT INTO platform.pmail_addresses (login_id, address) VALUES ($1, $2)", [SA, `x-${tag()}@mail.example.in`]), "42501");
    assert.notEqual(await stateOf(undefined, "INSERT INTO platform.pmail_addresses (address) VALUES ($1)", [`y-${tag()}@mail.example.in`]), "accepted", "no login set: nothing is written (the id cannot be filled in)");
    for (const bad of ["Upper@mail.example.in", "no-at-sign", "a b@mail.example.in", "x@@mail.example.in"]) assert.equal(await stateOf(PA, "UPDATE platform.pmail_addresses SET address = $1", [bad]), "23514", bad);
  });

  test("the repository records the address once, moves it when the username changes, and says false when another login holds it", async () => {
    const first = `repo-${tag()}@mail.example.in`;
    const moved = `moved-${tag()}@mail.example.in`;
    assert.equal(await unit.run(session(PA), (r) => r.address.save(first)), true);
    assert.equal(await unit.run(session(PA), (r) => r.address.get()), first);
    assert.equal(await unit.run(session(PA), (r) => r.address.save(moved)), true);
    assert.equal(await unit.run(session(PA), (r) => r.address.get()), moved, "one row, moved");
    assert.equal(Number((await sup.query("SELECT count(*)::int AS n FROM platform.pmail_addresses WHERE login_id = $1", [PA])).rows[0].n), 1);
    const sas = String((await sup.query("SELECT address FROM platform.pmail_addresses WHERE login_id = $1", [SA])).rows[0].address);
    assert.equal(await unit.run(session(PA), (r) => r.address.save(sas)), false, "the other's address is refused, the unit's transaction survives");
    assert.equal(await unit.run(session(PA), (r) => r.address.get()), moved, "and nothing changed");
    assert.equal(await unit.run(session(SA), (r) => r.address.get()), sas, "the other login is untouched");
  });
});

describe("the migration guard", () => {
  test("0179 refuses to drop the old account table when it holds a row, and drops it when it is empty (checked on a stand-in table, rolled back)", async () => {
    const file = readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "migrations", "platform", "0179_personal_mailbox_ses.sql"), "utf8");
    const guard = /DO \$guard\$[\s\S]*?\$guard\$;/.exec(file)?.[0];
    assert.ok(guard, "the migration has its guard");
    assert.match(file, /^-- rollback: /);
    assert.ok(file.indexOf(guard) < file.indexOf("DROP TABLE IF EXISTS platform.pmail_accounts"), "the guard runs before the drop");
    assert.ok(file.indexOf("NO FORCE ROW LEVEL SECURITY") < file.indexOf(guard), "the guard looks past the row fence, so a row of any login is seen");
    // the same guard on a stand-in with the old name (the real table is gone): a transaction that is rolled back
    await owner.query("BEGIN");
    try {
      await owner.query("CREATE TABLE platform.pmail_accounts (login_id uuid)");
      assert.equal(await sqlStateOf(owner.query(guard)), null, "empty: the guard passes");
      await owner.query("INSERT INTO platform.pmail_accounts (login_id) VALUES ($1)", [SA]);
      assert.equal(await sqlStateOf(owner.query(guard)), "23000", "one row of any login: the guard raises");
    } finally {
      await owner.query("ROLLBACK");
    }
    assert.equal((await owner.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'platform' AND table_name = 'pmail_accounts'")).rows.length, 0, "nothing was left behind");
  });
});

describe("the repository keeps its rules on the real database", () => {
  test("taking the same mail in twice adds nothing; the same address is a separate contact for each login", async () => {
    const e = email("shared@x.in", "sa@gmail.com");
    const first = await unit.run(session(SA), (r) => r.conversations.ingest([e], { mailbox: "sa@gmail.com" }, r.matcher, at));
    const again = await unit.run(session(SA), (r) => r.conversations.ingest([e], { mailbox: "sa@gmail.com" }, r.matcher, at));
    const other = await unit.run(session(PA), (r) => r.conversations.ingest([{ ...e, externalId: e.externalId, fallbackId: "uid:inbox:1:9999" }], { mailbox: "pa@gmail.com" }, r.matcher, at));
    assert.deepEqual([first.added, again.added, other.added], [1, 0, 1], "the same Message-ID and address are one row per login");
  });

  test("the purge of one login removes only its old messages", async () => {
    const before = await count(PA, "pmail_conv_messages");
    const removed = await unit.run(session(SA), (r) => r.conversations.purge(new Date("2027-01-01T00:00:00Z")));
    assert.ok(removed >= 1);
    assert.equal(await count(SA, "pmail_conv_messages"), 0);
    assert.equal(await count(PA, "pmail_conv_messages"), before, "the other login's entries are untouched");
  });

  test("a deleted login takes its mailbox with it", async () => {
    await owner.query("DELETE FROM platform.logins WHERE id = $1", [PA]);
    for (const t of TABLES) assert.equal(Number((await sup.query(`SELECT count(*)::int AS n FROM platform.${t} WHERE login_id = $1`, [PA])).rows[0].n), 0, t);
  });
});
