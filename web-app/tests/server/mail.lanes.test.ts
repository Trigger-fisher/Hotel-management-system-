// Mail lanes, daily caps, pacing and the 50,000-mail load test (MAIL-PROVIDERS-50K plan, 18 Oct 2026): the system lane (codes, resets, invoices, ...) is always served before campaign mail; each hotel's
// campaign mail goes out within what its mail service, its own daily limit and the Super Admin's cap allow today, paced to the service's mails a second; one hotel never blocks another.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BULK_KINDS, laneOf, MAIL_KINDS, MAIL_LANE, MAIL_ROUTE } from "../../src/server/mail/routes";
import type { PlatformUnit } from "../../src/server/repos/auth";
import { createMemoryAuth, memoryAuthRepos } from "../../src/server/repos/memory/auth";
import { queueMail, runOutboxPass, utcDay, type BulkLimits, type BulkPolicy, type MailMessage, type MailSender } from "../../src/server/services/auth/mail";

const HOTEL_A = "11111111-1111-4111-8111-111111111111";
const HOTEL_B = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-10-18T10:00:00Z");

function world(limits: Record<string, BulkLimits> = {}, options: { sleeps?: number[] } = {}) {
  // a unit WITHOUT the memory store's snapshot per call (it copies the whole data set each time, which a 50,000-row queue cannot afford): the repos are the same
  const store = createMemoryAuth();
  const unit: PlatformUnit = { run: (work) => work(memoryAuthRepos(store.data())), read: (work) => work(memoryAuthRepos(store.data())) };
  const auth = { unit, data: store.data };
  const sent: MailMessage[] = [];
  const sender: MailSender = { send: async (m) => void sent.push(m) };
  const policy: BulkPolicy = {
    limitsOf: async (hotelId) => {
      const l = limits[hotelId];
      if (!l) throw new Error("settings cannot be read");
      return l;
    },
    sleep: async (ms) => void options.sleeps?.push(ms),
  };
  let clock = T0;
  const pass = (batch = 50) => runOutboxPass({ unit: auth.unit, sender, now: () => clock, policy, batch });
  const campaign = async (hotelId: string, n: number, at = clock) => {
    for (let i = 0; i < n; i += 1) await auth.unit.run((r) => queueMail(r, { userId: null, kind: "campaign", toEmail: `g${i}@x.in`, payload: { name: "Guest", subject: `S${i}`, text: "t" }, hotelId }, at));
  };
  const code = (to = "staff@x.in") => auth.unit.run((r) => queueMail(r, { userId: null, kind: "login_code", toEmail: to, payload: { name: "S", code: "123456", minutes: 10 }, hotelId: null }, clock));
  return { auth, sent, pass, campaign, code, setClock: (d: Date) => (clock = d), counts: () => auth.data().sendCounts };
}

describe("the lane of every kind", () => {
  test("every kind has a lane; only campaign is bulk; every other kind is system, so no system kind can be forgotten", () => {
    assert.deepEqual(MAIL_KINDS.filter((k) => !(k in MAIL_LANE)), []);
    assert.deepEqual(BULK_KINDS, ["campaign"]);
    for (const k of MAIL_KINDS) assert.equal(laneOf(k), k === "campaign" ? "bulk" : "system", k);
    assert.deepEqual(Object.keys(MAIL_LANE).sort(), Object.keys(MAIL_ROUTE).sort());
  });

  test("the SQL names the bulk kind literally, the same way as the partial indexes of migration 0126", () => {
    const repo = readFileSync(path.join(process.cwd(), "src", "server", "repos", "postgres", "auth.ts"), "utf8");
    const mig = readFileSync(path.join(process.cwd(), "..", "common", "db", "migrations", "platform", "0126_mail_lanes_usage.sql"), "utf8");
    assert.ok(repo.includes(`"kind = 'campaign'" : "kind <> 'campaign'"`));
    assert.ok(mig.includes("WHERE status = 'pending' AND kind <> 'campaign'") && mig.includes("WHERE status = 'pending' AND kind = 'campaign'"));
  });
});

