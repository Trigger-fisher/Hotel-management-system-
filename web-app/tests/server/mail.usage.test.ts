// Mail usage by month and the Super Admin's daily cap per hotel (MAIL-PROVIDERS-50K, 18 Oct 2026): the worker counts each sent mail per owner per UTC day; the report sums a month per hotel,
// the cap is set by the Super Admin only (audited), validated, and the worker honours it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createMailUsageService } from "../../src/server/services/platform/mailUsageService";
import { queueMail, runOutboxPass, type MailMessage } from "../../src/server/services/auth/mail";
import { makeSession } from "./helpers/session";

const META = { traceId: "trace-usage-1", ip: "10.0.0.5", userAgent: "node-test" };
const NOW = new Date("2026-10-18T10:00:00Z");
const ids = { sa: randomUUID(), pa: randomUUID() };
let auth: ReturnType<typeof createMemoryAuth>;
let cons: ReturnType<typeof createMemoryPlatformConsole>;
let hotelA: string;
let hotelB: string;

const service = () => createMailUsageService({ unit: cons.unit, credentials: () => ({}) as never, now: () => NOW });
const session = (who: "sa" | "pa") => makeSession({ userId: ids[who], hotelId: "", accountRole: who === "sa" ? "super_admin" : "platform_admin", roleKey: "super_admin", roleLevel: 4 });
const failed = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; details?: { fields?: Record<string, string> } });

beforeEach(() => {
  auth = createMemoryAuth();
  cons = createMemoryPlatformConsole(auth);
  const roleId = randomUUID();
  auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
  for (const [who, role] of [["sa", "super_admin"], ["pa", "platform_admin"]] as const) {
    auth.data().users.push({ id: ids[who], username: who, email: `${who}@demo.hms`, mobile: null, displayName: who.toUpperCase(), passwordHash: "x", accountRole: role, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId } as never);
  }
  // two live hotels in the memory console (the same shape the platform tests use)
  for (const [id, name, slug] of [[randomUUID(), "Hotel Sunrise", "hotel-sunrise"], [randomUUID(), "Gir Forest Lodge", "gir-forest-lodge"]] as const) {
    auth.data().hotels.push({ id, name, status: "active" } as never);
    cons.data.hotels.set(id, { slug, city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: new Date("2026-06-01T10:00:00+05:30"), provisionedAt: new Date("2026-06-01T10:00:00+05:30"), submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as never);
  }
});

async function hotels(): Promise<string[]> {
  const rows = await cons.unit.run(async (repos) => repos.hotels.list({ words: [] }, NOW));
  return rows.map((h) => h.id);
}

describe("usage by month", () => {
  test("sums the days of the month per hotel and the platform's own mail; other months are not counted; every listed hotel appears; most mails first", async () => {
    const [a, b] = await hotels();
    assert.ok(a && b, "the memory console has hotels");
    hotelA = a;
    hotelB = b;
    auth.data().sendCounts.push(
      { scope: hotelA, day: "2026-10-01", sent: 100 }, { scope: hotelA, day: "2026-10-17", sent: 50 }, { scope: hotelA, day: "2026-09-30", sent: 999 },
      { scope: hotelB, day: "2026-10-18", sent: 7 }, { scope: "platform", day: "2026-10-05", sent: 30 },
    );
    const r = await service().report(session("sa"), "2026-10");
    assert.deepEqual([r.month, r.days, r.platformSent, r.totalSent], ["2026-10", 31, 30, 187]);
    const by = Object.fromEntries(r.hotels.map((h) => [h.hotelId, h]));
    assert.deepEqual([by[hotelA].sentThisMonth, by[hotelA].sentToday, by[hotelB].sentThisMonth, by[hotelB].sentToday], [150, 0, 7, 7]);
    assert.equal(r.hotels[0].hotelId, hotelA, "most mails first");
    assert.ok(r.hotels.length >= 2 && r.hotels.every((h) => h.dailyCap === null));
    const sept = await service().report(session("sa"), "2026-09");
    assert.deepEqual([sept.days, sept.hotels.find((h) => h.hotelId === hotelA)?.sentThisMonth], [30, 999]);
  });

  test("the month defaults to the current one; a bad month is a 422; only the Super Admin can read it", async () => {
    assert.equal((await service().report(session("sa"))).month, "2026-10");
    assert.deepEqual(Object.keys((await failed(service().report(session("sa"), "2026-13")))?.details?.fields ?? {}), ["month"]);
    assert.equal((await failed(service().report(session("pa"))))?.code, "FORBIDDEN");
  });
});

describe("the daily cap", () => {
  test("set, shown in the report, audited with before and after, removed with null; 0 is allowed; a bad number is a 422; a hotel that is not there is a 404", async () => {
    const [a] = await hotels();
    const svc = service();
    assert.deepEqual(await svc.setCap(session("sa"), a, 500, META), { hotelId: a, dailyCap: 500 });
    assert.equal((await svc.report(session("sa"))).hotels.find((h) => h.hotelId === a)?.dailyCap, 500);
    await svc.setCap(session("sa"), a, 0, META);
    assert.equal(auth.data().mailCaps.find((c) => c.hotelId === a)?.cap, 0);
    await svc.setCap(session("sa"), a, null, META);
    assert.equal(auth.data().mailCaps.length, 0);
    const audit = cons.data.audit.filter((x) => x.action === "settings_updated");
    assert.equal(audit.length, 3);
    assert.match(String(audit[0].reason), /500 a day/);
    assert.deepEqual(Object.keys((await failed(svc.setCap(session("sa"), a, -1, META)))?.details?.fields ?? {}), ["dailyCap"]);
    assert.deepEqual(Object.keys((await failed(svc.setCap(session("sa"), a, 1.5, META)))?.details?.fields ?? {}), ["dailyCap"]);
    assert.equal((await failed(svc.setCap(session("sa"), randomUUID(), 10, META)))?.code, "NOT_FOUND");
  });

  test("a Platform Admin cannot set it (refused and audited as a failed attempt)", async () => {
    const [a] = await hotels();
    assert.equal((await failed(service().setCap(session("pa"), a, 5, META)))?.code, "FORBIDDEN");
    assert.equal(auth.data().mailCaps.length, 0);
  });

  test("the worker honours it: a cap of 2 sends 2 campaign mails and the usage report shows them", async () => {
    const [a] = await hotels();
    await service().setCap(session("sa"), a, 2, META);
    for (let i = 0; i < 5; i += 1) await auth.unit.run((r) => queueMail(r, { userId: null, kind: "campaign", toEmail: `g${i}@x.in`, payload: { name: "G", subject: "S", text: "t" }, hotelId: a }, NOW));
    const sent: MailMessage[] = [];
    const pass = await runOutboxPass({ unit: auth.unit, sender: { send: async (m) => void sent.push(m) }, now: () => NOW, policy: { limitsOf: async () => ({ perSecond: 0, perDay: 0 }) } });
    assert.equal(pass.sent, 2);
    const r = await service().report(session("sa"));
    assert.deepEqual([r.hotels.find((h) => h.hotelId === a)?.sentToday, r.hotels.find((h) => h.hotelId === a)?.sentThisMonth, r.hotels.find((h) => h.hotelId === a)?.dailyCap], [2, 2, 2]);
  });
});
