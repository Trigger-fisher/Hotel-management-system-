// The website's demo requests (platform 0169; MJ, 2 Nov 2026). What must hold: a request is saved trimmed and with the email in lower case; a filled honeypot is answered as success
// and nothing is saved; a bad input names its field; only the Super Admin lists and changes them (a Platform Admin or a hotel user cannot); a change is audited with the old and new status.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { memoryDemoRequestPorts } from "../../src/server/compose/demoRequests";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createDemoRequestService } from "../../src/server/services/platform/demoRequests";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-demo-1", ip: "10.0.0.9", userAgent: "node-test" };
const ids = { sa: randomUUID(), pa: randomUUID() };
const form = { name: "  Asha  Rao ", email: "Asha@Hotel.IN", phone: "+91 98765 43210", hotelName: "Hotel Lakeview", city: "Udaipur", rooms: 24, properties: 1, message: "We use registers today." };

describe("demo requests from the website", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  let ports: ReturnType<typeof memoryDemoRequestPorts>;
  const svc = () => createDemoRequestService({ unit: cons.unit, now: () => new Date("2026-11-02T10:00:00+05:30"), ports });
  const sa = () => makeSession({ userId: ids.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
  const pa = () => makeSession({ userId: ids.pa, hotelId: "", accountRole: "platform_admin", roleKey: "super_admin", roleLevel: 4 });
  const hotelUser = () => makeSession({ userId: randomUUID(), hotelId: randomUUID(), accountRole: "hotel_user", roleKey: "admin", roleLevel: 3 });

  beforeEach(() => {
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    ports = memoryDemoRequestPorts();
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    for (const [id, name, role] of [[ids.sa, "sa", "super_admin"], [ids.pa, "pa", "platform_admin"]] as const) {
      auth.data().users.push({ id, username: name, email: `${name}@demo.hms`, mobile: null, displayName: name.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
    }
  });

  test("a request is saved trimmed, with the email in lower case, and listed as new", async () => {
    assert.deepEqual(await svc().submit(form), { received: true });
    const page = await svc().list(sa(), { status: "new" });
    assert.equal(page.total, 1);
    assert.deepEqual([page.items[0]?.name, page.items[0]?.email, page.items[0]?.hotelName, page.items[0]?.rooms, page.items[0]?.status], ["Asha Rao", "asha@hotel.in", "Hotel Lakeview", 24, "new"]);
    assert.deepEqual(page.counts, { new: 1, contacted: 0, closed: 0 });
  });

  test("a filled honeypot is answered as success and nothing is saved", async () => {
    assert.deepEqual(await svc().submit({ ...form, website: "http://spam.example" }), { received: true });
    assert.equal(ports.rows.length, 0);
  });

  test("a bad input names its field", async () => {
    const field = async (input: Parameters<ReturnType<typeof svc>["submit"]>[0]) => {
      try {
        await svc().submit(input);
        return null;
      } catch (e) {
        return Object.keys((e as { details?: { fields?: Record<string, string> } }).details?.fields ?? {});
      }
    };
    assert.deepEqual(await field({ ...form, email: "not-an-email" }), ["email"]);
    assert.deepEqual(await field({ ...form, hotelName: "  " }), ["hotelName"]);
    assert.deepEqual(await field({ ...form, rooms: 0 }), ["rooms"]);
    assert.deepEqual(await field({ ...form, phone: "call me" }), ["phone"]);
    assert.equal(ports.rows.length, 0);
  });

  test("only the Super Admin lists and changes them; a change is audited", async () => {
    await svc().submit(form);
    const id = ports.rows[0]!.id;
    await assert.rejects(() => svc().list(pa(), {}), (e: { code?: string }) => e.code === "FORBIDDEN");
    await assert.rejects(() => svc().list(hotelUser(), {}), (e: { code?: string }) => e.code === "FORBIDDEN");
    await assert.rejects(() => svc().setStatus(pa(), id, "contacted", META), (e: { code?: string }) => e.code === "FORBIDDEN");
    assert.equal(ports.rows[0]?.status, "new");

    const changed = await svc().setStatus(sa(), id, "contacted", META);
    assert.deepEqual([changed.status, changed.handledByName], ["contacted", "SA"]);
    const last = cons.data.audit.at(-1);
    assert.deepEqual([last?.action, last?.targetLabel, last?.reason, last?.before, last?.after], ["demo_request_updated", "Hotel Lakeview", "contacted", { status: "new" }, { status: "contacted" }]);
    await assert.rejects(() => svc().setStatus(sa(), randomUUID(), "closed", META), (e: { code?: string }) => e.code === "NOT_FOUND");
  });
});
