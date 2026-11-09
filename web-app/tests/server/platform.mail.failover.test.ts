// Platform mail with a BACKUP (migration 0141; MJ, 31 Oct 2026): Amazon SES is the main service, a Google address is the backup. What is guaranteed: a failure on the service's side moves the
// mail to the backup and stays there for the chosen time; a wrong recipient never switches; switching off, or no backup, leaves the main service alone; the app password of the backup is
// stored sealed under its own scope and never returned; the settings view tells where mail goes out from and the last switches.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createFailoverRouter, failoverRuleOf, failoverStateOf, isServiceSideFailure, type FailoverState } from "../../src/server/mail/failover";
import { PLATFORM_BACKUP_SCOPE, readPlatformBackup } from "../../src/server/mail/platformSmtp";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { MailSendError, openSmtpSecret, type SmtpConfig } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import type { MailMessage } from "../../src/server/services/auth/mail";
import { createSettingsService } from "../../src/server/services/platform/settingsService";
import { makeSession } from "./helpers/session";

const MSG: MailMessage = { to: "guest@hotel.in", subject: "Your code", text: "123456" } as MailMessage;
const authFailure = (): Error => new MailSendError("SMTP_FAILED", { code: "EAUTH", responseCode: 535 });
const connectFailure = (): Error => new MailSendError("SMTP_FAILED", { code: "ECONNECTION" });
const badRecipient = (): Error => new MailSendError("REFUSED_INPUT");

function harness(rule = { enabled: true, returnMinutes: 15 }) {
  let clock = Date.parse("2026-10-31T10:00:00Z");
  const saved: FailoverState[] = [];
  const router = createFailoverRouter({ now: () => clock, save: async (s) => void saved.push(s) });
  const calls: string[] = [];
  let mainFails: (() => Error) | null = null;
  let backupFails: (() => Error) | null = null;
  const ctx = (savedState: FailoverState | null = null) => ({
    main: { send: async () => { calls.push("main"); if (mainFails) throw mainFails(); } },
    backup: { send: async () => { calls.push("backup"); if (backupFails) throw backupFails(); } },
    rule,
    saved: savedState,
  });
  return { router, saved, calls, ctx, setMain: (f: (() => Error) | null) => (mainFails = f), setBackup: (f: (() => Error) | null) => (backupFails = f), advance: (ms: number) => (clock += ms) };
}

describe("the failover rules", () => {
  test("which failures the backup can mend", () => {
    for (const code of ["AUTH", "CONNECT", "TLS", "REFUSED", "UNKNOWN"] as const) assert.equal(isServiceSideFailure(code), true, code);
    for (const code of ["RECIPIENT", "NO_SENDER", "RENDER", "NO_HOTEL", "SUPPRESSED", "CANCELLED"] as const) assert.equal(isServiceSideFailure(code), false, code);
  });

  test("the rules default to on and 15 minutes, and out-of-range values are the default", () => {
    assert.deepEqual(failoverRuleOf(undefined, undefined), { enabled: true, returnMinutes: 15 });
    assert.deepEqual(failoverRuleOf(false, 60), { enabled: false, returnMinutes: 60 });
    assert.deepEqual(failoverRuleOf(true, 0), { enabled: true, returnMinutes: 15 });
    assert.deepEqual(failoverRuleOf(true, 1441), { enabled: true, returnMinutes: 15 });
    assert.deepEqual(failoverRuleOf(true, 2.5), { enabled: true, returnMinutes: 15 });
  });

  test("a saved state is read back, and rubbish is no state", () => {
    assert.equal(failoverStateOf(null), null);
    assert.equal(failoverStateOf({ active: "sideways" }), null);
    const s = failoverStateOf({ active: "backup", since: "2026-10-31T10:00:00.000Z", events: [{ at: "2026-10-31T10:00:00.000Z", from: "primary", to: "backup", reason: "x" }, { nope: 1 }] });
    assert.equal(s?.active, "backup");
    assert.equal(s?.events.length, 1);
  });
});

