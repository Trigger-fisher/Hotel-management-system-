// The security layer (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md sections 7 to 9): alerts, events, decoy addresses and canaries, failed-login bursts, emergency resets.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../../src/server/errors";
import { createMemorySecurity } from "../../src/server/repos/memory/security";
import { createAlertDispatcher, slackEscape } from "../../src/server/services/security/alerts";
import { createCloudflareExecutor, createUnconnectedExecutor } from "../../src/server/services/security/executors";
import { cleanText, createSecurityEvents } from "../../src/server/services/security/events";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import { API_TOKEN_SHAPE } from "../../src/server/auth/apiTokens";
import { edgeCountry } from "../../src/server/services/security/edge";
import { canaryToken, decoyGuestCsv, fakeEnvFile, honeyApiKey, honeyKeyLabel, isHoneypotPath, verifyCanary } from "../../src/server/services/security/honeypot";
import { createResetService, type ResetExecutor } from "../../src/server/services/security/resets";

const SLACK = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX";
const ok = () => new Response("ok", { status: 200 });

function recorder(respond: (url: string, init?: RequestInit) => Response = ok) {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return respond(String(url), init);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("alerts", () => {
  test("nothing configured: every channel is skipped and nothing is sent", async () => {
    const r = recorder();
    const d = createAlertDispatcher({ fetch: r.fetchFn });
    assert.deepEqual(await d.dispatch({ severity: "critical", key: "k", text: "x" }), { slack: "skipped", sms: "skipped" });
    assert.equal(r.calls.length, 0);
  });

  test("a Warning goes to Slack only; a Critical goes to Slack and SMS", async () => {
    const r = recorder();
    const d = createAlertDispatcher({ slackWebhook: SLACK, sms: { provider: "msg91", authKey: "k".repeat(10), templateId: "tpl1", to: ["+919800000000"] }, fetch: r.fetchFn });
    assert.deepEqual(await d.dispatch({ severity: "warning", key: "a", text: "five failed logins" }), { slack: "sent", sms: "skipped" });
    assert.equal(r.calls.length, 1);
    assert.deepEqual(await d.dispatch({ severity: "critical", key: "b", text: "decoy hit" }), { slack: "sent", sms: "sent" });
    const sms = r.calls.at(-1)!;
    assert.equal(sms.url, "https://control.msg91.com/api/v5/flow");
    assert.match(sms.body, /919800000000/);
  });

  test("Twilio sends one message per number with basic auth", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = (async (_u: string, init?: RequestInit) => (seen.push(init!), ok())) as unknown as typeof fetch;
    const d = createAlertDispatcher({ sms: { provider: "twilio", accountSid: `AC${"a".repeat(32)}`, authToken: "t".repeat(20), from: "+12025550123", to: ["+919800000000", "+919800000001"] }, fetch: fetchFn });
    assert.equal((await d.dispatch({ severity: "critical", key: "x", text: "t" })).sms, "sent");
    assert.equal(seen.length, 2);
    assert.match(String((seen[0]!.headers as Record<string, string>).authorization), /^Basic /);
  });

  test("the same alert within the window is throttled; a different one is not", async () => {
    let t = 0;
    const r = recorder();
    const d = createAlertDispatcher({ slackWebhook: SLACK, fetch: r.fetchFn, now: () => t });
    assert.equal((await d.dispatch({ severity: "warning", key: "same", text: "1" })).slack, "sent");
    assert.equal((await d.dispatch({ severity: "warning", key: "same", text: "2" })).slack, "throttled");
    assert.equal((await d.dispatch({ severity: "warning", key: "other", text: "3" })).slack, "sent");
    t = 61_000;
    assert.equal((await d.dispatch({ severity: "warning", key: "same", text: "4" })).slack, "sent");
    assert.equal(r.calls.length, 3);
  });

  test("a failing channel is reported failed and never throws; a non-Slack webhook address is never called", async () => {
    const bad = recorder(() => new Response("no", { status: 500 }));
    assert.equal((await createAlertDispatcher({ slackWebhook: SLACK, fetch: bad.fetchFn }).dispatch({ severity: "warning", key: "k", text: "x" })).slack, "failed");
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    assert.equal((await createAlertDispatcher({ slackWebhook: SLACK, fetch: boom }).dispatch({ severity: "warning", key: "k", text: "x" })).slack, "failed");
    const other = recorder();
    const d = createAlertDispatcher({ slackWebhook: "https://evil.example/services/T000/B000/XXXXXXXX", fetch: other.fetchFn });
    assert.equal((await d.dispatch({ severity: "critical", key: "k", text: "x" })).slack, "skipped");
    assert.equal(other.calls.length, 0);
  });

  test("text from an attacker cannot become a Slack link or mention", () => {
    assert.equal(slackEscape("<!channel> <https://x|click> & more"), "&lt;!channel&gt; &lt;https://x|click&gt; &amp; more");
  });
});

