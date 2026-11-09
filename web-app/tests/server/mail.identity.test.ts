// Sender identities (MAIL-PROVIDERS-50K, 18 Oct 2026): the DNS records a domain needs for the platform's Amazon SES (DKIM required, SPF and DMARC recommended), the DNS check that looks them up,
// the plain next step, the Super Admin's service (the platform's sending domain and the hotels' own domains), and the router that sends from a hotel's verified domain.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { checkRecords, domainOfAddress, isDomain, recordsFor, statusOf, type DnsLookup } from "../../src/server/mail/identity";
import { createHotelMailRouter } from "../../src/server/mail/hotelSmtp";
import { createSmtpSender, type SmtpTransport } from "../../src/server/mail/smtp";
import type { SettingRow } from "../../src/server/repos/admin";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import type { MailMessage } from "../../src/server/services/auth/mail";
import { identityView, nextStepOf } from "../../src/server/services/platform/identityCore";
import { createIdentityService } from "../../src/server/services/platform/identityService";
import { makeSession } from "./helpers/session";

const TOKENS = ["abcdefghijklmnopqrstuvwxyz1", "abcdefghijklmnopqrstuvwxyz2", "abcdefghijklmnopqrstuvwxyz3"];
const NOW = new Date("2026-10-18T10:00:00Z");

/** A fake DNS: the records of a pretend domain. */
function dnsOf(cnames: Record<string, string[]>, txts: Record<string, string[]> = {}): DnsLookup & { asked: string[] } {
  const asked: string[] = [];
  return { asked, cname: async (n) => (asked.push(n), cnames[n] ?? []), txt: async (n) => (asked.push(n), txts[n] ?? []) };
}
const goodCnames = (domain: string): Record<string, string[]> => Object.fromEntries(TOKENS.map((t) => [`${t}._domainkey.${domain}`, [`${t}.dkim.amazonses.com.`]]));

describe("the records", () => {
  test("a domain name and a domain in an address", () => {
    assert.deepEqual([isDomain("grandhotel.in"), isDomain("mail.easyhotelsolutions.in"), isDomain("nodot"), isDomain("bad domain.in"), isDomain("-x.in")], [true, true, false, false, false]);
    assert.equal(domainOfAddress(" Front@GrandHotel.in "), "grandhotel.in");
    assert.deepEqual([domainOfAddress("nope"), domainOfAddress("a@b"), domainOfAddress("a@b c.in")], [null, null, null]);
  });

  test("with the three DKIM names: three required CNAMEs, then SPF and DMARC as recommended; without them only SPF and DMARC", () => {
    const r = recordsFor("grandhotel.in", TOKENS);
    assert.deepEqual(r.map((x) => [x.id, x.type, x.required]), [["dkim1", "CNAME", true], ["dkim2", "CNAME", true], ["dkim3", "CNAME", true], ["spf", "TXT", false], ["dmarc", "TXT", false]]);
    assert.deepEqual([r[0].name, r[0].value], [`${TOKENS[0]}._domainkey.grandhotel.in`, `${TOKENS[0]}.dkim.amazonses.com`]);
    assert.deepEqual([r[3].name, r[3].value], ["grandhotel.in", "v=spf1 include:amazonses.com ~all"]);
    assert.deepEqual([r[4].name, r[4].value.startsWith("v=DMARC1; p=none;")], ["_dmarc.grandhotel.in", true]);
    assert.deepEqual(recordsFor("grandhotel.in", []).map((x) => x.id), ["spf", "dmarc"]);
  });
});

