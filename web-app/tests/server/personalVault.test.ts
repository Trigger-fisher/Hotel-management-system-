// My vault (platform 0190; MJ, 5 Nov 2026): a Super Admin's own items. What must hold: only the owner lists or opens them; another Super Admin, a Platform Admin and an API key
// get NOT_FOUND (never FORBIDDEN, so the vault's existence is not shown); the secret and the notes are sealed with the owner's own data key (itself stored sealed); the list, the audit
// rows and the console never carry the secret or the item's name; a sealed value moved to another owner does not open.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, test } from "node:test";
import { derivePersonalVaultKey, memoryPersonalVaultPorts } from "../../src/server/compose/personalVault";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createPersonalVaultService } from "../../src/server/services/vault/personalVaultService";
import { makeSession } from "./helpers/session";

const KEY = derivePersonalVaultKey(randomBytes(32));
const META = { traceId: "trace-my-vault-1", ip: "10.0.0.5", userAgent: "node-test" };
const ids = { mj: randomUUID(), other: randomUUID(), pa: randomUUID() };
const SECRET = "Pers0nal!Gmail#pass";
const NOTES = "Backup codes 4455 6677";
const TITLE = "Personal Gmail account";
const notFound = (e: { code?: string }) => e.code === "NOT_FOUND";

