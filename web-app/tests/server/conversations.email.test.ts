// Conversations, the email channel end to end (decision 66) on a fake IMAP server and a fake SMTP transport: where a check starts and stops (UIDs, UIDVALIDITY, the first
// 14-day window, the 100 cap), the throttles and the lease, a check cut short, HMS's own mail and account-security mail never listed or opened (A10, A11), the Sent rule,
// bulk mail to Other, a reused Message-ID kept apart, opening an email again after the mailbox changed, threading and the reply rules (From not Reply-To, the bill rule),
// APPEND only when the server did not file the reply itself, and the fixed failure sentences.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { conversationsCopy } from "@shared/dashboards/conversations";
import { headerLines } from "../../src/server/mail/imap";
import { IMAP_FAILURE_TEXT, imapFailureOf } from "../../src/server/mail/imapFailure";
import { composeReply, createSmtpSender, MailSendError } from "../../src/server/mail/smtp";
import { MAIL_FAILURE_TEXT } from "../../src/server/mail/failure";
import { guestMail, hotelWorld, MAILBOX, rawMail, STAFF } from "./helpers/conversations";
import { grant, HOTEL_A, makeSession } from "./helpers/session";

const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const editor = makeSession({ userId: STAFF.neha, accountRole: "hotel_user", roleKey: "editor", roleLevel: 2, grants: [grant("conversations", "edit")] });
const C = conversationsCopy;
const DAY = 86_400_000;
type World = ReturnType<typeof hotelWorld>;
const later = (w: World, ms: number): void => void (w.clock.now = new Date(w.clock.now.getTime() + ms));
const put = (w: World, folder: "inbox" | "sent", raw: Buffer, at = new Date(w.clock.now.getTime() - 60_000)): number => w.imap.deliver(folder, raw, at);
const sync = (w: World, background = false) => w.service.sync(admin, { background });
const messages = (w: World) => w.data().convMessages;
const code = (e: unknown): string | undefined => (e as { code?: string }).code;
const headersOf = (raw: Buffer): Record<string, string> => Object.fromEntries(headerLines(raw).map((l) => [l.name, l.value]));

