// The Super Admin's "Possible duplicates" of the one common guest and company profile (services/platform/profileReviewService.ts; platform 0132) over the in-memory central
// profiles and the in-memory platform console (accounts + audit log): the list (same mobile / email / GSTIN, oldest first, kept-apart pairs left out), merge (an explicit
// decision with a reason: the hotels' links move to the kept profile, the others stay as history, a login moves only when the kept one has none, two logins are refused,
// audited), keep apart and its undo; Super Admin only. A merge never reaches a hotel: it only has the platform's tables to work with.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { VerifiedSession } from "../../src/server/auth/session";
import type { ProfileReviewUnit } from "../../src/server/repos/centralProfiles";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryCentralProfiles } from "../../src/server/repos/memory/centralProfiles";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createProfileReviewService } from "../../src/server/services/platform/profileReviewService";
import { makeSession } from "./helpers/session";

const META = { ip: "127.0.0.1", traceId: "trace-review", userAgent: "test" };
const H1 = randomUUID();
const H2 = randomUUID();
const H3 = randomUUID();

let central = createMemoryCentralProfiles();
let cons = createMemoryPlatformConsole();
let service = createProfileReviewService({ unit: { run: async () => undefined as never }, now: () => new Date() });
const S: Record<string, VerifiedSession> = {};

function person(auth: ReturnType<typeof createMemoryAuth>, key: string, accountRole: string, roleId: string): string {
  const id = randomUUID();
  auth.data().users.push({
    id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole, status: "active", mustChangePassword: false,
    passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId,
  } as never);
  cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
  S[key] = makeSession({ userId: id, hotelId: "", accountRole: accountRole as never, roleKey: accountRole, roleLevel: 4, client: "web" });
  return id;
}

beforeEach(() => {
  const auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const viewer = randomUUID();
  auth.data().roles.push({ id: viewer, hotelId: null, key: "viewer", level: 1, inherits: true } as never);
  person(auth, "root", "super_admin", viewer);
  person(auth, "pa", "platform_admin", viewer);
  // a clock that moves a minute per profile, so "oldest first" has an order
  let tick = Date.parse("2026-10-18T10:00:00+05:30");
  central = createMemoryCentralProfiles(() => new Date((tick += 60_000)));
  central.data.hotelNames = new Map([[H1, "Hotel Sunrise"], [H2, "Sunrise Residency"], [H3, "Gir Lodge"]]);
  const unit: ProfileReviewUnit = { run: (work) => central.unit.run((c) => cons.unit.run((k) => work({ central: c, console: k }))) };
  service = createProfileReviewService({ unit, now: () => new Date("2026-10-18T10:00:00+05:30") });
});

/** A guest profile with links to hotel records. */
const guest = async (name: string, over: { mobile?: string | null; email?: string | null; userId?: string | null; hotels?: string[] } = {}) =>
  central.unit.run(async (r) => {
    const g = await r.guests.create({ displayName: name, mobile: over.mobile ?? null, email: over.email ?? null, address: null, city: null, userId: over.userId ?? null });
    for (const h of over.hotels ?? [H1]) await r.guests.link(h, randomUUID(), g.id);
    return g.id;
  });

