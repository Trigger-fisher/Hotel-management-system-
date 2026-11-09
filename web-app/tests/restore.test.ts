// Restoring a signed-in person after a page reload: a live session gives the user back; anything else means sign in.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";

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

const { restoreSession } = await import("../src/lib/auth/restore");
const session = { user: { id: "u1", displayName: "A" }, client: "web", expiresAt: "2026-10-12T00:00:00Z", token: null } as never;
const err = (code: string) => ({ ok: false as const, error: { code, message: code, traceId: "t" } }) as never;

test("a live session cookie gives the signed-in session back", async () => {
  assert.equal(await restoreSession({ getSession: async () => ({ ok: true, data: session }) }), session);
});

test("no cookie or an expired one (401) means sign in", async () => {
  assert.equal(await restoreSession({ getSession: async () => err("SESSION_EXPIRED") }), null);
});

const quick = { sleep: async () => undefined };

test("a network failure or an exception is tried again, and after the last try means sign in, never a crash", async () => {
  let calls = 0;
  assert.equal(await restoreSession({ getSession: async () => (calls++, err("NETWORK_OFFLINE")) }, quick), null);
  assert.equal(calls, 5);
  assert.equal(await restoreSession({ getSession: async () => { throw new Error("boom"); } }, quick), null);
});

test("a server that is still waking up (cold start) is asked again and the session comes back", async () => {
  let calls = 0;
  const api = { getSession: async () => (++calls < 3 ? err("SERVER_ERROR") : { ok: true as const, data: session }) };
  assert.equal(await restoreSession(api, quick), session);
  assert.equal(calls, 3);
});

test("a 401 (session over) is not asked again", async () => {
  let calls = 0;
  assert.equal(await restoreSession({ getSession: async () => (calls++, err("SESSION_REVOKED")) }, quick), null);
  assert.equal(calls, 1);
});

test("restoreOutcome tells a session, a session that is over and a server that stayed unreachable apart", async () => {
  const { restoreOutcome } = await import("../src/lib/auth/restore");
  assert.deepEqual(await restoreOutcome({ getSession: async () => ({ ok: true, data: session }) }, quick), { kind: "session", session });
  assert.deepEqual(await restoreOutcome({ getSession: async () => err("SESSION_EXPIRED") }, quick), { kind: "over", code: "SESSION_EXPIRED" });
  // the reason travels with it, so the page can say "signed in on another device"
  assert.deepEqual(await restoreOutcome({ getSession: async () => err("SESSION_REPLACED") }, quick), { kind: "over", code: "SESSION_REPLACED" });
  let calls = 0;
  assert.deepEqual(await restoreOutcome({ getSession: async () => (calls++, err("SERVER_ERROR")) }, quick), { kind: "unreachable" });
  assert.equal(calls, 5);
  assert.deepEqual(await restoreOutcome({ getSession: async () => { throw new Error("down"); } }, quick), { kind: "unreachable" });
});
