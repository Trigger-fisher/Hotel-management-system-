// The tenant isolation suite on the REAL PostgreSQL instance. Two hotels made by the real create-hotel, each reached only through its OWN
// role (SET LOCAL ROLE hotel_<hex>_rw inside withHotel). The point: one hotel can never see, change or even list another hotel's data, by any
// route (the app's withHotel, a qualified name, stacked statements), and hms_app, the web app's own login, holds nothing on any hotel schema.
// create-hotel is all-or-nothing. Run with:   npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createHotel, CreateHotelError, hardDeleteTables, type CreatedHotel } from "../../../common/db/scripts/create-hotel";
import { runMigrations, toMigrationFile, MIGRATION_LOCK_KEY } from "../../../common/db/scripts/migrate";
import { connectPg, type DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { hotelRoleName } from "../../src/db/schemaName";
import { classifyPgError } from "../../src/server/db/pgErrors";
import { newId } from "../../src/server/db/ids";
import { AppError } from "../../src/server/errors";
import { appUrl, connectApp, connectOwner, sqlStateOf, tag, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, hotelMigrations, hotelSeeds, insertRow, removeAllTestHotels } from "./helpers/hotels";

let owner: DbClient;
let app: DbClient;
let A: CreatedHotel;
let B: CreatedHotel;
let database: Database;

const as = <T>(hotel: CreatedHotel, work: (tx: import("../../src/db/types").TxClient) => Promise<T>): Promise<T> => database.withHotel({ hotelId: hotel.id }, work);

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  A = await createTestHotel(owner, "Hotel Alpha");
  B = await createTestHotel(owner, "Hotel Beta");
  app = await connectApp();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
});