describe("possible duplicates", () => {
  test("guests sharing a mobile or an email are listed, oldest first, with their hotels; a single profile is not", async () => {
    const a = await guest("Amit Joshi", { mobile: "+919825041236", email: "amit@example.com", hotels: [H1] });
    const b = await guest("Amit J.", { mobile: "+919825041236", hotels: [H2, H3] });
    await guest("Neha", { mobile: "+919898012345" });
    const page = await service.duplicates(S.root, { kind: "guest", page: 1, pageSize: 25 });
    assert.equal(page.total, 1);
    const [g] = page.items;
    assert.deepEqual([g.by, g.value, g.profiles.map((p) => p.id)], ["mobile", "+919825041236", [a, b]]);
    assert.deepEqual(g.profiles[1].hotels.map((h) => h.hotelName), ["Sunrise Residency", "Gir Lodge"]);
    assert.equal((await service.duplicates(S.root, { kind: "guest", search: "neha", page: 1, pageSize: 25 })).total, 0, "search narrows the groups");
    assert.equal((await service.duplicates(S.root, { kind: "company", page: 1, pageSize: 25 })).total, 0);
  });

  test("Super Admin only: a Platform Admin and a hotel's staff get 403", async () => {
    await assert.rejects(service.duplicates(S.pa, { kind: "guest", page: 1, pageSize: 25 }), (e: { code?: string }) => e.code === "FORBIDDEN");
    const staff = makeSession({ userId: randomUUID(), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" });
    await assert.rejects(service.duplicates(staff, { kind: "guest", page: 1, pageSize: 25 }), (e: { code?: string }) => e.code === "FORBIDDEN");
    await assert.rejects(service.merge(S.pa, { kind: "guest", keepId: randomUUID(), mergeIds: [randomUUID()], reason: "Same person" }, META), (e: { code?: string }) => e.code === "FORBIDDEN");
    assert.ok(cons.data.audit.some((r) => r.action === "profile_merged" && r.result === "failed"), "a refused merge is audited as failed");
  });
});

describe("merge", () => {
  test("keeps one, moves the others' hotel links to it, keeps the others as history, moves a login only when the kept one has none; audited with the reason", async () => {
    const login = randomUUID();
    const keep = await guest("Amit Joshi", { mobile: "+919825041236", hotels: [H1] });
    const gone = await guest("Amit J.", { mobile: "+919825041236", userId: login, hotels: [H2, H3] });
    const res = await service.merge(S.root, { kind: "guest", keepId: keep, mergeIds: [gone], reason: "Same mobile, same person at two hotels" }, META);
    assert.deepEqual([res.merged, res.relinked, res.kept.hasLogin], [1, 2, true]);
    assert.deepEqual(res.kept.hotels.map((h) => h.hotelName).sort(), ["Gir Lodge", "Hotel Sunrise", "Sunrise Residency"]);
    assert.deepEqual(central.data.guestLinks.map((l) => l.guestId), [keep, keep, keep], "every hotel record now points at the kept profile");
    const goneRow = central.data.guests.find((g) => g.id === gone)!;
    assert.equal(goneRow.mergedInto, keep, "the other stays as history");
    assert.equal((await central.unit.run((r) => r.guests.byUser(login)))?.id, keep, "the login now finds the kept profile");
    assert.equal((await service.duplicates(S.root, { kind: "guest", page: 1, pageSize: 25 })).total, 0, "nothing left to review");
    const row = cons.data.audit.find((r) => r.action === "profile_merged" && r.result === "success")!;
    assert.deepEqual([row.reason, row.entityId, (row.after as { relinked: number }).relinked], ["Same mobile, same person at two hotels", keep, 2]);
    // merging again is a 404: the other is not live any more
    await assert.rejects(service.merge(S.root, { kind: "guest", keepId: keep, mergeIds: [gone], reason: "Again please" }, META), (e: { code?: string }) => e.code === "NOT_FOUND");
  });

  test("two profiles with their own sign-in are two people: 409, nothing changes; a reason and a choice are needed", async () => {
    const a = await guest("Neha", { email: "neha@example.com", userId: randomUUID() });
    const b = await guest("Neha S.", { email: "neha@example.com", userId: randomUUID(), hotels: [H2] });
    await assert.rejects(service.merge(S.root, { kind: "guest", keepId: a, mergeIds: [b], reason: "Same email" }, META), (e: { code?: string; message?: string }) => e.code === "CONFLICT" && /two people/.test(e.message ?? ""));
    assert.deepEqual(central.data.guestLinks.map((l) => l.guestId).sort(), [a, b].sort());
    assert.equal(central.data.guests.filter((g) => g.mergedInto !== null).length, 0);
    const bads: { reason?: string; mergeIds?: string[] }[] = [{ reason: "x" }, { mergeIds: [] }, { mergeIds: [a] }];
    for (const bad of bads) {
      await assert.rejects(service.merge(S.root, { kind: "guest", keepId: a, mergeIds: bad.mergeIds ?? [b], reason: bad.reason ?? "Same email" }, META), (e: { code?: string }) => e.code === "VALIDATION_FAILED", JSON.stringify(bad));
    }
  });

  test("companies by GSTIN: merged the same way", async () => {
    const make = (name: string, hotel: string) =>
      central.unit.run(async (r) => {
        const c = await r.companies.create({ name, mainContactName: null, gstin: "24AAACT2727Q1ZW", email: null, mobile: null, landline: null, address: null, pincode: null, country: null, contacts: [], userId: null });
        await r.companies.link(hotel, randomUUID(), c.id);
        return c.id;
      });
    const keep = await make("Tata Consultancy Services", H1);
    const gone = await make("TCS Ltd", H2);
    const [group] = (await service.duplicates(S.root, { kind: "company", page: 1, pageSize: 25 })).items;
    assert.deepEqual([group.by, group.profiles.length], ["gstin", 2]);
    const res = await service.merge(S.root, { kind: "company", keepId: keep, mergeIds: [gone], reason: "Same GSTIN" }, META);
    assert.deepEqual([res.relinked, central.data.companyLinks.map((l) => l.companyId)], [1, [keep, keep]]);
  });
});

describe("keep apart", () => {
  test("a pair marked not the same stops showing; undo shows it again; both audited", async () => {
    const a = await guest("Ravi", { mobile: "+919000000001" });
    const b = await guest("Ravi K", { mobile: "+919000000001", hotels: [H2] });
    assert.deepEqual(await service.keepApart(S.root, { kind: "guest", leftId: b, rightId: a }, META), { kept: true });
    assert.deepEqual(await service.keepApart(S.root, { kind: "guest", leftId: a, rightId: b }, META), { kept: false }, "the pair is stored once, in either order");
    assert.equal((await service.duplicates(S.root, { kind: "guest", page: 1, pageSize: 25 })).total, 0);
    assert.deepEqual(await service.undoKeepApart(S.root, { kind: "guest", leftId: a, rightId: b }, META), { undone: true });
    assert.equal((await service.duplicates(S.root, { kind: "guest", page: 1, pageSize: 25 })).total, 1);
    assert.deepEqual(cons.data.audit.filter((r) => r.result === "success").map((r) => r.action), ["profile_kept_apart", "profile_kept_apart_undone"]);
  });
});