describe("events", () => {
  test("severity comes from the kind; text is cut and made printable; a bad address is dropped", async () => {
    const repo = createMemorySecurity();
    const r = recorder();
    const events = createSecurityEvents({ repo, alerts: createAlertDispatcher({ slackWebhook: SLACK, fetch: r.fetchFn }) });
    const e = await events.record({ kind: "canary_triggered", summary: "GET /.env\u0000\n<script>" + "a".repeat(500), ip: "not an ip", detail: { path: "/.env‮" } });
    assert.equal(e?.severity, "critical");
    assert.equal((await events.record({ kind: "honeypot_hit", summary: "scan" }))?.severity, "warning", "a bare decoy scan is a Warning, never an SMS");
    assert.equal(e?.ip, null);
    assert.ok(e!.summary.length <= 300 && !/[\n\u0000]/.test(e!.summary));
    assert.equal(e?.detail.path, "/.env?");
    assert.equal(e?.slack, "sent");
    assert.equal((await repo.listEvents({ limit: 10 }))[0]!.slack, "sent", "the delivery marks are stored");
    assert.equal((await events.record({ kind: "failed_login_burst", summary: "x" }))?.severity, "warning");
    assert.equal(cleanText(undefined, 5), "");
  });

  test("a store that fails does not break the caller, and the alert still goes out", async () => {
    const repo = createMemorySecurity();
    repo.addEvent = async () => {
      throw new Error("db down");
    };
    const r = recorder();
    const events = createSecurityEvents({ repo, alerts: createAlertDispatcher({ slackWebhook: SLACK, fetch: r.fetchFn }) });
    assert.equal(await events.record({ kind: "honeypot_hit", summary: "x" }), null);
    assert.equal(r.calls.length, 1);
  });
});

describe("decoy addresses and canaries", () => {
  test("the decoy list matches scanner targets, also encoded or with a trailing slash, and nothing real", () => {
    for (const p of ["/wp-admin", "/wp-admin/install.php", "/.env", "/.env.production", "/admin/.git", "/admin/.git/config", "/.git/HEAD", "/WP-ADMIN/", "/%2eenv", "/wp-login.php", "/.svn/entries", "/backup.sql", "/.ssh/id_rsa", "/id_rsa", "/cgi-bin/test", "/wp-content/uploads", "/phpinfo.php", "/actuator/env", "/server-status"]) assert.ok(isHoneypotPath(p), p);
    for (const p of ["/", "/login", "/admin", "/admin/users", "/api/v1/health", "/environment", "/.well-known/security.txt", "/%E0%A4%A", "/backup", "/config", "/info", "/database"]) assert.ok(!isHoneypotPath(p), p);
  });

  test("a canary token verifies only if we made it", () => {
    const key = Buffer.alloc(32, 7);
    const token = canaryToken(key, "driveexport");
    assert.equal(verifyCanary(key, token), "driveexport");
    assert.equal(verifyCanary(Buffer.alloc(32, 8), token), null, "another server's key");
    assert.equal(verifyCanary(key, token.replace(/.$/, token.endsWith("0") ? "1" : "0")), null, "a changed character");
    assert.equal(verifyCanary(key, "driveexport-" + "0".repeat(32)), null);
    assert.equal(verifyCanary(key, "../../etc/passwd"), null);
  });

  test("the decoy file is plainly invented data carrying the canary address", () => {
    const csv = decoyGuestCsv("https://hms.test/api/v1/public/security/canary/x-0");
    assert.match(csv, /DEC-0001/);
    assert.match(csv, /canary\/x-0/);
    assert.doesNotMatch(csv, /\b[6-9]\d{9}\b/, "no real-looking phone number");
  });
});

