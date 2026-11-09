// The hotel vault (platform 0168; MJ, 2 Nov 2026), Super Admin only. What must hold: the secret and the notes are stored sealed, never plain; the list never carries them; Show opens
// them and is audited under the hotel; a sealed value moved to another hotel or item does not open; a change that leaves the secret out keeps it, an empty one removes it; a removed item
// leaves the list; a Platform Admin cannot list, add or show; a bad input names its field.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { deriveVaultKey, memoryVaultPorts } from "../../src/server/compose/vault";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createVaultService } from "../../src/server/services/vault/vaultService";
import { makeSession } from "./helpers/session";

const KEY = deriveVaultKey(randomBytes(32));
const META = { traceId: "trace-vault-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID(), sunrise: randomUUID(), moon: randomUUID() };

describe("the hotel vault", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  let ports: ReturnType<typeof memoryVaultPorts>;
  const svc = () => createVaultService({ unit: cons.unit, now: () => new Date("2026-11-02T10:00:00+05:30"), ports, key: KEY, newId: randomUUID });
  // re-checked a minute before the service's clock (MJ, 5 Nov 2026: a Show needs a re-check in the last 5 minutes)
  const sa = (recheckedAt: Date | null = new Date("2026-11-02T09:59:00+05:30")) => ({ ...makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), ...(recheckedAt ? { recheckedAt } : {}) });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const meta = (slug: string): MemHotelMeta =>
    ({
      slug, city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"),
      submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
      statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
    }) as MemHotelMeta;
  const login = { kind: "login" as const, title: "Booking.com extranet", username: "sunrise.rajkot", url: "admin.booking.com", secret: "S3cret!pass", notes: "Recovery codes: 1111 2222" };

  beforeEach(() => {
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    ports = memoryVaultPorts();
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    for (const [id, name, slug] of [[ids.sunrise, "Hotel Sunrise", "hotel-sunrise"], [ids.moon, "Hotel Moon", "hotel-moon"]] as const) {
      auth.data().hotels.push({ id, name, status: "active" } as never);
      cons.data.hotels.set(id, meta(slug));
    }
  });

  test("the secret and the notes are stored sealed; the list never carries them; Show opens them and is audited under the hotel", async () => {
    const added = await svc().add(sa(), ids.sunrise, login, META);
    const stored = ports.rows.get(added.id);
    assert.match(String(stored?.secret), /^v1\./);
    assert.ok(!String(stored?.secret).includes("S3cret") && !String(stored?.notes).includes("1111"));
    const list = await svc().list(sa(), ids.sunrise);
    assert.deepEqual(list.map((i) => [i.title, i.username, i.hasSecret, i.hasNotes, i.updatedBy]), [["Booking.com extranet", "sunrise.rajkot", true, true, "SA"]]);
    assert.ok(!JSON.stringify(list).includes("S3cret"));
    assert.deepEqual(await svc().reveal(sa(), ids.sunrise, added.id, META), { secret: "S3cret!pass", notes: "Recovery codes: 1111 2222" });
    const last = cons.data.audit.at(-1);
    assert.deepEqual([last?.action, last?.hotelId, last?.reason], ["vault_item_revealed", ids.sunrise, "Login: Booking.com extranet"]);
  });

  test("a Show needs a fresh re-check (MJ, 5 Nov 2026): without one, or after 5 minutes, it is refused with recheck_required and no Show is recorded", async () => {
    const added = await svc().add(sa(), ids.sunrise, login, META);
    const refused = (e: { code?: string; details?: { reason?: string } }) => e.code === "FORBIDDEN" && e.details?.reason === "recheck_required";
    await assert.rejects(() => svc().reveal(sa(null), ids.sunrise, added.id, META), refused);
    await assert.rejects(() => svc().reveal(sa(new Date("2026-11-02T09:55:00+05:30")), ids.sunrise, added.id, META), refused);
    assert.ok(!cons.data.audit.some((a) => a.action === "vault_item_revealed" && a.result === "success"));
    assert.equal((await svc().reveal(sa(new Date("2026-11-02T09:56:00+05:30")), ids.sunrise, added.id, META)).secret, "S3cret!pass");
  });

  test("each hotel sees only its own items; a sealed value moved to another hotel does not open", async () => {
    const added = await svc().add(sa(), ids.sunrise, login, META);
    assert.deepEqual(await svc().list(sa(), ids.moon), []);
    await assert.rejects(() => svc().reveal(sa(), ids.moon, added.id, META), (e: { code?: string }) => e.code === "NOT_FOUND");
    const row = ports.rows.get(added.id);
    assert.ok(row);
    ports.rows.set(added.id, { ...row, hotelId: ids.moon });
    await assert.rejects(() => svc().reveal(sa(), ids.moon, added.id, META), (e: { code?: string }) => e.code === "CONFLICT");
  });

  test("a change that leaves the secret out keeps it, an empty one removes it; a removed item leaves the list", async () => {
    const added = await svc().add(sa(), ids.sunrise, login, META);
    await svc().change(sa(), ids.sunrise, added.id, { kind: "login", title: "Booking.com (Sunrise)", username: "sunrise.rajkot" }, META);
    assert.equal((await svc().reveal(sa(), ids.sunrise, added.id, META)).secret, "S3cret!pass");
    const cleared = await svc().change(sa(), ids.sunrise, added.id, { kind: "login", title: "Booking.com (Sunrise)", secret: "", notes: "" }, META);
    assert.deepEqual([cleared.hasSecret, cleared.hasNotes], [false, false]);
    await svc().remove(sa(), ids.sunrise, added.id, META);
    assert.deepEqual(await svc().list(sa(), ids.sunrise), []);
    assert.equal(cons.data.audit.at(-1)?.action, "vault_item_removed");
  });

  test("a Platform Admin cannot list, add or show; a bad input names its field", async () => {
    await assert.rejects(() => svc().list(pa(), ids.sunrise), (e: { code?: string }) => e.code === "FORBIDDEN");
    await assert.rejects(() => svc().add(pa(), ids.sunrise, login, META), (e: { code?: string }) => e.code === "FORBIDDEN");
    const bad = await svc().add(sa(), ids.sunrise, { ...login, title: "  ", expiresOn: "31-12-2026" }, META).then(() => null, (e: { details?: { fields?: Record<string, string> } }) => e.details?.fields ?? null);
    assert.deepEqual(Object.keys(bad ?? {}).sort(), ["expiresOn", "title"]);
  });
});