describe("My vault", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  let ports: ReturnType<typeof memoryPersonalVaultPorts>;
  const lines: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const svc = () => createPersonalVaultService({ unit: cons.unit, now: () => new Date("2026-11-05T10:00:00+05:30"), ports, key: KEY, newId: randomUUID });
  // re-checked a minute before the service's clock (MJ, 5 Nov 2026: a Show needs a re-check in the last 5 minutes)
  const sa = (userId: string, recheckedAt: Date | null = new Date("2026-11-05T09:59:00+05:30")) => ({ ...makeSession({ userId, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), ...(recheckedAt ? { recheckedAt } : {}) });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const item = { kind: "password" as const, title: TITLE, username: "mj@gmail.com", url: "mail.google.com", secret: SECRET, notes: NOTES };

  beforeEach(() => {
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    ports = memoryPersonalVaultPorts();
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.mj, "mj", "super_admin"], [ids.other, "other", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
    lines.length = 0;
    for (const k of ["log", "info", "warn", "error"] as const) console[k] = (...a: unknown[]) => void lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  });
  afterEach(() => Object.assign(console, saved));

  test("a Show needs a fresh re-check: none, or one 5 minutes old, is refused with recheck_required and nothing is recorded as shown", async () => {
    const added = await svc().add(sa(ids.mj), item, META);
    const refused = (e: { code?: string; details?: { reason?: string } }) => e.code === "FORBIDDEN" && e.details?.reason === "recheck_required";
    await assert.rejects(() => svc().reveal(sa(ids.mj, null), added.id, META), refused);
    await assert.rejects(() => svc().reveal(sa(ids.mj, new Date("2026-11-05T09:55:00+05:30")), added.id, META), refused, "exactly 5 minutes old is too old");
    await assert.rejects(() => svc().reveal(sa(ids.mj, new Date("2026-11-05T10:01:00+05:30")), added.id, META), refused, "a time in the future is not a re-check");
    assert.equal((await svc().reveal(sa(ids.mj, new Date("2026-11-05T09:55:01+05:30")), added.id, META)).secret, SECRET);
    assert.equal(cons.data.audit.filter((a) => a.action === "personal_vault_item_revealed").length, 1);
    await assert.rejects(() => svc().reveal(sa(ids.other, null), randomUUID(), META), refused, "the re-check is asked before anything is looked up, so it says nothing about an item");
    await assert.rejects(() => svc().reveal(sa(ids.other), added.id, META), notFound, "another Super Admin, re-checked, still learns nothing");
  });

  test("the owner adds, lists and shows; the list never carries the secret; the audit names the type (a Show also the item's name), never the secret", async () => {
    const added = await svc().add(sa(ids.mj), item, META);
    const list = await svc().list(sa(ids.mj));
    assert.deepEqual(list.map((i) => [i.title, i.kind, i.hasSecret, i.hasNotes]), [[TITLE, "password", true, true]]);
    assert.ok(!JSON.stringify(list).includes(SECRET) && !JSON.stringify(list).includes(NOTES));
    assert.deepEqual(await svc().reveal(sa(ids.mj), added.id, META), { secret: SECRET, notes: NOTES });
    const rows = cons.data.audit.filter((a) => String(a.action).startsWith("personal_vault_"));
    assert.deepEqual(rows.map((a) => [a.action, a.actorUserId, a.entityId, a.reason]), [["personal_vault_item_added", ids.mj, ids.mj, "Password"], ["personal_vault_item_revealed", ids.mj, ids.mj, `Password: ${TITLE}`]]);
    const audit = JSON.stringify(cons.data.audit);
    assert.ok(!audit.includes(SECRET) && !audit.includes(NOTES));
    assert.ok(!JSON.stringify(rows[0]).includes(TITLE), "an add names only the type");
    assert.ok(!lines.some((l) => l.includes(SECRET) || l.includes(NOTES)), "no log line carries the secret");
  });

  test("stored sealed with the owner's own data key, which is itself stored sealed", async () => {
    const added = await svc().add(sa(ids.mj), item, META);
    const row = ports.rows.get(added.id);
    assert.match(String(row?.secret), /^v1\./);
    assert.ok(!String(row?.secret).includes(SECRET) && !String(row?.notes).includes("4455"));
    assert.match(String(ports.keys.get(ids.mj)), /^v1\./);
    assert.equal(ports.keys.size, 1);
  });

  test("another Super Admin, a Platform Admin and an API key get NOT_FOUND for the list, an item and Show", async () => {
    const added = await svc().add(sa(ids.mj), item, META);
    assert.deepEqual(await svc().list(sa(ids.other)), [], "another Super Admin sees only their own (empty) vault");
    await assert.rejects(() => svc().reveal(sa(ids.other), added.id, META), notFound);
    await assert.rejects(() => svc().change(sa(ids.other), added.id, { kind: "password", title: "x" }, META), notFound);
    await assert.rejects(() => svc().remove(sa(ids.other), added.id, META), notFound);
    await assert.rejects(() => svc().list(pa()), notFound);
    await assert.rejects(() => svc().reveal(pa(), added.id, META), notFound);
    await assert.rejects(() => svc().add(pa(), item, META), notFound);
    const token = { ...sa(ids.mj), token: { id: "t1", name: "Robot" } } as unknown as ReturnType<typeof sa>;
    await assert.rejects(() => svc().list(token), notFound);
    await assert.rejects(() => svc().reveal(token, added.id, META), notFound);
    assert.ok(!lines.some((l) => l.includes(SECRET)));
  });

  test("a sealed value moved to another owner does not open; a change that leaves the secret out keeps it; removed leaves the list", async () => {
    const added = await svc().add(sa(ids.mj), item, META);
    await svc().add(sa(ids.other), { ...item, title: "Other's mail" }, META);
    await svc().change(sa(ids.mj), added.id, { kind: "password", title: "Gmail (personal)" }, META);
    assert.equal((await svc().reveal(sa(ids.mj), added.id, META)).secret, SECRET);
    const row = ports.rows.get(added.id);
    assert.ok(row);
    ports.rows.set(added.id, { ...row, ownerId: ids.other });
    await assert.rejects(() => svc().reveal(sa(ids.other), added.id, META), (e: { code?: string }) => e.code === "CONFLICT");
    ports.rows.set(added.id, row);
    await svc().remove(sa(ids.mj), added.id, META);
    assert.deepEqual(await svc().list(sa(ids.mj)), []);
  });

  test("a bad input names its field", async () => {
    const bad = await svc().add(sa(ids.mj), { ...item, title: "  ", expiresOn: "31-12-2026" }, META).then(() => null, (e: { details?: { fields?: Record<string, string> } }) => e.details?.fields ?? null);
    assert.deepEqual(Object.keys(bad ?? {}).sort(), ["expiresOn", "title"]);
  });
});
