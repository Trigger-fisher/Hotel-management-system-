// The whole email kept in the hotel's own schema (hotel 0053; MJ, 2 Nov 2026: "store full all data in the database, hotel wise, isolated"). What must hold: mail received through Amazon SES
// is kept whole (text, HTML and attachments) with its message and opens with no mailbox at all; its attachment downloads; another hotel never sees it; a reply from a hotel with no mailbox
// goes out through the hotel's own mail with its thread ids and is kept whole too; a hotel with neither a mailbox nor its own mail still cannot reply; the 12-month purge removes the copy
// with its message.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { conversationsCopy } from "@shared/dashboards/conversations";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { entryOfInbound, sesInboundOf } from "../../src/server/mail/inbound";
import { composeReply } from "../../src/server/mail/smtp";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const C = conversationsCopy;
const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const otherHotel = makeSession({ userId: STAFF.admin, hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const code = (e: unknown): string | undefined => (e as { code?: string }).code;
const META = { traceId: "t1", ip: null };

/** A guest's mail as SES hands it over, and its hub entry. */
async function received(o: { attachment?: boolean; text?: string } = {}) {
  const raw = guestMail({
    from: "asha@guest.in",
    to: ["demohotelanand@easyhotelsolutions.in"],
    subject: "Late check-out?",
    text: o.text ?? "Can we leave at 2 pm?\n\nThanks, Asha",
    ...(o.attachment ? { attachments: [{ name: "ID proof.pdf", type: "application/pdf", content: Buffer.from("%PDF-1.4 asha id") }] } : {}),
  });
  const inbound = sesInboundOf({ notificationType: "Received", mail: { messageId: "ses0001abcd", timestamp: "2026-10-24T09:30:00.000Z" }, receipt: { recipients: ["demohotelanand@easyhotelsolutions.in"], spfVerdict: { status: "PASS" } }, content: raw.toString("utf8") });
  assert.ok(inbound);
  const made = await entryOfInbound(inbound, new Date("2026-10-24T10:00:00Z"));
  assert.ok("entry" in made);
  return { raw: inbound.raw, entry: (made as { entry: InboundEntry }).entry };
}

/** The hotel's own mail as the compose root sends it: the fake records each mail and, with `keep`, returns the whole email as sent. */
function hotelMail() {
  const sent: { to: string; subject: string; inReplyTo: string | null | undefined; references: readonly string[] | undefined }[] = [];
  let n = 0;
  const send = async (_hotelId: string, mail: { to: string; subject: string; text: string; inReplyTo?: string | null; references?: readonly string[]; keep?: { conversationId: string; cc: readonly string[] } }) => {
    sent.push({ to: mail.to, subject: mail.subject, inReplyTo: mail.inReplyTo, references: mail.references });
    n += 1;
    const messageId = `<out-${n}@hms.mail>`;
    const sentAt = new Date("2026-10-24T10:05:00Z");
    if (!mail.keep) return { messageId, sentAt };
    const { raw } = await composeReply({ from: "demohotelanand@easyhotelsolutions.in" }, { to: mail.to, cc: mail.keep.cc, subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo ?? null, references: mail.references ?? [], messageId, conversationId: mail.keep.conversationId, bill: false, date: sentAt });
    return { messageId, sentAt, source: raw };
  };
  return { sent, send };
}

describe("a mail received through Amazon SES, kept whole in the hotel's schema", () => {
  test("it opens with no mailbox: the whole text, the sender and the subject", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received({ text: "Can we leave at 2 pm?\n\nThanks, Asha" });
    assert.equal((await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]))).added, 1);
    const m = w.data().convMessages[0];
    assert.ok(m);
    assert.equal(w.data().convMailSources?.length, 1);
    const body = await w.service.emailBody(admin, m.conversationId, m.id, { images: false });
    assert.match(body.text, /Can we leave at 2 pm\?/);
    assert.match(body.text, /Thanks, Asha/);
    assert.equal(body.subject, "Late check-out?");
    assert.equal(body.from, "asha@guest.in");
  });

  test("its attachment is listed and downloads from the stored copy", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received({ attachment: true });
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    const m = w.data().convMessages[0];
    assert.ok(m?.hasAttachments);
    const body = await w.service.emailBody(admin, m.conversationId, m.id, { images: false });
    const pdf = body.attachments.find((a) => a.name === "ID proof.pdf");
    assert.ok(pdf);
    const file = await w.service.attachment(admin, m.conversationId, m.id, pdf.part);
    assert.equal(Buffer.from(file.bytes).toString(), "%PDF-1.4 asha id");
    assert.equal(file.type, "application/pdf");
  });

  test("hotel wise: another hotel neither holds the copy nor can open the message", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received();
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    const m = w.data().convMessages[0];
    assert.ok(m);
    assert.equal(w.data(HOTEL_B).convMailSources?.length ?? 0, 0);
    assert.equal(w.data(HOTEL_B).convMessages.length, 0);
    await assert.rejects(w.service.emailBody(otherHotel, m.conversationId, m.id, { images: false }), (e: unknown) => code(e) === "NOT_FOUND");
  });

  test("the same mail delivered twice is kept once", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received();
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    assert.equal(w.data().convMessages.length, 1);
    assert.equal(w.data().convMailSources?.length, 1);
  });

  test("the 12-month purge removes the copy with its message", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received();
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    await w.service.purgeForWorker(HOTEL_A, new Date("2027-01-01T00:00:00Z"));
    assert.equal(w.data().convMessages.length, 0);
    assert.equal(w.data().convMailSources?.length, 0);
  });
});

describe("a reply from a hotel with no mailbox of its own", () => {
  test("it goes out through the hotel's own mail, in the same thread, and is kept whole so it opens", async () => {
    const mail = hotelMail();
    const w = hotelWorld({ provider: "platform", sendHotelMail: mail.send });
    const { raw, entry } = await received();
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    const guest = w.data().convMessages[0];
    assert.ok(guest);
    const reply = await w.service.reply(admin, guest.conversationId, { channel: "email", text: "Yes, 2 pm is fine." }, META);
    assert.deepEqual(mail.sent.map((s) => [s.to, s.inReplyTo]), [["asha@guest.in", entry.externalId]]);
    assert.match(mail.sent[0]?.subject ?? "", /^Re: Late check-out\?/);
    assert.equal(w.data().convMailSources?.length, 2);
    const body = await w.service.emailBody(admin, guest.conversationId, reply.id, { images: false });
    assert.match(body.text, /Yes, 2 pm is fine\./);
  });

  test("with neither a mailbox nor the hotel's own mail, a reply is refused plainly", async () => {
    const w = hotelWorld({ provider: "platform" });
    const { raw, entry } = await received();
    await w.service.receiveForWorker(HOTEL_A, [entry], new Map([[entry.externalId, raw]]));
    const guest = w.data().convMessages[0];
    assert.ok(guest);
    await assert.rejects(w.service.reply(admin, guest.conversationId, { channel: "email", text: "Hi" }, META), (e: unknown) => code(e) === "CONFLICT" && (e as Error).message === C.errors.noMailbox);
  });
});
