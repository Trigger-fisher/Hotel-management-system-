// The command line for the database scripts (PostgreSQL). Run from web-app:  npm run db:cli -- <command>
//   instance ensure|stop|status                  HMS's own PostgreSQL instance (port 5433)
//   setup [--external]                           roles, databases, extensions and every generated secret (idempotent); --external = a PostgreSQL server you run yourself (needs PGSUPERUSER_URL in db/.env.local first; HMS's own local instance is not started)
//   setup --hosted [--with-test-db]             a hosted PostgreSQL with NO superuser (Supabase and the like): needs PG_CONSOLE_URL (the console role, DIRECT address) in db/.env.local; same roles, database and extensions, written with only CREATEROLE/CREATEDB rights; Vercel secrets go to db/hosted-secrets.txt
//   export-hosted-sql [--out dir] [--hotel-name N] [--hotel-slug s]   numbered SQL parts (default db/hosted-sql/, git-ignored) to paste into a hosted SQL editor: the roles, every migration and seed, one demo hotel; no accounts, no passwords; touches no database
//   migrate [--dry-run] [--test]                 platform, then every hotel schema (as hms_owner); --test targets the hms_test database
//   seed [--test]                                platform seeds, then every hotel's seeds
//   create-hotel --name "X" --slug x [--test]    one new hotel, in one transaction
//   create-user --username u --name "N" --email e [--account-role hotel_admin] [--role admin] [--hotel slug] [--write-file] [--test]   a sign-in account with a one-time temporary password (--write-file puts it in db/.dev-login.txt, git-ignored, instead of the terminal)
//   clear-rate-limits [--test]                   DEV: forgets the throttle counters (sign-in tries per address ...) so testing is not locked out
//   dev-password <username>... [--test]         DEV, local database only: a new random password for each account (no first change, lock and wrong tries cleared), written to db/.dev-login.txt (git-ignored), never printed
//   smoke-codes [--test]                         DEV, local database only: copies the sign-in codes waiting in the outbox (a production build on this machine has no mail server) into db/.dev-mail.log
//   perf-hotel create|remove [--test]           DEV, local database only: the throwaway "PERF-Test Hotel" with a year of volume data for the speed check, and its perf.admin login (password in db/.dev-login.txt)
//   drop-hotel-schema <hotel_...> [--test]    finishes a permanent delete whose cleanup failed: drops that schema and role, ONLY when its hotel is recorded as deleted
//   backup [--out dir] [--test]                 pg_dump of the database into db/dumps/backups (or --out) with a .sha256; keep a copy off this machine
//   restore-check [--file f] [--out dir]        restores a dump (or a fresh one) into a scratch database, compares it with the source, drops the scratch database
//   backup-check --file f [--sha256 hex]        reads one nightly hotel copy (backups/<hotel>/backup-<day>-<sha8>.ndjson.gz from the bucket) or an export: checksum, every line parsed, rows per table; no database needed
//   seal-numbers --dry-run | --backup-done | --verify [--hotel <schema>]   decision 74: seals the plain ID numbers of every hotel (needs HMS_DATA_KEY and hotel migrations 0063 and 0064); --dry-run counts, --verify checks, a live run needs --backup-done
//   ai-setup [--test] [--seed-local]            the AI database: logins hms_ai_owner / hms_ai_app, databases hms_ai and hms_ai_test (--test: only the test one), random passwords into the env files; --seed-local adds AI database "main" to the map of the LOCAL hms and hms_test
//   ai-setup --hosted [--database n]            the same on a hosted PostgreSQL with no superuser: needs PG_CONSOLE_URL in db/.env.local and AI_OWNER_PASSWORD / AI_APP_PASSWORD in the environment; prints names only
//   ai-migrate [--dry-run] [--test]             the AI migrations (common/db/migrations/ai) into the database AI_OWNER_URL (or AI_TEST_OWNER_URL) points at, as hms_ai_owner
//   reset-test                                 empties the hms_test database (platform schema, every hotel schema and hotel role); never touches hms
// Nothing here prints a secret: messages carry names, counts and file names only.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupDatabase, restoreCheck } from "./backup";
import { checkBackupFile } from "./backup-check";
import { createEnvStore } from "./env-store";
import { createHotel, syncHotelGrants } from "./create-hotel";
import { createUser } from "./create-user";
import { dropHotelSchema } from "./hotel-data";
import { listHotelSchemas } from "./hotel-schemas";
import { legacyUuidSearchPath, loadMigrationFiles, runMigrations, type MigrationClient, type MigrationEvent } from "./migrate";
import { connectPg, pgWithDatabase } from "./pg-db";
import { PG_BIN, startPg, stopPg, statusPg, type PgInstanceDeps } from "./pg-instance";
import { isHotelSchemaName, LEGACY_SCHEMA } from "./schema-names";
import { buildHostedSql } from "./export-hosted-sql";
import { hostedSecretsFile, runHostedSetup, runPgSetup } from "./pg-setup";

