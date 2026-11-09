// First database run on PostgreSQL (Backend Review/08-POSTGRES-FINAL.md): HMS's own instance (pg-instance.ts), its two roles, its databases and the
// secrets that go with them. Idempotent: run it again and it only finishes what is missing. Needs nothing from MJ: the superuser password was made by
// pg-instance.ts and lives only in db\.env.local (PGSUPERUSER_URL).
//
// Roles (LOGIN, never SUPERUSER, CREATEDB, REPLICATION or BYPASSRLS):
//   hms_owner   runs the scripts: owns the databases and every object; CREATEROLE only (to make each hotel's NOLOGIN role); never serves the web app.
//   hms_app     the web app. NOINHERIT, and a member (SET only) of each hotel role: it holds NO privilege on any hotel schema by itself, it can only
//               SET LOCAL ROLE into one hotel's role inside a transaction (withHotel). Timeouts per role: statement 15 s, idle in transaction 10 s, lock 5 s.
// Databases: `hms` (development and later production) and `hms_test` (the tests make and drop their own hotels there). Each is locked: PUBLIC has
// nothing, the public schema is closed, only the two roles connect, and what the owner creates later is never visible to hms_app by default.
// Secrets (names only here, values never printed):
//   db\.env.local        PGSUPERUSER_URL (instance), PG_OWNER_URL, PG_TEST_OWNER_URL
//   web-app\.env.local   DATABASE_URL (hms_app, database hms), HMS_HASH_KEY (keyed hash of codes and identifiers), HMS_SECRET_KEY (the secret vault), HMS_DATA_KEY (sealed ID and bank numbers)
// Passwords are Argon2id hashes; other secrets (HMS_SECRET_KEY) are kept in the vault.
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { EnvStore } from "./env-store";
import { connectPg, pgUrl, pgWithDatabase, type DbClient } from "./pg-db";

export const PG_OWNER_ROLE = "hms_owner";
export const PG_APP_ROLE = "hms_app";
export const PG_DATABASE = "hms";
export const PG_TEST_DATABASE = "hms_test";

export interface PgSetupDeps {
  scriptEnv: EnvStore;
  appEnv: EnvStore;
  /** Starts (and the first time initialises) the HMS instance; writes PGSUPERUSER_URL when it makes the password. */
  ensureInstance(): Promise<void>;
  /** A connection to a database of the instance, from a postgres:// URL. */
  connect(url: string): Promise<DbClient>;
  random(bytes: number): Buffer;
  say(message: string): void;
}

export interface PgSetupSummary {
  envNamesAdded: { file: "db/.env.local" | "web-app/.env.local" | "db/hosted-secrets.txt"; name: string }[];
  rolesEnsured: string[];
  databasesEnsured: string[];
}

