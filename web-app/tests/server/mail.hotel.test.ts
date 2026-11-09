// Each hotel's own mail server (src/server/mail/hotelSmtp.ts) behind the outbox worker. What must hold: a hotel's Email settings become one transport (TLS rules,
// login, from name); a mail that names a hotel goes through THAT hotel's transport and one with no hotel (or a hotel without settings) through the platform
// sender; a hotel's transport is pooled and reused, rebuilt when its settings change, closed when idle or pushed out; the settings are read at most once a minute;
// a server failure is a fixed sentence (never the server's text or the password); the worker sends several mails at once; a queued mail wakes the worker.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { createHotelMailRouter, EMAIL_SETTING_KEYS, hotelIdentityFromSettings, hotelSmtpFromSettings } from "../../src/server/mail/hotelSmtp";
import { MailSendError, sealSmtpSecret, type SmtpTransport } from "../../src/server/mail/smtp";
import type { SettingRow } from "../../src/server/repos/admin";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { queueMail, runOutboxOnce, type MailMessage, type MailSender } from "../../src/server/services/auth/mail";
import { mailWake } from "../../src/server/services/auth/mailWake";

const KEY = randomBytes(32);
const A = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5c";

const rowsOf = (values: Record<string, string>): SettingRow[] => Object.entries(values).map(([key, value]) => ({ key, value, secret: key === "email.password" }));
const hotelA = rowsOf({ "email.host": "smtp.sunrise.in", "email.port": "587", "email.encryption": "tls", "email.username": "mailer@sunrise.in", "email.password": sealSmtpSecret(KEY, "A-secret-1", A), "email.from_address": "Front@Sunrise.in", "email.from_name": "" });
const hotelB = rowsOf({ "email.host": "smtp.pearl.in", "email.port": "465", "email.encryption": "ssl", "email.from_address": "desk@pearl.in", "email.from_name": "Pearl Desk" });

/** A fake transport factory: records what was built and sent; `fail` makes every send throw with a text that must never leak. */
function fakeFactory(options: { fail?: boolean; delayMs?: number } = {}) {
  const made: Record<string, unknown>[] = [];
  const sent: { from: string; to: string; subject: string; via: string }[] = [];
  const closed: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const createTransport = (o: Record<string, unknown>): SmtpTransport => {
    made.push(o);
    const via = String(o.host);
    return {
      async sendMail(m) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        inFlight -= 1;
        if (options.fail) throw new Error(`535 Authentication failed for ${String(o.auth && (o.auth as { user: string }).user)} at ${via} <${m.to}>`);
        sent.push({ from: m.from, to: m.to, subject: m.subject, via });
        return {};
      },
      close: () => void closed.push(via),
    };
  };
  return { made, sent, closed, createTransport, peak: () => peak };
}

