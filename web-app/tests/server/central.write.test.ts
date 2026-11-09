// The Central tabs' writes (services/platform/centralWrites.ts; MJ, 3 Nov 2026: full create, read, update and delete): Super Admin only (403 for a Platform Admin, a hotel's staff, a group
// admin, a guest, an API key and a visit inside a hotel, the refusal audited), one audit line for each write with the NAMES of the fields only, the name typed out for a delete, the refusals
// (own login, the last Super Admin, a profile with a sign-in), delete hides and restore brings back, and a GST record is refreshed from the provider, never edited by hand.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildCentralConsole } from "../../src/server/compose/centralConsole";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryCentralConsole } from "../../src/server/repos/memory/centralConsole";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { makeSession } from "./helpers/session";

const META = { ip: "127.0.0.1", traceId: "trace-central-write", userAgent: "test" };
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2g";
const at = new Date("2026-11-03T10:00:00+05:30");

let central = createMemoryCentralConsole();
let cons = createMemoryPlatformConsole();
let svc: ReturnType<typeof buildCentralConsole>;
let invites: string[] = [];
let gstCalls: { gstin: string; refresh?: boolean }[] = [];
let gstFrom: "provider" | "saved" | "none" = "provider";
const S: Record<string, VerifiedSession> = {};
const ids: Record<string, string> = {};

function person(auth: ReturnType<typeof createMemoryAuth>, key: string, accountRole: string, roleId: string): void {
  const id = randomUUID();
  ids[key] = id;
  auth.data().users.push({
    id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: HASH, accountRole, status: "active", mustChangePassword: false,
    passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId,
  } as never);
  cons.data.accountMeta.set(id, { createdAt: at, createdBy: null });
  S[key] = makeSession({ userId: id, hotelId: "", accountRole: accountRole as never, roleKey: accountRole, roleLevel: 4, client: "web" });
}

const gstDetail = (id: string, gstin: string) => ({
  id, gstin, legalName: "SHAH TEXTILES", tradeName: null, status: "active" as const, state: "Gujarat", source: "gstinapi", fetchedAt: at, refreshAfter: at, timesUsed: 1, deletedAt: null, pan: gstin.slice(2, 12), stateCode: "24",
  taxpayerType: null, constitution: null, registeredOn: null, cancelledOn: null, address: null, city: null, district: null, pincode: null, natureOfBusiness: [], blockStatus: null, stateJurisdiction: null, street: null,
  locality: null, buildingName: null, buildingNumber: null, floor: null, landmark: null, raw: { legal_name: "SHAH TEXTILES" }, lastUsedAt: null, createdAt: at, updatedAt: at, deletedReason: null,
});

beforeEach(() => {
  const auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const viewer = randomUUID();
  auth.data().roles.push({ id: viewer, hotelId: null, key: "viewer", level: 1, inherits: true } as never);
  person(auth, "root", "super_admin", viewer);
  person(auth, "root2", "super_admin", viewer);
  person(auth, "pa", "platform_admin", viewer);
  central = createMemoryCentralConsole();
  invites = [];
  gstCalls = [];
  gstFrom = "provider";
  const credentials = () => ({ issueInvite: async (id: string) => (invites.push(id), { queued: true }), adminResetPassword: async () => ({ queued: true }), changeEmail: async () => ({ ok: true as const }) });
  const gst = {
    lookup: async (_s: VerifiedSession, gstin: string, o?: { refresh?: boolean }) => {
      gstCalls.push({ gstin, refresh: o?.refresh });
      if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return { message: "This is not a GSTIN.", from: "none", entry: null, check: { ok: false } };
      if (gstFrom === "none") return { message: "The GST lookup did not answer.", from: "none", entry: null, check: { ok: true } };
      if (!central.data.gst.some((g) => g.gstin === gstin)) central.data.gst.push(gstDetail(randomUUID(), gstin));
      return { message: "ok", from: gstFrom, entry: { gstin }, check: { ok: true } };
    },
  };
  svc = buildCentralConsole(central.unit(cons.unit), { credentials: credentials as never, gst }, () => at);
});

