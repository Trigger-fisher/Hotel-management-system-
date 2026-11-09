// The DEV-ONLY relaxation of the sign-in throttles (http/limits.ts effectiveMax): it needs development AND HMS_DEV_RELAX_LIMITS=1 AND a sign-in throttle
// AND this PC as the caller. Everything else keeps the route's own max (fail closed): production, test builds, another flag value, another address.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEV_RELAXED_MAX, effectiveMax, type RateLimit } from "../../src/server/http/limits";

const loginIp: RateLimit = { name: "login-ip", max: 20, windowSeconds: 900, by: "ip" };
const login: RateLimit = { name: "login", max: 30, windowSeconds: 60, by: "ip" };
const resend: RateLimit = { name: "resend", max: 6, windowSeconds: 60, by: "ip" };
const DEV = { NODE_ENV: "development", HMS_DEV_RELAX_LIMITS: "1" };

describe("effectiveMax", () => {
  test("development + the flag + this PC relaxes the sign-in throttles to 200", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "unknown"]) {
      assert.equal(effectiveMax(loginIp, ip, DEV), DEV_RELAXED_MAX, ip);
      assert.equal(effectiveMax(login, ip, DEV), DEV_RELAXED_MAX, ip);
    }
    assert.equal(DEV_RELAXED_MAX, 200);
  });

  test("production, test builds, no flag or another flag value keep the route's own max", () => {
    for (const env of [
      { NODE_ENV: "production", HMS_DEV_RELAX_LIMITS: "1" }, { NODE_ENV: "test", HMS_DEV_RELAX_LIMITS: "1" }, { HMS_DEV_RELAX_LIMITS: "1" },
      { NODE_ENV: "development" }, { NODE_ENV: "development", HMS_DEV_RELAX_LIMITS: "0" }, { NODE_ENV: "development", HMS_DEV_RELAX_LIMITS: "true" }, { NODE_ENV: "development", HMS_DEV_RELAX_LIMITS: "" },
    ]) {
      assert.equal(effectiveMax(loginIp, "127.0.0.1", env), 20, JSON.stringify(env));
    }
  });

  test("another address, a throttle that is not sign-in, or one counted per user is untouched", () => {
    assert.equal(effectiveMax(loginIp, "203.0.113.9", DEV), 20);
    assert.equal(effectiveMax(loginIp, "10.0.0.5", DEV), 20);
    assert.equal(effectiveMax(resend, "127.0.0.1", DEV), 6);
    assert.equal(effectiveMax({ ...loginIp, by: "user" }, "127.0.0.1", DEV), 20);
  });

  test("a route that already allows more than 200 is never tightened", () => {
    assert.equal(effectiveMax({ ...loginIp, max: 500 }, "127.0.0.1", DEV), 500);
  });

  test("the real environment is used when none is passed (a test run is NODE_ENV=test: no relaxation)", () => {
    assert.equal(effectiveMax(loginIp, "127.0.0.1"), 20);
  });
});
