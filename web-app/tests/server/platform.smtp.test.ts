// The Super Admin's platform mail (Platform settings > Mail; migration 0123), Gmail only (MJ, 17 Oct 2026): the form is the Gmail address, its app password, the sender name and a
// reply-to; the server is fixed (smtp.gmail.com, 587, STARTTLS). Validation, the password stored ENCRYPTED and never returned or logged, the test email with its exact result and the
// Gmail hint, Super Admin only, an older server that keeps sending until the form is saved, and the sender: what is SAVED here beats the server's own SMTP_* values, which are used only
// when nothing usable is saved.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createPlatformSettingsSender, readPlatformSmtp } from "../../src/server/mail/platformSmtp";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { GMAIL, openSmtpSecret, sealSmtpSecret, type SmtpConfig, type SmtpTransport } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import type { MailMessage, MailSender } from "../../src/server/services/auth/mail";
import { createSettingsService } from "../../src/server/services/platform/settingsService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const OTHER_KEY = deriveSmtpKey(randomBytes(32));
const PASSWORD = "abcdefghijklmnop";
const SPACED = "abcd efgh ijkl mnop";
const GMAIL_USER = "hotel.desk@gmail.com";
const META = { traceId: "trace-smtp-1", ip: "10.0.0.5", userAgent: "node-test" };
let clock = new Date("2026-10-17T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());

const ids = { sa: randomUUID(), pa: randomUUID() };
let auth: ReturnType<typeof createMemoryAuth>;
let cons: ReturnType<typeof createMemoryPlatformConsole>;
let sent: { smtp: SmtpConfig; to: string }[];
let testAnswer: { ok: boolean; message: string; hint?: string };

function build(secretKey: Buffer | null = KEY) {
  return createSettingsService({
    unit: cons.unit, credentials: () => ({}) as never, now,
    smtp: { secretKey, envFrom: "HMS <env@hms.test>", sendTest: async (smtp, to) => (sent.push({ smtp, to }), testAnswer) },
  });
}
const session = (who: "sa" | "pa") => makeSession({ userId: ids[who], hotelId: "", accountRole: who === "sa" ? "super_admin" : "platform_admin", roleKey: "super_admin", roleLevel: 4 });
const rawRow = (key: string) => cons.data.settings.get(key);
const auditText = (): string => JSON.stringify(cons.data.audit);
const fieldsOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? null)) ?? {}) as Record<string, string>;
const saveGmail = (svc = build(), over: object = {}) => svc.update(session("sa"), { smtp: { user: GMAIL_USER, password: PASSWORD, ...over } }, META);

beforeEach(() => {
  clock = new Date("2026-10-17T10:00:00+05:30");
  auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  for (const [who, role] of [["sa", "super_admin"], ["pa", "platform_admin"]] as const) {
    auth.data().users.push({
      id: ids[who], username: who, email: `${who}@demo.hms`, mobile: null, displayName: who.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null,
      failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId,
    } as never);
  }
  sent = [];
  testAnswer = { ok: true, message: "Sent" };
});

