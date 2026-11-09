// The hotel's ID picture setting (MJ, 5 Nov 2026): "ID pictures: keep an exact copy (bigger files)" on the hotel's Integrations tab. The Super Admin only (gate.superRead /
// superWrite; a Platform Admin, even with the hotel's top role key, is refused and the refusal audited as failed); off by default; every change audited with before and after;
// not from a hotel visit or an API key. HMS copies it into intake_jobs.lossless (other-features/intake-worker/sql/proposal.sql).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelSetupService } from "../../src/server/services/platform/hotelSetupService";
import { idPhotosBody } from "../../src/server/services/platform/schemas";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-id-photos-1", ip: "10.0.0.7", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), hotel: randomUUID() };
const now = () => new Date("2026-11-05T10:00:00+05:30");
const forbidden = (e: { code?: string }) => e.code === "FORBIDDEN";

describe("ID pictures: keep an exact copy (Super Admin only)", () => {
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const sa = (extra: Record<string, unknown> = {}) => ({ ...makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), ...extra }) as ReturnType<typeof makeSession>;
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const service = () =>
    createHotelSetupService({
      unit: cons.unit,
      now,
      settings: (() => { throw new Error("the hotel's settings code must not be reached"); }) as never,
      backup: (() => { throw new Error("backup must not be reached"); }) as never,
    });

  beforeEach(() => {
    const auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    auth.data().hotels.push({ id: ids.hotel, name: "Hotel Sunrise", status: "active" } as never);
    cons.data.hotels.set(ids.hotel, { slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: now(), provisionedAt: now(), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as MemHotelMeta);
  });

  test("off by default; the Super Admin switches it on and off; each change is audited with before and after", async () => {
    const s = service();
    assert.deepEqual(await s.idPhotos(sa(), ids.hotel), { exactCopy: false });
    assert.deepEqual(await s.saveIdPhotos(sa(), ids.hotel, true, META), { exactCopy: true });
    assert.deepEqual(await s.idPhotos(sa(), ids.hotel), { exactCopy: true });
    assert.equal(await cons.unit.run((repos) => repos.hotels.idPhotoExact(ids.hotel)), true, "stored on the hotel (platform 0196)");
    await s.saveIdPhotos(sa(), ids.hotel, false, META);
    assert.deepEqual(await s.idPhotos(sa(), ids.hotel), { exactCopy: false });
    const rows = cons.data.audit.filter((a) => a.actorUserId === ids.sa && a.reason === "setup:id_photos" && a.result !== "failed");
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].before, rows[0].after], [{ exactCopy: false }, { exactCopy: true }]);
    assert.deepEqual([rows[1].before, rows[1].after], [{ exactCopy: true }, { exactCopy: false }]);
    assert.ok(rows.every((r) => r.hotelId === ids.hotel && r.targetLabel === "Hotel Sunrise"));
  });

  test("a Platform Admin can neither read nor change it, and the refused change is audited as failed", async () => {
    const s = service();
    await assert.rejects(() => s.idPhotos(pa(), ids.hotel), forbidden);
    await assert.rejects(() => s.saveIdPhotos(pa(), ids.hotel, true, META), forbidden);
    assert.equal(await cons.unit.run((repos) => repos.hotels.idPhotoExact(ids.hotel)), false);
    assert.equal(cons.data.audit.filter((a) => a.actorUserId === ids.pa && a.result === "failed" && a.entityId === ids.hotel).length, 1);
  });

  test("not from a hotel visit or an API key; an unknown hotel is not found", async () => {
    const s = service();
    await assert.rejects(() => s.saveIdPhotos(sa({ visit: { id: randomUUID() } }), ids.hotel, true, META), forbidden);
    await assert.rejects(() => s.saveIdPhotos(sa({ token: { id: randomUUID() } }), ids.hotel, true, META), forbidden);
    await assert.rejects(() => s.idPhotos(sa(), randomUUID()), (e: { code?: string }) => e.code === "NOT_FOUND");
    assert.equal(await cons.unit.run((repos) => repos.hotels.idPhotoExact(ids.hotel)), false);
  });

  test("the body is one true/false switch and nothing else", () => {
    assert.equal(idPhotosBody.safeParse({ exactCopy: true }).success, true);
    assert.equal(idPhotosBody.safeParse({ exactCopy: "yes" }).success, false);
    assert.equal(idPhotosBody.safeParse({ exactCopy: true, lossless: true }).success, false);
  });
});
