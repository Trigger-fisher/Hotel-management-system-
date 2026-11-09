// Conversations, who really sent an email (decision 66, A12): a sender is "verified" only when the hotel's own receiving server says so in the TOPMOST Authentication-Results
// header (dmarc=pass, or SPF and DKIM both passing for a domain aligned with the From). A forged From is never linked to a guest automatically, carries the "Unverified
// sender" mark, and a reply still goes to the From (never quietly to a Reply-To an attacker added).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { headerItemOf } from "../../src/server/mail/imap";
import { alignedDomains, classifyInbound, classifySent, isSecuritySender, parseAuthResults } from "../../src/server/mail/inboxRules";
import { guestMail, hotelWorld, itemOfRaw, MAILBOX, rawMail, STAFF } from "./helpers/conversations";
import { makeSession } from "./helpers/session";

const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });

describe("parseAuthResults (the topmost header only)", () => {
  test("dmarc=pass is enough; SPF and DKIM must both pass and be aligned; SPF alone, or a DKIM of another domain, is not", () => {
    const G = "imap.gmail.com";
    assert.equal(parseAuthResults("mx.google.com; dmarc=pass (p=NONE) header.from=guest.in", "guest.in", G), true);
    assert.equal(parseAuthResults("mx.google.com; dkim=pass header.i=@guest.in; spf=pass smtp.mailfrom=asha@guest.in", "guest.in", G), true);
    assert.equal(parseAuthResults("mx.google.com; dkim=pass header.d=mail.guest.in; spf=pass smtp.mailfrom=bounce.guest.in", "guest.in", G), true, "subdomains align");
    assert.equal(parseAuthResults("mx.google.com; spf=pass smtp.mailfrom=asha@guest.in", "guest.in", G), false, "SPF alone");
    assert.equal(parseAuthResults("mx.google.com; dkim=pass header.d=attacker.example; spf=pass smtp.mailfrom=asha@guest.in", "guest.in", G), false, "a DKIM of another domain");
    assert.equal(parseAuthResults("mx.google.com; dmarc=fail header.from=guest.in; spf=softfail", "guest.in", G), false);
    assert.equal(parseAuthResults("mx.google.com; dmarc=pass header.from=attacker.example", "guest.in", G), false, "dmarc for another From domain");
    assert.equal(parseAuthResults(null, "guest.in", G), false);
  });

  test("the header counts only when its authserv-id is the mailbox's own server (a server that stamps nothing leaves the sender's header on top)", () => {
    assert.equal(parseAuthResults("x; dmarc=pass header.from=guest.in", "guest.in", "imap.gmail.com"), false, "a made-up authserv-id on a Gmail mailbox");
    assert.equal(parseAuthResults("mx.google.com; dmarc=pass header.from=guest.in", "guest.in", "imap.hotel.example"), false, "Google's name on another server");
    assert.equal(parseAuthResults("mx1.hotel.example; dmarc=pass header.from=guest.in", "guest.in", "imap.hotel.example"), true, "the server's own domain");
    assert.equal(parseAuthResults("hotel.example 1; dmarc=pass header.from=guest.in", "guest.in", "imap.hotel.example"), true, "with a version number");
    assert.equal(parseAuthResults("dmarc=pass header.from=guest.in", "guest.in", "imap.hotel.example"), false, "no authserv-id at all");
    assert.deepEqual([alignedDomains("a.guest.in", "guest.in"), alignedDomains("guest.in.evil", "guest.in"), alignedDomains("", "guest.in")], [true, false, false]);
  });

  test("a lower Authentication-Results line written by the sender is ignored: only the topmost (the receiving server's) counts", () => {
    const raw = rawMail({
      from: "asha@guest.in", to: [MAILBOX], subject: "x", date: new Date("2026-10-24T09:00:00Z"),
      headers: { "Authentication-Results": "mx.google.com; spf=none smtp.mailfrom=attacker.example" },
    });
    // the forged line comes AFTER (lower than) the receiving server's own
    const forged = Buffer.concat([raw.subarray(0, raw.indexOf("\r\n\r\n")), Buffer.from("\r\nAuthentication-Results: evil.example; dmarc=pass header.from=guest.in"), raw.subarray(raw.indexOf("\r\n\r\n"))]);
    const item = itemOfRaw(1, forged, new Date());
    assert.equal(parseAuthResults(item.headers.authResults, "guest.in", "imap.gmail.com"), false);
  });
});

