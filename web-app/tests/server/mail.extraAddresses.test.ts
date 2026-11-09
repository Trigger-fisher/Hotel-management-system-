// Extra email addresses (MJ, 5 Nov 2026, rule 4): the Super Admin gives any staff login extra addresses made from a pattern and checked to be free, and removes them; the automatic
// <username>@<domain> stays and cannot be removed; delivery finds the owner; a Platform Admin is refused.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createMailAddressService, createMemoryExtraAddressStore } from "../../src/server/services/platform/mailAddressService";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-addr-1", ip: "10.0.0.5", userAgent: "node-test" };
const DOMAIN = "mail.easyhotel.in";
const ids = { sa: randomUUID(), pa: randomUUID(), desk: randomUUID() };
const as = (who: "sa" | "pa") => makeSession({ userId: ids[who], hotelId: "", accountRole: who === "sa" ? "super_admin" : "platform_admin" });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
let service: ReturnType<typeof createMailAddressService>;
let store: ReturnType<typeof createMemoryExtraAddressStore>;
let cons: ReturnType<typeof createMemoryPlatformConsole>;

beforeEach(() => {
  const auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  const users: [keyof typeof ids, string, string][] = [["sa", "super_admin", "Sonal Shah"], ["pa", "platform_admin", "Neha Rao"], ["desk", "hotel_user", "Ravi Patel"]];
  for (const [who, role, name] of users) {
    auth.data().users.push({ id: ids[who], username: who === "desk" ? "ravi" : who, email: null, mobile: null, displayName: name, passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  }
  store = createMemoryExtraAddressStore();
  service = createMailAddressService({
    unit: cons.unit,
    now: () => new Date("2026-11-05T10:00:00Z"),
    store,
    domain: async () => DOMAIN,
    taken: async () => new Set([`sunrise@${DOMAIN}`]),
    isUsername: async (local) => ["sa", "pa", "ravi", "ravi.1"].includes(local),
  });
});

describe("extra email addresses", () => {
  test("a pattern gives a free address (a number added when taken); the automatic one stays; remove takes only an extra one", async () => {
    const first = await service.add(as("sa"), ids.desk, { pattern: "name_number" }, META);
    assert.equal(first.added, `ravi.2@${DOMAIN}`, "ravi.1 is a username, so the next number");
    assert.equal(first.auto.address, `ravi@${DOMAIN}`);
    const own = await service.add(as("sa"), ids.desk, { pattern: "custom", word: "frontdesk.sunrise" }, META);
    assert.equal(own.added, `frontdesk.sunrise@${DOMAIN}`);
    assert.equal(own.extras.length, 2);
    assert.equal((await service.preview(as("sa"), ids.desk, { pattern: "name_number" })).address, `ravi.3@${DOMAIN}`, "the preview checks what is free now");
    for (const word of ["sunrise", "postmaster", "ravi", "frontdesk.sunrise", "x"]) assert.notEqual(await code(service.add(as("sa"), ids.desk, { pattern: "custom", word }, META)), "ok", word);
    assert.equal(await code(service.add(as("sa"), ids.desk, { pattern: "org_word", word: "accounts" }, META)), "VALIDATION_FAILED", "no hotel or group to name it after");
    assert.deepEqual(await service.ownersOf(DOMAIN, ["ravi.2"]), [ids.desk], "delivery finds the owner");
    assert.deepEqual(await service.extrasOf(ids.desk), [`ravi.2@${DOMAIN}`, `frontdesk.sunrise@${DOMAIN}`]);
    const after = await service.remove(as("sa"), ids.desk, own.extras[0].id, META);
    assert.deepEqual(after.extras.map((x) => x.address), [`frontdesk.sunrise@${DOMAIN}`]);
    assert.equal(await code(service.remove(as("sa"), ids.desk, randomUUID(), META)), "NOT_FOUND");
    assert.ok(cons.data.audit.some((a) => a.reason === "mail_address:added" && a.result === "success"));
  });

  test("only the Super Admin: a Platform Admin is refused (audited), an API key too", async () => {
    assert.equal(await code(service.list(as("pa"), ids.desk)), "FORBIDDEN");
    assert.equal(await code(service.add(as("pa"), ids.desk, { pattern: "name_number" }, META)), "FORBIDDEN");
    assert.ok(cons.data.audit.some((a) => a.result === "failed" && a.actorRole === "platform_admin"));
    const keyed = { ...as("sa"), client: "token" as const, token: { id: "k", name: "Key", level: "full" as const, scope: "platform" as const, testMode: false, callsPerMinute: 60, ip: null, newIp: false } };
    assert.equal(await code(service.list(keyed, ids.desk)), "FORBIDDEN");
    assert.equal(store.rows.length, 0);
  });
});