describe("the system lane first", () => {
  test("a sign-in code queued BEHIND 200 campaign mails is sent in the very first pass, even with a pass of 5", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 0 } });
    await w.campaign(HOTEL_A, 200);
    await w.code();
    const p = await w.pass(5);
    assert.equal(p.claimed, 5);
    assert.equal(w.sent[0].subject, "Your Easy Hotel Solutions sign-in code", "the code is first");
    assert.equal(w.sent.filter((m) => m.hotelId === HOTEL_A).length, 4, "the rest of the pass is campaign mail");
  });

  test("campaign mail uses what the system lane leaves; with no campaign hotel the pass is only system mail", async () => {
    const w = world();
    await w.code("a@x.in");
    await w.code("b@x.in");
    assert.deepEqual(await w.pass(), { claimed: 2, sent: 2, more: false });
  });

  test("a capped hotel takes no share: the whole batch goes to the hotels that may send, and the pass says more is waiting (MAIL-LOAD-REPORT F1)", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 0 }, [HOTEL_B]: { perSecond: 0, perDay: 0 } });
    await w.campaign(HOTEL_A, 30);
    await w.campaign(HOTEL_B, 100);
    // hotel A has used its Super Admin cap for today
    w.auth.data().mailCaps.push({ hotelId: HOTEL_A, cap: 10 });
    w.counts().push({ scope: HOTEL_A, day: utcDay(T0), sent: 10 });
    const p = await w.pass(50);
    assert.deepEqual(p, { claimed: 50, sent: 50, more: true });
    assert.equal(w.sent.filter((m) => m.hotelId === HOTEL_B).length, 50, "the capped hotel's share went to B");
    // B's last 50: a full share again, so `more` stays true until a pass finds nothing for it
    assert.equal((await w.pass(50)).claimed, 50);
    assert.deepEqual(await w.pass(50), { claimed: 0, sent: 0, more: false });
    assert.equal(w.sent.filter((m) => m.hotelId === HOTEL_A).length, 0, "A waits for tomorrow");
  });
});

describe("daily caps", () => {
  test("the service's day figure: 3 a day means 3 today, none more today, 3 again tomorrow; the rest stays queued", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 3 } });
    await w.campaign(HOTEL_A, 10);
    assert.equal((await w.pass()).sent, 3);
    assert.equal((await w.pass()).sent, 0, "today's allowance is used");
    assert.deepEqual(w.counts(), [{ scope: HOTEL_A, day: utcDay(T0), sent: 3 }]);
    w.setClock(new Date("2026-10-19T04:00:00Z"));
    assert.equal((await w.pass()).sent, 3, "tomorrow");
    assert.equal(w.auth.data().outbox.filter((o) => o.status === "pending").length, 4);
  });

  test("the Super Admin's cap lowers the figure and never raises it; a cap of 0 stops the hotel's campaigns", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 5 }, [HOTEL_B]: { perSecond: 0, perDay: 0 } });
    w.auth.data().mailCaps.push({ hotelId: HOTEL_A, cap: 2 }, { hotelId: HOTEL_B, cap: 0 });
    await w.campaign(HOTEL_A, 10);
    await w.campaign(HOTEL_B, 10);
    await w.pass();
    assert.deepEqual([w.sent.filter((m) => m.hotelId === HOTEL_A).length, w.sent.filter((m) => m.hotelId === HOTEL_B).length], [2, 0]);
    w.auth.data().mailCaps.length = 0;
    w.auth.data().mailCaps.push({ hotelId: HOTEL_A, cap: 99 });
    await w.pass();
    assert.equal(w.sent.filter((m) => m.hotelId === HOTEL_A).length, 2 + 3, "a cap above the service's own changes nothing: 5 a day in all");
  });

  test("system mail is counted but never held back by a cap", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 1 } });
    w.auth.data().mailCaps.push({ hotelId: HOTEL_A, cap: 0 });
    await w.auth.unit.run((r) => queueMail(r, { userId: null, kind: "enquiry_new", toEmail: "o@x.in", payload: { name: "O" }, hotelId: HOTEL_A }, T0));
    await w.code();
    assert.equal((await w.pass()).sent, 2);
    assert.deepEqual(w.counts().map((c) => [c.scope, c.sent]).sort(), [[HOTEL_A, 1], ["platform", 1]]);
  });
});