describe("the DNS check", () => {
  const domain = "grandhotel.in";
  const records = () => recordsFor(domain, TOKENS);

  test("every record found: ok, and the required ones are ok", async () => {
    const dns = dnsOf(goodCnames(domain), { [domain]: ["v=spf1 include:amazonses.com ~all"], [`_dmarc.${domain}`]: ["v=DMARC1; p=none"] });
    const c = await checkRecords(domain, records(), dns, NOW);
    assert.deepEqual(c.records.map((x) => x.state), ["ok", "ok", "ok", "ok", "ok"]);
    assert.equal(c.requiredOk, true);
    assert.equal(c.at, NOW.toISOString());
  });

  test("missing and wrong: a CNAME that points elsewhere is wrong, none at all is missing; SPF without amazonses is wrong; a missing DMARC does not fail the check", async () => {
    const cn = goodCnames(domain);
    cn[`${TOKENS[1]}._domainkey.${domain}`] = ["other.example.com"];
    delete cn[`${TOKENS[2]}._domainkey.${domain}`];
    const dns = dnsOf(cn, { [domain]: ["v=spf1 include:_spf.google.com ~all"] });
    const c = await checkRecords(domain, records(), dns, NOW);
    assert.deepEqual(c.records.map((x) => [x.id, x.state]), [["dkim1", "ok"], ["dkim2", "wrong"], ["dkim3", "missing"], ["spf", "wrong"], ["dmarc", "missing"]]);
    assert.equal(c.requiredOk, false);
    const onlyOptional = await checkRecords(domain, records(), dnsOf(goodCnames(domain)), NOW);
    assert.deepEqual([onlyOptional.records.map((x) => x.state).join(), onlyOptional.requiredOk], ["ok,ok,ok,missing,missing", true], "SPF and DMARC are recommended, not required");
  });

  test("a failing lookup counts as missing, never an error; with no DKIM names yet nothing is required and the check cannot pass", async () => {
    const broken: DnsLookup = { cname: async () => { throw new Error("SERVFAIL"); }, txt: async () => { throw new Error("SERVFAIL"); } };
    const c = await checkRecords(domain, records(), broken, NOW);
    assert.deepEqual([c.records.every((x) => x.state === "missing"), c.requiredOk], [true, false]);
    assert.equal((await checkRecords(domain, recordsFor(domain, []), dnsOf({}, { [domain]: ["v=spf1 include:amazonses.com ~all"] }), NOW)).requiredOk, false);
  });

  test("verified only when the required records are ok AND the platform confirmed the domain in SES", () => {
    const ok = { at: NOW.toISOString(), records: [], requiredOk: true };
    assert.deepEqual([statusOf(ok, true), statusOf(ok, false), statusOf({ ...ok, requiredOk: false }, true), statusOf(null, true)], ["verified", "pending", "pending", "pending"]);
  });
});

