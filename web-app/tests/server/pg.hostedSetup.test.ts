// `db:cli setup --hosted` (Neon and other hosts with NO superuser), on a fake client that records the statements: the console login makes the roles,
// the grant and the databases; everything inside a database is done as hms_owner; the builtin-locale refusal falls back; secrets go to their own store.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import type { EnvStore } from "../../../common/db/scripts/env-store";
import { hostedSecretsFile, runHostedSetup, urlWithLogin } from "../../../common/db/scripts/pg-setup";

function store(initial: Record<string, string> = {}): EnvStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (n) => values.get(n),
    append(entries) {
      for (const [n, v] of entries) if (!values.has(n)) values.set(n, v);
    },
    remove: () => [],
  };
}

function harness(options: { refuseBuiltin?: boolean; existingRoles?: string[] } = {}) {
  const log: { as: string; db: string; sql: string }[] = [];
  const said: string[] = [];
  const connect = async (url: string): Promise<DbClient> => {
    const parsed = new URL(url);
    const as = decodeURIComponent(parsed.username);
    const db = decodeURIComponent(parsed.pathname.slice(1));
    return {
      async query(sql: string, params?: unknown[]) {
        log.push({ as, db, sql });
        if (/FROM pg_roles WHERE rolname = \$1/.test(sql) && /SELECT 1 AS x/.test(sql)) return { rows: options.existingRoles?.includes(String(params?.[0])) ? [{ x: 1 }] : [], rowCount: 0 };
        if (/FROM pg_database/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT rolsuper/.test(sql)) return { rows: [{ rolsuper: false, rolcreaterole: params?.[0] === "hms_owner", rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolinherit: params?.[0] === "hms_owner" }], rowCount: 1 };
        if (/^SELECT format\(/.test(sql)) return { rows: [{ statement: `${String(params?.[0]).replace("%I", `"${String(params?.[1])}"`).replace(/ PASSWORD %L/, " PASSWORD '<secret>'")}` }], rowCount: 1 };
        if (options.refuseBuiltin && /LOCALE_PROVIDER builtin/.test(sql)) throw Object.assign(new Error("not supported"), { code: "0A000" });
        return { rows: [], rowCount: 0 };
      },
      async end() {},
    } as unknown as DbClient;
  };
  const scriptEnv = store({ PG_CONSOLE_URL: "postgres://console:pw@ep-x.ap-south-1.aws.neon.tech/neondb?sslmode=require" });
  const secretsStore = store();
  return { log, said, connect, scriptEnv, secretsStore, deps: { scriptEnv, secretsStore, connect, random: (n: number) => Buffer.alloc(n, 7), say: (m: string) => void said.push(m) } };
}

describe("runHostedSetup", () => {
  test("the console role makes the roles, the grant and the databases; the inside of each database is done as hms_owner", async () => {
    const h = harness();
    const summary = await runHostedSetup({ ...h.deps, withTestDatabase: true });
    assert.deepEqual(summary.databasesEnsured, ["hms", "hms_test"]);
    const asConsole = h.log.filter((l) => l.as === "console").map((l) => l.sql);
    assert.ok(asConsole.some((s) => /GRANT "hms_owner" TO CURRENT_USER WITH SET TRUE/.test(s)));
    assert.ok(asConsole.some((s) => /CREATE DATABASE "hms" OWNER "hms_owner".*LOCALE_PROVIDER builtin/.test(s)));
    assert.ok(!asConsole.some((s) => /CREATE EXTENSION|REVOKE ALL ON SCHEMA/.test(s)), "nothing inside a database is done as the console role");
    const asOwner = h.log.filter((l) => l.as === "hms_owner");
    for (const db of ["hms", "hms_test"]) {
      const sql = asOwner.filter((l) => l.db === db).map((l) => l.sql).join("\n");
      assert.match(sql, /CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public/);
      assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public/);
      assert.match(sql, /REVOKE ALL ON SCHEMA public FROM PUBLIC/);
      assert.match(sql, /GRANT CONNECT ON DATABASE "[a-z_]+" TO "hms_app"/);
    }
  });

  test("a host that refuses the builtin locale gets the database with its own defaults", async () => {
    const h = harness({ refuseBuiltin: true });
    await runHostedSetup(h.deps);
    const creates = h.log.filter((l) => /CREATE DATABASE/.test(l.sql)).map((l) => l.sql);
    assert.equal(creates.length, 2);
    assert.match(creates[0], /LOCALE_PROVIDER builtin/);
    assert.equal(creates[1], 'CREATE DATABASE "hms" OWNER "hms_owner"');
    assert.ok(h.said.some((m) => /builtin C\.UTF-8 locale was not accepted/.test(m)));
  });

  test("an existing role only gets its password again (a non-superuser may not restate REPLICATION or CREATEROLE)", async () => {
    const h = harness({ existingRoles: ["hms_owner", "hms_app"] });
    await runHostedSetup(h.deps);
    const roleStatements = h.log.filter((l) => l.as === "console" && /^SELECT format\(/.test(l.sql)).map((l) => String(l.sql));
    assert.equal(roleStatements.length, 2);
  });

  test("the names land where they belong, URLs keep host and sslmode, secrets go to their own file, the pooler address is refused", async () => {
    const h = harness();
    await runHostedSetup(h.deps);
    const owner = new URL(String(h.scriptEnv.values.get("PG_OWNER_URL")));
    assert.deepEqual([owner.username, owner.hostname, owner.pathname, owner.searchParams.get("sslmode")], ["hms_owner", "ep-x.ap-south-1.aws.neon.tech", "/hms", "require"]);
    assert.equal(new URL(String(h.scriptEnv.values.get("PG_APP_DIRECT_URL"))).username, "hms_app");
    assert.ok(!h.scriptEnv.values.has("PG_TEST_OWNER_URL"), "no test database unless asked");
    assert.deepEqual([...h.secretsStore.values.keys()].sort(), ["CRON_SECRET", "HMS_DATA_KEY", "HMS_HASH_KEY", "HMS_SECRET_KEY"]);
    for (const text of h.said) assert.ok(!/postgres:\/\/|:pw@/.test(text), "no URL or password in a message");
    const pooled = harness();
    pooled.scriptEnv.values.set("PG_CONSOLE_URL", "postgres://console:pw@ep-x-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require");
    await assert.rejects(runHostedSetup(pooled.deps), /DIRECT address/);
  });

  test("urlWithLogin changes only the login and the database", () => {
    assert.equal(urlWithLogin("postgres://a:b@h.example:5432/x?sslmode=require", "u v", "p/w", "hms"), "postgres://u%20v:p%2Fw@h.example:5432/hms?sslmode=require");
  });

  test("through a Supabase pooler every role keeps the project part of the login (postgres.<project> gives hms_owner.<project>)", () => {
    assert.equal(urlWithLogin("postgresql://postgres.abcd:b@aws-0-ap-south-1.pooler.supabase.com:5432/postgres", "hms_owner", "pw", "hms"), "postgresql://hms_owner.abcd:pw@aws-0-ap-south-1.pooler.supabase.com:5432/hms");
    assert.equal(urlWithLogin("postgresql://postgres:b@db.abcd.supabase.co:5432/postgres", "hms_owner", "pw", "hms"), "postgresql://hms_owner:pw@db.abcd.supabase.co:5432/hms", "a direct address has no project part");
  });

  test("the secrets file follows HMS_SCRIPT_ENV_FILE, so a trial server never writes db/hosted-secrets.txt", () => {
    const dbRoot = path.resolve("repo", "db");
    assert.equal(hostedSecretsFile(dbRoot, {}), path.join(dbRoot, "hosted-secrets.txt"));
    const trial = path.resolve("scratch", "secrets", "script.env");
    assert.equal(hostedSecretsFile(dbRoot, { HMS_SCRIPT_ENV_FILE: trial }), path.join(path.dirname(trial), "hosted-secrets.txt"));
  });
});