describe("where a mail check starts and stops", () => {
  test("the first check brings in the last 14 days (at most the newest 50); the next one only what is newer; nothing twice; the session is always closed", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "old@guest.in" }), new Date(w.clock.now.getTime() - 20 * DAY));
    for (const who of ["asha@guest.in", "ravi@guest.in", "mehul@guest.in"]) put(w, "inbox", guestMail({ from: who }));
    const first = await sync(w);
    assert.deepEqual([first.checked, first.added], [true, 3]);
    assert.ok(!messages(w).some((m) => m.fromAddr === "old@guest.in"), "older than the first window");
    later(w, 60_000);
    assert.deepEqual([(await sync(w)).added, messages(w).length], [0, 3], "the newest message answered by n:* is not listed again");
    put(w, "inbox", guestMail({ from: "asha@guest.in", subject: "Re: Booking question" }));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 1);
    assert.equal(w.data().convConversations.length, 3, "one conversation per person");
    assert.equal(w.imap.stats.opened, w.imap.stats.closed);
  });

  test("a renumbered folder (a new UIDVALIDITY) starts again from the first window without listing anything twice; a check takes at most 100 per folder", async () => {
    const w = hotelWorld();
    for (let i = 0; i < 3; i += 1) put(w, "inbox", guestMail({ from: `g${i}@guest.in` }));
    await sync(w);
    w.imap.renumber("inbox");
    later(w, 60_000);
    assert.deepEqual([(await sync(w)).added, messages(w).length], [0, 3]);
    for (let i = 0; i < 150; i += 1) put(w, "inbox", guestMail({ from: `bulk${i}@guest.in` }));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 100);
    later(w, 60_000);
    assert.equal((await sync(w)).added, 50);
  });

  test("throttles: on screen at most every 50 seconds, in the background about every 1.5 minutes (the badge polls every 90 s); the lease keeps two checks apart", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in" }));
    assert.equal((await sync(w)).checked, true);
    later(w, 30_000);
    assert.equal((await sync(w)).checked, false, "30 s later on screen");
    later(w, 25_000);
    assert.equal((await sync(w)).checked, true, "55 s later on screen");
    later(w, 60_000);
    assert.equal((await sync(w, true)).checked, false, "60 s later in the background");
    later(w, 30_000);
    assert.equal((await sync(w, true)).checked, true, "90 s later in the background");
    later(w, 600_000);
    await w.hotel.unit.run(admin, (r) => r.conversations.acquireLease(MAILBOX, w.clock.now, 60_000));
    assert.equal((await sync(w)).checked, false, "another check holds the lease");
  });

  test("a check cut short keeps what it read: the positions move only to the last UID read, the rest comes next time; the session is closed", async () => {
    const w = hotelWorld();
    await sync(w);
    for (let i = 0; i < 5; i += 1) put(w, "inbox", guestMail({ from: `p${i}@guest.in` }));
    w.imap.failAfter(2);
    later(w, 60_000);
    const cut = await sync(w);
    assert.deepEqual([cut.checked, cut.added, cut.mailbox.state], [true, 2, "error"]);
    later(w, 60_000);
    assert.equal((await sync(w)).added, 3);
    assert.equal(messages(w).length, 5);
    assert.equal(w.imap.stats.opened, w.imap.stats.closed);
  });

  test("RATE_LIMITED holds the background checks back 15 minutes (not a check on screen); WEB_LOGIN and the others are their own codes", async () => {
    const w = hotelWorld();
    w.imap.failConnect(Object.assign(new Error("[THROTTLED] Too many simultaneous connections"), { responseText: "[THROTTLED] Too many simultaneous connections" }));
    const r = await sync(w);
    assert.deepEqual([r.checked, r.mailbox.state], [true, "error"]);
    assert.ok(w.data().convPositions.every((p) => p.checkedAt === null || p.checkedAt.getTime() <= w.clock.now.getTime()), "the check time is never in the future");
    later(w, 6 * 60_000);
    assert.equal((await sync(w, true)).checked, false, "6 minutes later, still holding back");
    w.imap.failConnect(Object.assign(new Error("[THROTTLED] Too many simultaneous connections"), { responseText: "[THROTTLED] Too many simultaneous connections" }));
    assert.equal((await sync(w)).checked, true, "a check on screen is not held back");
    later(w, 16 * 60_000);
    assert.equal((await sync(w, true)).checked, true, "16 minutes later");
    assert.equal(imapFailureOf({ responseText: "[WEBALERT] https://accounts.google.com Please log in via your web browser" }), "WEB_LOGIN");
    assert.equal(imapFailureOf({ responseText: "[ALERT] Application-specific password required" }), "APP_PASSWORD_BLOCKED");
    assert.equal(imapFailureOf({ responseText: "[ALERT] IMAP access is disabled for your domain" }), "IMAP_DISABLED");
    assert.equal(imapFailureOf({ authenticationFailed: true }), "AUTH");
    assert.equal(imapFailureOf({ code: "ETIMEDOUT" }), "TIMEOUT");
    assert.equal(imapFailureOf({ code: "HOST_PRIVATE" }), "HOST_PRIVATE");
  });

  test("a service that only sends and the platform's mail are 'not available'; reading switched off is 'off'; nothing is checked", async () => {
    for (const [provider, reason] of [["ses", "send_only"], ["platform", "platform_mail"]] as const) {
      const w = hotelWorld({ provider });
      const s = await sync(w);
      assert.deepEqual([s.checked, s.mailbox.state, s.mailbox.reason, s.mailbox.message], [false, "not_available", reason, reason === "send_only" ? C.mailbox.sendOnly : C.mailbox.platformMail]);
      assert.equal(w.imap.stats.opened, 0);
    }
    const off = hotelWorld({ reading: false });
    assert.equal((await sync(off)).mailbox.state, "off");
  });
});

