// The Turnstile security check on the public sign-in routes: dormant without a secret, fail-closed with one.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { resetConfigCache } from "../../src/server/config/env";
import { assertHuman } from "../../src/server/http/turnstile";

const SECRET = "0x4AAAAAAAtestSecretKey0000000000";
const SITE = "0x4AAAAAAAtestSiteKey";
const on = (): void => {
  process.env.TURNSTILE_SECRET_KEY = SECRET;
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = SITE;
  resetConfigCache();
};
afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  resetConfigCache();
});

const req = (token?: string): Request => new Request("http://localhost/api/v1/auth/sign-in", { method: "POST", headers: token ? { "x-turnstile-token": token } : {} });
const answer = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const refused = (e: unknown): boolean => (e as { code?: string; details?: { fields?: { captcha?: string } } }).code === "VALIDATION_FAILED" && Boolean((e as { details?: { fields?: { captcha?: string } } }).details?.fields?.captcha);

describe("assertHuman", () => {
  test("no secret key: nothing is checked", async () => {
    await assertHuman(req());
  });

  test("a secret key and no token: refused with fields.captcha, Cloudflare is not asked", async () => {
    on();
    let asked = false;
    await assert.rejects(assertHuman(req(), (async () => { asked = true; return new Response("{}"); }) as typeof fetch), refused);
    assert.equal(asked, false);
  });

  test("a good token passes, and the secret and token go to siteverify as a form", async () => {
    on();
    let sent = "";
    await assertHuman(req("tok"), (async (_url: unknown, init?: RequestInit) => { sent = String(init?.body); return new Response(JSON.stringify({ success: true })); }) as typeof fetch);
    assert.match(sent, /secret=/);
    assert.match(sent, /response=tok/);
  });

  test("a refused token, a bad answer and an unreachable Cloudflare all refuse", async () => {
    on();
    await assert.rejects(assertHuman(req("tok"), answer({ success: false, "error-codes": ["invalid-input-response"] })), refused);
    await assert.rejects(assertHuman(req("tok"), answer({ success: true }, 500)), refused);
    await assert.rejects(assertHuman(req("tok"), (async () => { throw new Error("down"); }) as typeof fetch), refused);
  });
});
