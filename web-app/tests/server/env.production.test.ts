// The production boot check (src/server/config/env.ts): with NODE_ENV=production the app refuses to start unless everything it needs is set and no development
// switch is on. A message names the variable and never a value. The local demo build (no database) is the one allowed exception, and a database behind it is refused.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { ConfigError, loadConfig } from "../../src/server/config/env";

const KEY = randomBytes(32).toString("base64");
const SECRET = randomBytes(32).toString("base64");
const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://hms_app:Sup3rSecretValue@db.example.in:5432/hms",
  HMS_HASH_KEY: KEY,
  HMS_SECRET_KEY: SECRET,
  HMS_PUBLIC_URL: "https://hms.example.in",
  MAIL_DRIVER: "smtp",
  SMTP_HOST: "smtp.example.in",
  SMTP_FROM: "Hotel <noreply@example.in>",
  SMTP_USER: "mailer",
  SMTP_PASS: "MailPassValue123",
};
const problems = (env: Record<string, string | undefined>, options?: { build?: boolean }): string[] => {
  try {
    loadConfig(env, options);
    return [];
  } catch (error) {
    assert.ok(error instanceof ConfigError, "a ConfigError, not another error");
    assert.ok(!error.message.includes("Sup3rSecretValue") && !error.message.includes("MailPassValue123") && !error.message.includes(KEY) && !error.message.includes(SECRET), "no value in the message");
    return [...error.problems];
  }
};
const names = (env: Record<string, string | undefined>): string[] => problems(env).map((p) => p.split(":")[0]).sort();