describe("the failover router", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  test("a healthy main service sends alone and nothing is written down", async () => {
    await h.router.send(MSG, h.ctx());
    assert.deepEqual(h.calls, ["main"]);
    assert.equal(h.saved.length, 0);
  });

  test("the main service refusing the login moves that mail, and the next ones, to the backup", async () => {
    h.setMain(authFailure);
    await h.router.send(MSG, h.ctx());
    await h.router.send(MSG, h.ctx());
    assert.deepEqual(h.calls, ["main", "backup", "backup"], "the second mail does not try the failed service again");
    assert.equal(h.router.state().active, "backup");
    assert.equal(h.saved.length, 1);
    assert.deepEqual([h.saved[0]?.events[0]?.from, h.saved[0]?.events[0]?.to, h.saved[0]?.events[0]?.reason], ["primary", "backup", "The main service did not accept the login."]);
  });

  test("an unreachable main service switches too", async () => {
    h.setMain(connectFailure);
    await h.router.send(MSG, h.ctx());
    assert.equal(h.router.state().active, "backup");
    assert.equal(h.router.state().events[0]?.reason, "The main service could not be reached.");
  });

  test("a wrong recipient is the same through any service: no switch, the error goes on", async () => {
    h.setMain(badRecipient);
    await assert.rejects(h.router.send(MSG, h.ctx()), (e: unknown) => (e as MailSendError).reason === "RECIPIENT");
    assert.deepEqual(h.calls, ["main"]);
    assert.equal(h.router.state().active, "primary");
  });

  test("after the chosen time the main service is tried again, and a recovered one takes the mail back", async () => {
    h.setMain(authFailure);
    await h.router.send(MSG, h.ctx());
    h.setMain(null);
    h.advance(14 * 60_000);
    await h.router.send(MSG, h.ctx());
    assert.equal(h.calls.at(-1), "backup", "14 minutes: still on the backup");
    h.advance(61_000);
    await h.router.send(MSG, h.ctx());
    assert.equal(h.calls.at(-1), "main", "15 minutes: the main service is tried again");
    assert.equal(h.router.state().active, "primary");
    assert.deepEqual(h.router.state().events.map((e) => e.to), ["primary", "backup"], "newest first");
  });

  test("a main service still down after the wait switches to the backup again", async () => {
    h.setMain(authFailure);
    await h.router.send(MSG, h.ctx());
    h.advance(16 * 60_000);
    await h.router.send(MSG, h.ctx());
    assert.deepEqual(h.calls, ["main", "backup", "main", "backup"]);
    assert.equal(h.router.state().active, "backup");
  });

  test("when the backup fails too, the main service has the last word", async () => {
    h.setMain(authFailure);
    await h.router.send(MSG, h.ctx());
    h.setBackup(authFailure);
    await assert.rejects(h.router.send(MSG, h.ctx()), (e: unknown) => (e as MailSendError).reason === "AUTH");
    assert.deepEqual(h.calls, ["main", "backup", "backup", "main"]);
    assert.equal(h.router.state().active, "primary");
  });

  test("switched off: the main service alone, a failure is thrown for the retry", async () => {
    const off = harness({ enabled: false, returnMinutes: 15 });
    off.setMain(authFailure);
    await assert.rejects(off.router.send(MSG, off.ctx()));
    assert.deepEqual(off.calls, ["main"]);
    assert.equal(off.saved.length, 0);
  });

  test("a switch another server wrote down is followed", async () => {
    const other: FailoverState = { active: "backup", since: "2026-10-31T10:00:00.000Z", events: [] };
    await h.router.send(MSG, h.ctx(other));
    assert.deepEqual(h.calls, ["backup"]);
  });

  test("the list keeps the last ten switches", async () => {
    for (let i = 0; i < 8; i += 1) {
      h.setMain(authFailure);
      h.setBackup(null);
      await h.router.send(MSG, h.ctx());
      h.setMain(null);
      h.advance(16 * 60_000);
      await h.router.send(MSG, h.ctx());
    }
    assert.equal(h.router.state().events.length, 10);
  });
});