const root = path.join(__dirname, "..");
// two files: script-only secrets (PGSUPERUSER_URL, PG_OWNER_URL, PG_TEST_OWNER_URL) in db/.env.local; what the app reads in web-app/.env.local
// HMS_SCRIPT_ENV_FILE / HMS_APP_ENV_FILE point the scripts (and the database tests) at other env files, so a throwaway server can be tried without touching the real ones
const scriptEnvFile = process.env.HMS_SCRIPT_ENV_FILE ?? path.join(root, ".env.local");
const appEnvFile = process.env.HMS_APP_ENV_FILE ?? path.join(root, "..", "..", "web-app", ".env.local");
/** Names that no longer exist: the MySQL, tenant-key and encryption-key settings. Removed from the env files by `setup`. */
const RETIRED_NAMES = ["MYSQL_ROOT_URL", "MYSQL_OWNER_URL", "HMS_TENANT_KEY", "HMS_DATA_KEYS", "HMS_BLIND_INDEX_KEY"];

const files = () => ({
  platformMigrations: loadMigrationFiles(path.join(root, "migrations", "platform")),
  hotelMigrations: loadMigrationFiles(path.join(root, "migrations", "hotel")),
  platformSeeds: loadMigrationFiles(path.join(root, "seeds", "platform")),
  hotelSeeds: loadMigrationFiles(path.join(root, "seeds", "hotel")),
});

const say = (message: string): void => {
  process.stdout.write(`${message}\n`);
};
const show = (event: MigrationEvent): void => {
  if (event.event === "plan") say(`${event.schema}: ${event.pending.length} pending, ${event.applied} applied`);
  else if (event.event === "applied") say(`${event.schema}: applied ${event.version}`);
  else if (event.event === "failed") say(`${event.schema}: FAILED ${event.version} (SQLSTATE ${event.sqlState})`);
  else say(event.message);
};

