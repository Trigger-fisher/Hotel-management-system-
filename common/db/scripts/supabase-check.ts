// Read-only compatibility check of a NEW, EMPTY Supabase project for HMS (docs/deploy/SUPABASE-MOVE-2026-10-18.md, section 7). Prints only yes/no and numbers, never a
// value from the file. Changes nothing on the database (its one test transaction is rolled back); touches nothing on Vercel.
//   Run from web-app:  npx tsx --import ./src/server/lib/node-hooks/register.ts ../db/scripts/supabase-check.ts [--storage]
//   Reads _local/secrets/supabase.env (git-ignored; filled by MJ): SUPABASE_DB_URL_DIRECT, SUPABASE_DB_URL_SESSION_POOLER, SUPABASE_DB_URL_TX_POOLER,
//   SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_BUCKET, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY.
//   --storage: writes ONE tiny object to the bucket, reads it back, checks an anonymous read is refused, and deletes it.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { connectPg, type DbClient } from "./pg-db";
import { signV4 } from "../../../web-app/src/server/media/s3";

const root = path.resolve(__dirname, "..", "..", "..");
const file = path.join(root, "_local", "secrets", "supabase.env");
const lines: string[] = [];
const say = (label: string, value: string | number | boolean): void => void lines.push(`${label.padEnd(58)} ${String(value)}`);