describe("what a check lists (A10, A11) and how", () => {
  test("HMS's own mail (X-HMS-Kind) is never listed, in Inbox or Sent, and never opened; account-security mail is never listed; bulk mail goes to Other", async () => {
    const w = hotelWorld();
    put(w, "sent", rawMail({ from: MAILBOX, to: ["guest@guest.in"], subject: "Reset your password", date: w.clock.now, text: "https://hms.example/reset?token=SECRET", headers: { "X-HMS-Kind": "reset_link" } }));
    put(w, "inbox", rawMail({ from: MAILBOX, to: [MAILBOX], subject: "Daily summary", date: w.clock.now, headers: { "X-HMS-Kind": "daily_summary" } }));
    put(w, "inbox", rawMail({ from: "no-reply@accounts.google.com", to: [MAILBOX], subject: "Security alert", date: w.clock.now }));
    put(w, "inbox", rawMail({ from: "noreply@bank.example", to: [MAILBOX], subject: "Your OTP is 448812", date: w.clock.now, headers: { "Auto-Submitted": "auto-generated" } }));
    put(w, "inbox", guestMail({ from: "news@offers.example", subject: "Diwali offers", headers: { "List-Unsubscribe": "<https://offers.example/u>" } }));
    put(w, "inbox", guestMail({ from: "asha@guest.in" }));
    const r = await sync(w);
    assert.equal(r.added, 2);
    const texts = JSON.stringify(w.data());
    for (const never of ["Reset your password", "SECRET", "Daily summary", "Security alert", "448812"]) assert.ok(!texts.includes(never), never);
    const boxes = Object.fromEntries(w.data().convConversations.map((c) => [w.data().convHandles.find((h) => h.contactId === c.contactId)?.value, c.box]));
    assert.deepEqual(boxes, { "news@offers.example": "other", "asha@guest.in": "main" });
    // an HMS mail is refused even when a stored entry points at it
    const asha = messages(w).find((m) => m.fromAddr === "asha@guest.in")!;
    const found = w.imap.inbox.messages.find((m) => m.uid === asha.mailUid)!;
    found.raw = rawMail({ messageId: asha.externalId, from: "asha@guest.in", to: [MAILBOX], subject: "x", date: asha.sentAt, headers: { "X-HMS-Kind": "bill_invoice" } });
    await assert.rejects(w.service.emailBody(admin, asha.conversationId, asha.id, { images: false }), (e: unknown) => code(e) === "NOT_FOUND" && (e as Error).message === C.email.gone);
  });

  test("Sent: only a Conversations reply or an answer to a message already in the hub is listed (a Gmail-side reply to a hub thread is; a new mail from Gmail is not)", async () => {
    const w = hotelWorld({ fileSent: false });
    const first = guestMail({ from: "asha@guest.in", messageId: "<q1@guest.in>" });
    put(w, "inbox", first);
    await sync(w);
    put(w, "sent", rawMail({ from: MAILBOX, to: ["asha@guest.in"], subject: "Re: Booking question", date: w.clock.now, inReplyTo: "<q1@guest.in>", references: ["<q1@guest.in>"] }));
    put(w, "sent", rawMail({ from: MAILBOX, to: ["supplier@vendor.in"], subject: "Order of towels", date: w.clock.now }));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 1);
    const out = messages(w).find((m) => m.direction === "out")!;
    assert.deepEqual([out.sentFrom, out.toAddrs], ["mailbox", ["asha@guest.in"]]);
    assert.ok(!JSON.stringify(w.data()).includes("towels"));
  });

  test("a reply sent from Gmail to an email first read in the SAME check is listed (the Inbox entries of the batch count as known)", async () => {
    const w = hotelWorld({ fileSent: false });
    await sync(w);
    put(w, "inbox", guestMail({ from: "asha@guest.in", messageId: "<same1@guest.in>" }));
    put(w, "sent", rawMail({ from: MAILBOX, to: ["asha@guest.in"], subject: "Re: Booking question", date: w.clock.now, inReplyTo: "<same1@guest.in>", references: ["<same1@guest.in>"] }));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 2);
    assert.deepEqual(messages(w).map((m) => m.direction).sort(), ["in", "out"]);
    assert.equal(w.data().convConversations[0].lastDirection, "out", "answered: not waiting for a reply");
  });

  test("bounces and automatic replies to HMS mail are never listed; a listed email that carries a copy of HMS mail inside it is never opened, and message/rfc822 parts are never served", async () => {
    const w = hotelWorld();
    const reset = rawMail({ messageId: "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>", from: MAILBOX, to: ["owner@hotel.example"], subject: "Reset your password", date: w.clock.now, text: "https://hms.example/reset?token=SECRET", headers: { "X-HMS-Kind": "reset_link" } });
    const dsn = Buffer.from([
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>", `To: ${MAILBOX}`, "Subject: Delivery Status Notification (Failure)", `Date: ${w.clock.now.toUTCString()}`, "Message-ID: <dsn1@google.com>", "MIME-Version: 1.0",
      "Content-Type: multipart/report; report-type=delivery-status; boundary=\"r1\"", "", "--r1", "Content-Type: text/plain", "", "Address not found", "--r1", "Content-Type: message/rfc822", "", reset.toString("latin1"), "--r1--", "",
    ].join("\r\n"), "latin1");
    put(w, "inbox", dsn);
    put(w, "inbox", guestMail({ from: "owner@hotel.example", subject: "Automatic reply: Reset your password", inReplyTo: "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>", text: "I am away. > https://hms.example/reset?token=SECRET", headers: { "Auto-Submitted": "auto-replied" } }));
    put(w, "inbox", guestMail({ from: "asha@guest.in", messageId: "<fw1@guest.in>" }));
    assert.equal((await sync(w)).added, 1);
    assert.ok(!JSON.stringify(w.data()).includes("SECRET"));
    // the listed email is later found to carry a forwarded copy of HMS mail: refused when opened
    const asha = messages(w)[0];
    const found = w.imap.inbox.messages.find((m) => m.uid === asha.mailUid)!;
    found.raw = Buffer.from([
      "Message-ID: <fw1@guest.in>", "From: <asha@guest.in>", `To: ${MAILBOX}`, "Subject: Fwd: Reset", `Date: ${asha.sentAt.toUTCString()}`, "MIME-Version: 1.0", "Content-Type: multipart/mixed; boundary=\"m1\"", "",
      "--m1", "Content-Type: text/plain", "", "See below", "--m1", "Content-Type: message/rfc822", "Content-Disposition: attachment; filename=\"fwd.eml\"", "", reset.toString("latin1"), "--m1--", "",
    ].join("\r\n"), "latin1");
    await assert.rejects(w.service.emailBody(admin, asha.conversationId, asha.id, { images: false }), (e: unknown) => code(e) === "NOT_FOUND");
    await assert.rejects(w.service.attachment(admin, asha.conversationId, asha.id, 0), (e: unknown) => code(e) === "NOT_FOUND");
  });

  test("an inbound email is dated by the mailbox's own server, not by the sender's Date header (never in the future, never 1970)", async () => {
    const w = hotelWorld();
    const received = new Date(w.clock.now.getTime() - 120_000);
    put(w, "inbox", guestMail({ from: "old@guest.in", date: new Date("2019-01-01T00:00:00Z") }), received);
    put(w, "inbox", guestMail({ from: "future@guest.in", date: new Date("2099-01-01T00:00:00Z") }), received);
    await sync(w);
    for (const m of messages(w)) assert.equal(m.sentAt.toISOString(), received.toISOString(), m.fromAddr ?? "");
  });

  test("a backlog is read in bounded windows: each check asks the server for a limited UID range, never 'n:*'", async () => {
    const w = hotelWorld();
    await sync(w);
    for (let i = 0; i < 260; i += 1) put(w, "inbox", guestMail({ from: `bulk${i}@guest.in` }));
    later(w, 60_000);
    w.imap.stats.ranges.length = 0;
    assert.equal((await sync(w)).added, 100);
    assert.ok(w.imap.stats.ranges.length > 0 && w.imap.stats.ranges.every((r) => /^\d+:\d+$/.test(r) && Number(r.split(":")[1]) - Number(r.split(":")[0]) < 200), w.imap.stats.ranges.join(" "));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 100);
    later(w, 60_000);
    assert.equal((await sync(w)).added, 60);
  });

  test("one Message-ID in Inbox and Sent in one check is one row; a different sender reusing it is kept apart under its own id, never merged", async () => {
    const w = hotelWorld({ fileSent: false });
    put(w, "inbox", guestMail({ from: "asha@guest.in", messageId: "<q2@guest.in>" }));
    await sync(w);
    const reply = rawMail({ messageId: "<r2@gmail.com>", from: MAILBOX, to: ["asha@guest.in", MAILBOX], subject: "Re: Booking question", date: w.clock.now, inReplyTo: "<q2@guest.in>" });
    put(w, "sent", reply);
    put(w, "inbox", reply);
    put(w, "inbox", guestMail({ from: "evil@attacker.example", messageId: "<r2@gmail.com>", subject: "Pay here" }));
    later(w, 60_000);
    assert.equal((await sync(w)).added, 2);
    const same = messages(w).filter((m) => m.externalId === "<r2@gmail.com>");
    assert.deepEqual(same.map((m) => [m.direction, m.mailFolder]), [["out", "sent"]]);
    const apart = messages(w).find((m) => m.fromAddr === "evil@attacker.example")!;
    assert.match(apart.externalId, /^uid:inbox:\d+:\d+$/);
  });

  test("a reused Message-ID never takes over an HMS reply: the HMS row binds only to our own Sent copy and still opens it", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in", messageId: "<q3@guest.in>" }));
    await sync(w);
    const conv = w.data().convConversations[0];
    const sent = await w.service.reply(admin, conv.id, { channel: "email", text: "Your room is ready." }, { traceId: "t1", ip: null });
    const hmsRow = messages(w).find((m) => m.id === sent.id)!;
    put(w, "inbox", guestMail({ from: "evil@attacker.example", messageId: hmsRow.externalId, subject: "Pay here" }));
    later(w, 60_000);
    await sync(w);
    const bound = messages(w).find((m) => m.id === sent.id)!;
    assert.deepEqual([bound.mailFolder, bound.mailUid !== null, bound.fromAddr], ["sent", true, MAILBOX]);
    assert.match(messages(w).find((m) => m.fromAddr === "evil@attacker.example")!.externalId, /^uid:inbox:/);
    const body = await w.service.emailBody(admin, conv.id, sent.id, { images: false });
    assert.match(body.text, /Your room is ready/);
  });

  test("opening after the UIDs were renumbered finds the email by its Message-ID only when From and Date still match; after a mailbox address change it is refused", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in", messageId: "<q4@guest.in>", text: "Is breakfast included?" }), new Date("2026-10-24T09:00:00Z"));
    await sync(w);
    const m = messages(w)[0];
    w.imap.renumber("inbox");
    assert.match((await w.service.emailBody(admin, m.conversationId, m.id, { images: false })).text, /breakfast/);
    w.imap.inbox.messages[0].raw = guestMail({ from: "evil@attacker.example", messageId: "<q4@guest.in>", text: "Pay here" });
    w.imap.renumber("inbox");
    await assert.rejects(w.service.emailBody(admin, m.conversationId, m.id, { images: false }), (e: unknown) => (e as Error).message === C.email.gone);
    w.settings(HOTEL_A, { "email.username": "frontdesk@gmail.com" });
    await assert.rejects(w.service.emailBody(admin, m.conversationId, m.id, { images: false }), (e: unknown) => (e as Error).message === C.email.earlierMailbox);
  });
});

