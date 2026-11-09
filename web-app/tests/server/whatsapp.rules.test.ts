// WhatsApp Rules screen backend (plan part 6, task 11): resolution order, immediate effect, locked rules, confirmation of risky changes, ranges, the audit with old and new values,
// the kill switches, and who may use it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createMemoryWaRulesStore, createWaRulesService } from "../../src/server/services/whatsapp/rulesService";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-rules-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), hu: randomUUID() };
const HOTEL = randomUUID();
const SHARED = randomUUID();
const OWN = randomUUID();
let cons: ReturnType<typeof createMemoryPlatformConsole>;
let store: ReturnType<typeof createMemoryWaRulesStore>;

const svc = () => createWaRulesService({ unit: cons.unit, store, now: () => new Date("2026-11-04T10:00:00Z") });
const as = (who: "sa" | "pa" | "hu") => makeSession({ userId: ids[who], hotelId: who === "hu" ? "" : "", accountRole: who === "sa" ? "super_admin" : who === "pa" ? "platform_admin" : "hotel_user" });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const fields = async (p: Promise<unknown>): Promise<Record<string, string>> => p.then(() => ({}), (e: { details?: { fields?: Record<string, string> } }) => e.details?.fields ?? {});
const audit = () => cons.data.audit.filter((a) => a.action === "settings_updated" && a.result === "success");

