// Sending from an extra address (MJ, 5 Nov 2026): a person with extra addresses from the Super Admin may reply and write from any of their OWN addresses (the main one or an extra one), never
// from anybody else's; an inbox with one address (a hotel, a group) refuses a chosen From; the list can show only the mail of one of the addresses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { conversationsCopy as C } from "@shared/dashboards/conversations";
import type { VerifiedSession } from "../../src/server/auth/session";
import { AppError } from "../../src/server/errors";
import { entryOfInbound } from "../../src/server/mail/inbound";
import { createPersonSender } from "../../src/server/mail/personSender";
import type { SmtpConfig, TransportFactory } from "../../src/server/mail/smtp";
import { createMemoryPersonalMailbox } from "../../src/server/repos/memory/personalMailbox";
import { createConversationsService } from "../../src/server/services/conversations/conversationsService";
import { createPersonalMailboxService, personalSession } from "../../src/server/services/conversations/personalMailboxService";
import { composeBody, replyBody } from "../../src/server/services/conversations/schemas";
import { catalog, makeSession } from "./helpers/session";

const DOMAIN = "mail.example.in";
const UMA = "00000000-0000-4000-8000-0000000000b2";
const RAVI = "00000000-0000-4000-8000-0000000000b4";
const HOTEL = "11111111-1111-4111-8111-111111111111";
const META = { traceId: "trace-from", ip: null, userAgent: null };
const q = { tab: "all", channel: "all", page: 1, size: 25 } as const;
const MAIN = `uma.desk@${DOMAIN}`;
const EXTRA = `frontdesk.sunrise@${DOMAIN}`;
const SERVER: SmtpConfig = { host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", user: "AKIAFAKE", pass: "fake", from: `"Platform" <noreply@${DOMAIN}>`, sendingDomain: DOMAIN };
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : "error"));

function world() {
  const memory = createMemoryPersonalMailbox();
  const sent: Record<string, unknown>[] = [];
  const factory: TransportFactory = () =>
    ({
      async sendMail(m: Record<string, unknown>) {
        sent.push(m);
        return { messageId: "ok" };
      },
      async verify() {
        return true;
      },
      close() {
        // nothing open
      },
    }) as never;
  const logins: Record<string, { username: string; name: string }> = { [UMA]: { username: "uma.desk", name: "Uma Desk" }, [RAVI]: { username: "ravi", name: "Ravi Patel" } };
  const extras: Record<string, string[]> = { [UMA]: [EXTRA], [RAVI]: [`ravi.sales@${DOMAIN}`] };
  const account = createPersonalMailboxService({
    unit: memory.unit,
    now: () => new Date("2026-11-05T10:00:00Z"),
    identity: async (id) => logins[id] ?? null,
    domain: async () => DOMAIN,
    taken: async () => new Set<string>(),
    extras: async (id) => extras[id] ?? [],
  });
  const sender = createPersonSender({ platformServer: async () => SERVER, identity: (id, from) => account.senderOf(id, from), createTransport: factory });
  const base = { unit: memory.unit, people: { get: async () => new Map() }, catalog, now: () => new Date("2026-11-05T10:00:00Z"), smtpKey: () => Buffer.alloc(32, 1), imap: () => Promise.reject(new Error("none")), sleep: async () => undefined, staff: async () => [], sendHotelMail: sender, registry: { report: async () => undefined } };
  const mail = createConversationsService({ ...base, fromChoices: (id) => account.fromChoices(id) });
  // the same hub with one address only (how a hotel's and a group's inbox are made): a chosen From is refused
  const single = createConversationsService(base);
  return { memory, sent, account, mail, single, data: (id: string) => memory.store.dataFor(id) };
}

const session = (id: string): VerifiedSession => personalSession(makeSession({ userId: id, hotelId: HOTEL, accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1 }));

