import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { ConfigError, isDatabaseConfigured, loadConfig } from "../../src/server/config/env";

describe("loadConfig", () => {
  test("an empty environment is valid: defaults apply and the database is not configured", () => {
    const config = loadConfig({});
    assert.equal(config.NODE_ENV, "development");
    assert.equal(config.LOG_LEVEL, "info");
    assert.equal(config.DB_POOL_MAX, 20);
    assert.equal(config.DATABASE_URL, undefined);
    assert.equal(config.HMS_HASH_KEY, undefined);
    assert.equal(isDatabaseConfigured(config), false);
  });

  test("reads and coerces valid values; blank values count as unset", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      DATABASE_URL: "postgresql://hms_app:pw@127.0.0.1:5433/hms",
      DB_POOL_MAX: "30",
      HMS_HASH_KEY: "   ",
    }, { build: true });
    assert.equal(config.NODE_ENV, "production");
    assert.equal(config.DB_POOL_MAX, 30);
    assert.equal(config.HMS_HASH_KEY, undefined);
    assert.equal(isDatabaseConfigured(config), true);
    assert.equal(loadConfig({ DATABASE_URL: "postgres://hms_app:pw@127.0.0.1:5433/hms" }).DATABASE_URL !== undefined, true);
  });

  test("fails fast, naming each wrong variable", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "staging", LOG_LEVEL: "loud", DB_POOL_MAX: "0", DATABASE_URL: "mysql://x" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        const names = error.problems.map((p) => p.split(":")[0]).sort();
        assert.deepEqual(names, ["DATABASE_URL", "DB_POOL_MAX", "LOG_LEVEL", "NODE_ENV"]);
        return true;
      },
    );
    assert.throws(() => loadConfig({ DB_POOL_MAX: "abc" }), ConfigError);
    assert.throws(() => loadConfig({ DB_POOL_MAX: "2.5" }), ConfigError);
    assert.throws(() => loadConfig({ DB_POOL_MAX: "101" }), ConfigError);
  });

  test("a message never contains a value", () => {
    const secret = "mysql://admin:SuperSecretPw1@db.example.com/prod";
    try {
      loadConfig({ DATABASE_URL: secret, DB_POOL_MAX: "not-a-number-xyz", LOG_LEVEL: "verySecretLevel" });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      const text = `${error.message} ${error.problems.join(" ")}`;
      for (const value of [secret, "SuperSecretPw1", "not-a-number-xyz", "verySecretLevel"]) assert.ok(!text.includes(value), `leaked ${value}`);
    }
  });

  test("the superuser and owner URLs are not part of the app config, and production refuses to start with one in its environment", () => {
    const config = loadConfig({ PGSUPERUSER_URL: "postgresql://postgres:pw@127.0.0.1:5433/postgres", PG_OWNER_URL: "postgresql://hms_owner:pw@127.0.0.1:5433/hms" });
    assert.ok(!("PGSUPERUSER_URL" in config) && !("PG_OWNER_URL" in config));
    for (const name of ["PGSUPERUSER_URL", "PG_OWNER_URL", "PG_TEST_OWNER_URL"]) {
      assert.throws(
        () => loadConfig({ NODE_ENV: "production", [name]: "postgresql://x:y@127.0.0.1:5433/hms" }),
        (error: unknown) => error instanceof ConfigError && error.problems.length === 1 && error.problems[0].startsWith(name) && !error.message.includes("x:y"),
      );
    }
  });

  test("HMS_HASH_KEY is base64 of at least 32 bytes, optional, and a bad one is named without its value", () => {
    assert.equal(loadConfig({}).HMS_HASH_KEY, undefined);
    assert.ok(loadConfig({ HMS_HASH_KEY: randomBytes(32).toString("base64") }).HMS_HASH_KEY);
    assert.throws(() => loadConfig({ HMS_HASH_KEY: "short" }), (e: unknown) => e instanceof ConfigError && e.problems[0].startsWith("HMS_HASH_KEY") && !e.message.includes("short"));
  });

  test("the removed variables are no longer part of the config", () => {
    const config = loadConfig({ HMS_DATA_KEYS: "k1:abc", HMS_BLIND_INDEX_KEY: "abc", HMS_TENANT_KEY: "abc" });
    for (const name of ["HMS_DATA_KEYS", "HMS_BLIND_INDEX_KEY", "HMS_TENANT_KEY"]) assert.ok(!(name in config), name);
  });
});
