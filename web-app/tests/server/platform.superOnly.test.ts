// Full power and every technical set-up are the Super Admin's only (MJ, 5 Nov 2026, rules 2 and 3): archiving and restoring a hotel, full-access visits, a hotel's secret set-up. A Platform Admin keeps suspend and reactivate and view-only visits.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createHotelService } from "../../src/server/services/platform/hotelService";
import { createHotelSetupService } from "../../src/server/services/platform/hotelSetupService";
import { createSetupCentreService } from "../../src/server/services/platform/setupCentreService";
import { isPlatformSetupSession } from "../../src/server/auth/secretSettings";
import { createStaffService } from "../../src/server/services/platform/staffService";
import { createVisitService } from "../../src/server/services/platform/visitService";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-super-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID() };
const HOTEL = randomUUID();
let cons: ReturnType<typeof createMemoryPlatformConsole>;
let auth: ReturnType<typeof createMemoryAuth>;
const as = (who: "sa" | "pa") => makeSession({ userId: ids[who], hotelId: "", accountRole: who === "sa" ? "super_admin" : "platform_admin" });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

beforeEach(() => {
  auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  for (const [who, role] of [["sa", "super_admin"], ["pa", "platform_admin"]] as const) {
    auth.data().users.push({ id: ids[who], username: who, email: `${who}@demo.hms`, mobile: null, displayName: who.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  }
  auth.data().hotels.push({ id: HOTEL, name: "Hotel Sunrise", status: "active" } as never);
  cons.data.hotels.set(HOTEL, { slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as never);
});

describe("archiving a hotel", () => {
  test("a Platform Admin is refused (audited as failed); the Super Admin archives and restores", async () => {
    const hotels = createHotelService({ unit: cons.unit, now: () => new Date("2026-11-05T10:00:00Z"), credentials: () => ({}) as never });
    assert.equal(await code(hotels.archive(as("pa"), HOTEL, "Closed for good", META)), "FORBIDDEN");
    assert.ok(cons.data.audit.some((a) => a.action === "hotel_archived" && a.result === "failed" && a.actorRole === "platform_admin"));
    assert.equal((await hotels.archive(as("sa"), HOTEL, "Closed for good", META)).hotel.status, "archived");
    assert.equal(await code(hotels.restore(as("pa"), HOTEL, META)), "FORBIDDEN");
    assert.equal((await hotels.restore(as("sa"), HOTEL, META)).hotel.status, "active");
  });
});

describe("visiting a hotel", () => {
  const deps = () => ({ unit: cons.unit, now: () => new Date("2026-11-05T10:00:00Z"), credentials: () => ({}) as never });
  test("a Platform Admin cannot be given full access; a full level stored before today enters view only", async () => {
    const staff = createStaffService(deps());
    const asked = await staff.setHotelAccess(as("sa"), ids.pa, { level: "full", allHotels: true, reason: "Helps the hotels" }, META).then(() => ({}), (e: { details?: { fields?: Record<string, string> } }) => e.details?.fields ?? {});
    assert.ok("level" in asked);
    auth.data().adminAccess.push({ userId: ids.pa, level: "full", allHotels: true, hotelIds: [], reason: "old", updatedBy: ids.sa, updatedAt: new Date() });
    const visit = await createVisitService(deps()).enter(as("pa"), HOTEL, "Checking a guest complaint", META);
    assert.equal(visit.access, "view");
    assert.equal(visit.readOnly, true);
  });
});

describe("a hotel's secret set-up from the Set-up centre", () => {
  test("only the Super Admin reaches a hotel's mail server, online payments and backup; the work runs as the set-up session for that hotel", async () => {
    const seen: unknown[] = [];
    const settings = { overview: async (s: unknown) => (seen.push(s), { current: { key: "razorpay_hotel" } }), update: async (s: unknown) => (seen.push(s), { group: { key: "razorpay_hotel" }, message: "saved" }) } as never;
    const backup = { status: async (s: unknown) => (seen.push(s), { connected: false }), test: async (s: unknown) => (seen.push(s), { message: "ok" }) } as never;
    const setup = createHotelSetupService({ unit: cons.unit, now: () => new Date("2026-11-05T10:00:00Z"), settings: () => settings, backup: () => backup });
    const hotelTop = makeSession({ userId: ids.pa, hotelId: HOTEL, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    for (const who of [as("pa"), hotelTop]) {
      assert.equal(await code(setup.settings(who, HOTEL, "razorpay_hotel")), "FORBIDDEN");
      assert.equal(await code(setup.saveSettings(who, HOTEL, "razorpay_hotel", { values: {} }, META)), "FORBIDDEN");
      assert.equal(await code(setup.backup(who, HOTEL, "test", META)), "FORBIDDEN");
    }
    assert.equal(seen.length + 0, 0);
    assert.equal(await code(setup.settings(as("sa"), HOTEL, "general")), "NOT_FOUND", "only the secret groups are set up here");
    assert.equal(await code(setup.settings(as("sa"), randomUUID(), "email")), "NOT_FOUND");
    await setup.saveSettings(as("sa"), HOTEL, "razorpay_hotel", { values: {} }, META);
    await setup.backup(as("sa"), HOTEL, "test", META);
    assert.ok(seen.length + 0 === 2 && seen.every((s) => isPlatformSetupSession(s as object) && (s as { hotelId: string }).hotelId === HOTEL));
    assert.ok(cons.data.audit.some((a) => a.reason === "setup:razorpay_hotel" && a.result === "success"));
    assert.ok(cons.data.audit.some((a) => a.action === "settings_updated" && a.hotelId === HOTEL && a.result === "failed" && a.actorRole === "platform_admin"));
  });
});
describe("the Set-up centre's status and tests", () => {
  const field = (key: string, value: string | null, set = false) => ({ key, value, set });
  const make = (demo: boolean) => {
    const settings = {
      overview: async (_s: unknown, key: string) => ({
        current: { fields: key === "email" ? [field("email.mode", "platform")] : [field(`${key}.enabled`, "1"), field(`${key}.key_id`, key === "razorpay_hotel" ? "rzp_test_abc" : ""), field(`${key}.key_secret`, null, key === "razorpay_hotel")] },
      }),
    } as never;
    const backup = { status: async () => ({ connected: false, redirectUri: "", lastAt: null, lastResult: null }) } as never;
    const whatsapp = { list: async () => ({ lines: [{ label: "Shared number", tokenState: "needs_reconnect", status: "active" }] }) } as never;
    return createSetupCentreService({ unit: cons.unit, now: () => new Date("2026-11-05T10:00:00Z"), demo, settings: () => settings, backup: () => backup, razorpay: () => ({}) as never, whatsapp: () => whatsapp, sendPlatformTest: async () => ({ ok: true, message: "sent" }), photoStorage: () => false });
  };
  test("only the Super Admin; every service with a plain status and its step; never a secret; the demo test says it is simulated", async () => {
    const centre = make(true);
    assert.equal(await code(centre.overview(as("pa"))), "FORBIDDEN");
    assert.equal(await code(centre.test(as("pa"), "mail", { to: "pa@demo.hms" }, META)), "FORBIDDEN");
    const view = await centre.overview(as("sa"));
    const by = new Map(view.rows.map((r) => [r.id, r]));
    assert.deepEqual([by.get("mail")?.status, by.get("whatsapp")?.status, by.get("storage")?.status], ["not_set_up", "needs_attention", "not_set_up"]);
    assert.match(by.get("whatsapp")?.reason ?? "", /needs a new token/);
    assert.deepEqual([by.get(`payments_hotel:${HOTEL}`)?.status, by.get(`payments_food:${HOTEL}`)?.status, by.get(`backup:${HOTEL}`)?.status, by.get(`hotel_mail:${HOTEL}`)?.status], ["working", "not_set_up", "not_set_up", "working"]);
    assert.equal(view.counts.working + view.counts.not_set_up + view.counts.needs_attention, view.rows.length);
    const t = await centre.test(as("sa"), "mail", { to: "sa@demo.hms" }, META);
    assert.deepEqual([t.ok, t.simulated], [true, true]);
    assert.match(t.message, /Simulated in the demo/);
  });
  test("on the real server the mail test needs the Super Admin's own address and answers in plain words", async () => {
    const centre = make(false);
    assert.equal(await code(centre.test(as("sa"), "mail", {}, META)), "VALIDATION_FAILED");
    const t = await centre.test(as("sa"), "mail", { to: "sa@demo.hms" }, META);
    assert.deepEqual([t.ok, t.simulated, t.message], [true, false, "A test email was sent to sa@demo.hms. Check that it arrived."]);
  });
});