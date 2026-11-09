// A hotel's Integrations and Vault tabs (MJ, 5 Nov 2026): the Super Admin alone sets up a hotel's outside services and keeps its secrets. The Platform Admin opening the same hotel
// page sees neither tab, and the server refuses their data: the hotel's payment, mail and backup settings, its website keys, the Set-up centre's states, every saving step and
// the hotel's vault. Nothing outside the gate is reached (the hotel's settings code is never called).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { deriveVaultKey, memoryVaultPorts } from "../../src/server/compose/vault";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelSetupService } from "../../src/server/services/platform/hotelSetupService";
import { createSetupCentreService } from "../../src/server/services/platform/setupCentreService";
import { createVaultService } from "../../src/server/services/vault/vaultService";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-integrations-1", ip: "10.0.0.6", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), hotel: randomUUID() };
const forbidden = (e: { code?: string }) => e.code === "FORBIDDEN";

describe("a hotel's Integrations and Vault: Super Admin only on the server", () => {
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  let reached: string[];
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const now = () => new Date("2026-11-05T10:00:00+05:30");
  const never = (name: string) => () => {
    reached.push(name);
    throw new Error(`${name} must not be reached`);
  };

  beforeEach(() => {
    reached = [];
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

  test("the hotel's set-up reads and saves are refused, and the hotel's settings code is never reached", async () => {
    const setup = createHotelSetupService({ unit: cons.unit, now, settings: never("settings") as never, backup: never("backup") as never, website: never("website") as never });
    for (const group of ["razorpay_hotel", "razorpay_food", "email"]) await assert.rejects(() => setup.settings(pa(), ids.hotel, group), forbidden);
    await assert.rejects(() => setup.saveSettings(pa(), ids.hotel, "razorpay_hotel", { values: {} } as never, META), forbidden);
    await assert.rejects(() => setup.backup(pa(), ids.hotel, "status", META), forbidden);
    await assert.rejects(() => setup.backup(pa(), ids.hotel, "test", META), forbidden);
    await assert.rejects(() => setup.website(pa(), ids.hotel), forbidden);
    await assert.rejects(() => setup.saveWebsite(pa(), ids.hotel, { newGoogleMapsApiKey: "AIzaDemoKeyOnly0000000000" }, META), forbidden);
    await assert.rejects(() => setup.testEmail(pa(), ids.hotel, {}, META), forbidden);
    assert.deepEqual(reached, []);
    const refused = cons.data.audit.filter((a) => a.result === "failed" && a.actorUserId === ids.pa);
    assert.ok(refused.length >= 4, "every refused write is kept in the audit trail");
  });

  test("the Set-up centre's states and tests are refused", async () => {
    const centre = createSetupCentreService({ unit: cons.unit, now, demo: true, settings: never("settings") as never, backup: never("backup") as never, razorpay: never("razorpay") as never, whatsapp: never("whatsapp") as never, sendPlatformTest: never("mail") as never, photoStorage: () => true });
    await assert.rejects(() => centre.overview(pa()), forbidden);
    await assert.rejects(() => centre.test(pa(), "payments_hotel", { hotelId: ids.hotel }, META), forbidden);
    assert.deepEqual(reached, []);
  });

  test("the hotel's vault is refused: list, add and Show", async () => {
    const vault = createVaultService({ unit: cons.unit, now, ports: memoryVaultPorts(), key: deriveVaultKey(randomBytes(32)), newId: randomUUID });
    const sa = makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
    const item = await vault.add(sa, ids.hotel, { kind: "login", title: "Booking.com extranet", secret: "demo-only-secret" }, META);
    await assert.rejects(() => vault.list(pa(), ids.hotel), forbidden);
    await assert.rejects(() => vault.add(pa(), ids.hotel, { kind: "note", title: "x" }, META), forbidden);
    await assert.rejects(() => vault.reveal(pa(), ids.hotel, item.id, META), forbidden);
  });
});