function passwordOf(url: string | undefined): string | null {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return null;
  try {
    return decodeURIComponent(new URL(url).password) || null;
  } catch {
    return null;
  }
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Runs a statement the SERVER builds with format(%I, %L): the role name and password are quoted by PostgreSQL itself, never by string building here. */
async function serverFormatted(db: DbClient, template: string, params: readonly unknown[]): Promise<void> {
  const built = await db.query(`SELECT format($1, ${params.map((_, i) => `$${i + 2}::text`).join(", ")}) AS statement`, [template, ...params]);
  await db.query(String(built.rows[0].statement));
}

export async function runPgSetup(deps: PgSetupDeps): Promise<PgSetupSummary> {
  const summary: PgSetupSummary = { envNamesAdded: [], rolesEnsured: [], databasesEnsured: [] };
  await deps.ensureInstance();
  const superUrl = deps.scriptEnv.get("PGSUPERUSER_URL");
  if (!superUrl) throw new Error("PGSUPERUSER_URL is missing from db/.env.local");

  // ---- the secrets this step owns (passwords are reused from an existing URL, so a rerun changes nothing) ----
  const ownerPassword = passwordOf(deps.scriptEnv.get("PG_OWNER_URL")) ?? deps.random(24).toString("base64url");
  const appPassword = passwordOf(deps.appEnv.get("DATABASE_URL")) ?? deps.random(24).toString("base64url");
  const adds: { store: EnvStore; file: "db/.env.local" | "web-app/.env.local"; name: string; value: string }[] = [
    { store: deps.scriptEnv, file: "db/.env.local", name: "PG_OWNER_URL", value: pgUrl({ user: PG_OWNER_ROLE, password: ownerPassword, database: PG_DATABASE }) },
    { store: deps.scriptEnv, file: "db/.env.local", name: "PG_TEST_OWNER_URL", value: pgUrl({ user: PG_OWNER_ROLE, password: ownerPassword, database: PG_TEST_DATABASE }) },
    { store: deps.appEnv, file: "web-app/.env.local", name: "DATABASE_URL", value: pgUrl({ user: PG_APP_ROLE, password: appPassword, database: PG_DATABASE }) },
    { store: deps.appEnv, file: "web-app/.env.local", name: "HMS_HASH_KEY", value: deps.random(32).toString("base64") },
    { store: deps.appEnv, file: "web-app/.env.local", name: "HMS_SECRET_KEY", value: deps.random(32).toString("base64") },
    { store: deps.appEnv, file: "web-app/.env.local", name: "HMS_DATA_KEY", value: deps.random(32).toString("base64") },
  ];
  for (const a of adds) {
    if (a.store.get(a.name) !== undefined) continue; // never overwritten: the keys are never regenerated
    a.store.append([[a.name, a.value]]);
    summary.envNamesAdded.push({ file: a.file, name: a.name });
  }
  const finalOwner = passwordOf(deps.scriptEnv.get("PG_OWNER_URL")) ?? ownerPassword;
  const finalApp = passwordOf(deps.appEnv.get("DATABASE_URL")) ?? appPassword;

  // ---- roles and databases (as the superuser; it is used by this step and nothing else) ----
  const sup = await deps.connect(pgWithDatabase(superUrl, "postgres"));
  try {
    for (const [role, password, attributes] of [
      [PG_OWNER_ROLE, finalOwner, "LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS"],
      [PG_APP_ROLE, finalApp, "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"],
    ] as const) {
      const exists = await sup.query("SELECT 1 AS x FROM pg_roles WHERE rolname = $1", [role]);
      // the role name and password are quoted by the server's own format(); an existing role keeps its name and gets the password from the file again
      await serverFormatted(sup, `${exists.rows.length === 0 ? "CREATE" : "ALTER"} ROLE %I ${attributes} PASSWORD %L`, [role, password]);
      summary.rolesEnsured.push(role);
    }
    // per-role limits: what the app may do to a runaway query or a forgotten transaction
    await sup.query(`ALTER ROLE ${ident(PG_APP_ROLE)} SET statement_timeout = '15s'`);
    await sup.query(`ALTER ROLE ${ident(PG_APP_ROLE)} SET idle_in_transaction_session_timeout = '10s'`);
    await sup.query(`ALTER ROLE ${ident(PG_APP_ROLE)} SET lock_timeout = '5s'`);
    await sup.query(`ALTER ROLE ${ident(PG_APP_ROLE)} SET timezone = 'UTC'`);
    await sup.query(`ALTER ROLE ${ident(PG_OWNER_ROLE)} SET timezone = 'UTC'`);

    for (const db of [PG_DATABASE, PG_TEST_DATABASE]) {
      const exists = await sup.query("SELECT 1 AS x FROM pg_database WHERE datname = $1", [db]);
      if (exists.rows.length === 0) await sup.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(PG_OWNER_ROLE)} ENCODING 'UTF8' TEMPLATE template0 LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C'`);
      await sup.query(`ALTER DATABASE ${ident(db)} OWNER TO ${ident(PG_OWNER_ROLE)}`);
      await sup.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
      await sup.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(PG_APP_ROLE)}`);
      await sup.query(`GRANT CONNECT, CREATE ON DATABASE ${ident(db)} TO ${ident(PG_OWNER_ROLE)}`);
      summary.databasesEnsured.push(db);
      // inside the database: the public schema is closed, the case-insensitive and search extensions exist, and nothing the owner makes later is visible to hms_app by default
      const inside = await deps.connect(pgWithDatabase(superUrl, db));
      try {
        await inside.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await inside.query(`REVOKE ALL ON SCHEMA public FROM ${ident(PG_APP_ROLE)}`);
        await inside.query("CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public");
        await inside.query("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public");
        await inside.query(`GRANT USAGE ON SCHEMA public TO ${ident(PG_OWNER_ROLE)}, ${ident(PG_APP_ROLE)}`);
        // hms_app may USE the extensions' types and functions (citext, trigram operators), and nothing else in public
        await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON TABLES FROM ${ident(PG_APP_ROLE)}`);
        await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON SEQUENCES FROM ${ident(PG_APP_ROLE)}`);
        await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON FUNCTIONS FROM ${ident(PG_APP_ROLE)}`);
      } finally {
        await inside.end();
      }
    }
  } finally {
    await sup.end();
  }

  deps.say(`Roles ready: ${summary.rolesEnsured.join(", ")}. Databases ready: ${summary.databasesEnsured.join(", ")}.`);
  if (summary.envNamesAdded.length > 0) deps.say(`Added to the env files (names only): ${summary.envNamesAdded.map((a) => `${a.name} (${a.file})`).join(", ")}.`);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// HOSTED setup (Supabase and the like): there is NO superuser. The only login is the "console" role the host made with the project: it can create roles and
