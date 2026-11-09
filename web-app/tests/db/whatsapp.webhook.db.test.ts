// Meta's WhatsApp address check on the REAL PostgreSQL (throwaway hms_test only), through the real route. The live site answered it 422 because the route accepted exactly three query fields, so Meta could
// never save the webhook. The check must answer the challenge as plain text even when the call carries other fields, and refuse a wrong token. Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { GET } from "../../src/app/api/v1/whatsapp/webhook/route";
import { appUrl, lockTestDatabase } from "./helpers/realDb";

const KEYS = ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "HMS_HASH_KEY", "DATABASE_URL"] as const;
const saved: Record<string, string | undefined> = {};
let release: (() => Promise<void>) | undefined;
const call = (query: string): Promise<Response> => GET(new Request(`https://hms.test/api/v1/whatsapp/webhook?${query}`, { headers: { "user-agent": "facebookexternalua", "x-forwarded-for": "203.0.113.9" } }) as never, { params: Promise.resolve({}) } as never);

before(async () => {
  release = await lockTestDatabase();
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token-123";
  process.env.HMS_HASH_KEY = randomBytes(32).toString("base64");
  process.env.DATABASE_URL = appUrl();
});
after(async () => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await release?.();
});

describe("the WhatsApp webhook address check", () => {
  test("the right token answers the challenge as plain text, with or without extra query fields", async () => {
    const plain = await call("hub.mode=subscribe&hub.challenge=1158021550&hub.verify_token=test-verify-token-123");
    assert.equal(plain.status, 200);
    assert.equal(await plain.text(), "1158021550");
    const extra = await call("hub.mode=subscribe&hub.challenge=777&hub.verify_token=test-verify-token-123&something=else&fbclid=abc");
    assert.equal(extra.status, 200);
    assert.equal(await extra.text(), "777");
    assert.match(extra.headers.get("content-type") ?? "", /^text\/plain/);
  });

  test("a wrong token is refused", async () => {
    const r = await call("hub.mode=subscribe&hub.challenge=1&hub.verify_token=nope&extra=1");
    assert.equal(r.status, 403);
  });
});
