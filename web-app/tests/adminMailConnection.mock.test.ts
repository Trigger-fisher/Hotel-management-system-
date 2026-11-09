// Unit tests for the admin mock's Settings > Email reading part (ui-shared/dashboards/admin.mock.ts, decision 66): the IMAP fields saved by the same rules as the server, and
// "Test connection" (startMailConnectionTest): two rows (reading and sending), fixed sentences with plain hints, never a server's words, a login or a password, and the
// result kept for the status panel. The dev preview picks a failure with `window.__mailConnTest`.
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { createAdminApi, MOCK_MAIL_CHECKS } = await import("../../common/ui-shared/dashboards/admin.mock");
const { mailProviderCopy } = await import("../../common/ui-shared/dashboards/mailProviders");

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.__mailConnTest;
});

type Api = ReturnType<typeof createAdminApi>;
const fresh = (): Api => createAdminApi({ latencyMs: 0 });
const emailValues = async (api: Api): Promise<Record<string, string | boolean>> => {
  const r = await api.getSettings("email");
  assert.ok(r.ok);
  return Object.fromEntries(r.data.current.fields.map((f) => [f.key, f.type === "toggle" ? f.value === "1" : f.secret ? "" : (f.value ?? "")]));
};
const save = async (api: Api, patch: Record<string, string | boolean>) => api.saveSettings("email", { ...(await emailValues(api)), ...patch });

/** Nothing in an answer may carry the login, the password or a mail server's own words. */
function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const bad of ["stay@hotelsunriserajkot.in", "abcdefghijklmnop", "EAUTH", "535", "Username and Password"]) assert.ok(!text.includes(bad), `${bad} in ${text}`);
}

describe("startMailConnectionTest", () => {
  test("the demo hotel's Gmail: both rows work, with the server's fixed sentences and the time", async () => {
    const r = await fresh().startMailConnectionTest();
    assert.ok(r.ok);
    assert.deepEqual(r.data.imap, { ok: true, code: null, message: "Signed in. Sent folder found." });
    assert.deepEqual(r.data.smtp, { ok: true, code: null, message: "Signed in. Sending works." });
    assert.ok(!Number.isNaN(Date.parse(r.data.at)));
    assertNoSecrets(r.data);
  });

  test("the result is kept for the status panel (codes, sentences and the time only)", async () => {
    const api = fresh();
    const r = await api.startMailConnectionTest();
    assert.ok(r.ok);
    const s = await api.getSettings("email");
    assert.ok(s.ok);
    assert.deepEqual(s.data.current.emailStatus?.lastConnectionTest, r.data);
  });

  test("the AUTH sample: reading and sending fail with a fixed sentence and a plain hint", async () => {
    g.__mailConnTest = "AUTH";
    const r = await fresh().startMailConnectionTest();
    assert.ok(r.ok);
    assert.equal(r.data.imap.ok, false);
    assert.equal(r.data.imap.code, "AUTH");
    assert.equal(r.data.imap.message, MOCK_MAIL_CHECKS.AUTH.message);
    assert.match(r.data.imap.hint ?? "", /App passwords/);
    assert.equal(r.data.smtp.ok, false);
    assert.equal(r.data.smtp.code, "AUTH");
    assert.ok(r.data.smtp.hint);
    assertNoSecrets(r.data);
  });

  test("the WEB_LOGIN sample: reading fails with the web-browser sign-in hint, sending still works", async () => {
    g.__mailConnTest = "WEB_LOGIN";
    const r = await fresh().startMailConnectionTest();
    assert.ok(r.ok);
    assert.deepEqual(r.data.imap, { ...MOCK_MAIL_CHECKS.WEB_LOGIN });
    assert.match(r.data.imap.hint ?? "", /mail\.google\.com/);
    assert.equal(r.data.smtp.ok, true);
  });

  test("every sample is a fixed sentence; every failure carries a code", () => {
    for (const [name, c] of Object.entries(MOCK_MAIL_CHECKS)) {
      assert.ok(c.message.length > 0 && c.message.endsWith("."), name);
      if (!c.ok) assert.match(c.code ?? "", /^[A-Z_]+$/, name);
      assertNoSecrets(c);
    }
  });

  test("a service that only sends: reading answers SEND_ONLY", async () => {
    const api = fresh();
    const saved = await save(api, { "email.provider": "brevo", "email.from_address": "stay@hotelsunriserajkot.in", "email.imap": true });
    assert.ok(saved.ok);
    const r = await api.startMailConnectionTest();
    assert.ok(r.ok);
    assert.deepEqual(r.data.imap, { ...MOCK_MAIL_CHECKS.sendOnly });
  });

  test("the platform's mail has no mailbox of the hotel's: a plain conflict", async () => {
    const api = fresh();
    assert.ok((await save(api, { "email.mode": "platform" })).ok);
    const r = await api.startMailConnectionTest();
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "CONFLICT");
  });

  test("only the hotel's Super Admin", async () => {
    const api = fresh();
    api.setActor({ superAdmin: false, username: "neha", name: "Neha", role: "hotel_user" });
    const r = await api.startMailConnectionTest();
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "FORBIDDEN");
  });
});

describe("saving the reading fields", () => {
  test("another SMTP server with reading on needs a public IMAP server name", async () => {
    const api = fresh();
    const base = { "email.provider": "smtp", "email.host": "smtp.hotelsunrise.in", "email.port": "587", "email.from_address": "stay@hotelsunrise.in", "email.imap": true };
    const bad = await save(api, { ...base, "email.imap_host": "127.0.0.1" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.details?.fields?.["email.imap_host"], mailProviderCopy.reading.errors.imapHost);
    const good = await save(api, { ...base, "email.imap_host": "IMAP.HotelSunrise.in", "email.imap_port": "143" });
    assert.ok(good.ok);
    const v = await emailValues(api);
    assert.equal(v["email.imap"], true);
    assert.equal(v["email.imap_host"], "imap.hotelsunrise.in");
    assert.equal(v["email.imap_port"], "143");
  });

  test("Gmail keeps reading but forgets a typed IMAP server; a port other than 993 or 143 falls back to 993", async () => {
    const api = fresh();
    assert.ok((await save(api, { "email.provider": "gmail", "email.imap": true, "email.imap_host": "imap.elsewhere.in", "email.imap_port": "25" })).ok);
    const v = await emailValues(api);
    assert.equal(v["email.imap"], true);
    assert.equal(v["email.imap_host"], "");
    assert.equal(v["email.imap_port"], "993");
  });

  test("a service that only sends, and the platform's mail, switch reading off", async () => {
    const patches: Record<string, string>[] = [{ "email.provider": "ses", "email.from_address": "stay@hotelsunrise.in" }, { "email.mode": "platform" }];
    for (const patch of patches) {
      const api = fresh();
      assert.ok((await save(api, { ...patch, "email.imap": true })).ok);
      assert.equal((await emailValues(api))["email.imap"], false);
    }
  });
});
