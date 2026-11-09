// The vault's "Confirm it is you" calls (MJ, 5 Nov 2026): a wrong password or code is a 401 from the server, and it must stay a message in the dialog,
// never the "your session has ended" sign-out. Run with `npx tsx --test tests/recheckClient.test.ts`.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const realFetch = globalThis.fetch;
const sent: { url: string; headers: Record<string, string> }[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  sent.length = 0;
});

function answer(status: number, code: string) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ error: { code, message: code, traceId: "t" } }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("a wrong re-check password or code does not sign the person out, and the dialog still knows which it was", async () => {
  process.env.NEXT_PUBLIC_API = "real";
  const { recheckApi } = await import("../src/dashboards/groups/platform/recheckApi");
  const { onSessionEnded } = await import("../src/lib/api/sessionEvents");
  const ended: string[] = [];
  const off = onSessionEnded((c) => ended.push(c));
  answer(401, "INVALID_CREDENTIALS");
  const pw = await recheckApi.password("Wrong#Pass1");
  answer(401, "INVALID_CODE");
  const code = await recheckApi.code("00000000-0000-4000-8000-000000000000", "000000");
  off();
  assert.deepEqual(ended, []);
  assert.ok(!pw.ok && pw.error.details?.serverCode === "INVALID_CREDENTIALS");
  assert.ok(!code.ok && code.error.details?.serverCode === "INVALID_CODE");
  assert.deepEqual(sent.map((s) => s.url), ["/api/v1/auth/recheck", "/api/v1/auth/recheck/code/verify"]);
  assert.ok(sent.every((s) => s.headers["Idempotency-Key"] === undefined), "the auth routes take no idempotency key");
});
