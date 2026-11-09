// Mail that reaches HMS through Amazon SES receiving (src/server/mail/inbound.ts, services/mail/inboundService.ts; MJ, 1 Nov 2026). What must hold: an SES "Received" notice becomes one hub
// entry (sender, recipients, subject, a short preview without the quoted reply, the thread ids); a message SES marked as spam or a virus, a mail server's report, mail HMS made itself and
// a message without a sender are left out; a message with no usable Message-ID gets one from SES's id, so a repeat is not taken twice; the hotel is the one the address belongs to; an
// address of no hotel is left alone.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { entryOfInbound, sesInboundOf } from "../../src/server/mail/inbound";
import { createInboundMailService, type InboundMailPorts } from "../../src/server/services/mail/inboundService";

const NOW = new Date("2026-11-01T12:00:00Z");

const raw = (over: { from?: string; subject?: string; messageId?: string | null; extra?: string[]; body?: string; contentType?: string } = {}): string =>
  [
    `From: ${over.from ?? "Asha Mehta <asha@guest.in>"}`,
    "To: hotelsunrise@easyhotelsolutions.in",
    "Cc: front@guest.in",
    `Subject: ${over.subject ?? "Late check-out?"}`,
    ...(over.messageId === null ? [] : [`Message-ID: ${over.messageId ?? "<abc123@guest.in>"}`]),
    "In-Reply-To: <hms.out1@mail.hms>",
    "References: <hms.out0@mail.hms> <hms.out1@mail.hms>",
    "Date: Sun, 01 Nov 2026 11:59:00 +0000",
    "MIME-Version: 1.0",
    `Content-Type: ${over.contentType ?? "text/plain; charset=utf-8"}`,
    ...(over.extra ?? []),
    "",
    over.body ?? "Hello, can we leave at 2 pm?\n\nOn Sun, 1 Nov 2026, Hotel Sunrise wrote:\n> Your room is ready.",
  ].join("\r\n");