describe("the Gmail form", () => {
  test("defaults: not set up, the server's own mail setup sends; nothing to type about the server", async () => {
    const v = await build().get(session("sa"));
    assert.deepEqual(v.smtp, { user: "", passwordSet: false, canStorePassword: true, passwordUnreadable: false, replyTo: "", otherServer: null, sendingFrom: { source: "server", address: null, provider: null }, lastTest: null, provider: null, server: null, dailyLimit: null, limits: null, lastChangedAt: null, backup: { user: "", passwordSet: false, lastChangedAt: null, passwordUnreadable: false, limits: null, lastTest: null }, failover: { enabled: true, returnMinutes: 15, active: "primary", since: null, events: [] } });
  });

  test("saving the Gmail address and the app password fixes the server (smtp.gmail.com, 587, STARTTLS), lower-cases the address, and the status line names the Gmail address", async () => {
    const v = await build().update(session("sa"), { smtp: { user: "  Hotel.Desk@Gmail.com ", password: PASSWORD, replyTo: " Help@Hotel.IN " } }, META);
    assert.deepEqual(v.smtp, { user: GMAIL_USER, passwordSet: true, canStorePassword: true, passwordUnreadable: false, replyTo: "help@hotel.in", otherServer: null, sendingFrom: { source: "settings", address: GMAIL_USER, provider: "gmail" }, lastTest: null, provider: "gmail", server: { host: "smtp.gmail.com", port: 587, security: "starttls", region: "" }, dailyLimit: null, limits: { perSecond: 1, perDay: 500 }, lastChangedAt: "2026-10-17T04:30:00.000Z", backup: { user: "", passwordSet: false, lastChangedAt: null, passwordUnreadable: false, limits: null, lastTest: null }, failover: { enabled: true, returnMinutes: 15, active: "primary", since: null, events: [] } });
    assert.deepEqual([rawRow("mail.smtp_host")?.value, rawRow("mail.smtp_port")?.value, rawRow("mail.smtp_security")?.value, rawRow("mail.smtp_user")?.value], [GMAIL.host, GMAIL.port, GMAIL.security, GMAIL_USER]);
    assert.equal(cons.data.audit.filter((a) => a.action === "settings_updated").length, 1);
    assert.equal(cons.data.audit[0].reason, "mail server");
    await build().update(session("sa"), { smtp: { user: GMAIL_USER } }, META);
    assert.equal(cons.data.audit.filter((a) => a.action === "settings_updated").length, 1, "no change, no audit row");
  });

  test("any address is allowed as the login (a Google Workspace address has its own domain); a malformed one is a field error", async () => {
    assert.equal((await saveGmail(build(), { user: "frontdesk@sunrisehotel.in" })).smtp.user, "frontdesk@sunrisehotel.in");
    assert.deepEqual(Object.keys(await fieldsOf(saveGmail(build(), { user: "not an address" }))), ["smtpUser"]);
    assert.deepEqual(Object.keys(await fieldsOf(saveGmail(build(), { user: "a@b" }))), ["smtpUser"]);
    assert.deepEqual(Object.keys(await fieldsOf(saveGmail(build(), { user: `${"x".repeat(250)}@gmail.com` }))), ["smtpUser"]);
  });

  test("validation: reply-to, an over-long password, a Gmail address without any app password; nothing is saved", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(session("sa"), { smtp: { user: GMAIL_USER, password: PASSWORD, replyTo: "nope" } }, META))), ["smtpReplyTo"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(session("sa"), { smtp: { user: GMAIL_USER, password: "x".repeat(501) } }, META))), ["smtpPassword"]);
    const none = await fieldsOf(svc.update(session("sa"), { smtp: { user: GMAIL_USER } }, META));
    assert.deepEqual(Object.keys(none), ["smtpPassword"]);
    assert.match(none.smtpPassword, /password/);
    assert.equal(rawRow("mail.smtp_host")?.value, null, "nothing was saved");
  });

  test("an empty Gmail address switches the Gmail account off: the server's own mail setup sends again, and the saved password goes", async () => {
    await saveGmail();
    const off = await build().update(session("sa"), { smtp: { user: "" } }, META);
    assert.deepEqual([off.smtp.user, off.smtp.passwordSet, off.smtp.sendingFrom, rawRow("mail.smtp_host")?.value, rawRow("mail.smtp_password")?.value], ["", false, { source: "server", address: null, provider: null }, null, null]);
  });
});

