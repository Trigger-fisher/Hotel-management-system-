// A staff login's mailbox on the platform's SES domain, through the REAL composition and the REAL PostgreSQL (platform 0179): the address from the login's username and the saved sending domain, the
// collisions with a hotel, a group and a hotel's own SES From, who is eligible (active, not deleted, not blocked, a staff account role), mail delivered into the right login's own rows by the real
// mail-inbound service, and sending that stops with a sentence when the platform has no saved server (no fallback to the server's own SMTP_*). No real SES call and no real email.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { newId } from "../../src/server/db/ids";
import { connectPg } from "../../../common/db/scripts/pg-db";
import { appUrl, connectOwner, lockTestDatabase, superUrl, tag } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let sup: DbClient;
type Compose = typeof import("../../src/server/compose/personalMailbox");
type Inbound = typeof import("../../src/server/compose/mailInbound");
let compose: Compose;
let inbound: Inbound;
let closeDb: (() => Promise<void>) | undefined;

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const DOMAIN = `mail${tag()}.example.in`;
const settingsBefore = new Map<string, string | null>();
const made = { logins: [] as string[], hotels: [] as string[], groups: [] as string[] };
const META = { traceId: "t1", ip: null, userAgent: null };

const roleId = async (): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL")).rows[0].id);
async function makeUser(accountRole: string, username: string, name = "Mailbox Person"): Promise<string> {
  const id = newId();
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify({ id, username, display_name: name, password_hash: HASH, role_id: await roleId(), account_role: accountRole, code_required: true })]);
  made.logins.push(id);
  return id;
}
const sessionObj = (id: string, accountRole = "super_admin") => ({ userId: id, hotelId: "", accountRole, roleId: "", roleKey: "super_admin", roleLevel: 4, permissions: {}, sessionId: "s", client: "web" });
const session = (id: string, accountRole = "super_admin"): never => sessionObj(id, accountRole) as never;
const setting = async (key: string, value: string | null): Promise<void> => {
  if (!settingsBefore.has(key)) settingsBefore.set(key, ((await owner.query("SELECT value #>> '{}' AS v FROM platform.platform_settings WHERE key = $1", [key])).rows[0]?.v as string | undefined) ?? null);
  if (value === null) await owner.query("DELETE FROM platform.platform_settings WHERE key = $1", [key]);
  else await owner.query("INSERT INTO platform.platform_settings (key, value, is_secret) VALUES ($1, to_jsonb($2::text), false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
};
const count = async (loginId: string, table: string): Promise<number> => Number((await sup.query(`SELECT count(*)::int AS n FROM platform.${table} WHERE login_id = $1`, [loginId])).rows[0].n);

const rawMail = (to: string[], id: string): string => ["From: Asha Mehta <asha@client.in>", `To: ${to.join(", ")}`, "Subject: Contract", `Message-ID: <${id}@client.in>`, "Date: Tue, 03 Nov 2026 09:00:00 +0000", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", "Hello, please read the contract."].join("\r\n");
const notice = (to: string[], id: string) => ({
  notificationType: "Received",
  mail: { timestamp: new Date().toISOString(), messageId: `ses${id}`, destination: to },
  receipt: { recipients: to, spamVerdict: { status: "PASS" }, virusVerdict: { status: "PASS" }, spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" } },
  content: rawMail(to, id),
});

let SA: string;
let PA: string;
let U_OFF: string;
let U_DEL: string;
let U_BLOCK: string;
let U_HOTEL: string;
let U_GROUP: string;
let U_SES: string;
const names = { sa: `sa${tag()}`, pa: `pa.${tag()}`, off: `off${tag()}`, del: `del${tag()}`, block: `blk${tag()}`, hotel: `h${tag()}x`, group: `g${tag()}x`, ses: `fd${tag()}` };

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  sup = await connectPg(superUrl());
  // the real composition, on the test database as the app login (the URL is never printed)
  process.env.DATABASE_URL = appUrl();
  compose = await import("../../src/server/compose/personalMailbox");
  inbound = await import("../../src/server/compose/mailInbound");
  const db = await import("../../src/db");
  closeDb = () => db.closeDatabase();
  await setting("mail.from_email", `noreply@${DOMAIN}`);
  await setting("mail.sending_domain", null);
  // nothing saved for the platform mail server: sending has nothing to use
  for (const k of ["mail.smtp_host", "mail.smtp_user", "mail.smtp_password"]) await setting(k, null);
  SA = await makeUser("super_admin", names.sa, "Sonal Super");
  PA = await makeUser("platform_admin", names.pa, "Neha Platform");
  U_OFF = await makeUser("platform_admin", names.off);
  U_DEL = await makeUser("platform_admin", names.del);
  U_BLOCK = await makeUser("platform_admin", names.block);
  await owner.query("UPDATE platform.logins SET status = 'disabled' WHERE id = $1", [U_OFF]);
  await owner.query("UPDATE platform.logins SET deleted_at = now() WHERE id = $1", [U_DEL]);
  await owner.query("UPDATE platform.logins SET blocked_at = now(), blocked_kind = 'admin' WHERE id = $1", [U_BLOCK]);
  // a hotel, a group and a hotel's own SES From address that three logins are named after
  const hotel = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Collision Hotel', $1) RETURNING id", [`${names.hotel.slice(0, -1)}-x`])).rows[0].id);
  made.hotels.push(hotel);
  const group = String((await owner.query("INSERT INTO platform.hotel_groups (name, slug) VALUES ('Collision Group', $1) RETURNING id", [`${names.group.slice(0, -1)}-x`])).rows[0].id);
  made.groups.push(group);
  await owner.query("INSERT INTO platform.hotel_mail (hotel_id, ses_from) VALUES ($1, $2)", [hotel, `${names.ses}@${DOMAIN}`]);
  U_HOTEL = await makeUser("platform_admin", names.hotel);
  U_GROUP = await makeUser("super_admin", names.group);
  U_SES = await makeUser("platform_admin", names.ses);
  compose.forgetTakenAddresses();
});

after(async () => {
  for (const [key, value] of settingsBefore) {
    if (value === null) await owner?.query("DELETE FROM platform.platform_settings WHERE key = $1", [key]).catch(() => undefined);
    else await owner?.query("INSERT INTO platform.platform_settings (key, value, is_secret) VALUES ($1, to_jsonb($2::text), false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]).catch(() => undefined);
  }
  for (const id of made.hotels) await owner?.query("DELETE FROM platform.hotels WHERE id = $1", [id]).catch(() => undefined);
  for (const id of made.groups) await owner?.query("DELETE FROM platform.hotel_groups WHERE id = $1", [id]).catch(() => undefined);
  for (const id of made.logins) await owner?.query("DELETE FROM platform.logins WHERE id = $1", [id]).catch(() => undefined);
  await closeDb?.().catch(() => undefined);
  await sup?.end();
  await owner?.end();
  await release?.();
});

describe("the address, from the real login and the real settings", () => {
  test("<username>@<domain of the saved From address>, recorded once in the login's own row; another login's row is not touched", async () => {
    const mailbox = compose.getPersonalMailbox();
    const v = await mailbox.address(session(SA));
    assert.deepEqual([v.address, v.usable, v.reason, v.message], [`${names.sa}@${DOMAIN}`, true, "ok", null]);
    assert.equal((await sup.query("SELECT address FROM platform.pmail_addresses WHERE login_id = $1", [SA])).rows[0].address, `${names.sa}@${DOMAIN}`);
    assert.equal(await count(PA, "pmail_addresses"), 0);
    const w = await mailbox.address(session(PA, "platform_admin"));
    assert.equal(w.address, `${names.pa}@${DOMAIN}`, "dots stay");
  });

  test("a username equal to a hotel slug (without dashes), a group slug or a hotel's own SES From has no working address, and says so", async () => {
    const mailbox = compose.getPersonalMailbox();
    for (const [id, role, local] of [[U_HOTEL, "platform_admin", names.hotel], [U_GROUP, "super_admin", names.group], [U_SES, "platform_admin", names.ses]] as const) {
      const v = await mailbox.address(session(id, role));
      assert.deepEqual([v.address, v.usable, v.reason], [`${local}@${DOMAIN}`, false, "taken"], local);
      assert.equal(v.message, "This name is used by something else. Ask your admin to change your username.");
      assert.equal(await mailbox.usableAddress(id), null);
      await assert.rejects(mailbox.senderOf(id), (e: unknown) => (e as { code: string }).code === "CONFLICT");
    }
  });

  test("no sending domain on the platform: no address at all (and a Gmail From address is never a domain)", async () => {
    await setting("mail.from_email", "someone@gmail.com");
    compose.forgetTakenAddresses();
    try {
      const v = await compose.getPersonalMailbox().address(session(SA));
      assert.deepEqual([v.address, v.usable, v.reason], [null, false, "no_domain"]);
    } finally {
      await setting("mail.from_email", `noreply@${DOMAIN}`);
      compose.forgetTakenAddresses();
    }
  });

  test("a deleted, disabled or blocked login has no mailbox, and no one else's session reaches another login", async () => {
    const mailbox = compose.getPersonalMailbox();
    for (const id of [U_OFF, U_DEL, U_BLOCK]) assert.equal(await mailbox.usableAddress(id), null);
    for (const role of ["guest_user", "corporate_user"]) await assert.rejects(mailbox.address({ ...sessionObj(SA), accountRole: role } as never), (e: unknown) => (e as { code: string }).code === "FORBIDDEN");
  });
});

describe("received mail, through the real mail-inbound service", () => {
  test("personsOf: the active, not deleted, not blocked staff logins whose address is usable; never a collision, a reserved name or another domain", async () => {
    const found = await inbound.personsOf([`${names.sa}@${DOMAIN}`, `${names.pa}@${DOMAIN}`, `${names.off}@${DOMAIN}`, `${names.del}@${DOMAIN}`, `${names.block}@${DOMAIN}`, `${names.hotel}@${DOMAIN}`, `${names.group}@${DOMAIN}`, `${names.ses}@${DOMAIN}`, `admin@${DOMAIN}`, `${names.sa}@other.example`]);
    assert.deepEqual([...found].sort(), [SA, PA].sort());
  });

  test("an email to two staff addresses lands in both logins' own rows with its whole source, and in nobody else's; a repeat adds nothing", async () => {
    const id = `real${tag()}`;
    const n = notice([`${names.sa}@${DOMAIN}`, `${names.pa}@${DOMAIN}`, `${names.off}@${DOMAIN}`, `${names.del}@${DOMAIN}`, `admin@${DOMAIN}`], id);
    const out = await inbound.getInboundMail().receive(n);
    assert.deepEqual([out.recognised, out.persons, out.added, out.skipped], [true, 2, 2, null]);
    for (const login of [SA, PA]) {
      assert.deepEqual([await count(login, "pmail_conv_messages"), await count(login, "pmail_conv_mail_sources")], [1, 1], login);
      const source = String((await sup.query("SELECT convert_from(source, 'UTF8') AS s FROM platform.pmail_conv_mail_sources WHERE login_id = $1", [login])).rows[0].s);
      assert.ok(source.includes("please read the contract"));
    }
    for (const login of [U_OFF, U_DEL, U_BLOCK, U_HOTEL, U_GROUP, U_SES]) assert.equal(await count(login, "pmail_conv_messages"), 0, `nothing for ${login}`);
    assert.equal((await inbound.getInboundMail().receive(n)).added, 0);
    // the rows are the login's own: the app login sees one login's rows only
    const { withPersonalMailbox } = compose;
    const mineSa = await withPersonalMailbox(session(SA), (r) => r.conversations.list({ words: [], tab: "all", channel: "all", me: SA, page: 1, pageSize: 25 }));
    assert.equal(mineSa.total, 1);
    const unread = await withPersonalMailbox(session(PA, "platform_admin"), (r) => r.conversations.unreadTotal());
    assert.equal(unread, 1);
  });

  test("spam is skipped; an address of no one is left alone", async () => {
    const spam = { ...notice([`${names.sa}@${DOMAIN}`], `spam${tag()}`), receipt: { recipients: [`${names.sa}@${DOMAIN}`], spamVerdict: { status: "FAIL" } } };
    assert.equal((await inbound.getInboundMail().receive(spam)).skipped, "spam");
    const none = await inbound.getInboundMail().receive(notice([`nobody${tag()}@${DOMAIN}`], `none${tag()}`));
    assert.deepEqual([none.persons, none.noHotel], [0, true]);
  });
});

describe("sending, with the platform's server not saved", () => {
  test("nothing is sent and no other server is looked for: a plain sentence, and the email is not recorded as sent", async () => {
    const mail = compose.getPersonalConversations();
    const s = compose.asPersonal(session(SA));
    const before = await count(SA, "pmail_conv_messages");
    const err = (await mail.compose(s, { to: "client@example.com", subject: "Offer", text: "Hello" }, META).catch((e: unknown) => e)) as { code: string; message: string };
    assert.deepEqual([err.code, err.message], ["CONFLICT", "Your mailbox cannot send yet. Ask your admin."]);
    assert.equal(await count(SA, "pmail_conv_messages"), before, "nothing was added to the rows");
    assert.equal(Number((await sup.query("SELECT count(*)::int AS n FROM platform.pmail_conv_messages WHERE login_id = $1 AND direction = 'out'", [SA])).rows[0].n), 0);
  });
});
