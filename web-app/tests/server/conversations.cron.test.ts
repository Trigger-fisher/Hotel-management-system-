// Conversations' daily safety net (decision 66, A8): the cron route checks CRON_SECRET; the 12-month purge runs FIRST for every provisioned hotel (reading off, or no
// registry row at all: C5 holds for all) and once a day for the platform's hub; then the mailboxes not checked for 6 hours, four at a time, each only while enough time is
// left; a pass that runs out of time says `more` and the rest continues in a new call.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GET as cronRoute } from "../../src/app/api/v1/cron/conversations/route";
import { configureCron, continueConversations, CONVERSATIONS_MAX_HOPS } from "../../src/server/compose/cron";
import { runConversationsPass, type CronPorts } from "../../src/server/compose/conversations";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryPlatformConversations } from "../../src/server/repos/memory/conversations";
import { createCronService, type CronConversationsRun } from "../../src/server/services/cron/cronService";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const NOW = new Date("2026-10-24T01:00:00Z");
const outcome = { checked: true, added: 0, error: null, newInbound: [], mailbox: { config: null, reason: null, reading: true, provider: null }, positions: [] };

function registryWith(hotels: { id: string; on?: boolean; row?: boolean }[]) {
  const platform = createMemoryPlatformConversations();
  const data = platform.data();
  for (const h of hotels) {
    data.hotels.push({ id: h.id, name: h.id, provisioned: true });
    if (h.row !== false) data.accounts.push({ id: `acc-${h.id}`, hotelId: h.id, channel: "email", status: h.on ? "on" : "off", imapHost: null, imapPort: null, lastCheckedAt: null, lastOkAt: null, lastPurgedAt: null, lastError: null });
  }
  return { data, registry: { run: <T>(work: (r: Parameters<Parameters<CronPorts["registry"]["run"]>[0]>[0]) => Promise<T>) => platform.unit.run((repos) => work(repos.accounts)) } };
}