const code = (c: string) => (e: { code?: string }) => e.code === c;
const audit = (action: string) => cons.data.audit.filter((a) => a.action === action);
const guest = async (over: Record<string, unknown> = {}) => svc.createGuest(S.root, { name: "Amit Joshi", mobile: "98250 41236", email: "Amit@Example.com", city: "Surat", ...over }, META);
const company = async (over: Record<string, unknown> = {}) => svc.createCompany(S.root, { name: "Shah Textiles", gstin: "24abcde1234f1z5", email: "a@shah.in", ...over }, META);

describe("who may write", () => {
  test("only the Super Admin: a Platform Admin, hotel staff, a group admin, a guest, an API key and a visit get 403 on every write, nothing changes, and a refused role is audited as failed", async () => {
    const g = await guest();
    const c = await company();
    const r = await svc.createGst(S.root, "24ABCDE1234F1Z5", META);
    const hotel = makeSession({ accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" });
    const group = makeSession({ userId: randomUUID(), hotelId: "", accountRole: "group_hotel_admin", roleKey: "group", roleLevel: 3, client: "web" });
    const guestS = makeSession({ accountRole: "guest_user", roleKey: "guest", roleLevel: 1, client: "web" });
    const key = { ...S.root, client: "token" as const, token: { id: "t1", name: "K", level: "full" as const, scope: "all" as const, testMode: false, callsPerMinute: 60, ip: null, newIp: false } };
    const visit = { ...S.root, visit: { id: "v1", hotelId: randomUUID(), hotelName: "H", expiresAt: new Date(), access: "full" as const, by: "super_admin" as const } };
    const before = JSON.stringify(central.data);
    for (const [who, s] of Object.entries({ pa: S.pa, hotel, group, guest: guestS, key, visit })) {
      const w = s as VerifiedSession;
      const calls: Promise<unknown>[] = [
        svc.createLogin(w, { username: "new.admin", displayName: "New", email: "n@x.in", mobile: "9876543210", roleType: "platform_admin" }, META),
        svc.updateLogin(w, ids.pa, { displayName: "X" }, META), svc.deleteLogin(w, ids.pa, { confirmName: "pa" }, META),
        svc.createGuest(w, { name: "N" }, META), svc.updateGuest(w, g.id, { city: "X" }, META), svc.deleteGuest(w, g.id, { confirmName: g.name }, META), svc.restoreGuest(w, g.id, META),
        svc.createCompany(w, { name: "N" }, META), svc.updateCompany(w, c.id, { city: "X" } as never, META), svc.deleteCompany(w, c.id, { confirmName: c.name }, META), svc.restoreCompany(w, c.id, META),
        svc.createGst(w, "27AAPFU0939F1ZV", META), svc.refreshGst(w, r.id, META), svc.deleteGst(w, r.id, { confirmName: r.gstin }, META), svc.restoreGst(w, r.id, META),
      ];
      for (const [i, p] of calls.entries()) await assert.rejects(p, code("FORBIDDEN"), `${who} call ${i}`);
    }
    assert.equal(JSON.stringify(central.data), before, "nothing changed");
    assert.deepEqual(invites, []);
    assert.ok(audit("central_created").some((a) => a.result === "failed" && a.actorRole === "platform_admin"), "a Platform Admin's refused write is audited as failed");
    assert.equal(audit("central_deleted").filter((a) => a.result === "success").length, 0);
  });
});

describe("guest and company profiles", () => {
  test("create, edit and delete: field rules, one audit line each with field NAMES only, the name typed out, hidden when deleted and back when restored", async () => {
    await assert.rejects(svc.createGuest(S.root, { name: "X", mobile: "12345" }, META), (e: { code?: string; details?: { fields?: Record<string, string> } }) => e.code === "VALIDATION_FAILED" && Boolean(e.details?.fields?.mobile));
    await assert.rejects(svc.createGuest(S.root, { name: "" }, META), code("VALIDATION_FAILED"));
    const g = await guest();
    assert.deepEqual([g.name, g.mobile, g.email, g.city], ["Amit Joshi", "+91 ••••• ••236", "a•••@example.com", "Surat"], "stored in the profile's form, shown masked");
    const made = audit("central_created").find((a) => a.result === "success")!;
    assert.deepEqual([made.entityId, made.targetLabel, made.actorRole], [g.id, "Guest profile: Amit Joshi", "super_admin"]);
    assert.ok(!JSON.stringify(made).includes("9825041236") && !JSON.stringify(made).includes("example.com"), "no value in the audit line");
    assert.deepEqual((made.after as { fields: string[] }).fields.sort(), ["displayName", "email", "mobile", "city"].sort());

    const edited = await svc.updateGuest(S.root, g.id, { city: "Rajkot", address: null }, META);
    assert.equal(edited.city, "Rajkot");
    assert.deepEqual((audit("central_updated")[0].after as { fields: string[] }).fields.sort(), ["address", "city"]);

    await assert.rejects(svc.deleteGuest(S.root, g.id, { confirmName: "amit" }, META), (e: { code?: string; details?: { fields?: Record<string, string> } }) => e.code === "VALIDATION_FAILED" && Boolean(e.details?.fields?.confirmName));
    assert.equal(audit("central_deleted").length, 0);
    await svc.deleteGuest(S.root, g.id, { confirmName: " Amit Joshi ", reason: "Entered twice" }, META);
    assert.equal(audit("central_deleted").filter((a) => a.result === "success")[0].reason, "Entered twice");
    assert.equal(((await svc.list(S.root, "guests", { page: 1, pageSize: 25 })) as { total: number }).total, 0, "hidden from the list");
    const gone = (await svc.list(S.root, "guests", { deleted: true, page: 1, pageSize: 25 })) as { items: { id: string; deletedAt: string }[] };
    assert.deepEqual([gone.items.length, gone.items[0].id, typeof gone.items[0].deletedAt], [1, g.id, "string"]);
    await assert.rejects(svc.updateGuest(S.root, g.id, { city: "X" }, META), code("CONFLICT"));
    const back = await svc.restoreGuest(S.root, g.id, META);
    assert.equal(back.deletedAt, null);
    assert.equal(audit("central_restored").length, 1);
    assert.equal(((await svc.list(S.root, "guests", { page: 1, pageSize: 25 })) as { total: number }).total, 1);
  });

  test("a profile with a sign-in cannot be deleted (409 with a sentence) and stays; a company's GSTIN is shape-checked", async () => {
    const g = await guest();
    central.data.guests[0].hasLogin = true;
    await assert.rejects(svc.deleteGuest(S.root, g.id, { confirmName: g.name }, META), (e: { code?: string; message?: string }) => e.code === "CONFLICT" && /sign-in/.test(e.message ?? ""));
    assert.equal(central.data.guests[0].deletedAt, null);
    await assert.rejects(svc.createCompany(S.root, { name: "Bad", gstin: "NOT-A-GSTIN" }, META), (e: { code?: string; details?: { fields?: Record<string, string> } }) => e.code === "VALIDATION_FAILED" && Boolean(e.details?.fields?.gstin));
    const c = await company();
    assert.equal(c.gstin, "24ABCDE1234F1Z5", "upper case");
    await svc.deleteCompany(S.root, c.id, { confirmName: "Shah Textiles" }, META);
    await assert.rejects(svc.deleteCompany(S.root, c.id, { confirmName: "Shah Textiles" }, META), code("CONFLICT"));
    assert.equal((await svc.restoreCompany(S.root, c.id, META)).deletedAt, null);
  });
});

describe("GST records", () => {
  test("create looks the GSTIN up now (a bad number is refused), refresh asks the provider again and is audited, delete and restore need the GSTIN typed and a fallback to the saved record is a refusal", async () => {
    await assert.rejects(svc.createGst(S.root, "BAD", META), code("VALIDATION_FAILED"));
    const r = await svc.createGst(S.root, "24abcde1234f1z5".toUpperCase(), META);
    assert.deepEqual([gstCalls.at(-1), audit("central_created").length], [{ gstin: "24ABCDE1234F1Z5", refresh: false }, 1]);
    const again = await svc.refreshGst(S.root, r.id, META);
    assert.deepEqual([gstCalls.at(-1)?.refresh, again.id, audit("central_updated").length], [true, r.id, 1]);
    gstFrom = "saved";
    await assert.rejects(svc.refreshGst(S.root, r.id, META), (e: { code?: string; message?: string }) => e.code === "CONFLICT" && /saved record was kept/.test(e.message ?? ""));
    gstFrom = "provider";
    await assert.rejects(svc.deleteGst(S.root, r.id, { confirmName: "wrong" }, META), code("VALIDATION_FAILED"));
    await svc.deleteGst(S.root, r.id, { confirmName: r.gstin }, META);
    assert.equal(((await svc.list(S.root, "gst", { page: 1, pageSize: 25 })) as { total: number }).total, 0);
    await assert.rejects(svc.refreshGst(S.root, r.id, META), code("CONFLICT"));
    assert.equal((await svc.restoreGst(S.root, r.id, META)).deletedAt, null);
    assert.equal("updateGst" in svc, false, "no manual editing of what the provider said");
    assert.equal("createLookup" in svc || "deleteLookup" in svc, false, "the lookup log is read only");
  });
});

describe("logins", () => {
  test("create goes through the account side: invited, the invitation issued, no password anywhere; duplicates and a missing hotel are refused", async () => {
    const made = await svc.createLogin(S.root, { username: "new.admin", displayName: "New Admin", email: "New@Demo.hms", mobile: "98765 43210", roleType: "platform_admin" }, META);
    assert.deepEqual([made.username, made.roleType], ["new.admin", "platform_admin"]);
    assert.deepEqual(invites, [made.id]);
    assert.ok(!/argon2|passwordHash|tempPassword|temporary|secret|token/i.test(JSON.stringify(made)), "nothing secret in the answer");
    assert.ok(!/argon2|passwordHash|tempPassword|temporary|secret/i.test(JSON.stringify(audit("central_created"))), "nothing secret in the audit");
    await assert.rejects(svc.createLogin(S.root, { username: "new.admin", displayName: "Again", email: "other@demo.hms", mobile: "9876543211", roleType: "platform_admin" }, META), (e: { details?: { fields?: Record<string, string> } }) => Boolean(e.details?.fields?.username));
    await assert.rejects(svc.createLogin(S.root, { username: "hotel.person", displayName: "H", email: "h@demo.hms", mobile: "9876543212", roleType: "hotel_admin" }, META), (e: { details?: { fields?: Record<string, string> } }) => Boolean(e.details?.fields?.hotelId));
    await assert.rejects(svc.createLogin(S.root, { username: "x.y", displayName: "H", email: "h@demo.hms", mobile: "9876543212", roleType: "super_admin" as never }, META), code("VALIDATION_FAILED"));
  });

  test("update changes the name, email and mobile (names audited); delete closes the login: the name typed, never your own, never the last Super Admin; a refused delete is audited as failed", async () => {
    const made = await svc.createLogin(S.root, { username: "new.admin", displayName: "New Admin", email: "n@demo.hms", mobile: "9876543210", roleType: "platform_admin" }, META);
    const up = await svc.updateLogin(S.root, made.id, { displayName: "Renamed", email: "renamed@demo.hms" }, META);
    assert.equal(up.displayName, "Renamed");
    assert.deepEqual((audit("central_updated")[0].after as { fields: string[] }).fields.sort(), ["displayName", "email"]);
    await assert.rejects(svc.updateLogin(S.root, made.id, { mobile: "123" }, META), code("VALIDATION_FAILED"));

    await assert.rejects(svc.deleteLogin(S.root, made.id, { confirmName: "nope" }, META), code("VALIDATION_FAILED"));
    await assert.rejects(svc.deleteLogin(S.root, ids.root, { confirmName: "root" }, META), (e: { code?: string; message?: string }) => e.code === "CONFLICT" && /your own/.test(e.message ?? ""));
    // root2 is the other Super Admin; with only one left the last cannot be deleted either
    await svc.deleteLogin(S.root, ids.root2, { confirmName: "root2", reason: "Left the company" }, META);
    await assert.rejects(svc.deleteLogin(S.root2 ?? S.root, ids.root, { confirmName: "root" }, META), code("FORBIDDEN"));
    assert.ok(audit("central_deleted").some((a) => a.result === "failed"), "the refusal is audited as failed");
    await svc.deleteLogin(S.root, made.id, { confirmName: "new.admin" }, META);
    assert.equal(cons.data.audit.filter((a) => a.action === "central_deleted" && a.result === "success").length, 2);
    await assert.rejects(svc.deleteLogin(S.root, made.id, { confirmName: "new.admin" }, META), code("NOT_FOUND"));
  });
});