async function receive(w: ReturnType<typeof world>, to: string, n: string, sender = "Asha Mehta <asha@client.in>") {
  const raw = [`From: ${sender}`, `To: ${to}`, `Subject: Booking ${n}`, `Message-ID: <${n}@client.in>`, "Date: Thu, 05 Nov 2026 09:00:00 +0000", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", "Hello."].join("\r\n");
  const made = await entryOfInbound({ sesMessageId: `ses-${n}`, recipients: [to], spamFailed: false, virusFailed: false, verified: true, raw: Buffer.from(raw), at: null }, new Date("2026-11-05T09:00:30Z"));
  if (!("entry" in made)) throw new Error("skipped");
  await w.account.receive(UMA, [made.entry], new Map());
}

describe("sending from an extra address", () => {
  test("the From choices are the person's main address first, then the extra ones", async () => {
    const w = world();
    assert.deepEqual(await w.account.fromChoices(UMA), [MAIN, EXTRA]);
  });

  test("a reply and a new mail go out from the chosen extra address (From and Reply-To), and the sent copy records it", async () => {
    const w = world();
    const s = session(UMA);
    await receive(w, EXTRA, "a1");
    const id = (await w.mail.list(s, q)).items[0].id;
    const reply = await w.mail.reply(s, id, { channel: "email", text: "Your room is ready.", from: EXTRA.toUpperCase() }, META);
    assert.equal(w.sent[0].from, `"Uma Desk" <${EXTRA}>`);
    assert.equal(w.sent[0].replyTo, EXTRA);
    assert.equal(reply.kind === "email" ? reply.from : "", EXTRA);
    await w.mail.compose(s, { to: "client@example.com", subject: "Offer", text: "Please see below.", from: EXTRA }, META);
    assert.equal(w.sent[1].from, `"Uma Desk" <${EXTRA}>`);
    const out = w.data(UMA).convMessages.filter((m) => m.direction === "out");
    assert.deepEqual(out.map((m) => m.fromAddr), [EXTRA, EXTRA]);
    // no From chosen: the main address, as before
    await w.mail.reply(s, id, { channel: "email", text: "One more thing." }, META);
    assert.equal(w.sent[2].from, `"Uma Desk" <${MAIN}>`);
  });

  test("an address the person does not own is refused before anything is sent: another person's, a made-up one, the platform's", async () => {
    const w = world();
    const s = session(UMA);
    await receive(w, MAIN, "b1");
    const id = (await w.mail.list(s, q)).items[0].id;
    for (const from of [`ravi@${DOMAIN}`, `ravi.sales@${DOMAIN}`, `boss@${DOMAIN}`, `noreply@${DOMAIN}`, "uma@gmail.com"]) {
      assert.equal(await codeOf(w.mail.reply(s, id, { channel: "email", text: "Hi", from }, META)), "FORBIDDEN", `reply from ${from}`);
      assert.equal(await codeOf(w.mail.compose(s, { to: "client@example.com", subject: "x", text: "y", from }, META)), "FORBIDDEN", `compose from ${from}`);
    }
    assert.equal(w.sent.length, 0, "nothing was sent");
    const err = (await w.mail.reply(s, id, { channel: "email", text: "Hi", from: `ravi@${DOMAIN}` }, META).catch((e: unknown) => e)) as AppError;
    assert.equal(err.message, C.errors.fromNotOwn);
    // the sender checks again by itself
    assert.equal(await codeOf(w.account.senderOf(UMA, `ravi.sales@${DOMAIN}`)), "FORBIDDEN");
    assert.equal((await w.account.senderOf(UMA, EXTRA)).address, EXTRA);
  });

  test("an inbox with one address (a hotel, a group) refuses any chosen From; the platform inbox too", async () => {
    const w = world();
    const s = session(UMA);
    await receive(w, MAIN, "c1");
    const id = (await w.single.list(s, q)).items[0].id;
    assert.equal(await codeOf(w.single.reply(s, id, { channel: "email", text: "Hi", from: MAIN }, META)), "FORBIDDEN");
    assert.equal(await codeOf(w.single.compose(s, { to: "client@example.com", subject: "x", text: "y", from: MAIN }, META)), "FORBIDDEN");
    assert.equal(w.sent.length, 0);
    const platform = readFileSync(path.join(process.cwd(), "src/server/services/conversations/platformConversationsService.ts"), "utf8");
    assert.match(platform, /if \(input\.from\) throw new AppError\("FORBIDDEN", C\.errors\.fromNotOwn/);
  });

  test("the request shapes take a From address and the list an address", () => {
    assert.equal(replyBody.parse({ channel: "email", text: "x", from: EXTRA }).channel, "email");
    assert.equal(composeBody.parse({ to: "a@b.in", subject: "", text: "x", from: EXTRA }).from, EXTRA);
  });

  test("the list shows only the threads of one address when asked (the address switch)", async () => {
    const w = world();
    const s = session(UMA);
    await receive(w, MAIN, "d1");
    await receive(w, EXTRA, "d2", "Kiran Rao <kiran@travel.in>");
    assert.equal((await w.mail.list(s, q)).total, 2);
    const onExtra = await w.mail.list(s, { ...q, address: EXTRA });
    assert.deepEqual([onExtra.total, onExtra.items[0]?.subject], [1, "Booking d2"]);
    assert.equal((await w.mail.list(s, { ...q, address: MAIN })).total, 1);
    // a hub with one address ignores it
    assert.equal((await w.single.list(s, { ...q, address: EXTRA })).total, 2);
  });
});
