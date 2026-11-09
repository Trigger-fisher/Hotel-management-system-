// THE mail module (mail/smtp.ts), tested ONCE for both senders: the platform sender (Platform settings > Mail) and a hotel's own sender (Settings > Email) are the same code
// reading the same fields from two places. Every behaviour below runs through both: what is handed to the transport (encryption, timeouts, login, sender, reply-to), header
// injection, a failure that never leaks the server's words, attachments, and the encrypted password (round trip, other owner, legacy plain value, unreadable).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { hotelSmtpFromSettings, createHotelMailRouter } from "../../src/server/mail/hotelSmtp";
import { createPlatformSettingsSender } from "../../src/server/mail/platformSmtp";
import {
  fromHeader, GMAIL, isGmail, isSealedSmtpSecret, MailSendError, openSmtpSecret, readSmtpPassword, scrub, sealSmtpSecret, sendTestMail, smtpChecks, withFromName,
  type SmtpConfig, type SmtpSecurity, type SmtpTransport,
} from "../../src/server/mail/smtp";
import type { SettingRow } from "../../src/server/repos/admin";
import type { MailMessage, MailSender } from "../../src/server/services/auth/mail";

const KEY = randomBytes(32);
const HOTEL = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER_HOTEL = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5c";
const PASSWORD = "s3cr3t-pass/never-leak";
const base: SmtpConfig = { host: "smtp.example.com", port: 587, security: "starttls", user: "mailer@example.com", pass: PASSWORD, from: '"Hotel Pallav" <noreply@hotel.in>' };

interface Fake {
  made: Record<string, unknown>[];
  sent: { from: string; to: string; cc?: string[]; bcc?: string[]; subject: string; text: string; replyTo?: string; attachments?: { filename: string; contentType: string; content: Buffer }[] }[];
  closed: number;
  createTransport: (o: Record<string, unknown>) => SmtpTransport;
}
function fake(fail?: Error): Fake {
  const f: Fake = { made: [], sent: [], closed: 0, createTransport: () => ({ sendMail: async () => ({}) }) };
  f.createTransport = (o) => {
    f.made.push(o);
    return {
      async sendMail(m) {
        if (fail) throw fail;
        f.sent.push(m as Fake["sent"][number]);
        return {};
      },
      close: () => void (f.closed += 1),
    };
  };
  return f;
}

/** A sender under test: the same SmtpConfig arrives through each place it can be read from. */
interface Under {
  name: string;
  make(config: SmtpConfig, f: Fake): MailSender;
}
const noEnv: MailSender = { send: async () => assert.fail("the server's own sender must not be used") };
const rowsOf = (c: SmtpConfig, password: string | null): SettingRow[] => {
  const address = /<([^>]+)>/.exec(c.from)?.[1] ?? c.from;
  const name = /"([^"]+)"/.exec(c.from)?.[1] ?? "";
  const values: Record<string, string> = {
    "email.host": c.host, "email.port": String(c.port), "email.encryption": c.security === "starttls" ? "tls" : c.security, "email.username": c.user ?? "", "email.password": password ?? "",
    "email.from_address": address, "email.from_name": name, "email.reply_to": c.replyTo ?? "",
  };
  return Object.entries(values).map(([key, value]) => ({ key, value, secret: key === "email.password" }));
};
const SENDERS: Under[] = [
  { name: "the platform sender", make: (c, f) => createPlatformSettingsSender({ env: noEnv, load: async () => c, createTransport: f.createTransport }) },
  {
    name: "a hotel's own sender",
    make: (c, f) =>
      createHotelMailRouter({
        platform: null,
        secretKey: KEY,
        settingsOf: async () => ({ rows: rowsOf(c, c.pass === undefined ? null : sealSmtpSecret(KEY, c.pass, HOTEL)), hotelName: "Hotel Pallav" }),
        createTransport: f.createTransport,
      }),
  },
];
const msg = (over: Partial<MailMessage> = {}): MailMessage => ({ to: "guest@example.com", subject: "Hello", text: "Body", hotelId: HOTEL, ...over });

