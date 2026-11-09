// The scheduled-job routes (/api/v1/cron, HMS_MAIL_WORKER=cron for a serverless host) through the REAL route file and the wrapper. What must hold: no
// CRON_SECRET configured = 404, a missing or wrong secret = 401, the right one drains the mail queue ONCE with the same pass as the in-process worker
// (batches of 50 until nothing is due, within a time budget) and answers {sent, failed, remaining}; the secret never appears in an answer or a log.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { GET as cronMail } from "../../src/app/api/v1/cron/mail/route";
import { configureCron, getCron } from "../../src/server/compose/cron";
import { configureMailDrain, drainMailOnce } from "../../src/server/compose/mail";
import { resetConfigCache } from "../../src/server/config/env";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import type { MailSender } from "../../src/server/services/auth/mail";
import { createCronService } from "../../src/server/services/cron/cronService";
import { catalog } from "./helpers/session";

const SECRET = "c".repeat(48);
let secret: string | undefined = SECRET;
let logLines: string[] = [];
let auth = createMemoryAuth();
let sent: { to: string; subject: string }[] = [];
let failNext = 0;

const sender: MailSender = {
  async send(message) {
    if (failNext > 0) {
      failNext -= 1;
      throw new Error("smtp down");
    }
    sent.push({ to: message.to, subject: message.subject });
  },
};

beforeEach(() => {
  secret = SECRET;
  logLines = [];
  sent = [];
  failNext = 0;
  auth = createMemoryAuth();
  configureMailDrain({ unit: auth.unit, sender, pending: async () => auth.data().outbox.filter((o) => o.status === "pending").length });
  configureCron(createCronService({ secret: () => secret, drainMail: drainMailOnce, dailySummary: async () => ({ hotels: 0, queued: 0, skipped: 0, failed: 0 }), backup: async () => ({ configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 }) }));
  configureRoutes({ resolveSession: async () => null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "debug", write: (line) => void logLines.push(line) }) });
});
afterEach(() => {
  configureMailDrain(null);
  configureCron(null);
});

const call = (authorization?: string): Promise<Response> =>
  cronMail(new Request("https://hms.test/api/v1/cron/mail", { method: "GET", headers: { host: "hms.test", ...(authorization ? { authorization } : {}) } }));
const queue = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    await auth.unit.run((r) => r.outbox.enqueue({ userId: null, kind: "password_changed", toEmail: `person${i}@hotel.test`, template: "password-changed", payload: JSON.stringify({ name: `Person ${i}` }) }, new Date(Date.now() - 1000)));
  }
};

describe("GET /api/v1/cron/mail", () => {
  test("no CRON_SECRET configured: 404 for everyone, nothing is sent", async () => {
    secret = undefined;
    await queue(1);
    assert.equal((await call()).status, 404);
    assert.equal((await call(`Bearer ${SECRET}`)).status, 404);
    assert.equal(sent.length, 0);
  });

  test("missing, malformed or wrong secret: 401, nothing is sent", async () => {
    await queue(1);
    for (const header of [undefined, SECRET, `Basic ${SECRET}`, "Bearer ", `Bearer ${SECRET}x`, `Bearer ${"d".repeat(48)}`]) {
      assert.equal((await call(header)).status, 401, String(header));
    }
    assert.equal(sent.length, 0);
  });

  test("the right secret: one pass of the queue, {sent, failed, remaining}; never cached; the secret is in no answer or log", async () => {
    await queue(3);
    failNext = 1;
    const res = await call(`Bearer ${SECRET}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { data: { sent: number; failed: number; remaining: number } };
    assert.deepEqual(body.data, { sent: 2, failed: 1, remaining: 1 });
    assert.equal(sent.length, 2);
    // the failed one is retried later (pending, its next try in the future), its payload kept
    const waiting = auth.data().outbox.filter((o) => o.status === "pending");
    assert.equal(waiting.length, 1);
    assert.ok(waiting[0].payload !== null && waiting[0].attempts === 1);
    assert.ok(!logLines.join("\n").includes(SECRET));
    // a second pass right away: the retry is not due yet, nothing is tried
    assert.deepEqual(((await (await call(`Bearer ${SECRET}`)).json()) as { data: unknown }).data, { sent: 0, failed: 0, remaining: 1 });
  });

  test("one call drains the queue in batches of 50 until nothing is due (123 mails: three batches, one call); a later call finds nothing", async () => {
    await queue(123);
    assert.deepEqual(((await (await call(`Bearer ${SECRET}`)).json()) as { data: unknown }).data, { sent: 123, failed: 0, remaining: 0 });
    assert.deepEqual(((await (await call(`Bearer ${SECRET}`)).json()) as { data: unknown }).data, { sent: 0, failed: 0, remaining: 0 });
  });

  test("no sender allowed (the log driver in production): nothing is sent, the queue waits and is counted", async () => {
    configureMailDrain({ unit: auth.unit, sender: null, pending: async () => auth.data().outbox.filter((o) => o.status === "pending").length });
    await queue(2);
    assert.deepEqual(((await (await call(`Bearer ${SECRET}`)).json()) as { data: unknown }).data, { sent: 0, failed: 0, remaining: 2 });
  });

  test("the composed service reads CRON_SECRET from the environment", async () => {
    const before = process.env.CRON_SECRET;
    try {
      configureCron(null);
      delete process.env.CRON_SECRET;
      resetConfigCache();
      assert.throws(() => getCron().authorize(new Request("https://hms.test/x", { headers: { authorization: `Bearer ${SECRET}` } })), (e: Error & { code?: string }) => e.code === "NOT_FOUND");
      process.env.CRON_SECRET = SECRET;
      resetConfigCache();
      assert.doesNotThrow(() => getCron().authorize(new Request("https://hms.test/x", { headers: { authorization: `Bearer ${SECRET}` } })));
      assert.throws(() => getCron().authorize(new Request("https://hms.test/x", { headers: { authorization: "Bearer wrong" } })), (e: Error & { code?: string }) => e.code === "SESSION_EXPIRED");
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
      resetConfigCache();
    }
  });
});