after(async () => {
  await database?.close();
  await app?.end();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe("two-hotel isolation through withHotel (the app's own door)", () => {
  test("READ: a row written in hotel A cannot be selected from hotel B (by id, SELECT *, joins, subqueries)", async () => {
    const company = await as(A, (tx) => insertRow(tx, A.schema, "company_profiles", { name: "Only In Alpha" }));
    const inB = await as(B, async (tx) => ({
      byId: (await tx.query("SELECT id FROM company_profiles WHERE id = $1", [company.id])).rows.length,
      all: (await tx.query("SELECT id FROM company_profiles")).rows.length,
      joined: (await tx.query("SELECT c.id FROM company_profiles c JOIN business_units u ON true WHERE c.id = $1", [company.id])).rows.length,
      sub: (await tx.query("SELECT (SELECT COUNT(*) FROM company_profiles WHERE name = 'Only In Alpha') AS n")).rows[0].n,
    }));
    assert.deepEqual(inB, { byId: 0, all: 0, joined: 0, sub: "0" });
    assert.equal((await as(A, (tx) => tx.query("SELECT id FROM company_profiles WHERE id = $1", [company.id]))).rows.length, 1);
  });

  test("UPDATE and DELETE inside hotel B that target hotel A's row id change 0 rows", async () => {
    const company = await as(A, (tx) => insertRow(tx, A.schema, "company_profiles", { name: "Untouchable" }));
    const result = await as(B, async (tx) => ({
      update: (await tx.query("UPDATE company_profiles SET name = 'Hacked' WHERE id = $1", [company.id])).affectedRows,
      remove: (await tx.query("DELETE FROM company_profiles WHERE id = $1", [company.id])).affectedRows,
    }));
    assert.deepEqual(result, { update: 0, remove: 0 });
    assert.equal(String((await as(A, (tx) => tx.query("SELECT name FROM company_profiles WHERE id = $1", [company.id]))).rows[0].name), "Untouchable");
  });

  test("LIST, SEARCH, COUNT and aggregates in hotel B ignore everything in hotel A, and the other way round", async () => {
    for (let i = 0; i < 3; i++) await as(A, (tx) => insertRow(tx, A.schema, "hotel_cash_deposits", { entry_no: 700 + i, amount_paise: 100 * (i + 1) }));
    await as(B, (tx) => insertRow(tx, B.schema, "hotel_cash_deposits", { entry_no: 700, amount_paise: 5 }));
    const sum = (hotel: CreatedHotel) => as(hotel, async (tx) => (await tx.query("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS s FROM hotel_cash_deposits WHERE entry_no >= 700 AND entry_no < 800")).rows[0]);
    assert.deepEqual(await sum(A), { n: "3", s: "600" });
    assert.deepEqual(await sum(B), { n: "1", s: "5" });
  });

  test("a qualified name for another hotel is refused (permission denied), and so is the platform schema", async () => {
    assert.equal(await sqlStateOf(as(B, (tx) => tx.query(`SELECT * FROM "${A.schema}".company_profiles`))), "42501");
    assert.equal(await sqlStateOf(as(B, (tx) => tx.query(`INSERT INTO "${A.schema}".id_proof_types (name) VALUES ('x')`))), "42501");
    assert.equal(await sqlStateOf(as(B, (tx) => tx.query("SELECT * FROM platform.people"))), "42501");
    assert.equal(await sqlStateOf(as(B, (tx) => tx.query("SELECT * FROM platform.audit_log"))), "42501");
  });

  test("stacked statements are refused: an injected `RESET ROLE; SET ROLE ...` can never ride along on a query (the extended protocol takes one statement)", async () => {
    for (const text of ["SELECT 1; RESET ROLE", `SELECT 1; SET LOCAL ROLE "${hotelRoleName(A.id)}"`, "SELECT 1;SELECT 2", "SELECT 1 -- x\n; SELECT 2"]) {
      await assert.rejects(() => as(B, (tx) => tx.query(text)), (e) => e instanceof AppError && e.code === "SERVER_ERROR", text);
    }
    // a semicolon inside a literal, a comment or a dollar-quoted body is not a second statement
    assert.equal(Number((await as(B, async (tx) => (await tx.query("SELECT ';' AS a, 1 AS n -- done; really\n;")).rows[0].n))), 1);
  });

  test("an unqualified table name always means THIS hotel's table, and the setting is gone when withHotel returns (commit and error)", async () => {
    const seen = await as(A, async (tx) => ({ who: (await tx.query("SELECT current_user AS u, current_schema() AS s")).rows[0] }));
    assert.deepEqual(seen.who, { u: hotelRoleName(A.id), s: A.schema });
    await assert.rejects(() => as(A, async (tx) => { await insertRow(tx, A.schema, "company_profiles", { name: "Rolled Back" }); throw new Error("boom"); }), /boom/);
    assert.equal((await as(A, (tx) => tx.query("SELECT 1 FROM company_profiles WHERE name = 'Rolled Back'"))).rows.length, 0, "rolled-back work is gone");
    // a connection taken straight from the pool afterwards is hms_app again, with the default search_path
    const raw = await database.pool.connect();
    try {
      const row = (await raw.query("SELECT current_user AS u, current_setting('search_path') AS p, now() = statement_timestamp() AS fresh")).rows[0];
      assert.equal(row.u, "hms_app");
      assert.ok(!String(row.p).includes("hotel_"));
    } finally {
      raw.release();
    }
  });

  test("every leased connection is UTC with the role's time limits", async () => {
    const row = await as(A, async (tx) => (await tx.query("SELECT current_setting('timezone') AS tz, current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt, current_setting('idle_in_transaction_session_timeout') AS it")).rows[0]);
    assert.deepEqual(row, { tz: "UTC", st: "15s", lt: "5s", it: "10s" });
  });

  test("a hostile hotel id is refused before any connection is taken", async () => {
    for (const bad of ["", "x", "hotel_abc", "'; DROP SCHEMA platform; --", A.id.toUpperCase(), `${A.id} `, "00000000-0000-0000-0000-00000000000g", null, undefined, 42, { toString: () => A.id }]) {
      await assert.rejects(() => database.withHotel({ hotelId: bad as never }, async () => 1), (e) => e instanceof AppError && e.code === "FORBIDDEN", String(bad));
    }
    assert.equal(database.pool.waitingCount, 0);
  });

  test("a hotel that does not exist has a valid-looking id but no role: the unit fails and leaves the pool healthy", async () => {
    await assert.rejects(() => database.withHotel({ hotelId: newId() }, async () => 1), (e) => e instanceof AppError && e.code === "FORBIDDEN");
    assert.equal(await as(A, async (tx) => Number((await tx.query("SELECT 1 AS n")).rows[0].n)), 1);
  });
});

describe("the per-hotel role: it reaches its own schema and nothing else", () => {
  test("it cannot grant itself or anyone anything", async () => {
    await as(A, (tx) => tx.query("GRANT SELECT ON company_profiles TO PUBLIC")); // the server only warns: the role holds no grant option, nothing is granted
    const acl = await owner.query("SELECT relacl::text AS a FROM pg_class WHERE oid = to_regclass($1)", [`"${A.schema}".company_profiles`]);
    assert.ok(!/(^|[{,])=/.test(String(acl.rows[0].a)), "PUBLIC holds nothing");
  });

  test("it cannot change structure, make roles, or touch the server", async () => {
    for (const statement of [
      "CREATE TABLE sneaky (id int)",
      "ALTER TABLE company_profiles ADD COLUMN sneaky int",
      "DROP TABLE company_profiles",
      "TRUNCATE company_profiles",
      "CREATE SCHEMA sneaky",
      "CREATE ROLE sneaky",
      "CREATE TABLE public.sneaky (id int)",
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ]) {
      assert.equal(await sqlStateOf(as(A, (tx) => tx.query(statement))), "42501", statement);
    }
  });

  test("it cannot read or write the runner's own tables (schema_migrations, schema_seeds)", async () => {
    for (const table of ["schema_migrations", "schema_seeds"]) {
      assert.equal(await sqlStateOf(as(A, (tx) => tx.query(`SELECT * FROM ${table}`))), "42501", table);
      assert.equal(await sqlStateOf(as(A, (tx) => tx.query(`DELETE FROM ${table}`))), "42501", table);
    }
  });

  test("DELETE works on exactly the marked tables and is refused on every other one", async () => {
    const marked = new Set(hardDeleteTables(hotelMigrations()));
    assert.ok(marked.size >= 40, `${marked.size} marked tables`);
    const rows = await owner.query(
      "SELECT c.relname AS t, has_table_privilege($2, c.oid, 'DELETE') AS del, has_table_privilege($2, c.oid, 'SELECT') AS sel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname NOT LIKE 'schema\\_%'",
      [A.schema, hotelRoleName(A.id)],
    );
    // every table of a hotel schema (the Pathik tables were removed in 2026-11; the Conversations tables are all marked, the stored mail of hotel 0053 too); a new table raises this and must be marked, or not, below
    assert.equal(rows.rows.length, 86);
    for (const r of rows.rows) {
      assert.equal(r.sel, true, `${String(r.t)} readable`);
      assert.equal(r.del, marked.has(String(r.t)), `${String(r.t)} delete`);
    }
    const unmarked = String(rows.rows.find((r) => !marked.has(String(r.t)))?.t);
    assert.equal(await sqlStateOf(as(A, (tx) => tx.query(`DELETE FROM "${unmarked}" WHERE false`))), "42501", unmarked);
    assert.equal(await sqlStateOf(as(A, (tx) => tx.query("DELETE FROM expense_lines WHERE false"))), null);
  });

  test("a table that a LATER migration adds is usable by that hotel's role once the grants are synced, and by nobody else", async () => {
    const extra = toMigrationFile("0090_later_table", "-- rollback: DROP TABLE IF EXISTS later_table;\nCREATE TABLE later_table (id uuid PRIMARY KEY DEFAULT uuidv7(), note text);\n");
    const result = await runMigrations({ client: owner, platformFiles: [], hotelFiles: [...hotelMigrations(), extra], listHotelSchemas: async () => [A.schema], skipPlatform: true });
    assert.deepEqual(result.applied.map((x) => x.version), ["0090_later_table"]);
    await as(A, (tx) => tx.query("INSERT INTO later_table (note) VALUES ('hi')"));
    assert.equal(await sqlStateOf(as(B, (tx) => tx.query(`SELECT * FROM "${A.schema}".later_table`))), "42501");
    assert.equal(await sqlStateOf(as(A, (tx) => tx.query("DELETE FROM later_table WHERE false"))), "42501", "no DELETE unless the table is marked");
    await owner.query(`DROP TABLE "${A.schema}".later_table`);
    await owner.query(`DELETE FROM "${A.schema}".schema_migrations WHERE version = '0090_later_table'`);
  });

  test("the roles are what they should be: hotel roles cannot log in, hms_app never inherits them", async () => {
    const roles = await owner.query("SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY($1)", [[hotelRoleName(A.id), hotelRoleName(B.id)]]);
    assert.equal(roles.rows.length, 2);
    for (const r of roles.rows) assert.deepEqual([r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls], [false, false, false, false, false, false]);
    const member = await owner.query("SELECT m.inherit_option AS i, m.set_option AS s FROM pg_auth_members m WHERE m.roleid = $1::regrole AND m.member = 'hms_app'::regrole", [hotelRoleName(A.id)]);
    assert.deepEqual(member.rows, [{ i: false, s: true }]);
    const login = await sqlStateOf(connectPg(appUrl().replace(/\/\/[^:]+:[^@]+@/, `//${hotelRoleName(A.id)}:nopassword@`)));
    assert.ok(login !== null, "a hotel role cannot log in");
  });
});

describe("hms_app (the web app's own login) holds nothing on any hotel schema", () => {
  test("it cannot list, read, write or enter a hotel schema, qualified or not", async () => {
    assert.equal(await sqlStateOf(app.query(`SELECT * FROM "${A.schema}".company_profiles`)), "42501");
    assert.equal(await sqlStateOf(app.query(`INSERT INTO "${A.schema}".id_proof_types (name) VALUES ('x')`)), "42501");
    assert.equal(await sqlStateOf(app.query(`CREATE TABLE "${A.schema}".sneaky (id int)`)), "42501");
    const privileges = await app.query(
      "SELECT n.nspname AS s, has_schema_privilege(current_user, n.oid, 'USAGE') AS u, has_schema_privilege(current_user, n.oid, 'CREATE') AS c FROM pg_namespace n WHERE n.nspname ~ '^hotel_'",
    );
    assert.ok(privileges.rows.length >= 2);
    for (const r of privileges.rows) assert.deepEqual([r.u, r.c], [false, false], String(r.s));
    const tableRights = await app.query(
      "SELECT COUNT(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname ~ '^hotel_' AND c.relkind = 'r' AND (has_table_privilege(current_user, c.oid, 'SELECT') OR has_table_privilege(current_user, c.oid, 'INSERT') OR has_table_privilege(current_user, c.oid, 'UPDATE') OR has_table_privilege(current_user, c.oid, 'DELETE'))",
    );
    assert.equal(Number(tableRights.rows[0].n), 0);
  });

  test("it is not a superuser and has no server-wide right", async () => {
    assert.equal(await sqlStateOf(app.query("SELECT pg_read_file('/etc/passwd')")), "42501");
    assert.equal(await sqlStateOf(app.query("ALTER SYSTEM SET work_mem = '1GB'")), "42501");
    assert.equal(await sqlStateOf(app.query("CREATE DATABASE sneaky")), "42501");
    assert.equal(await sqlStateOf(app.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'hms_owner'")), "42501");
    assert.equal(await sqlStateOf(app.query("COPY (SELECT 1) TO PROGRAM 'echo'")), "42501");
  });

  test("its refusals are 'forbidden', a duplicate is 'unique', and the messages carry no password or value", async () => {
    try {
      await app.query(`SELECT * FROM "${A.schema}".company_profiles`);
      assert.fail("expected a refusal");
    } catch (error) {
      assert.equal(classifyPgError(error).kind, "forbidden");
    }
  });
});

describe("create-hotel is all or nothing", () => {
  const counts = async (): Promise<{ schemas: number; roles: number; hotels: number; audit: number }> => ({
    schemas: Number((await owner.query("SELECT COUNT(*) AS n FROM pg_namespace WHERE nspname ~ '^hotel_[0-9a-f]{32}$'")).rows[0].n),
    roles: Number((await owner.query("SELECT COUNT(*) AS n FROM pg_roles WHERE rolname ~ '^hotel_[0-9a-f]{32}_rw$'")).rows[0].n),
    hotels: Number((await owner.query("SELECT COUNT(*) AS n FROM platform.hotels")).rows[0].n),
    audit: Number((await owner.query("SELECT COUNT(*) AS n FROM platform.audit_log WHERE action = 'hotel.create'")).rows[0].n),
  });
  const attempt = (name: string, slug: string, extra: Partial<Parameters<typeof createHotel>[0]> = {}) => createHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds(), ...extra }, { name, slug });

  test("a migration that fails (bad SQL in a later file) leaves nothing and names the file and the SQLSTATE", async () => {
    const before = await counts();
    const bad = toMigrationFile("0095_broken", "-- rollback: DROP TABLE IF EXISTS never;\nCREATE TABLE half_done (id int);\nSELECT 1 / 0;\n");
    await assert.rejects(
      () => attempt("Broken Hotel", `broken-${tag()}`, { hotelMigrations: [...hotelMigrations(), bad] }),
      (e) => e instanceof CreateHotelError && e.code === "MIGRATION_FAILED" && /0095_broken/.test(e.message) && /22012/.test(String((e.cause as Error)?.message ?? e.message + String((e.cause as { message?: string })?.message))),
    );
    assert.deepEqual(await counts(), before, "no schema, no role, no hotel row, no audit row");
  });

  test("a failing seed leaves nothing either", async () => {
    const before = await counts();
    const bad = toMigrationFile("0090_bad_seed", "-- seed: broken\nINSERT INTO business_units (name) VALUES (NULL);\n");
    await assert.rejects(() => attempt("Bad Seed", `badseed-${tag()}`, { hotelSeeds: [...hotelSeeds(), bad] }), (e) => e instanceof CreateHotelError && e.code === "MIGRATION_FAILED");
    assert.deepEqual(await counts(), before);
  });

  test("a failure after everything else worked (the audit row) still takes everything back", async () => {
    const before = await counts();
    const wrapped = new Proxy(owner, {
      get: (target, key, receiver) =>
        key === "query"
          ? (text: string, params?: readonly unknown[]) => (/INSERT INTO platform\.audit_log/.test(text) ? Promise.reject(Object.assign(new Error("injected"), { code: "XX000" })) : target.query(text, params))
          : Reflect.get(target, key, receiver),
    });
    await assert.rejects(() => attempt("Late Failure", `late-${tag()}`, { owner: wrapped as DbClient }), (e) => e instanceof CreateHotelError);
    assert.deepEqual(await counts(), before);
  });

  test("a slug that is taken is reported as such and creates nothing; two hotels get two different schemas and roles", async () => {
    const slug = `taken-${tag()}`;
    const first = await attempt("First", slug);
    const before = await counts();
    await assert.rejects(() => attempt("Second", slug), (e) => e instanceof CreateHotelError && e.code === "SLUG_TAKEN");
    assert.deepEqual(await counts(), before);
    const other = await attempt("Third", `third-${tag()}`);
    assert.notEqual(first.schema, other.schema);
  });

  test("two create-hotel runs at the same moment with one slug: exactly one wins, the other is told the slug is taken", async () => {
    const slug = `race-${tag()}`;
    const second = await connectOwner();
    try {
      const results = await Promise.allSettled([attempt("Race One", slug), attempt("Race Two", slug, { owner: second })]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.equal((lost.reason as CreateHotelError).code, "SLUG_TAKEN");
    } finally {
      await second.end();
    }
    assert.equal(Number((await owner.query("SELECT COUNT(*) AS n FROM platform.hotels WHERE slug = $1", [slug])).rows[0].n), 1);
  });

  test("hostile names and slugs are refused before anything is sent", async () => {
    const before = await counts();
    for (const [name, slug] of [["", "ok"], ["x".repeat(201), "ok"], ["Bad\u0000Name", "ok"], ["Name", "Not Valid"], ["Name", "a--b"], ["Name", "x".repeat(64)], ["Name", "'; drop schema platform; --"]]) {
      await assert.rejects(() => attempt(name, slug), (e) => e instanceof CreateHotelError && e.code === "BAD_INPUT", slug);
    }
    assert.deepEqual(await counts(), before);
  });
});

describe("migrations on hotel schemas", () => {
  test("a migration run while another holds the lock stops at once with LOCKED and touches nothing", async () => {
    const other = await connectOwner();
    try {
      await other.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await assert.rejects(() => runMigrations({ client: owner, platformFiles: [], hotelFiles: hotelMigrations(), listHotelSchemas: async () => [A.schema], skipPlatform: true }), (e: { code?: string }) => e.code === "LOCKED");
    } finally {
      await other.end();
    }
  });

  test("every hotel migration applied twice is a no-op, and a changed applied file stops the run before anything is applied", async () => {
    const files = hotelMigrations();
    const again = await runMigrations({ client: owner, platformFiles: [], hotelFiles: files, listHotelSchemas: async () => [A.schema, B.schema], skipPlatform: true });
    assert.deepEqual(again.applied, []);
    const changed = files.map((f, i) => (i === 2 ? { ...f, checksum: "f".repeat(64) } : f));
    await assert.rejects(() => runMigrations({ client: owner, platformFiles: [], hotelFiles: changed, listHotelSchemas: async () => [A.schema], skipPlatform: true }), (e: { code?: string }) => e.code === "CHECKSUM_MISMATCH");
  });

  test("the version rows say who applied them, and the hotel's own role can never see them", async () => {
    const row = await owner.query(`SELECT DISTINCT applied_by FROM "${A.schema}".schema_migrations`);
    assert.deepEqual(row.rows.map((r) => String(r.applied_by)), ["create-hotel"]);
  });
});

after(async () => {
  await releaseTestLock?.();
});