describe("production fails closed", () => {
  test("a complete production environment starts", () => {
    assert.deepEqual(problems(GOOD), []);
  });

  test("each required setting missing is named: database, hash key, secret key, public address, mail server", () => {
    assert.deepEqual(names({ NODE_ENV: "production" }), ["DATABASE_URL", "HMS_HASH_KEY", "HMS_PUBLIC_URL", "HMS_SECRET_KEY", "MAIL_DRIVER"]);
    for (const name of ["DATABASE_URL", "HMS_HASH_KEY", "HMS_SECRET_KEY", "HMS_PUBLIC_URL"]) assert.deepEqual(names({ ...GOOD, [name]: undefined }), [name]);
    assert.deepEqual(names({ ...GOOD, MAIL_DRIVER: undefined }), ["MAIL_DRIVER"], "the log driver prints codes and is refused");
    assert.deepEqual(names({ ...GOOD, MAIL_DRIVER: "log" }), ["MAIL_DRIVER"]);
  });

  test("the public address must be https and not localhost; a blank value is the same as unset", () => {
    for (const bad of ["http://hms.example.in", "https://localhost:3000", "https://127.0.0.1", "https://[::1]"]) assert.deepEqual(names({ ...GOOD, HMS_PUBLIC_URL: bad }), ["HMS_PUBLIC_URL"], bad);
    assert.deepEqual(names({ ...GOOD, HMS_PUBLIC_URL: "   " }), ["HMS_PUBLIC_URL"]);
  });

  test("development switches are refused in production: relaxed limits and mock mode", () => {
    assert.deepEqual(names({ ...GOOD, HMS_DEV_RELAX_LIMITS: "1" }), ["HMS_DEV_RELAX_LIMITS"]);
    assert.deepEqual(names({ ...GOOD, NEXT_PUBLIC_API: "mock" }), ["NEXT_PUBLIC_API"]);
    assert.deepEqual(problems({ ...GOOD, NEXT_PUBLIC_API: "real" }), []);
  });

  test("script-only secrets in the app's environment are refused, by name only", () => {
    assert.deepEqual(names({ ...GOOD, PG_OWNER_URL: "postgresql://owner:x@h/hms" }), ["PG_OWNER_URL"]);
  });

  test("the local demo build: allowed without a database (mock data on one machine); a database behind it is refused", () => {
    const demo = { NODE_ENV: "production", NEXT_PUBLIC_HMS_LOCAL_DEMO: "1" };
    assert.deepEqual(problems(demo), []);
    assert.deepEqual(names({ ...demo, DATABASE_URL: GOOD.DATABASE_URL }), ["NEXT_PUBLIC_HMS_LOCAL_DEMO"]);
    assert.deepEqual(names({ NODE_ENV: "production", NEXT_PUBLIC_HMS_LOCAL_DEMO: "2" }), ["NEXT_PUBLIC_HMS_LOCAL_DEMO"]);
  });

  test("during `next build` the production rules are not applied (the build machine holds no secrets); the shape rules still are", () => {
    assert.deepEqual(problems({ NODE_ENV: "production" }, { build: true }), []);
    assert.deepEqual(problems({ NODE_ENV: "production", DB_POOL_MAX: "zero" }, { build: true }).map((p) => p.split(":")[0]), ["DB_POOL_MAX"]);
  });

  test("development and test are unchanged: nothing is required, the dev switches are allowed", () => {
    assert.deepEqual(problems({}), []);
    assert.deepEqual(problems({ NODE_ENV: "development", HMS_DEV_RELAX_LIMITS: "1", MAIL_DRIVER: "log" }), []);
    assert.deepEqual(problems({ NODE_ENV: "test" }), []);
  });

  test("the media folder must be an absolute path", () => {
    assert.deepEqual(names({ ...GOOD, HMS_MEDIA_DIR: "relative/media" }), ["HMS_MEDIA_DIR"]);
    assert.deepEqual(problems({ ...GOOD, HMS_MEDIA_DIR: process.platform === "win32" ? "D:\\hms\\media" : "/var/lib/hms/media" }), []);
  });

  test("MEDIA_DRIVER=s3 in production needs the bucket settings (named, never a value); https except to this machine; local stays the default", () => {
    const S3 = { MEDIA_DRIVER: "s3", S3_ENDPOINT: "https://s3.ap-south-1.amazonaws.com", S3_REGION: "ap-south-1", S3_BUCKET: "hms-media", S3_ACCESS_KEY_ID: "AKIAEXAMPLE", S3_SECRET_ACCESS_KEY: "S3SecretValue987" };
    assert.deepEqual(problems({ ...GOOD, ...S3 }), []);
    assert.deepEqual(problems({ ...GOOD, ...S3, S3_FORCE_PATH_STYLE: "1", S3_ENDPOINT: "http://127.0.0.1:9000" }), []);
    assert.equal(loadConfig(GOOD).MEDIA_DRIVER, undefined, "unset: db on a hosted server, local elsewhere (mediaDriverOf)");
    assert.equal(loadConfig({ ...GOOD, MEDIA_DRIVER: "db" }).MEDIA_DRIVER, "db");
    assert.deepEqual(names({ ...GOOD, MEDIA_DRIVER: "s3" }), ["S3_ACCESS_KEY_ID", "S3_BUCKET", "S3_ENDPOINT", "S3_REGION", "S3_SECRET_ACCESS_KEY"]);
    for (const name of Object.keys(S3).filter((n) => n !== "MEDIA_DRIVER")) assert.deepEqual(names({ ...GOOD, ...S3, [name]: undefined }), [name]);
    assert.deepEqual(names({ ...GOOD, ...S3, S3_ENDPOINT: "http://s3.example.in" }), ["S3_ENDPOINT"]);
    assert.deepEqual(names({ ...GOOD, ...S3, S3_ENDPOINT: "https://s3.example.in/bucket" }), ["S3_ENDPOINT"]);
    // Supabase Storage's S3 address has one fixed path; no other path is accepted (a bucket name there is a common slip)
    assert.deepEqual(problems({ ...GOOD, ...S3, S3_FORCE_PATH_STYLE: "1", S3_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3" }), []);
    assert.deepEqual(names({ ...GOOD, ...S3, S3_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3/hms-media" }), ["S3_ENDPOINT"]);
    assert.deepEqual(names({ ...GOOD, ...S3, S3_BUCKET: "Bad_Bucket" }), ["S3_BUCKET"]);
    assert.deepEqual(names({ ...GOOD, MEDIA_DRIVER: "ftp" }), ["MEDIA_DRIVER"]);
    try {
      loadConfig({ ...GOOD, ...S3, S3_BUCKET: undefined });
    } catch (error) {
      assert.ok(!(error as Error).message.includes("S3SecretValue987"));
    }
    // outside production nothing is required (a developer may try the driver without every setting; the store names what is missing when used)
    assert.deepEqual(problems({ MEDIA_DRIVER: "s3" }), []);
  });

  test("HMS_MAIL_WORKER=cron in production needs CRON_SECRET (at least 32 characters); in-process stays the default", () => {
    assert.equal(loadConfig(GOOD).HMS_MAIL_WORKER, "in-process");
    assert.deepEqual(names({ ...GOOD, HMS_MAIL_WORKER: "cron" }), ["CRON_SECRET"]);
    assert.deepEqual(problems({ ...GOOD, HMS_MAIL_WORKER: "cron", CRON_SECRET: "s".repeat(32) }), []);
    assert.deepEqual(names({ ...GOOD, HMS_MAIL_WORKER: "cron", CRON_SECRET: "short" }), ["CRON_SECRET"]);
    assert.deepEqual(names({ ...GOOD, HMS_MAIL_WORKER: "timer" }), ["HMS_MAIL_WORKER"]);
    assert.deepEqual(problems({ HMS_MAIL_WORKER: "cron" }), []);
  });

  test("on Vercel (VERCEL set) production needs HMS_MAIL_WORKER=cron: a serverless function has no timer; without VERCEL nothing changes", () => {
    const CRON = { HMS_MAIL_WORKER: "cron", CRON_SECRET: "s".repeat(32) };
    assert.deepEqual(problems({ ...GOOD, VERCEL: "1", ...CRON }), [], "Vercel with cron starts");
    assert.deepEqual(names({ ...GOOD, VERCEL: "1" }), ["HMS_MAIL_WORKER"], "the in-process default is refused on Vercel");
    assert.deepEqual(names({ ...GOOD, VERCEL: "1", HMS_MAIL_WORKER: "in-process" }), ["HMS_MAIL_WORKER"]);
    assert.match(problems({ ...GOOD, VERCEL: "1" })[0], /must be cron on Vercel \(a serverless function has no timer, so no sign-in code would ever be sent\)/);
    assert.deepEqual(problems({ ...GOOD, VERCEL: "" }), [], "a blank VERCEL is the same as unset");
    assert.deepEqual(problems(GOOD), [], "no VERCEL: in-process stays allowed");
    assert.deepEqual(problems({ ...GOOD, ...CRON }), []);
    // outside production (a developer running `vercel dev`) nothing is required
    assert.deepEqual(problems({ VERCEL: "1" }), []);
    assert.deepEqual(problems({ NODE_ENV: "production", VERCEL: "1" }, { build: true }), [], "the Vercel build machine is not checked");
  });
});
