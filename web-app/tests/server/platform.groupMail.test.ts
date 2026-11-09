// Platform > Hotel and group mail, the GROUP side (platform migration 0162; MJ, 1 Nov 2026), Super Admin only: a group's own Amazon SES and Google login, kept the same way as a hotel's.
// What is guaranteed: the list holds the live groups with which accounts each has; both passwords are sealed under the GROUP's own scopes (a hotel's scope does not open them) and never
// returned or audited; a login needs its password; a login can be removed; the test mail uses the SAVED login; nobody but the Super Admin can read or change any of it; a hotel's mail
// and a group's mail never touch each other.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { groupGmailScope, groupSesScope, hotelSesScope } from "../../src/server/mail/hotelMail";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { openSmtpSecret, type SmtpConfig } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createGroupMailService } from "../../src/server/services/platform/hotelMailService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const META = { traceId: "trace-group-mail-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), sunrise: randomUUID(), lake: randomUUID(), waiting: randomUUID(), hotel: randomUUID() };

describe("group mail", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const tested: { host: string; to: string }[] = [];
  const build = (secretKey: Buffer | null = KEY) =>
    createGroupMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey, sendTest: async (c: SmtpConfig, to: string) => { tested.push({ host: c.host, to }); return { ok: !c.user?.startsWith("bad"), message: c.user?.startsWith("bad") ? "EAUTH 535 login refused" : `Sent via ${c.host}` }; } } });
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const fieldsOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? null)) ?? {}) as Record<string, string>;
  const SES = { region: "ap-southeast-2", user: "AKIAGROUP", password: "group ses 1", from: "Mail@SunriseGroup.in" };
  const group = (id: string, name: string, slug: string, status: "active" | "pending_approval", hotelIds: string[] = []) => {
    cons.data.groups.push({ id, name, slug, status, adminUserId: null, createdAt: new Date("2026-09-01T10:00:00+05:30"), deletedAt: null, legalName: null, gstin: null, address: null, city: null, state: null, pin: null, phone: null, email: null, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null } as never);
    for (const hotelId of hotelIds) cons.data.members.push({ groupId: id, hotelId } as never);
  };

  beforeEach(() => {
    tested.length = 0;
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    group(ids.sunrise, "Sunrise Group", "sunrise-group", "active", [ids.hotel]);
    group(ids.lake, "Lake Group", "lake-group", "active");
    group(ids.waiting, "Waiting Group", "waiting-group", "pending_approval");
  });

  test("the list holds the live groups only, by name, with their hotels and which accounts each has", async () => {
    const svc = build();
    await svc.save(sa(), ids.sunrise, { ses: SES }, META);
    await svc.save(sa(), ids.lake, { gmail: { user: "Lake.Desk@Gmail.com", password: "abcd efgh ijkl mnop" } }, META);
    const list = await svc.list(sa());
    assert.deepEqual(list.map((g) => [g.name, g.hotels, g.ses, g.gmail]), [["Lake Group", 0, false, true], ["Sunrise Group", 1, true, false]]);
  });

  test("each group's address is made by itself from its name and the domain of the saved From address, and follows when that address changes; a Gmail From gives none", async () => {
    const svc = build();
    const put = (v: string | null) => cons.data.settings.set("mail.from_email", { value: v, updatedAt: new Date(0), updatedBy: null });
    put("no-reply@easyhotelsolutions.in");
    assert.deepEqual((await svc.list(sa())).map((g) => g.address), ["lakegroup@easyhotelsolutions.in", "sunrisegroup@easyhotelsolutions.in"]);
    put("no-reply@newdomain.in");
    assert.deepEqual((await svc.list(sa())).map((g) => g.address), ["lakegroup@newdomain.in", "sunrisegroup@newdomain.in"]);
    put("boss@gmail.com");
    assert.deepEqual((await svc.list(sa())).map((g) => g.address), [null, null]);
  });

  test("passwords are sealed under the GROUP's scopes, never returned and never in the audit; a hotel's scope does not open them", async () => {
    const svc = build();
    const v = await svc.save(sa(), ids.sunrise, { ses: SES, gmail: { user: "Desk@Gmail.com", password: "abcd efgh ijkl mnop" }, fromName: " Sunrise Group ", replyTo: "Help@SunriseGroup.in" }, META);
    assert.deepEqual([v.groupName, v.ses.user, v.ses.from, v.ses.region, v.ses.passwordSet, v.gmail.user, v.gmail.passwordSet, v.fromName, v.replyTo], ["Sunrise Group", "AKIAGROUP", "mail@sunrisegroup.in", "ap-southeast-2", true, "desk@gmail.com", true, "Sunrise Group", "help@sunrisegroup.in"]);
    const row = cons.data.groupMail.find((r) => r.groupId === ids.sunrise);
    assert.equal(openSmtpSecret(KEY, String(row?.sesPassword), groupSesScope(ids.sunrise)), "groupses1");
    assert.equal(openSmtpSecret(KEY, String(row?.gmailPassword), groupGmailScope(ids.sunrise)), "abcdefghijklmnop");
    assert.throws(() => openSmtpSecret(KEY, String(row?.sesPassword), hotelSesScope(ids.sunrise)), "a hotel's scope does not open a group's password");
    assert.throws(() => openSmtpSecret(KEY, String(row?.sesPassword), groupSesScope(ids.lake)), "nor another group's");
    const everything = JSON.stringify([v, cons.data.audit]);
    for (const secret of ["groupses1", "group ses 1", "abcdefghijklmnop"]) assert.ok(!everything.includes(secret), secret);
    assert.equal(cons.data.audit.at(-1)?.reason, "Group mail: Sunrise Group");
    assert.equal(cons.data.hotelMail.length, 0, "a group's mail never lands in a hotel's table");
  });

  test("a login needs its password; a login can be removed; a part left out stays", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.save(sa(), ids.sunrise, { ses: { user: "AKIA1", from: "a@sunrisegroup.in" } }, META))), ["sesPassword"]);
    await svc.save(sa(), ids.sunrise, { ses: SES, gmail: { user: "desk@gmail.com", password: "abcdefghijklmnop" } }, META);
    const kept = await svc.save(sa(), ids.sunrise, { fromName: "Front Desk" }, META);
    assert.deepEqual([kept.ses.user, kept.ses.passwordSet, kept.fromName], ["AKIAGROUP", true, "Front Desk"]);
    const removed = await svc.save(sa(), ids.sunrise, { ses: { clear: true } }, META);
    assert.deepEqual([removed.ses.user, removed.ses.passwordSet, removed.gmail.user], ["", false, "desk@gmail.com"]);
  });

  test("a group that is not live (waiting for approval) or unknown is not found", async () => {
    const svc = build();
    await assert.rejects(() => svc.get(sa(), ids.waiting), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
    await assert.rejects(() => svc.save(sa(), randomUUID(), { fromName: "x" }, META), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
  });

  test("the test mail uses the SAVED group login and keeps its result", async () => {
    const svc = build();
    await assert.rejects(() => svc.test(sa(), ids.sunrise, "gmail", "me@x.in", META), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
    await svc.save(sa(), ids.sunrise, { ses: SES }, META);
    const r = await svc.test(sa(), ids.sunrise, "ses", "Me@X.in", META);
    assert.equal(r.ok, true);
    assert.deepEqual(tested, [{ host: "email-smtp.ap-southeast-2.amazonaws.com", to: "me@x.in" }]);
    assert.equal((await svc.get(sa(), ids.sunrise)).ses.lastTest?.ok, true);
  });

  test("only the Super Admin can read, change or test; a Platform Admin cannot", async () => {
    const svc = build();
    await assert.rejects(() => svc.list(pa()));
    await assert.rejects(() => svc.get(pa(), ids.sunrise));
    await assert.rejects(() => svc.save(pa(), ids.sunrise, { fromName: "x" }, META));
    await assert.rejects(() => svc.test(pa(), ids.sunrise, "ses", "me@x.in", META));
  });
});