describe("the plain next step", () => {
  const base = { domain: "grandhotel.in", fromAddress: "front@grandhotel.in", dkimTokens: [] as string[], sesConfirmed: false, status: "pending" as const, result: null };
  test("each situation says what to do now", () => {
    assert.match(nextStepOf(base), /Waiting for the platform to add grandhotel\.in in Amazon SES/);
    assert.match(nextStepOf({ ...base, dkimTokens: TOKENS }), /Add these records/);
    assert.match(nextStepOf({ ...base, dkimTokens: TOKENS, result: { at: "x", records: [], requiredOk: false } }), /missing or wrong/);
    assert.match(nextStepOf({ ...base, dkimTokens: TOKENS, result: { at: "x", records: [], requiredOk: true } }), /Waiting for the platform to confirm/);
    assert.equal(nextStepOf({ ...base, dkimTokens: TOKENS, sesConfirmed: true, status: "verified", result: { at: "x", records: [], requiredOk: true } }), "Verified. Mail is sent from front@grandhotel.in.");
  });

  test("the view lists every record as unchecked until a check ran, then with what it found", () => {
    const rec = { scope: "h1", ...base, dkimTokens: TOKENS, checkedAt: null };
    assert.ok(identityView(rec, "Grand Hotel").records.every((r) => r.state === "unchecked"));
    const checked = identityView({ ...rec, checkedAt: NOW, result: { at: NOW.toISOString(), requiredOk: false, records: [{ id: "dkim1", state: "ok", found: "x.dkim.amazonses.com" }, { id: "dkim2", state: "missing" }] } }, "Grand Hotel");
    assert.deepEqual(checked.records.slice(0, 3).map((r) => r.state), ["ok", "missing", "unchecked"]);
    assert.deepEqual([checked.hotelName, checked.dkimReady, checked.checkedAt], ["Grand Hotel", true, NOW.toISOString()]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const META = { traceId: "trace-id-1", ip: "10.0.0.9", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID() };
let auth: ReturnType<typeof createMemoryAuth>;
let cons: ReturnType<typeof createMemoryPlatformConsole>;
let hotel: string;
let dns: ReturnType<typeof dnsOf>;
const session = (who: "sa" | "pa") => makeSession({ userId: ids[who], hotelId: "", accountRole: who === "sa" ? "super_admin" : "platform_admin", roleKey: "super_admin", roleLevel: 4 });
const service = () => createIdentityService({ unit: cons.unit, credentials: () => ({}) as never, now: () => NOW, dns });
const failed = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; details?: { fields?: Record<string, string> } });
const setDomain = (d: string | null): void => void cons.data.settings.set("mail.sending_domain", { value: d, updatedAt: NOW, updatedBy: null } as never);

beforeEach(() => {
  auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  dns = dnsOf({});
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  for (const [who, role] of [["sa", "super_admin"], ["pa", "platform_admin"]] as const) {
    auth.data().users.push({ id: ids[who], username: who, email: `${who}@demo.hms`, mobile: null, displayName: who.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  }
  hotel = randomUUID();
  auth.data().hotels.push({ id: hotel, name: "Grand Hotel", status: "active" } as never);
  cons.data.hotels.set(hotel, { slug: "grand-hotel", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: NOW, provisionedAt: NOW, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as never);
});

describe("the platform's sending domain (Super Admin)", () => {
  test("it follows the setting: no domain, no identity; a domain makes a pending one; a changed domain starts again", async () => {
    assert.deepEqual(await service().list(session("sa")), []);
    setDomain("mail.easyhotelsolutions.in");
    const [first] = await service().list(session("sa"));
    assert.deepEqual([first.scope, first.domain, first.status, first.dkimReady, first.records.map((r) => r.id)], ["platform", "mail.easyhotelsolutions.in", "pending", false, ["spf", "dmarc"]]);
    await service().save(session("sa"), "platform", { dkimTokens: TOKENS, sesConfirmed: true }, META);
    setDomain("mail2.easyhotelsolutions.in");
    const [again] = await service().list(session("sa"));
    assert.deepEqual([again.domain, again.dkimReady, again.sesConfirmed, again.status], ["mail2.easyhotelsolutions.in", false, false, "pending"], "a new domain starts again");
    setDomain(null);
    assert.deepEqual(await service().list(session("sa")), []);
  });

  test("DKIM names are checked (three different, letters and digits, lower-cased); the SES confirmation is a flag; both audited; a Platform Admin is refused", async () => {
    setDomain("mail.easyhotelsolutions.in");
    for (const bad of [["only", "two"], [TOKENS[0], TOKENS[0], TOKENS[1]], ["abc", "def", "ghi"], [TOKENS[0], TOKENS[1], "UPPER_not-ok!!"]]) {
      assert.deepEqual(Object.keys((await failed(service().save(session("sa"), "platform", { dkimTokens: bad }, META)))?.details?.fields ?? {}), ["dkimTokens"], bad.join());
    }
    const v = await service().save(session("sa"), "platform", { dkimTokens: TOKENS.map((t) => t.toUpperCase()), sesConfirmed: true }, META);
    assert.deepEqual([v.dkimReady, v.sesConfirmed, v.records[0].name], [true, true, `${TOKENS[0]}._domainkey.mail.easyhotelsolutions.in`]);
    assert.equal(cons.data.audit.filter((a) => a.action === "settings_updated").length, 1);
    assert.equal((await failed(service().save(session("pa"), "platform", { sesConfirmed: true }, META)))?.code, "FORBIDDEN");
    assert.equal((await failed(service().list(session("pa"))))?.code, "FORBIDDEN");
  });

  test("Check DNS: records found + confirmed = verified; records missing = pending with the records marked; the answer is kept", async () => {
    setDomain("mail.easyhotelsolutions.in");
    await service().save(session("sa"), "platform", { dkimTokens: TOKENS }, META);
    const missing = await service().check(session("sa"), "platform", META);
    assert.deepEqual([missing.status, missing.records.slice(0, 3).map((r) => r.state), missing.checkedAt], ["pending", ["missing", "missing", "missing"], NOW.toISOString()]);
    dns = dnsOf(goodCnames("mail.easyhotelsolutions.in"));
    const notConfirmed = await service().check(session("sa"), "platform", META);
    assert.deepEqual([notConfirmed.status, notConfirmed.nextStep.startsWith("The DNS records are right")], ["pending", true]);
    await service().save(session("sa"), "platform", { sesConfirmed: true }, META);
    const verified = await service().check(session("sa"), "platform", META);
    assert.deepEqual([verified.status, verified.nextStep, verified.records.slice(0, 3).map((r) => r.state)], ["verified", "Verified. mail.easyhotelsolutions.in is ready to send from.", ["ok", "ok", "ok"]]);
    assert.equal((await auth.unit.run((r) => r.identities.get("platform")))?.status, "verified");
    assert.ok(dns.asked.includes(`${TOKENS[0]}._domainkey.mail.easyhotelsolutions.in`));
  });

  test("new DKIM names clear the old check; no sending domain is a 404 with a plain sentence", async () => {
    assert.equal((await failed(service().check(session("sa"), "platform", META)))?.code, "NOT_FOUND");
    setDomain("mail.easyhotelsolutions.in");
    await service().save(session("sa"), "platform", { dkimTokens: TOKENS }, META);
    dns = dnsOf(goodCnames("mail.easyhotelsolutions.in"));
    await service().check(session("sa"), "platform", META);
    const other = TOKENS.map((t) => `${t}x`);
    const v = await service().save(session("sa"), "platform", { dkimTokens: other }, META);
    assert.deepEqual([v.checkedAt, v.records.slice(0, 3).map((r) => r.state)], [null, ["unchecked", "unchecked", "unchecked"]]);
  });
});

describe("a hotel's own domain (Super Admin side)", () => {
  test("it appears in the list with the hotel's name; the Super Admin adds the DKIM names and confirms; the check verifies it", async () => {
    await auth.unit.run((r) => r.identities.save(hotel, { domain: "grandhotel.in", fromAddress: "front@grandhotel.in" }));
    const [h] = await service().list(session("sa"));
    assert.deepEqual([h.scope, h.hotelName, h.fromAddress, h.status], [hotel, "Grand Hotel", "front@grandhotel.in", "pending"]);
    await service().save(session("sa"), hotel, { dkimTokens: TOKENS, sesConfirmed: true }, META);
    dns = dnsOf(goodCnames("grandhotel.in"));
    assert.equal((await service().check(session("sa"), hotel, META)).status, "verified");
    assert.equal((await failed(service().save(session("sa"), randomUUID(), { sesConfirmed: true }, META)))?.code, "NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe("the router sends from a hotel's verified domain", () => {
  const KEY = randomBytes(32);
  const rows = (extra: Record<string, string> = {}): SettingRow[] => Object.entries({ "email.mode": "own", "email.provider": "domain", "email.from_address": "front@grandhotel.in", "email.from_name": "{hotel}", ...extra }).map(([key, value]) => ({ key, value, secret: false }));
  const sent: { from: string; replyTo?: string }[] = [];
  const createTransport = (): SmtpTransport => ({ async sendMail(m) { sent.push({ from: m.from, ...(m.replyTo ? { replyTo: m.replyTo } : {}) }); return {}; }, close: () => undefined });
  const platform = () => createSmtpSender({ host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", from: '"HMS" <mail@mail.easyhotelsolutions.in>', sendingDomain: "mail.easyhotelsolutions.in" }, { createTransport });
  const msg: MailMessage = { to: "guest@x.in", subject: "S", text: "T", hotelId: "h1" };

  test("verified: From is the hotel's own address (with its name); the reply-to is the same address; no connection of its own is used", async () => {
    sent.length = 0;
    const router = createHotelMailRouter({ platform: platform(), secretKey: KEY, settingsOf: async () => ({ rows: rows(), hotelName: "Grand Hotel", slug: "grand-hotel", domainFrom: "front@grandhotel.in" }), createTransport });
    await router.send(msg);
    assert.deepEqual(sent, [{ from: '"Grand Hotel" <front@grandhotel.in>', replyTo: "front@grandhotel.in" }]);
    router.close();
  });

  test("not verified yet: the mail still goes, from the hotel's platform address, with the hotel's address as the reply-to", async () => {
    sent.length = 0;
    const router = createHotelMailRouter({ platform: platform(), secretKey: KEY, settingsOf: async () => ({ rows: rows(), hotelName: "Grand Hotel", slug: "grand-hotel", domainFrom: null }), createTransport });
    await router.send(msg);
    assert.deepEqual(sent, [{ from: '"Grand Hotel" <grandhotel@mail.easyhotelsolutions.in>', replyTo: "front@grandhotel.in" }]);
    router.close();
  });

  test("a From address the platform sender was not told to trust is refused when it is not an address", async () => {
    const bad = platform();
    await assert.rejects(() => bad.send({ ...msg, fromAddress: "evil@x.com\nBcc: a@b.in" }), (e: unknown) => (e as { code?: string }).code === "REFUSED_INPUT");
  });
});
