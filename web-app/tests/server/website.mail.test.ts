// The mail to a guest when the front desk confirms or cancels a website enquiry: it goes through the platform outbox (the real SiteMail over the memory outbox),
// says who, what and when, is wiped by the worker after sending, and can never undo or block the decision. The route answers say what happened to the mail.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { outboxSiteMail } from "../../src/server/compose/website";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import type { SiteEnquiryRecord } from "../../src/server/repos/website";
import { renderMail, runOutboxOnce, type MailSender } from "../../src/server/services/auth/mail";

const NOW = new Date("2026-10-05T10:00:00Z");
const enquiry = (over: Partial<SiteEnquiryRecord> = {}): SiteEnquiryRecord =>
  ({ id: "e1", reference: "HP-05102026-00001", name: "Asha Rao", email: "Asha.Rao@Example.com", phone: "9876543210", roomId: "r1", checkIn: "2026-11-02", checkOut: "2026-11-04", decisionNote: "Fully booked that week", ...over }) as SiteEnquiryRecord;
const info = { hotelName: "Hotel Sunrise", roomName: "Deluxe Room" };

describe("the enquiry mail", () => {
  test("a confirmation is queued in the outbox for the guest's address (lower-cased), with no account behind it, and reads plainly", async () => {
    const auth = createMemoryAuth();
    const mail = outboxSiteMail({ unit: auth.unit, now: () => NOW });
    assert.equal(await mail.enquiryConfirmed("h1", enquiry(), info), "queued");
    const row = auth.data().outbox[0];
    assert.deepEqual([row.kind, row.toEmail, row.userId, row.status, row.template], ["enquiry_confirmed", "asha.rao@example.com", null, "pending", "enquiry-confirmed"]);
    const text = renderMail("enquiry_confirmed", JSON.parse(row.payload as string)).text;
    assert.match(text, /Hello Asha Rao,/);
    assert.match(text, /Hotel Sunrise has confirmed your booking\./);
    assert.match(text, /Reference: HP-05102026-00001/);
    assert.match(text, /Room: Deluxe Room/);
    assert.match(text, /Check-in: Mon, 02 Nov 2026\nCheck-out: Wed, 04 Nov 2026\nNights: 2/);
  });

  test("a cancellation carries the reason the front desk wrote; with none it says to call", async () => {
    const auth = createMemoryAuth();
    const mail = outboxSiteMail({ unit: auth.unit, now: () => NOW });
    assert.equal(await mail.enquiryDeclined("h1", enquiry(), info), "queued");
    assert.equal(await mail.enquiryDeclined("h1", enquiry({ decisionNote: null }), info), "queued");
    const [a, b] = auth.data().outbox.map((o) => renderMail("enquiry_declined", JSON.parse(o.payload as string)).text);
    assert.match(a, /Reason: Fully booked that week/);
    assert.match(b, /Call us or reply to this email/);
    assert.equal(renderMail("enquiry_declined", { name: "A" }).subject, "We cannot confirm your booking request");
    assert.equal(renderMail("enquiry_declined", { name: "A", checkIn: "2026-11-02", checkOut: "2026-11-04" }).subject, "We cannot confirm your booking request for 02-04 Nov");
  });

  test("no address, or one that is not an address: nothing is queued and the answer says no_email", async () => {
    const auth = createMemoryAuth();
    const mail = outboxSiteMail({ unit: auth.unit, now: () => NOW });
    for (const email of [null, "", "   ", "not-an-address", `${"a".repeat(250)}@x.in`]) assert.equal(await mail.enquiryConfirmed("h1", enquiry({ email } as Partial<SiteEnquiryRecord>), info), "no_email", String(email));
    assert.equal(auth.data().outbox.length, 0);
  });

  test("a queue that fails is `failed` and reported, never thrown at the person who decided", async () => {
    const reports: string[] = [];
    const down = () => Promise.reject(new Error("platform database is down"));
    const broken: PlatformUnit = { run: down, read: down };
    const mail = outboxSiteMail({ unit: broken, now: () => NOW, report: (m) => void reports.push(m) });
    assert.equal(await mail.enquiryConfirmed("h1", enquiry(), info), "failed");
    assert.equal(await mail.enquiryDeclined("h1", enquiry(), info), "failed");
    assert.equal(reports.length, 2);
  });

  test("the worker sends it and wipes the payload (the guest's name and stay are not kept)", async () => {
    const auth = createMemoryAuth();
    await outboxSiteMail({ unit: auth.unit, now: () => NOW }).enquiryConfirmed("h1", enquiry(), info);
    const sent: { to: string; subject: string; text: string }[] = [];
    const sender: MailSender = { send: async (m) => void sent.push(m) };
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender, now: () => NOW }), 1);
    assert.deepEqual([sent[0].to, sent[0].subject], ["asha.rao@example.com", "Booking confirmed: 02-04 Nov, Deluxe Room"]);
    assert.deepEqual([auth.data().outbox[0].status, auth.data().outbox[0].payload], ["sent", null]);
  });
});
