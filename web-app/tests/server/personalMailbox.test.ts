// My mailbox (platform 0178, 0179; MJ, 3 Nov 2026): every staff login has its own mailbox on the platform's Amazon SES domain, on the in-memory pieces and fake mail transports (no real SES call,
// no real email). What must hold: who has a mailbox (five account roles, a custom role key included; a guest, a company login, a visit and an API key refused); the address (one pure function: case,
// reserved names, collisions with a hotel, a group and a desk, dots and dashes); received mail lands only in the right login's own rows with its whole source (two staff addresses: both; a
// collision address: the hotel/group/desk; a disabled, deleted or ineligible login: nothing; spam skipped); sending goes through ONE SES sender as the person's own address with their name and
// Reply-To, and NEVER falls back to anything else (MJ's rule); and nobody reads anybody's mailbox.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { personalMailboxCopy as P } from "@shared/dashboards/conversations";
import { CONSOLE_MAILBOX_ROLES, MAILBOX_ROLES } from "@shared/dashboards/mailboxAccess";
import type { AccountRole, VerifiedSession } from "../../src/server/auth/session";
import { AppError } from "../../src/server/errors";
import { runConversationsPass, type CronPorts } from "../../src/server/compose/conversations";
import { addressViewOf, mailboxAddressOf } from "../../src/server/mail/personalAddress";
import { createPersonSender } from "../../src/server/mail/personSender";
import type { SmtpConfig, TransportFactory } from "../../src/server/mail/smtp";
import { createMemoryPersonalMailbox } from "../../src/server/repos/memory/personalMailbox";
import { createConversationsService } from "../../src/server/services/conversations/conversationsService";
import { createPersonalMailboxService, personalSession } from "../../src/server/services/conversations/personalMailboxService";
import { createInboundMailService, type InboundMailPorts } from "../../src/server/services/mail/inboundService";
import { catalog, makeSession } from "./helpers/session";

const DOMAIN = "mail.example.in";
const SA_ID = "00000000-0000-4000-8000-0000000000a1";
const PA_ID = "00000000-0000-4000-8000-0000000000a2";
const HU_ID = "00000000-0000-4000-8000-0000000000b2";
const HA_ID = "00000000-0000-4000-8000-0000000000b1";
const GA_ID = "00000000-0000-4000-8000-0000000000b3";
const OFF_ID = "00000000-0000-4000-8000-0000000000c1";
const HOTEL = "11111111-1111-4111-8111-111111111111";
const META = { traceId: "trace-1", ip: null, userAgent: null };
const q = { tab: "all", channel: "all", page: 1, size: 25 } as const;
const code = (e: unknown) => (e as AppError).code;

interface Login {
  username: string;
  name: string;
  role: AccountRole;
  active?: boolean;
}
const LOGINS: Record<string, Login> = {
  [SA_ID]: { username: "sonal.super", name: "Sonal Super", role: "super_admin" },
  [PA_ID]: { username: "neha-platform", name: "Neha Platform", role: "platform_admin" },
  [HA_ID]: { username: "hari.hotel", name: "Hari Hotel", role: "hotel_admin" },
  [HU_ID]: { username: "uma.desk", name: "Uma Desk", role: "hotel_user" },
  [GA_ID]: { username: "gita.group", name: "Gita Group", role: "group_hotel_admin" },
  [OFF_ID]: { username: "olga.off", name: "Olga Off", role: "hotel_user", active: false },
};
const sessionFor = (id: string, over: { roleKey?: string } = {}): VerifiedSession => makeSession({ userId: id, hotelId: LOGINS[id].role === "hotel_user" || LOGINS[id].role === "hotel_admin" ? HOTEL : "", accountRole: LOGINS[id].role, roleKey: over.roleKey ?? (LOGINS[id].role === "hotel_user" ? "viewer" : "super_admin"), roleLevel: LOGINS[id].role === "hotel_user" ? 1 : 4 });

/** A fake Amazon SES transport: it records every attempt, and can be made to fail. */
function fakeSes() {
  const s = { created: 0, attempts: 0, mails: [] as Record<string, unknown>[], failing: false };
  const factory: TransportFactory = () => {
    s.created += 1;
    return {
      async sendMail(m: Record<string, unknown>) {
        s.attempts += 1;
        if (s.failing) throw Object.assign(new Error("421 try again, password hunter2"), { responseCode: 421 });
        s.mails.push(m);
        return { messageId: "ok" };
      },
      async verify() {
        return true;
      },
      close() {
        // nothing open
      },
    } as never;
  };
  return { s, factory };
}

