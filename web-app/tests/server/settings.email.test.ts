// A hotel's Settings > Email (decision of 17 Oct 2026: the SAME fields as the platform's mail settings, one shared mail module): the fields and their validation, the password stored
// ENCRYPTED and never returned or logged, a legacy plain password sealed at the next save, "Send test email" with the exact result and the last result kept, the status the page
// shows (platform email in use, last failed mail, an unreadable password), and Super Admin only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { isSealedSmtpSecret, openSmtpSecret, sealSmtpSecret, type TransportFactory } from "../../src/server/mail/smtp";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { createSettingsService } from "../../src/server/services/admin/settingsService";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { domainOfAddress, type DnsLookup } from "../../src/server/mail/identity";
import { identityView, lookupIdentity } from "../../src/server/services/platform/identityCore";
import type { HotelIdentityPort } from "../../src/server/services/admin/settingsService";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";
import { ConversationsNotReady } from "../../src/server/repos/conversations";
import { platformSetupSession } from "../../src/server/auth/secretSettings";
import { createFakeImap, createFakeSmtp, PUBLIC_LOOKUP } from "./helpers/conversations";

const KEY = randomBytes(32);
const PASSWORD = "abcdefghijklmnop";
const META = { traceId: "trace-1", ip: "10.0.0.1" };
const people = new Map<string, Person>([["u1", { id: "u1", name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
// the hotel's mail server is set up by the platform's Super Admin from the Set-up centre (MJ, 5 Nov 2026): the set-up session pointed at hotel A
const superA = platformSetupSession(makeSession({ userId: "u1", hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }), HOTEL_A);
const hotelTop = makeSession({ userId: "u1", hotelId: HOTEL_A, client: "web", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] });
const adminA = makeSession({ userId: "u2", hotelId: HOTEL_A, client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] });
let hotel = createMemoryHotel();
let failure: { code: string; at: Date } | null;
let made: Record<string, unknown>[];
let sentMail: { from: string; to: string; subject: string; replyTo?: string }[];
let transportError: Error | null;

const createTransport: TransportFactory = (o) => {
  made.push(o);
  return {
    async sendMail(m) {
      if (transportError) throw transportError;
      sentMail.push(m);
      return {};
    },
    close: () => undefined,
  };
};
const service = (key: Buffer | null = KEY) =>
  createSettingsService({
    unit: hotel.unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-17T10:00:00+05:30"),
    secretKey: key, lastMailFailure: async () => failure, createTransport,
  });
const data = () => hotel.store.dataFor(HOTEL_A);
const fields = async (svc = service()) => Object.fromEntries((await svc.overview(superA, "email")).current.fields.map((f) => [f.key, f]));
const status = async (svc = service()) => (await svc.overview(superA, "email")).current.emailStatus;
const save = (values: Record<string, string | boolean>, svc = service()) => svc.update(superA, "email", { values }, META);
const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; details?: { fields?: Record<string, string> } });
const GMAIL_USER = "front.desk@gmail.com";
const GOOD = { "email.username": "Front.Desk@Gmail.com", "email.from_name": "{hotel}", "email.reply_to": "Help@Sunrise.in" };
const WITH_PASSWORD = { ...GOOD, "email.password": "abcd efgh ijkl mnop" };

beforeEach(() => {
  hotel = createMemoryHotel();
  failure = null;
  made = [];
  sentMail = [];
  transportError = null;
});

