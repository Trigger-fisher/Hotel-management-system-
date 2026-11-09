// Pool settings: small and self-cleaning outside production (so several dev servers and hot reloads cannot use up the local PostgreSQL), the
// environment always wins, and production keeps the app defaults.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pgOptionsFromUrl } from "../../../common/db/scripts/pg-db";
import { poolSettingsFor } from "../../src/db";

const defaults = { DB_POOL_MAX: 20, DB_POOL_MIN: 4, DB_POOL_IDLE_SECONDS: 600 };

describe("poolSettingsFor", () => {
  test("outside production: 5 connections, none kept open, idle closed after 30 s", () => {
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "development" }, defaults), { max: 5, min: 0, idleSeconds: 30 });
    assert.deepEqual(poolSettingsFor({}, defaults), { max: 5, min: 0, idleSeconds: 30 });
  });

  test("in production the app defaults stay", () => {
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "production" }, defaults), { max: 20, min: 4, idleSeconds: 600 });
  });

  test("a value set in the environment always wins, in development too", () => {
    const set = { DB_POOL_MAX: "12", DB_POOL_MIN: "2", DB_POOL_IDLE_SECONDS: "90" };
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "development", ...set }, { DB_POOL_MAX: 12, DB_POOL_MIN: 2, DB_POOL_IDLE_SECONDS: 90 }), { max: 12, min: 2, idleSeconds: 90 });
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "development", DB_POOL_MAX: "3" }, { ...defaults, DB_POOL_MAX: 3 }), { max: 3, min: 0, idleSeconds: 30 });
    // a serverless host (Vercel): a small pool per function instance, an idle connection closed after 300 s and none kept for ever (min 0: pg-pool gives a
    // connection at or below `min` no idle timer, so a kept one could come back dead after the instance was suspended), unless the environment says otherwise
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "production", VERCEL: "1" }, defaults), { max: 3, min: 0, idleSeconds: 300 });
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "production", VERCEL: "1", DB_POOL_MAX: "8" }, { ...defaults, DB_POOL_MAX: 8 }), { max: 8, min: 0, idleSeconds: 300 });
    // the environment still wins over the serverless defaults (a project that set DB_POOL_MIN=1 / DB_POOL_IDLE_SECONDS=10 keeps them until it changes them)
    assert.deepEqual(poolSettingsFor({ NODE_ENV: "production", VERCEL: "1", DB_POOL_MIN: "1", DB_POOL_IDLE_SECONDS: "10" }, { ...defaults, DB_POOL_MIN: 1, DB_POOL_IDLE_SECONDS: 10 }), { max: 3, min: 1, idleSeconds: 10 });
  });
});

describe("pgOptionsFromUrl (Neon over TLS)", () => {
  test("sslmode=require|verify-ca|verify-full in the URL turns TLS on (verified); without it nothing changes", () => {
    for (const mode of ["require", "verify-ca", "verify-full"]) assert.equal(pgOptionsFromUrl(`postgres://u:p@h.example/db?sslmode=${mode}`).ssl, true, mode);
    assert.equal("ssl" in pgOptionsFromUrl("postgres://u:p@127.0.0.1:5433/db"), false);
    assert.equal("ssl" in pgOptionsFromUrl("postgres://u:p@127.0.0.1:5433/db?sslmode=disable"), false);
  });
});