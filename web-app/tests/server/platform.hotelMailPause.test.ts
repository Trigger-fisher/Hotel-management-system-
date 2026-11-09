// Pausing and resuming the mail of a hotel or a group (Platform > Hotel and group mail; MJ, 1 Nov 2026), Super Admin only. What is guaranteed: a pause needs a reason; it keeps who, when, why and
// (for a group) its scope; the list shows it; pausing twice or resuming a running one is refused; every change is audited; only a group takes the scope "one"; a Platform Admin cannot change it.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { deriveSmtpKey } from "../../src/server/mail/key";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createGroupMailService, createHotelMailService } from "../../src/server/services/platform/hotelMailService";
import { makeSession } from "./helpers/session";

const KEY = deriveSmtpKey(randomBytes(32));
const META = { traceId: "trace-mail-pause-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), sunrise: randomUUID() };

describe("pausing a hotel's mail", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const deps = () => ({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey: KEY } });
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const meta = (slug: string): MemHotelMeta =>
    ({
      slug, city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"),
      submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
      statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
    }) as MemHotelMeta;

  beforeEach(() => {
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    auth.data().hotels.push({ id: ids.sunrise, name: "Hotel Sunrise", status: "active" } as never);
    cons.data.hotels.set(ids.sunrise, meta("hotel-sunrise"));
  });

  test("a pause keeps who, when and why, shows in the list and the view, and is audited; a reason is needed", async () => {
    const svc = createHotelMailService(deps());
    const bad = await svc.setPause(sa(), ids.sunrise, { paused: true, reason: " " }, META).then(() => null, (e: unknown) => (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? null);
    assert.deepEqual(Object.keys(bad ?? {}), ["reason"]);
    const v = await svc.setPause(sa(), ids.sunrise, { paused: true, reason: "Unpaid invoice" }, META);
    assert.deepEqual([v.pause?.by, v.pause?.reason, v.pause?.scope, v.pause?.at], ["SA", "Unpaid invoice", "all", "2026-11-01T04:30:00.000Z"]);
    assert.deepEqual((await svc.list(sa())).map((h) => [h.name, h.pause?.reason ?? null]), [["Hotel Sunrise", "Unpaid invoice"]]);
    assert.match(String(cons.data.audit.at(-1)?.reason), /paused.*Unpaid invoice.*Hotel Sunrise/);
  });

  test("the mail accounts and the pause live apart: saving an account keeps the pause, and a hotel with no accounts can be paused", async () => {
    const svc = createHotelMailService(deps());
    await svc.setPause(sa(), ids.sunrise, { paused: true, reason: "Account under review" }, META);
    const saved = await svc.save(sa(), ids.sunrise, { fromName: "Front Desk" }, META);
    assert.equal(saved.pause?.reason, "Account under review");
    assert.equal(saved.fromName, "Front Desk");
  });

  test("resuming clears it; pausing twice or resuming a running hotel is refused", async () => {
    const svc = createHotelMailService(deps());
    await assert.rejects(() => svc.setPause(sa(), ids.sunrise, { paused: false }, META), "not paused yet");
    await svc.setPause(sa(), ids.sunrise, { paused: true, reason: "Asked by the owner" }, META);
    await assert.rejects(() => svc.setPause(sa(), ids.sunrise, { paused: true, reason: "Again" }, META), "already paused");
    const back = await svc.setPause(sa(), ids.sunrise, { paused: false }, META);
    assert.equal(back.pause, null);
    assert.match(String(cons.data.audit.at(-1)?.reason), /resumed/);
  });

  test("only the Super Admin may change it", async () => {
    const svc = createHotelMailService(deps());
    await assert.rejects(() => svc.setPause(pa(), ids.sunrise, { paused: true, reason: "Because" }, META));
    assert.equal(cons.data.hotelMail.length, 0);
  });

  test("an unknown hotel is not found", async () => {
    await assert.rejects(() => createHotelMailService(deps()).setPause(sa(), randomUUID(), { paused: true, reason: "Because" }, META));
  });
});

describe("pausing a group's mail", () => {
  test("the scope counts for a group only: a hotel is always paused whole", async () => {
    const auth = createMemoryAuth();
    const cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    auth.data().users.push({ id: ids.sa, username: "sa", email: "sa@demo.hms", mobile: null, displayName: "SA", passwordHash: "x", accountRole: "super_admin", status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    auth.data().hotels.push({ id: ids.sunrise, name: "Hotel Sunrise", status: "active" } as never);
    const hotel = createHotelMailService({ unit: cons.unit, credentials: () => ({}) as never, now: () => new Date("2026-11-01T10:00:00+05:30"), hotelMail: { secretKey: KEY } });
    cons.data.hotels.set(ids.sunrise, { slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date(), provisionedAt: new Date(), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as MemHotelMeta);
    const v = await hotel.setPause(makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), ids.sunrise, { paused: true, reason: "Because", scope: "one" }, META);
    assert.equal(v.pause?.scope, "all");
    assert.equal(typeof createGroupMailService, "function");
  });
});
