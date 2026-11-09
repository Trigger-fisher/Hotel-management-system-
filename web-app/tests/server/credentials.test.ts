// The CredentialService (the port Worker B's Admin calls) and the profile's credential methods, on the in-memory platform data with the real
// argon2id hasher. Pallav-exact where Pallav has the behaviour (ProfileController::changePassword, OneTimeCode, PasswordPolicy), HMS (#13/D2)
// where MJ changed it: a temporary password is mailed, there is no authenticator app and no invite link, administrators always need the code.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createCredentialService, randomTempPassword, CURRENT_PASSWORD_MESSAGE, EMAIL_INVALID_MESSAGE, EMAIL_SAME_MESSAGE, EMAIL_TAKEN_MESSAGE, REUSED_MESSAGE } from "../../src/server/services/auth/credentialService";
import { passesPasswordRegex, PASSWORD_MESSAGE } from "../../src/server/services/auth/policy";
import { AppError } from "../../src/server/errors";
import type { VerifiedSession } from "../../src/server/auth/session";
import type { SessionRecord } from "../../src/server/repos/auth";
import { PASSWORD, buildWorld, hashKey, type World, type Who } from "./helpers/authWorld";
import { hashSessionToken } from "../../src/server/auth/tokens";

let w: World;
let temp: string[];
let tempIndex: number;
const nextTemp = (): string => temp[tempIndex++ % temp.length];

beforeEach(async () => {
  w = await buildWorld();
  temp = ["Temp#Pass1234", "Temp#Pass5678", "Temp#Pass9012", "Temp#Pass3456"];
  tempIndex = 0;
});

const service = () => createCredentialService({ unit: w.mem.unit, hasher: w.hasher, now: () => new Date(w.clock.at.getTime()), newTempPassword: nextTemp });
const META = { ip: "10.0.0.9", traceId: "trace-credentials-1" } as never;

let tokenCounter = 0;
/** A browser session. `loose` puts a second, longer one straight into the data (the database allows one active session per person, so this stands for rows from before that rule): the session-list features still have to work on them. */
async function addSession(who: Who, loose = false): Promise<SessionRecord> {
  const at = w.clock.at;
  const row = {
    userId: w.users[who].id, hotelId: "11111111-1111-4111-8111-111111111111", client: "web" as const,
    tokenHash: hashSessionToken(`token-${tokenCounter++}-${"x".repeat(40)}`), deviceLabel: loose ? "Edge on Windows" : "Chrome on Windows", userAgent: null, ip: "10.0.0.1",
    issuedAt: at, lastSeenAt: at, expiresAt: new Date(at.getTime() + (loose ? 24 * 60 : 60) * 60_000),
  };
  if (loose) {
    const record: SessionRecord = { ...row, id: randomUUID(), revokedAt: null, revokedReason: null };
    w.data.sessions.push(record);
    return record;
  }
  return w.mem.unit.run((r) => r.sessions.insert(row));
}
const asSession = (who: Who, sessionId: string): VerifiedSession => ({
  userId: w.users[who].id, hotelId: "11111111-1111-4111-8111-111111111111", accountRole: w.users[who].accountRole, roleId: w.users[who].roleId, roleKey: "viewer", roleLevel: 1,
  permissions: {}, sessionId, client: "web",
});
const activeSessions = (who: Who) => w.data.sessions.filter((s) => s.userId === w.users[who].id && s.revokedAt === null);
const user = (who: Who) => w.data.users.find((u) => u.id === w.users[who].id)!;
const rejects = (promise: Promise<unknown>, code: string, message?: string): Promise<void> =>
  assert.rejects(promise, (e: unknown) => e instanceof AppError && e.code === code && (message === undefined || e.message === message), `${code} ${message ?? ""}`);

describe("the temporary password generator", () => {
  test("always passes Pallav's password rule, is 12 characters, and differs every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p = randomTempPassword();
      assert.equal(p.length, 12);
      assert.ok(passesPasswordRegex(p), p);
      seen.add(p);
    }
    assert.equal(seen.size, 300);
  });
});

