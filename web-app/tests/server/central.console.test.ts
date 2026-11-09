// The Central tabs of the Platform console (services/platform/centralConsoleService.ts; contract ui-shared/dashboards/central.ts) over the in-memory double: who may read (Platform Admin
// and Super Admin only, never an API key, never a visit inside a hotel), that a mobile and an email are masked everywhere and only Reveal returns a full one (with exactly one audit line
// that never holds the value), that nothing secret is ever in an answer, and that the routes are read only and closed to API keys.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { tokenCallVerdict, tokenPathVerdict } from "../../src/server/auth/apiTokens";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryCentralConsole } from "../../src/server/repos/memory/centralConsole";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createCentralConsoleService, maskEmail, maskMobile } from "../../src/server/services/platform/centralConsoleService";
import { makeSession } from "./helpers/session";

const META = { ip: "127.0.0.1", traceId: "trace-central", userAgent: "test" };
const FULL_MOBILE = "+919825041236";
const FULL_EMAIL = "amit.joshi@example.com";
const CONTACT_MOBILE = "+919898012345";
const CONTACT_EMAIL = "ravi@shahtextiles.in";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2g";

let central = createMemoryCentralConsole();
let cons = createMemoryPlatformConsole();
let service = createCentralConsoleService({ unit: { run: async () => undefined as never }, now: () => new Date() });
const S: Record<string, VerifiedSession> = {};
const ID = { guest: randomUUID(), company: randomUUID(), login: randomUUID(), gst: randomUUID(), lookup: randomUUID() };

function person(auth: ReturnType<typeof createMemoryAuth>, key: string, accountRole: string, roleId: string): void {
  const id = randomUUID();
  auth.data().users.push({
    id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: HASH, accountRole, status: "active", mustChangePassword: false,
    passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId,
  } as never);
  cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
  S[key] = makeSession({ userId: id, hotelId: "", accountRole: accountRole as never, roleKey: accountRole, roleLevel: 4, client: "web" });
}

beforeEach(() => {
  const auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const viewer = randomUUID();
  auth.data().roles.push({ id: viewer, hotelId: null, key: "viewer", level: 1, inherits: true } as never);
  person(auth, "root", "super_admin", viewer);
  person(auth, "pa", "platform_admin", viewer);
  central = createMemoryCentralConsole();
  const d = central.data;
  const at = new Date("2026-10-18T10:00:00+05:30");
  d.logins.push({
    id: ID.login, username: "amit.joshi", displayName: "Amit Joshi", roleType: "guest_user", status: "active", hotels: ["Hotel Sunrise"], lastLoginAt: at, locked: false, closed: false, createdAt: at,
    hotelLinks: [{ hotelId: randomUUID(), hotelName: "Hotel Sunrise", status: "active" }], blockedKind: null, blockedAt: null, lockedUntil: null, failedAttempts: 0, lockLevel: 0, mustChangePassword: false,
    codeRequired: true, passwordChangedAt: null, activeSessions: 1, profile: { kind: "guest", id: ID.guest, name: "Amit Joshi" },
  });
  d.guests.push({
    id: ID.guest, name: "Amit Joshi", mobile: FULL_MOBILE, email: FULL_EMAIL, city: "Surat", hotelCount: 1, hasLogin: true, mergedInto: null, deletedAt: null, deletedReason: null, createdAt: at, address: "12 Ring Road",
    hotels: [{ hotelId: randomUUID(), hotelName: "Hotel Sunrise" }], loginUsername: "amit.joshi", updatedAt: at, history: { mergedInto: null, mergedAt: null, mergedByName: null, mergedFrom: [] },
  });
  d.companies.push({
    id: ID.company, name: "Shah Textiles", gstin: "24ABCDE1234F1Z5", mainContactName: "Ravi Shah", email: "accounts@shahtextiles.in", mobile: "9898012345", hotelCount: 1, hasLogin: false, mergedInto: null, deletedAt: null, deletedReason: null, createdAt: at,
    landline: "0261 2345678", address: "Udhna", pincode: "394210", country: "India", contacts: [{ name: "Ravi Shah", role: "Owner", email: CONTACT_EMAIL, mobile: CONTACT_MOBILE }],
    hotels: [{ hotelId: randomUUID(), hotelName: "Hotel Sunrise" }], loginUsername: null, updatedAt: at, history: { mergedInto: null, mergedAt: null, mergedByName: null, mergedFrom: [] },
  });
  d.gst.push({
    id: ID.gst, gstin: "24ABCDE1234F1Z5", legalName: "SHAH TEXTILES PRIVATE LIMITED", tradeName: "Shah Textiles", status: "active", state: "Gujarat", source: "gstinapi", fetchedAt: at, refreshAfter: new Date(at.getTime() + 365 * 86_400_000),
    timesUsed: 3, deletedAt: null, deletedReason: null, pan: "ABCDE1234F", stateCode: "24", taxpayerType: "Regular", constitution: null, registeredOn: "2018-04-02", cancelledOn: null, address: "Udhna", city: "Surat", district: "Surat", pincode: "394210",
    natureOfBusiness: ["Wholesale Business"], blockStatus: "Unblocked", stateJurisdiction: null, street: "Main Road", locality: "Udhna", buildingName: null, buildingNumber: "12", floor: null, landmark: null, raw: { legal_name: "SHAH TEXTILES PRIVATE LIMITED" }, lastUsedAt: at, createdAt: at, updatedAt: at,
  });
  d.lookups.push({ id: ID.lookup, gstin: "24ABCDE1234F1Z5", provider: "gstinapi", outcome: "found", errorCode: null, tookMs: 800, hotelName: "Hotel Sunrise", requestedBy: "amit.joshi", createdAt: at });
  service = createCentralConsoleService({ unit: central.unit(cons.unit), now: () => new Date("2026-10-18T10:00:00+05:30") });
});

