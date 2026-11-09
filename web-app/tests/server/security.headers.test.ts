// Security by default: the headers every response carries, the session cookie's flags, and that every public route that can be hammered has a rate limit.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { clearedSessionCookie, sessionCookie } from "../../src/server/auth/tokens";
import { bucketOrigin, contentSecurityPolicy, securityHeaders } from "../../security-headers";

const root = path.join(process.cwd(), "src", "app", "api", "v1");
const map = (production: boolean): Record<string, string> => Object.fromEntries(securityHeaders(production).map((h) => [h.key, h.value]));

describe("security headers", () => {
  test("production: HSTS for two years, a content policy that allows only this site and refuses framing, plug-ins and eval, and the always-on headers", () => {
    const h = map(true);
    assert.equal(h["Strict-Transport-Security"], "max-age=15552000");
    const csp = h["Content-Security-Policy"];
    for (const part of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'", "upgrade-insecure-requests"]) assert.ok(csp.includes(part), part);
    assert.ok(!csp.includes("unsafe-eval") && !/\*/.test(csp), "no eval, no wildcard");
    assert.deepEqual([...new Set(csp.match(/https?:\/\/[^\s;]+/g))], ["https://challenges.cloudflare.com"], "the only other site is the Turnstile security check");
    assert.equal(csp, contentSecurityPolicy());
    assert.deepEqual([h["X-Content-Type-Options"], h["X-Frame-Options"], h["Referrer-Policy"], h["Cross-Origin-Opener-Policy"]], ["nosniff", "DENY", "no-referrer", "same-origin"]);
    assert.match(h["Permissions-Policy"], /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });

  test("a server that keeps files in a bucket lets the browser send to that one address (the files of an email) and to nothing else", () => {
    const s3 = { MEDIA_DRIVER: "s3", S3_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3" };
    assert.equal(bucketOrigin(s3), "https://abcd.storage.supabase.co");
    const csp = contentSecurityPolicy(s3);
    assert.ok(csp.includes("connect-src 'self' https://challenges.cloudflare.com https://abcd.storage.supabase.co;"), csp);
    assert.deepEqual([...new Set(csp.match(/https?:\/\/[^\s;]+/g))].sort(), ["https://abcd.storage.supabase.co", "https://challenges.cloudflare.com"], "only the bucket and the Turnstile security check");
    assert.ok(!/\*|unsafe-eval/.test(csp));
    // no bucket, a local disk or the database for photos, or a plain-http endpoint: the policy stays closed
    for (const env of [{}, { MEDIA_DRIVER: "local", S3_ENDPOINT: s3.S3_ENDPOINT }, { MEDIA_DRIVER: "db" }, { MEDIA_DRIVER: "s3" }, { MEDIA_DRIVER: "s3", S3_ENDPOINT: "http://127.0.0.1:9000" }]) assert.ok(contentSecurityPolicy(env).includes("connect-src 'self' https://challenges.cloudflare.com;"), JSON.stringify(env));
  });

  test("development has neither HSTS nor the content policy (plain http and hot reload), but keeps the rest", () => {
    const h = map(false);
    assert.equal(h["Strict-Transport-Security"], undefined);
    assert.equal(h["Content-Security-Policy"], undefined);
    assert.equal(h["X-Frame-Options"], "DENY");
  });

  test("next.config.ts applies them to every path", () => {
    const text = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    assert.match(text, /securityHeaders\(process\.env\.NODE_ENV === "production"\)/);
    assert.match(text, /source: "\/:path\*"/);
  });
});

describe("the session cookie", () => {
  test("host-locked, httpOnly, secure, same-site Lax, whole site; signing out clears it with Max-Age=0", () => {
    assert.equal(sessionCookie("t".repeat(43)), `__Host-hms_session=${"t".repeat(43)}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    assert.match(clearedSessionCookie(), /^__Host-hms_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
  });
});

describe("rate limits on public routes", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") files.push(path.join(dir, e.name));
    }
  };
  walk(root);

  test("every public route except the bare liveness check declares a limit by address", () => {
    let seen = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const part of text.split(/export const (?=(?:GET|POST|PUT|PATCH|DELETE) = )/).slice(1)) {
        if (!/^(GET|POST|PUT|PATCH|DELETE) = publicRoute[<(]/.test(part)) continue;
        seen += 1;
        const rel = path.relative(root, file).replace(/\\/g, "/");
        if (rel === "health/route.ts") continue;
        assert.match(part, /limits:\s*\[/, `${rel} is public and has no rate limit`);
        assert.match(part, /by:\s*"ip"/, `${rel} limits by address`);
      }
    }
    assert.ok(seen >= 11, `${seen} public handlers found`);
  });
});