describe("issueInvite (a new account: a temporary password by email)", () => {
  beforeEach(() => void w.data.users.find((u) => u.id === w.users.firsttime.id));

  test("an invited person gets a temporary password they must change: the old hash is gone, the new one verifies, status stays invited", async () => {
    const before = user("firsttime").passwordHash;
    const out = await service().issueInvite(w.users.firsttime.id);
    assert.deepEqual(out, { queued: true });
    const u = user("firsttime");
    assert.notEqual(u.passwordHash, before);
    assert.equal(await w.hasher.verify(u.passwordHash, "Temp#Pass1234"), true);
    assert.equal(await w.hasher.verify(u.passwordHash, PASSWORD), false);
    assert.equal(u.mustChangePassword, true);
    assert.equal(u.status, "invited");
    assert.equal(u.passwordChangedAt, null);
  });

  test("the mail carries the user name and the temporary password ONLY inside the outbox; nothing readable is stored or audited", async () => {
    await service().issueInvite(w.users.firsttime.id);
    const mail = w.mailed(w.users.firsttime.id, "temp_password");
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, "firsttime@demo.hms");
    assert.equal(mail[0].payload?.tempPassword, "Temp#Pass1234");
    assert.equal(mail[0].payload?.username, "firsttime");
    const stored = JSON.stringify({ events: w.data.events, audit: w.data.audit, users: w.data.users.map((u) => ({ ...u, passwordHash: undefined })) });
    assert.ok(!stored.includes("Temp#Pass1234"), "the temporary password is nowhere in plain text");
    assert.ok(w.data.outbox.every((o) => o.toEmail.includes("@")));
    assert.ok(w.data.audit.some((a) => a.action === "user.invite_issued" && a.entityId === w.users.firsttime.id));
  });

  test("a person without an email address is set up but nothing is queued (queued: false); an unknown or deleted person is NOT_FOUND; an active account is a CONFLICT", async () => {
    w.data.users.find((u) => u.id === w.users.firsttime.id)!.email = null;
    assert.deepEqual(await service().issueInvite(w.users.firsttime.id), { queued: false });
    assert.equal(w.data.outbox.length, 0);
    await rejects(service().issueInvite("00000000-0000-4000-8000-000000000000"), "NOT_FOUND");
    w.data.users.find((u) => u.id === w.users.disabled.id)!.deletedAt = new Date(w.clock.at);
    await rejects(service().issueInvite(w.users.disabled.id), "NOT_FOUND");
    await rejects(service().issueInvite(w.users.staff.id), "CONFLICT");
  });

  test("the person can sign in with the temporary password and is sent to choose their own (the sign-in answers 'change password')", async () => {
    await service().issueInvite(w.users.firsttime.id);
    const result = await w.service.signIn({ username: "firsttime", password: "Temp#Pass1234", device: { platform: "web", name: "Chrome on Windows" } as never }, META, () => undefined);
    assert.equal((result.data as { status: string }).status, "password_change_required");
    const old = await w.service.signIn({ username: "firsttime", password: PASSWORD, device: { platform: "web", name: "Chrome on Windows" } as never }, META, () => undefined).catch((e: unknown) => e);
    assert.ok(old instanceof AppError && old.code === "INVALID_CREDENTIALS");
  });
});

