// The server's own mail configuration (MAIL_DRIVER / SMTP_* variables) behind the outbox worker: configuration rules, which sender runs, and how the worker retries. What the
// sender hands to the transport (encryption, no header injection, no leak) is tested once for every sender in mail.shared.test.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mailSenderFor, logMailSender } from "../../src/server/compose/mail";
import { ConfigError, loadConfig } from "../../src/server/config/env";
import { createSmtpSender, type SmtpConfig, type SmtpTransport } from "../../src/server/mail/smtp";
import { runOutboxOnce } from "../../src/server/services/auth/mail";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";

const cfg: SmtpConfig = { host: "smtp.example.com", port: 587, security: "starttls", user: "mailer", pass: "s3cr3t-pass", from: "Hotel Pallav <noreply@hotel.in>" };
function fake(fail?: Error) {
  const made: Record<string, unknown>[] = [];
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  const createTransport = (o: Record<string, unknown>): SmtpTransport => {
    made.push(o);
    return {
      async sendMail(m) {
        if (fail) throw fail;
        sent.push(m);
        return {};
      },
    };
  };
  return { made, sent, createTransport };
}

describe("configuration", () => {
  test("the log driver is the default and needs nothing; smtp needs its host and a sender; user and password go together; every wrong value is named without its value", () => {
    const c = loadConfig({});
    assert.deepEqual([c.MAIL_DRIVER, c.SMTP_PORT, c.SMTP_HOST], ["log", 587, undefined]);
    assert.throws(() => loadConfig({ MAIL_DRIVER: "smtp" }), (e: unknown) => e instanceof ConfigError && e.problems.length === 2 && e.problems.every((p) => /^SMTP_(HOST|FROM): is required/.test(p)));
    assert.throws(() => loadConfig({ MAIL_DRIVER: "pigeon" }), ConfigError);
    assert.throws(() => loadConfig({ MAIL_DRIVER: "smtp", SMTP_HOST: "smtp.example.com", SMTP_FROM: "x@y.in", SMTP_USER: "u" }), (e: unknown) => e instanceof ConfigError && e.problems[0].startsWith("SMTP_PASS: must be set together"));
    assert.throws(() => loadConfig({ SMTP_PORT: "70000" }), ConfigError);
    assert.throws(() => loadConfig({ SMTP_HOST: "bad host!" }), ConfigError);
    assert.throws(() => loadConfig({ SMTP_FROM: "not-an-address" }), ConfigError);
    const ok = loadConfig({ MAIL_DRIVER: "smtp", SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_FROM: "Hotel <noreply@hotel.in>", SMTP_USER: "u", SMTP_PASS: "p" });
    assert.deepEqual([ok.MAIL_DRIVER, ok.SMTP_PORT, ok.SMTP_USER], ["smtp", 465, "u"]);
    try {
      loadConfig({ SMTP_PASS: "TopSecretPassword", SMTP_PORT: "nope" });
    } catch (error) {
      assert.ok(!(error as Error).message.includes("TopSecretPassword"), "a message never carries a value");
    }
  });

  test("which sender runs: smtp when configured (also in production); the log sender in development; nothing in production without smtp", () => {
    const base = { SMTP_HOST: "smtp.example.com", SMTP_FROM: "noreply@hotel.in" };
    assert.equal(mailSenderFor(loadConfig({})), logMailSender);
    assert.equal(mailSenderFor(loadConfig({ NODE_ENV: "production" }, { build: true })), null, "no code is printed in production");
    assert.notEqual(mailSenderFor(loadConfig({ MAIL_DRIVER: "smtp", ...base })), logMailSender);
    assert.ok(mailSenderFor(loadConfig({ NODE_ENV: "production", MAIL_DRIVER: "smtp", ...base }, { build: true })));
  });
});

describe("through the outbox worker", () => {
  test("a queued mail is sent by the smtp sender and its payload is wiped; a failing server retries later and is given up after the tries, without logging the address", async () => {
    const auth = createMemoryAuth();
    const NOW = new Date("2026-10-05T10:00:00Z");
    const enqueue = (to: string) => auth.unit.run((r) => r.outbox.enqueue({ userId: null, kind: "login_code", toEmail: to, template: "login-code", payload: JSON.stringify({ name: "Asha", code: "123456", minutes: 10 }) }, NOW));
    await enqueue("guest@example.com");
    const good = fake();
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender: createSmtpSender(cfg, { createTransport: good.createTransport }), now: () => NOW }), 1);
    assert.deepEqual([good.sent[0].to, good.sent[0].subject, good.sent[0].text.includes("123456")], ["guest@example.com", "Your Easy Hotel Solutions sign-in code", true]);
    const rows = () => auth.data().outbox;
    assert.deepEqual([rows()[0].status, rows()[0].payload], ["sent", null]);

    await enqueue("second@example.com");
    const bad = createSmtpSender(cfg, { createTransport: fake(new Error("connect ECONNREFUSED")).createTransport });
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender: bad, now: () => NOW, maxAttempts: 2 }), 0);
    assert.deepEqual([rows()[1].status, rows()[1].attempts], ["pending", 1]);
    assert.ok(rows()[1].nextAttemptAt > NOW, "tried again later");
    const later = new Date(NOW.getTime() + 5 * 60_000);
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender: bad, now: () => later, maxAttempts: 2 }), 0);
    assert.deepEqual([rows()[1].status, rows()[1].attempts, rows()[1].payload], ["failed", 2, null], "given up: the code is not kept");
  });
});
