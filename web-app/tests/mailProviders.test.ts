// Unit tests for ui-shared/dashboards/mailProviders.ts, the reading part (decision 66): which mail service can read its mailbox in Conversations, the known IMAP servers, the
// IMAP server offered from an SMTP host, the two IMAP ports, the plain host check of the form, and the sentences of Settings > Email's Reading block and Test connection.
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The shared code writes extensionless relative imports (bundler style). Plain Node needs the extension, so retry unresolved relative imports with ".ts".
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { IMAP_PRESETS, MAIL_IMAP_PORT_OPTIONS, MAIL_PROVIDER_OPTIONS, imapHostError, mailProviderCopy, suggestImapHost } = await import("../../common/ui-shared/dashboards/mailProviders");

describe("reading per mail service", () => {
  test("Gmail reads from a fixed server, another SMTP server by its typed IMAP server, the services that only send never read", () => {
    const reading = Object.fromEntries(MAIL_PROVIDER_OPTIONS.map((o) => [o.id, o.reading]));
    assert.deepEqual(reading, { ses: "none", brevo: "none", gmail: "fixed", smtp: "server", domain: "none" });
  });

  test("every service says how it reads", () => {
    for (const o of MAIL_PROVIDER_OPTIONS) assert.ok(["fixed", "server", "none"].includes(o.reading), o.id);
  });
});

describe("IMAP_PRESETS", () => {
  test("Gmail is imap.gmail.com on port 993, as the server's own preset", () => {
    const gmail = IMAP_PRESETS.find((p) => p.id === "gmail");
    assert.deepEqual(gmail && { smtpHost: gmail.smtpHost, imapHost: gmail.imapHost, port: gmail.port }, { smtpHost: "smtp.gmail.com", imapHost: "imap.gmail.com", port: 993 });
  });

  test("ids and SMTP hosts are unique, every host is a plain public name in lower case, every port is 993", () => {
    assert.equal(new Set(IMAP_PRESETS.map((p) => p.id)).size, IMAP_PRESETS.length);
    assert.equal(new Set(IMAP_PRESETS.map((p) => p.smtpHost)).size, IMAP_PRESETS.length);
    for (const p of IMAP_PRESETS) {
      for (const h of [p.smtpHost, p.imapHost]) {
        assert.match(h, /^[a-z0-9.-]+\.[a-z]{2,}$/, h);
        assert.equal(imapHostError(h), null, h);
      }
      assert.equal(p.port, 993);
    }
  });
});

describe("suggestImapHost", () => {
  test("a known service gives its own reading server", () => {
    assert.equal(suggestImapHost("smtp.gmail.com"), "imap.gmail.com");
    assert.equal(suggestImapHost(" SMTP.Office365.com "), "outlook.office365.com");
    assert.equal(suggestImapHost("smtp.zoho.in"), "imap.zoho.in");
    assert.equal(suggestImapHost("smtpout.secureserver.net"), "imap.secureserver.net");
  });

  test("smtp.<domain> becomes imap.<domain>; a mail.<domain> server reads too", () => {
    assert.equal(suggestImapHost("smtp.hotelsunrise.in"), "imap.hotelsunrise.in");
    assert.equal(suggestImapHost("mail.hotelsunrise.in"), "mail.hotelsunrise.in");
    assert.equal(suggestImapHost("smtp.hotelsunrise.in."), "imap.hotelsunrise.in");
  });

  test("nothing sensible to guess gives an empty box, never a guess from junk", () => {
    for (const h of ["", "localhost", "smtp.in", "relay.example.com", "smtp.example.com/x", "smtp .example.com", "smtp-relay.example.com"]) assert.equal(suggestImapHost(h), "", h);
  });
});

describe("IMAP ports and the host check", () => {
  test("only 993 (SSL/TLS) and 143 (STARTTLS) are offered, 993 first", () => {
    assert.deepEqual(
      MAIL_IMAP_PORT_OPTIONS.map((p) => p.id),
      ["993", "143"],
    );
    assert.match(MAIL_IMAP_PORT_OPTIONS[0].label, /SSL\/TLS/);
    assert.match(MAIL_IMAP_PORT_OPTIONS[1].label, /STARTTLS/);
  });

  test("bare IP addresses, localhost, names without a dot and odd characters are refused in plain words", () => {
    for (const h of ["127.0.0.1", "10.0.0.1", "localhost", "mail.localhost", "intranet", "", "imap.example.com:993", "imap example.com", "http://imap.example.com"]) {
      assert.equal(imapHostError(h), mailProviderCopy.reading.errors.imapHost, h);
    }
    assert.equal(imapHostError("imap.example.com"), null);
    assert.equal(imapHostError(" imap.example.com "), null);
  });
});

describe("the Reading block and Test connection words", () => {
  test("the Gmail line says it uses the same app password and brings in the last 14 days", () => {
    assert.match(mailProviderCopy.reading.gmail, /same app password/);
    assert.match(mailProviderCopy.reading.gmail, /last 14 days/);
    assert.match(mailProviderCopy.reading.gmail, /every 1 to 2 minutes/);
  });

  test("the privacy warning names password-reset emails and asks for a front-desk address", () => {
    assert.equal(mailProviderCopy.reading.privacy, "Everyone with Conversations access can read every email in this mailbox, including password-reset emails. Use a front-desk address, not the owner's personal account.");
  });

  test("Test connection: save first, the two rows, Checking..., and the time of the saved settings", () => {
    const t = mailProviderCopy.reading.test;
    assert.equal(t.saveFirst, "Save first, then test.");
    assert.equal(t.checking, "Checking...");
    assert.equal(t.imap, "Reading (IMAP)");
    assert.equal(t.smtp, "Sending (SMTP)");
    assert.equal(t.testedAt("25-10-2026 10:30"), "Tested the saved settings, 25-10-2026 10:30");
  });

  test("the send-only note matches the Conversations setup sentence", () => {
    assert.equal(mailProviderCopy.reading.sendOnly, "Your mail service only sends. Gmail or your own mail server is needed to read mail.");
  });
});