const code = (c: string) => (e: { code?: string }) => e.code === c;
const Q = { page: 1, pageSize: 25 };
const TABS = ["logins", "guests", "companies", "gst", "lookups"] as const;

describe("who may read", () => {
  test("Platform Admin and Super Admin read every tab; the numbers match", async () => {
    for (const who of ["root", "pa"]) {
      for (const tab of TABS) assert.equal(((await service.list(S[who], tab, Q)) as { total: number }).total, 1, `${who} ${tab}`);
    }
  });

  test("a hotel's staff, a group admin, a guest, an API key and a visit inside a hotel get 403, and nothing is read", async () => {
    const hotel = makeSession({ accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" });
    const group = makeSession({ userId: randomUUID(), hotelId: "", accountRole: "group_hotel_admin", roleKey: "group", roleLevel: 3, client: "web" });
    const guest = makeSession({ accountRole: "guest_user", roleKey: "guest", roleLevel: 1, client: "web" });
    const key = { ...S.root, client: "token" as const, token: { id: "t1", name: "Reports", level: "read" as const, scope: "platform" as const, testMode: true, callsPerMinute: 60, ip: null, newIp: false } };
    const visit = { ...S.root, visit: { id: "v1", hotelId: randomUUID(), hotelName: "Hotel Sunrise", expiresAt: new Date(), access: "view" as const, by: "super_admin" as const } };
    for (const [name, s] of Object.entries({ hotel, group, guest, key, visit })) {
      for (const tab of TABS) {
        await assert.rejects(service.list(s as VerifiedSession, tab, Q), code("FORBIDDEN"), `${name} list ${tab}`);
        await assert.rejects(service.detail(s as VerifiedSession, tab, ID.login), code("FORBIDDEN"), `${name} detail ${tab}`);
      }
      await assert.rejects(service.reveal(s as VerifiedSession, { kind: "guest", id: ID.guest, field: "mobile" }, META), code("FORBIDDEN"), `${name} reveal`);
    }
    assert.equal(cons.data.audit.filter((a) => a.action === "central_revealed").length, 0, "nothing was revealed or audited");
  });

  test("a closed account (Platform Admin disabled after the session began) is refused too", async () => {
    await assert.rejects(service.list({ ...S.pa, userId: randomUUID() }, "logins", Q), code("FORBIDDEN"));
  });
});

describe("masking and secrets", () => {
  test("a mobile and an email are masked in every list and detail; the full values appear nowhere", async () => {
    const all: unknown[] = [];
    for (const tab of TABS) all.push(await service.list(S.root, tab, Q));
    all.push(await service.detail(S.root, "guests", ID.guest), await service.detail(S.root, "companies", ID.company));
    const json = JSON.stringify(all);
    for (const secret of [FULL_MOBILE, "9825041236", FULL_EMAIL, "accounts@shahtextiles.in", "9898012345", CONTACT_EMAIL, CONTACT_MOBILE, "2345678"]) assert.ok(!json.includes(secret), `${secret} is masked`);
    const g = (await service.detail(S.root, "guests", ID.guest)) as { mobile: string; email: string };
    assert.deepEqual([g.mobile, g.email], ["+91 ••••• ••236", "a•••@example.com"]);
    assert.equal(maskMobile("9898012345"), "••••• ••345");
    assert.equal(maskMobile(null), null);
    assert.equal(maskEmail("x"), "x•••");
  });

  test("no password hash, token, session id or auth code is in any answer, and the keys of the answers are listed", async () => {
    const all = JSON.stringify([...(await Promise.all(TABS.map((t) => service.list(S.root, t, Q)))), await service.detail(S.root, "logins", ID.login), await service.detail(S.root, "gst", ID.gst)]);
    assert.ok(!all.includes("argon2"), "no password hash");
    assert.ok(!/password_?hash|passwordHash|token|sessionId|session_id|authCode|auth_code|apiKey|api_key|secret/i.test(all), "no secret-like key");
    const login = (await service.detail(S.root, "logins", ID.login)) as Record<string, unknown>;
    assert.equal(login.activeSessions, 1, "a count of open sign-ins, never a session id");
  });

  test("the search finds a mobile or an email only by its FULL value, never by a part", async () => {
    const find = async (search: string) => ((await service.list(S.root, "guests", { ...Q, search })) as { total: number }).total;
    assert.equal(await find("Amit"), 1);
    assert.equal(await find("9825041236"), 1, "the full mobile");
    assert.equal(await find(FULL_EMAIL), 1, "the full email");
    assert.equal(await find("98250"), 0, "a part of a mobile");
    assert.equal(await find("amit.joshi@"), 0, "a part of an email");
  });
});

describe("reveal", () => {
  test("returns the full value and writes exactly one audit line (who, which profile) that never holds the value", async () => {
    const r = await service.reveal(S.pa, { kind: "guest", id: ID.guest, field: "mobile" }, META);
    assert.equal(r.value, FULL_MOBILE);
    const rows = cons.data.audit.filter((a) => a.action === "central_revealed");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].result, rows[0].entityId, rows[0].actorRole, rows[0].targetLabel], ["success", ID.guest, "platform_admin", "Guest profile: Amit Joshi"]);
    assert.ok(!JSON.stringify(rows[0]).includes("9825041236"), "the audit row has no value");
    assert.equal((await service.reveal(S.root, { kind: "company", id: ID.company, field: "contactEmail", index: 0 }, META)).value, CONTACT_EMAIL);
    assert.equal((await service.reveal(S.root, { kind: "company", id: ID.company, field: "landline" }, META)).value, "0261 2345678");
    assert.equal(cons.data.audit.filter((a) => a.action === "central_revealed").length, 3, "one line per reveal");
  });

  test("an unknown profile, an empty value or a field that does not belong is refused and audits nothing", async () => {
    await assert.rejects(service.reveal(S.root, { kind: "guest", id: randomUUID(), field: "email" }, META), code("NOT_FOUND"));
    await assert.rejects(service.reveal(S.root, { kind: "company", id: ID.company, field: "contactMobile", index: 5 }, META), code("NOT_FOUND"));
    await assert.rejects(service.reveal(S.root, { kind: "guest", id: ID.guest, field: "landline" }, META), code("VALIDATION_FAILED"));
    assert.equal(cons.data.audit.filter((a) => a.action === "central_revealed").length, 0);
  });
});