// databases (CREATEROLE, CREATEDB) but is not a superuser. Same end state as runPgSetup, reached with only those rights:
//   * the two roles are made by the console role (it becomes their ADMIN); `hms_owner` is also granted TO the console role WITH SET TRUE, because
//     PostgreSQL 16+ lets a role create a database OWNED BY another role only if it can SET ROLE to it;
//   * the database is created with the builtin C.UTF-8 locale when the host accepts it, else with the host's defaults (HMS does not rely on the
//     collation for correctness: case-insensitive rules use citext / lower());
//   * everything INSIDE the database (extensions, the closed public schema, default privileges) is done as hms_owner, the database owner, because the
//     console role is not the owner and owns nothing in it.
// The URLs keep the host, port and query (sslmode=require ...) of the console URL, which must be the DIRECT (unpooled) address.
// Names written (values never printed): db/.env.local PG_OWNER_URL [PG_TEST_OWNER_URL], PG_APP_DIRECT_URL (hms_app on the direct address: for the
// readiness check, and the base of the pooled DATABASE_URL MJ puts on Vercel); db/hosted-secrets.txt gets HMS_HASH_KEY, HMS_SECRET_KEY, HMS_DATA_KEY, CRON_SECRET
// (git-ignored, mode 0600) for Vercel: they are NOT put in web-app/.env.local (that file belongs to the local dev app).
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface HostedSetupDeps {
  scriptEnv: EnvStore;
  /** The git-ignored file the Vercel secrets are appended to (HMS_HASH_KEY ...). A name already in it is never rewritten. */
  secretsStore: EnvStore;
  connect(url: string): Promise<DbClient>;
  random(bytes: number): Buffer;
  say(message: string): void;
  /** Also make the `hms_test` database (for the database tests). Default: no, a hosted project needs only `hms`. */
  withTestDatabase?: boolean;
  /** The database HMS lives in. Default "hms" (made for HMS). "postgres" puts HMS in the project's own default database, the only one the Supabase dashboard can browse (and the only one a pooler reaches by default). */
  database?: string;
}