describe("replies", () => {
  test("threading: to the From (not the Reply-To), Re: once, In-Reply-To and the last 20 References, our own Message-ID and the X-HMS marks; Gmail files it itself (no APPEND)", async () => {
    const w = hotelWorld();
    const refs = Array.from({ length: 25 }, (_, i) => `<old${i}@guest.in>`);
    put(w, "inbox", guestMail({ from: "asha@guest.in", replyTo: "asha.other@guest.in", messageId: "<q5@guest.in>", subject: "Re: Booking question", references: refs }));
    await sync(w);
    const conv = w.data().convConversations[0];
    const thread = await w.service.thread(admin, conv.id);
    assert.deepEqual(thread.replyTo, { address: "asha@guest.in", differsFrom: "asha.other@guest.in" });
    await w.service.reply(admin, conv.id, { channel: "email", text: "See you soon." }, { traceId: "t", ip: null });
    const h = headersOf(w.smtp.sent[0].raw);
    assert.deepEqual([h.to, h.subject, h["in-reply-to"], h["x-hms-kind"], h["x-hms-conversation"]], ["asha@guest.in", "Re: Booking question", "<q5@guest.in>", "conversation", conv.id]);
    const references = h.references.split(/\s+/);
    assert.equal(references.length, 20);
    assert.equal(references.at(-1), "<q5@guest.in>");
    assert.match(h["message-id"], /^<[0-9a-f-]{36}@gmail\.com>$/);
    assert.deepEqual(w.smtp.sent[0].envelope, { from: MAILBOX, to: ["asha@guest.in"] });
    assert.equal(w.imap.stats.appended, 0, "Gmail files what it sends");
    const out = messages(w).find((m) => m.direction === "out")!;
    assert.deepEqual([out.sentBy, out.sentFrom, out.mailBox, out.preview], [STAFF.admin, "hms", MAILBOX, "See you soon."]);
  });

  test("the Reply-To is used only when chosen on purpose; any other address is refused; header injection in Cc is refused", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in", replyTo: "asha.other@guest.in" }));
    await sync(w);
    const id = w.data().convConversations[0].id;
    const meta = { traceId: "t", ip: null };
    await assert.rejects(w.service.reply(editor, id, { channel: "email", text: "x", to: "someone@else.in" }, meta), (e: unknown) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(w.service.reply(editor, id, { channel: "email", text: "x", cc: ["a@b.in\r\nBcc: evil@x.in"] }, meta), (e: unknown) => code(e) === "VALIDATION_FAILED");
    await w.service.reply(editor, id, { channel: "email", text: "x", to: "asha.other@guest.in" }, meta);
    assert.deepEqual(w.smtp.sent.at(-1)?.envelope.to, ["asha.other@guest.in"]);
    await assert.rejects(composeReply({ from: MAILBOX }, { to: "a@b.in", cc: [], subject: "x\r\nBcc: evil@x.in", text: "t", references: [], messageId: "<a@b>", conversationId: id, bill: false }), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
  });

  test("Cc and Bcc the way Gmail does it: Cc is a header everyone sees; Bcc is delivered through the envelope and is in no header; bad or too many are refused", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const base = { to: "asha@guest.in", subject: "Hi", text: "t", references: [], messageId: "<a@b.in>", conversationId: id, bill: false };
    const { raw, envelope } = await composeReply({ from: MAILBOX }, { ...base, cc: ["boss@hotel.in"], bcc: ["owner@hotel.in"] });
    const head = raw.toString("utf8").split(/\r?\n\r?\n/)[0];
    assert.match(head, /^Cc: boss@hotel\.in$/m, "the Cc is a header");
    assert.ok(!/owner@hotel\.in/i.test(head) && !/^Bcc:/im.test(head), "the Bcc is in no header");
    assert.deepEqual(envelope.to, ["asha@guest.in", "boss@hotel.in", "owner@hotel.in"], "all three are delivered");
    for (const bcc of [["not an address"], ["1@b.in", "2@b.in", "3@b.in", "4@b.in", "5@b.in", "6@b.in"]]) await assert.rejects(composeReply({ from: MAILBOX }, { ...base, cc: [], bcc }), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
  });

  test("a bill PDF: only with the Bills right, only the linked stay's own bill, only to a linked guest's own address (never to a Reply-To or an unlinked sender)", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in", replyTo: "pay@attacker.example" }));
    await sync(w);
    const id = w.data().convConversations[0].id;
    const meta = { traceId: "t", ip: null };
    const billId = "00000000-0000-4000-8000-00000000b111";
    const otherBill = "00000000-0000-4000-8000-00000000b222";
    const stayId = "00000000-0000-4000-8000-00000000d111";
    w.data().bills.push({ id: billId, billNumber: "B-1", deletedAt: null, totalHotelAmountPaise: 100000, totalFoodAmountPaise: 0 } as never, { id: otherBill, billNumber: "B-2", deletedAt: null, totalHotelAmountPaise: 200000, totalFoodAmountPaise: 0 } as never);
    w.data().stays.push({ id: stayId, guestName: "Asha Rao", email: "asha@guest.in", mobile: null, status: "in_house", checkInAt: new Date("2026-10-23T08:00:00Z"), roomId: "00000000-0000-4000-8000-00000000e111", billId, expectedCheckOut: "2026-10-26", checkOutAt: null } as never);
    await assert.rejects(w.service.reply(admin, id, { channel: "email", text: "Your bill", billId }, meta), (e: unknown) => (e as Error).message === C.errors.billOwn, "not linked");
    w.data().convContacts[0].link = { kind: "customer", id: "00000000-0000-4000-8000-00000000c111", source: "manual" };
    await assert.rejects(w.service.reply(admin, id, { channel: "email", text: "Your bill", billId }, meta), (e: unknown) => (e as Error).message === C.errors.billOwn, "a customer link has no bill of its own");
    w.data().convContacts[0].link = { kind: "stay", id: stayId, source: "manual" };
    await assert.rejects(w.service.reply(editor, id, { channel: "email", text: "Your bill", billId }, meta), (e: unknown) => (e as Error).message === C.errors.billLocked, "no Bills right");
    await assert.rejects(w.service.reply(admin, id, { channel: "email", text: "Your bill", billId, to: "pay@attacker.example" }, meta), (e: unknown) => (e as Error).message === C.errors.billOwn, "the Reply-To");
    await assert.rejects(w.service.reply(admin, id, { channel: "email", text: "Your bill", billId: otherBill }, meta), (e: unknown) => (e as Error).message === C.errors.billOwn, "another guest's bill");
    assert.equal(w.smtp.sent.length, 0);
    await w.service.reply(admin, id, { channel: "email", text: "Your bill", billId }, meta);
    const raw = w.smtp.sent.at(-1)!.raw.toString("latin1");
    assert.match(raw, /^X-HMS-Bill: 1$/im);
    assert.match(raw, /Bill-B-1\.pdf/);
    assert.equal(messages(w).find((m) => m.hasBill)?.toAddrs[0], "asha@guest.in");
  });

  test("a reply a mail check already read from Sent (between the send and the record) is completed with who sent it, not refused; another row of that id is never taken over", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in" }));
    await sync(w);
    const conv = w.data().convConversations[0];
    const id = "<0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@gmail.com>";
    const entry = { channel: "email" as const, direction: "out" as const, externalId: id, sentAt: w.clock.now, person: "asha@guest.in", personName: null, from: MAILBOX, replyTo: null, to: ["asha@guest.in"], cc: [], subject: "Re: x", preview: "Hello", hasAttachments: true, inReplyTo: null, references: [], box: "main" as const, senderVerified: null, sentFrom: "hms" as const, status: "sent" as const, hmsConversation: conv.id, mail: { folder: "sent" as const, uid: 9, uidValidity: 1, mailbox: MAILBOX } };
    await w.hotel.unit.run(admin, (r) => r.conversations.ingest([entry], { mailbox: MAILBOX }, r.matcher, w.clock.now));
    const record = { channel: "email" as const, externalId: id, sentAt: w.clock.now, sentBy: STAFF.admin, status: "sent" as const, preview: "Hello", mailBox: MAILBOX, subject: "Re: x", fromAddr: MAILBOX, toAddrs: ["asha@guest.in"], ccAddrs: [], inReplyTo: null, referenceIds: [], hasAttachments: true, hasBill: true };
    const row = await w.hotel.unit.run(admin, (r) => r.conversations.recordOutgoing(conv.id, record));
    assert.deepEqual([row.sentBy, row.hasBill, messages(w).filter((m) => m.externalId === id).length], [STAFF.admin, true, 1]);
    const inbound = messages(w).find((m) => m.direction === "in")!;
    await assert.rejects(w.hotel.unit.run(admin, (r) => r.conversations.recordOutgoing(conv.id, { ...record, externalId: inbound.externalId })));
    assert.equal(messages(w).find((m) => m.id === inbound.id)?.sentBy, null);
  });

  test("another mail server: APPEND to Sent only when the server did not file the reply itself (never twice)", async () => {
    const plain = hotelWorld({ provider: "smtp", fileSent: false });
    put(plain, "inbox", guestMail({ from: "asha@guest.in", to: ["desk@hotel.example"] }));
    await sync(plain);
    await plain.service.reply(admin, plain.data().convConversations[0].id, { channel: "email", text: "Hello" }, { traceId: "t", ip: null });
    assert.equal(plain.imap.stats.appended, 1);
    assert.equal(plain.imap.sent.messages.length, 1);
    const filing = hotelWorld({ provider: "smtp", fileSent: true });
    put(filing, "inbox", guestMail({ from: "asha@guest.in", to: ["desk@hotel.example"] }));
    await sync(filing);
    await filing.service.reply(admin, filing.data().convConversations[0].id, { channel: "email", text: "Hello" }, { traceId: "t", ip: null });
    assert.deepEqual([filing.imap.stats.appended, filing.imap.sent.messages.length], [0, 1]);
    assert.ok(filing.imap.stats.messageIdSearches.length >= 1, "it looked first");
  });

  test("a send that fails answers one fixed sentence: never the server's words, the login or the password; nothing is recorded", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in" }));
    await sync(w);
    w.smtp.fail(Object.assign(new Error("535-5.7.8 Username and Password not accepted desk@gmail.com abcdefghijklmnop"), { code: "EAUTH", responseCode: 535 }));
    const e = await w.service.reply(admin, w.data().convConversations[0].id, { channel: "email", text: "Hello" }, { traceId: "t", ip: null }).then(() => null, (x: unknown) => x as Error & { code?: string });
    assert.equal(e?.code, "CONFLICT");
    assert.equal(e?.message, C.errors.sendFailed.replace("{reason}", MAIL_FAILURE_TEXT.AUTH));
    assert.ok(!messages(w).some((m) => m.direction === "out"));
    assert.ok(!JSON.stringify(w.logs).includes("abcdefghijklmnop"));
  });

  test("every mail HMS sends carries X-HMS-Kind (the outbox kind; 'system' when none or a malformed one), so reading a mailbox never lists it", async () => {
    const seen: Record<string, string>[] = [];
    const sender = createSmtpSender({ host: "smtp.gmail.com", port: 587, security: "starttls", user: MAILBOX, pass: "p", from: MAILBOX }, { createTransport: () => ({ sendMail: async (m) => void seen.push(m.headers ?? {}), close: () => undefined }) });
    await sender.send({ to: "guest@guest.in", subject: "Reset", text: "x", kind: "reset_link" });
    await sender.send({ to: "guest@guest.in", subject: "Note", text: "x" });
    await sender.send({ to: "guest@guest.in", subject: "Odd", text: "x", kind: "Bad Kind\r\nBcc: x" });
    await sender.send({ to: "guest@guest.in", subject: "News", text: "x", kind: "campaign", headers: { "List-Unsubscribe": "<https://hms.example/u/1>" } });
    sender.close();
    assert.deepEqual(seen.map((h) => h["X-HMS-Kind"]), ["reset_link", "system", "system", "campaign"]);
    assert.equal(seen[3]["List-Unsubscribe"], "<https://hms.example/u/1>");
  });

  test("WhatsApp replies answer 'not connected yet' (409); every IMAP failure code has its fixed sentence", async () => {
    const w = hotelWorld();
    put(w, "inbox", guestMail({ from: "asha@guest.in" }));
    await sync(w);
    await assert.rejects(w.service.reply(admin, w.data().convConversations[0].id, { channel: "whatsapp", text: "Hi" }, { traceId: "t", ip: null }), (e: unknown) => code(e) === "CONFLICT");
    for (const [k, v] of Object.entries(IMAP_FAILURE_TEXT)) assert.ok(v.length > 10 && !/\{|\}/.test(v), k);
  });
});
