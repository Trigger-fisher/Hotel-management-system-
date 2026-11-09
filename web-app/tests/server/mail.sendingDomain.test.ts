// A hotel's (or group's) address on the platform's mail is <slug>@<domain of the Super Admin's From address>, derived when the mail is sent: nothing is stored per hotel, so changing the
// From address moves every hotel, and a Gmail address or a reserved name (support, billing, ...) never becomes a hotel's address (src/server/mail/sendingDomain.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readPlatformSmtp } from "../../src/server/mail/platformSmtp";
import { domainOfAddress, isReservedLocal, mailAddressOf, sendingDomainOf } from "../../src/server/mail/sendingDomain";
import { createSmtpSender, type SmtpTransport } from "../../src/server/mail/smtp";

describe("sending domain", () => {
  test("the domain is the part after the @ of the From address; a Gmail address gives none; the older stored row only counts without an address", () => {
    assert.equal(domainOfAddress("No-Reply@EasyHotelSolutions.in"), "easyhotelsolutions.in");
    assert.equal(domainOfAddress("not an address"), null);
    assert.equal(sendingDomainOf("no-reply@easyhotelsolutions.in", "old.example.com"), "easyhotelsolutions.in");
    assert.equal(sendingDomainOf("boss@gmail.com", null), null);
    assert.equal(sendingDomainOf("boss@googlemail.com", "mail.easyhotelsolutions.in"), "mail.easyhotelsolutions.in");
    assert.equal(sendingDomainOf(null, "mail.easyhotelsolutions.in"), "mail.easyhotelsolutions.in");
    assert.equal(sendingDomainOf(null, "gmail.com"), null);
    assert.equal(sendingDomainOf("", ""), null);
  });

  test("hotel and group addresses are <slug>@<domain>; a reserved name or no domain gives none", () => {
    assert.equal(mailAddressOf("hotel-pallav", "easyhotelsolutions.in"), "hotelpallav@easyhotelsolutions.in");
    assert.equal(mailAddressOf("sunrise-group", "easyhotelsolutions.in"), "sunrisegroup@easyhotelsolutions.in");
    assert.equal(mailAddressOf("no-reply", "easyhotelsolutions.in"), null);
    assert.equal(mailAddressOf("support", "easyhotelsolutions.in"), null);
    assert.equal(mailAddressOf("Billing", "easyhotelsolutions.in"), null);
    assert.equal(mailAddressOf("hotel-pallav", null), null);
    assert.equal(isReservedLocal("no-reply"), true);
    assert.equal(isReservedLocal("hotel-pallav"), false);
  });

  test("the platform mail server carries the domain of its From address, and it follows when that address changes", () => {
    const rows = (from: string): ((k: string) => unknown) => {
      const v: Record<string, unknown> = { "mail.smtp_host": "email-smtp.ap-southeast-2.amazonaws.com", "mail.smtp_port": 587, "mail.from_name": "EasyHotelSolutions", "mail.from_email": from, "mail.sending_domain": "stale.example.com" };
      return (k) => v[k] ?? null;
    };
    assert.equal(readPlatformSmtp(rows("no-reply@easyhotelsolutions.in"), null, null, undefined).config?.sendingDomain, "easyhotelsolutions.in");
    assert.equal(readPlatformSmtp(rows("no-reply@newname.in"), null, null, undefined).config?.sendingDomain, "newname.in");
  });

  test("a hotel mail goes out as <slug>@<domain> with the hotel's name; a reserved slug falls back to the platform address", async () => {
    const sent: string[] = [];
    const createTransport = (): SmtpTransport => ({ async sendMail(m) { sent.push(m.from); return {}; }, close: () => undefined });
    const platform = createSmtpSender({ host: "h.example.com", port: 587, security: "starttls", from: '"Platform" <no-reply@easyhotelsolutions.in>', sendingDomain: "easyhotelsolutions.in" }, { createTransport });
    const msg = { to: "guest@x.in", subject: "S", text: "T" };
    await platform.send({ ...msg, fromName: "Hotel Pallav", fromLocal: "hotel-pallav" });
    await platform.send({ ...msg, fromName: "Support", fromLocal: "support" });
    assert.deepEqual(sent, ['"Hotel Pallav" <hotelpallav@easyhotelsolutions.in>', '"Support" <no-reply@easyhotelsolutions.in>']);
  });
});