const SES_SERVER: SmtpConfig = { host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", user: "AKIAFAKE", pass: "fake-ses-secret", from: `"Platform" <noreply@${DOMAIN}>`, sendingDomain: DOMAIN };

function world(o: { server?: SmtpConfig | null; taken?: string[]; domain?: string | null } = {}) {
  const memory = createMemoryPersonalMailbox();
  const ses = fakeSes();
  const imapCalls = { n: 0 };
  const clock = { now: new Date("2026-11-03T10:00:00Z") };
  const taken = new Set(o.taken ?? [`sunrisehotel@${DOMAIN}`, `grandgroup@${DOMAIN}`]);
  const logins = new Map(Object.entries(LOGINS).map(([id, l]) => [id, { ...l }]));
  const server = { value: o.server === undefined ? SES_SERVER : o.server };
  const account = createPersonalMailboxService({
    unit: memory.unit,
    now: () => clock.now,
    identity: async (id) => {
      const l = logins.get(id);
      return l && l.active !== false ? { username: l.username, name: l.name } : null;
    },
    domain: async () => (o.domain === undefined ? DOMAIN : o.domain),
    taken: async () => taken,
  });
  const platformServerCalls = { n: 0 };
  const sender = createPersonSender({
    platformServer: async () => {
      platformServerCalls.n += 1;
      return server.value;
    },
    identity: (id) => account.senderOf(id),
    createTransport: ses.factory,
  });
  const mail = createConversationsService({
    unit: memory.unit,
    people: { get: async () => new Map() },
    catalog,
    now: () => clock.now,
    smtpKey: () => Buffer.alloc(32, 1),
    imap: () => {
      imapCalls.n += 1;
      return Promise.reject(new Error("no outside mailbox"));
    },
    sleep: async () => undefined,
    staff: async () => [],
    sendHotelMail: sender,
    sesReceivingAddress: (id) => account.usableAddress(id),
    registry: { report: async () => undefined },
  });
  return { memory, ses, imapCalls, clock, taken, logins, server, account, mail, platformServerCalls, data: (id: string) => memory.store.dataFor(id) };
}

// ----------------------------------------------------------------------------------------------- inbound
const rawMail = (o: { to: string[]; subject?: string; id?: string; extra?: string[] }): string =>
  ["From: Asha Mehta <asha@client.in>", `To: ${o.to.join(", ")}`, `Subject: ${o.subject ?? "Contract"}`, `Message-ID: <${o.id ?? "m1"}@client.in>`, "Date: Tue, 03 Nov 2026 09:00:00 +0000", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", ...(o.extra ?? []), "", "Hello, please read the contract."].join("\r\n");
const notice = (content: string, recipients: string[], receipt: Record<string, unknown> = {}) => ({
  notificationType: "Received",
  mail: { timestamp: "2026-11-03T09:00:30.000Z", messageId: `ses${Math.abs(content.length)}${recipients.length}`, destination: recipients },
  receipt: { recipients, spamVerdict: { status: "PASS" }, virusVerdict: { status: "PASS" }, spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" }, ...receipt },
  content,
});

function inboundOf(w: ReturnType<typeof world>) {
  const delivered = { hotel: [] as string[], group: [] as string[], desk: [] as string[] };
  const ports: InboundMailPorts = {
    hotelsOf: async (r) => (r.includes(`sunrisehotel@${DOMAIN}`) ? ["hotel-1"] : []),
    deliver: async (id) => {
      delivered.hotel.push(id);
      return { added: 1 };
    },
    groupsOf: async (r) => (r.includes(`grandgroup@${DOMAIN}`) ? ["group-1"] : []),
    deliverGroup: async (id) => {
      delivered.group.push(id);
      return { added: 1 };
    },
    deskOf: async (r) => (r.includes(`sales@${DOMAIN}`) ? "Sales" : null),
    deliverPlatform: async (_e, _s, desk) => {
      delivered.desk.push(desk);
      return { added: 1 };
    },
    // the same rule as compose/mailInbound.ts personsOf: the login named by the username on the sending domain, active and of a staff role, and only when the address is usable
    personsOf: async (r) => {
      const locals = r.filter((a) => a.endsWith(`@${DOMAIN}`)).map((a) => a.slice(0, a.length - DOMAIN.length - 1));
      const found: string[] = [];
      for (const [id, l] of w.logins) if (locals.includes(l.username) && (MAILBOX_ROLES as readonly string[]).includes(l.role) && l.active !== false && (await w.account.usableAddress(id)) !== null) found.push(id);
      return found;
    },
    deliverPerson: (id, entries, sources) => w.account.receive(id, entries, sources),
  };
  return { service: createInboundMailService({ ports, now: () => w.clock.now }), delivered };
}

describe("who has a mailbox", () => {
  const guest = makeSession({ userId: "00000000-0000-4000-8000-0000000000d4", hotelId: "", accountRole: "guest_user", scope: { kind: "customer", ids: [], mobiles: [] } as never });
  const company = makeSession({ userId: "00000000-0000-4000-8000-0000000000d5", hotelId: "", accountRole: "corporate_user", scope: { kind: "company", ids: [], mobiles: [] } as never });

  test("all five staff account roles are allowed (and only those): the table is the one list", () => {
    assert.deepEqual([...MAILBOX_ROLES].sort(), ["group_hotel_admin", "hotel_admin", "hotel_user", "platform_admin", "super_admin"]);
    for (const id of [SA_ID, PA_ID, HA_ID, HU_ID, GA_ID]) {
      const s = personalSession(sessionFor(id));
      assert.deepEqual([s.hotelId, s.userId], [id, id], "the login id stands where a hotel's id would");
    }
    assert.equal(code((() => { try { personalSession(guest); } catch (e) { return e; } })()), "FORBIDDEN", "guest");
    assert.equal(code((() => { try { personalSession(company); } catch (e) { return e; } })()), "FORBIDDEN", "company");
    assert.deepEqual([...CONSOLE_MAILBOX_ROLES].sort(), ["group_hotel_admin", "platform_admin", "super_admin"]);
  });

  test("a custom hotel permission role is included automatically: only the account role decides", () => {
    const custom = makeSession({ userId: HU_ID, hotelId: HOTEL, accountRole: "hotel_user", roleKey: "night-auditor-2", roleLevel: 0 });
    assert.equal(personalSession(custom).userId, HU_ID);
    const noGrants = makeSession({ userId: HU_ID, hotelId: HOTEL, accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1, grants: [] });
    assert.equal(personalSession(noGrants).userId, HU_ID, "no module permission is needed: it is personal, not the hotel's Conversations");
  });

  test("a visit and an API key are refused, on every entry point", async () => {
    const w = world();
    const visiting: VerifiedSession = { ...sessionFor(SA_ID), hotelId: HOTEL, visit: { id: "v1", hotelId: HOTEL, hotelName: "Sunrise", expiresAt: new Date(), access: "full", by: "super_admin" } };
    const keyed: VerifiedSession = { ...sessionFor(SA_ID), client: "token", token: { id: "k", name: "Key", level: "full", scope: "platform", testMode: false, callsPerMinute: 60, ip: null, newIp: false } };
    for (const [name, who] of Object.entries({ visiting, keyed, guest, company })) {
      const refused = (p: Promise<unknown>) => p.then(() => "allowed", (e: unknown) => code(e));
      assert.equal(await refused(w.account.address(who)), "FORBIDDEN", `${name} address`);
      assert.equal(await refused(Promise.resolve().then(() => w.mail.list(personalSession(who), q))), "FORBIDDEN", `${name} list`);
      assert.equal(await refused(Promise.resolve().then(() => w.mail.reply(personalSession(who), "x", { channel: "email", text: "hi" }, META))), "FORBIDDEN", `${name} reply`);
    }
    assert.equal(w.ses.s.attempts, 0);
  });

  test("the unit itself refuses a session whose id is not its own login id (it cannot be pointed at someone else)", async () => {
    const w = world();
    await assert.rejects(w.memory.unit.run({ hotelId: PA_ID, userId: SA_ID, visit: undefined, scope: undefined } as never, async () => 1), (e: unknown) => code(e) === "FORBIDDEN");
  });
});

describe("the address", () => {
  const taken = new Set([`sunrisehotel@${DOMAIN}`, `grandgroup@${DOMAIN}`, `frontdesk@${DOMAIN}`, `noreply@${DOMAIN}`]);
  const of = (u: string, d: string | null = DOMAIN) => mailboxAddressOf(u, d, taken);

  test("<username>@<sending domain>, lower case; dots, dashes and digits stay", () => {
    assert.deepEqual(of("sonal.super"), { address: `sonal.super@${DOMAIN}`, usable: true, reason: "ok" });
    assert.deepEqual(of("Neha-Platform"), { address: `neha-platform@${DOMAIN}`, usable: true, reason: "ok" }, "case");
    assert.equal(of("a.b-c_d9").address, `a.b-c_d9@${DOMAIN}`);
    assert.equal(of("  trimmed.name ").address, `trimmed.name@${DOMAIN}`);
    assert.equal(of("ravi", "Mail.Example.IN").address, "ravi@mail.example.in", "the domain too");
  });

  test("a hotel slug (without dashes), a group slug and a hotel's own SES From keep their address: the username gets none that works", () => {
    for (const u of ["sunrisehotel", "grandgroup", "frontdesk", "noreply"]) assert.deepEqual([of(u).usable, of(u).address], [false, `${u}@${DOMAIN}`], u);
    assert.equal(of("sunrisehotel").reason, "taken");
    assert.equal(of("sunrise-hotel").usable, true, "a dash makes it a different address from the hotel's slug-without-dashes");
    assert.equal(of("grand.group").usable, true);
  });

  test("a reserved name, every desk and the system names are never an address", () => {
    for (const u of ["admin", "administrator", "postmaster", "abuse", "noreply", "no-reply", "info", "billing", "hello", "root", "webmaster", "security", "hostmaster", "mailer-daemon", "sales", "support", "Support", "ADMIN"]) {
      const a = of(u);
      assert.deepEqual([a.usable, a.reason], [false, "reserved"], u);
    }
  });

  test("a name that cannot be an address, and a platform with no sending domain, have none", () => {
    for (const u of ["ab", "-bad-start", "has space", "a@b", "", "x".repeat(70)]) assert.deepEqual([of(u).usable, of(u).address, of(u).reason], [false, null, "invalid"], u);
    assert.deepEqual(of("sonal.super", null), { address: null, usable: false, reason: "no_domain" });
    assert.equal(of("sonal.super", "").reason, "no_domain");
  });

  test("the page's sentence for an unusable name is the plain one", () => {
    assert.equal(addressViewOf(of("sunrisehotel")).message, "This name is used by something else. Ask your admin to change your username.");
    assert.equal(addressViewOf(of("admin")).message, P.unusable);
    assert.equal(addressViewOf(of("sonal.super")).message, null);
    assert.equal(addressViewOf(of("sonal.super", null)).message, P.noDomain);
  });

  test("the service gives the signed-in person only their own address, records it, and moves it when the username changes", async () => {
    const w = world();
    const v = await w.account.address(sessionFor(SA_ID));
    assert.deepEqual([v.address, v.usable, v.reason, v.message], [`sonal.super@${DOMAIN}`, true, "ok", null]);
    assert.equal(w.data(SA_ID).address, `sonal.super@${DOMAIN}`);
    assert.equal(w.data(PA_ID).address, null, "another login's row is not touched");
    (w.logins.get(SA_ID) as Login).username = "sonal.s";
    assert.equal((await w.account.address(sessionFor(SA_ID))).address, `sonal.s@${DOMAIN}`);
    assert.equal(w.data(SA_ID).address, `sonal.s@${DOMAIN}`, "one row, moved");
    // two logins may not record the same address: the second one is not recorded, but still answers
    (w.logins.get(PA_ID) as Login).username = "sonal.s";
    const second = await w.account.address(sessionFor(PA_ID));
    assert.deepEqual([second.address, w.data(PA_ID).address], [`sonal.s@${DOMAIN}`, null]);
  });

  test("a hotel taken a moment after: the person's page says so, and sending is blocked with a sentence before anything is tried", async () => {
    const w = world();
    (w.logins.get(HU_ID) as Login).username = "sunrisehotel";
    const v = await w.account.address(sessionFor(HU_ID));
    assert.deepEqual([v.usable, v.reason, v.message], [false, "taken", P.unusable]);
    const err = (await w.mail.compose(personalSession(sessionFor(HU_ID)), { to: "asha@client.in", subject: "Hi", text: "Hello" }, META).catch((e: unknown) => e)) as AppError;
    assert.deepEqual([code(err), err.message], ["CONFLICT", P.errors.sendBlocked]);
    assert.deepEqual([w.ses.s.created, w.ses.s.attempts, w.platformServerCalls.n], [0, 0, 0], "no sender was even looked at");
  });
});

describe("received mail", () => {
  test("an email to <username>@domain lands only in that login's rows, with its whole source", async () => {
    const w = world();
    const inbound = inboundOf(w);
    const content = rawMail({ to: [`sonal.super@${DOMAIN}`] });
    const out = await inbound.service.receive(notice(content, [`Sonal.Super@${DOMAIN.toUpperCase()}`.toLowerCase()]));
    assert.deepEqual([out.recognised, out.persons, out.hotels, out.groups, out.platform, out.added, out.noHotel], [true, 1, 0, 0, 0, 1, false]);
    const a = w.data(SA_ID);
    assert.deepEqual([a.convMessages.length, a.convMailSources?.length], [1, 1]);
    assert.ok(a.convMailSources?.[0].source.toString("utf8").includes("please read the contract"), "the whole email is kept");
    for (const other of [PA_ID, HA_ID, HU_ID, GA_ID]) assert.deepEqual([w.data(other).convMessages.length, w.data(other).convMailSources?.length], [0, 0], `nothing in ${other}`);
    // it opens from the kept copy, with no mailbox server
    const list = await w.mail.list(personalSession(sessionFor(SA_ID)), q);
    assert.equal(list.total, 1);
    const thread = await w.mail.thread(personalSession(sessionFor(SA_ID)), list.items[0].id);
    const body = await w.mail.emailBody(personalSession(sessionFor(SA_ID)), list.items[0].id, thread.messages[0].id, { images: false });
    assert.ok(JSON.stringify(body).includes("please read the contract"));
    assert.equal(w.imapCalls.n, 0);
    // the unread badge counts it for that person only
    assert.deepEqual([(await w.mail.summary(personalSession(sessionFor(SA_ID)))).unread, (await w.mail.summary(personalSession(sessionFor(PA_ID)))).unread], [1, 0]);
  });

  test("an email to two staff addresses lands in both logins' rows, each its own copy", async () => {
    const w = world();
    const out = await inboundOf(w).service.receive(notice(rawMail({ to: [`sonal.super@${DOMAIN}`, `uma.desk@${DOMAIN}`], id: "two" }), [`sonal.super@${DOMAIN}`, `uma.desk@${DOMAIN}`]));
    assert.deepEqual([out.persons, out.added], [2, 2]);
    assert.deepEqual([w.data(SA_ID).convMessages.length, w.data(HU_ID).convMessages.length, w.data(PA_ID).convMessages.length], [1, 1, 0]);
    assert.notEqual(w.data(SA_ID).convMailSources?.[0], w.data(HU_ID).convMailSources?.[0]);
  });

  test("a repeat of the same message adds nothing", async () => {
    const w = world();
    const inbound = inboundOf(w);
    const n = notice(rawMail({ to: [`sonal.super@${DOMAIN}`], id: "again" }), [`sonal.super@${DOMAIN}`]);
    assert.equal((await inbound.service.receive(n)).added, 1);
    assert.equal((await inbound.service.receive(n)).added, 0);
    assert.equal(w.data(SA_ID).convMessages.length, 1);
  });

  test("a collision address goes to the hotel, the group or the desk, never to a person with that name", async () => {
    const w = world();
    const inbound = inboundOf(w);
    // two staff logins named like a hotel, a group and the Sales desk
    (w.logins.get(PA_ID) as Login).username = "sunrisehotel";
    (w.logins.get(HA_ID) as Login).username = "grandgroup";
    (w.logins.get(GA_ID) as Login).username = "sales";
    const out = await inbound.service.receive(notice(rawMail({ to: [`sunrisehotel@${DOMAIN}`, `grandgroup@${DOMAIN}`, `sales@${DOMAIN}`], id: "coll" }), [`sunrisehotel@${DOMAIN}`, `grandgroup@${DOMAIN}`, `sales@${DOMAIN}`]));
    assert.deepEqual([out.hotels, out.groups, out.platform, out.persons], [1, 1, 1, 0]);
    assert.deepEqual(inbound.delivered, { hotel: ["hotel-1"], group: ["group-1"], desk: ["Sales"] });
    for (const id of [PA_ID, HA_ID, GA_ID]) assert.equal(w.data(id).convMessages.length, 0, id);
  });

  test("a disabled, deleted or ineligible login gets nothing; the sender's own mail to nobody is left alone", async () => {
    const w = world();
    const inbound = inboundOf(w);
    const out = await inbound.service.receive(notice(rawMail({ to: [`olga.off@${DOMAIN}`, `nobody.here@${DOMAIN}`], id: "off" }), [`olga.off@${DOMAIN}`, `nobody.here@${DOMAIN}`]));
    assert.deepEqual([out.persons, out.noHotel, out.added], [0, true, 0]);
    assert.equal(w.data(OFF_ID).convMessages.length, 0);
    // an address of the right shape on ANOTHER domain is nobody's
    const elsewhere = await inbound.service.receive(notice(rawMail({ to: ["sonal.super@other.example"], id: "other" }), ["sonal.super@other.example"]));
    assert.equal(elsewhere.persons, 0);
  });

  test("spam, a virus, a delivery report and mail HMS made as a system mail are skipped; a person's own conversation mail is taken", async () => {
    const w = world();
    const inbound = inboundOf(w);
    const to = [`sonal.super@${DOMAIN}`];
    assert.equal((await inbound.service.receive(notice(rawMail({ to, id: "s1" }), to, { spamVerdict: { status: "FAIL" } }))).skipped, "spam");
    assert.equal((await inbound.service.receive(notice(rawMail({ to, id: "s2" }), to, { virusVerdict: { status: "FAIL" } }))).skipped, "virus");
    assert.equal((await inbound.service.receive(notice(rawMail({ to, id: "s3", extra: ["X-HMS-Kind: bill_invoice"] }), to))).skipped, "hms");
    assert.equal((await inbound.service.receive(notice(rawMail({ to, id: "s4", extra: ["X-HMS-Kind: system"] }), to))).skipped, "hms");
    assert.equal(w.data(SA_ID).convMessages.length, 0);
    const colleague = await inbound.service.receive(notice(rawMail({ to, id: "s5", extra: ["X-HMS-Kind: conversation"] }), to));
    assert.deepEqual([colleague.skipped, colleague.persons, colleague.added], [null, 1, 1], "a colleague's email from their own mailbox arrives");
  });

  test("an email too large to keep whole is still listed, without a kept copy (the hotel limit)", async () => {
    const w = world();
    const entry = (await import("../../src/server/mail/inbound")).entryOfInbound;
    const made = await entry({ sesMessageId: "big1", recipients: [`sonal.super@${DOMAIN}`], spamFailed: false, virusFailed: false, verified: true, raw: Buffer.from(rawMail({ to: [`sonal.super@${DOMAIN}`], id: "big" })), at: null }, w.clock.now);
    assert.ok("entry" in made);
    const big = Buffer.alloc(1024 * 1024 + 1, 65);
    const out = await w.account.receive(SA_ID, [made.entry], new Map([[made.entry.externalId, big]]));
    assert.equal(out.added, 1);
    assert.equal(w.data(SA_ID).convMailSources?.length, 0);
  });
});

describe("sending: one SES sender, as the person's own address, and no fallback", () => {
  async function received(w: ReturnType<typeof world>, id = SA_ID) {
    const s = personalSession(sessionFor(id));
    const { entryOfInbound } = await import("../../src/server/mail/inbound");
    const made = await entryOfInbound({ sesMessageId: `r${id.slice(-2)}`, recipients: [], spamFailed: false, virusFailed: false, verified: true, raw: Buffer.from(rawMail({ to: [`x@${DOMAIN}`], id: `r-${id.slice(-2)}` })), at: null }, w.clock.now);
    if (!("entry" in made)) throw new Error("the test mail was skipped");
    await w.account.receive(id, [made.entry], new Map());
    return { s, conversationId: (await w.mail.list(s, q)).items[0].id };
  }

  test("a reply goes out through the platform SES as the person's address, name and Reply-To; Cc is a real header, Bcc is delivered but written nowhere; the sent copy is kept", async () => {
    const w = world();
    const { s, conversationId } = await received(w);
    const sent = await w.mail.reply(s, conversationId, { channel: "email", text: "Thanks, noted.", cc: ["boss@client.in"] }, META);
    assert.ok(sent.id);
    assert.deepEqual([w.ses.s.created, w.ses.s.attempts], [1, 1], "one connection, one attempt");
    const m = w.ses.s.mails[0];
    assert.equal(m.from, `"Sonal Super" <sonal.super@${DOMAIN}>`);
    assert.equal(m.replyTo, `sonal.super@${DOMAIN}`);
    assert.equal(m.to, "asha@client.in");
    assert.deepEqual(m.cc, ["boss@client.in"]);
    assert.equal((m.headers as Record<string, string>)["X-HMS-Kind"], "conversation");
    // the sent copy is in the person's own rows, whole, from their address
    const d = w.data(SA_ID);
    const out = d.convMessages.filter((x) => x.direction === "out");
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "sent");
    const source = d.convMailSources?.find((x) => x.messageId === out[0].id);
    assert.ok(source && source.source.toString("utf8").includes(`sonal.super@${DOMAIN}`) && source.source.toString("utf8").includes("Thanks, noted."));
    assert.equal(w.data(PA_ID).convMessages.length, 0);
  });

  test("a new email with Cc and Bcc: Bcc is in the envelope and in no header, the From is the person's, and it is listed as sent", async () => {
    const w = world();
    const s = personalSession(sessionFor(HU_ID));
    const { id } = await w.mail.compose(s, { to: "Client@Example.com", cc: ["a@x.in"], bcc: ["secret@x.in"], subject: "Offer", text: "Please see below." }, META);
    const m = w.ses.s.mails[0];
    assert.deepEqual([m.from, m.replyTo, m.to, m.cc, m.bcc], [`"Uma Desk" <uma.desk@${DOMAIN}>`, `uma.desk@${DOMAIN}`, "client@example.com", ["a@x.in"], ["secret@x.in"]]);
    const kept = w.data(HU_ID).convMailSources?.[0].source.toString("utf8") ?? "";
    assert.ok(kept.includes("Please see below.") && !kept.includes("secret@x.in"), "the kept copy never shows the Bcc");
    const thread = await w.mail.thread(s, id);
    assert.deepEqual([thread.messages.length, thread.messages[0].direction], [1, "out"]);
  });

  test("MJ's rule: a failing SES sender means exactly ONE attempt, no second sender, a plain sentence, the email is not recorded as sent, and the text can be tried again", async () => {
    const w = world();
    const { s, conversationId } = await received(w);
    w.ses.s.failing = true;
    const err = (await w.mail.reply(s, conversationId, { channel: "email", text: "Will fail." }, META).catch((e: unknown) => e)) as AppError;
    assert.deepEqual([code(err), err.message], ["CONFLICT", "Your email could not be sent. Try again in a minute."]);
    assert.ok(!JSON.stringify(err).includes("hunter2") && !JSON.stringify(err).includes("421"), "never the server's words");
    assert.deepEqual([w.ses.s.created, w.ses.s.attempts, w.platformServerCalls.n], [1, 1, 1], "one connection, one attempt, one look at the platform server: nothing else was tried");
    assert.equal(w.data(SA_ID).convMessages.filter((m) => m.direction === "out").length, 0, "not recorded as sent");
    // a compose fails the same way, and the person's draft is kept on the conversation
    const c = (await w.mail.compose(s, { to: "client@example.com", subject: "Offer", text: "Failing too." }, META).catch((e: unknown) => e)) as AppError;
    assert.deepEqual([code(c), c.message], ["CONFLICT", "Your email could not be sent. Try again in a minute."]);
    assert.equal(w.ses.s.attempts, 2, "one attempt for each email, no retry");
    assert.equal(w.data(SA_ID).convMessages.filter((m) => m.direction === "out").length, 0);
    const draft = await w.mail.compose(s, { to: "client@example.com", subject: "Offer", text: "Saved for later.", draft: true }, META);
    assert.ok(draft.id, "the text can be kept as a draft");
    assert.equal(w.ses.s.attempts, 2, "a draft sends nothing");
    // and when SES is back, the same text goes out
    w.ses.s.failing = false;
    await w.mail.reply(s, conversationId, { channel: "email", text: "Will fail." }, META);
    assert.equal(w.ses.s.mails.length, 1);
  });

  test("with no saved platform server, or one that does not send from this domain, nothing is sent at all (the server's own SMTP is a fallback too)", async () => {
    for (const server of [null, { ...SES_SERVER, sendingDomain: undefined }, { ...SES_SERVER, sendingDomain: "other.example" }] as (SmtpConfig | null)[]) {
      const w = world({ server });
      const { s, conversationId } = await received(w);
      const err = (await w.mail.reply(s, conversationId, { channel: "email", text: "Hi" }, META).catch((e: unknown) => e)) as AppError;
      assert.deepEqual([code(err), err.message], ["CONFLICT", P.errors.sendUnavailable]);
      assert.deepEqual([w.ses.s.created, w.ses.s.attempts], [0, 0]);
    }
  });

  test("the code cannot reach the hotel/group/platform sender chain or the provider failover: no import of them in the sender or the composition", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const root = path.join(__dirname, "..", "..", "src", "server");
    const FORBIDDEN = /routedMailSender|mailSenderFor|createPlatformSettingsSender|createFailoverRouter|platformFailoverPorts|createHotelMailRouter|hotelMailLoader|groupMailLoader|logMailSender|sendAsHotel|sendAsGroup|readHotelMail|readGroupMail|from "[^"]*\/failover"|from "[^"]*compose\/mail"|from "\.\/mail"|from "[^"]*hotelSmtp"|from "[^"]*hotelMail"/;
    for (const file of ["mail/personSender.ts", "compose/personalMailbox.ts", "services/conversations/personalMailboxService.ts"]) {
      const code = strip(readFileSync(path.join(root, file), "utf8"));
      assert.equal(FORBIDDEN.test(code), false, `${file} must not reach another sender`);
    }
    // and the composition hands the mail engine this sender and no IMAP reader
    const composed = strip(readFileSync(path.join(root, "compose/personalMailbox.ts"), "utf8"));
    assert.match(composed, /sendHotelMail: send\b/);
    assert.match(composed, /imap: noImap/);
  });

  test("nothing in a sent email's logs or errors carries the SES secret", async () => {
    const w = world();
    const { s, conversationId } = await received(w);
    w.ses.s.failing = true;
    const err = await w.mail.reply(s, conversationId, { channel: "email", text: "x" }, META).catch((e: unknown) => e);
    assert.ok(!JSON.stringify(err).includes("fake-ses-secret") && !JSON.stringify(err).includes("AKIAFAKE"));
  });
});

describe("nobody reads anybody's mailbox", () => {
  async function two() {
    const w = world();
    const inbound = inboundOf(w);
    await inbound.service.receive(notice(rawMail({ to: [`sonal.super@${DOMAIN}`], id: "for-sa", subject: "For the Super Admin only" }), [`sonal.super@${DOMAIN}`]));
    await inbound.service.receive(notice(rawMail({ to: [`uma.desk@${DOMAIN}`], id: "for-hu", subject: "For the hotel user only" }), [`uma.desk@${DOMAIN}`]));
    return w;
  }

  test("each sees only their own list; a Super Admin opening a hotel user's message by id gets 404, and the reverse", async () => {
    const w = await two();
    const sa = personalSession(sessionFor(SA_ID));
    const hu = personalSession(sessionFor(HU_ID));
    const listA = await w.mail.list(sa, q);
    const listH = await w.mail.list(hu, q);
    assert.deepEqual([listA.total, listH.total], [1, 1]);
    assert.ok(JSON.stringify(listA).includes("Super Admin only") && !JSON.stringify(listA).includes("hotel user only"));
    assert.ok(JSON.stringify(listH).includes("hotel user only") && !JSON.stringify(listH).includes("Super Admin only"));
    const idA = listA.items[0].id;
    const idH = listH.items[0].id;
    const messageA = (await w.mail.thread(sa, idA)).messages[0].id;
    const messageH = (await w.mail.thread(hu, idH)).messages[0].id;
    for (const [who, id, msg] of [[hu, idA, messageA], [sa, idH, messageH]] as const) {
      assert.equal(code(await w.mail.thread(who, id).catch((e: unknown) => e)), "NOT_FOUND", "thread");
      assert.equal(code(await w.mail.emailBody(who, id, msg, { images: false }).catch((e: unknown) => e)), "NOT_FOUND", "body");
      assert.equal(code(await w.mail.attachment(who, id, msg, 0).catch((e: unknown) => e)), "NOT_FOUND", "attachment");
      assert.equal(code(await w.mail.setRead(who, id, true).catch((e: unknown) => e)), "NOT_FOUND", "read state");
      assert.equal(code(await w.mail.reply(who, id, { channel: "email", text: "hello" }, META).catch((e: unknown) => e)), "NOT_FOUND", "reply");
      assert.equal(code(await w.mail.patch(who, id, { starred: true }, META).catch((e: unknown) => e)), "NOT_FOUND", "star");
    }
    assert.equal(w.ses.s.attempts, 0, "nothing was sent");
  });

  test("the unread badge is per person, from their own mailbox only, with no text, subject or address", async () => {
    const w = await two();
    const unread = async (id: string) => (await w.mail.summary(personalSession(sessionFor(id)))).unread;
    assert.deepEqual([await unread(SA_ID), await unread(HU_ID), await unread(PA_ID)], [1, 1, 0]);
    const summary = await w.mail.summary(personalSession(sessionFor(SA_ID)));
    assert.ok(!/Super Admin only|asha@client\.in|contract/i.test(JSON.stringify(summary)), "no text, subject or address");
    const id = (await w.mail.list(personalSession(sessionFor(SA_ID)), q)).items[0].id;
    await w.mail.thread(personalSession(sessionFor(SA_ID)), id);
    await w.mail.setRead(personalSession(sessionFor(SA_ID)), id, true);
    assert.deepEqual([await unread(SA_ID), await unread(HU_ID)], [0, 1]);
  });

  test("the page reads Connected with the person's own address (and shows the other's nowhere); an unusable name shows no receiving address", async () => {
    const w = await two();
    const list = await w.mail.list(personalSession(sessionFor(SA_ID)), q);
    assert.equal(list.mailbox.receivingAddress, `sonal.super@${DOMAIN}`);
    assert.ok(!JSON.stringify(list).includes("uma.desk"));
    (w.logins.get(SA_ID) as Login).username = "admin";
    assert.equal((await w.mail.list(personalSession(sessionFor(SA_ID)), q)).mailbox.receivingAddress, undefined);
  });

  test("Check now never contacts an outside mailbox: no IMAP server, ever", async () => {
    const w = await two();
    const r = await w.mail.sync(personalSession(sessionFor(SA_ID)), {});
    assert.deepEqual([r.checked, r.added], [false, 0]);
    assert.equal(w.imapCalls.n, 0);
  });
});

describe("the daily cron pass", () => {
  const outcome = { checked: false, added: 0, error: null, newInbound: [], mailbox: { config: null, reason: null, reading: false, provider: null }, positions: [] };
  const idle = { run: async <T>(work: (r: { platformAccount: () => Promise<null>; dueSync: () => Promise<string[]>; duePurge: () => Promise<string[]> }) => Promise<T>) => work({ platformAccount: async () => null, dueSync: async () => [], duePurge: async () => [] }) };

  test("never deletes a personal entry: the purge is a no-op whatever the switch says and however often it runs", async () => {
    const w = await (async () => {
      const x = world();
      await inboundOf(x).service.receive(notice(rawMail({ to: [`sonal.super@${DOMAIN}`], id: "cron" }), [`sonal.super@${DOMAIN}`]));
      return x;
    })();
    assert.equal(await w.account.purgeForWorker(), 0);
    const off = { registry: idle, hotel: { syncForWorker: async () => outcome, purgeForWorker: async () => 0 }, platform: { syncForWorker: async () => outcome, purgeForWorker: async () => 0 }, personal: w.account, now: () => new Date("2027-12-01T01:00:00Z") } as unknown as CronPorts;
    assert.equal((await runConversationsPass(off, { budgetMs: 40_000 })).purged, 0);
    assert.equal((await runConversationsPass({ ...off, autoPurge: true }, { budgetMs: 40_000 })).purged, 0, "even with the purge switched on (MJ, 3 Nov 2026)");
    assert.equal((await w.mail.list(personalSession(sessionFor(SA_ID)), q)).total, 1);
  });
});