/** The same address (host, port, query such as sslmode) with another login and database. */
export function urlWithLogin(base: string, user: string, password: string, database: string): string {
  const parsed = new URL(base);
  // a Supabase pooler names the project in the login ("postgres.<project>"): every role used through it carries the same ".<project>"
  const baseUser = decodeURIComponent(parsed.username);
  const tenant = /\.pooler\./.test(parsed.hostname) && baseUser.indexOf(".") > 0 ? baseUser.slice(baseUser.indexOf(".")) : "";
  parsed.username = encodeURIComponent(`${user}${tenant}`);
  parsed.password = encodeURIComponent(password);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/**
 * uuidv7() for a PostgreSQL older than 18 (Supabase runs 17 today): a plain SQL function with the built-in's layout, a 48-bit millisecond time, version 7, variant 2, the rest random,
 * so ids still sort by time. Made in `public` as hms_owner only when the server has no built-in one; a server on 18 or later is left exactly as it is, and when Supabase moves to 18 this
 * can be dropped once the built-in answers (DROP FUNCTION public.uuidv7()).
 */
export const UUIDV7_SHIM_SQL = `CREATE OR REPLACE FUNCTION public.uuidv7() RETURNS uuid LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$`;
export async function runHostedSetup(deps: HostedSetupDeps): Promise<PgSetupSummary> {
  const summary: PgSetupSummary = { envNamesAdded: [], rolesEnsured: [], databasesEnsured: [] };
  const consoleUrl = deps.scriptEnv.get("PG_CONSOLE_URL");
  if (!consoleUrl) throw new Error("PG_CONSOLE_URL is missing from db/.env.local (the host's console login, direct address)");
  if (/-pooler\./.test(new URL(consoleUrl).hostname)) throw new Error("PG_CONSOLE_URL must be the DIRECT address (not the -pooler one): migrations and role changes need a real session");

  const ownerPassword = passwordOf(deps.scriptEnv.get("PG_OWNER_URL")) ?? deps.random(24).toString("base64url");
  const appPassword = passwordOf(deps.scriptEnv.get("PG_APP_DIRECT_URL")) ?? deps.random(24).toString("base64url");
  const mainDatabase = deps.database ?? PG_DATABASE;
  const databases = [mainDatabase, ...(deps.withTestDatabase ? [PG_TEST_DATABASE] : [])];

  // ---- as the console role: roles, their settings, the grant that lets it create the database for hms_owner, the databases ----
  const con = await deps.connect(consoleUrl);
  try {
    for (const [role, password, attributes] of [
      [PG_OWNER_ROLE, ownerPassword, "LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS"],
      [PG_APP_ROLE, appPassword, "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"],
    ] as const) {
      const exists = await con.query("SELECT 1 AS x FROM pg_roles WHERE rolname = $1", [role]);
      // a new role gets its attributes; an existing one only gets its password again: a non-superuser may not restate attributes such as REPLICATION or
      // CREATEROLE on a role (SQLSTATE 42501), and they cannot have changed (the check below stops a role that is not what HMS needs)
      await serverFormatted(con, exists.rows.length === 0 ? `CREATE ROLE %I ${attributes} PASSWORD %L` : "ALTER ROLE %I PASSWORD %L", [role, password]);
      const got = (await con.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = $1", [role])).rows[0];
      const wantCreateRole = role === PG_OWNER_ROLE;
      if (got.rolsuper || got.rolcreatedb || got.rolreplication || got.rolbypassrls || got.rolcreaterole !== wantCreateRole || (role === PG_APP_ROLE && got.rolinherit)) {
        throw new Error(`The role ${role} exists but is not what HMS needs (LOGIN, no SUPERUSER, CREATEDB, REPLICATION or BYPASSRLS${wantCreateRole ? ", CREATEROLE" : ", NOCREATEROLE, NOINHERIT"}): drop it in the host console and run this again`);
      }
      summary.rolesEnsured.push(role);
    }
    for (const [role, setting] of [
      [PG_APP_ROLE, "statement_timeout = '15s'"],
      [PG_APP_ROLE, "idle_in_transaction_session_timeout = '10s'"],
      [PG_APP_ROLE, "lock_timeout = '5s'"],
      [PG_APP_ROLE, "timezone = 'UTC'"],
      [PG_OWNER_ROLE, "timezone = 'UTC'"],
    ] as const) await con.query(`ALTER ROLE ${ident(role)} SET ${setting}`);
    await con.query(`GRANT ${ident(PG_OWNER_ROLE)} TO CURRENT_USER WITH SET TRUE`);

    for (const db of databases) {
      const exists = await con.query("SELECT 1 AS x FROM pg_database WHERE datname = $1", [db]);
      if (db === "postgres") await con.query(`GRANT CREATE ON DATABASE ${ident(db)} TO ${ident(PG_OWNER_ROLE)}`);
      else if (exists.rows.length === 0) {
        try {
          await con.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(PG_OWNER_ROLE)} ENCODING 'UTF8' TEMPLATE template0 LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C'`);
        } catch (error) {
          // the host refused the builtin locale provider (or the template/locale options): the host's own defaults are fine for HMS
          const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "?";
          deps.say(`The builtin C.UTF-8 locale was not accepted for ${db} (SQLSTATE ${code}); making it with the host's defaults.`);
          await con.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(PG_OWNER_ROLE)}`);
        }
      }
      summary.databasesEnsured.push(db);
    }
  } finally {
    await con.end();
  }

  // ---- as hms_owner (the database owner): lock each database and make the extensions ----
  for (const db of databases) {
    // the host's own database is not owned by hms_owner: the console role makes the extensions and the shim there, and nothing the host itself uses is locked
    const own = db === "postgres";
    const inside = await deps.connect(own ? pgWithDatabase(consoleUrl, db) : urlWithLogin(consoleUrl, PG_OWNER_ROLE, ownerPassword, db));
    try {
      if (!own) await inside.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
      await inside.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(PG_APP_ROLE)}`);
      if (!own) await inside.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
      await inside.query(`REVOKE ALL ON SCHEMA public FROM ${ident(PG_APP_ROLE)}`);
      await inside.query("CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public");
      await inside.query("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public");
      // a server before PostgreSQL 18 (Supabase today) has no built-in uuidv7(): the shim gives the tables the same function
      const version = Number((await inside.query("SELECT current_setting('server_version_num')::int AS n")).rows[0]?.n ?? 180000);
      if (version < 180000) {
        await inside.query(UUIDV7_SHIM_SQL);
        await inside.query(`GRANT EXECUTE ON FUNCTION public.uuidv7() TO ${ident(PG_OWNER_ROLE)}, ${ident(PG_APP_ROLE)}`);
        deps.say("This server is older than PostgreSQL 18: made the uuidv7() shim in public.");
      }
      await inside.query(`GRANT USAGE ON SCHEMA public TO ${ident(PG_OWNER_ROLE)}, ${ident(PG_APP_ROLE)}`);
      await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON TABLES FROM ${ident(PG_APP_ROLE)}`);
      await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON SEQUENCES FROM ${ident(PG_APP_ROLE)}`);
      await inside.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(PG_OWNER_ROLE)} REVOKE ALL ON FUNCTIONS FROM ${ident(PG_APP_ROLE)}`);
    } finally {
      await inside.end();
    }
  }

  // ---- the names (a name already present is left exactly as it is) ----
  const adds: { store: EnvStore; file: PgSetupSummary["envNamesAdded"][number]["file"]; name: string; value: string }[] = [
    { store: deps.scriptEnv, file: "db/.env.local", name: "PG_OWNER_URL", value: urlWithLogin(consoleUrl, PG_OWNER_ROLE, ownerPassword, mainDatabase) },
    ...(deps.withTestDatabase ? [{ store: deps.scriptEnv, file: "db/.env.local" as const, name: "PG_TEST_OWNER_URL", value: urlWithLogin(consoleUrl, PG_OWNER_ROLE, ownerPassword, PG_TEST_DATABASE) }] : []),
    { store: deps.scriptEnv, file: "db/.env.local", name: "PG_APP_DIRECT_URL", value: urlWithLogin(consoleUrl, PG_APP_ROLE, appPassword, mainDatabase) },
    { store: deps.secretsStore, file: "db/hosted-secrets.txt", name: "HMS_HASH_KEY", value: deps.random(32).toString("base64") },
    { store: deps.secretsStore, file: "db/hosted-secrets.txt", name: "HMS_SECRET_KEY", value: deps.random(32).toString("base64") },
    { store: deps.secretsStore, file: "db/hosted-secrets.txt", name: "HMS_DATA_KEY", value: deps.random(32).toString("base64") },
    { store: deps.secretsStore, file: "db/hosted-secrets.txt", name: "CRON_SECRET", value: deps.random(32).toString("base64url") },
  ];
  for (const a of adds) {
    if (a.store.get(a.name) !== undefined) continue;
    a.store.append([[a.name, a.value]]);
    summary.envNamesAdded.push({ file: a.file, name: a.name });
  }
  deps.say(`Roles ready: ${summary.rolesEnsured.join(", ")}. Databases ready: ${summary.databasesEnsured.join(", ")}.`);
  if (summary.envNamesAdded.length > 0) deps.say(`Added (names only): ${summary.envNamesAdded.map((a) => `${a.name} (${a.file})`).join(", ")}.`);
  return summary;
}
/**
 * Where `setup --hosted` writes the Vercel secrets: db/hosted-secrets.txt, or, when HMS_SCRIPT_ENV_FILE points the scripts at another env file (a
 * throwaway server), a hosted-secrets.txt next to that file, so a trial run never leaves its secrets in db/ for the real run to keep.
 */
export function hostedSecretsFile(dbRoot: string, env: Readonly<Record<string, string | undefined>>): string {
  const override = env.HMS_SCRIPT_ENV_FILE;
  return path.join(override ? path.dirname(path.resolve(override)) : dbRoot, "hosted-secrets.txt");
}
export const pgRandomBytes =(n: number): Buffer => randomBytes(n);
export { connectPg };
