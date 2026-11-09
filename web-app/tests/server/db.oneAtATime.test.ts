// One connection runs one query at a time: overlapping calls on a pooled client wait for each other (pg 8 warned "client.query() when the client is already executing a query").
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/db.oneAtATime.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { oneAtATime } from "../../src/db/pool";

function fakeClient() {
  const log: string[] = [];
  let running = 0;
  let overlap = 0;
  return {
    log,
    get overlap() {
      return overlap;
    },
    async query(text: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
      running += 1;
      if (running > 1) overlap += 1;
      log.push(`start ${text}`);
      await new Promise((r) => setTimeout(r, text === "slow" ? 20 : 1));
      log.push(`end ${text}`);
      running -= 1;
      if (text === "bad") throw new Error("failed");
      return { rows: [{ q: text }], rowCount: 1 };
    },
  };
}

describe("oneAtATime", () => {
  test("queries started together run one after the other, in order, with their own results", async () => {
    const c = oneAtATime(fakeClient());
    const [a, b, d] = await Promise.all([c.query("slow"), c.query("b"), c.query("c")]);
    assert.deepEqual([a.rows[0]?.q, b.rows[0]?.q, d.rows[0]?.q], ["slow", "b", "c"]);
    assert.equal(c.overlap, 0);
    assert.deepEqual(c.log, ["start slow", "end slow", "start b", "end b", "start c", "end c"]);
  });

  test("a failed query rejects its own caller only; the ones behind it still run", async () => {
    const c = oneAtATime(fakeClient());
    const results = await Promise.allSettled([c.query("bad"), c.query("next")]);
    assert.equal(results[0]?.status, "rejected");
    assert.equal(results[1]?.status, "fulfilled");
    assert.equal(c.overlap, 0);
  });
});
