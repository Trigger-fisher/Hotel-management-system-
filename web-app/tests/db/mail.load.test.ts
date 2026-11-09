// The 50,000-mail load test (MAIL-PROVIDERS-50K plan, step H3) on the REAL PostgreSQL instance (hms_test), with a fake mail provider. OPT-IN: it runs only with
// HMS_MAIL_LOAD=1, so the normal `npm run test:db` stays fast (the file is skipped there).
//   $env:HMS_MAIL_LOAD = "1"; npx tsx --import ./src/server/lib/node-hooks/register.ts --test --test-timeout=900000 tests/db/mail.load.test.ts
// HMS_MAIL_LOAD_OUT=<file> also writes the measurements (JSON, with the EXPLAIN plans) to that file. Nothing is printed but counts, timings and plans (no address, no payload).
// What it does:
//  1. three hotels; 50,000 campaign rows put straight into platform.outbox (17,000 / 17,000 / 16,000) and 20,000 suppressions (500 hit hotel A's list, 200 only for hotel B);
//  2. EXPLAIN (ANALYZE, BUFFERS) of every query of a worker pass and of the feeder, with 50,000 rows waiting;
//  3. the worker drains them the way compose/mail.ts does (pass after pass while a full batch was claimed, the lanes on): hotel C has a Super Admin cap of 10,000 a day,
//     hotel B is put on hold after 5,000 of its mails went, and a sign-in code is queued every 250 ms while the campaign runs (its delay is measured);
//  4. hotel B is released and its rest is drained by TWO workers at once (no mail may go twice);
//  5. a 10,000-address campaign of hotel A goes through the feeder (hotel 0044) while 50,000 sent rows are in the outbox's history; the plans are taken again.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { newId } from "../../src/server/db/ids";
import type { PlatformUnit } from "../../src/server/repos/auth";
import type { CompaniesRepos } from "../../src/server/repos/companies";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { createPgCompaniesUnit } from "../../src/server/repos/postgres/companies";
import type { Unit } from "../../src/server/repos/types";
import { OUTBOX_BATCH, runOutboxPass, utcDay, type BulkPolicy, type MailMessage, type MailSender } from "../../src/server/services/auth/mail";
import { feedCampaigns, type FeedPorts } from "../../src/server/services/companies/campaignFeed";
import { templateOf } from "../../src/server/services/companies/marketingService";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

const ON = process.env.HMS_MAIL_LOAD === "1";
const DOMAIN = "mail-load.test";
const SPLIT = [17_000, 17_000, 16_000] as const;
const CAP_C = 10_000;
const HOLD_B_AT = 5_000;
const SUPPRESSED_A = 500;
const SUPPRESSED_B_ONLY = 200;
const OTHER_SUPPRESSIONS = 20_000;
const FEED_RECIPIENTS = 10_000;
const CODE_EVERY_MS = 250;
const USER = newId();
const superId = newId();
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";

const results: Record<string, unknown> = {};
const ms = (n: number): number => Math.round(n * 10) / 10;
/** Every address of THIS test got at most one mail (hms_test may hold other files' queued mail, several to one address: the drain sends those too). */
const onceEach = (got: Map<string, number>): boolean => [...got.entries()].every(([to, n]) => !to.endsWith(`@${DOMAIN}`) || n === 1);
const pct =(sorted: number[], p: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

/** The fake provider: answers at once (or after `latencyMs`), counts every address it got, and tells a listener. */
function fakeProvider() {
  const got = new Map<string, number>();
  const byHotel = new Map<string, number>();
  let latencyMs = 0;
  let listener: ((m: MailMessage) => void) | null = null;
  const sender: MailSender = {
    async send(m) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      got.set(m.to, (got.get(m.to) ?? 0) + 1);
      byHotel.set(m.hotelId ?? "platform", (byHotel.get(m.hotelId ?? "platform") ?? 0) + 1);
      listener?.(m);
    },
  };
  return { sender, got, byHotel, setLatency: (n: number) => (latencyMs = n), onSend: (f: ((m: MailMessage) => void) | null) => (listener = f) };
}

