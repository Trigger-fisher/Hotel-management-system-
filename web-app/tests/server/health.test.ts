import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { GET } from "../../src/app/api/v1/health/route";
import { GET as READY } from "../../src/app/api/v1/health/ready/route";
import { resetConfigCache } from "../../src/server/config/env";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetConfigCache();
});

describe("GET /api/v1/health (public: reveals nothing)", () => {
  test("is exactly { data: { status: 'ok' } } with a trace id", async () => {
    const res = await GET(new Request("http://localhost/api/v1/health"));
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("x-trace-id"));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { data: { status: "ok" } });
  });

  test("echoes a valid incoming trace id", async () => {
    const res = await GET(new Request("http://localhost/api/v1/health", { headers: { "x-trace-id": "caller-trace-123" } }));
    assert.equal(res.headers.get("x-trace-id"), "caller-trace-123");
  });

  test("answers the same whatever the environment is: no uptime, time, database or configuration state", async () => {
    process.env.DB_POOL_MAX = "not-a-number-xyz";
    process.env.DATABASE_URL = "postgresql://hms_app:topsecret@127.0.0.1:5433/hms";
    resetConfigCache();
    const res = await GET(new Request("http://localhost/api/v1/health"));
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { data: { status: "ok" } });
    for (const leak of ["topsecret", "hms_app", "DB_POOL_MAX", "uptime", "time", "db", "config"]) assert.ok(!text.toLowerCase().includes(leak.toLowerCase().replace("time", "timestamp")), leak);
  });
});

describe("GET /api/v1/health/ready (details; will require a platform administrator)", () => {
  test("reports ready, uptime, time and that the database is not configured yet, inside the data envelope", async () => {
    delete process.env.DATABASE_URL;
    resetConfigCache();
    const res = await READY(new Request("http://localhost/api/v1/health/ready"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    assert.equal(body.data.status, "ready");
    assert.equal(body.data.db, "not configured");
    assert.equal(typeof body.data.uptimeSeconds, "number");
    assert.ok(!Number.isNaN(Date.parse(String(body.data.time))));
  });

  test("a broken environment answers 503 and names nothing", async () => {
    process.env.LOG_LEVEL = "silent";
    process.env.DB_POOL_MAX = "not-a-number-xyz";
    resetConfigCache();
    const res = await READY(new Request("http://localhost/api/v1/health/ready"));
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.ok(!text.includes("DB_POOL_MAX") && !text.includes("not-a-number-xyz"));
    assert.equal((JSON.parse(text) as { data: { status: string } }).data.status, "unhealthy");
  });

  test("exposes no secret: a database that does not answer is reported as down (503), and nothing of the connection string appears", async () => {
    process.env.DATABASE_URL = "postgresql://hms_app:topsecret@127.0.0.1:1/hms";
    resetConfigCache();
    const res = await READY(new Request("http://localhost/api/v1/health/ready"));
    const text = await res.text();
    assert.ok(!text.includes("topsecret") && !text.includes("hms_app") && !text.includes("127.0.0.1"));
    assert.deepEqual([res.status, (JSON.parse(text) as { data: { status: string; db: string } }).data], [503, { status: "unhealthy", db: "down" }]);
  });
});
