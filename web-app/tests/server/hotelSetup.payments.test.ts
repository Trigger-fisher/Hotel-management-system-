// The Set-up centre's payments wizard on the server (MJ, 5 Nov 2026): GET and PUT /platform/setup/hotels/{id}/payments, a webhook secret and a Test per business. The Super Admin
// only (gate.superRead / superWrite, a refused write audited as failed); the work is the hotel's own Razorpay settings code; a saved secret is never sent back; the Key ID must
// belong to its mode.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { isPlatformSetupSession } from "../../src/server/auth/secretSettings";
import type { VerifiedSession } from "../../src/server/auth/session";
import { AppError } from "../../src/server/errors";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createHotelSetupService } from "../../src/server/services/platform/hotelSetupService";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-pay-1", ip: "10.0.0.7", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), hotel: randomUUID() };
const now = () => new Date("2026-11-05T10:00:00+05:30");
const forbidden = (e: { code?: string }) => e.code === "FORBIDDEN";
const FIELDS = ["enabled", "mode", "key_id", "key_secret", "webhook_secret"];
const SECRET = new Set(["key_secret", "webhook_secret"]);

function fakeSettings(store: Map<string, string>, seen: VerifiedSession[]) {
  return {
    async overview(as: VerifiedSession, group: string) {
      seen.push(as);
      return {
        groups: [],
        current: {
          key: group, label: group, icon: "", about: "",
          fields: FIELDS.map((n) => {
            const key = `${group}.${n}`;
            const v = store.get(key) ?? "";
            return SECRET.has(n) ? { key, value: null, set: v !== "", savedAt: v !== "" ? now().toISOString() : null } : { key, value: v === "" ? (n === "mode" ? "test" : null) : v, set: false, savedAt: null };
          }),
        },
      };
    },
    async update(as: VerifiedSession, group: string, body: { values: Record<string, string | boolean | null>; clear?: string[] }) {
      seen.push(as);
      for (const n of FIELDS) {
        const key = `${group}.${n}`;
        const raw = body.values[key];
        if (n === "enabled") store.set(key, raw === true ? "1" : "0");
        else if (SECRET.has(n)) {
          if (raw) store.set(key, String(raw));
          else if (body.clear?.includes(key)) store.delete(key);
        } else store.set(key, raw === undefined || raw === null ? "" : String(raw));
      }
      return { group: {}, message: "Saved." };
    },
  };
}