describe("honeytokens", () => {
  const key = Buffer.alloc(32, 9);
  test("the fake API key has the real key's shape, is recognised only with our key, and differs per label", () => {
    const fake = honeyApiKey(key, "dotenv");
    assert.match(fake, API_TOKEN_SHAPE);
    assert.equal(honeyKeyLabel(key, fake), "dotenv");
    assert.equal(honeyKeyLabel(key, honeyApiKey(key, "decoyfile")), "decoyfile");
    assert.notEqual(fake, honeyApiKey(key, "decoyfile"));
    assert.equal(honeyKeyLabel(Buffer.alloc(32, 1), fake), null, "another server's key");
    assert.equal(honeyKeyLabel(key, "hms_pat_" + "A".repeat(43)), null);
  });

  test("the fake .env holds invented values, the honey key and a canary link, and no secret of the server", () => {
    const env = fakeEnvFile(key, "https://hms.test");
    assert.ok(env.includes(honeyApiKey(key, "dotenv")));
    assert.match(env, /BACKUP_REPORT_URL=https:\/\/hms\.test\/api\/v1\/public\/security\/canary\/dotenv-[0-9a-f]{32}/);
    assert.match(env, /\.invalid:/);
    assert.ok(!env.includes(key.toString("hex")) && !env.includes(key.toString("base64")));
    assert.ok(!fakeEnvFile(key, undefined).includes("BACKUP_REPORT_URL"));
  });

  test("trying the fake key is told to the security layer, never touches the key table, and is refused like any unknown key", async () => {
    const told: { label: string; ip: string | null }[] = [];
    const unit = { run: async () => { throw new Error("the key table must not be read"); } } as never;
    const resolver = createSessionResolver({ unit, catalog: {} as never, now: () => new Date(), hashKey: () => key, honeyKeyLabel, onHoneyKey: (u) => void told.push(u) });
    const request = new Request("https://hms.test/api/v1/platform/hotels", { headers: { authorization: `Bearer ${honeyApiKey(key, "dotenv")}`, "x-forwarded-for": "203.0.113.9" } });
    assert.equal(await resolver.resolveSession(request), null);
    assert.deepEqual(told, [{ label: "dotenv", ip: "203.0.113.9", country: null }], "no resolver country source here, so null");
    const broken = createSessionResolver({ unit, catalog: {} as never, now: () => new Date(), hashKey: () => key, honeyKeyLabel, onHoneyKey: () => { throw new Error("alert down"); } });
    assert.equal(await broken.resolveSession(request), null, "a failing alert never changes the answer");
  });
});

