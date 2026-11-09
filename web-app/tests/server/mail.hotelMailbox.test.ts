// The Email page reads the Google account the Super Admin saved for a hotel (MJ, 1 Nov 2026): reading is on by itself, nobody in the hotel has a switch. Only the hotel's OWN Google login is a
// mailbox (Amazon SES only sends; a group's Google is shared by its hotels, so it is never read as a hotel's inbox). Saving or removing a hotel's Google login tells the platform registry.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { hotelGmailScope, hotelSesScope, readHotelMail } from "../../src/server/mail/hotelMail";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { hotelMailboxFromAccount } from "../../src/server/mail/mailbox";
import { sealSmtpSecret } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelMailService } from "../../src/server/services/platform/hotelMailService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const H = randomUUID();

describe("a hotel's mailbox from its own accounts", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    hotelId: H, sesRegion: "ap-south-1", sesUser: "AKIAHOTEL", sesPassword: sealSmtpSecret(KEY, "ses-secret", hotelSesScope(H)), sesFrom: "bookings@sunrise.in",
    gmailUser: "front@gmail.com", gmailPassword: sealSmtpSecret(KEY, "abcdefghijklmnop", hotelGmailScope(H)), fromName: "Sunrise", replyTo: null, sesTest: null, gmailTest: null, updatedAt: null, ...over,
  });

  test("a Google login is read from imap.gmail.com with the same app password, reading on, replies from the same address", () => {
    const m = hotelMailboxFromAccount(readHotelMail(row() as never, KEY, "Hotel Sunrise"));
    assert.equal(m?.reading, true);
    assert.equal(m?.reason, null);
    assert.deepEqual([m?.config?.address, m?.config?.gmail, m?.config?.imap.host, m?.config?.imap.port, m?.config?.imap.user, m?.config?.imap.pass], ["front@gmail.com", true, "imap.gmail.com", 993, "front@gmail.com", "abcdefghijklmnop"]);
  });

  test("an Amazon SES login alone, no accounts, or a password that cannot be opened is no mailbox", () => {
    assert.equal(hotelMailboxFromAccount(readHotelMail(row({ gmailUser: null, gmailPassword: null }) as never, KEY, "H")), null);
    assert.equal(hotelMailboxFromAccount(null), null);
    assert.equal(hotelMailboxFromAccount(readHotelMail(row() as never, null, "H")), null, "no key: the Google password cannot be opened");
  });
});

describe("saving a hotel's Google login tells the registry", () => {
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const calls: [string, boolean][] = [];
  const sa = randomUUID();
  const meta = { traceId: "trace-hotel-mailbox-1", ip: "10.0.0.5", userAgent: "node-test" };
  const build = () => createHotelMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey: KEY, mailboxRegistry: { setHotelReading: async (id, on) => void calls.push([id, on]) } } });
  const session = () => makeSession({ userId: sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });

  beforeEach(() => {
    calls.length = 0;
    const auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    auth.data().users.push({ id: sa, username: "sa", email: "sa@demo.hms", mobile: null, displayName: "SA", passwordHash: "x", accountRole: "super_admin", status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    auth.data().hotels.push({ id: H, name: "Hotel Sunrise", status: "active" } as never);
    cons.data.hotels.set(H, { slug: "sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as MemHotelMeta);
  });

  test("saving the Google login switches reading on; removing it switches it off; an SES-only change does not touch it", async () => {
    const svc = build();
    await svc.save(session(), H, { ses: { region: "ap-south-1", user: "AKIA1", password: "p1", from: "a@sunrise.in" } }, meta);
    assert.deepEqual(calls, []);
    await svc.save(session(), H, { gmail: { user: "front@gmail.com", password: "abcd efgh ijkl mnop" } }, meta);
    assert.deepEqual(calls, [[H, true]]);
    await svc.save(session(), H, { gmail: { clear: true } }, meta);
    assert.deepEqual(calls, [[H, true], [H, false]]);
  });

  test("a registry that fails never fails the save", async () => {
    const failing = createHotelMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey: KEY, mailboxRegistry: { setHotelReading: async () => { throw new Error("table missing"); } } } });
    const v = await failing.save(session(), H, { gmail: { user: "front@gmail.com", password: "abcdefghijklmnop" } }, meta);
    assert.equal(v.gmail.passwordSet, true);
  });
});