describe("the inbox rules", () => {
  test("security senders and code mail are skipped; a mail to itself is skipped; HMS's own kinds are skipped; a Sent item needs X-HMS-Conversation or a known thread", () => {
    const item = (o: Parameters<typeof rawMail>[0]) => itemOfRaw(1, rawMail(o), new Date());
    const base = { to: [MAILBOX], subject: "Hello", date: new Date() };
    assert.equal(isSecuritySender("no-reply@accounts.google.com"), true);
    assert.equal(isSecuritySender("alerts@sub.accountprotection.microsoft.com"), true);
    assert.equal(classifyInbound(item({ ...base, from: "security@facebookmail.com" }), MAILBOX), "skip_security");
    assert.equal(classifyInbound(item({ ...base, from: "noreply@shop.example", subject: "Your verification code is 123456" }), MAILBOX), "skip_security");
    assert.equal(classifyInbound(item({ ...base, from: "alerts@bank.example", subject: "Password reset", headers: { "Auto-Submitted": "auto-generated" } }), MAILBOX), "skip_security");
    assert.equal(classifyInbound(item({ ...base, from: "asha@guest.in", subject: "Can you reset your password policy for the gym?" }), MAILBOX), "main", "a person's own mail with such words is kept");
    assert.equal(classifyInbound(item({ ...base, from: MAILBOX }), MAILBOX), "skip_self");
    assert.equal(classifyInbound(item({ ...base, from: MAILBOX, headers: { "X-HMS-Kind": "invitation" } }), MAILBOX), "skip_hms");
    assert.equal(classifyInbound(item({ ...base, from: "news@shop.example", headers: { Precedence: "bulk" } }), MAILBOX), "other");
    assert.equal(classifyInbound(item({ ...base, from: "mailer-daemon@googlemail.com" }), MAILBOX), "skip_report", "a bounce carries the mail it reports on");
    assert.equal(classifyInbound(item({ ...base, from: "postmaster@hotel.example" }), MAILBOX), "skip_report");
    assert.equal(classifyInbound(item({ ...base, from: "reports@relay.example", headers: { "Content-Type": "multipart/report; report-type=delivery-status; boundary=\"b\"" } }), MAILBOX), "skip_report");
    assert.equal(classifyInbound(item({ ...base, from: "owner@hotel.example", subject: "Automatic reply: Reset your password", inReplyTo: "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>", headers: { "Auto-Submitted": "auto-replied" } }), MAILBOX), "skip_hms", "an auto-reply to HMS mail");
    assert.equal(classifyInbound(item({ ...base, from: "owner@hotel.example", subject: "Out of office", references: ["<a@x.in>", "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>"], headers: { "X-Autoreply": "yes" } }), MAILBOX), "skip_hms", "named in References, X-Autoreply");
    assert.equal(classifyInbound(item({ ...base, from: "asha@guest.in", inReplyTo: "<0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@gmail.com>" }), MAILBOX), "main", "an answer to a Conversations reply is kept");
  });

  test("answers to HMS mail: only a machine's answer (a bounce, an automatic reply) is hidden; weak automatic signals go to Other; a person's reply to an invoice is listed", () => {
    const item = (o: Parameters<typeof rawMail>[0]) => itemOfRaw(1, rawMail(o), new Date());
    const HMS = "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>";
    const reply = { to: [MAILBOX], from: "asha@guest.in", date: new Date(), inReplyTo: HMS, references: [HMS] };
    // a person
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice INV-0042", text: "Paid, see attached." }), MAILBOX), "main", "a guest's own reply to an invoice mail");
    assert.equal(classifyInbound(item({ ...reply, subject: "Out of office? No, I am back. Re: Receipt" }), MAILBOX), "main", "an out-of-office subject alone is not enough");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Receipt", headers: { "Auto-Submitted": "no" } }), MAILBOX), "main", "Auto-Submitted: no is a person");
    // a bounce (DSN): the whole report type, or a top-level message/delivery-status, or a null Return-Path
    assert.equal(classifyInbound(item({ ...reply, from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", headers: { "Content-Type": "multipart/report; report-type=delivery-status; boundary=\"b\"" } }), MAILBOX), "skip_report");
    assert.equal(classifyInbound(item({ ...reply, from: "relay@isp.example", subject: "Undelivered", headers: { "Content-Type": "message/delivery-status" } }), MAILBOX), "skip_report");
    assert.equal(classifyInbound(item({ ...reply, from: "relay@isp.example", subject: "Returned mail", headers: { "Return-Path": "<>" } }), MAILBOX), "skip_report", "a null Return-Path answering HMS mail");
    // RFC 5321: the null reverse-path is only for notices; most bounces name nothing in In-Reply-To or References and quote the mail (a reset link) whole
    assert.equal(classifyInbound(item({ ...reply, from: "mail-delivery@isp.in", subject: "Undeliverable", references: [], inReplyTo: undefined, headers: { "Return-Path": "<>" } }), MAILBOX), "skip_report", "a null Return-Path answering nothing of ours");
    // automatic replies (strong signals)
    assert.equal(classifyInbound(item({ ...reply, subject: "Automatic reply: Your invoice INV-0042", headers: { "Auto-Submitted": "auto-replied" } }), MAILBOX), "skip_hms");
    assert.equal(classifyInbound(item({ ...reply, subject: "Out of Office: Your invoice", headers: { "X-Auto-Response-Suppress": "All" } }), MAILBOX), "skip_hms", "Exchange's out-of-office");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice", headers: { "X-Autorespond": "yes" } }), MAILBOX), "skip_hms");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice", headers: { Precedence: "auto_reply" } }), MAILBOX), "skip_hms");
    assert.equal(classifyInbound(item({ ...reply, subject: "Out of office: Your invoice", headers: { Precedence: "bulk" } }), MAILBOX), "skip_hms", "an out-of-office subject with an auto Precedence");
    // weak signals: a person may still be behind them (a travel desk's helpdesk tool, a list server): Other, never hidden
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice", headers: { Precedence: "junk" } }), MAILBOX), "other");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice", text: "Paid, ref 4471.", headers: { Precedence: "bulk" } }), MAILBOX), "other", "a human reply with Precedence: bulk");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Your invoice [Ticket #8812]", headers: { "Auto-Submitted": "auto-generated" } }), MAILBOX), "other", "a helpdesk agent's reply");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Receipt", headers: { "Auto-Submitted": "no (human)" } }), MAILBOX), "main", "Auto-Submitted: no with a comment is a person");
    assert.equal(classifyInbound(item({ ...reply, subject: "Re: Receipt", headers: { "X-Autoreply": "no" } }), MAILBOX), "main", "X-Autoreply: no is a person");
    assert.equal(classifyInbound(item({ ...reply, subject: "Out of office tomorrow, paid invoice", headers: { Precedence: "list" } }), MAILBOX), "other", "an out-of-office subject with Precedence: list is not an auto-reply");
    assert.equal(classifyInbound(item({ ...reply, subject: "On vacation next week, paid invoice" }), MAILBOX), "main", "words a person types");
    // a reply to a Conversations reply (its Message-ID is not of the outbox shape) is listed, even from an auto-responder (staff see the guest is away)
    assert.equal(classifyInbound(item({ ...reply, inReplyTo: "<0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@gmail.com>", references: ["<0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@gmail.com>"], subject: "Re: Your booking" }), MAILBOX), "main");
  });

  test("the platform mailbox lists no answer to HMS mail, a person's own neither (it quotes a reset link or a sign-in code)", () => {
    const item = (o: Parameters<typeof rawMail>[0]) => itemOfRaw(1, rawMail(o), new Date());
    const HMS = "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>";
    const human = item({ to: [MAILBOX], from: "owner@hotel.example", date: new Date(), inReplyTo: HMS, references: [HMS], subject: "Re: Reset your password", text: "I didn't ask for this.\n\n> https://hms.example/?reset=abc" });
    assert.equal(classifyInbound(human, MAILBOX, { hideHmsAnswers: true }), "skip_hms");
    assert.equal(classifyInbound(human, MAILBOX), "main", "a hotel's mailbox lists it (its HMS mail is invoices and receipts)");
    const plain = item({ to: [MAILBOX], from: "owner@hotel.example", date: new Date(), subject: "A question about my plan" });
    assert.equal(classifyInbound(plain, MAILBOX, { hideHmsAnswers: true }), "main", "mail that answers nothing of ours is listed");
  });

  test("headerItemOf (the real IMAP mapping) reads Return-Path, the auto headers and the report type, from the header or BODYSTRUCTURE", () => {
    const headers = Buffer.from("Return-Path: <>\r\nX-Autoreply: yes\r\nAuto-Submitted: auto-replied\r\nReferences: <a@x.in> <hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>\r\n\r\n", "latin1");
    const it = headerItemOf({ uid: 9, envelope: { subject: "Undelivered", from: [{ address: "Relay@ISP.example", name: "Relay" }] }, headers, bodyStructure: { type: "multipart/report" } as never });
    assert.equal(it.headers.returnPathNull, true);
    assert.equal(it.headers.autoReplyHeader, true);
    assert.equal(it.headers.autoSubmitted, "auto-replied");
    assert.equal(it.headers.contentType, "multipart/report", "the BODYSTRUCTURE type when no Content-Type was fetched");
    assert.deepEqual(it.references, ["<a@x.in>", "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>"]);
    assert.equal(it.envelope.from, "relay@isp.example");
    const human = headerItemOf({ uid: 10, headers: Buffer.from("Return-Path: <asha@guest.in>\r\nX-Autoreply: no\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n", "latin1") });
    assert.deepEqual([human.headers.returnPathNull, human.headers.autoReplyHeader, human.headers.contentType], [false, false, "text/plain"]);
  });

  test("a guest's human reply to an invoice mail is listed and linked to the guest; an out-of-office answer to the same mail is not", async () => {
    const HMS = "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>";
    const w = hotelWorld();
    const d = w.data();
    d.customers.push({ id: "00000000-0000-4000-8000-00000000c001", name: "Asha Rao", mobile: "9825012345", email: "asha@guest.in" } as never);
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in", subject: "Out of office: Your invoice INV-0042", inReplyTo: HMS, references: [HMS], headers: { "Auto-Submitted": "auto-replied" } }), new Date("2026-10-24T09:58:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in", subject: "Re: Your invoice INV-0042", text: "Paid, see attached.", inReplyTo: HMS, references: [HMS] }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    const list = await w.service.list(admin, { tab: "all", channel: "all", page: 1, size: 25 });
    assert.equal(list.items.length, 1);
    const thread = await w.service.thread(admin, list.items[0].id);
    assert.equal(thread.messages.length, 1, "only the person's reply, not the auto-reply");
    assert.deepEqual(d.convContacts[0].link, { kind: "customer", id: "00000000-0000-4000-8000-00000000c001", source: "auto" });
  });

  test("the Sent rules", () => {
    const item = (o: Parameters<typeof rawMail>[0]) => itemOfRaw(1, rawMail(o), new Date());
    const sent = (headers: Record<string, string>, inReplyTo?: string) => item({ from: MAILBOX, to: ["asha@guest.in"], subject: "Re: x", date: new Date(), headers, inReplyTo });
    assert.equal(classifySent(sent({ "X-HMS-Kind": "conversation", "X-HMS-Conversation": "00000000-0000-4000-8000-000000000001" }), new Set()), "ingest");
    assert.equal(classifySent(sent({ "X-HMS-Kind": "reset_link" }), new Set()), "skip");
    assert.equal(classifySent(sent({}, "<q@guest.in>"), new Set(["<q@guest.in>"])), "ingest");
    assert.equal(classifySent(sent({}, "<q@guest.in>"), new Set()), "skip");
  });
});

