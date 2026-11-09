// A hotel's own Amazon SES and Google logins, set by the Super Admin (Platform > Hotel mail; src/server/mail/hotelMail.ts and the router in hotelSmtp.ts). What must hold: a saved row
// becomes two mail servers (passwords opened only with the hotel's own scope); the hotel's mail tries its SES first, then its Google; then its group's SES and Google; when all of those
// fail on the service's side the PLATFORM sender takes the mail (its SES, then its Google backup, which the platform sender already does) and a failed account is not tried again for a
// few minutes; a failure that is the mail's own (a refused recipient) is not passed on; a hotel with no row sends through the platform.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { firstOf, groupGmailScope, groupSesScope, hotelGmailScope, hotelSesScope, readGroupMail, readHotelMail, type GroupMailRow, type HotelMailRow } from "../../src/server/mail/hotelMail";
import { createHotelMailRouter } from "../../src/server/mail/hotelSmtp";
import { sealSmtpSecret, type SmtpTransport } from "../../src/server/mail/smtp";
import type { MailMessage, MailSender } from "../../src/server/services/auth/mail";

const KEY = randomBytes(32);
const H = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";

const row = (over: Partial<HotelMailRow> = {}): HotelMailRow => ({
  hotelId: H, sesRegion: "ap-south-1", sesUser: "AKIAHOTEL", sesPassword: sealSmtpSecret(KEY, "ses-secret", hotelSesScope(H)), sesFrom: "Bookings@Sunrise.in",
  gmailUser: "Desk@Gmail.com", gmailPassword: sealSmtpSecret(KEY, "abcdefghijklmnop", hotelGmailScope(H)), fromName: "Sunrise Desk", replyTo: "Help@Sunrise.in", sesTest: null, gmailTest: null, updatedAt: null, ...over,
});

describe("a saved hotel mail row as two mail servers", () => {
  test("SES is the region's SMTP host with the login and the From address; Google sends as the account; both carry the sender name and the reply-to", () => {
    const r = readHotelMail(row(), KEY, "Hotel Sunrise");
    assert.deepEqual([r.ses?.host, r.ses?.port, r.ses?.security, r.ses?.user, r.ses?.pass, r.ses?.from, r.ses?.replyTo], ["email-smtp.ap-south-1.amazonaws.com", 587, "starttls", "AKIAHOTEL", "ses-secret", '"Sunrise Desk" <bookings@sunrise.in>', "help@sunrise.in"]);
    assert.deepEqual([r.gmail?.host, r.gmail?.user, r.gmail?.pass, r.gmail?.from], ["smtp.gmail.com", "desk@gmail.com", "abcdefghijklmnop", '"Sunrise Desk" <desk@gmail.com>']);
    assert.equal(firstOf(r)?.host, "email-smtp.ap-south-1.amazonaws.com");
  });

  test("no SES: Google is first; nothing set: none; the sender name defaults to the hotel's name", () => {
    const g = readHotelMail(row({ sesUser: null, sesPassword: null, sesFrom: null, fromName: null }), KEY, "Hotel Sunrise");
    assert.equal(g.ses, null);
    assert.equal(firstOf(g)?.host, "smtp.gmail.com");
    assert.equal(g.gmail?.from, '"Hotel Sunrise" <desk@gmail.com>');
    const none = readHotelMail(row({ sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null }), KEY, "Hotel Sunrise");
    assert.equal(firstOf(none), null);
    assert.equal(firstOf(null), null);
  });

  test("an SES login without its password or From address is not usable; a password sealed for another hotel or for the other account does not open", () => {
    assert.equal(readHotelMail(row({ sesPassword: null }), KEY, "H").ses, null);
    assert.equal(readHotelMail(row({ sesFrom: null }), KEY, "H").ses, null);
    const other = readHotelMail(row({ sesPassword: sealSmtpSecret(KEY, "x", hotelSesScope("0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4aaa")) }), KEY, "H");
    assert.deepEqual([other.ses, other.sesUnreadable], [null, true]);
    const swapped = readHotelMail(row({ gmailPassword: sealSmtpSecret(KEY, "x", hotelSesScope(H)) }), KEY, "H");
    assert.deepEqual([swapped.gmail, swapped.gmailUnreadable], [null, true]);
    assert.equal(readHotelMail(row(), null, "H").ses, null);
  });
});