const notice = (content: string, over: Record<string, unknown> = {}, receipt: Record<string, unknown> = {}) => ({
  notificationType: "Received",
  mail: { timestamp: "2026-11-01T11:59:30.000Z", messageId: "ses0001abcd", destination: ["hotelsunrise@easyhotelsolutions.in"] },
  receipt: { recipients: ["HotelSunrise@EasyHotelSolutions.in"], spamVerdict: { status: "PASS" }, virusVerdict: { status: "PASS" }, spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" }, ...receipt },
  content,
  ...over,
});

describe("reading an SES notice", () => {
  test("a Received notice: the SES id, the recipients in lower case, the verdicts and the raw message", () => {
    const n = sesInboundOf(notice(raw()));
    assert.equal(n?.sesMessageId, "ses0001abcd");
    assert.deepEqual(n?.recipients, ["hotelsunrise@easyhotelsolutions.in"]);
    assert.deepEqual([n?.spamFailed, n?.virusFailed, n?.verified], [false, false, true]);
    assert.equal(n?.at?.toISOString(), "2026-11-01T11:59:30.000Z");
    assert.ok(n?.raw.length);
  });

  test("anything else is not a received mail: a test notice, a bounce, no content, a bad id", () => {
    assert.equal(sesInboundOf({ notificationType: "AmazonSnsSubscriptionSucceeded" }), null);
    assert.equal(sesInboundOf({ notificationType: "Bounce", mail: { messageId: "x" } }), null);
    assert.equal(sesInboundOf(notice("")), null);
    assert.equal(sesInboundOf(notice(raw(), { mail: { messageId: "bad id with spaces" } })), null);
    assert.equal(sesInboundOf("text"), null);
    assert.equal(sesInboundOf(null), null);
  });

  test("the sender is verified when SPF or DKIM passed, not verified when both failed, unknown otherwise", () => {
    assert.equal(sesInboundOf(notice(raw(), {}, { spfVerdict: { status: "FAIL" }, dkimVerdict: { status: "PASS" } }))?.verified, true);
    assert.equal(sesInboundOf(notice(raw(), {}, { spfVerdict: { status: "FAIL" }, dkimVerdict: { status: "FAIL" } }))?.verified, false);
    assert.equal(sesInboundOf(notice(raw(), {}, { spfVerdict: { status: "GRAY" }, dkimVerdict: { status: "GRAY" } }))?.verified, null);
  });
});

describe("a received message as a hub entry", () => {
  const entryOf = async (content: string, over: Record<string, unknown> = {}, receipt: Record<string, unknown> = {}) => {
    const n = sesInboundOf(notice(content, over, receipt));
    assert.ok(n);
    return entryOfInbound(n, NOW);
  };

  test("the sender, the recipients, the subject, the preview without the quoted reply, the thread ids", async () => {
    const r = await entryOf(raw());
    assert.ok("entry" in r);
    const e = (r as { entry: InboundEntry }).entry;
    assert.deepEqual([e.channel, e.direction, e.status, e.sentFrom, e.box, e.senderVerified], ["email", "in", "received", "contact", "main", true]);
    assert.deepEqual([e.externalId, e.person, e.personName, e.from, e.subject], ["<abc123@guest.in>", "asha@guest.in", "Asha Mehta", "asha@guest.in", "Late check-out?"]);
    assert.deepEqual([e.to, e.cc], [["hotelsunrise@easyhotelsolutions.in"], ["front@guest.in"]]);
    assert.equal(e.preview, "Hello, can we leave at 2 pm?");
    assert.deepEqual([e.inReplyTo, e.references], ["<hms.out1@mail.hms>", ["<hms.out0@mail.hms>", "<hms.out1@mail.hms>"]]);
    assert.equal(e.sentAt.toISOString(), "2026-11-01T11:59:30.000Z");
    assert.equal(e.hasAttachments, false);
  });

  test("no Message-ID: SES's id stands in for it, so the same message is the same row", async () => {
    const a = await entryOf(raw({ messageId: null }));
    const b = await entryOf(raw({ messageId: null }));
    assert.equal((a as { entry: InboundEntry }).entry.externalId, "<ses-ses0001abcd@hms.inbound>");
    assert.equal((b as { entry: InboundEntry }).entry.externalId, "<ses-ses0001abcd@hms.inbound>");
  });

  test("an attachment is noticed", async () => {
    const mixed = ["Content-Type: multipart/mixed; boundary=XX", "", "--XX", "Content-Type: text/plain", "", "See the file.", "--XX", "Content-Type: application/pdf; name=a.pdf", "Content-Disposition: attachment; filename=a.pdf", "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQK", "--XX--", ""].join("\r\n");
    const head = ["From: asha@guest.in", "To: hotelsunrise@easyhotelsolutions.in", "Subject: Id proof", "Message-ID: <m2@guest.in>", "MIME-Version: 1.0"].join("\r\n");
    const r = await entryOf(`${head}\r\n${mixed}`);
    assert.equal((r as { entry: InboundEntry }).entry.hasAttachments, true);
  });

  test("left out: spam, a virus, a mail server's report, mail HMS made, a message without a sender, rubbish", async () => {
    assert.deepEqual(await entryOf(raw(), {}, { spamVerdict: { status: "FAIL" } }), { skip: "spam" });
    assert.deepEqual(await entryOf(raw(), {}, { virusVerdict: { status: "FAIL" } }), { skip: "virus" });
    assert.deepEqual(await entryOf(raw({ from: "MAILER-DAEMON@amazonses.com", subject: "Delivery failure" })), { skip: "report" });
    assert.deepEqual(await entryOf(raw({ contentType: "multipart/report; report-type=delivery-status; boundary=B", body: "--B--" })), { skip: "report" });
    assert.deepEqual(await entryOf(raw({ extra: ["X-HMS-Kind: bill_invoice"] })), { skip: "hms" });
    assert.deepEqual(await entryOf(raw({ from: "undisclosed-recipients:;" })), { skip: "no_sender" });
  });
});

describe("the hotel it belongs to", () => {
  const harness = (hotels: Record<string, string[]>) => {
    const delivered: { hotelId: string; subject: string | null }[] = [];
    const seen = new Set<string>();
    const ports: InboundMailPorts = {
      hotelsOf: async (recipients) => Object.entries(hotels).filter(([, addresses]) => addresses.some((a) => recipients.includes(a))).map(([id]) => id),
      deliver: async (hotelId, entries) => {
        let added = 0;
        for (const e of entries) {
          const key = `${hotelId}|${e.externalId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          added += 1;
          delivered.push({ hotelId, subject: e.subject });
        }
        return { added };
      },
    };
    return { service: createInboundMailService({ ports, now: () => NOW }), delivered };
  };

  test("the hotel of the address takes the mail", async () => {
    const h = harness({ "hotel-1": ["hotelsunrise@easyhotelsolutions.in"], "hotel-2": ["gir@easyhotelsolutions.in"] });
    const out = await h.service.receive(notice(raw()));
    assert.deepEqual([out.recognised, out.hotels, out.added, out.skipped, out.noHotel], [true, 1, 1, null, false]);
    assert.deepEqual(h.delivered, [{ hotelId: "hotel-1", subject: "Late check-out?" }]);
  });

  test("a mail to two hotels goes to both; a repeat of the same notice adds nothing", async () => {
    const h = harness({ "hotel-1": ["a@d.in"], "hotel-2": ["b@d.in"] });
    const n = notice(raw(), {}, { recipients: ["a@d.in", "b@d.in"] });
    assert.equal((await h.service.receive(n)).added, 2);
    const again = await h.service.receive(n);
    assert.deepEqual([again.hotels, again.added], [2, 0]);
  });

  test("a group's own address goes to that group's own inbox (platform 0166), with the whole email; a hotel's still goes to the hotel", async () => {
    const delivered: { to: string; source: number }[] = [];
    const ports: InboundMailPorts = {
      hotelsOf: async (r) => (r.includes("demohotelanand@easyhotelsolutions.in") ? ["hotel-1"] : []),
      deliver: async (id, entries, sources) => (delivered.push({ to: `hotel:${id}`, source: sources.get(entries[0]?.externalId ?? "")?.byteLength ?? 0 }), { added: 1 }),
      groupsOf: async (r) => (r.includes("lakegroup@easyhotelsolutions.in") ? ["group-1"] : []),
      deliverGroup: async (id, entries, sources) => (delivered.push({ to: `group:${id}`, source: sources.get(entries[0]?.externalId ?? "")?.byteLength ?? 0 }), { added: 1 }),
    };
    const service = createInboundMailService({ ports, now: () => NOW });
    const g = await service.receive(notice(raw(), {}, { recipients: ["lakegroup@easyhotelsolutions.in"] }));
    assert.deepEqual([g.hotels, g.groups, g.added, g.noHotel], [0, 1, 1, false]);
    const both = await service.receive(notice(raw({ messageId: "<both@guest.in>" }), {}, { recipients: ["lakegroup@easyhotelsolutions.in", "demohotelanand@easyhotelsolutions.in"] }));
    assert.deepEqual([both.hotels, both.groups, both.added], [1, 1, 2]);
    assert.deepEqual(delivered.map((d) => d.to), ["group:group-1", "hotel:hotel-1", "group:group-1"]);
    assert.ok(delivered.every((d) => d.source > 0), "the whole email goes with each delivery");
  });

  test("sales@ and support@ of the platform go to the platform's own inbox with their desk and the whole email; info@ is still for no hotel", async () => {
    const delivered: { desk: string; source: number }[] = [];
    const ports: InboundMailPorts = {
      hotelsOf: async () => [],
      deliver: async () => assert.fail("no hotel takes a desk's mail"),
      deskOf: async (r) => (r.includes("sales@easyhotelsolutions.in") ? "Sales" : r.includes("support@easyhotelsolutions.in") ? "Support" : null),
      deliverPlatform: async (entries, sources, desk) => (delivered.push({ desk, source: sources.get(entries[0]?.externalId ?? "")?.byteLength ?? 0 }), { added: 1 }),
    };
    const service = createInboundMailService({ ports, now: () => NOW });
    const sales = await service.receive(notice(raw(), {}, { recipients: ["Sales@EasyHotelSolutions.in"] }));
    assert.deepEqual([sales.hotels, sales.groups, sales.platform, sales.added, sales.noHotel], [0, 0, 1, 1, false]);
    const support = await service.receive(notice(raw({ messageId: "<s2@guest.in>" }), {}, { recipients: ["support@easyhotelsolutions.in"] }));
    assert.deepEqual([support.platform, support.noHotel], [1, false]);
    const info = await service.receive(notice(raw({ messageId: "<s3@guest.in>" }), {}, { recipients: ["info@easyhotelsolutions.in"] }));
    assert.deepEqual([info.platform, info.added, info.noHotel], [0, 0, true]);
    assert.deepEqual(delivered.map((d) => d.desk), ["Sales", "Support"]);
    assert.ok(delivered.every((d) => d.source > 0), "the whole email goes with it");
  });

  test("an address of no hotel is left alone; a report, spam or a test notice does nothing", async () => {
    const h = harness({ "hotel-1": ["hotelsunrise@easyhotelsolutions.in"] });
    const none = await h.service.receive(notice(raw(), {}, { recipients: ["info@easyhotelsolutions.in"] }));
    assert.deepEqual([none.recognised, none.noHotel, none.added], [true, true, 0]);
    assert.equal((await h.service.receive(notice(raw(), {}, { spamVerdict: { status: "FAIL" } }))).skipped, "spam");
    assert.equal((await h.service.receive({ notificationType: "AmazonSnsSubscriptionSucceeded" })).recognised, false);
    assert.deepEqual(h.delivered, []);
  });
});