describe("the app password", () => {
  test("stored ENCRYPTED (v1.iv.tag.data, random IV) and bound to the platform, spaces removed, never returned, never in the audit log; it opens only with the key and the owner", async () => {
    const v = await saveGmail(build(), { password: SPACED });
    assert.equal(v.smtp.passwordSet, true);
    assert.ok(!JSON.stringify(v).includes(PASSWORD) && !JSON.stringify(v).includes(SPACED));
    const stored = rawRow("mail.smtp_password");
    assert.equal(stored?.secret, true);
    assert.match(String(stored?.value), /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(openSmtpSecret(KEY, String(stored?.value), "platform"), PASSWORD, "the spaces Google shows are not part of it");
    assert.throws(() => openSmtpSecret(OTHER_KEY, String(stored?.value), "platform"));
    assert.throws(() => openSmtpSecret(KEY, String(stored?.value), "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b"));
    assert.ok(!auditText().includes(PASSWORD) && !auditText().includes(String(stored?.value)));
    assert.ok(cons.data.audit.some((a) => JSON.stringify(a.after).includes('"passwordSet":true')));
    assert.notEqual(sealSmtpSecret(KEY, PASSWORD, "platform"), sealSmtpSecret(KEY, PASSWORD, "platform"), "a fresh IV every time");
    assert.ok(!(await cons.unit.run((r) => r.settings.all())).some((x) => x.key === "mail.smtp_password"));
  });

  test("leaving it out keeps it, a new one replaces it, 'remove' clears it (and then the Gmail address needs a new one)", async () => {
    const svc = build();
    await saveGmail(svc);
    const first = String(rawRow("mail.smtp_password")?.value);
    assert.equal((await svc.update(session("sa"), { smtp: { replyTo: "help@hotel.in" } }, META)).smtp.passwordSet, true);
    assert.equal(rawRow("mail.smtp_password")?.value, first, "kept");
    assert.equal((await svc.update(session("sa"), { smtp: { user: GMAIL_USER, password: "" } }, META)).smtp.passwordSet, true, "an empty box keeps it");
    await svc.update(session("sa"), { smtp: { password: "zyxwvutsrqponmlk" } }, META);
    assert.equal(openSmtpSecret(KEY, String(rawRow("mail.smtp_password")?.value), "platform"), "zyxwvutsrqponmlk");
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(session("sa"), { smtp: { user: GMAIL_USER, clearPassword: true } }, META))), ["smtpPassword"]);
  });

  test("a server with no key at all (no HMS_HASH_KEY) refuses a password with a clear message; with only HMS_HASH_KEY a password saves without any other setting", async () => {
    const refused = await fieldsOf(saveGmail(build(null)));
    assert.match(refused.smtpPassword, /secret key/);
    assert.equal(rawRow("mail.smtp_host")?.value, null);
    assert.equal((await build(null).get(session("sa"))).smtp.canStorePassword, false);
    assert.equal((await saveGmail(build(deriveSmtpKey(randomBytes(32))))).smtp.passwordSet, true);
  });

  test("a password sealed under another key is unreadable: reported, not used (sendingFrom falls back to the server), and the test says so", async () => {
    await saveGmail();
    const other = (await build(OTHER_KEY).get(session("sa"))).smtp;
    assert.deepEqual([other.passwordSet, other.passwordUnreadable, other.sendingFrom], [true, true, { source: "server", address: null, provider: null }]);
    const r = await build(OTHER_KEY).sendTest(session("sa"), "me@example.com", META);
    assert.equal(r.ok, false);
    assert.match(r.message, /cannot be opened/);
    assert.equal(sent.length, 0);
  });

  test("Super Admin only; a Platform Admin cannot read, save or test (the refusal is audited)", async () => {
    const svc = build();
    await assert.rejects(svc.get(session("pa")), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    await assert.rejects(svc.update(session("pa"), { smtp: { user: GMAIL_USER } }, META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    await assert.rejects(svc.sendTest(session("pa"), "me@example.com", META), (e: unknown) => (e as { code?: string }).code === "FORBIDDEN");
    assert.equal(cons.data.audit.filter((a) => a.result === "failed").length, 2);
  });
});

describe("an older server saved before Gmail-only", () => {
  const legacy = () => {
    for (const [k, v] of Object.entries({ "mail.smtp_host": "smtp.old-provider.in", "mail.smtp_port": 465, "mail.smtp_security": "ssl", "mail.smtp_user": "mailer@old-provider.in" })) cons.data.settings.set(k, { value: v, updatedAt: new Date(0), updatedBy: null });
    cons.data.settings.set("mail.smtp_password", { value: sealSmtpSecret(KEY, "old-pass", "platform"), updatedAt: new Date(0), updatedBy: null, secret: true });
  };

  test("it keeps sending (read as saved, shown as its provider) until the form is saved; saving the Gmail form replaces it", async () => {
    legacy();
    const v = (await build().get(session("sa"))).smtp;
    assert.deepEqual([v.user, v.otherServer, v.provider, v.server?.host, v.sendingFrom], ["mailer@old-provider.in", null, "smtp", "smtp.old-provider.in", { source: "settings", address: "mailer@old-provider.in", provider: "smtp" }]);
    const read = readPlatformSmtp((k) => cons.data.settings.get(k)?.value ?? null, String(rawRow("mail.smtp_password")?.value), KEY, "HMS <env@hms.test>").config;
    assert.deepEqual([read?.host, read?.port, read?.security, read?.user, read?.pass], ["smtp.old-provider.in", 465, "ssl", "mailer@old-provider.in", "old-pass"]);
    const saved = await build().update(session("sa"), { smtp: { provider: "gmail", user: GMAIL_USER, password: PASSWORD } }, META);
    assert.deepEqual([saved.smtp.otherServer, saved.smtp.sendingFrom, rawRow("mail.smtp_host")?.value, rawRow("mail.smtp_port")?.value, rawRow("mail.smtp_security")?.value], [null, { source: "settings", address: GMAIL_USER, provider: "gmail" }, GMAIL.host, GMAIL.port, GMAIL.security]);
  });
});

describe("Send test email", () => {
  test("sends with the SAVED Gmail settings (the password opened for the call), keeps when/ok/message (not the address), and audits without the address", async () => {
    const svc = build();
    await saveGmail(svc);
    const r = await svc.sendTest(session("sa"), " Me@Example.com ", META);
    assert.deepEqual([r.ok, r.message, r.at], [true, "Sent", clock.toISOString()]);
    assert.deepEqual([sent[0].to, sent[0].smtp.host, sent[0].smtp.port, sent[0].smtp.security, sent[0].smtp.user, sent[0].smtp.pass], ["me@example.com", "smtp.gmail.com", 587, "starttls", GMAIL_USER, PASSWORD]);
    assert.match(sent[0].smtp.from, new RegExp(`<${GMAIL_USER.replace(".", "\\.")}>$`), "Gmail sends as the account");
    assert.deepEqual((await svc.get(session("sa"))).smtp.lastTest, { at: clock.toISOString(), ok: true, message: "Sent" });
    assert.ok(!JSON.stringify(rawRow("mail.test_result")).includes("me@example.com"));
    assert.ok(!auditText().includes("me@example.com") && !auditText().includes(PASSWORD));
  });

  test("a failure keeps its exact words and the Gmail hint; saving new settings clears the old result", async () => {
    const svc = build();
    await saveGmail(svc);
    testAnswer = { ok: false, message: "EAUTH 535-5.7.8 Username and Password not accepted", hint: "Gmail refused the login. Use a Google APP PASSWORD" };
    const r = await svc.sendTest(session("sa"), "me@example.com", META);
    assert.deepEqual([r.ok, r.message, r.hint], [false, testAnswer.message, testAnswer.hint]);
    assert.equal((await svc.get(session("sa"))).smtp.lastTest?.hint, testAnswer.hint);
    await svc.update(session("sa"), { smtp: { replyTo: "help@hotel.in" } }, META);
    assert.equal((await svc.get(session("sa"))).smtp.lastTest, null);
  });

  test("refusals: nothing saved (422 on `to`), a bad address", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.sendTest(session("sa"), "me@example.com", META))), ["to"]);
    await saveGmail(svc);
    assert.deepEqual(Object.keys(await fieldsOf(svc.sendTest(session("sa"), "nope", META))), ["to"]);
    assert.equal(sent.length, 0);
  });
});