describe("a hotel's Email settings as a mail server", () => {
  test("STARTTLS on 587, SSL / 465 is TLS from the first byte, the login goes only when both parts are filled, the from name defaults to the hotel, the reply-to is read", () => {
    const a = hotelSmtpFromSettings(hotelA, "Hotel Sunrise", A, KEY).config;
    assert.deepEqual(a, { host: "smtp.sunrise.in", port: 587, security: "starttls", user: "mailer@sunrise.in", pass: "A-secret-1", from: '"Hotel Sunrise" <front@sunrise.in>' });
    const b = hotelSmtpFromSettings(hotelB, "Hotel Pearl", B, KEY).config;
    assert.deepEqual([b?.security, "user" in (b ?? {}), b?.from], ["ssl", false, '"Pearl Desk" <desk@pearl.in>']);
    const base = Object.fromEntries(hotelA.map((r) => [r.key, r.value ?? ""]));
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.encryption": "none", "email.port": "25" }), "H", A, KEY).config?.security, "none");
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.reply_to": "Help@Sunrise.in" }), "H", A, KEY).config?.replyTo, "help@sunrise.in");
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.reply_to": "nonsense" }), "H", A, KEY).config?.replyTo, undefined);
  });

  test("not set up: no host, no from address, a bad port; and a saved password that cannot be opened", () => {
    const base = Object.fromEntries(hotelA.map((r) => [r.key, r.value ?? ""]));
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.host": "" }), "H", A, KEY).config, null);
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.from_address": "not-an-address" }), "H", A, KEY).config, null);
    assert.equal(hotelSmtpFromSettings(rowsOf({ ...base, "email.port": "99999" }), "H", A, KEY).config, null);
    assert.equal(hotelSmtpFromSettings([], "H", A, KEY).config, null);
    assert.deepEqual([hotelSmtpFromSettings(hotelA, "H", A, null).config, hotelSmtpFromSettings(hotelA, "H", A, null).passwordUnreadable], [null, true]);
    // the last three: reading the same mailbox for Conversations (decision 66)
    assert.deepEqual([...EMAIL_SETTING_KEYS].sort(), ["email.daily_limit", "email.encryption", "email.from_address", "email.from_name", "email.host", "email.imap", "email.imap_host", "email.imap_port", "email.mode", "email.password", "email.port", "email.provider", "email.region", "email.reply_to", "email.username"]);
    assert.equal(EMAIL_SETTING_KEYS.length, 15);
  });

  test("the Gmail form saves no separate from address: the Gmail address is the From address (and the reply-to default)", () => {
    const rows = rowsOf({ "email.host": "smtp.gmail.com", "email.port": "587", "email.encryption": "tls", "email.username": "front.desk@gmail.com", "email.password": sealSmtpSecret(KEY, "abcdefghijklmnop", A), "email.from_name": "{hotel}" });
    const c = hotelSmtpFromSettings(rows, "Hotel Sunrise", A, KEY).config;
    assert.deepEqual([c?.host, c?.port, c?.security, c?.user, c?.pass, c?.from], ["smtp.gmail.com", 587, "starttls", "front.desk@gmail.com", "abcdefghijklmnop", '"Hotel Sunrise" <front.desk@gmail.com>']);
    assert.equal(hotelIdentityFromSettings(rows, "Hotel Sunrise").replyTo, "front.desk@gmail.com");
  });
  test("who a hotel is without a mail server of its own: its from name (or its name) and its reply-to (or its from address)", () => {
    assert.deepEqual(hotelIdentityFromSettings(rowsOf({ "email.from_name": "Pearl Desk", "email.from_address": "desk@pearl.in" }), "Hotel Pearl"), { name: "Pearl Desk", replyTo: "desk@pearl.in" });
    assert.deepEqual(hotelIdentityFromSettings(rowsOf({ "email.from_name": "{hotel} Front", "email.reply_to": "Help@Pearl.in", "email.from_address": "desk@pearl.in" }), "Hotel Pearl"), { name: "Hotel Pearl Front", replyTo: "help@pearl.in" });
    assert.deepEqual(hotelIdentityFromSettings([], "Hotel Pearl"), { name: "Hotel Pearl", replyTo: null });
    assert.deepEqual(hotelIdentityFromSettings([], null), { name: null, replyTo: null });
  });
});
describe("the router", () => {
  const settings = new Map<string, SettingRow[]>([[A, hotelA], [B, hotelB]]);
  const platformSent: MailMessage[] = [];
  const platform: MailSender = { send: async (m) => void platformSent.push(m) };
  const reads: string[] = [];
  const settingsOf = async (hotelId: string) => {
    reads.push(hotelId);
    const rows = settings.get(hotelId);
    return rows ? { rows, hotelName: hotelId === A ? "Hotel Sunrise" : "Hotel Pearl" } : null;
  };

  test("a mail that names a hotel goes through that hotel's server with its login and from; one with no hotel, or an unknown hotel, through the platform sender", async () => {
    platformSent.length = 0;
    reads.length = 0;
    const f = fakeFactory();
    const router = createHotelMailRouter({ platform, settingsOf, secretKey: KEY, createTransport: f.createTransport });
    await router.send({ to: "guest@example.com", subject: "Hi", text: "t", hotelId: A });
    await router.send({ to: "guest@example.com", subject: "Hi", text: "t", hotelId: B });
    await router.send({ to: "staff@example.com", subject: "Code", text: "t", hotelId: null });
    await router.send({ to: "staff@example.com", subject: "Code", text: "t", hotelId: "0190f1e2-3c4d-7e5f-8a9b-000000000000" });
    assert.deepEqual(f.sent.map((s) => [s.via, s.from]), [["smtp.sunrise.in", '"Hotel Sunrise" <front@sunrise.in>'], ["smtp.pearl.in", '"Pearl Desk" <desk@pearl.in>']]);
    assert.deepEqual(platformSent.map((m) => m.hotelId), [null, "0190f1e2-3c4d-7e5f-8a9b-000000000000"]);
    const a = f.made[0];
    assert.deepEqual([a.host, a.port, a.secure, a.requireTLS, a.auth, a.pool, a.maxConnections, a.disableFileAccess, a.disableUrlAccess], ["smtp.sunrise.in", 587, false, true, { user: "mailer@sunrise.in", pass: "A-secret-1" }, true, 3, true, true]);
    assert.equal(router.stats().transports, 2);
    router.close();
    assert.deepEqual(f.closed.sort(), ["smtp.pearl.in", "smtp.sunrise.in"]);
  });

  test("what a hotel saved beats the platform: a hotel with its Gmail saved never uses the platform sender (not even when the platform sender exists); a hotel with nothing saved uses the platform sender as itself", async () => {
    platformSent.length = 0;
    const f = fakeFactory();
    const router = createHotelMailRouter({ platform, settingsOf, secretKey: KEY, createTransport: f.createTransport });
    await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: A });
    assert.deepEqual([f.sent.length, platformSent.length], [1, 0]);
    settings.set(B, rowsOf({ "email.from_name": "Pearl Desk" }));
    await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: B });
    assert.deepEqual([f.sent.length, platformSent.length, platformSent[0]?.fromName], [1, 1, "Pearl Desk"]);
    settings.set(B, hotelB);
    router.close();
  });

  test("the transport is reused across mails, the settings are read once a minute, a changed setting rebuilds the transport, an idle one is closed", async () => {
    reads.length = 0;
    let t = 1_000_000;
    const f = fakeFactory();
    const router = createHotelMailRouter({ platform, settingsOf, secretKey: KEY, createTransport: f.createTransport, now: () => t });
    for (let i = 0; i < 5; i += 1) await router.send({ to: `g${i}@example.com`, subject: "Hi", text: "t", hotelId: A });
    assert.deepEqual([f.made.length, reads.length], [1, 1], "one transport, one read for five mails");
    t += 61_000;
    await router.send({ to: "g@example.com", subject: "Hi", text: "t", hotelId: A });
    assert.deepEqual([f.made.length, reads.length], [1, 2], "read again after a minute, same settings: same transport");
    settings.set(A, rowsOf({ ...Object.fromEntries(hotelA.map((r) => [r.key, r.value ?? ""])), "email.password": sealSmtpSecret(KEY, "A-secret-2", A) }));
    t += 61_000;
    await router.send({ to: "g@example.com", subject: "Hi", text: "t", hotelId: A });
    assert.deepEqual([f.made.length, f.closed], [2, ["smtp.sunrise.in"]], "a new password: the old transport is closed and a new one built");
    t += 6 * 60_000;
    await router.send({ to: "g@example.com", subject: "Hi", text: "t", hotelId: B });
    assert.equal(f.closed.length, 2, "A's transport, idle for more than five minutes, was closed when B's was built");
    settings.set(A, hotelA);
    router.close();
  });

  test("more hotels than the pool keeps: the one unused for the longest is pushed out", async () => {
    const many = new Map<string, SettingRow[]>();
    for (let i = 0; i < 4; i += 1) many.set(`0190f1e2-3c4d-7e5f-8a9b-00000000000${i}`, rowsOf({ "email.host": `smtp${i}.example.in`, "email.from_address": `h${i}@example.in` }));
    let t = 0;
    const f = fakeFactory();
    const router = createHotelMailRouter({ platform, secretKey: KEY, settingsOf: async (id) => (many.has(id) ? { rows: many.get(id)!, hotelName: null } : null), createTransport: f.createTransport, now: () => (t += 1000), maxTransports: 2 });
    for (const id of many.keys()) await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: id });
    assert.deepEqual([router.stats().transports, f.closed], [2, ["smtp0.example.in", "smtp1.example.in"]]);
    router.close();
  });

  test("a failing hotel server is a fixed sentence without the password, the login or the address; a bad address is refused before anything is sent", async () => {
    const f = fakeFactory({ fail: true });
    const router = createHotelMailRouter({ platform, settingsOf, secretKey: KEY, createTransport: f.createTransport });
    await assert.rejects(
      () => router.send({ to: "guest@example.com", subject: "Hi", text: "t", hotelId: A }),
      (e: unknown) => e instanceof MailSendError && e.code === "SMTP_FAILED" && !/A-secret|mailer@|guest@|smtp\.sunrise/.test(`${(e as Error).message}${JSON.stringify(e)}`),
    );
    await assert.rejects(() => router.send({ to: "bad address", subject: "Hi", text: "t", hotelId: A }), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
    await assert.rejects(() => router.send({ to: "a@b.in", subject: "Hi\r\nBcc: x@y.in", text: "t", hotelId: A }), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
    assert.equal(f.sent.length, 0);
    router.close();
  });

  test("no platform sender and no hotel settings: the mail fails (and the worker retries it later), nothing is dropped", async () => {
    const router = createHotelMailRouter({ platform: null, secretKey: KEY, settingsOf, createTransport: fakeFactory().createTransport });
    await assert.rejects(() => router.send({ to: "a@b.in", subject: "s", text: "t", hotelId: null }), MailSendError);
  });

  test("a hotel with no mail server of its own: the mail still goes, through the platform sender, as the hotel (its name as the sender name, its address as the reply-to); a mail that names a reply-to keeps it", async () => {
    const sent: MailMessage[] = [];
    const router = createHotelMailRouter({
      platform: { send: async (m) => void sent.push(m) },
      secretKey: KEY,
      settingsOf: async () => ({ rows: rowsOf({ "email.from_name": "Pearl Desk", "email.from_address": "desk@pearl.in", "email.reply_to": "help@pearl.in" }), hotelName: "Hotel Pearl" }),
      createTransport: fakeFactory().createTransport,
    });
    await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: B });
    await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: B, replyTo: "other@pearl.in" });
    await router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: null });
    assert.deepEqual(sent.map((m) => [m.fromName ?? null, m.replyTo ?? null]), [["Pearl Desk", "help@pearl.in"], ["Pearl Desk", "other@pearl.in"], [null, null]]);
    router.close();
  });

  test("with no platform sender either, the reason is NO_SENDER (the worker keeps it as the reason the mail did not go)", async () => {
    const router = createHotelMailRouter({ platform: null, settingsOf: async () => ({ rows: [], hotelName: "H" }), createTransport: fakeFactory().createTransport });
    await assert.rejects(() => router.send({ to: "g@example.com", subject: "s", text: "t", hotelId: A }), (e: unknown) => e instanceof MailSendError && (e as MailSendError).reason === "NO_SENDER");
  });
});