describe("the cron route", () => {
  test("no secret configured: 404; a missing or wrong bearer: 401; the right one runs the pass", async () => {
    configureRoutes({ resolveSession: async () => null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
    const run: CronConversationsRun = { hotels: 2, checked: 2, added: 5, purged: 1, failed: 0 };
    const base = { drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => ({ hotels: 0, queued: 0, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }), conversations: async () => run };
    const call = (auth?: string) => cronRoute(new Request("https://hms.test/api/v1/cron/conversations", { headers: auth ? { authorization: auth } : {} }));
    configureCron(createCronService({ ...base, secret: () => undefined }));
    assert.equal((await call("Bearer x")).status, 404);
    configureCron(createCronService({ ...base, secret: () => "cron-secret-1" }));
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer nope")).status, 401);
    const ok = await call("Bearer cron-secret-1");
    assert.deepEqual([ok.status, (await ok.json()).data], [200, run]);
    configureCron(null);
  });
});

describe("the pass", () => {
  test("the purge runs for a hotel reading nothing and for one with no registry row: 13-month-old messages go, newer ones stay; the platform hub once a day", async () => {
    const w = hotelWorld();
    const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    w.imap.deliver("inbox", guestMail({ from: "old@guest.in", date: new Date("2025-09-01T08:00:00Z") }), new Date("2025-09-01T08:00:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "new@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    // the first window is 14 days: the old message is put straight in, as if it had been read a year ago
    await w.hotel.unit.run(admin, (r) => r.conversations.ingest([{ channel: "email", direction: "in", externalId: "<old@guest.in>", sentAt: new Date("2025-09-01T08:00:00Z"), person: "old@guest.in", personName: null, from: "old@guest.in", replyTo: null, to: [], cc: [], subject: "old", preview: "", hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received" }], { mailbox: null }, r.matcher, NOW));
    await w.service.sync(admin, {});
    for (const h of [HOTEL_A, HOTEL_B]) await w.hotel.unit.run({ ...admin, hotelId: h }, (r) => r.conversations.ingest([{ channel: "email", direction: "in", externalId: `<old-${h}@guest.in>`, sentAt: new Date("2025-09-15T08:00:00Z"), person: "older@guest.in", personName: null, from: "older@guest.in", replyTo: null, to: [], cc: [], subject: "old", preview: "", hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received" }], { mailbox: null }, r.matcher, NOW));
    const reg = registryWith([{ id: HOTEL_A, on: false }, { id: HOTEL_B, row: false }]);
    let platformPurges = 0;
    // nothing is deleted unless the purge is switched on (MJ, 2 Nov 2026: emails are kept)
    const off: CronPorts = { registry: reg.registry, hotel: w.service, platform: { syncForWorker: async () => outcome, purgeForWorker: async () => ((platformPurges += 1), 0) }, now: () => new Date("2026-10-24T10:30:00Z") };
    const kept = await runConversationsPass(off, { budgetMs: 40_000 });
    assert.equal(kept.purged, 0);
    assert.equal(w.data(HOTEL_A).convMessages.length, 3, "the 13-month-old messages stay");
    assert.equal(w.data(HOTEL_B).convMessages.length, 1);
    assert.equal(platformPurges, 0, "the platform hub is not purged either");
    // switched on (a Super Admin action later): 13-month-old messages go, newer ones stay
    const ports: CronPorts = { ...off, autoPurge: true };
    const run = await runConversationsPass(ports, { budgetMs: 40_000 });
    assert.equal(run.purged, 3);
    assert.deepEqual(w.data(HOTEL_A).convMessages.map((m) => m.fromAddr), ["new@guest.in"]);
    assert.equal(w.data(HOTEL_B).convMessages.length, 0);
    assert.ok(reg.data.accounts.find((a) => a.hotelId === HOTEL_B)?.lastPurgedAt, "a row is made for a hotel that had none (status off)");
    assert.equal(reg.data.accounts.find((a) => a.hotelId === HOTEL_B)?.status, "off");
    await runConversationsPass(ports, { budgetMs: 40_000 });
    assert.equal(platformPurges, 1, "the platform hub once a day");
    assert.equal(run.hotels, 0, "reading is off everywhere: no mail check");
  });

  test("the mail checks: four at a time, every due hotel; with too little time left the pass stops and says more", async () => {
    const hotels = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000f00${i}`);
    const reg = registryWith(hotels.map((id) => ({ id, on: true })));
    let running = 0;
    let most = 0;
    const done: string[] = [];
    const hotel: CronPorts["hotel"] = {
      purgeForWorker: async () => 0,
      syncForWorker: async (hotelId) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 15));
        running -= 1;
        done.push(hotelId);
        return outcome;
      },
    };
    const ports: CronPorts = { registry: reg.registry, hotel, platform: { syncForWorker: async () => outcome, purgeForWorker: async () => 0 }, now: () => NOW };
    const run = await runConversationsPass(ports, { budgetMs: 40_000 });
    assert.deepEqual([run.hotels, run.checked, most, done.length, run.more], [6, 6, 4, 6, undefined]);
    const short = await runConversationsPass(ports, { budgetMs: 20_000 });
    assert.deepEqual([short.hotels, short.more], [0, true]);
  });

  test("a hotel that cannot be checked (throws, or answers not checked) is still marked as tried, so the next pass moves on to other hotels instead of looping on the same ones", async () => {
    const hotels = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-0000000f${String(i).padStart(4, "0")}`);
    const reg = registryWith(hotels.map((id) => ({ id, on: true })));
    const seen = new Set<string>();
    const hotel: CronPorts["hotel"] = {
      purgeForWorker: async () => 0,
      syncForWorker: async (hotelId) => {
        seen.add(hotelId);
        if (hotels.indexOf(hotelId) % 2 === 0) throw new Error("not ready");
        return { ...outcome, checked: false };
      },
    };
    const ports: CronPorts = { registry: reg.registry, hotel, platform: { syncForWorker: async () => outcome, purgeForWorker: async () => 0 }, now: () => NOW };
    const first = await runConversationsPass(ports, { budgetMs: 40_000 });
    assert.deepEqual([first.hotels, first.more], [25, true]);
    const second = await runConversationsPass(ports, { budgetMs: 40_000 });
    assert.deepEqual([second.hotels, second.more], [5, undefined], "only the 5 not yet tried");
    assert.equal(seen.size, 30);
    assert.ok(reg.data.accounts.filter((a) => a.hotelId !== null).every((a) => a.lastCheckedAt !== null && a.lastError !== null));
  });

  test("continue: the chain of calls stops after the hop limit", async () => {
    let calls = 0;
    configureCron(createCronService({ secret: () => "s", drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => ({ hotels: 0, queued: 0, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }), conversations: async () => ((calls += 1), { hotels: 1, checked: 0, added: 0, purged: 0, failed: 1, more: true as const }) }));
    await continueConversations(CONVERSATIONS_MAX_HOPS - 1);
    assert.equal(calls, 0);
    await continueConversations();
    assert.equal(calls, 20, "in-process: at most 20 passes");
    configureCron(null);
  });

  test("continue: the rest runs in further passes until nothing is left (in-process off Vercel)", async () => {
    let calls = 0;
    configureCron(createCronService({ secret: () => "s", drainMail: async () => ({ sent: 0, failed: 0, remaining: 0 }), dailySummary: async () => ({ hotels: 0, queued: 0, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }), conversations: async () => ((calls += 1), calls < 3 ? { hotels: 1, checked: 1, added: 0, purged: 0, failed: 0, more: true as const } : { hotels: 1, checked: 1, added: 0, purged: 0, failed: 0 }) }));
    await continueConversations();
    assert.equal(calls, 3);
    configureCron(null);
  });
});