describe("the sender: what is saved beats the server's own SMTP_* values", () => {
  const message = (): MailMessage => ({ to: "guest@example.com", subject: "Your code", text: "123456" });
  let envSent: MailMessage[];
  let made: Record<string, unknown>[];
  let mails: Record<string, unknown>[];
  const env: MailSender = { async send(m) { envSent.push(m); } };
  const transport = (o: Record<string, unknown>): SmtpTransport => (made.push(o), { sendMail: async (m) => void mails.push(m) });
  const sealed = sealSmtpSecret(KEY, PASSWORD, "platform");
  const rows = (over: Record<string, unknown> = {}): ((k: string) => unknown) => {
    const base: Record<string, unknown> = { "mail.smtp_host": GMAIL.host, "mail.smtp_port": 587, "mail.smtp_security": "starttls", "mail.smtp_user": GMAIL_USER, "mail.reply_to": "help@hotel.in", "mail.from_name": "HMS Platform", ...over };
    return (k) => base[k] ?? null;
  };
  const load = (over: Record<string, unknown> = {}, key: Buffer | null = KEY) => async () => readPlatformSmtp(rows(over), sealed, key, "HMS <env@hms.test>").config;
  beforeEach(() => {
    envSent = [];
    made = [];
    mails = [];
  });

  test("with Gmail saved, mail goes through Gmail with the saved login, as the Gmail account with the sender name and the reply-to; the server's own sender is never used", async () => {
    const sender = createPlatformSettingsSender({ env, load: load(), createTransport: transport });
    await sender.send(message());
    await sender.send(message());
    assert.equal(envSent.length, 0);
    assert.equal(made.length, 1, "one connection is kept for the same settings");
    assert.deepEqual([made[0].host, made[0].port, made[0].secure, made[0].requireTLS, made[0].auth], ["smtp.gmail.com", 587, false, true, { user: GMAIL_USER, pass: PASSWORD }]);
    assert.deepEqual([mails[0].from, mails[0].replyTo], [`"HMS Platform" <${GMAIL_USER}>`, "help@hotel.in"]);
  });

  test("a Gmail account is the From address even when an older From email or the server's SMTP_FROM is set", async () => {
    const config = readPlatformSmtp(rows({ "mail.from_email": "old@somewhere.in" }), sealed, KEY, "HMS <env@hms.test>").config;
    assert.equal(config?.from, `"HMS Platform" <${GMAIL_USER}>`);
  });

  test("only when nothing usable is saved does the server's own sender send: no Gmail address, an unreadable password, no key, or settings that cannot be read", async () => {
    const via = async (loadFn: () => Promise<SmtpConfig | null>) => {
      envSent = [];
      await createPlatformSettingsSender({ env, load: loadFn, createTransport: transport }).send(message());
      return envSent.length;
    };
    assert.equal(await via(load({ "mail.smtp_host": null, "mail.smtp_user": null })), 1, "nothing saved");
    assert.equal(await via(load({}, OTHER_KEY)), 1, "the password cannot be opened");
    assert.equal(await via(load({}, null)), 1, "no key");
    assert.equal(await via(async () => { throw new Error("db down"); }), 1, "settings unreadable");
    assert.equal(made.length, 0, "no Gmail connection was made for any of them");
  });

  test("a changed setting is used by the next mail (a new connection)", async () => {
    let current = readPlatformSmtp(rows(), sealed, KEY, undefined).config;
    const sender = createPlatformSettingsSender({ env, load: async () => current, createTransport: transport });
    await sender.send(message());
    current = readPlatformSmtp(rows({ "mail.smtp_user": "other.desk@gmail.com" }), sealed, KEY, undefined).config;
    await sender.send(message());
    assert.deepEqual(made.map((m) => (m.auth as { user: string }).user), [GMAIL_USER, "other.desk@gmail.com"]);
  });
});