function readEnv(): Record<string, string> {
  if (!existsSync(file)) throw new Error("_local/secrets/supabase.env is missing (MJ fills it; see the plan, section 7)");
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Connects; a failure is reported by its kind only (never the address or the server's words, which can name the host or user). */
async function tryConnect(url: string | undefined): Promise<DbClient | string> {
  if (!url) return "not in the file";
  try {
    return await connectPg(url, { connectionTimeoutMillis: 15_000 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    return `failed (${code ?? "no code"})`;
  }
}

async function checkDatabase(env: Record<string, string>): Promise<void> {
  const direct = await tryConnect(env.SUPABASE_DB_URL_DIRECT);
  say("direct connection", typeof direct === "string" ? direct : "ok");
  if (typeof direct !== "string") {
    const v = (await direct.query("SELECT current_setting('server_version_num')::int AS n")).rows[0].n as number;
    say("PostgreSQL version", `${Math.floor(v / 10000)}.${v % 10000}`);
    say("PostgreSQL 18 or later (built-in uuidv7)", v >= 180000);
    say("a uuidv7() function exists", (await direct.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'uuidv7'")).rows[0].n > 0);
    say("PostgreSQL 17 or later (LOCALE_PROVIDER builtin)", v >= 170000);
    const r = (await direct.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
    say("connecting role: superuser", r.rolsuper === true);
    say("connecting role: CREATEROLE (hms_owner, hms_app, hotel roles)", r.rolcreaterole === true);
    say("connecting role: CREATEDB (the hms database)", r.rolcreatedb === true);
    say("connecting role: REPLICATION / BYPASSRLS", `${r.rolreplication === true} / ${r.rolbypassrls === true}`);
    const ext = (await direct.query("SELECT name, installed_version IS NOT NULL AS installed FROM pg_available_extensions WHERE name IN ('citext', 'pg_trgm')")).rows;
    for (const name of ["citext", "pg_trgm"]) {
      const e = ext.find((x) => x.name === name);
      say(`extension ${name}: available / installed`, e ? `yes / ${e.installed === true}` : "NOT available");
    }
    say("databases besides postgres and templates", (await direct.query("SELECT count(*)::int AS n FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1') AND NOT datistemplate")).rows[0].n);
    say("schemas platform / hotel_* already there (must be 0 on an empty project)", (await direct.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'platform' OR nspname LIKE 'hotel\\_%'")).rows[0].n);
    await direct.end();
  }

  const session = await tryConnect(env.SUPABASE_DB_URL_SESSION_POOLER);
  say("session pooler connection", typeof session === "string" ? session : "ok");
  if (typeof session !== "string") {
    say("session pooler: advisory lock (migrations, tests)", (await session.query("SELECT pg_try_advisory_lock(424242) AS ok")).rows[0].ok === true);
    await session.query("SELECT pg_advisory_unlock(424242)");
    await session.end();
  }

  const tx = await tryConnect(env.SUPABASE_DB_URL_TX_POOLER);
  say("transaction pooler connection (the web app)", typeof tx === "string" ? tx : "ok");
  if (typeof tx !== "string") {
    say("transaction pooler: a parameterised query", (await tx.query("SELECT $1::int + 1 AS n", [41])).rows[0].n === 42);
    // what withHotel does in every transaction, done to the connecting role itself and rolled back: SET LOCAL ROLE, set_config(..., true), READ ONLY
    await tx.query("BEGIN READ ONLY");
    let localOk = false;
    try {
      await tx.query("SELECT set_config('role', current_user, true)");
      await tx.query("SELECT set_config('hms.scope_kind', 'check', true), set_config('search_path', 'pg_catalog', true)");
      localOk = (await tx.query("SELECT current_setting('hms.scope_kind', true) AS v")).rows[0].v === "check";
    } finally {
      await tx.query("ROLLBACK");
    }
    say("transaction pooler: SET LOCAL role / set_config inside BEGIN", localOk);
    const leaked = (await tx.query("SELECT current_setting('hms.scope_kind', true) AS v")).rows[0].v;
    say("transaction pooler: the settings did NOT leak to the next transaction", leaked === null || leaked === "");
    await tx.end();
  }

  // the pooler and another database: connect only (no CREATE); a missing database answers 3D000, which means the routing works but there is no such database yet
  if (env.SUPABASE_DB_URL_TX_POOLER) {
    const other = env.SUPABASE_DB_URL_TX_POOLER.replace(/\/[^/?]+(\?|$)/, "/hms_check_nonexistent$1");
    const r = await tryConnect(other);
    say("transaction pooler routes to a database other than postgres", typeof r === "string" ? (/3D000/.test(r) ? "yes (answered 'no such database')" : `no / unclear: ${r}`) : "yes");
    if (typeof r !== "string") await r.end();
  }
}

async function checkStorage(env: Record<string, string>): Promise<void> {
  const endpoint = env.SUPABASE_S3_ENDPOINT;
  const bucket = env.SUPABASE_S3_BUCKET;
  if (!endpoint || !bucket || !env.SUPABASE_S3_ACCESS_KEY_ID || !env.SUPABASE_S3_SECRET_ACCESS_KEY) {
    say("storage", "not in the file");
    return;
  }
  const base = new URL(endpoint);
  say("storage endpoint has a path (needs env.ts / s3.ts to keep it)", base.pathname.replace(/\/+$/, "") !== "");
  const key = `hms-check/${randomBytes(8).toString("hex")}.txt`;
  const url = new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${key}`);
  const body = Buffer.from(`hms check ${new Date().toISOString()}`);
  const hash = createHash("sha256").update(body).digest("hex");
  const sign = (method: string, payloadHash: string, headers: Record<string, string> = {}) =>
    signV4({ method, url, headers, payloadHash, accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID, secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY, region: env.SUPABASE_S3_REGION || "ap-south-1", now: new Date() });
  const emptyHash = createHash("sha256").update("").digest("hex");
  const put = await fetch(url, { method: "PUT", headers: sign("PUT", hash, { "content-type": "text/plain" }), body });
  say("storage: write one tiny object", put.ok ? "ok" : `failed (HTTP ${put.status})`);
  if (!put.ok) return;
  const get = await fetch(url, { method: "GET", headers: sign("GET", emptyHash) });
  say("storage: read it back, same bytes", get.ok && Buffer.from(await get.arrayBuffer()).equals(body));
  const anon = await fetch(url, { method: "GET" });
  say("storage: an anonymous read is refused (private bucket)", !anon.ok);
  const publicUrl = `${base.origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`;
  say("storage: the public object address is refused too", !(await fetch(publicUrl)).ok);
  const del = await fetch(url, { method: "DELETE", headers: sign("DELETE", emptyHash) });
  say("storage: delete it", del.ok || del.status === 204 ? "ok" : `failed (HTTP ${del.status}): delete ${key} by hand`);
}

async function main(): Promise<void> {
  if (!existsSync(file)) {
    process.stdout.write("_local/secrets/supabase.env is missing: MJ fills it (see docs/deploy/SUPABASE-MOVE-2026-10-18.md, section 7). Nothing was checked.\n");
    process.exit(2);
  }
  const env = readEnv();
  say("settings file", "found (values not shown)");
  await checkDatabase(env);
  if (process.argv.includes("--storage")) await checkStorage(env);
  else say("storage", "skipped (add --storage to test it)");
  process.stdout.write(`${lines.join("\n")}\n`);
}

main().catch((e: unknown) => {
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stderr.write(`stopped: ${e instanceof Error ? e.name : "error"}\n`);
  process.exit(1);
});
