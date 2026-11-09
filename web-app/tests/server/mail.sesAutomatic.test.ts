// Amazon SES is automatic for every hotel and group (MJ, 1 Nov 2026): it sends through the platform's own SES login as the owner's automatic address (name@domain), and only an EMAIL ADDRESS
// is ever saved to replace that address for one hotel or group. A login of its own still wins; a platform whose service is not SES gives no automatic SES.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { readHotelMail } from "../../src/server/mail/hotelMail";
import { deriveSmtpKey } from "../../src/server/mail/key";
import type { SmtpConfig } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelMailService } from "../../src/server/services/platform/hotelMailService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const H = randomUUID();
const SES: SmtpConfig = { host: "email-smtp.ap-southeast-2.amazonaws.com", port: 587, security: "starttls", user: "AKIAPLATFORM", pass: "platform-secret", from: '"HMS" <support@easyhotelsolutions.in>', sendingDomain: "easyhotelsolutions.in" };
const empty = { hotelId: H, sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null, updatedAt: null };

describe("automatic Amazon SES for a hotel or group", () => {
  test("nothing saved for SES: the platform's SES login sends as the automatic address, with the hotel's name", () => {
    const r = readHotelMail(empty as never, KEY, "Hotel Pallav", SES, "hotelpallav@easyhotelsolutions.in");
    assert.deepEqual([r.ses?.host, r.ses?.user, r.ses?.pass, r.ses?.from], ["email-smtp.ap-southeast-2.amazonaws.com", "AKIAPLATFORM", "platform-secret", '"Hotel Pallav" <hotelpallav@easyhotelsolutions.in>']);
  });

  test("an email address saved for SES replaces the automatic one; the reply-to travels with it", () => {
    const r = readHotelMail({ ...empty, sesFrom: "Desk@Pallav.in", replyTo: "front@pallav.in" } as never, KEY, "Hotel Pallav", SES, "hotelpallav@easyhotelsolutions.in");
    assert.deepEqual([r.ses?.from, r.ses?.replyTo], ['"Hotel Pallav" <desk@pallav.in>', "front@pallav.in"]);
  });

  test("no platform SES, a platform that is not SES, or no automatic address: no automatic SES", () => {
    assert.equal(readHotelMail(empty as never, KEY, "H", null, "h@easyhotelsolutions.in").ses, null);
    assert.equal(readHotelMail(empty as never, KEY, "H", { ...SES, host: "smtp.gmail.com" }, "h@easyhotelsolutions.in").ses, null);
    assert.equal(readHotelMail(empty as never, KEY, "H", SES, null).ses, null);
  });
});

describe("saving only an email address for SES", () => {
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const sa = randomUUID();
  const meta = { traceId: "trace-ses-automatic-1", ip: "10.0.0.5", userAgent: "node-test" };
  const build = () => createHotelMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey: KEY } });
  const session = () => makeSession({ userId: sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });

  beforeEach(() => {
    const auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    auth.data().users.push({ id: sa, username: "sa", email: "sa@demo.hms", mobile: null, displayName: "SA", passwordHash: "x", accountRole: "super_admin", status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    auth.data().hotels.push({ id: H, name: "Hotel Pallav", status: "active" } as never);
    cons.data.hotels.set(H, { slug: "hotel-pallav", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as MemHotelMeta);
    cons.data.settings.set("mail.from_email", { value: "support@easyhotelsolutions.in", updatedAt: new Date(0), updatedBy: null });
  });

  test("an email address alone is saved (no login, no password); the editor shows the automatic address; an empty box goes back to it", async () => {
    const svc = build();
    const before = await svc.get(session(), H);
    assert.deepEqual([before.ses.from, before.address], ["", "hotelpallav@easyhotelsolutions.in"]);
    const saved = await svc.save(session(), H, { ses: { from: "Desk@Pallav.in" } }, meta);
    assert.deepEqual([saved.ses.from, saved.ses.user, saved.ses.passwordSet], ["desk@pallav.in", "", false]);
    assert.equal((await svc.list(session())).find((h) => h.hotelId === H)?.ses, true, "an own address counts as set by hand");
    const back = await svc.save(session(), H, { ses: { from: "" } }, meta);
    assert.equal(back.ses.from, "");
  });

  test("a bad email address is refused", async () => {
    const svc = build();
    await assert.rejects(() => svc.save(session(), H, { ses: { from: "not an address" } }, meta), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
  });
});
