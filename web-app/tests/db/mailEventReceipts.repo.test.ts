// The mail-events webhooks' receipts on the REAL PostgreSQL instance, as hms_app (platform migration 0136; security review round 2, M2): a key is new once, a repeat (also two
// deliveries at the same moment) is not, the two services keep separate receipts, receipts older than seven days are removed, and the table's own CHECKs hold.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import type { AuthRepos, PlatformUnit } from "../../src/server/repos/auth";
import { createPgPlatformUnit } from "../../src/server/repos/postgres/auth";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let platform: PlatformUnit;
const run = <T>(work: (r: AuthRepos) => Promise<T>): Promise<T> => platform.run(work);
const key = (): string => createHash("sha256").update(randomUUID()).digest("hex");
const made: string[] = [];

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  platform = createPgPlatformUnit(pool);
});

after(async () => {
  await owner?.query("DELETE FROM platform.mail_event_receipts WHERE event_key = ANY($1::text[])", [made]).catch(() => undefined);
  await pool?.end();
  await owner?.end();
  await releaseTestLock?.();
});

describe("platform.mail_event_receipts (0136)", () => {
  test("a key is new once; a repeat is not; the other service keeps its own receipts; a list that repeats a key counts it once", async () => {
    const [a, b] = [key(), key()];
    made.push(a, b);
    const now = new Date();
    assert.deepEqual([...(await run((r) => r.mailSafety.receive("ses", [a, b, a], now)))].sort(), [a, b].sort());
    assert.deepEqual([...(await run((r) => r.mailSafety.receive("ses", [a], now)))], [], "SNS delivered it again");
    assert.deepEqual([...(await run((r) => r.mailSafety.receive("brevo", [a], now)))], [a], "Brevo's receipts are its own");
  });

  test("two deliveries of one key at the same moment: exactly one of them is new", async () => {
    const k = key();
    made.push(k);
    const now = new Date();
    const [x, y] = await Promise.all([run((r) => r.mailSafety.receive("ses", [k], now)), run((r) => r.mailSafety.receive("ses", [k], now))]);
    assert.equal(x.size + y.size, 1);
  });

  test("receipts older than seven days are removed on the way, so that key is new again", async () => {
    const k = key();
    made.push(k);
    await owner.query("INSERT INTO platform.mail_event_receipts (provider, event_key, received_at) VALUES ('ses', $1, now() - interval '8 days')", [k]);
    assert.deepEqual([...(await run((r) => r.mailSafety.receive("ses", [k], new Date())))], [k]);
    const left = await owner.query("SELECT count(*)::int AS n FROM platform.mail_event_receipts WHERE received_at < now() - interval '7 days'");
    assert.equal(left.rows[0].n, 0);
  });

  test("the table's CHECKs: only the two services, only a 64-hex key; hms_app cannot change a receipt", async () => {
    const app = await pool.connect();
    try {
      assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.mail_event_receipts (provider, event_key) VALUES ('gmail', $1)", [key()])), null);
      assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.mail_event_receipts (provider, event_key) VALUES ('ses', 'not-a-hash')")), null);
      assert.equal(await sqlStateOf(app.query("UPDATE platform.mail_event_receipts SET received_at = now() WHERE false")), "42501", "no UPDATE grant");
    } finally {
      app.release();
    }
  });
});