describe("a forged From in the hub", () => {
  test("not linked automatically, marked unverified, and a reply goes to the From (the attacker's Reply-To only when chosen on purpose)", async () => {
    const w = hotelWorld();
    // a guest the hotel knows: the matcher would link her address to a guest record
    const d = w.data();
    d.customers.push({ id: "00000000-0000-4000-8000-00000000c001", name: "Asha Rao", mobile: "9825012345", email: "asha@guest.in" } as never);
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in", verified: false, replyTo: "asha.pay@attacker.example", subject: "Change my booking" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    assert.equal(d.convContacts[0].link, null, "not linked: the server did not verify the sender");
    const list = await w.service.list(admin, { tab: "all", channel: "all", page: 1, size: 25 });
    assert.equal(list.items[0].unverified, true);
    const thread = await w.service.thread(admin, list.items[0].id);
    assert.deepEqual([thread.links, thread.replyTo], [[], { address: "asha@guest.in", differsFrom: "asha.pay@attacker.example" }]);
    assert.equal((thread.messages[0] as { verified: boolean | null }).verified, false);
    await w.service.reply(admin, thread.id, { channel: "email", text: "Please call the front desk." }, { traceId: "t", ip: null });
    assert.deepEqual(w.smtp.sent[0].envelope.to, ["asha@guest.in"]);
    // the same address, verified this time, from a new contact: linked
    const v = hotelWorld();
    v.data().customers.push({ id: "00000000-0000-4000-8000-00000000c001", name: "Asha Rao", mobile: "9825012345", email: "asha@guest.in" } as never);
    v.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await v.service.sync(admin, {});
    assert.deepEqual(v.data().convContacts[0].link, { kind: "customer", id: "00000000-0000-4000-8000-00000000c001", source: "auto" });
  });
});