describe("the worker", () => {
  const NOW = new Date("2026-10-12T10:00:00Z");

  test("sends the queued mails several at a time, each through its own hotel, and keeps the hotel on the row", async () => {
    const auth = createMemoryAuth();
    const f = fakeFactory({ delayMs: 20 });
    const platform = fakeFactory({ delayMs: 20 });
    const router = createHotelMailRouter({
      platform: { send: async (m) => void (await platform.createTransport({ host: "platform" }).sendMail({ from: "p", to: m.to, subject: m.subject, text: m.text })) },
      settingsOf: async (id) => (id === A ? { rows: hotelA, hotelName: "Hotel Sunrise" } : null),
      secretKey: KEY,
      createTransport: f.createTransport,
    });
    for (let i = 0; i < 12; i += 1) {
      await auth.unit.run((r) => queueMail(r, { userId: "u1", kind: i % 2 === 0 ? "daily_summary" : "password_changed", toEmail: `p${i}@example.com`, payload: { name: `P${i}` }, hotelId: i % 2 === 0 ? A : null }, new Date(NOW.getTime() - 1000)));
    }
    assert.equal(auth.data().outbox.filter((o) => o.hotelId === A).length, 6);
    const started = Date.now();
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender: router, now: () => NOW }), 12);
    const took = Date.now() - started;
    assert.ok(took < 12 * 20, `12 mails of 20 ms each took ${took} ms: they were sent in parallel`);
    assert.ok(f.peak() >= 2, "several hotel mails were in flight at once");
    assert.deepEqual([f.sent.length, platform.sent.length], [6, 6]);
    assert.ok(auth.data().outbox.every((o) => o.status === "sent" && o.payload === null));
    router.close();
  });

  test("a queued mail wakes the worker; a listener that throws never reaches the caller", async () => {
    const auth = createMemoryAuth();
    let woken = 0;
    const off = mailWake.subscribe(() => void (woken += 1));
    const off2 = mailWake.subscribe(() => {
      throw new Error("listener trouble");
    });
    await auth.unit.run((r) => queueMail(r, { userId: "u1", kind: "password_changed", toEmail: "a@b.in", payload: { name: "A" } }, NOW));
    assert.equal(woken, 1);
    off();
    off2();
    await auth.unit.run((r) => queueMail(r, { userId: "u1", kind: "password_changed", toEmail: "a@b.in", payload: { name: "A" } }, NOW));
    assert.equal(woken, 1, "nothing after unsubscribing");
  });
});