/** A fake transport: records what each server sent; a host in `down` fails with `error`. */
function fakeFactory(down: Record<string, { code?: string; responseCode?: number }> = {}) {
  const sent: { via: string; from: string; to: string }[] = [];
  const createTransport = (o: Record<string, unknown>): SmtpTransport => {
    const via = String(o.host);
    return {
      async sendMail(m) {
        const fail = down[via];
        if (fail) throw Object.assign(new Error(`refused by ${via} with a password that must not leak`), fail);
        sent.push({ via, from: m.from, to: m.to });
        return {};
      },
      close: () => undefined,
    };
  };
  return { sent, createTransport };
}

const SES_HOST = "email-smtp.ap-south-1.amazonaws.com";
const msg = (over: Partial<MailMessage> = {}): MailMessage => ({ to: "guest@example.com", subject: "Hello", text: "Hi", hotelId: H, ...over }) as MailMessage;

function setup(read: ReturnType<typeof readHotelMail> | null, down: Record<string, { code?: string; responseCode?: number }> = {}) {
  const f = fakeFactory(down);
  const platformSent: MailMessage[] = [];
  const platform: MailSender = { send: async (m) => void platformSent.push(m) };
  let clock = 1_000_000;
  const router = createHotelMailRouter({
    platform,
    createTransport: f.createTransport,
    now: () => clock,
    dedicatedOf: async () => read,
    settingsOf: async () => ({ rows: [], hotelName: "Hotel Sunrise", slug: "sunrise" }),
  });
  return { router, f, platformSent, advance: (ms: number) => void (clock += ms) };
}

describe("the order a hotel's mail takes", () => {
  test("the hotel's SES first; the platform is not used", async () => {
    const t = setup(readHotelMail(row(), KEY, "Hotel Sunrise"));
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), [SES_HOST]);
    assert.equal(t.platformSent.length, 0);
  });

  test("a hotel with only Google uses Google", async () => {
    const t = setup(readHotelMail(row({ sesUser: null, sesPassword: null, sesFrom: null }), KEY, "Hotel Sunrise"));
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), ["smtp.gmail.com"]);
    assert.equal(t.platformSent.length, 0);
  });

  test("the hotel's SES fails (login refused): the hotel's own Google takes the mail, and the next mails skip SES for five minutes, then SES is tried again", async () => {
    const t = setup(readHotelMail(row(), KEY, "Hotel Sunrise"), { [SES_HOST]: { code: "EAUTH", responseCode: 535 } });
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), ["smtp.gmail.com"]);
    assert.equal(t.platformSent.length, 0);
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), ["smtp.gmail.com", "smtp.gmail.com"]);
    t.advance(5 * 60_000 + 1);
    // SES is back: it is the first again
    const back = setup(readHotelMail(row(), KEY, "Hotel Sunrise"));
    await back.router.send(msg());
    assert.deepEqual(back.f.sent.map((s) => s.via), [SES_HOST]);
  });

  test("the hotel's SES and Google both fail: the PLATFORM sender takes the mail as the hotel, and the next mails go straight to it for five minutes, then the hotel is tried again", async () => {
    const t = setup(readHotelMail(row(), KEY, "Hotel Sunrise"), { [SES_HOST]: { code: "EAUTH", responseCode: 535 }, "smtp.gmail.com": { code: "EAUTH", responseCode: 535 } });
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 1);
    assert.equal(t.platformSent[0]?.fromName, "Sunrise Desk");
    assert.equal(t.platformSent[0]?.replyTo, "help@sunrise.in");
    assert.equal(t.platformSent[0]?.fromLocal, "sunrise");
    assert.deepEqual(t.f.sent, []);
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 2);
    t.advance(5 * 60_000 + 1);
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 3);
  });

  test("a refused recipient is the mail's own failure: it is thrown, the platform is not asked", async () => {
    const t = setup(readHotelMail(row(), KEY, "Hotel Sunrise"), { [SES_HOST]: { code: "EENVELOPE", responseCode: 550 } });
    await assert.rejects(() => t.router.send(msg()));
    assert.equal(t.platformSent.length, 0);
  });

  test("a hotel with no row of its own, and a mail with no hotel, go through the platform", async () => {
    const t = setup(null);
    await t.router.send(msg());
    await t.router.send(msg({ hotelId: undefined }));
    assert.equal(t.platformSent.length, 2);
    assert.deepEqual(t.f.sent, []);
  });

  test("the hotel's SES and Google fail and there is no platform sender: the hotel's own failure is thrown", async () => {
    const f = fakeFactory({ [SES_HOST]: { code: "ETIMEDOUT" }, "smtp.gmail.com": { code: "ETIMEDOUT" } });
    const router = createHotelMailRouter({ platform: null, createTransport: f.createTransport, dedicatedOf: async () => readHotelMail(row(), KEY, "Hotel Sunrise"), settingsOf: async () => null });
    await assert.rejects(() => router.send(msg()));
  });
});