describe("50,000 campaign mails through the worker (opt-in: HMS_MAIL_LOAD=1)", { skip: !ON }, () => {
  let releaseTestLock: (() => Promise<void>) | undefined;
  let owner: DbClient;
  let pool: SharedPool;
  let database: Database;
  let platform: PlatformUnit;
  let companies: Unit<CompaniesRepos>;
  const hotels: CreatedHotel[] = [];
  const templates: string[] = [];
  const provider = fakeProvider();
  // no fixed limit from the "service" (the fake): the worker runs as fast as the database lets it; the Super Admin cap and the hold still apply
  const policy: BulkPolicy = { limitsOf: async () => ({ perSecond: 0, perDay: 0 }), sleep: async () => undefined };
  let platformCountBefore = 0;

  /** One drain as compose/mail.ts runs it (`feed` first when given): passes while the pass says more is waiting, or the feeder just added mail that the pass sent (F1 fix). */
  async function drain(feed?: () => Promise<unknown>, budgetMs = 300_000): Promise<{ passes: number; sent: number; claimed: number; passMs: number[] }> {
    const started = Date.now();
    const out = { passes: 0, sent: 0, claimed: 0, passMs: [] as number[] };
    for (;;) {
      const fedResult = feed ? await feed() : null;
      const fed = typeof fedResult === "object" && fedResult !== null && "fed" in fedResult ? Number((fedResult as { fed: number }).fed) : 0;
      const t0 = performance.now();
      const pass = await runOutboxPass({ unit: platform, sender: provider.sender, now: () => new Date(), policy });
      out.passMs.push(performance.now() - t0);
      out.passes += 1;
      out.sent += pass.sent;
      out.claimed += pass.claimed;
      const goOn = pass.more || (fed > 0 && pass.claimed > 0);
      if (!goOn || pass.claimed === 0 || Date.now() - started > budgetMs) break;
    }
    return out;
  }

  /**
   * Drains again and again until a pass claims nothing: in the app the next drain comes from the 5-second timer (or the next cron call), so `drains - 1` is how often
   * the worker stopped while mail was still due (a pass that claimed less than a full batch ends a drain).
   */
  async function drainAll(feed?: () => Promise<unknown>, until?: () => Promise<boolean>): Promise<{ drains: number; passes: number; sent: number; passMs: number[] }> {
    const out = { drains: 0, passes: 0, sent: 0, passMs: [] as number[] };
    for (let i = 0; i < 5000; i += 1) {
      const d = await drain(feed);
      out.drains += 1;
      out.passes += d.passes;
      out.sent += d.sent;
      out.passMs.push(...d.passMs);
      if (until ? await until() : d.claimed === 0) break;
    }
    return out;
  }

  const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await owner.query(sql, params)).rows[0].n);

  /** EXPLAIN (ANALYZE, BUFFERS) in a transaction that is rolled back (the claims are UPDATEs): the plan's text and its execution time. */
  async function explain(label: string, sql: string, params: unknown[]): Promise<{ label: string; ms: number; scans: string[]; plan: string }> {
    await owner.query("BEGIN");
    try {
      const r = await owner.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params);
      const lines = r.rows.map((x) => String(x["QUERY PLAN"]));
      const exec = lines.find((l) => l.startsWith("Execution Time"));
      const scans = lines.map((l) => l.trim().replace(/^->\s*/, "")).filter((l) => /Scan|Sort|HashAggregate|GroupAggregate/.test(l)).map((l) => l.replace(/\s+\(cost=.*$/, ""));
      return { label, ms: exec ? Number(exec.replace(/[^0-9.]/g, "")) : NaN, scans, plan: lines.join("\n") };
    } finally {
      await owner.query("ROLLBACK");
    }
  }

  /** The worker's and the feeder's queries, written as the repositories write them (repos/postgres/auth.ts, companies.ts). */
  async function plans(stage: string, feedCampaignId?: string) {
    const [a, b, c] = hotels.map((h) => h.id);
    const now = new Date();
    const day = utcDay(now);
    const someA = (await owner.query(`SELECT to_email FROM platform.outbox WHERE hotel_id = $1 AND kind = 'campaign' ORDER BY id LIMIT 50`, [a])).rows.map((x) => String(x.to_email));
    const cols = "id, user_id, hotel_id, kind, to_email, template, payload, status, attempts, next_attempt_at, created_at";
    const list = [
      await explain("claim: system lane", `UPDATE platform.outbox SET status = 'sending' WHERE id IN (SELECT id FROM platform.outbox WHERE status = 'pending' AND next_attempt_at <= $1 AND kind <> 'campaign' ORDER BY next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING ${cols}`, [now, OUTBOX_BATCH]),
      await explain("claim: bulk lane of one hotel", `UPDATE platform.outbox SET status = 'sending' WHERE id IN (SELECT id FROM platform.outbox WHERE status = 'pending' AND next_attempt_at <= $1 AND kind = 'campaign' AND hotel_id = $3 ORDER BY next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING ${cols}`, [now, 16, a]),
      await explain(
        "lanes: hotels with campaign mail due (bulkHotels, skip scan)",
        "WITH RECURSIVE h AS ((SELECT hotel_id FROM platform.outbox WHERE status = 'pending' AND kind = 'campaign' AND hotel_id IS NOT NULL AND next_attempt_at <= $1 ORDER BY hotel_id LIMIT 1) UNION ALL SELECT (SELECT o.hotel_id FROM platform.outbox o WHERE o.status = 'pending' AND o.kind = 'campaign' AND o.hotel_id > h.hotel_id AND o.next_attempt_at <= $1 ORDER BY o.hotel_id LIMIT 1) FROM h WHERE h.hotel_id IS NOT NULL) SELECT hotel_id FROM h WHERE hotel_id IS NOT NULL LIMIT 200",
        [now],
      ),
      await explain("caps: sent today (sentToday)", "SELECT scope, sent FROM platform.mail_send_counts WHERE day = $1::date AND scope = ANY($2::text[])", [day, [a, b, c]]),
      await explain("caps: Super Admin caps (caps)", "SELECT hotel_id, daily_cap FROM platform.hotel_mail_limits WHERE hotel_id = ANY($1::uuid[])", [[a, b, c]]),
      await explain("caps: count the day (addSent)", "INSERT INTO platform.mail_send_counts (scope, day, sent) SELECT * FROM unnest($1::text[], $2::date[], $3::int[]) ON CONFLICT (scope, day) DO UPDATE SET sent = platform.mail_send_counts.sent + EXCLUDED.sent", [[a], [day], [16]]),
      await explain("holds: held hotels (heldAmong)", "SELECT hotel_id FROM platform.hotel_mail_holds WHERE released_at IS NULL AND hotel_id = ANY($1::uuid[])", [[a, b, c]]),
      await explain("suppression lookup, 50 addresses (suppressedAmong)", "SELECT DISTINCT email FROM platform.mail_suppressions WHERE email = ANY($2::text[]) AND (hotel_id IS NULL OR hotel_id = $1)", [a, someA]),
      await explain("finish one mail (finish)", "UPDATE platform.outbox SET status = $2, attempts = $3, next_attempt_at = COALESCE($4, next_attempt_at), sent_at = COALESCE($5, sent_at), last_error = $6::text, payload = CASE WHEN $2 = 'pending' THEN payload ELSE NULL END WHERE id = $1", [(await owner.query("SELECT id FROM platform.outbox WHERE hotel_id = $1 AND kind = 'campaign' ORDER BY id LIMIT 1", [a])).rows[0]?.id ?? newId(), "sent", 1, null, now, null]),
      await explain("feeder: campaign mail waiting per hotel (bulkWaiting)", "SELECT hotel_id, count(*)::int AS n FROM platform.outbox WHERE status IN ('pending', 'sending') AND kind = 'campaign' AND hotel_id = ANY($1::uuid[]) GROUP BY hotel_id", [[a, b, c]]),
      await explain("feeder: a campaign's mails still waiting (countByTemplate)", "SELECT template, COUNT(*) FILTER (WHERE status = 'sent') AS sent, COUNT(*) FILTER (WHERE status = 'failed') AS failed, COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) AS pending FROM platform.outbox WHERE hotel_id = $1 AND kind = 'campaign' AND template = ANY($2::text[]) GROUP BY template", [a, [templates[0]]]),
      await explain("feeder: running campaigns (campaignRuns.active)", "SELECT hotel_id, campaign_id, state, started_at FROM platform.mail_campaign_runs ORDER BY started_at, campaign_id LIMIT 500", []),
    ];
    if (feedCampaignId) {
      const schema = `"${hotels[0].schema}"`;
      list.push(await explain("feeder: next recipients (nextRecipients, hotel schema)", `SELECT id, email, name FROM ${schema}.mail_campaign_recipients WHERE campaign_id = $1 AND queued_at IS NULL AND skipped IS NULL ORDER BY id LIMIT $2`, [feedCampaignId, 200]));
      list.push(await explain("feeder: unsubscribed among 200 (optedOutAmong, hotel schema)", `SELECT lower(email) AS email FROM ${schema}.mail_optouts WHERE lower(email) = ANY($1::text[])`, [someA.slice(0, 50)]));
    }
    results[`plans:${stage}`] = list;
    for (const p of list) console.log(`plan [${stage}] ${p.label}: ${p.ms} ms | ${p.scans.join(" > ")}`);
    return list;
  }

  before(async () => {
    releaseTestLock = await lockTestDatabase();
    owner = await connectOwner();
    await removeAllTestHotels(owner);
    for (const name of ["Load A", "Load B", "Load C"]) hotels.push(await createTestHotel(owner, `Mail ${name}`));
    pool = createSharedPool({ databaseUrl: appUrl(), max: 10 });
    platform = createPgPlatformUnit(pool);
    database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
    companies = createPgCompaniesUnit(database.withHotel);
    assert.equal(await platform.run((r) => r.mailSafety.ready()), true, "platform 0130 is on hms_test");
    // the Super Admin who releases hotel B's hold (as in mailEngine.repo.test.ts)
    const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Mail Load SA', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin', 'code_required', true)) AS id", [superId, `ml${superId.slice(0, 8)}`, HASH, role]);
    platformCountBefore = await count("SELECT coalesce(sum(sent), 0)::int AS n FROM platform.mail_send_counts WHERE scope = 'platform' AND day = $1::date", [utcDay(new Date())]);
    // nothing of an earlier run (or of another file) may be due in the system lane during the measurement
    await owner.query("DELETE FROM platform.outbox WHERE to_email LIKE $1", [`%@${DOMAIN}`]);
    results.preexistingDue = await count("SELECT count(*)::int AS n FROM platform.outbox WHERE status = 'pending'");
  });

  after(async () => {
    const ids = hotels.map((h) => h.id);
    const day = utcDay(new Date());
    if (owner) {
      await owner.query("DELETE FROM platform.outbox WHERE hotel_id = ANY($1::uuid[]) OR to_email LIKE $2", [ids, `%@${DOMAIN}`]).catch(() => undefined);
      await owner.query("DELETE FROM platform.mail_suppressions WHERE email LIKE $1", [`%@${DOMAIN}`]).catch(() => undefined);
      await owner.query("DELETE FROM platform.mail_send_counts WHERE scope = ANY($1::text[])", [ids]).catch(() => undefined);
      // the sign-in codes of this run were counted on the platform's day: give them back
      await owner.query("UPDATE platform.mail_send_counts SET sent = $2 WHERE scope = 'platform' AND day = $1::date", [day, platformCountBefore]).catch(() => undefined);
      await owner.query("DELETE FROM platform.hotel_mail_holds WHERE hotel_id = ANY($1::uuid[])", [ids]).catch(() => undefined);
      await owner.query("DELETE FROM platform.hotel_mail_limits WHERE hotel_id = ANY($1::uuid[])", [ids]).catch(() => undefined);
      await owner.query("DELETE FROM platform.mail_campaign_runs WHERE hotel_id = ANY($1::uuid[])", [ids]).catch(() => undefined);
      await owner.query("DELETE FROM platform.logins WHERE id = $1", [superId]).catch(() => undefined);
    }
    await pool?.end();
    await database?.close();
    if (owner) await removeAllTestHotels(owner).catch(() => undefined);
    await owner?.end();
    if (process.env.HMS_MAIL_LOAD_OUT) writeFileSync(process.env.HMS_MAIL_LOAD_OUT, JSON.stringify(results, null, 2), "utf8");
    await releaseTestLock?.();
  });

  test("50,000 queued: the plans with 50,000 rows waiting", async () => {
    const t0 = performance.now();
    for (let i = 0; i < hotels.length; i += 1) {
      const template = templateOf(newId());
      templates.push(template);
      await owner.query(
        `INSERT INTO platform.outbox (user_id, hotel_id, kind, to_email, template, payload, next_attempt_at, created_at)
           SELECT NULL, $1, 'campaign', 'h' || $2 || '-' || g || '@' || $5, $3, $4, now() - interval '1 second', now() - interval '1 second' FROM generate_series(1, $6::int) AS g`,
        [hotels[i].id, i, template, JSON.stringify({ name: "Guest", subject: "Load test", text: "Hello" }), DOMAIN, SPLIT[i]],
      );
    }
    const queueMs = performance.now() - t0;
    // 20,000 addresses suppressed for every hotel (none of them on a list here), 500 of hotel A's list for every hotel, 200 of B's for B only
    await owner.query(`INSERT INTO platform.mail_suppressions (email, hotel_id, reason, source) SELECT 'other' || g || '@' || $1, NULL, 'bounce', 'ses' FROM generate_series(1, $2::int) AS g`, [DOMAIN, OTHER_SUPPRESSIONS]);
    await owner.query(`INSERT INTO platform.mail_suppressions (email, hotel_id, reason, source) SELECT 'h0-' || (g * 30) || '@' || $1, NULL, 'bounce', 'ses' FROM generate_series(1, $2::int) AS g`, [DOMAIN, SUPPRESSED_A]);
    await owner.query(`INSERT INTO platform.mail_suppressions (email, hotel_id, reason, source) SELECT 'h1-' || (g * 7) || '@' || $1, $3, 'complaint', 'brevo' FROM generate_series(1, $2::int) AS g`, [DOMAIN, SUPPRESSED_B_ONLY, hotels[1].id]);
    // the same addresses at hotel C are NOT suppressed (B's are B's only)
    assert.equal(await platform.run((r) => r.outbox.setCap(hotels[2].id, CAP_C)), true);
    await owner.query("ANALYZE platform.outbox; ANALYZE platform.mail_suppressions");
    results.queued = { rows: SPLIT.reduce((a, b) => a + b, 0), insertMs: ms(queueMs) };
    assert.equal(await count("SELECT count(*)::int AS n FROM platform.outbox WHERE status = 'pending' AND kind = 'campaign' AND hotel_id = ANY($1::uuid[])", [hotels.map((h) => h.id)]), 50_000);
    await plans("50k-waiting");
  });

  test("the drain: sustained mails a second, a sign-in code's delay behind the campaign, the cap, the hold, the suppressions", async () => {
    const [a, b, c] = hotels.map((h) => h.id);
    const queuedAt = new Map<string, number>();
    const codeDelays: number[] = [];
    const timeline: { t: number; sent: number }[] = [];
    let held = false;
    let holdAtCount = 0;
    let codeNo = 0;
    const started = performance.now();
    provider.onSend((m) => {
      const q = queuedAt.get(m.to);
      if (q !== undefined) codeDelays.push(performance.now() - q);
      if (!held && m.hotelId === b && (provider.byHotel.get(b) ?? 0) >= HOLD_B_AT) {
        held = true;
        holdAtCount = provider.byHotel.get(b) ?? 0;
        void platform.run((r) => r.mailSafety.putOnHold({ hotelId: b, reason: "bounces", detail: "load test", heldBy: null }, new Date()));
      }
    });
    // a sign-in code every 250 ms while the campaign is drained (the system lane must not wait behind 50,000 campaign mails)
    const ticker = setInterval(() => {
      const to = `code-${(codeNo += 1)}@${DOMAIN}`;
      queuedAt.set(to, performance.now());
      void platform.run((r) => r.outbox.enqueue({ userId: null, hotelId: null, kind: "login_code", toEmail: to, template: "login-code", payload: JSON.stringify({ name: "Load", code: "000000", minutes: 10 }) }, new Date()));
    }, CODE_EVERY_MS);
    const sampler = setInterval(() => timeline.push({ t: performance.now() - started, sent: [...provider.byHotel.values()].reduce((x, y) => x + y, 0) }), 1000);
    let run;
    // until A is done and C has reached its cap (B is held meanwhile): then nothing of the campaign can go today
    const campaignStuck = async () =>
      (await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status IN ('pending', 'sending')", [a])) === 0 &&
      (await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status IN ('pending', 'sending')", [c])) === SPLIT[2] - CAP_C;
    try {
      run = await drainAll(undefined, campaignStuck);
    } finally {
      clearInterval(ticker);
      clearInterval(sampler);
    }
    // the codes queued in the last moments: one more drain picks them up
    await new Promise((r) => setTimeout(r, 100));
    const tail = await drainAll();
    const seconds = (performance.now() - started) / 1000;
    provider.onSend(null);

    const sentA = provider.byHotel.get(a) ?? 0;
    const sentB = provider.byHotel.get(b) ?? 0;
    const sentC = provider.byHotel.get(c) ?? 0;
    const campaignSent = sentA + sentB + sentC;
    codeDelays.sort((x, y) => x - y);
    const passMs = [...run.passMs].sort((x, y) => x - y);
    // sustained rate: the busiest stretch excluded nothing; per 5-second window
    const windows: number[] = [];
    for (let i = 5; i < timeline.length; i += 5) windows.push((timeline[i]!.sent - timeline[i - 5]!.sent) / 5);
    results.drain = {
      seconds: ms(seconds),
      passes: run.passes + tail.passes,
      // each drain after the first is a stop while campaign mail was still due (in the app: wait for the next 5-second tick, or the next cron call)
      drains: run.drains,
      campaignSent,
      perSecondOverall: ms(campaignSent / seconds),
      perSecond5sWindows: { min: ms(Math.min(...windows)), median: ms(pct([...windows].sort((x, y) => x - y), 0.5)), max: ms(Math.max(...windows)) },
      passMs: { p50: ms(pct(passMs, 0.5)), p95: ms(pct(passMs, 0.95)), max: ms(passMs[passMs.length - 1] ?? 0) },
      codes: { queued: codeNo, delivered: codeDelays.length, p50Ms: ms(pct(codeDelays, 0.5)), p95Ms: ms(pct(codeDelays, 0.95)), maxMs: ms(codeDelays[codeDelays.length - 1] ?? 0) },
      sentA,
      sentB,
      sentC,
      holdB: { heldAfter: holdAtCount, sentByThen: sentB, overshoot: sentB - holdAtCount },
    };
    console.log(`drain: ${JSON.stringify(results.drain)}`);

    // every sign-in code went, once
    assert.equal(codeDelays.length, codeNo, "every sign-in code was sent");
    // A: everything but the 500 suppressed, each once; the suppressed failed with SUPPRESSED and were never handed to the provider
    assert.equal(sentA, SPLIT[0] - SUPPRESSED_A);
    assert.equal(await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status = 'failed' AND last_error = 'SUPPRESSED'", [a]), SUPPRESSED_A);
    assert.equal([...provider.got.entries()].filter(([to]) => /^h0-\d+@/.test(to) && Number(to.slice(3).split("@")[0]) % 30 === 0 && Number(to.slice(3).split("@")[0]) <= SUPPRESSED_A * 30).length, 0);
    // C: exactly its cap today, the rest waits (pending) for tomorrow
    assert.equal(sentC, CAP_C, "hotel C stopped at its Super Admin cap");
    assert.equal(await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status = 'pending'", [c]), SPLIT[2] - CAP_C);
    // B: put on hold at 5,000; what was already claimed in that pass may still go (at most one batch)
    assert.ok(held, "the hold was set");
    assert.ok(sentB - holdAtCount <= OUTBOX_BATCH, `B went on ${sentB - holdAtCount} mails after its hold`);
    assert.ok(await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status = 'pending'", [b]) > 0);
    assert.ok(onceEach(provider.got), "no address got a mail twice");
  });

  test("hotel B released: two workers at once drain its rest, no mail goes twice; B's own suppressions hold", async () => {
    const b = hotels[1].id;
    const before = provider.byHotel.get(b) ?? 0;
    assert.equal(await platform.run((r) => r.mailSafety.release(b, superId, "Load test release", new Date())), true);
    const t0 = performance.now();
    const bDone = async () => (await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status IN ('pending', 'sending')", [b])) === 0;
    const [w1, w2] = await Promise.all([drainAll(undefined, bDone), drainAll(undefined, bDone)]);
    const seconds = (performance.now() - t0) / 1000;
    const sentB = provider.byHotel.get(b) ?? 0;
    results.release = { seconds: ms(seconds), sentNow: sentB - before, perSecond: ms((sentB - before) / seconds), passes: w1.passes + w2.passes, drains: w1.drains + w2.drains };
    console.log(`release: ${JSON.stringify(results.release)}`);
    assert.equal(sentB, SPLIT[1] - SUPPRESSED_B_ONLY, "B: everything but its own 200 suppressed");
    assert.equal(await count("SELECT count(*)::int AS n FROM platform.outbox WHERE hotel_id = $1 AND status = 'failed' AND last_error = 'SUPPRESSED'", [b]), SUPPRESSED_B_ONLY);
    assert.ok(onceEach(provider.got), "no address got a mail twice with two workers");
  });

  test(`a ${FEED_RECIPIENTS.toLocaleString("en")}-address campaign through the feeder, with 50,000 sent rows in the history; the plans again`, async () => {
    const a = hotels[0].id;
    const people = Array.from({ length: FEED_RECIPIENTS }, (_, i) => ({ email: `feed${i}@${DOMAIN}`, name: `Guest ${i}` }));
    const c = await companies.run({ hotelId: a, userId: USER }, (r) => r.marketing.create({ subject: "Feeder load", body: "Hello {name}", audience: "all", createdBy: USER }));
    const tBegin = performance.now();
    await companies.run({ hotelId: a, userId: USER }, (r) => r.marketing.begin(c.id, people, 0, new Date(), USER));
    const beginMs = performance.now() - tBegin;
    await platform.run((r) => r.campaignRuns.start(a, c.id, new Date()));
    // 300 of the campaign's addresses unsubscribed after it began: the feeder skips them
    await companies.run({ hotelId: a, userId: USER }, async (r) => {
      for (let i = 0; i < 300; i += 1) await r.marketing.optOut(`feed${i * 33}@${DOMAIN}`);
    });
    await owner.query(`ANALYZE "${hotels[0].schema}".mail_campaign_recipients; ANALYZE platform.outbox`);
    await plans("feeder-50k-history", c.id);

    const ports: FeedPorts = {
      publicUrl: "http://localhost:3000",
      secret: () => Buffer.alloc(32, 7),
      suppressedAmong: (hotelId, emails) => platform.run((r) => r.mailSafety.suppressedAmong(hotelId, emails)),
      runs: () => platform.run((r) => r.campaignRuns.active()),
      setRunState: (hotelId, campaignId, state) => platform.run((r) => r.campaignRuns.setState(hotelId, campaignId, state)),
      endRun: (hotelId, campaignId) => platform.run((r) => r.campaignRuns.end(hotelId, campaignId)),
      held: (hotelIds) => platform.run((r) => r.mailSafety.heldAmong(hotelIds)),
      waiting: (hotelIds) => platform.run((r) => r.outbox.bulkWaiting(hotelIds)),
      allowance: async () => Infinity,
      pending: async (hotelId, template) => (await platform.run((r) => r.outbox.countByTemplate(hotelId, [template]))).get(template)?.pending ?? 0,
      enqueue: (hotelId, rows) =>
        platform.run(async (r) => {
          const at = new Date();
          for (const x of rows) await r.outbox.enqueue({ userId: null, hotelId, kind: "campaign", toEmail: x.to, template: x.template, payload: JSON.stringify(x.payload) }, at);
        }),
      hotel: companies,
    };
    const feedMs: number[] = [];
    const feed = async () => {
      const t = performance.now();
      await feedCampaigns(ports, () => new Date());
      feedMs.push(performance.now() - t);
    };
    const before = provider.byHotel.get(a) ?? 0;
    const t0 = performance.now();
    // the drain stops when a pass claims less than a batch; drains go on until the campaign left the running list
    const feedDrains = await drainAll(feed, async () => !(await platform.run((r) => r.campaignRuns.active())).some((x) => x.campaignId === c.id));
    const seconds = (performance.now() - t0) / 1000;
    const sent = (provider.byHotel.get(a) ?? 0) - before;
    const done = await companies.run({ hotelId: a, userId: USER }, (r) => r.marketing.get(c.id));
    feedMs.sort((x, y) => x - y);
    results.feeder = { recipients: FEED_RECIPIENTS, beginMs: ms(beginMs), seconds: ms(seconds), sent, perSecond: ms(sent / seconds), drains: feedDrains.drains, feeds: feedMs.length, feedMs: { p50: ms(pct(feedMs, 0.5)), p95: ms(pct(feedMs, 0.95)), max: ms(feedMs[feedMs.length - 1] ?? 0) }, status: done?.status, queued: done?.queued, leftOut: done?.leftOut };
    console.log(`feeder: ${JSON.stringify(results.feeder)}`);
    assert.equal(done?.status, "sent");
    assert.equal(sent, FEED_RECIPIENTS - 300, "everyone but the 300 who unsubscribed");
    assert.deepEqual([done?.queued, done?.leftOut], [FEED_RECIPIENTS - 300, 300]);
    assert.ok(onceEach(provider.got), "no address got a mail twice");
    await plans("after-all", c.id);
  });
});
