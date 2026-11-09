// Conversations, connections only to PUBLIC mail servers (decision 66, A13): a typed IMAP or SMTP server name could point HMS at its own network (a cloud metadata address,
// a database). The name is resolved once, every address must be public, and the connection goes to that address with the certificate checked against the name. Bare IP
// addresses and localhost are refused when saved; IMAP ports are 993 and 143 only.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createImapClientFactory } from "../../src/server/mail/imap";
import { isPrivateAddress, isSafeHostName, MailHostError, resolvePublicHost } from "../../src/server/mail/safeHost";
import { sendRaw, verifySmtp } from "../../src/server/mail/smtp";
import { createFakeSmtp, PUBLIC_LOOKUP } from "./helpers/conversations";

const answers = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const refusedWith = (code: string) => (e: unknown) => e instanceof MailHostError && e.code === code && !/\d+\.\d+\.\d+\.\d+/.test(e.message);
const SMTP = { host: "smtp.hotel.example", port: 587, security: "starttls" as const, user: "desk@hotel.example", pass: "secret-pass", from: "desk@hotel.example" };

describe("which server names may be saved", () => {
  test("localhost, *.localhost, bare IPv4/IPv6 literals, numeric spellings and names without a dot are refused; public names pass", () => {
    for (const bad of ["localhost", "mail.localhost", "127.0.0.1", "10.0.0.1", "::1", "[::1]", "0x7f.1", "2130706433", "intranet", "a..b", ".example.com", "imap.example.com:993", "imap example.com"]) assert.equal(isSafeHostName(bad), false, bad);
    for (const good of ["imap.gmail.com", "IMAP.Hotel.Example", "mail-1.hotel.co.in"]) assert.equal(isSafeHostName(good), true, good);
  });

  test("private, loopback, link-local, carrier NAT, unique local, multicast and IPv4-mapped forms are not public", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe"]) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ["203.0.113.10", "142.250.4.108", "2607:f8b0:4004:c1b::6d", "::ffff:142.250.4.108"]) assert.equal(isPrivateAddress(ip), false, ip);
  });
});

describe("resolving before connecting", () => {
  test("a name that resolves to 10.0.0.1, to the metadata address, or to ::ffff:127.0.0.1 is refused with a plain sentence; one bad answer among good ones is enough", async () => {
    await assert.rejects(resolvePublicHost("imap.inside.example", { lookup: answers("10.0.0.1") }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("imap.inside.example", { lookup: answers("169.254.169.254") }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("imap.inside.example", { lookup: answers("::ffff:127.0.0.1") }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("imap.inside.example", { lookup: answers("203.0.113.10", "127.0.0.1") }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("localhost", { lookup: PUBLIC_LOOKUP }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("127.0.0.1", { lookup: PUBLIC_LOOKUP }), refusedWith("HOST_PRIVATE"));
    await assert.rejects(resolvePublicHost("nowhere.example", { lookup: async () => Promise.reject(new Error("ENOTFOUND")) }), refusedWith("HOST_UNRESOLVED"));
    assert.equal(new MailHostError("HOST_PRIVATE").message, "This server address is not on the internet.");
  });

  test("a public name: the connection goes to the resolved address and the TLS name check uses the host (no second lookup can switch it)", async () => {
    assert.deepEqual(await resolvePublicHost("IMAP.Hotel.Example", { lookup: PUBLIC_LOOKUP }), { address: "203.0.113.10", servername: "imap.hotel.example" });
    const smtp = createFakeSmtp();
    const check = await verifySmtp(SMTP, smtp.factory, PUBLIC_LOOKUP);
    assert.equal(check.ok, true);
    await sendRaw(SMTP, { raw: Buffer.from("Subject: x\r\n\r\nx"), envelope: { from: "desk@hotel.example", to: ["a@b.in"] } }, { createTransport: smtp.factory, lookup: PUBLIC_LOOKUP });
    for (const options of smtp.options) {
      assert.equal(options.host, "203.0.113.10");
      assert.deepEqual(options.tls, { servername: "smtp.hotel.example", minVersion: "TLSv1.2" });
    }
  });

  test("a private SMTP host is refused before any connection; the IMAP client refuses before loading anything", async () => {
    const smtp = createFakeSmtp();
    const check = await verifySmtp({ ...SMTP, host: "smtp.inside.example" }, smtp.factory, answers("192.168.0.5"));
    assert.deepEqual([check.ok, check.code, check.message], [false, "HOST_PRIVATE", "This server address is not on the internet."]);
    assert.equal(smtp.options.length, 0);
    await assert.rejects(sendRaw({ ...SMTP, host: "smtp.inside.example" }, { raw: Buffer.from("x"), envelope: { from: "a@b.in", to: ["c@d.in"] } }, { createTransport: smtp.factory, lookup: answers("192.168.0.5") }), refusedWith("HOST_PRIVATE"));
    const imap = createImapClientFactory({ lookup: answers("169.254.169.254") });
    await assert.rejects(imap({ host: "imap.inside.example", port: 993, user: "u", pass: "p" }), refusedWith("HOST_PRIVATE"));
  });
});