beforeEach(() => {
  const auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  for (const [who, role] of [["sa", "super_admin"], ["pa", "platform_admin"], ["hu", "hotel_user"]] as const) {
    auth.data().users.push({ id: ids[who], username: who, email: `${who}@demo.hms`, mobile: null, displayName: who.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  }
  auth.data().hotels.push({ id: HOTEL, name: "Hotel Sunrise", status: "active" } as never);
  cons.data.hotels.set(HOTEL, { slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as never);
  store = createMemoryWaRulesStore({
    lines: [{ id: SHARED, kind: "shared", displayName: "Shared", status: "active", quality: "green" }, { id: OWN, kind: "hotel", displayName: "Own", status: "active", quality: "green" }],
    rows: [{ hotelId: HOTEL, lineId: SHARED, own: false, override: null }],
  });
});

const rule = (rules: { key: string; effective: unknown; source: string }[], key: string) => rules.find((r) => r.key === key) as { effective: unknown; source: string };

describe("resolution and immediate effect", () => {
  test("hotel override beats the line profile, which beats the global default; a change shows on the next call", async () => {
    const s = svc();
    let h = await s.getHotel(as("sa"), HOTEL);
    assert.deepEqual([rule(h.rules, "daily_cap").effective, rule(h.rules, "daily_cap").source], [50, "global_default"]);
    await s.update(as("sa"), { numbers: { default_daily_cap: 80 } }, META);
    h = await s.getHotel(as("sa"), HOTEL);
    assert.equal(rule(h.rules, "daily_cap").effective, 80);
    await s.update(as("sa"), { profiles: { shared: { daily_cap: 30 } } }, META);
    h = await s.getHotel(as("sa"), HOTEL);
    assert.deepEqual([rule(h.rules, "daily_cap").effective, rule(h.rules, "daily_cap").source], [30, "line_profile"]);
    h = await s.setHotelOverride(as("sa"), HOTEL, { daily_cap: 10 }, undefined, META);
    assert.deepEqual([rule(h.rules, "daily_cap").effective, rule(h.rules, "daily_cap").source], [10, "hotel_override"]);
    h = await s.clearHotelOverride(as("sa"), HOTEL, "daily_cap", undefined, META);
    assert.deepEqual([rule(h.rules, "daily_cap").effective, rule(h.rules, "daily_cap").source], [30, "line_profile"]);
    assert.deepEqual(store.data.rows[0]?.override, {});
  });
  test("the hotel's own number uses the own-default profile", async () => {
    store.data.rows.push({ hotelId: "own-hotel", lineId: OWN, own: true, override: null });
    await svc().update(as("sa"), { profiles: { own_default: { hotel_may_start_chats: true } } }, META);
    const h = await svc().getHotel(as("sa"), "own-hotel");
    assert.deepEqual([h.profile, rule(h.rules, "hotel_may_start_chats").effective, rule(h.rules, "hotel_may_start_chats").source], ["own_default", true, "line_profile"]);
  });
});

describe("locked, risky and out of range", () => {
  test("a locked rule cannot be changed, anywhere", async () => {
    const s = svc();
    assert.match((await fields(s.update(as("sa"), { profiles: { shared: { templates_only_for_new_messages: false } } }, META)))["profiles.shared.templates_only_for_new_messages"] ?? "", /Meta's own rule/);
    assert.ok((await fields(s.setHotelOverride(as("sa"), HOTEL, { templates_only_for_new_messages: false }, true, META))).templates_only_for_new_messages);
    const v = await s.get(as("sa"));
    assert.equal(v.profiles[0]?.rules.find((r) => r.key === "templates_only_for_new_messages")?.locked, true);
  });
  test("risky changes need confirm: true and are refused without it, with nothing written", async () => {
    const s = svc();
    for (const patch of [{ profiles: { shared: { marketing_allowed: true } } }, { profiles: { shared: { consent_required_for_automatic: false } } }, { profiles: { shared: { daily_cap: 0 } } }, { numbers: { default_daily_cap: 0 } }, { numbers: { routing_mode: "balanced" as const } }]) {
      assert.equal(await code(s.update(as("sa"), patch, META)), "CONFLICT");
    }
    assert.equal(audit().length, 0);
    assert.equal(await code(s.update(as("sa"), { profiles: { shared: { marketing_allowed: true } }, confirm: true }, META)), "ok");
    assert.equal(await code(s.setHotelOverride(as("sa"), HOTEL, { marketing_allowed: false }, undefined, META)), "ok");
    await s.setKillSwitch(as("sa"), { scope: "global" }, false, undefined, META); // WhatsApp on
    assert.equal(await code(s.setKillSwitch(as("sa"), { scope: "global" }, true, undefined, META)), "CONFLICT");
    assert.equal(await code(s.setKillSwitch(as("sa"), { scope: "global" }, true, true, META)), "ok");
  });
  test("ranges are refused", async () => {
    const s = svc();
    const bad = [{ routing_timeframe_minutes: 4 }, { routing_timeframe_minutes: 1441 }, { default_daily_cap: -1 }, { default_daily_cap: 100001 }, { hold_minutes: 0 }, { hold_minutes: 61 }, { transition_days: 0 }, { transition_days: 366 }, { routing_mode: "loose" }];
    for (const numbers of bad) assert.equal(await code(s.update(as("sa"), { numbers: numbers as never }, META)), "VALIDATION_FAILED");
    assert.equal(await code(s.update(as("sa"), { numbers: { routing_timeframe_minutes: 5, hold_minutes: 60, transition_days: 365 } }, META)), "ok");
  });
});

describe("audit and kill switches", () => {
  test("every changed key is one audit row with the old and the new value", async () => {
    const s = svc();
    await s.update(as("sa"), { numbers: { hold_minutes: 20 }, profiles: { shared: { hotel_may_start_chats: true } } }, META);
    const rows = audit();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find((r) => r.before && "hold_minutes" in r.before)?.after, { hold_minutes: 20 });
    assert.deepEqual([rows.find((r) => r.before && "hold_minutes" in r.before)?.before], [{ hold_minutes: 10 }]);
    const p = rows.find((r) => r.before && "shared.hotel_may_start_chats" in r.before);
    assert.deepEqual([p?.before, p?.after, p?.actorName, p?.actorRole], [{ "shared.hotel_may_start_chats": false }, { "shared.hotel_may_start_chats": true }, "SA", "super_admin"]);
  });
  test("global, line and hotel kill switches; the line's token is not part of the store", async () => {
    const s = svc();
    // WhatsApp starts off (killed); turn it on, then stop it again
    assert.equal((await s.get(as("sa"))).killSwitch.global.killed, true);
    await s.setKillSwitch(as("sa"), { scope: "global" }, false, undefined, META);
    assert.equal(cons.data.settings.get("whatsapp.enabled")?.value, true);
    await s.setKillSwitch(as("sa"), { scope: "global" }, true, true, META);
    assert.equal((await s.get(as("sa"))).killSwitch.global.killed, true);
    assert.equal(cons.data.settings.get("whatsapp.enabled")?.value, false);
    await s.setKillSwitch(as("sa"), { scope: "line", id: SHARED }, true, true, META);
    assert.equal((await s.get(as("sa"))).lines.find((l) => l.id === SHARED)?.paused, true);
    await s.setKillSwitch(as("sa"), { scope: "line", id: SHARED }, false, undefined, META);
    assert.equal(store.data.lines.find((l) => l.id === SHARED)?.status, "active");
    const k = await s.setKillSwitch(as("sa"), { scope: "hotel", id: HOTEL }, true, true, META);
    assert.equal(k.killed, true);
    assert.equal(store.data.rows[0]?.override?.hotel_paused, true);
    assert.equal((await s.getHotel(as("sa"), HOTEL)).hotelPaused, true);
    await s.setKillSwitch(as("sa"), { scope: "hotel", id: HOTEL }, false, undefined, META);
    assert.equal("hotel_paused" in (store.data.rows[0]?.override ?? {}), false);
    assert.ok(audit().length >= 6);
  });
});

describe("who may use it", () => {
  test("only the Super Admin (MJ, 5 Nov 2026); not a Platform Admin, hotel staff, an API key or a visit", async () => {
    const s = svc();
    assert.equal(await code(s.get(as("hu"))), "FORBIDDEN");
    assert.equal(await code(s.update(as("hu"), { numbers: { hold_minutes: 5 } }, META)), "FORBIDDEN");
    assert.equal(await code(s.setKillSwitch(as("hu"), { scope: "global" }, true, true, META)), "FORBIDDEN");
    const key = { ...as("sa"), client: "token" as const, token: { id: "k", name: "k", level: "full", scope: "platform", testMode: false, callsPerMinute: 60, ip: null, newIp: false } } as never;
    assert.equal(await code(s.get(key)), "FORBIDDEN");
    const visit = { ...as("sa"), visit: { id: "v", hotelId: HOTEL, hotelName: "H", expiresAt: new Date(), access: "full", by: "super_admin" } } as never;
    assert.equal(await code(s.get(visit)), "FORBIDDEN");
    assert.equal(await code(s.get(as("pa"))), "FORBIDDEN");
    assert.equal(await code(s.update(as("pa"), { numbers: { hold_minutes: 5 } }, META)), "FORBIDDEN");
    assert.equal(await code(s.setKillSwitch(as("pa"), { scope: "global" }, true, true, META)), "FORBIDDEN");
    assert.equal(await code(s.get(as("sa"))), "ok");
    assert.equal(audit().length, 0);
  });
});