describe("hotels share a pass fairly and do not block each other", () => {
  test("a hotel that has used its day does not stop another's campaign; a hotel whose settings cannot be read is skipped, its mail stays queued", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 1 } });
    await w.campaign(HOTEL_A, 5);
    await w.campaign(HOTEL_B, 5);
    await w.pass();
    assert.deepEqual([w.sent.filter((m) => m.hotelId === HOTEL_A).length, w.sent.filter((m) => m.hotelId === HOTEL_B).length], [1, 0], "B's settings cannot be read: skipped");
    const w2 = world({ [HOTEL_A]: { perSecond: 0, perDay: 1 }, [HOTEL_B]: { perSecond: 0, perDay: 0 } });
    await w2.campaign(HOTEL_A, 5);
    await w2.campaign(HOTEL_B, 5);
    await w2.pass();
    await w2.pass();
    assert.deepEqual([w2.sent.filter((m) => m.hotelId === HOTEL_A).length, w2.sent.filter((m) => m.hotelId === HOTEL_B).length], [1, 5]);
  });

  test("a pass is shared between the hotels that have mail waiting", async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 0 }, [HOTEL_B]: { perSecond: 0, perDay: 0 } });
    await w.campaign(HOTEL_A, 100);
    await w.campaign(HOTEL_B, 100);
    await w.pass(10);
    assert.deepEqual([w.sent.filter((m) => m.hotelId === HOTEL_A).length, w.sent.filter((m) => m.hotelId === HOTEL_B).length], [5, 5]);
  });
});

describe("pacing to the service's mails a second", () => {
  test("2 a second means about half a second between a hotel's campaign mails; system mail is not paced", async () => {
    const sleeps: number[] = [];
    const w = world({ [HOTEL_A]: { perSecond: 2, perDay: 0 } }, { sleeps });
    await w.campaign(HOTEL_A, 4);
    await w.code();
    await w.pass();
    assert.equal(w.sent.length, 5);
    // the first campaign mail goes at once; each next one is due half a second after the previous (the fake sleep does not move the clock, so the waits add up)
    assert.equal(sleeps.length, 3, `waits: ${sleeps.join(", ")}`);
    sleeps.forEach((ms, i) => assert.ok(Math.abs(ms - 500 * (i + 1)) <= 40, `wait ${i + 1} is ${ms} ms`));
  });
});

describe("the load test: 50,000 campaign mails queued, a fake provider", () => {
  test("a login code queued behind 50,000 campaign rows is sent in the first pass; the whole campaign then drains; the figures are reported", { timeout: 300_000 }, async () => {
    const w = world({ [HOTEL_A]: { perSecond: 0, perDay: 0 } });
    const N = 50_000;
    const rows = w.auth.data().outbox;
    const base = Date.parse("2026-10-18T09:00:00Z");
    for (let i = 0; i < N; i += 1) {
      rows.push({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, userId: null, hotelId: HOTEL_A, kind: "campaign", toEmail: `guest${i}@example.com`, template: "campaign-1", payload: JSON.stringify({ name: "Guest", subject: "Diwali offer", text: "Hello", unsubscribeUrl: "https://hms.test/u" }), status: "pending", attempts: 0, nextAttemptAt: new Date(base + i), sentAt: null, createdAt: new Date(base + i), lastError: null });
    }
    await w.code();
    const startedAt = Date.now();
    const first = await w.pass();
    const codeDelayMs = Date.now() - startedAt;
    assert.equal(w.sent[0].subject, "Your Easy Hotel Solutions sign-in code");
    assert.equal(first.claimed, 50);
    let passes = 1;
    while ((await w.pass()).claimed > 0) passes += 1;
    const totalMs = Date.now() - startedAt;
    assert.equal(w.sent.length, N + 1);
    assert.equal(w.auth.data().outbox.filter((o) => o.status === "sent").length, N + 1);
    assert.equal(w.counts().reduce((a, c) => a + c.sent, 0), N + 1);
    console.info(`[load] ${N} campaign mails + 1 code: code sent after ${codeDelayMs} ms (first pass), ${passes} passes, ${totalMs} ms in all, ${Math.round(((N + 1) / totalMs) * 1000)} mails/second sustained by the worker logic (fake provider)`);
  });
});
