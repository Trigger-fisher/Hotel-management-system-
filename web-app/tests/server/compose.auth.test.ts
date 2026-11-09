// The composition root of sign-in (compose/auth.ts): ONE session resolver per process, the same object before and after the login service is built, so every
// route and the shell seed share one session cache and one set of in-flight reads. Without a database (the in-memory doubles).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

describe("the session resolver is a process singleton", () => {
  test("getSessionResolver() is the same object every time, and getAuthService() reuses it instead of making a second one", async () => {
    delete process.env.DATABASE_URL;
    process.env.HMS_HASH_KEY ??= randomBytes(32).toString("base64");
    const { configureAuth, getAuthService, getSessionResolver } = await import("../../src/server/compose/auth");
    configureAuth(null);
    const first = getSessionResolver();
    assert.equal(getSessionResolver(), first);
    getAuthService();
    assert.equal(getSessionResolver(), first, "the login service did not replace the resolver");
    configureAuth(null);
  });
});