describe("the mail services (Gmail, Brevo, Amazon SES, other SMTP)", () => {
  const sa = () => session("sa");
  const FROM = { mailFromEmail: "mail@easyhotelsolutions.in" };

  test("Amazon SES: the server is made from the region (default Mumbai); the login is the SES SMTP user name; a From address is required; the limits are SES's", async () => {
    const noFrom = await fieldsOf(build().update(sa(), { smtp: { provider: "ses", user: "AKIAEXAMPLE", password: PASSWORD } }, META));
    assert.deepEqual(Object.keys(noFrom), ["mailFromEmail"]);
    const v = await build().update(sa(), { ...FROM, smtp: { provider: "ses", user: "AKIAEXAMPLE", password: PASSWORD } }, META);
    assert.deepEqual([v.smtp.provider, v.smtp.server, v.smtp.user, v.smtp.limits, v.smtp.sendingFrom], ["ses", { host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", region: "ap-south-1" }, "AKIAEXAMPLE", { perSecond: 14, perDay: 0 }, { source: "settings", address: "AKIAEXAMPLE", provider: "ses" }]);
    const eu = await build().update(sa(), { smtp: { provider: "ses", region: "eu-west-1" } }, META);
    assert.equal(eu.smtp.server?.host, "email-smtp.eu-west-1.amazonaws.com");
    assert.deepEqual(Object.keys(await fieldsOf(build().update(sa(), { smtp: { provider: "ses", region: "mumbai" } }, META))), ["smtpRegion"]);
  });

  test("Brevo: the server is fixed (smtp-relay.brevo.com:587 STARTTLS), the login need not be an address", async () => {
    const v = await build().update(sa(), { ...FROM, smtp: { provider: "brevo", user: "9a1b2c@smtp-brevo.com", password: PASSWORD } }, META);
    assert.deepEqual([v.smtp.provider, v.smtp.server?.host, v.smtp.server?.port, v.smtp.limits], ["brevo", "smtp-relay.brevo.com", 587, { perSecond: 5, perDay: 300 }]);
    assert.deepEqual([rawRow("mail.provider")?.value, rawRow("mail.smtp_security")?.value], ["brevo", "starttls"]);
  });

  test("another SMTP server: host, port and security are typed and checked; a relay without a login needs no password", async () => {
    const bad = await fieldsOf(build().update(sa(), { ...FROM, smtp: { provider: "smtp", host: "not a host!", user: "u", password: PASSWORD } }, META));
    assert.deepEqual(Object.keys(bad), ["smtpHost"]);
    assert.deepEqual(Object.keys(await fieldsOf(build().update(sa(), { ...FROM, smtp: { provider: "smtp", host: "smtp.example.com", port: 70000, user: "u", password: PASSWORD } }, META))), ["smtpPort"]);
    const v = await build().update(sa(), { ...FROM, smtp: { provider: "smtp", host: "smtp.postmarkapp.com", port: 465, security: "ssl", user: "token", password: PASSWORD } }, META);
    assert.deepEqual([v.smtp.provider, v.smtp.server], ["smtp", { host: "smtp.postmarkapp.com", port: 465, security: "ssl", region: "" }]);
    const relay = await build().update(sa(), { smtp: { provider: "smtp", host: "relay.internal.lan", port: 25, security: "none", user: "" } }, META);
    assert.deepEqual([relay.smtp.provider, relay.smtp.server?.host], ["smtp", "relay.internal.lan"]);
  });

  test("changing the service needs the new service's password (the old Gmail app password is never reused)", async () => {
    await saveGmail();
    const f = await fieldsOf(build().update(sa(), { ...FROM, smtp: { provider: "brevo", user: "9a1b2c@smtp-brevo.com" } }, META));
    assert.deepEqual(Object.keys(f), ["smtpPassword"]);
    assert.equal(rawRow("mail.smtp_host")?.value, GMAIL.host, "nothing was changed");
  });

  test("a daily limit lowers the day figure; empty or 0 goes back to the service's own", async () => {
    await saveGmail();
    assert.equal((await build().update(sa(), { smtp: { dailyLimit: 200 } }, META)).smtp.limits?.perDay, 200);
    assert.equal((await build().update(sa(), { smtp: { dailyLimit: 900 } }, META)).smtp.limits?.perDay, 500, "never above the service");
    const back = await build().update(sa(), { smtp: { dailyLimit: null } }, META);
    assert.deepEqual([back.smtp.dailyLimit, back.smtp.limits?.perDay], [null, 500]);
    assert.deepEqual(Object.keys(await fieldsOf(build().update(sa(), { smtp: { dailyLimit: -3 } }, META))), ["smtpDailyLimit"]);
  });

  test("a Google Workspace address (its own domain) has the higher Gmail day figure", async () => {
    const v = await saveGmail(build(), { user: "frontdesk@sunrisehotel.in" });
    assert.equal(v.smtp.limits?.perDay, 2000);
  });

  test("the sender reads the saved service: SES logs in with the SMTP user name and sends from the platform From address", async () => {
    await build().update(sa(), { mailFromName: "HMS Platform", mailFromEmail: "mail@easyhotelsolutions.in", smtp: { provider: "ses", user: "AKIAEXAMPLE", password: PASSWORD } }, META);
    const read = readPlatformSmtp((k) => cons.data.settings.get(k)?.value ?? null, String(rawRow("mail.smtp_password")?.value), KEY, undefined).config;
    assert.deepEqual([read?.host, read?.port, read?.security, read?.user, read?.pass, read?.from], ["email-smtp.ap-south-1.amazonaws.com", 587, "starttls", "AKIAEXAMPLE", PASSWORD.replace(/\s+/g, ""), '"HMS Platform" <mail@easyhotelsolutions.in>']);
  });
});

describe("secrets are write-only, whichever service (platform)", () => {
  const FROM = { mailFromEmail: "mail@easyhotelsolutions.in" };
  const SECRET = "Zq8-secret-VALUE-1234";
  const SERVICES: Record<string, object> = {
    gmail: { provider: "gmail", user: GMAIL_USER },
    brevo: { provider: "brevo", user: "9a1b@smtp-brevo.com" },
    ses: { provider: "ses", user: "AKIAEXAMPLE" },
    smtp: { provider: "smtp", host: "smtp.postmarkapp.com", user: "token" },
  };
  for (const [name, smtp] of Object.entries(SERVICES)) {
    test(`${name}: the answer has only passwordSet + lastChangedAt; empty keeps; a new one replaces; clearPassword removes; nothing of it in the audit log`, async () => {
      const svc = build();
      const v = await svc.update(session("sa"), { ...FROM, smtp: { ...smtp, password: SECRET } }, META);
      const sealed = String(rawRow("mail.smtp_password")?.value);
      for (const out of [JSON.stringify(v), JSON.stringify(await svc.get(session("sa")))]) for (const piece of [SECRET, sealed, SECRET.slice(-4), SECRET.slice(0, 4)]) assert.ok(!out.includes(piece), `${name}: no part of the secret in the answer`);
      assert.deepEqual([v.smtp.passwordSet, typeof v.smtp.lastChangedAt], [true, "string"]);
      assert.equal(Object.keys(v.smtp).filter((k) => /pass|secret|key/i.test(k)).sort().join(), "canStorePassword,passwordSet,passwordUnreadable");
      await svc.update(session("sa"), { smtp: { ...smtp, password: "" } }, META);
      assert.equal(rawRow("mail.smtp_password")?.value, sealed, "empty = keep");
      await svc.update(session("sa"), { smtp: { ...smtp, password: "Another-Secret-5678" } }, META);
      assert.notEqual(rawRow("mail.smtp_password")?.value, sealed, "a new one replaces");
      // removing the password of a service that needs a login switches the service off (or, for another SMTP server, makes it a relay without a login)
      const off = await svc.update(session("sa"), { smtp: { ...smtp, clearPassword: true, user: "" } }, META);
      assert.deepEqual([off.smtp.passwordSet, off.smtp.lastChangedAt], [false, null], "nothing saved, no date");
      const refusedClear = await fieldsOf(svc.update(session("sa"), { smtp: { ...smtp, user: "again", clearPassword: true } }, META));
      assert.deepEqual(Object.keys(refusedClear), name === "gmail" ? ["smtpUser", "smtpPassword"] : ["smtpPassword"], "a login without its password is refused");
      const audit = auditText();
      for (const piece of [SECRET, "Another-Secret-5678", sealed]) assert.ok(!audit.includes(piece), `${name}: no secret in the audit log`);
    });
  }
});