describe("adminResetPassword", () => {
  test("a reset ends every session, sets a temporary password and the must-change flag, clears a timed lock, and mails the person", async () => {
    await addSession("anita");
    await addSession("anita", true);
    w.data.users.find((u) => u.id === w.users.anita.id)!.lockedUntil = new Date(w.clock.at.getTime() + 3_600_000);
    const out = await service().adminResetPassword(w.users.anita.id);
    assert.deepEqual(out, { queued: true });
    assert.equal(activeSessions("anita").length, 0);
    assert.ok(w.data.sessions.filter((s) => s.userId === w.users.anita.id).every((s) => s.revokedReason === "password_changed"));
    const u = user("anita");
    assert.equal(await w.hasher.verify(u.passwordHash, "Temp#Pass1234"), true);
    assert.equal(u.mustChangePassword, true);
    assert.equal(u.lockedUntil, null);
    assert.equal(u.failedAttempts, 0);
    assert.equal(w.mailed(w.users.anita.id, "admin_reset")[0].payload?.tempPassword, "Temp#Pass1234");
    assert.ok(w.data.audit.some((a) => a.action === "user.password_reset_by_admin"));
  });

  test("an administrator's BLOCK is not lifted by a reset (HMS #13)", async () => {
    w.data.users.find((u) => u.id === w.users.anita.id)!.blockedAt = new Date(w.clock.at);
    w.data.users.find((u) => u.id === w.users.anita.id)!.blockedKind = "admin";
    await service().adminResetPassword(w.users.anita.id);
    assert.ok(user("anita").blockedAt !== null);
  });

  test("two resets at the same moment: exactly one temporary password works afterwards (the last one written), never both, and each is mailed", async () => {
    await Promise.all([service().adminResetPassword(w.users.staff.id), service().adminResetPassword(w.users.staff.id)]);
    const hash = user("staff").passwordHash;
    const works = await Promise.all(["Temp#Pass1234", "Temp#Pass5678"].map((p) => w.hasher.verify(hash, p)));
    assert.equal(works.filter(Boolean).length, 1, "exactly one of the two temporary passwords is the current one");
    assert.equal(w.mailed(w.users.staff.id, "admin_reset").length, 2);
  });
});

describe("changeEmail", () => {
  test("changes the address (typed any way, stored trimmed and lower-case), mails BOTH addresses, and ends the person's sessions", async () => {
    await addSession("staff");
    const out = await service().changeEmail(w.users.staff.id, "  New.Name@Example.COM ");
    assert.deepEqual(out, { ok: true, queued: true });
    assert.equal(user("staff").email, "new.name@example.com");
    assert.equal(activeSessions("staff").length, 0);
    const mails = w.mailed(w.users.staff.id, "email_changed");
    assert.deepEqual(mails.map((m) => m.to).sort(), ["new.name@example.com", "staff@demo.hms"]);
    assert.ok(w.data.audit.some((a) => a.action === "user.email_changed"));
  });

  test("refuses a bad shape, the same address, and an address another live account uses; a deleted account's address is free", async () => {
    for (const bad of ["", "   ", "nope", "a@b c.com", "@x.com", "x@", "a".repeat(250) + "@x.com"]) {
      assert.deepEqual(await service().changeEmail(w.users.staff.id, bad), { ok: false, message: EMAIL_INVALID_MESSAGE }, JSON.stringify(bad));
    }
    assert.deepEqual(await service().changeEmail(w.users.staff.id, "STAFF@demo.hms"), { ok: false, message: EMAIL_SAME_MESSAGE });
    assert.deepEqual(await service().changeEmail(w.users.staff.id, "anita@demo.hms"), { ok: false, message: EMAIL_TAKEN_MESSAGE });
    assert.equal(user("staff").email, "staff@demo.hms");
    assert.equal(w.data.outbox.length, 0);
    w.data.users.find((u) => u.id === w.users.anita.id)!.deletedAt = new Date(w.clock.at);
    assert.deepEqual(await service().changeEmail(w.users.staff.id, "anita@demo.hms"), { ok: true, queued: true });
  });

  test("a person with no address yet just gets the new one (only the new address is mailed)", async () => {
    const out = await service().changeEmail(w.users.noemail.id, "now.has@example.com");
    assert.deepEqual(out, { ok: true, queued: true });
    assert.deepEqual(w.mailed(w.users.noemail.id, "email_changed").map((m) => m.to), ["now.has@example.com"]);
  });

  test("two people asking for the same address at the same moment: exactly one gets it", async () => {
    const results = await Promise.all([service().changeEmail(w.users.staff.id, "shared@example.com"), service().changeEmail(w.users.guest.id, "shared@example.com")]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.some((r) => !r.ok && r.message === EMAIL_TAKEN_MESSAGE));
    assert.equal(w.data.users.filter((u) => u.email === "shared@example.com").length, 1);
  });

  test("an unknown person is NOT_FOUND", async () => {
    await rejects(service().changeEmail("00000000-0000-4000-8000-000000000000", "x@example.com"), "NOT_FOUND");
  });
});