describe("details and a database without the tables", () => {
  test("every tab opens its record; an unknown id is 404", async () => {
    assert.equal(((await service.detail(S.root, "logins", ID.login)) as { username: string }).username, "amit.joshi");
    assert.equal(((await service.detail(S.root, "gst", ID.gst)) as { raw: { legal_name: string } }).raw.legal_name, "SHAH TEXTILES PRIVATE LIMITED");
    assert.equal(((await service.detail(S.root, "lookups", ID.lookup)) as { outcome: string }).outcome, "found");
    for (const tab of TABS) await assert.rejects(service.detail(S.root, tab, randomUUID()), code("NOT_FOUND"));
  });

  test("a database without migration 0132 or 0167 answers empty profile and GST tabs, never an error", async () => {
    central.data.available = { profiles: false, gst: false };
    for (const tab of ["guests", "companies", "gst", "lookups"] as const) assert.equal(((await service.list(S.root, tab, Q)) as { total: number }).total, 0, tab);
    assert.equal(((await service.list(S.root, "logins", Q)) as { total: number }).total, 1);
    await assert.rejects(service.detail(S.root, "guests", ID.guest), code("NOT_FOUND"));
  });
});

describe("the routes are read only and closed to API keys (inventory)", () => {
  const root = path.join(process.cwd(), "src", "app", "api", "v1", "platform", "central");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") files.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
    }
  };
  walk(root);

  test("five route files; no PUT anywhere; the writes are POST (create, restore, refresh, reveal), PATCH and DELETE, and each write route is in the Super Admin inventory below", () => {
    assert.deepEqual(files.sort(), ["[tab]/[id]/[action]/route.ts", "[tab]/[id]/route.ts", "[tab]/route.ts", "reveal/route.ts"].sort());
    for (const f of files) {
      const src = readFileSync(path.join(root, f), "utf8");
      assert.ok(!/export const PUT\b/.test(src), `${f} has no PUT`);
      assert.equal(/export const (PATCH|DELETE)\b/.test(src), f === "[tab]/[id]/route.ts", f);
      assert.equal(/export const POST\b/.test(src), f !== "[tab]/[id]/route.ts", f);
    }
  });

  test("a hotel's own screens and routes never read the Central routes: only the Platform console page, its adapter and the Central routes themselves do", () => {
    const src = path.join(process.cwd(), "src");
    const users: string[] = [];
    const walk2 = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk2(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /platform\/central|getCentralConsole|compose\/centralConsole|adapters\/central['"]/.test(readFileSync(p, "utf8"))) users.push(path.relative(src, p).replace(/\\/g, "/"));
      }
    };
    walk2(src);
    assert.deepEqual(users.sort(), [
      "app/api/v1/platform/central/[tab]/[id]/[action]/route.ts", "app/api/v1/platform/central/[tab]/[id]/route.ts", "app/api/v1/platform/central/[tab]/route.ts", "app/api/v1/platform/central/reveal/route.ts",
      "dashboards/groups/platform/Central.tsx", "lib/api/adapters/central.ts", "server/compose/centralConsole.ts",
    ]);
  });

  test("every Central address is refused to every API key (any level, any scope, GET or POST)", () => {
    for (const p of ["/api/v1/platform/central/logins", "/api/v1/platform/central/guests/x", "/api/v1/platform/central/gst-lookups", "/api/v1/platform/central/reveal", "/api/v1/platform/central/%67uests", "/api/v1/platform/Central/guests".toLowerCase()]) {
      assert.equal(tokenPathVerdict(p).allowed, false, p);
      for (const level of ["read", "full"] as const) for (const scope of ["platform", "hotel", "all"] as const) for (const method of ["GET", "POST"]) assert.equal(tokenCallVerdict({ level, scope, testMode: false }, method, p).allowed, false, `${level} ${scope} ${method} ${p}`);
    }
  });
});