function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...args] = argv;
  const scriptEnv = createEnvStore(scriptEnvFile);
  const appEnv = createEnvStore(appEnvFile);
  const instanceDeps: PgInstanceDeps = { env: scriptEnv, say };

  if (command === "instance") {
    if (args[0] === "ensure" || args[0] === "start") await startPg(instanceDeps);
    else if (args[0] === "stop") await stopPg(instanceDeps);
    else if (args[0] === "status") say(`HMS PostgreSQL: ${await statusPg(instanceDeps)}`);
    else throw new Error("Usage: cli.ts instance ensure | stop | status");
    return;
  }

  if (command === "export-hosted-sql") {
    // no database is touched: the files are made from the migration and seed files of this commit (db/hosted-sql/ is git-ignored)
    const out = path.resolve(option(args, "--out") ?? path.join(root, "hosted-sql"));
    const f = files();
    const referenceFile = path.join(root, "hosted-sql-reference.json");
    const made = buildHostedSql({
      platformMigrations: f.platformMigrations,
      platformSeeds: f.platformSeeds,
      hotelMigrations: f.hotelMigrations,
      hotelSeeds: f.hotelSeeds,
      hotelName: option(args, "--hotel-name") ?? "Hotel Demo",
      hotelSlug: option(args, "--hotel-slug") ?? "hotel-demo",
      reference: existsSync(referenceFile) ? (JSON.parse(readFileSync(referenceFile, "utf8")) as { platformTables: number; hotelTables: number }) : undefined,
    });
    mkdirSync(out, { recursive: true });
    for (const old of readdirSync(out)) if (/^part-\d\d-.*\.sql$/.test(old) || old === "README.md") rmSync(path.join(out, old));
    for (const file of made) writeFileSync(path.join(out, file.name), file.text, { encoding: "utf8" });
    say(`Wrote ${made.length - 1} SQL parts and README.md to ${out}. Paste them in order (README.md lists the order). No password or account is inside.`);
    return;
  }
  if (command === "setup" && args.includes("--hosted")) {
    await runHostedSetup({ scriptEnv, secretsStore: createEnvStore(hostedSecretsFile(root, process.env)), connect: (url) => connectPg(url), random: randomBytes, say, withTestDatabase: args.includes("--with-test-db"), database: option(args, "--database") });
    return;
  }

  if (command === "setup") {
    // a DATABASE_URL left over from MySQL is retired too, so setup writes the PostgreSQL one
    const oldUrl = appEnv.get("DATABASE_URL");
    const retired = [...scriptEnv.remove(RETIRED_NAMES.filter((n) => n.startsWith("MYSQL"))), ...appEnv.remove(RETIRED_NAMES.filter((n) => !n.startsWith("MYSQL")))];
    if (oldUrl !== undefined && !/^postgres(ql)?:\/\//.test(oldUrl)) retired.push(...appEnv.remove(["DATABASE_URL"]));
    if (retired.length > 0) say(`Removed retired names from the env files: ${retired.join(", ")}.`);
    await runPgSetup({ scriptEnv, appEnv, ensureInstance: args.includes("--external") ? async () => undefined : () => startPg(instanceDeps), connect: (url) => connectPg(url), random: randomBytes, say });
    return;
  }

  if (command === "reset-test") {
    const superUrl = scriptEnv.get("PGSUPERUSER_URL");
    if (!superUrl) throw new Error("PGSUPERUSER_URL is not set in db/.env.local");
    const sup = await connectPg(pgWithDatabase(superUrl, "hms_test"));
    try {
      // a hotel's schema is named for the hotel since migration 0172, so the hotels' own list says which schemas and roles are theirs (the old hotel_<hex> pattern still counts)
      const listed = await sup.query("SELECT schema_name AS s, role_name AS r FROM platform.hotels").then((x) => x.rows, () => [] as Record<string, unknown>[]);
      const old = (await sup.query("SELECT nspname AS s FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^hotel_[0-9a-f]{32}$'")).rows.map((r) => String(r.s));
      const hotelSchemas = [...new Set([...old, ...listed.map((r) => String(r.s))])].filter((s) => s === "platform" || isHotelSchemaName(s));
      const present = new Set((await sup.query("SELECT nspname AS s FROM pg_namespace")).rows.map((r) => String(r.s)));
      const schemas = hotelSchemas.filter((s) => present.has(s));
      const hotelRoles = [...new Set([...schemas.filter((s) => s !== "platform" && LEGACY_SCHEMA.test(s)).map((s) => `${s}_rw`), ...listed.map((r) => String(r.r))])];
      for (const schema of schemas) await sup.query(`DROP SCHEMA "${schema}" CASCADE`);
      // roles belong to the whole server: only the roles of the schemas dropped here (this database's hotels), never the dev database's
      const roles = hotelRoles;
      for (const role of roles) await sup.query(`DROP ROLE IF EXISTS "${role}"`);
      say(`hms_test emptied: ${schemas.length} schemas and ${roles.length} hotel roles removed.`);
    } finally {
      await sup.end();
    }
    return;
  }

  if (command === "backup-check") {
    const file = option(args, "--file");
    if (!file) throw new Error("say which file: backup-check --file <backup-....ndjson.gz> [--sha256 <hex from platform.hotel_backups>]");
    const r = checkBackupFile(path.resolve(file), option(args, "--sha256"));
    const tables = Object.keys(r.tables).length;
    const rows = Object.values(r.tables).reduce((a, b) => a + b, 0);
    say(`Backup check of ${path.basename(file)}: OK. ${r.bytes} bytes, sha256 ${r.sha256.slice(0, 16)}..., ${r.lines} lines: hotel ${r.hotelId ?? "?"}, ${r.kinds.user ?? 0} people, ${r.kinds.membership ?? 0} memberships, ${r.kinds.status_history ?? 0} status changes, ${rows} rows in ${tables} tables.`);
    for (const [table, n] of Object.entries(r.tables).sort()) say(`  ${table}: ${n}`);
    return;
  }

  if (command === "backup" || command === "restore-check") {
    const useTestDb = args.includes("--test");
    const url = scriptEnv.get(useTestDb ? "PG_TEST_OWNER_URL" : "PG_OWNER_URL");
    if (!url) throw new Error("the owner URL is not set in db/.env.local; run `setup` first");
    const tools = { bin: process.env.PG_BIN ?? (process.platform === "win32" ? PG_BIN : "") };
    const dir = path.resolve(option(args, "--out") ?? path.join(root, "dumps", "backups"));
    if (command === "backup") {
      const made = await backupDatabase({ url, dir, tools });
      say(`Backup written: ${made.file} (${made.bytes} bytes, sha256 ${made.sha256.slice(0, 16)}...). Keep it OFF this machine too, and keep the media folder with it.`);
    } else {
      const superUrl = scriptEnv.get("PGSUPERUSER_URL");
      if (!superUrl) throw new Error("PGSUPERUSER_URL is not set in db/.env.local (the restore check needs to create a scratch database)");
      const file = option(args, "--file") ?? (await backupDatabase({ url, dir, tools })).file;
      const r = await restoreCheck({ file, superUrl, ownerUrl: url, tools });
      say(`Restore check of ${path.basename(file)}: ${r.same ? "OK, the restored copy matches the source" : "DIFFERENT"} (source ${JSON.stringify(r.source)}, restored ${JSON.stringify(r.restored)}, restore errors ${r.warnings}).`);
      if (!r.same) throw new Error("the restored copy differs from the source");
    }
    return;
  }

  const useTest = args.includes("--test");
  const ownerUrl = scriptEnv.get(useTest ? "PG_TEST_OWNER_URL" : "PG_OWNER_URL");
  if (!ownerUrl) throw new Error(`${useTest ? "PG_TEST_OWNER_URL" : "PG_OWNER_URL"} is not set in db/.env.local; run \`setup\` first`);
  const f = files();
  const owner = await connectPg(ownerUrl);
  try {
    // only hotels that HAVE a schema (db/scripts/hotel-schemas.ts)
    const listHotels = (): Promise<string[]> => listHotelSchemas(owner);
    const client: MigrationClient = owner;
    if (command === "migrate") {
      await runMigrations({ client, platformFiles: f.platformMigrations, hotelFiles: f.hotelMigrations, listHotelSchemas: listHotels, dryRun: args.includes("--dry-run"), report: show, searchPathExtra: await legacyUuidSearchPath(client) });
      if (!args.includes("--dry-run")) for (const schema of await listHotels()) await syncHotelGrants(owner, schema, f.hotelMigrations);
    } else if (command === "seed") {
      await runMigrations({ client, kind: "seeds", platformFiles: f.platformSeeds, hotelFiles: f.hotelSeeds, listHotelSchemas: listHotels, report: show, searchPathExtra: await legacyUuidSearchPath(client) });
    } else if (command === "clear-rate-limits") {
      // DEV tool: forgets every throttle counter (sign-in tries per address, code sends ...) so live testing is not locked out; only counters, nothing else
      await owner.query("DELETE FROM platform.rate_limits");
      say(`Cleared the throttle counters${useTest ? " on the test database" : ""}.`);
    } else if (command === "seal-numbers") {
      // decision 74: seal the ID numbers that are still plain. --dry-run counts; --verify opens every sealed number and compares; a live run needs --backup-done (take `backup` first).
      const { sealNumbers, listHotels: listHotelRefs } = await import("./seal-numbers");
      const dryRun = args.includes("--dry-run");
      const verify = args.includes("--verify");
      if (!dryRun && !verify && !args.includes("--backup-done")) throw new Error("take a backup first (db:cli backup, and keep a copy off this machine), then run again with --backup-done. Use --dry-run to only count.");
      const keyText = appEnv.get("HMS_DATA_KEY") ?? process.env.HMS_DATA_KEY;
      let seal: import("../../../web-app/src/server/crypto/fieldSeal").FieldSeal | null = null;
      if (keyText) {
        const { createFieldSeal, parseDataKey } = await import("../../../web-app/src/server/crypto/fieldSeal");
        seal = createFieldSeal(parseDataKey(keyText));
      } else if (!dryRun) throw new Error("HMS_DATA_KEY is not set in web-app/.env.local (or the environment): nothing can be sealed or checked");
      const only = option(args, "--hotel");
      const hotels = (await listHotelRefs(owner)).filter((h) => only === undefined || h.schema === only);
      if (only !== undefined && hotels.length === 0) throw new Error("no hotel with that schema name");
      const done = await sealNumbers(owner, hotels, seal, { dryRun, verify, say });
      const wrong = done.reduce((n, x) => n + x.mismatched, 0);
      say(verify ? `Checked ${done.reduce((n, x) => n + x.checked, 0)} sealed numbers: ${wrong} wrong, ${done.reduce((n, x) => n + x.pending, 0)} still plain only.` : dryRun ? `Dry run: ${done.reduce((n, x) => n + x.pending, 0)} number(s) to seal in ${hotels.length} hotel(s). Nothing was changed.` : `${done.reduce((n, x) => n + x.sealed, 0)} number(s) sealed in ${hotels.length} hotel(s).`);
      if (wrong > 0) process.exitCode = 1;
    } else if (command === "rename-schemas") {
      // readable hotel schemas (MJ, 2 Nov 2026): a dry run shows exactly what would be renamed and keeps nothing; --apply renames one hotel per transaction. Take a backup first.
      const { renameHotelSchemas } = await import("./rename-hotel-schemas");
      const apply = args.includes("--apply");
      const done = await renameHotelSchemas(owner, { apply, report: say });
      say(apply ? `${done.length} hotel schema(s) renamed.` : `Dry run: ${done.length} hotel schema(s) would be renamed. Nothing was changed; add --apply to do it (after a backup).`);
    } else if (command === "drop-hotel-schema") {
      const schema = args.find((a) => isHotelSchemaName(a));
      if (!schema) throw new Error("drop-hotel-schema needs the hotel's schema name, for example sunrise_group_hotel_sunrise_rajkot");
      const deleted = await owner.query("SELECT 1 AS found FROM platform.hotels WHERE schema_name = $1 AND status = 'deleted'", [schema]);
      if (deleted.rows.length === 0) throw new Error("That schema does not belong to a hotel recorded as deleted; refusing to drop it");
      await dropHotelSchema(owner, schema);
      say(`Dropped ${schema} and its role.`);
    } else if (command === "create-hotel") {
      const name = option(args, "--name");
      const slug = option(args, "--slug");
      if (!name || !slug) throw new Error('create-hotel needs --name "Hotel name" --slug hotel-slug');
      const created = await createHotel({ owner, hotelMigrations: f.hotelMigrations, hotelSeeds: f.hotelSeeds, report: say, searchPathExtra: await legacyUuidSearchPath(owner) }, { name, slug });
      say(`Created ${created.schema}`);
    } else if (command === "demo-hotels") {
      // sample hotels with a little data (2 groups, 2 individual hotels); refuses a database that holds a real hotel. The logins go to db/.dev-login.txt (git-ignored), never to the screen
      const { createDemoHotels } = await import("./demo-hotels");
      const { createArgon2Hasher } = await import("../../../web-app/src/server/auth/password");
      const { randomTempPassword } = await import("../../../web-app/src/server/services/auth/credentialService");
      const hasher = createArgon2Hasher();
      const loginFile = path.join(root, ".dev-login.txt");
      const summary = await createDemoHotels({
        owner,
        hotelMigrations: f.hotelMigrations,
        hotelSeeds: f.hotelSeeds,
        searchPathExtra: await legacyUuidSearchPath(owner),
        newPassword: async () => {
          const plain = randomTempPassword();
          return { plain, hash: await hasher.hash(plain) };
        },
        saveLogin: (username, password) => appendFileSync(loginFile, `username: ${username}\nDEMO password (no first change): ${password}\n\n`, { encoding: "utf8", mode: 0o600 }),
        say,
      });
      say(`Demo hotels: ${summary.hotelsCreated} made, ${summary.hotelsSkipped} already there; ${summary.groupsCreated} groups; ${summary.accountsCreated} accounts. The logins are in ${loginFile} (git-ignored).`);
    } else if (command === "create-user") {
      const username = option(args, "--username");
      const name = option(args, "--name");
      const email = option(args, "--email");
      if (!username || !name || !email) throw new Error('create-user needs --username u --name "Full Name" --email someone@example.com');
      // the hasher and the password rules are the app's own (loaded here, not copied)
      const { createArgon2Hasher } = await import("../../../web-app/src/server/auth/password");
      const { randomTempPassword } = await import("../../../web-app/src/server/services/auth/credentialService");
      const temporary = randomTempPassword();
      const id = await createUser(owner, { username, displayName: name, email, accountRole: option(args, "--account-role") ?? "hotel_admin", roleKey: option(args, "--role") ?? "admin", hotelSlug: option(args, "--hotel") }, await createArgon2Hasher().hash(temporary));
      if (args.includes("--write-file")) {
        const file = path.join(root, ".dev-login.txt");
        // appended, so several accounts made one after the other all stay in the file
        appendFileSync(file, `username: ${username}
temporary password (use once, you will be asked to choose your own): ${temporary}

`, { encoding: "utf8", mode: 0o600 });
        say(`Created ${username} (${id}). The one-time temporary password is in ${file} (git-ignored).`);
      } else {
        say(`Created ${username} (${id}). Temporary password, shown once: ${temporary}`);
      }
      say("The person must choose their own password at the first sign-in.");
    } else if (command === "dev-password" || command === "smoke-codes" || command === "perf-hotel") {
      // DEV tools for local live tests, refused unless the database is on this machine (a real server is never reached by these)
      const host = new URL(ownerUrl).hostname;
      if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`${command} is a local development tool; the database is not on this machine`);
      if (command === "perf-hotel") {
        const { PERF_NAME, PERF_SLUG, perfCounts, perfDataStatements } = await import("./perf-hotel");
        const found = (await owner.query("SELECT id, schema_name FROM platform.hotels WHERE slug = $1", [PERF_SLUG])).rows[0] as { id: string; schema_name: string } | undefined;
        if (args[0] === "create") {
          if (found) throw new Error(`${PERF_NAME} exists already; run perf-hotel remove first`);
          const created = await createHotel({ owner, hotelMigrations: f.hotelMigrations, hotelSeeds: f.hotelSeeds, report: say }, { name: PERF_NAME, slug: PERF_SLUG });
          const { createArgon2Hasher } = await import("../../../web-app/src/server/auth/password");
          const { randomTempPassword } = await import("../../../web-app/src/server/services/auth/credentialService");
          const password = randomTempPassword();
          const userId = await createUser(owner, { username: "perf.admin", displayName: "PERF Admin", email: "perf.admin@example.test", accountRole: "hotel_admin", roleKey: "admin", hotelSlug: PERF_SLUG }, await createArgon2Hasher().hash(password));
          await owner.query("UPDATE platform.logins SET must_change_password = false, status = 'active', password_changed_at = now() WHERE id = $1", [userId]);
          appendFileSync(path.join(root, ".dev-login.txt"), `username: perf.admin\nDEV password (set ${new Date().toISOString()} by perf-hotel create, no first change): ${password}\n\n`, { encoding: "utf8", mode: 0o600 });
          await owner.query("BEGIN");
          try {
            await owner.query(`SET LOCAL search_path TO "${created.schema}"`);
            for (const sql of perfDataStatements(userId)) await owner.query(sql);
            await owner.query("COMMIT");
          } catch (error) {
            await owner.query("ROLLBACK");
            throw error;
          }
          await owner.query(`ANALYZE`);
          say(`${PERF_NAME} (${created.schema}) filled: ${JSON.stringify(await perfCounts(owner, created.schema))}. Sign in as perf.admin; the password is in db/.dev-login.txt (git-ignored).`);
        } else if (args[0] === "remove") {
          if (!found) throw new Error(`${PERF_NAME} does not exist`);
          // the accounts: removed where nothing refers to them, otherwise soft-deleted and renamed so a new run can use the names again
          for (const u of (await owner.query("SELECT id, username FROM platform.people WHERE username LIKE 'perf.%'")).rows as { id: string; username: string }[]) {
            try {
              await owner.query("DELETE FROM platform.logins WHERE id = $1", [u.id]);
            } catch {
              await owner.query("SELECT platform.change_person($1::uuid, $2::jsonb)", [u.id, JSON.stringify({ deleted_at: new Date().toISOString(), status: "disabled", username: `${u.username}-removed-${Date.now()}`, email: `removed-${Date.now()}-${u.id.slice(0, 8)}@example.test` })]);
            }
          }
          await owner.query("UPDATE platform.hotels SET status = 'deleted', deleted_at = now(), slug = $2 WHERE id = $1", [found.id, `${PERF_SLUG}-removed-${Date.now()}`]);
          await dropHotelSchema(owner, found.schema_name);
          say(`${PERF_NAME} removed: accounts gone, hotel recorded as deleted, ${found.schema_name} and its role dropped.`);
        } else {
          throw new Error("perf-hotel create | remove");
        }
      } else if (command === "dev-password") {
        const usernames = args.filter((a) => !a.startsWith("--"));
        if (usernames.length === 0) throw new Error("dev-password needs one or more usernames");
        const { createArgon2Hasher } = await import("../../../web-app/src/server/auth/password");
        const { randomTempPassword } = await import("../../../web-app/src/server/services/auth/credentialService");
        const hasher = createArgon2Hasher();
        const file = path.join(root, ".dev-login.txt");
        for (const username of usernames) {
          const password = randomTempPassword();
          // a usable password (no first-change step), the timed lock and the wrong-try count cleared, an invited account made active; an administrator's block stays
          const r = await owner.query(
            "UPDATE platform.logins SET password_hash = $2, must_change_password = false, password_changed_at = now(), failed_attempts = 0, lock_level = 0, locked_until = NULL, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE username = $1 AND deleted_at IS NULL RETURNING blocked_at IS NOT NULL AS blocked",
            [username, await hasher.hash(password)],
          );
          if (r.rows.length === 0) {
            say(`${username}: no such account, skipped.`);
            continue;
          }
          appendFileSync(file, `username: ${username}\nDEV password (set ${new Date().toISOString()} by dev-password, no first change): ${password}\n\n`, { encoding: "utf8", mode: 0o600 });
          say(`${username}: new dev password written to ${file} (git-ignored)${r.rows[0].blocked ? "; the account is BLOCKED by an administrator, unblock it in the console" : ""}.`);
        }
      } else {
        // a production build has no log mail driver: on this machine, with no mail server, its sign-in codes wait in the outbox (payload kept until sent or
        // given up). This copies the waiting ones (last 15 minutes) into db/.dev-mail.log in the log driver's format, so the live-test harness reads them there.
        const rows = (await owner.query("SELECT o.kind, o.to_email, o.payload, o.created_at FROM platform.outbox o WHERE o.kind IN ('login_code', 'reset_link') AND o.status = 'pending' AND o.payload IS NOT NULL AND o.created_at > now() - interval '15 minutes' ORDER BY o.created_at")).rows;
        const file = path.join(root, ".dev-mail.log");
        for (const row of rows) {
          const payload = JSON.parse(String(row.payload)) as { code?: unknown; link?: unknown };
          const text =
            row.kind === "reset_link"
              ? `Subject: Reset your HMS password (copied from the outbox by smoke-codes)\n\nOpen this link to choose a new password:\n${String(payload.link ?? "")}\n\n`
              : `Subject: Your HMS sign-in code (copied from the outbox by smoke-codes)\n\nYour sign-in code is ${String(payload.code ?? "")}. It works for 10 minutes.\n\n`;
          appendFileSync(file, `----- ${new Date(row.created_at as string).toISOString()}\nTo: ${String(row.to_email)}\n${text}`, { encoding: "utf8", mode: 0o600 });
        }
        say(`Copied ${rows.length} waiting sign-in code / reset link mail(s) into ${file} (git-ignored).`);
      }
    } else {
      throw new Error("Usage: cli.ts instance | setup | migrate [--dry-run] [--test] | seed [--test] | create-hotel --name <name> --slug <slug> [--test] | create-user --username <u> --name <n> --email <e> | reset-test");
    }
  } finally {
    await owner.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // the message of our own errors names the problem and never a value; a driver error is reduced to its name and code
    const code = typeof error === "object" && error !== null && "code" in error ? ` (${String((error as { code: unknown }).code)})` : "";
    process.stderr.write(`${error instanceof Error ? error.name + ": " + error.message : "Failed"}${code}\n`);
    process.exit(1);
  });
}