describe("change my password (ProfileController::changePassword)", () => {
  test("the current password is checked, the new one must pass the rule and differ; my OTHER sessions end and I stay signed in; I am mailed", async () => {
    const mine = await addSession("staff");
    await addSession("staff", true);
    const out = await service().changeMyPassword(asSession("staff", mine.id), { currentPassword: PASSWORD, newPassword: "Brand#New2026x" }, META);
    assert.deepEqual(out, { changed: true, otherSessionsEnded: 1 });
    assert.deepEqual(activeSessions("staff").map((s) => s.id), [mine.id]);
    const u = user("staff");
    assert.equal(await w.hasher.verify(u.passwordHash, "Brand#New2026x"), true);
    assert.ok(u.passwordChangedAt !== null && u.mustChangePassword === false);
    assert.equal(w.mailed(w.users.staff.id, "password_changed").length, 1);
    assert.ok(w.data.events.some((e) => e.userId === w.users.staff.id && e.event === "password_changed"));
  });

  test("a wrong current password, a weak new one and a reused one each say so by error code and field; nothing is changed or counted against the account", async () => {
    const mine = await addSession("staff");
    const s = asSession("staff", mine.id);
    const before = user("staff").passwordHash;
    for (let i = 0; i < 8; i++) {
      await assert.rejects(service().changeMyPassword(s, { currentPassword: "Wrong#Pass1", newPassword: "Brand#New2026x" }, META), (e: unknown) => e instanceof AppError && e.code === "INVALID_CREDENTIALS" && e.message === CURRENT_PASSWORD_MESSAGE && e.details?.fields?.currentPassword === CURRENT_PASSWORD_MESSAGE);
    }
    await assert.rejects(service().changeMyPassword(s, { currentPassword: PASSWORD, newPassword: "weak" }, META), (e: unknown) => e instanceof AppError && e.code === "PASSWORD_TOO_WEAK" && e.message === PASSWORD_MESSAGE);
    await assert.rejects(service().changeMyPassword(s, { currentPassword: PASSWORD, newPassword: PASSWORD }, META), (e: unknown) => e instanceof AppError && e.code === "PASSWORD_REUSED" && e.message === REUSED_MESSAGE);
    assert.equal(user("staff").passwordHash, before);
    assert.equal(user("staff").failedAttempts, 0, "Pallav has no lock on this form, and the sign-in counters are untouched");
    assert.equal(user("staff").lockedUntil, null);
    assert.equal(w.data.outbox.length, 0);
  });

  test("two changes made at the same moment with the same current password: exactly one succeeds, the other is told the current password is wrong", async () => {
    const mine = await addSession("staff");
    const s = asSession("staff", mine.id);
    const results = await Promise.allSettled([
      service().changeMyPassword(s, { currentPassword: PASSWORD, newPassword: "First#Change1" }, META),
      service().changeMyPassword(s, { currentPassword: PASSWORD, newPassword: "Second#Change2" }, META),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(lost.reason instanceof AppError && lost.reason.code === "INVALID_CREDENTIALS");
    const winner = results[0].status === "fulfilled" ? "First#Change1" : "Second#Change2";
    assert.equal(await w.hasher.verify(user("staff").passwordHash, winner), true);
  });

  test("a person who must change their password can do it here too, and the flag is cleared", async () => {
    const mine = await addSession("firsttime");
    await service().changeMyPassword(asSession("firsttime", mine.id), { currentPassword: "Temp#Pass9876", newPassword: "Chosen#Pass2026" }, META);
    assert.equal(user("firsttime").mustChangePassword, false);
  });
});

describe("where I am signed in", () => {
  test("lists my valid sessions newest first with the one in use marked; never a token or a hash; ended and expired ones are not listed", async () => {
    const first = await addSession("staff");
    w.clock.at = new Date(w.clock.at.getTime() + 60_000);
    const second = await addSession("staff", true);
    const ended = await addSession("staff", true);
    await w.mem.unit.run((r) => r.sessions.revokeById(ended.id, "logout", w.clock.at));
    await addSession("anita");
    const list = await service().listMySessions(asSession("staff", first.id));
    assert.deepEqual(list.map((s) => [s.id, s.client, s.current]), [[second.id, "web", false], [first.id, "web", true]]);
    for (const row of list) assert.ok(!("tokenHash" in row) && !("token" in row) && !JSON.stringify(row).includes("token-"));
    w.clock.at = new Date(w.clock.at.getTime() + 3 * 3_600_000);
    assert.equal((await service().listMySessions(asSession("staff", first.id))).length, 1, "the web session has expired; only the 24-hour session is left");
  });

  test("I can end another of my sessions, not the one I am using, and never somebody else's (which looks like 'not found')", async () => {
    const mine = await addSession("staff");
    const phone = await addSession("staff", true);
    const other = await addSession("anita");
    const s = asSession("staff", mine.id);
    await rejects(service().endMySession(s, mine.id), "VALIDATION_FAILED");
    await rejects(service().endMySession(s, other.id), "NOT_FOUND");
    await rejects(service().endMySession(s, "00000000-0000-4000-8000-000000000000"), "NOT_FOUND");
    assert.equal(activeSessions("anita").length, 1);
    assert.deepEqual(await service().endMySession(s, phone.id), { ended: true });
    assert.deepEqual(activeSessions("staff").map((x) => x.id), [mine.id]);
    await rejects(service().endMySession(s, phone.id), "NOT_FOUND");
  });

  test("end all my other sessions", async () => {
    const mine = await addSession("staff");
    await addSession("staff", true);
    await addSession("staff", true);
    await addSession("anita");
    assert.deepEqual(await service().endOtherSessions(asSession("staff", mine.id)), { ended: 2 });
    assert.deepEqual(activeSessions("staff").map((x) => x.id), [mine.id]);
    assert.equal(activeSessions("anita").length, 1);
  });
});

describe("my emailed sign-in code switch", () => {
  test("decision 46: everyone (administrators too) sees and changes their own switch; ON needs nothing, OFF needs the current password, a wrong one is counted", async () => {
    const mine = await addSession("staff");
    const s = asSession("staff", mine.id);
    assert.deepEqual(await service().myTwoFactor(s), { codeRequired: false, canChange: true });
    assert.deepEqual(await service().setMyTwoFactor(s, true), { codeRequired: true, canChange: true });
    assert.equal(user("staff").codeRequired, true);
    await rejects(service().setMyTwoFactor(s, false), "INVALID_CREDENTIALS");
    await rejects(service().setMyTwoFactor(s, false, META, "Wrong#Pass1"), "INVALID_CREDENTIALS");
    assert.equal(user("staff").failedAttempts, 2, "a wrong password is counted like a wrong sign-in");
    assert.equal(user("staff").codeRequired, true, "nothing changed");
    assert.deepEqual(await service().setMyTwoFactor(s, false, META, PASSWORD), { codeRequired: false, canChange: true });
    const admin = asSession("anita", (await addSession("anita")).id);
    assert.deepEqual(await service().myTwoFactor(admin), { codeRequired: user("anita").codeRequired, canChange: true });
    assert.deepEqual(await service().setMyTwoFactor(admin, false, META, PASSWORD), { codeRequired: false, canChange: true });
    assert.equal(user("anita").codeRequired, false);
  });
});

describe("no secret leaks", () => {
  test("a run through every credential action leaves no password, temporary password or token in the audit trail, the events or the error messages", async () => {
    const secrets = ["Temp#Pass1234", "Temp#Pass5678", "Brand#New2026x", PASSWORD, "Wrong#Pass1"];
    await service().issueInvite(w.users.firsttime.id);
    await service().adminResetPassword(w.users.guest.id);
    const mine = await addSession("staff");
    const errors: string[] = [];
    await service().changeMyPassword(asSession("staff", mine.id), { currentPassword: "Wrong#Pass1", newPassword: "Brand#New2026x" }, META).catch((e: Error) => errors.push(e.message + JSON.stringify((e as AppError).details ?? {})));
    await service().changeMyPassword(asSession("staff", mine.id), { currentPassword: PASSWORD, newPassword: "Brand#New2026x" }, META);
    const visible = JSON.stringify({ events: w.data.events, audit: w.data.audit, errors, sessions: w.data.sessions.map((s) => ({ ...s, tokenHash: undefined })) });
    for (const secret of secrets) assert.ok(!visible.includes(secret), `${secret} leaked`);
    void hashKey;
  });
});