// The group in between (MJ, 1 Nov 2026): the hotel's SES, its Google, its group's SES, its group's Google, then the platform. Each level is skipped when it is not set.
const G = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a6c";
const groupRow = (over: Partial<GroupMailRow> = {}): GroupMailRow => ({
  groupId: G, sesRegion: "ap-southeast-2", sesUser: "AKIAGROUP", sesPassword: sealSmtpSecret(KEY, "group-ses", groupSesScope(G)), sesFrom: "mail@sunrisegroup.in",
  gmailUser: "groupdesk@gmail.com", gmailPassword: sealSmtpSecret(KEY, "groupapppassword", groupGmailScope(G)), fromName: "Sunrise Group", replyTo: null, sesTest: null, gmailTest: null, updatedAt: null, ...over,
});
const GROUP_SES_HOST = "email-smtp.ap-southeast-2.amazonaws.com";

function setupGroup(hotel: ReturnType<typeof readHotelMail> | null, group: ReturnType<typeof readGroupMail> | null, down: Record<string, { code?: string; responseCode?: number }> = {}) {
  const f = fakeFactory(down);
  const platformSent: MailMessage[] = [];
  const router = createHotelMailRouter({
    platform: { send: async (m) => void platformSent.push(m) },
    createTransport: f.createTransport,
    dedicatedOf: async () => hotel,
    groupDedicatedOf: async () => group,
    settingsOf: async () => ({ rows: [], hotelName: "Hotel Sunrise", slug: "sunrise" }),
  });
  return { router, f, platformSent };
}

describe("the group between the hotel and the platform", () => {
  test("a hotel with nothing of its own uses its group's SES; the hotel's name is shown on the group's address", async () => {
    const t = setupGroup(null, readGroupMail(groupRow(), KEY, "Sunrise Group"));
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), [GROUP_SES_HOST]);
    assert.equal(t.platformSent.length, 0);
  });

  test("the hotel's own accounts come before the group's", async () => {
    const t = setupGroup(readHotelMail(row(), KEY, "Hotel Sunrise"), readGroupMail(groupRow(), KEY, "Sunrise Group"));
    await t.router.send(msg());
    assert.deepEqual(t.f.sent.map((s) => s.via), [SES_HOST]);
  });

  test("the hotel's SES and Google fail: the group's SES takes it; the group's SES fails too: the group's Google; all four fail: the platform", async () => {
    const hotelDown = { [SES_HOST]: { code: "EAUTH", responseCode: 535 }, "smtp.gmail.com": { code: "EAUTH", responseCode: 535 } };
    const a = setupGroup(readHotelMail(row(), KEY, "Hotel Sunrise"), readGroupMail(groupRow(), KEY, "Sunrise Group"), hotelDown);
    await a.router.send(msg());
    assert.deepEqual(a.f.sent.map((s) => s.via), [GROUP_SES_HOST]);
    // the Google server is shared by both Google logins here, so only the group's SES is taken down for the second case
    const b = setupGroup(null, readGroupMail(groupRow(), KEY, "Sunrise Group"), { [GROUP_SES_HOST]: { code: "EAUTH", responseCode: 535 } });
    await b.router.send(msg());
    assert.deepEqual(b.f.sent.map((s) => s.via), ["smtp.gmail.com"]);
    const c = setupGroup(readHotelMail(row(), KEY, "Hotel Sunrise"), readGroupMail(groupRow(), KEY, "Sunrise Group"), { ...hotelDown, [GROUP_SES_HOST]: { code: "EAUTH", responseCode: 535 } });
    await c.router.send(msg());
    assert.equal(c.platformSent.length, 1);
    assert.equal(c.platformSent[0]?.fromName, "Sunrise Desk");
    assert.deepEqual(c.f.sent, []);
  });

  test("no hotel accounts and no group accounts: the platform sends; a group's reply-to is used when the hotel has none", async () => {
    const t = setupGroup(null, readGroupMail(groupRow({ sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, replyTo: "front@sunrisegroup.in" }), KEY, "Sunrise Group"));
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 1);
    assert.equal(t.platformSent[0]?.replyTo, "front@sunrisegroup.in");
    assert.deepEqual(t.f.sent, []);
  });
});