describe("the backup settings", () => {
  const KEY = deriveSmtpKey(randomBytes(32));
  const META = { traceId: "trace-backup-1", ip: "10.0.0.5", userAgent: "node-test" };
  const ids = { sa: randomUUID() };
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const build = () => createSettingsService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-10-31T10:00:00+05:30"), smtp: { secretKey: KEY, sendTest: async (smtp: SmtpConfig) => ({ ok: true, message: `Sent via ${smtp.host}` }) } });
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const fieldsOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? null)) ?? {}) as Record<string, string>;

  beforeEach(() => {
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    auth.data().users.push({ id: ids.sa, username: "sa", email: "sa@demo.hms", mobile: null, displayName: "SA", passwordHash: "x", accountRole: "super_admin", status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  });

  test("nothing saved: no backup, failover on, main service", async () => {
    const v = await build().get(sa());
    assert.deepEqual(v.smtp.backup, { user: "", passwordSet: false, lastChangedAt: null, passwordUnreadable: false, limits: null, lastTest: null });
    assert.deepEqual(v.smtp.failover, { enabled: true, returnMinutes: 15, active: "primary", since: null, events: [] });
  });

  test("a Google address and its app password: stored sealed under its own scope, never returned", async () => {
    const svc = build();
    const v = await svc.update(sa(), { smtp: { backup: { user: " Backup.Desk@Gmail.com ", password: "abcd efgh ijkl mnop" } } }, META);
    assert.equal(v.smtp.backup.user, "backup.desk@gmail.com");
    assert.equal(v.smtp.backup.passwordSet, true);
    assert.deepEqual(v.smtp.backup.limits, { perSecond: 1, perDay: 500 });
    const sealed = String(cons.data.settings.get("mail.backup_password")?.value);
    assert.match(sealed, /^v1\./);
    assert.equal(openSmtpSecret(KEY, sealed, PLATFORM_BACKUP_SCOPE), "abcdefghijklmnop", "spaces are not part of the password");
    assert.throws(() => openSmtpSecret(KEY, sealed, "platform"), "it does not open as the main service's");
    assert.ok(!JSON.stringify(v).includes("abcdefghijklmnop"));
    assert.ok(!JSON.stringify(cons.data.audit).includes("abcdefghijklmnop"));
    const read = readPlatformBackup((k) => cons.data.settings.get(k)?.value ?? null, sealed, KEY);
    assert.equal(read.config?.host, "smtp.gmail.com");
    assert.equal(read.config?.user, "backup.desk@gmail.com");
  });

  test("an address without a password, a bad address, and a bad number of minutes are refused with the field", async () => {
    const svc = build();
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(sa(), { smtp: { backup: { user: "backup@gmail.com" } } }, META))), ["backupPassword"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(sa(), { smtp: { backup: { user: "not an address", password: "abcdefghijklmnop" } } }, META))), ["backupUser"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(sa(), { smtp: { failover: { returnMinutes: 0 } } }, META))), ["failoverMinutes"]);
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(sa(), { smtp: { failover: { returnMinutes: 1441 } } }, META))), ["failoverMinutes"]);
  });

  test("a new address needs its own app password; an empty address switches the backup off and removes the password", async () => {
    const svc = build();
    await svc.update(sa(), { smtp: { backup: { user: "one@gmail.com", password: "abcdefghijklmnop" } } }, META);
    assert.deepEqual(Object.keys(await fieldsOf(svc.update(sa(), { smtp: { backup: { user: "two@gmail.com" } } }, META))), ["backupPassword"]);
    const off = await svc.update(sa(), { smtp: { backup: { user: "" } } }, META);
    assert.deepEqual([off.smtp.backup.user, off.smtp.backup.passwordSet], ["", false]);
  });

  test("the rules are saved and shown", async () => {
    const v = await build().update(sa(), { smtp: { failover: { enabled: false, returnMinutes: 60 } } }, META);
    assert.deepEqual([v.smtp.failover.enabled, v.smtp.failover.returnMinutes], [false, 60]);
  });

  test("the test button tests the backup on its own and keeps its result apart from the main service's", async () => {
    const svc = build();
    await assert.rejects(svc.sendTest(sa(), "me@hotel.in", META, "backup"), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
    await svc.update(sa(), { smtp: { backup: { user: "backup@gmail.com", password: "abcdefghijklmnop" } } }, META);
    const r = await svc.sendTest(sa(), "me@hotel.in", META, "backup");
    assert.deepEqual([r.ok, r.message], [true, "Sent via smtp.gmail.com"]);
    const v = await svc.get(sa());
    assert.equal(v.smtp.backup.lastTest?.ok, true);
    assert.equal(v.smtp.lastTest, null);
  });

  test("changing the backup clears its old test result", async () => {
    const svc = build();
    await svc.update(sa(), { smtp: { backup: { user: "backup@gmail.com", password: "abcdefghijklmnop" } } }, META);
    await svc.sendTest(sa(), "me@hotel.in", META, "backup");
    const v = await svc.update(sa(), { smtp: { backup: { user: "backup@gmail.com", password: "qrstuvwxyzabcdef" } } }, META);
    assert.equal(v.smtp.backup.lastTest, null);
  });

  test("the view tells where mail goes out from and the last switches", async () => {
    const svc = build();
    cons.data.settings.set("mail.failover_state", { key: "mail.failover_state", value: { active: "backup", since: "2026-10-31T04:00:00.000Z", events: [{ at: "2026-10-31T04:00:00.000Z", from: "primary", to: "backup", reason: "The main service could not be reached." }] }, isSecret: false, updatedBy: null, updatedAt: new Date(), updatedByName: null } as never);
    const v = await svc.get(sa());
    assert.equal(v.smtp.failover.active, "backup");
    assert.equal(v.smtp.failover.events[0]?.reason, "The main service could not be reached.");
  });
});
