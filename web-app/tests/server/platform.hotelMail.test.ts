// Platform > Hotel mail (platform migration 0161; MJ, 1 Nov 2026), Super Admin only: a hotel's own Amazon SES and Google login. What is guaranteed: the list shows which hotels have which; a save
// stores both passwords sealed under the hotel's own scopes and never returns or audits them; a login needs its password (a changed user name needs a new one); a part left out stays;
// a login can be removed; the test mail uses the SAVED login and keeps its result; nobody but the Super Admin can read or change any of it.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { hotelGmailScope, hotelSesScope } from "../../src/server/mail/hotelMail";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { openSmtpSecret, type SmtpConfig } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelMailService } from "../../src/server/services/platform/hotelMailService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const META = { traceId: "trace-hotel-mail-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), sunrise: randomUUID(), gir: randomUUID(), pending: randomUUID() };

describe("hotel mail", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const tested: { host: string; to: string }[] = [];
  const build = (secretKey: Buffer | null = KEY) =>
    createHotelMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey, sendTest: async (c: SmtpConfig, to: string) => { tested.push({ host: c.host, to }); return { ok: !c.user?.startsWith("bad"), message: c.user?.startsWith("bad") ? "EAUTH 535 login refused" : `Sent via ${c.host}` }; } } });
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const fieldsOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? null)) ?? {}) as Record<string, string>;
  const SES = { region: "ap-south-1", user: "AKIASUNRISE", password: "ses secret 1", from: "Bookings@Sunrise.in" };
  const meta = (slug: string): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
  } as MemHotelMeta);

  beforeEach(() => {
    tested.length = 0;
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    for (const [id, name, status, slug] of [[ids.sunrise, "Hotel Sunrise", "active", "hotel-sunrise"], [ids.gir, "Gir Forest Lodge", "suspended", "gir"], [ids.pending, "Moonlight Inn", "pending_approval", "moonlight"]] as const) {
      auth.data().hotels.push({ id, name, status } as never);
      cons.data.hotels.set(id, meta(slug));
    }
  });

  test("the list holds the live hotels only, by name, with which accounts each has", async () => {
    const svc = build();
    await svc.save(sa(), ids.sunrise, { ses: SES }, META);
    await svc.save(sa(), ids.gir, { gmail: { user: "Gir.Desk@Gmail.com", password: "abcd efgh ijkl mnop" } }, META);
    const list = await svc.list(sa());
    assert.deepEqual(list.map((h) => [h.name, h.ses, h.gmail]), [["Gir Forest Lodge", false, true], ["Hotel Sunrise", true, false]]);
  });

  test("both passwords are stored sealed under their own scopes, never returned and never in the audit", async () => {
    const svc = build();
    const v = await svc.save(sa(), ids.sunrise, { ses: SES, gmail: { user: "Desk@Gmail.com", password: "abcd efgh ijkl mnop" }, fromName: " Sunrise Desk ", replyTo: "Help@Sunrise.in" }, META);
    assert.deepEqual([v.ses.user, v.ses.from, v.ses.region, v.ses.passwordSet, v.gmail.user, v.gmail.passwordSet, v.fromName, v.replyTo], ["AKIASUNRISE", "bookings@sunrise.in", "ap-south-1", true, "desk@gmail.com", true, "Sunrise Desk", "help@sunrise.in"]);
    const row = cons.data.hotelMail.find((r) => r.hotelId === ids.sunrise);
    assert.equal(openSmtpSecret(KEY, String(row?.sesPassword), hotelSesScope(ids.sunrise)), "sessecret1", "spaces are not part of it");
    assert.equal(openSmtpSecret(KEY, String(row?.gmailPassword), hotelGmailScope(ids.sunrise)), "abcdefghijklmnop");
    assert.throws(() => openSmtpSecret(KEY, String(row?.sesPassword), hotelSesScope(ids.gir)), "another hotel's scope does not open it");
    assert.throws(() => openSmtpSecret(KEY, String(row?.sesPassword), hotelGmailScope(ids.sunrise)), "nor the other account's");
    const everything = JSON.stringify([v, cons.data.audit]);
    for (const secret of ["sessecret1", "ses secret 1", "abcdefghijklmnop"]) assert.ok(!everything.includes(secret), secret);
    assert.equal(cons.data.audit.at(-1)?.reason, "Hotel mail: Hotel Sunrise");
  });

  test("a login needs its password; a changed user name needs a new one; a part left out stays", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), ids.sunrise, { ses: { user: "AKIA1", from: "a@sunrise.in" } }, META))), ["sesPassword"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), ids.sunrise, { gmail: { user: "desk@gmail.com" } }, META))), ["gmailPassword"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), ids.sunrise, { ses: { user: "AKIA1", password: "p" } }, META))), ["sesFrom"]);
    await svc.save(sa(), ids.sunrise, { ses: SES }, META);
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), ids.sunrise, { ses: { user: "AKIANEW" } }, META))), ["sesPassword"], "a new user name needs a new password");
    const v = await svc.save(sa(), ids.sunrise, { fromName: "Front Desk" }, META);
    assert.deepEqual([v.ses.user, v.ses.passwordSet, v.fromName], ["AKIASUNRISE", true, "Front Desk"]);
    const keep = await svc.save(sa(), ids.sunrise, { ses: { from: "front@sunrise.in" } }, META);
    assert.deepEqual([keep.ses.from, keep.ses.passwordSet], ["front@sunrise.in", true]);
  });

  test("bad values are refused with their field, and no password can be saved without the mail key", async () => {
    const svc = build();
    const f = await fieldsOf(svc.save(sa(), ids.sunrise, { ses: { region: "mumbai", user: "x", password: "p", from: "not-an-address" }, gmail: { user: "nope" }, replyTo: "also nope", fromName: "x".repeat(101) }, META));
    assert.deepEqual(Object.keys(f).sort(), ["fromName", "gmailUser", "replyTo", "sesFrom", "sesRegion"]);
    assert.deepEqual(Object.keys(await fieldsOf(build(null).save(sa(), ids.sunrise, { ses: SES }, META))), ["sesPassword"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), randomUUID(), { fromName: "x" }, META))), [], "an unknown hotel is not found");
    await assert.rejects(() => svc.get(sa(), randomUUID()));
    await assert.rejects(() => svc.get(sa(), ids.pending), "a hotel still waiting for approval has no mail yet");
  });

  test("an account is removed by itself: its login, password and test result go; the other stays", async () => {
    const svc = build();
    await svc.save(sa(), ids.sunrise, { ses: SES, gmail: { user: "desk@gmail.com", password: "abcdefghijklmnop" } }, META);
    const v = await svc.save(sa(), ids.sunrise, { ses: { clear: true } }, META);
    assert.deepEqual([v.ses.user, v.ses.passwordSet, v.gmail.user, v.gmail.passwordSet], ["", false, "desk@gmail.com", true]);
    assert.equal(cons.data.hotelMail.find((r) => r.hotelId === ids.sunrise)?.sesPassword, null);
  });

  test("a test mail uses the SAVED login, keeps its result, and says plainly when nothing is saved", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.test(sa(), ids.sunrise, "gmail", "me@owner.in", META))), ["to"], "no Google login saved yet");
    // Amazon SES is automatic: with no platform SES saved there is nothing to send with, and the answer says so plainly instead of refusing
    const none = await svc.test(sa(), ids.sunrise, "ses", "me@owner.in", META);
    assert.equal(none.ok, false);
    await svc.save(sa(), ids.sunrise, { ses: SES, gmail: { user: "bad.desk@gmail.com", password: "abcdefghijklmnop" } }, META);
    assert.deepEqual(Object.keys(await fieldsOf(svc.test(sa(), ids.sunrise, "ses", "not an address", META))), ["to"]);
    const ok = await svc.test(sa(), ids.sunrise, "ses", " Me@Owner.in ", META);
    assert.deepEqual([ok.ok, ok.message, tested.at(-1)], [true, "Sent via email-smtp.ap-south-1.amazonaws.com", { host: "email-smtp.ap-south-1.amazonaws.com", to: "me@owner.in" }]);
    const bad = await svc.test(sa(), ids.sunrise, "gmail", "me@owner.in", META);
    assert.deepEqual([bad.ok, bad.message], [false, "EAUTH 535 login refused"]);
    const v = await svc.get(sa(), ids.sunrise);
    assert.deepEqual([v.ses.lastTest?.ok, v.gmail.lastTest?.ok], [true, false]);
    assert.ok(!JSON.stringify(cons.data.audit).includes("owner.in"), "the audit holds no recipient");
  });

  test("only the Super Admin: a platform admin can neither read nor change anything", async () => {
    const svc = build();
    await assert.rejects(() => svc.list(pa()));
    await assert.rejects(() => svc.get(pa(), ids.sunrise));
    await assert.rejects(() => svc.save(pa(), ids.sunrise, { fromName: "x" }, META));
    await assert.rejects(() => svc.test(pa(), ids.sunrise, "ses", "me@owner.in", META));
    assert.equal(cons.data.hotelMail.length, 0);
  });
});