describe("the Gmail form", () => {
  test("the form carries every field of every mail service (the page shows the ones the chosen service needs); the password is the one secret", async () => {
    const f = await fields();
    assert.deepEqual(Object.keys(f), ["email.mode", "email.provider", "email.username", "email.password", "email.host", "email.port", "email.encryption", "email.region", "email.from_address", "email.from_name", "email.reply_to", "email.daily_limit", "email.daily_summary_to", "email.imap", "email.imap_host", "email.imap_port"]);
    assert.deepEqual([f["email.mode"].value, f["email.username"].label, f["email.password"].secret, f["email.from_name"].label], ["platform", "Login", true, "Sender name"]);
  });

  test("saving fixes the server (smtp.gmail.com, 587, STARTTLS) and makes the Gmail address the From address; addresses are lower-cased; the status line names the Gmail address", async () => {
    await save(WITH_PASSWORD);
    const rows = Object.fromEntries([...data().appSettings.entries()].map(([k, v]) => [k, v.value]));
    assert.deepEqual([rows["email.host"], rows["email.port"], rows["email.encryption"], rows["email.from_address"], rows["email.username"], rows["email.reply_to"]], ["smtp.gmail.com", "587", "tls", GMAIL_USER, GMAIL_USER, "help@sunrise.in"]);
    const s = await status();
    assert.deepEqual([s?.sendingFrom, s?.otherServer], [{ source: "settings", address: GMAIL_USER, provider: "gmail" }, null]);
  });

  test("any address works as the login (a Workspace address has its own domain); a malformed one is a 422 on that field and nothing is saved", async () => {
    await save({ ...WITH_PASSWORD, "email.username": "desk@sunrisehotel.in" });
    assert.equal((await fields())["email.username"].value, "desk@sunrisehotel.in");
    const bad = async (values: Record<string, string>) => Object.keys((await refused(save({ ...WITH_PASSWORD, ...values })))?.details?.fields ?? {});
    assert.deepEqual(await bad({ "email.username": "not an address" }), ["email.username"]);
    assert.deepEqual(await bad({ "email.reply_to": "nope" }), ["email.reply_to"]);
    assert.deepEqual(await bad({ "email.password": "x".repeat(501) }), ["email.password"]);
  });

  test("a Gmail address needs an app password (saved before or typed now); an empty Gmail address switches the hotel's own mail off", async () => {
    const e = await refused(save(GOOD));
    assert.deepEqual(Object.keys(e?.details?.fields ?? {}), ["email.password"]);
    assert.equal(data().appSettings.get("email.host"), undefined, "nothing was saved");
    await save(WITH_PASSWORD);
    await save({ ...GOOD, "email.reply_to": "other@sunrise.in" });
    assert.equal(data().appSettings.get("email.reply_to")?.value, "other@sunrise.in", "a saved password is enough");
    await save({ "email.username": "", "email.from_name": "{hotel}", "email.reply_to": "" });
    assert.deepEqual([data().appSettings.get("email.host")?.value, data().appSettings.get("email.from_address")?.value, data().appSettings.get("email.password")?.value], ["", "", ""]);
    assert.equal((await status())?.sendingFrom.source, "platform");
  });

  test("Super Admin only", async () => {
    await assert.rejects(service().overview(adminA, "email"), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    await assert.rejects(service().update(adminA, "email", { values: WITH_PASSWORD }, META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    await assert.rejects(service().testEmail(adminA, {}, META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
  });

  test("the hotel's own top role, a visit (even a full one) and an API key never see, change or test the secret groups; the other groups still save (MJ, 5 Nov 2026: the Set-up centre)", async () => {
    const visit = { id: "v1", hotelId: HOTEL_A, hotelName: "Hotel Sunrise", expiresAt: new Date("2026-10-17T11:00:00+05:30"), access: "full" as const, by: "super_admin" as const };
    const key = { id: "k1", name: "Load test", level: "full" as const, scope: "hotel" as const, testMode: true, callsPerMinute: 60, ip: null, newIp: false };
    const visitor = { ...hotelTop, visit };
    const keyed = { ...hotelTop, client: "token" as const, token: key };
    const forbidden = (e: unknown) => (e as { code?: string }).code === "FORBIDDEN";
    for (const who of [hotelTop, visitor, keyed]) {
      for (const group of ["email", "razorpay_hotel", "razorpay_food", "backup"]) await assert.rejects(service().update(who, group, { values: {} }, META), forbidden, group);
      await assert.rejects(service().testEmail(who, {}, META), forbidden);
      await assert.rejects(service().checkDomain(who), forbidden);
      assert.equal((await service().update(who, "general", { values: { "general.site_name": "Sunrise Stay" } }, META)).group.key, "general", "a group without a secret is still saved");
    }
    for (const who of [hotelTop, visitor, keyed]) {
      const seen = await service().overview(who, "email");
      assert.notEqual(seen.current.key, "email", "asking for a secret group shows the first group instead");
      assert.ok(!seen.groups.some((g) => ["email", "razorpay_hotel", "razorpay_food", "backup"].includes(g.key)), "no secret group is listed for a hotel session");
    }
    assert.notEqual((await refused(service().update(superA, "email", { values: {} }, META)))?.code, "FORBIDDEN", "the Super Admin from the Set-up centre is not refused");
  });
});

describe("the app password", () => {
  test("stored ENCRYPTED and bound to this hotel, spaces removed, never returned, never logged; empty keeps; a new one replaces", async () => {
    await save(WITH_PASSWORD);
    const stored = String(data().appSettings.get("email.password")?.value);
    assert.ok(isSealedSmtpSecret(stored) && !stored.includes(PASSWORD));
    assert.equal(openSmtpSecret(KEY, stored, HOTEL_A), PASSWORD);
    assert.throws(() => openSmtpSecret(KEY, stored, HOTEL_B));
    assert.equal(data().appSettings.get("email.password")?.secret, true);
    const f = await fields();
    assert.deepEqual([f["email.password"].set, f["email.password"].value], [true, null]);
    assert.ok(!JSON.stringify(await service().overview(superA, "email")).includes(PASSWORD));
    assert.ok(!JSON.stringify(data().systemLogs).includes(PASSWORD) && !JSON.stringify(data().systemLogs).includes(stored));
    await save({ ...GOOD, "email.password": "" });
    assert.equal(data().appSettings.get("email.password")?.value, stored, "empty = keep");
    await save({ ...GOOD, "email.password": "zyxwvutsrqponmlk" });
    assert.equal(openSmtpSecret(KEY, String(data().appSettings.get("email.password")?.value), HOTEL_A), "zyxwvutsrqponmlk");
  });

  test("a server with no key at all refuses a password with a clear message (422); the other fields would still save", async () => {
    const e = await refused(save(WITH_PASSWORD, service(null)));
    assert.match(String(e?.details?.fields?.["email.password"]), /secret key/);
    assert.equal(data().appSettings.get("email.host"), undefined);
    assert.equal((await status(service(null)))?.canStorePassword, false);
  });

  test("a password saved before encryption existed is still used as it is, and sealed by the next save of Settings > Email", async () => {
    data().appSettings.set("email.username", { key: "email.username", value: GMAIL_USER, secret: false });
    data().appSettings.set("email.host", { key: "email.host", value: "smtp.gmail.com", secret: false });
    data().appSettings.set("email.password", { key: "email.password", value: "an-old-plain-password", secret: true });
    const sent = await service().testEmail(superA, { to: "me@example.com" }, META);
    assert.equal(sent.sent, true);
    assert.deepEqual(made[0].auth, { user: GMAIL_USER, pass: "an-old-plain-password" }, "the legacy value is read");
    await save({ ...GOOD, "email.password": "" });
    const stored = String(data().appSettings.get("email.password")?.value);
    assert.ok(isSealedSmtpSecret(stored));
    assert.equal(openSmtpSecret(KEY, stored, HOTEL_A), "an-old-plain-password");
  });

  test("a password sealed under another key is reported as unreadable and the hotel counts as having no Gmail of its own (its mail goes through the platform email)", async () => {
    await save(WITH_PASSWORD);
    const s = await status(service(randomBytes(32)));
    assert.deepEqual([s?.passwordUnreadable, s?.sendingFrom], [true, { source: "platform", address: null, provider: null }]);
    const e = await service(randomBytes(32)).testEmail(superA, {}, META).then(() => null, (x: unknown) => x as { code?: string; message?: string });
    assert.equal(e?.code, "CONFLICT");
    assert.match(String(e?.message), /cannot be opened/);
  });
});

describe("an older server saved before Gmail-only", () => {
  test("it keeps sending (shown as its provider, other SMTP) until the form is saved; saving the Gmail form replaces it", async () => {
    for (const [k, v] of Object.entries({ "email.host": "smtp.old-provider.in", "email.port": "465", "email.encryption": "ssl", "email.username": "mailer@old-provider.in", "email.from_address": "desk@old-provider.in", "email.from_name": "Old Desk" })) data().appSettings.set(k, { key: k, value: v, secret: false });
    data().appSettings.set("email.password", { key: "email.password", value: sealSmtpSecret(KEY, "old-pass", HOTEL_A), secret: true });
    const s = await status();
    assert.deepEqual([s?.sendingFrom, s?.otherServer, s?.provider, s?.server?.host], [{ source: "settings", address: "desk@old-provider.in", provider: "smtp" }, null, "smtp", "smtp.old-provider.in"]);
    const r = await service().testEmail(superA, { to: "me@example.com" }, META);
    assert.equal(r.sent, true);
    assert.deepEqual([made[0].host, made[0].port, made[0].secure], ["smtp.old-provider.in", 465, true], "the old server still sends");
    await save(WITH_PASSWORD);
    assert.deepEqual([(await status())?.otherServer, data().appSettings.get("email.host")?.value, data().appSettings.get("email.port")?.value, data().appSettings.get("email.from_address")?.value], [null, "smtp.gmail.com", "587", GMAIL_USER]);
  });
});

describe("Send test email", () => {
  test("sends through the saved Gmail with the same sender code a real mail uses, shows the exact result and keeps it as the last test; the address defaults to the Gmail address", async () => {
    await save(WITH_PASSWORD);
    const r = await service().testEmail(superA, { to: " Me@Example.com " }, META);
    assert.deepEqual([r.sent, r.to, r.message], [true, "me@example.com", "Sent"]);
    assert.deepEqual([made[0].host, made[0].port, made[0].secure, made[0].requireTLS, made[0].auth], ["smtp.gmail.com", 587, false, true, { user: GMAIL_USER, pass: PASSWORD }]);
    assert.equal(sentMail[0].from, `"Hotel Pallav" <${GMAIL_USER}>`);
    assert.equal(sentMail[0].replyTo, "help@sunrise.in");
    assert.deepEqual((await status())?.lastTest, { at: r.at, ok: true, message: "Sent" });
    assert.equal((await service().testEmail(superA, {}, META)).to, GMAIL_USER);
  });

  test("a failure shows the server's words with the password and login cut out PLUS the Gmail hint, and is kept as the last test; the log never has them", async () => {
    await save(WITH_PASSWORD);
    transportError = Object.assign(new Error(`535-5.7.8 Username and Password not accepted for ${GMAIL_USER} ${PASSWORD}`), { code: "EAUTH", responseCode: 535, response: `535 login ${GMAIL_USER} ${PASSWORD} refused` });
    const r = await service().testEmail(superA, {}, META);
    assert.equal(r.sent, false);
    assert.ok(!r.message.includes(PASSWORD) && !r.message.includes(GMAIL_USER));
    assert.match(r.message, /EAUTH 535/);
    assert.match(String(r.hint), /APP PASSWORD/);
    assert.match(String(r.hint), /2-step verification/);
    const last = (await status())?.lastTest;
    assert.deepEqual([last?.ok, last?.message, last?.hint], [false, r.message, r.hint]);
    assert.ok(!JSON.stringify(data().systemLogs).includes(PASSWORD));
  });

  test("refusals: not set up (409), a bad address (422)", async () => {
    const notSet = await service().testEmail(superA, {}, META).then(() => null, (x: unknown) => x as { code?: string });
    assert.equal(notSet?.code, "CONFLICT");
    await save(WITH_PASSWORD);
    const bad = await service().testEmail(superA, { to: "nope" }, META).then(() => null, (x: unknown) => x as { code?: string; details?: { fields?: Record<string, string> } });
    assert.deepEqual([bad?.code, Object.keys(bad?.details?.fields ?? {})], ["VALIDATION_FAILED", ["to"]]);
    assert.equal(made.length, 0);
  });
});

describe("what the page shows besides the fields", () => {
  test("nothing saved: the platform email sends; Gmail saved: this hotel's own; the last failed mail is a plain sentence without the address; only the Email page carries it", async () => {
    assert.deepEqual([(await status())?.sendingFrom, (await status())?.lastFailure, (await status())?.lastTest], [{ source: "platform", address: null, provider: null }, null, null]);
    await save(WITH_PASSWORD);
    assert.deepEqual((await status())?.sendingFrom, { source: "settings", address: GMAIL_USER, provider: "gmail" });
    failure = { code: "AUTH", at: new Date("2026-10-17T09:00:00Z") };
    assert.deepEqual((await status())?.lastFailure, { at: "2026-10-17T09:00:00.000Z", text: "The mail server did not accept the login. Check the username and password in Settings > Email." });
    failure = { code: "SOMETHING_ELSE", at: new Date() };
    assert.equal((await status())?.lastFailure, null, "an unknown code shows nothing");
    assert.equal(((await service().overview(superA, "general")).current as { emailStatus?: unknown }).emailStatus, undefined);
  });
});

describe("the mail services (the platform email, Amazon SES, Brevo, Gmail, another SMTP server)", () => {
  const SES = { "email.provider": "ses", "email.username": "AKIAEXAMPLE", "email.password": "ses-smtp-password", "email.from_address": "Desk@Sunrise.in", "email.from_name": "{hotel}" };
  const row = (k: string) => data().appSettings.get(k)?.value;

  test("Amazon SES: the server comes from the region (default Mumbai), the login keeps its case, a From address is required, the SES limits show", async () => {
    const none = await refused(save({ ...SES, "email.from_address": "" }));
    assert.deepEqual(Object.keys(none?.details?.fields ?? {}), ["email.from_address"]);
    await save(SES);
    assert.deepEqual([row("email.provider"), row("email.host"), row("email.port"), row("email.encryption"), row("email.region"), row("email.username"), row("email.from_address")], ["ses", "email-smtp.ap-south-1.amazonaws.com", "587", "tls", "ap-south-1", "AKIAEXAMPLE", "desk@sunrise.in"]);
    const s = await status();
    assert.deepEqual([s?.provider, s?.server, s?.limits, s?.sendingFrom], ["ses", { host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", region: "ap-south-1" }, { perSecond: 14, perDay: 0 }, { source: "settings", address: "desk@sunrise.in", provider: "ses" }]);
    await save({ ...SES, "email.region": "eu-west-1", "email.password": "" });
    assert.equal(row("email.host"), "email-smtp.eu-west-1.amazonaws.com");
    assert.deepEqual(Object.keys((await refused(save({ ...SES, "email.region": "mumbai", "email.password": "" })))?.details?.fields ?? {}), ["email.region"]);
  });

  test("Brevo: the server is fixed; another SMTP server: host, port and security are typed and checked", async () => {
    await save({ ...SES, "email.provider": "brevo", "email.username": "9a1b@smtp-brevo.com", "email.host": "ignored.example.com" });
    assert.deepEqual([row("email.host"), row("email.port"), row("email.region")], ["smtp-relay.brevo.com", "587", ""]);
    const bad = await refused(save({ "email.provider": "smtp", "email.host": "not a host!", "email.username": "u", "email.password": "p", "email.from_address": "a@b.in" }));
    assert.deepEqual(Object.keys(bad?.details?.fields ?? {}), ["email.host"]);
    await save({ "email.provider": "smtp", "email.host": "smtp.postmarkapp.com", "email.port": "465", "email.encryption": "ssl", "email.username": "token", "email.password": "p", "email.from_address": "a@b.in" });
    assert.deepEqual([row("email.host"), row("email.port"), row("email.encryption")], ["smtp.postmarkapp.com", "465", "ssl"]);
    assert.deepEqual([(await status())?.provider, (await status())?.server?.security], ["smtp", "ssl"]);
  });

  test("changing the service needs the new service's password: the old one is never reused", async () => {
    await save(WITH_PASSWORD);
    const e = await refused(save({ ...SES, "email.password": "" }));
    assert.deepEqual(Object.keys(e?.details?.fields ?? {}), ["email.password"]);
    assert.equal(row("email.host"), "smtp.gmail.com", "nothing changed");
    await save(SES);
    assert.equal(row("email.provider"), "ses");
  });

  test("'the platform's email' switches the hotel's own service off: server, login, From address and password go; the name and reply-to stay; the platform sends", async () => {
    await save(SES);
    await save({ "email.mode": "platform", "email.from_name": "{hotel}", "email.reply_to": "help@sunrise.in" });
    assert.deepEqual([row("email.mode"), row("email.host"), row("email.username"), row("email.from_address"), row("email.password"), row("email.reply_to")], ["platform", "", "", "", "", "help@sunrise.in"]);
    const s = await status();
    assert.deepEqual([s?.sendingFrom, s?.provider, s?.server, s?.limits], [{ source: "platform", address: null, provider: null }, null, null, null]);
  });

  test("a hotel's daily limit lowers the day figure and never raises it", async () => {
    await save({ ...WITH_PASSWORD, "email.daily_limit": "300" });
    assert.equal((await status())?.limits?.perDay, 300);
    await save({ ...GOOD, "email.daily_limit": "900" });
    assert.equal((await status())?.limits?.perDay, 500);
    await save({ ...GOOD, "email.daily_limit": "" });
    assert.equal((await status())?.limits?.perDay, 500);
  });

  test("the test email goes through the chosen service with that service's hint on a failure", async () => {
    await save(SES);
    transportError = Object.assign(new Error("535 Authentication Credentials Invalid"), { code: "EAUTH", responseCode: 535 });
    const r = await service().testEmail(superA, { to: "me@example.com" }, META);
    assert.equal(r.sent, false);
    assert.match(String(r.hint), /Amazon SES/);
    assert.deepEqual([made[0].host, made[0].port], ["email-smtp.ap-south-1.amazonaws.com", 587]);
  });
});

describe("the two modes of Settings > Email", () => {
  const row = (k: string) => data().appSettings.get(k)?.value;

  test("nothing saved: mode 'platform' with the hotel's address on the platform's sending domain; saving 'own' makes it 'own'; 'platform' again goes back", async () => {
    const svc = createSettingsService({
      unit: hotel.unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-17T10:00:00+05:30"),
      secretKey: KEY, lastMailFailure: async () => failure, createTransport, platformAddressOf: async () => "grand-hotel@mail.easyhotelsolutions.in",
    });
    const first = (await svc.overview(superA, "email")).current.emailStatus;
    assert.deepEqual([first?.mode, first?.platformAddress, first?.provider], ["platform", "grand-hotel@mail.easyhotelsolutions.in", null]);
    await svc.update(superA, "email", { values: { "email.mode": "own", ...WITH_PASSWORD } }, META);
    const own = (await svc.overview(superA, "email")).current.emailStatus;
    assert.deepEqual([own?.mode, own?.platformAddress, own?.provider, row("email.mode")], ["own", null, "gmail", "own"]);
    await svc.update(superA, "email", { values: { "email.mode": "platform", "email.from_name": "{hotel}" } }, META);
    const back = (await svc.overview(superA, "email")).current.emailStatus;
    assert.deepEqual([back?.mode, back?.sendingFrom.source, row("email.host"), row("email.password")], ["platform", "platform", "", ""]);
  });

  test("a hotel that saved its own Gmail before the choice existed is 'own'; a hotel with nothing saved is 'platform'", async () => {
    assert.equal((await status())?.mode, "platform");
    for (const [k, v] of Object.entries({ "email.host": "smtp.gmail.com", "email.port": "587", "email.encryption": "tls", "email.username": GMAIL_USER, "email.from_address": GMAIL_USER })) data().appSettings.set(k, { key: k, value: v, secret: false });
    data().appSettings.set("email.password", { key: "email.password", value: sealSmtpSecret(KEY, "app-pass", HOTEL_A), secret: true });
    assert.equal((await status())?.mode, "own");
  });
});

describe("secrets are write-only, whichever service", () => {
  const SERVICES: Record<string, Record<string, string>> = {
    gmail: { "email.provider": "gmail", "email.username": "Front.Desk@Gmail.com" },
    brevo: { "email.provider": "brevo", "email.username": "9a1b@smtp-brevo.com", "email.from_address": "desk@sunrise.in" },
    ses: { "email.provider": "ses", "email.username": "AKIAEXAMPLE", "email.from_address": "desk@sunrise.in" },
    smtp: { "email.provider": "smtp", "email.host": "smtp.postmarkapp.com", "email.username": "token", "email.from_address": "desk@sunrise.in" },
  };
  const SECRET = "Zq8-secret-VALUE-1234";

  for (const [name, values] of Object.entries(SERVICES)) {
    test(`${name}: GET answers only set + savedAt; empty keeps; a new one replaces; clear removes; the log carries nothing of it`, async () => {
      await save({ "email.mode": "own", ...values, "email.password": SECRET });
      const sealed = String(data().appSettings.get("email.password")?.value);
      const wire = JSON.stringify(await service().overview(superA, "email"));
      for (const piece of [SECRET, sealed, SECRET.slice(-4), SECRET.slice(0, 4)]) assert.ok(!wire.includes(piece), `${name}: no part of the secret on the wire (${piece.length} chars)`);
      const f = (await fields())["email.password"];
      assert.deepEqual([f.set, f.value, typeof f.savedAt], [true, null, "string"]);
      assert.match(String(f.savedAt), /^\d{4}-\d{2}-\d{2}T/);
      await save({ "email.mode": "own", ...values, "email.password": "" });
      assert.equal(data().appSettings.get("email.password")?.value, sealed, "empty = keep");
      await save({ "email.mode": "own", ...values, "email.password": "Another-Secret-5678" });
      assert.notEqual(data().appSettings.get("email.password")?.value, sealed, "a new one replaces");
      const cleared = await refused(service().update(superA, "email", { values: { "email.mode": "own", ...values, "email.password": "" }, clear: ["email.password"] }, META));
      if (name === "smtp") assert.ok(cleared === null || cleared?.code === "VALIDATION_FAILED");
      else assert.deepEqual(Object.keys(cleared?.details?.fields ?? {}), ["email.password"], "a login needs its password: removing it alone is refused");
      await save({ "email.mode": "platform" });
      assert.equal(data().appSettings.get("email.password")?.value, "", "switching to the platform's mail clears it");
      const logs = JSON.stringify(data().systemLogs);
      for (const piece of [SECRET, "Another-Secret-5678", sealed]) assert.ok(!logs.includes(piece), `${name}: no secret in the system log`);
    });
  }
});

describe("My own domain (sent by the platform)", () => {
  // the identity port over an in-memory platform store (the same view and check code the real port uses)
  const platformAuth = () => createMemoryAuth();
  const TOKENS = ["abcdefghijklmnopqrstuvwxyz1", "abcdefghijklmnopqrstuvwxyz2", "abcdefghijklmnopqrstuvwxyz3"];
  function world() {
    const plat = platformAuth();
    const dns: DnsLookup = { cname: async (n) => (TOKENS.some((t) => n === `${t}._domainkey.grandhotel.in`) ? [`${n.split(".")[0]}.dkim.amazonses.com`] : []), txt: async () => [] };
    const port: HotelIdentityPort = {
      view: (hotelId, name) => plat.unit.run(async (r) => { const rec = await r.identities.get(hotelId); return rec ? identityView(rec, name) : null; }),
      save: (hotelId, address) => plat.unit.run(async (r) => (await r.identities.save(hotelId, { domain: String(domainOfAddress(address)), fromAddress: address })) !== null),
      remove: (hotelId) => plat.unit.run((r) => r.identities.remove(hotelId)),
      check: async (hotelId, name) => {
        const rec = await plat.unit.run((r) => r.identities.get(hotelId));
        if (!rec) return null;
        const patch = await lookupIdentity(rec, dns, new Date("2026-10-18T10:00:00Z"));
        return plat.unit.run(async (r) => { const s = await r.identities.save(hotelId, patch); return s ? identityView(s, name) : null; });
      },
    };
    const svc = createSettingsService({
      unit: hotel.unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-18T10:00:00+05:30"),
      secretKey: KEY, lastMailFailure: async () => null, createTransport, identity: port, platformAddressOf: async () => "hotel-sunrise@mail.easyhotelsolutions.in",
    });
    return { plat, svc };
  }
  const DOMAIN = { "email.mode": "own", "email.provider": "domain", "email.from_address": "Front@GrandHotel.in", "email.from_name": "{hotel}" };
  const row = (k: string) => data().appSettings.get(k)?.value;

  test("choosing it needs only the address on the hotel's domain: no login, no password; the identity is kept on the platform side and shown with its next step", async () => {
    const { plat, svc } = world();
    await svc.update(superA, "email", { values: DOMAIN }, META);
    assert.deepEqual([row("email.mode"), row("email.provider"), row("email.from_address"), row("email.host"), row("email.username"), row("email.password")], ["own", "domain", "front@grandhotel.in", "", "", ""]);
    assert.deepEqual((await plat.unit.run((r) => r.identities.get(HOTEL_A)))?.domain, "grandhotel.in");
    const s = (await svc.overview(superA, "email")).current.emailStatus;
    assert.deepEqual([s?.mode, s?.provider, s?.identity?.domain, s?.identity?.status, s?.sendingFrom], ["own", "domain", "grandhotel.in", "pending", { source: "platform", address: "hotel-sunrise@mail.easyhotelsolutions.in", provider: "domain" }]);
    assert.match(String(s?.identity?.nextStep), /Waiting for the platform to add grandhotel\.in/);
  });

  test("an address that is not on a domain is a 422 on the From address; nothing is saved", async () => {
    const { plat, svc } = world();
    const e = await refused(svc.update(superA, "email", { values: { ...DOMAIN, "email.from_address": "not-an-address" } }, META));
    assert.deepEqual(Object.keys(e?.details?.fields ?? {}), ["email.from_address"]);
    assert.equal(await plat.unit.run((r) => r.identities.get(HOTEL_A)), null);
  });

  test("Check DNS: the hotel runs it; with the DKIM names from the platform and the records in place it stays pending until the platform confirms, then mail goes from the hotel's address", async () => {
    const { plat, svc } = world();
    await svc.update(superA, "email", { values: DOMAIN }, META);
    await plat.unit.run((r) => r.identities.save(HOTEL_A, { dkimTokens: TOKENS }));
    const checked = await svc.checkDomain(superA);
    assert.deepEqual([checked.status, checked.records.slice(0, 3).map((r) => r.state)], ["pending", ["ok", "ok", "ok"]]);
    assert.match(checked.nextStep, /Waiting for the platform to confirm/);
    await plat.unit.run((r) => r.identities.save(HOTEL_A, { sesConfirmed: true }));
    assert.equal((await svc.checkDomain(superA)).status, "verified");
    const s = (await svc.overview(superA, "email")).current.emailStatus;
    assert.deepEqual(s?.sendingFrom, { source: "platform", address: "front@grandhotel.in", provider: "domain" });
  });

  test("choosing anything else drops the domain; Check DNS without one is a plain 409; only the hotel's Super Admin may check", async () => {
    const { plat, svc } = world();
    await svc.update(superA, "email", { values: DOMAIN }, META);
    await svc.update(superA, "email", { values: { "email.mode": "platform" } }, META);
    assert.equal(await plat.unit.run((r) => r.identities.get(HOTEL_A)), null);
    assert.equal((await refused(svc.checkDomain(superA)))?.code, "CONFLICT");
    assert.equal((await refused(svc.checkDomain(adminA)))?.code, "FORBIDDEN");
  });
});

describe("reading the same mailbox for Conversations (decision 66): the IMAP fields, the registry, Test connection", () => {
  const row = (k: string) => data().appSettings.get(k)?.value;
  const OWN = { "email.mode": "own", "email.provider": "smtp", "email.host": "smtp.sunrise.in", "email.port": "587", "email.encryption": "tls", "email.username": "desk@sunrise.in", "email.password": "server-password-1", "email.from_address": "desk@sunrise.in" };
  const withReading = (registry: { setHotelReading(hotelId: string, on: boolean): Promise<void> }, imap = createFakeImap(), smtp = createFakeSmtp()) =>
    createSettingsService({
      unit: hotel.unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-24T10:00:00+05:30"),
      secretKey: KEY, lastMailFailure: async () => null, createTransport: smtp.factory, mailboxRegistry: registry, imap: imap.factory, lookup: PUBLIC_LOOKUP,
    });
  const calls: [string, boolean][] = [];
  const registry = { setHotelReading: async (hotelId: string, on: boolean) => void calls.push([hotelId, on]) };

  test("Gmail: reading on is kept, the IMAP server is Gmail's own (nothing typed is kept); the registry row says on", async () => {
    calls.length = 0;
    await save({ ...WITH_PASSWORD, "email.imap": true, "email.imap_host": "imap.evil.example", "email.imap_port": "143" }, withReading(registry));
    assert.deepEqual([row("email.imap"), row("email.imap_host"), row("email.imap_port")], ["1", "", ""]);
    assert.deepEqual(calls, [[HOTEL_A, true]]);
  });

  test("another mail server: a PUBLIC IMAP server name and port 993 or 143 only (localhost, a bare IP address, a private name and port 25 are refused on save)", async () => {
    const svc = withReading(registry);
    const fieldsOf = async (values: Record<string, string | boolean>) => Object.keys((await refused(save({ ...OWN, "email.imap": true, ...values }, svc)))?.details?.fields ?? {});
    assert.deepEqual(await fieldsOf({ "email.imap_host": "" }), ["email.imap_host"]);
    assert.deepEqual(await fieldsOf({ "email.imap_host": "localhost" }), ["email.imap_host"]);
    assert.deepEqual(await fieldsOf({ "email.imap_host": "10.0.0.1" }), ["email.imap_host"]);
    assert.deepEqual(await fieldsOf({ "email.imap_host": "mail.localhost" }), ["email.imap_host"]);
    assert.deepEqual(await fieldsOf({ "email.imap_host": "imap.sunrise.in", "email.imap_port": "25" }), ["email.imap_port"]);
    assert.equal(row("email.imap"), undefined, "nothing was saved");
    await save({ ...OWN, "email.imap": true, "email.imap_host": "IMAP.Sunrise.in", "email.imap_port": "143" }, svc);
    assert.deepEqual([row("email.imap"), row("email.imap_host"), row("email.imap_port")], ["1", "imap.sunrise.in", "143"]);
  });

  test("a service that only sends (Amazon SES, Brevo, My own domain, the platform's mail) switches reading off; the registry row is kept with 'off'", async () => {
    calls.length = 0;
    await save({ "email.provider": "ses", "email.username": "AKIAEXAMPLE", "email.password": "ses-smtp-password", "email.from_address": "desk@sunrise.in", "email.from_name": "{hotel}", "email.imap": true }, withReading(registry));
    assert.deepEqual([row("email.imap"), calls], ["0", [[HOTEL_A, false]]]);
    await save({ "email.mode": "platform", "email.imap": true }, withReading(registry));
    assert.equal(row("email.imap"), "0");
  });

  test("before platform 0139: switching reading on is a plain 409; saving with reading off still works", async () => {
    const notReady = { setHotelReading: async () => Promise.reject(new ConversationsNotReady()) };
    const e = await refused(save({ ...WITH_PASSWORD, "email.imap": true }, withReading(notReady)));
    assert.equal(e?.code, "CONFLICT");
    assert.match((e as unknown as Error).message, /platform migration 0139/);
    await save({ ...WITH_PASSWORD, "email.imap": false }, withReading(notReady));
    assert.equal(row("email.imap"), "0");
  });

  test("Test connection: IMAP and SMTP with the SAVED settings, fixed sentences and hints only (no password, login or server words), kept as codes; Super Admin in the browser only", async () => {
    const imap = createFakeImap();
    const smtp = createFakeSmtp();
    const svc = withReading(registry, imap, smtp);
    await save({ ...WITH_PASSWORD, "email.imap": false }, svc);
    const ok = await svc.testMailConnection(superA, META);
    assert.deepEqual([ok.imap.ok, ok.imap.message, ok.smtp.ok], [true, "Signed in. Sent folder found.", true]);
    imap.failConnect(Object.assign(new Error("[AUTHENTICATIONFAILED] Invalid credentials for front.desk@gmail.com abcdefghijklmnop imap.gmail.com"), { authenticationFailed: true, responseText: "[AUTHENTICATIONFAILED] Invalid credentials" }));
    smtp.fail(Object.assign(new Error("535-5.7.8 Username and Password not accepted front.desk@gmail.com"), { code: "EAUTH", responseCode: 535 }));
    const bad = await svc.testMailConnection(superA, META);
    assert.deepEqual([bad.imap.ok, bad.imap.code, bad.smtp.ok, bad.smtp.code], [false, "AUTH", false, "AUTH"]);
    assert.match(bad.imap.hint ?? "", /app password/);
    const everything = JSON.stringify([bad, data().appSettings.get("email.connection_test"), data().systemLogs.filter((l) => l.summary === "Mail connection tested")]);
    for (const secret of ["abcdefghijklmnop", "front.desk@gmail.com", "Invalid credentials", "535", "Username and Password"]) assert.ok(!everything.includes(secret), secret);
    assert.deepEqual(JSON.parse(String(data().appSettings.get("email.connection_test")?.value)).imap.code, "AUTH");
    assert.deepEqual(data().systemLogs.filter((l) => l.summary === "Mail connection tested").map((l) => l.details), [{ Outcome: "Passed" }, { Outcome: "Failed" }]);
    assert.deepEqual((await status(svc))?.lastConnectionTest?.imap.code, "AUTH");
    await assert.rejects(svc.testMailConnection(adminA, META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    const visit = { id: "v1", hotelId: HOTEL_A, hotelName: "Hotel Sunrise", expiresAt: new Date("2026-10-24T11:00:00+05:30"), access: "full" as const, by: "super_admin" as const };
    await assert.rejects(svc.testMailConnection({ ...superA, visit }, META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
  });

  test("Test connection with a service that only sends: reading says so in one sentence, sending is still tested", async () => {
    const svc = withReading(registry);
    await save({ "email.provider": "ses", "email.username": "AKIAEXAMPLE", "email.password": "ses-smtp-password", "email.from_address": "desk@sunrise.in", "email.from_name": "{hotel}" }, svc);
    const r = await svc.testMailConnection(superA, META);
    assert.deepEqual([r.imap.ok, r.imap.code, r.imap.message, r.smtp.ok], [false, "SEND_ONLY", "Reading mail needs Gmail or your own mail server.", true]);
  });
});