describe("both modes: the platform's mail, and the hotel's own", () => {
  const SLUG = "grand-hotel";
  const transports: { host: string; sent: { from: string; replyTo?: string; to: string }[] }[] = [];
  const createTransport = (o: Record<string, unknown>): SmtpTransport => {
    const t = { host: String(o.host), sent: [] as { from: string; replyTo?: string; to: string }[] };
    transports.push(t);
    return { async sendMail(m) { t.sent.push({ from: m.from, to: m.to, ...(m.replyTo ? { replyTo: m.replyTo } : {}) }); return {}; }, close: () => undefined };
  };
  const msg = (hotelId: string | null): MailMessage => ({ to: "guest@x.in", subject: "S", text: "T", hotelId });

  test("mode 'platform' (the default; or the stale rows of an own service are ignored): the platform sender sends it from <slug>@<sending domain>, with the hotel's name and its reply-to", async () => {
    transports.length = 0;
    const { createSmtpSender } = await import("../../src/server/mail/smtp");
    const platform = createSmtpSender({ host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", from: '"HMS Platform" <mail@easyhotelsolutions.in>', sendingDomain: "mail.easyhotelsolutions.in" }, { createTransport });
    const rows = rowsOf({ "email.mode": "platform", "email.host": "smtp.stale.in", "email.from_address": "old@stale.in", "email.from_name": "{hotel}", "email.reply_to": "Desk@GrandHotel.in" });
    const router = createHotelMailRouter({ platform, secretKey: KEY, settingsOf: async () => ({ rows, hotelName: "Grand Hotel", slug: SLUG }), createTransport });
    await router.send(msg(A));
    assert.equal(transports.length, 1, "only the platform transport was used, never the stale own server");
    assert.deepEqual(transports[0].sent, [{ from: '"Grand Hotel" <grandhotel@mail.easyhotelsolutions.in>', to: "guest@x.in", replyTo: "desk@grandhotel.in" }]);
    router.close();
  });

  test("without a sending domain the hotel's mail still goes through the platform address, as the hotel (name and reply-to), nothing dropped", async () => {
    transports.length = 0;
    const { createSmtpSender } = await import("../../src/server/mail/smtp");
    const platform = createSmtpSender({ host: "smtp.example.com", port: 587, security: "starttls", from: '"HMS Platform" <mail@easyhotelsolutions.in>' }, { createTransport });
    const router = createHotelMailRouter({ platform, secretKey: KEY, settingsOf: async () => ({ rows: rowsOf({ "email.reply_to": "desk@grandhotel.in" }), hotelName: "Grand Hotel", slug: SLUG }), createTransport });
    await router.send(msg(A));
    assert.deepEqual(transports[0].sent, [{ from: '"Grand Hotel" <mail@easyhotelsolutions.in>', to: "guest@x.in", replyTo: "desk@grandhotel.in" }]);
    router.close();
  });

  test("mode 'own': the hotel's own service sends it, with its own From address; the platform sender is not used", async () => {
    transports.length = 0;
    const platformSent: MailMessage[] = [];
    const rows = rowsOf({ "email.mode": "own", "email.provider": "ses", "email.host": "email-smtp.ap-south-1.amazonaws.com", "email.port": "587", "email.encryption": "tls", "email.username": "AKIAEXAMPLE", "email.password": sealSmtpSecret(KEY, "ses-secret", A), "email.from_address": "desk@grandhotel.in", "email.from_name": "{hotel}" });
    const router = createHotelMailRouter({ platform: { send: async (m) => void platformSent.push(m) }, secretKey: KEY, settingsOf: async () => ({ rows, hotelName: "Grand Hotel", slug: SLUG }), createTransport });
    await router.send(msg(A));
    assert.equal(platformSent.length, 0);
    assert.deepEqual([transports[0].host, transports[0].sent[0].from], ["email-smtp.ap-south-1.amazonaws.com", '"Grand Hotel" <desk@grandhotel.in>']);
    assert.equal(hotelSmtpFromSettings(rows, "Grand Hotel", A, KEY).provider, "ses");
    router.close();
  });

  test("an invalid slug is refused before sending (nothing can be injected into the From address)", async () => {
    const { createSmtpSender } = await import("../../src/server/mail/smtp");
    const platform = createSmtpSender({ host: "h.example.com", port: 587, security: "starttls", from: "a@b.in", sendingDomain: "mail.x.in" }, { createTransport });
    await assert.rejects(() => platform.send({ ...msg(A), fromLocal: "evil@other.com" }), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
  });
});