describe("the Set-up centre's payments wizard: Super Admin only", () => {
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  let store: Map<string, string>;
  let seen: VerifiedSession[];
  let tested: string[];
  let testFails: AppError | null;
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const service = () =>
    createHotelSetupService({
      unit: cons.unit,
      now,
      settings: () => fakeSettings(store, seen) as never,
      backup: (() => { throw new Error("backup must not be reached"); }) as never,
      razorpay: () =>
        ({
          setupFacts: async () => ({ hotel: { webhookUrl: `https://hms.example.in/api/v1/webhooks/razorpay/${ids.hotel}/hotel`, lastWebhookAt: null, lastPaymentAt: null }, food: { webhookUrl: `https://hms.example.in/api/v1/webhooks/razorpay/${ids.hotel}/food`, lastWebhookAt: null, lastPaymentAt: null } }),
          testKeys: async (_as: VerifiedSession, b: string) => {
            tested.push(b);
            if (testFails) throw testFails;
          },
        }) as never,
    });

  beforeEach(() => {
    store = new Map();
    seen = [];
    tested = [];
    testFails = null;
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

  test("the Super Admin walks the wizard: mode, keys, webhook secret, Test, switch on; no secret ever comes back", async () => {
    const s = service();
    const first = await s.payments(sa(), ids.hotel);
    assert.deepEqual(first.items.map((p) => [p.business, p.mode, p.keyId, p.keySecretSet, p.enabled]), [["hotel", "test", "", false, false], ["food", "test", "", false, false]]);
    assert.ok(seen.every((x) => isPlatformSetupSession(x) && x.hotelId === ids.hotel), "the hotel's own settings code runs as the set-up session of that hotel");

    const keys = await s.savePayments(sa(), ids.hotel, { business: "hotel", keyId: "rzp_test_Abc12345XYZ", keySecret: "topsecretvalue123" }, META);
    assert.deepEqual([keys.keyId, keys.keySecretSet, keys.enabled], ["rzp_test_Abc12345XYZ", true, false]);
    assert.ok(!JSON.stringify(keys).includes("topsecretvalue123"));

    const hook = await s.makeWebhookSecret(sa(), ids.hotel, "hotel", META);
    assert.ok(hook.secret.length >= 32);
    assert.equal(hook.setup.webhookSecretSet, true);
    assert.equal(hook.setup.keyId, "rzp_test_Abc12345XYZ", "making the webhook secret keeps the keys");
    assert.ok(!JSON.stringify(await s.payments(sa(), ids.hotel)).includes(hook.secret), "the webhook secret is shown once only");

    const t = await s.testPayments(sa(), ids.hotel, "hotel", META);
    assert.equal(t.ok, true);
    assert.match(t.message, /Test mode/);
    assert.deepEqual(tested, ["hotel"]);

    const on = await s.savePayments(sa(), ids.hotel, { business: "hotel", enabled: true }, META);
    assert.deepEqual([on.enabled, on.keyId, on.keySecretSet], [true, "rzp_test_Abc12345XYZ", true]);
    assert.equal((await s.payments(sa(), ids.hotel)).items[1].keyId, "", "the food account is untouched");
    const audited = cons.data.audit.filter((a) => a.actorUserId === ids.sa && a.result !== "failed").map((a) => a.reason);
    assert.ok(audited.includes("setup:payments_hotel") && audited.includes("setup:payments_hotel_webhook_secret"));
  });

  test("the Key ID must belong to its mode; choosing the other mode clears the old keys; switching on needs both keys", async () => {
    const s = service();
    await assert.rejects(() => s.savePayments(sa(), ids.hotel, { business: "food", keyId: "rzp_live_Abc12345XYZ" }, META), (e: AppError) => e.code === "VALIDATION_FAILED" && /Test Key ID starts with rzp_test_/.test(e.message) && "keyId" in ((e.details as { fields?: object })?.fields ?? {}));
    await assert.rejects(() => s.savePayments(sa(), ids.hotel, { business: "food", enabled: true }, META), (e: AppError) => e.code === "CONFLICT");
    await s.savePayments(sa(), ids.hotel, { business: "food", keyId: "rzp_test_Abc12345XYZ", keySecret: "s3cr3tvalue" }, META);
    const live = await s.savePayments(sa(), ids.hotel, { business: "food", mode: "live" }, META);
    assert.deepEqual([live.mode, live.keyId, live.keySecretSet, live.enabled], ["live", "", false, false]);
    const t = await s.testPayments(sa(), ids.hotel, "food", META);
    assert.deepEqual([t.ok, t.message], [false, "The keys are not saved yet."]);
    assert.deepEqual(tested, [], "Razorpay is not asked without keys");
    await s.savePayments(sa(), ids.hotel, { business: "food", keyId: "rzp_live_Abc12345XYZ", keySecret: "s3cr3tvalue" }, META);
    testFails = new AppError("CONFLICT", "Live payments are switched off on this server. Use Test Mode.");
    const failed = await s.testPayments(sa(), ids.hotel, "food", META);
    assert.equal(failed.ok, false);
    assert.equal(failed.message, "Live payments are switched off on this server. Use Test Mode.");
    assert.match(failed.hint ?? "", /API keys/);
  });

  test("the last Test is kept (when, worked or not, never a key) and shown with the account", async () => {
    const s = service();
    assert.equal((await s.payments(sa(), ids.hotel)).items[0].lastTest, null);
    await s.savePayments(sa(), ids.hotel, { business: "hotel", keyId: "rzp_test_Abc12345XYZ", keySecret: "topsecretvalue123" }, META);
    await s.testPayments(sa(), ids.hotel, "hotel", META);
    const ok = (await s.payments(sa(), ids.hotel)).items;
    assert.deepEqual([ok[0].lastTest?.ok, ok[0].lastTest?.at, ok[1].lastTest], [true, now().toISOString(), null]);
    testFails = new AppError("CONFLICT", "Wrong keys.");
    await s.testPayments(sa(), ids.hotel, "hotel", META);
    const bad = (await s.payments(sa(), ids.hotel)).items[0].lastTest;
    assert.equal(bad?.ok, false);
    assert.ok(!JSON.stringify(cons.data.audit).includes("topsecretvalue123"));
  });

  test("the backup wizard saves the Google client and days kept; a field not sent keeps what is saved; the secret never comes back", async () => {
    const saved = new Map<string, string>();
    const settings = {
      async overview(_as: VerifiedSession, group: string) {
        assert.equal(group, "backup");
        return { groups: [], current: { key: group, fields: ["enabled", "client_id", "client_secret", "keep_days"].map((n) => (n === "client_secret" ? { key: `backup.${n}`, value: null, set: saved.has(`backup.${n}`) } : { key: `backup.${n}`, value: saved.get(`backup.${n}`) ?? null, set: false })) } };
      },
      async update(_as: VerifiedSession, _group: string, body: { values: Record<string, string | boolean> }) {
        for (const [k, v] of Object.entries(body.values)) saved.set(k, String(v === true ? "1" : v === false ? "0" : v));
        return { group: {}, message: "Saved." };
      },
    };
    const backup = { status: async () => ({ connected: false, redirectUri: "https://hms.example.in/settings/backup/google/callback", lastAt: null, lastResult: null }) };
    const s = createHotelSetupService({ unit: cons.unit, now, settings: () => settings as never, backup: () => backup as never });
    const first = await s.saveBackup(sa(), ids.hotel, { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secretvalue" }, META);
    assert.deepEqual([first.clientId, first.clientSecretSet, first.keepDays], ["123-abc.apps.googleusercontent.com", true, 30]);
    const kept = await s.saveBackup(sa(), ids.hotel, { keepDays: 14 }, META);
    assert.deepEqual([kept.clientId, kept.clientSecretSet, kept.keepDays], ["123-abc.apps.googleusercontent.com", true, 14]);
    const view = await s.backup(sa(), ids.hotel, "status", META);
    assert.ok(!JSON.stringify(view).includes("GOCSPX-secretvalue"));
    await assert.rejects(() => s.saveBackup(pa(), ids.hotel, { keepDays: 7 }, META), forbidden);
    assert.equal(saved.get("backup.keep_days"), "14");
  });

  test("the Platform Admin and every hotel role are refused, the settings code is never reached, refused writes are audited", async () => {
    const s = service();
    const hotelAdmin = makeSession({ userId: ids.pa, hotelId: ids.hotel, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    const hotelUser = makeSession({ userId: ids.pa, hotelId: ids.hotel, accountRole: "hotel_user" });
    for (const who of [pa(), hotelAdmin, hotelUser]) {
      await assert.rejects(() => s.payments(who, ids.hotel), forbidden);
      await assert.rejects(() => s.savePayments(who, ids.hotel, { business: "hotel", keyId: "rzp_test_Abc12345XYZ" }, META), forbidden);
      await assert.rejects(() => s.makeWebhookSecret(who, ids.hotel, "hotel", META), forbidden);
      await assert.rejects(() => s.testPayments(who, ids.hotel, "food", META), forbidden);
    }
    assert.deepEqual([seen.length, tested.length, store.size], [0, 0, 0]);
    assert.ok(cons.data.audit.filter((a) => a.result === "failed" && a.actorUserId === ids.pa).length >= 3);
  });
});