describe("what Cloudflare reports", () => {
  const withHeader = (v?: string) => new Request("https://hms.test/", { headers: v === undefined ? {} : { "cf-ipcountry": v } });
  test("a two-letter code (or Tor's T1) is taken, upper-cased; anything else is dropped", () => {
    assert.equal(edgeCountry(withHeader("in")), "IN");
    assert.equal(edgeCountry(withHeader("T1")), "T1");
    for (const bad of [undefined, "", "India", "I", "1N", "IN<script>", "XX1"]) assert.equal(edgeCountry(withHeader(bad)), null, String(bad));
  });
  test("the alert text carries the country next to the address; the stored detail has it", async () => {
    const repo = createMemorySecurity();
    const r = recorder();
    const events = createSecurityEvents({ repo, alerts: createAlertDispatcher({ slackWebhook: SLACK, fetch: r.fetchFn }) });
    const e = await events.record({ kind: "canary_triggered", summary: "Canary opened", ip: "203.0.113.7", detail: { country: "RU" } });
    assert.equal(e?.detail.country, "RU");
    assert.match(r.calls[0]!.body, /from 203\.0\.113\.7 \[RU\]/);
    await events.record({ kind: "canary_triggered", summary: "Canary opened", ip: "203.0.113.8", detail: { country: null } });
    assert.doesNotMatch(r.calls[1]!.body, /\[/);
  });
  test("a honeytoken tried through Cloudflare tells the security layer the country too", async () => {
    const key = Buffer.alloc(32, 9);
    const told: unknown[] = [];
    const unit = { run: async () => { throw new Error("no"); } } as never;
    const resolver = createSessionResolver({ unit, catalog: {} as never, now: () => new Date(), hashKey: () => key, honeyKeyLabel, edgeCountry, onHoneyKey: (u) => void told.push(u) });
    await resolver.resolveSession(new Request("https://hms.test/x", { headers: { authorization: `Bearer ${honeyApiKey(key, "dotenv")}`, "x-forwarded-for": "203.0.113.9", "cf-ipcountry": "cn" } }));
    assert.deepEqual(told, [{ label: "dotenv", ip: "203.0.113.9", country: "CN" }]);
  });
});

describe("emergency resets", () => {
  const supers = { a: { userId: "u-a", name: "Asha", isSuper: true }, b: { userId: "u-b", name: "Bala", isSuper: true } };
  const fake = (over: Partial<ResetExecutor> = {}): ResetExecutor & { ran: number } => {
    const e: ResetExecutor & { ran: number } = { ran: 0, configured: () => true, describe: () => "fake", run: async () => { e.ran += 1; return [{ name: "step", ok: true, detail: "done" }]; }, health: async () => ({ ok: true, detail: "fine" }), ...over };
    return e;
  };
  const ran = (e: ResetExecutor): number => (e as ResetExecutor & { ran: number }).ran;
  function make(executors: Record<1 | 2 | 3, ResetExecutor> = { 1: fake(), 2: fake(), 3: fake() }) {
    const repo = createMemorySecurity();
    const events = createSecurityEvents({ repo, alerts: createAlertDispatcher({}) });
    return { repo, executors, service: createResetService({ repo, events, executors }) };
  }

  test("layers 1 and 2 run at once and end healthy only when the health check passes", async () => {
    const { service, executors } = make();
    const r = await service.request(supers.a, { layer: 1, reason: "suspicious scanner" });
    assert.equal(r.state, "healthy");
    assert.equal(ran(executors[1]), 1);
    const bad = make({ 1: fake({ health: async () => ({ ok: false, detail: "HSTS is off." }) }), 2: fake(), 3: fake() });
    const u = await bad.service.request(supers.a, { layer: 1, reason: "suspicious scanner" });
    assert.equal(u.state, "unhealthy");
    assert.equal(u.healthDetail, "HSTS is off.");
  });

  test("layer 3 waits for a DIFFERENT Super Admin; the requester cannot approve; approving twice runs it once", async () => {
    const { service, executors } = make();
    const r = await service.request(supers.a, { layer: 3, reason: "leaked database credential" });
    assert.equal(r.state, "awaiting_approval");
    assert.equal(ran(executors[3]), 0);
    await assert.rejects(service.approve(supers.a, r.id), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    const done = await service.approve(supers.b, r.id);
    assert.equal(done.state, "healthy");
    assert.equal(done.approvedByName, "Bala");
    await assert.rejects(service.approve(supers.b, r.id), (e: unknown) => e instanceof AppError && e.code === "CONFLICT");
    assert.equal(ran(executors[3]), 1);
  });

  test("a rejected layer 3 reset never runs", async () => {
    const { service, executors } = make();
    const r = await service.request(supers.a, { layer: 3, reason: "false alarm after all" });
    assert.equal((await service.reject(supers.a, r.id)).state, "rejected");
    await assert.rejects(service.approve(supers.b, r.id));
    assert.equal(ran(executors[3]), 0);
  });

  test("a layer that is not connected ends unhealthy and says why; it is never reported healthy", async () => {
    const { service } = make({ 1: fake(), 2: createUnconnectedExecutor("The VPS does not exist yet."), 3: fake() });
    const r = await service.request(supers.a, { layer: 2, reason: "container looks compromised" });
    assert.equal(r.state, "unhealthy");
    assert.match(r.steps[0]!.detail, /VPS/);
    const status = await service.status(supers.a);
    assert.equal(status[1]!.state, "unhealthy");
    assert.equal(status[1]!.connected, false);
    assert.equal(status[0]!.state, "unknown");
  });

  test("an executor that crashes ends unhealthy, not as an error to the caller", async () => {
    const { service } = make({ 1: fake({ run: async () => { throw new Error("boom"); } }), 2: fake(), 3: fake() });
    const r = await service.request(supers.a, { layer: 1, reason: "scanner flood" });
    assert.equal(r.state, "unhealthy");
    assert.match(r.steps[0]!.detail, /boom/);
  });

  test("only a Super Admin, and a reason is required", async () => {
    const { service } = make();
    await assert.rejects(service.request({ userId: "p", name: "Pat", isSuper: false }, { layer: 1, reason: "scanner flood" }), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    await assert.rejects(service.request(supers.a, { layer: 1, reason: "  " }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED");
  });

  test("the address to block is read from the reason, and only if it is a real address", () => {
    const { service } = make();
    assert.equal(service.ipOf("scanner ip=203.0.113.7"), "203.0.113.7");
    assert.equal(service.ipOf("scanner ip=2001:db8::7"), "2001:db8::7");
    assert.equal(service.ipOf("scanner ip=999.1.1.1"), null);
    assert.equal(service.ipOf("no address here"), null);
  });
});

describe("the Cloudflare executor", () => {
  const ZONE = "a".repeat(32);
  function cf(settings: { ssl?: string; https?: string; hsts?: boolean; blocked?: boolean; duplicate?: boolean }) {
    const urls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method} ${url}`);
      const json = (o: unknown) => new Response(JSON.stringify(o));
      if (url.endsWith("/settings/ssl")) return json({ success: true, result: { value: settings.ssl ?? "strict" } });
      if (url.endsWith("/settings/always_use_https")) return json({ success: true, result: { value: settings.https ?? "on" } });
      if (url.endsWith("/settings/security_header")) return json({ success: true, result: { value: { strict_transport_security: { enabled: settings.hsts ?? true } } } });
      if (init?.method === "POST") return json(settings.duplicate ? { success: false, errors: [{ code: 10009, message: "duplicate" }] } : { success: true, result: {} });
      return json({ success: true, result: settings.blocked === false ? [] : [{ id: "r1" }] });
    }) as unknown as typeof fetch;
    return { urls, executor: createCloudflareExecutor({ token: "t".repeat(30), zoneId: ZONE, fetch: fetchFn }) };
  }
  test("not configured without both the token and a 32-character zone id", () => {
    assert.equal(createCloudflareExecutor({ token: "x".repeat(30) }).configured(), false);
    assert.equal(createCloudflareExecutor({ token: "x".repeat(30), zoneId: "short" }).configured(), false);
    assert.equal(cf({}).executor.configured(), true);
  });
  test("blocks the address and the health check confirms it and the zone's TLS settings", async () => {
    const { executor, urls } = cf({});
    const steps = await executor.run({ reason: "", ip: "203.0.113.7" });
    assert.equal(steps[0]!.ok, true);
    assert.ok(urls.some((u) => u.startsWith("POST") && u.includes("/firewall/access_rules/rules")));
    assert.deepEqual(await executor.health({ reason: "", ip: "203.0.113.7" }), { ok: true, detail: "SSL strict, HTTPS forced, HSTS on, 203.0.113.7 blocked." });
  });
  test("an address that is already blocked is fine; weakened settings or a missing block are unhealthy", async () => {
    assert.equal((await cf({ duplicate: true }).executor.run({ reason: "", ip: "203.0.113.7" }))[0]!.ok, true);
    const weak = await cf({ ssl: "flexible", https: "off", hsts: false, blocked: false }).executor.health({ reason: "", ip: "203.0.113.7" });
    assert.equal(weak.ok, false);
    for (const word of ["Full (strict)", "Always Use HTTPS", "HSTS", "not blocked"]) assert.match(weak.detail, new RegExp(word.replace(/[()]/g, "\\$&")));
  });
});
