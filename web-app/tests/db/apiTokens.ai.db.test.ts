// The AI key level on the REAL PostgreSQL (platform 0187), throwaway hms_test only: an 'ai' key is made for the console and every hotel with a reason, may live up to ten years and run 10 to 3000
// calls a minute, and needs no address list; the other levels keep their old limits (read: 30 days and 60 a minute; full: 24 hours and an address list). Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createUser } from "../../../common/db/scripts/create-user";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let creator = "";
let n = 0;
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

/** Makes one key row with the given choices; resolves with the SQLSTATE of a refusal, or "ok". */
async function make(level: string, o: { scope?: string; reason?: string | null; days?: number; calls?: number; ips?: string[]; hotel?: string | null } = {}): Promise<string> {
  n += 1;
  const hash = n.toString(16).padStart(64, "0");
  const prefix = `hms_pat_${String(n).padStart(4, "0")}`;
  try {
    await q(
      `INSERT INTO platform.api_tokens (name, token_hash, token_prefix, level, scope_kind, hotel_id, ip_allow, reason, calls_per_minute, created_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, now(), now() + ($11 || ' days')::interval)`,
      [`key ${n}`, hash, prefix, level, o.scope ?? "all", o.hotel ?? null, o.ips ?? [], o.reason === undefined ? "for tests" : o.reason, o.calls ?? 60, creator, String(o.days ?? 1)],
    );
    return "ok";
  } catch (e) {
    return String((e as { code?: string }).code ?? "error");
  }
}

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await q("DELETE FROM platform.api_tokens");
  // keys belong to a login (platform.users was retired by migration 0155): a throwaway Super Admin made the way the setup tool makes one
  await q("DELETE FROM platform.logins WHERE id IN (SELECT id FROM platform.people WHERE username = 'ai.key.tester')").catch(() => undefined);
  creator = await createUser(owner, { username: "ai.key.tester", displayName: "AI Key Tester", email: "ai.key.tester@example.test", accountRole: "super_admin", roleKey: "super_admin" }, "$argon2id$v=19$m=1024,t=1,p=1$c29tZXNhbHRzb21l$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g");
});
after(async () => {
  if (owner) {
    await q("DELETE FROM platform.api_tokens").catch(() => undefined);
    await q("DELETE FROM platform.logins WHERE id = $1", [creator]).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

describe("API key levels on PostgreSQL (platform 0187)", () => {
  test("an AI key: every hotel in reach, a reason, up to ten years, 10 to 3000 calls a minute, no address list needed", async () => {
    assert.equal(await make("ai", { days: 3650, calls: 600 }), "ok");
    assert.equal(await make("ai", { days: 1, calls: 10 }), "ok");
    assert.equal(await make("ai", { days: 1, calls: 3000, ips: ["203.0.113.7"] }), "ok");
  });

  test("an AI key is refused without a reason, for one scope only, beyond ten years, or outside 10 to 3000 calls a minute", async () => {
    assert.equal(await make("ai", { reason: null }), "23514", "a reason is required");
    assert.equal(await make("ai", { scope: "platform" }), "23514", "scope all only");
    assert.equal(await make("ai", { days: 3700 }), "23514", "at most ten years");
    assert.equal(await make("ai", { calls: 5 }), "23514", "at least 10 a minute");
    assert.equal(await make("ai", { calls: 3500 }), "23514", "at most 3000 a minute");
  });

  test("the other levels keep their limits: read 30 days and exactly 60 a minute; full 24 hours and an address list", async () => {
    assert.equal(await make("read", { scope: "platform", days: 30, calls: 60 }), "ok");
    assert.equal(await make("read", { scope: "platform", days: 31, calls: 60 }), "23514", "read: at most 30 days");
    assert.equal(await make("read", { scope: "platform", days: 1, calls: 600 }), "23514", "read: exactly 60 a minute");
    assert.equal(await make("full", { days: 1, calls: 600, ips: [] }), "23514", "full: an address list");
    assert.equal(await make("full", { days: 2, calls: 600, ips: ["203.0.113.7"] }), "23514", "full: at most 24 hours");
    assert.equal(await make("full", { days: 1, calls: 600, ips: ["203.0.113.7"] }), "ok");
    assert.equal(await make("sneaky"), "23514", "an unknown level");
  });
});