for (const under of SENDERS) {
  describe(`${under.name}: what is handed to the transport`, () => {
    test("an encrypted, time-limited connection with the login, the configured sender and no file or link access", async () => {
      const f = fake();
      await under.make(base, f).send(msg());
      const o = f.made[0];
      assert.deepEqual([o.host, o.port, o.secure, o.requireTLS, o.auth, o.disableFileAccess, o.disableUrlAccess], ["smtp.example.com", 587, false, true, { user: "mailer@example.com", pass: PASSWORD }, true, true]);
      assert.ok(Number(o.connectionTimeout) > 0 && Number(o.connectionTimeout) <= 15_000 && Number(o.socketTimeout) <= 30_000);
      assert.deepEqual([f.sent[0].to, f.sent[0].subject, f.sent[0].text], ["guest@example.com", "Hello", "Body"]);
      assert.equal(f.sent[0].from, '"Hotel Pallav" <noreply@hotel.in>');
    });

    test("security: SSL/TLS is TLS from the first byte, STARTTLS is required on a plain port, None sends without the requirement; no login when none is set", async () => {
      const ssl = fake();
      await under.make({ ...base, port: 465, security: "ssl", user: undefined, pass: undefined }, ssl).send(msg());
      assert.deepEqual([ssl.made[0].secure, ssl.made[0].requireTLS, "auth" in ssl.made[0]], [true, false, false]);
      const none = fake();
      await under.make({ ...base, port: 25, security: "none" }, none).send(msg());
      assert.deepEqual([none.made[0].secure, none.made[0].requireTLS, none.made[0].port], [false, false, 25]);
    });

    test("reply-to goes to the transport when set; the same transport is reused for the next mail", async () => {
      const f = fake();
      const s = under.make({ ...base, replyTo: "help@example.com" }, f);
      await s.send(msg());
      await s.send(msg({ to: "other@example.com" }));
      assert.equal(f.sent[0].replyTo, "help@example.com");
      assert.equal(f.made.length, 1);
      assert.equal(f.sent.length, 2);
    });

    test("a Cc goes to the transport as a real Cc (nothing when there is none); a bad or a sixth Cc is refused before anything is sent", async () => {
      const f = fake();
      const s = under.make(base, f);
      await s.send(msg({ cc: ["boss@hotel.in", "desk@hotel.in"], bcc: ["owner@hotel.in"] }));
      await s.send(msg());
      assert.deepEqual(f.sent[0].cc, ["boss@hotel.in", "desk@hotel.in"]);
      assert.deepEqual(f.sent[0].bcc, ["owner@hotel.in"]);
      assert.equal("cc" in f.sent[1] || "bcc" in f.sent[1], false, "no Cc and no Bcc, no fields");
      for (const cc of [["a@b.in\r\nBcc: x@y.in"], ["not an address"], ["1@b.in", "2@b.in", "3@b.in", "4@b.in", "5@b.in", "6@b.in"]]) {
        await assert.rejects(() => s.send(msg({ cc })), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
        await assert.rejects(() => s.send(msg({ bcc: cc })), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
      }
      assert.equal(f.sent.length, 2);
    });

    test("header injection is refused before anything is sent: a line break in the address, the subject, the reply-to or the sender name; a malformed address", async () => {
      const f = fake();
      const s = under.make(base, f);
      for (const m of [
        msg({ to: "a@b.in\r\nBcc: x@y.in" }), msg({ subject: "hi\r\nBcc: x@y.in" }), msg({ to: "a@b.in\nx@y.in" }), msg({ to: "not an address" }), msg({ to: "" }),
        msg({ replyTo: "a@b.in\r\nBcc: x@y.in" }), msg({ fromName: "Evil\r\nBcc: x@y.in" }),
      ]) await assert.rejects(() => s.send(m), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
      assert.equal(f.sent.length, 0);
      assert.equal(f.made.length, 0, "not even a connection was made");
    });

    test("a server failure is a fixed sentence and a reason code: never the server's words, the address, the login or the password", async () => {
      const cases: [Error, string][] = [
        [Object.assign(new Error(`535 5.7.8 Authentication failed for mailer@example.com ${PASSWORD} at smtp.example.com <guest@example.com>`), { code: "EAUTH" }), "AUTH"],
        [Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:587"), { code: "ECONNECTION" }), "CONNECT"],
        [Object.assign(new Error("self-signed certificate"), { code: "ETLS" }), "TLS"],
        [Object.assign(new Error("550 no such user"), { code: "EENVELOPE", responseCode: 550 }), "RECIPIENT"],
        [new Error("something odd"), "UNKNOWN"],
      ];
      for (const [error, reason] of cases) {
        await assert.rejects(
          () => under.make(base, fake(error)).send(msg()),
          (e: unknown) => e instanceof MailSendError && e.code === "SMTP_FAILED" && e.reason === reason && !/s3cr3t|mailer|guest@|smtp\.example|10\.0\.0/.test(`${(e as Error).message}${JSON.stringify(e)}`) && e.detail === undefined && (e as { cause?: unknown }).cause === undefined,
        );
      }
    });

    test("a file goes as an attachment with a plain file name by Gmail's rules: any document, but no program or script, no empty file and no more than 25 MB, refused before sending", async () => {
      const f = fake();
      const s = under.make(base, f);
      const pdf = (over: object = {}) => ({ filename: "Bill 2026 / 0412 <x>.pdf", contentType: "application/pdf" as const, content: new Uint8Array([37, 80, 68, 70]), ...over });
      await s.send(msg({ attachments: [pdf()] }));
      assert.deepEqual([f.sent[0].attachments?.length, f.sent[0].attachments?.[0].filename, f.sent[0].attachments?.[0].contentType], [1, "Bill 2026 - 0412 -x-.pdf", "application/pdf"]);
      assert.ok(Buffer.isBuffer(f.sent[0].attachments?.[0].content));
      await s.send(msg({ attachments: [pdf({ filename: "receipt" })] }));
      assert.equal(f.sent[1].attachments?.[0].filename, "receipt.pdf");
      // a Word file, a sheet and a photo go with the type their name implies, whatever type was claimed
      await s.send(msg({ attachments: [pdf({ filename: "Offer.docx", contentType: "text/html" }), pdf({ filename: "rates.XLSX" }), pdf({ filename: "front.jpg", content: new Uint8Array(12 * 1024 * 1024) })] }));
      assert.deepEqual(f.sent[2].attachments?.map((a: { filename: string; contentType: string }) => [a.filename, a.contentType]), [["Offer.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["rates.XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["front.jpg", "image/jpeg"]]);
      for (const bad of [pdf({ filename: "setup.exe" }), pdf({ filename: "run.JS" }), pdf({ filename: "x.msi" }), pdf({ content: new Uint8Array(0) }), pdf({ contentType: "not a type" }), pdf({ content: new Uint8Array(25 * 1024 * 1024 + 1) })]) {
        await assert.rejects(() => s.send(msg({ attachments: [bad as never] })), (e: unknown) => e instanceof MailSendError && e.code === "REFUSED_INPUT");
      }
      assert.equal(f.sent.length, 3);
    });
  });
}

describe("one test email for both", () => {
  test("it uses the same sender code, shows the server's exact words with the password and the login cut out, in one line of at most 300 characters", async () => {
    const failing = (message: string, extra: object = {}) => () => ({ sendMail: async () => { throw Object.assign(new Error(message), extra); } });
    const r = await sendTestMail(base, "me@example.com", { subject: "T", body: "b" }, failing(`Invalid login: 535 user mailer@example.com pass ${PASSWORD}\nsecond line`, { code: "EAUTH", responseCode: 535, response: `535 bad login for mailer@example.com with ${PASSWORD}` }));
    assert.equal(r.ok, false);
    assert.ok(!r.message.includes(PASSWORD) && !r.message.includes("mailer@example.com") && !r.message.includes("\n"));
    assert.match(r.message, /EAUTH 535 535 bad login for \*\*\* with \*\*\*/);
    assert.ok(r.message.length <= 300);
    assert.equal(scrub("x".repeat(500), []).length, 300);
    const f = fake();
    assert.deepEqual(await sendTestMail(base, "me@example.com", { subject: "T", body: "b" }, f.createTransport), { ok: true, message: "Sent" });
    assert.equal(f.closed, 1, "the connection is closed afterwards");
    assert.equal(f.sent[0].from, base.from);
    assert.deepEqual(await sendTestMail(base, "not an address", { subject: "T", body: "b" }, f.createTransport), { ok: false, message: "That is not a valid email address." });
  });
});

describe("the encrypted password", () => {
  test("round trip; a fresh IV every time; another owner (platform / another hotel) or another key cannot open it", () => {
    const a = sealSmtpSecret(KEY, PASSWORD, HOTEL);
    assert.ok(isSealedSmtpSecret(a) && !a.includes(PASSWORD));
    assert.notEqual(a, sealSmtpSecret(KEY, PASSWORD, HOTEL));
    assert.equal(openSmtpSecret(KEY, a, HOTEL), PASSWORD);
    assert.throws(() => openSmtpSecret(KEY, a, OTHER_HOTEL));
    assert.throws(() => openSmtpSecret(KEY, a, "platform"));
    assert.throws(() => openSmtpSecret(randomBytes(32), a, HOTEL));
  });

  test("readSmtpPassword: sealed is opened, a legacy plain value is used as it is, nothing is none, a sealed one that cannot be opened is unreadable", () => {
    const sealed = sealSmtpSecret(KEY, PASSWORD, HOTEL);
    assert.deepEqual(readSmtpPassword(sealed, KEY, HOTEL), { pass: PASSWORD, unreadable: false });
    assert.deepEqual(readSmtpPassword("an-old-plain-password", KEY, HOTEL), { pass: "an-old-plain-password", unreadable: false });
    assert.deepEqual(readSmtpPassword("an-old-plain-password", null, HOTEL), { pass: "an-old-plain-password", unreadable: false }, "legacy plain needs no key");
    assert.deepEqual(readSmtpPassword("", KEY, HOTEL), { pass: null, unreadable: false });
    assert.deepEqual(readSmtpPassword(null, null, HOTEL), { pass: null, unreadable: false });
    assert.deepEqual(readSmtpPassword(sealed, null, HOTEL), { pass: null, unreadable: true });
    assert.deepEqual(readSmtpPassword(sealed, randomBytes(32), HOTEL), { pass: null, unreadable: true });
    assert.deepEqual(readSmtpPassword(sealed, KEY, OTHER_HOTEL), { pass: null, unreadable: true });
  });

  test("a hotel's saved settings read the same way: a sealed password, a legacy plain one, and one that cannot be opened (the hotel then has no server of its own)", () => {
    const sealedRows = rowsOf(base, sealSmtpSecret(KEY, PASSWORD, HOTEL));
    assert.equal(hotelSmtpFromSettings(sealedRows, "Hotel Pallav", HOTEL, KEY).config?.pass, PASSWORD);
    assert.equal(hotelSmtpFromSettings(rowsOf(base, "plain-old"), "Hotel Pallav", HOTEL, KEY).config?.pass, "plain-old");
    const lost = hotelSmtpFromSettings(sealedRows, "Hotel Pallav", HOTEL, null);
    assert.deepEqual([lost.config, lost.passwordUnreadable], [null, true]);
    assert.equal(hotelSmtpFromSettings(sealedRows, "Hotel Pallav", OTHER_HOTEL, KEY).config, null, "copied to another hotel's row: does not open");
  });
});

describe("Gmail is the one server", () => {
  test("the server is fixed: smtp.gmail.com, port 587, STARTTLS; an older server is recognised as 'other'", () => {
    assert.deepEqual(GMAIL, { host: "smtp.gmail.com", port: 587, security: "starttls" });
    assert.equal(isGmail({ host: "SMTP.GMAIL.COM", port: 587, security: "starttls" }), true);
    const others: Array<{ host: string; port: number; security: SmtpSecurity }> = [
      { host: "smtp.old.in", port: 587, security: "starttls" },
      { host: "smtp.gmail.com", port: 465, security: "ssl" },
      { host: "smtp.gmail.com", port: 587, security: "none" },
    ];
    assert.deepEqual(others.map((c) => isGmail(c)), [false, false, false]);
  });

  test("plain help for the usual Gmail failures on the test email: a wrong app password / 2-step verification, an unreachable server; none for another server or a plain refusal", async () => {
    const gmail: SmtpConfig = { ...base, host: "smtp.gmail.com", port: 587, security: "starttls" };
    const failing = (error: Error) => () => ({ sendMail: async () => { throw error; } });
    const auth = await sendTestMail(gmail, "me@example.com", { subject: "T", body: "b" }, failing(Object.assign(new Error("535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 })));
    assert.equal(auth.ok, false);
    assert.match(String(auth.hint), /APP PASSWORD/);
    assert.match(String(auth.hint), /2-step verification/);
    const down = await sendTestMail(gmail, "me@example.com", { subject: "T", body: "b" }, failing(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })));
    assert.match(String(down.hint), /smtp\.gmail\.com on port 587/);
    assert.equal((await sendTestMail(gmail, "me@example.com", { subject: "T", body: "b" }, failing(new Error("odd")))).hint, undefined);
    const other = (await sendTestMail(base, "me@example.com", { subject: "T", body: "b" }, failing(Object.assign(new Error("535"), { code: "EAUTH" })))).hint;
    assert.match(String(other), /user name and password/);
    assert.ok(!/Gmail|APP PASSWORD/.test(String(other)), "another server: no Gmail advice");
    assert.equal((await sendTestMail(gmail, "me@example.com", { subject: "T", body: "b" }, fake().createTransport)).hint, undefined);
  });
});

describe("the same validation for both", () => {
  test("login, password and address", () => {
    assert.deepEqual([smtpChecks.user("mailer@example.com"), smtpChecks.user("a\nb"), smtpChecks.user("x".repeat(255))], [true, false, false]);
    assert.deepEqual([smtpChecks.password("pass word 1"), smtpChecks.password("a\nb"), smtpChecks.password("x".repeat(501))], [true, false, false]);
    assert.deepEqual(["", "a@b.in", "Name <a@b.in>", "a@b", "a@b.in\r\nx"].map(smtpChecks.address), [true, true, false, false, false]);
  });
});
describe("the sender header", () => {
  test("the name is quoted so it cannot change the address or add a header; the name can be swapped for the hotel's", () => {
    assert.equal(fromHeader('A "B" <C>', "x@y.in"), '"A B C" <x@y.in>');
    assert.equal(fromHeader("Evil\r\nBcc: x@y.in", "d@h.in"), '"Evil Bcc: x@y.in" <d@h.in>');
    assert.equal(fromHeader(null, "d@h.in"), "d@h.in");
    assert.equal(withFromName("HMS <noreply@x.in>", "Hotel Sunrise"), '"Hotel Sunrise" <noreply@x.in>');
    assert.equal(withFromName("noreply@x.in", "Hotel Sunrise"), '"Hotel Sunrise" <noreply@x.in>');
  });
});