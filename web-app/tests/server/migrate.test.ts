// The migration runner (db/scripts/migrate.ts) against a FAKE PostgreSQL client: no database, no driver. What is proven here is the runner's logic:
// order, one transaction per file per schema with the version recorded in the same transaction, immutable applied files, one run at a time, resume,
// dry run, seeds mode, and what an error message may name. The real thing runs on the instance (tests/db, npm run test:db).
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { checksumOf, loadMigrationFiles, MIGRATION_LOCK_KEY, MigrationError, runMigrations, toMigrationFile, versionTableSql, type MigrationClient, type MigrationEvent, type MigrationFile, type QueryResult } from "../../../common/db/scripts/migrate";

const H1 = `hotel_${"1".repeat(32)}`;
const H2 = `hotel_${"2".repeat(32)}`;
const ROLLBACK = "-- rollback: DROP TABLE IF EXISTS t";
const file = (version: string, body = "CREATE TABLE t (id int)", first = ROLLBACK): MigrationFile => toMigrationFile(`${version}.sql`, `${first}\n${body}\n`);
const seed = (version: string, body = "INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING"): MigrationFile => toMigrationFile(`${version}.sql`, `-- seed: test rows\n${body}\n`);

/** A fake client: schemas, version tables with their rows, a transaction buffer, and a log of every statement with the search_path in force. */
class FakePg implements MigrationClient {
  readonly log: string[] = [];
  readonly schemas = new Set<string>(["platform"]);
  readonly tables = new Map<string, { version: string; checksum: string }[]>();
  lockHeldElsewhere = false;
  failOn = new Map<string, Error>();
  private tx: { schema: string; table: string; row: { version: string; checksum: string } }[] | null = null;
  private searchPath = "";
  unlocked = 0;

  constructor(hotels: readonly string[] = []) {
    for (const h of hotels) this.schemas.add(h);
  }

  rowsOf(schema: string, table = "schema_migrations"): { version: string; checksum: string }[] {
    return this.tables.get(`${schema}.${table}`) ?? [];
  }

  async query(text: string, params: readonly unknown[] = []): Promise<QueryResult> {
    this.log.push(text.length > 90 ? `${text.slice(0, 90)}...` : text);
    if (text.startsWith("SELECT pg_try_advisory_lock")) {
      assert.deepEqual(params, [MIGRATION_LOCK_KEY]);
      return { rows: [{ locked: !this.lockHeldElsewhere }] };
    }
    if (text.startsWith("SELECT pg_advisory_unlock")) {
      this.unlocked += 1;
      return { rows: [] };
    }
    if (text.startsWith("SELECT 1 AS present FROM information_schema.schemata")) return { rows: this.schemas.has(String(params[0])) ? [{ present: 1 }] : [] };
    if (text === "CREATE SCHEMA IF NOT EXISTS platform") return { rows: [] };
    const create = /^CREATE TABLE IF NOT EXISTS "([^"]+)"\.(\w+)/.exec(text);
    if (create) {
      if (!this.tables.has(`${create[1]}.${create[2]}`)) this.tables.set(`${create[1]}.${create[2]}`, []);
      return { rows: [] };
    }
    const select = /^SELECT version, checksum FROM "([^"]+)"\.(\w+) ORDER BY version/.exec(text);
    if (select) return { rows: [...(this.tables.get(`${select[1]}.${select[2]}`) ?? [])].sort((a, b) => a.version.localeCompare(b.version)) };
    if (text.startsWith("SELECT to_regclass")) return { rows: [{ found: this.tables.has(String(params[0]).replaceAll('"', "")) ? String(params[0]) : null }] };
    if (text === "BEGIN") {
      this.tx = [];
      return { rows: [] };
    }
    if (text === "COMMIT") {
      for (const w of this.tx ?? []) this.tables.get(`${w.schema}.${w.table}`)!.push(w.row);
      this.tx = null;
      return { rows: [] };
    }
    if (text === "ROLLBACK") {
      this.tx = null;
      return { rows: [] };
    }
    if (text.startsWith("SELECT set_config('search_path'")) {
      this.searchPath = String(params[0]);
      return { rows: [] };
    }
    if (text === "RESET search_path") {
      this.searchPath = "";
      return { rows: [] };
    }
    const record = /^INSERT INTO "([^"]+)"\.(\w+) \(version, checksum, applied_by\)/.exec(text);
    if (record) {
      const row = { version: String(params[0]), checksum: String(params[1]) };
      if (this.tx) this.tx.push({ schema: record[1], table: record[2], row });
      else this.tables.get(`${record[1]}.${record[2]}`)!.push(row);
      return { rows: [] };
    }
    // a migration file
    const failure = [...this.failOn].find(([needle]) => text.includes(needle));
    if (failure) throw failure[1];
    this.log[this.log.length - 1] = `FILE[${this.searchPath}] ${text.split("\n").find((l) => !l.startsWith("--") && l.trim() !== "")}`;
    return { rows: [] };
  }
}

const run = (client: FakePg, over: Partial<Parameters<typeof runMigrations>[0]> = {}) =>
  runMigrations({ client, platformFiles: [file("0000_a"), file("0001_b")], hotelFiles: [file("0001_h")], listHotelSchemas: async () => [H1, H2], ...over });
const fileLines = (c: FakePg): string[] => c.log.filter((l) => l.startsWith("FILE["));

describe("the runner's order and transactions", () => {
  test("platform first, then each hotel schema in file order; one transaction per file; the version is recorded inside it", async () => {
    const c = new FakePg([H1, H2]);
    const r = await run(c);
    assert.deepEqual(r.applied, [
      { schema: "platform", version: "0000_a" }, { schema: "platform", version: "0001_b" }, { schema: H1, version: "0001_h" }, { schema: H2, version: "0001_h" },
    ]);
    assert.deepEqual(fileLines(c).map((l) => l.split("]")[0]), ["FILE[platform, pg_catalog", "FILE[platform, pg_catalog", `FILE[${H1}, pg_catalog`, `FILE[${H2}, pg_catalog`]);
    // each file: BEGIN, search_path, file, record, COMMIT
    const begins = c.log.filter((l) => l === "BEGIN").length;
    assert.equal(begins, 4);
    assert.equal(c.log.filter((l) => l === "COMMIT").length, 4);
    for (const schema of ["platform"]) assert.deepEqual(c.rowsOf(schema).map((x) => x.version), ["0000_a", "0001_b"]);
    assert.deepEqual(c.rowsOf(H1).map((x) => x.version), ["0001_h"]);
    assert.equal(c.unlocked, 1, "the advisory lock is released at the end");
  });

  test("the search path is transaction-local (set_config(..., true)); a file that must run outside a transaction sets and then RESETs it", async () => {
    const c = new FakePg();
    await run(c, { platformFiles: [file("0000_a"), toMigrationFile("0001_idx.sql", `${ROLLBACK}\n-- migrate: no-transaction\nCREATE INDEX CONCURRENTLY i ON t (id)\n`)], hotelFiles: [], listHotelSchemas: async () => [] });
    const sets = c.log.filter((l) => l.startsWith("SELECT set_config"));
    assert.equal(sets.length, 2);
    assert.ok(c.log.includes("RESET search_path"));
    assert.equal(c.log.filter((l) => l === "BEGIN").length, 1, "only the transactional file opened a transaction");
  });

  test("a second run does nothing: applied files are skipped (resume)", async () => {
    const c = new FakePg([H1]);
    await run(c, { listHotelSchemas: async () => [H1] });
    const again = await run(c, { listHotelSchemas: async () => [H1] });
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.plan.map((p) => p.pending), [[], []]);
  });

  test("a new file after some are applied is applied alone", async () => {
    const c = new FakePg();
    await run(c, { platformFiles: [file("0000_a")], hotelFiles: [], listHotelSchemas: async () => [] });
    const r = await run(c, { platformFiles: [file("0000_a"), file("0001_b")], hotelFiles: [], listHotelSchemas: async () => [] });
    assert.deepEqual(r.applied, [{ schema: "platform", version: "0001_b" }]);
  });
});

describe("applied files are immutable", () => {
  test("a changed checksum stops the run before ANYTHING is applied (hotels are all checked first)", async () => {
    const c = new FakePg([H1, H2]);
    await run(c);
    const before = c.log.length;
    const changed = file("0001_h", "CREATE TABLE t (id int, extra int)");
    await assert.rejects(() => run(c, { hotelFiles: [changed, file("0002_new")] }), (e: unknown) => e instanceof MigrationError && e.code === "CHECKSUM_MISMATCH" && e.version === "0001_h");
    assert.equal(fileLines(c).length, 4, "no file was run by the failed attempt");
    assert.ok(c.log.length > before);
  });

  test("an applied file whose file is gone is MISSING_FILE; a new file behind applied ones is OUT_OF_ORDER", async () => {
    const c = new FakePg();
    await run(c, { hotelFiles: [], listHotelSchemas: async () => [] });
    await assert.rejects(() => run(c, { platformFiles: [file("0000_a")], hotelFiles: [], listHotelSchemas: async () => [] }), (e: unknown) => e instanceof MigrationError && e.code === "MISSING_FILE");
    const d = new FakePg();
    await run(d, { platformFiles: [file("0001_b")], hotelFiles: [], listHotelSchemas: async () => [] });
    await assert.rejects(() => run(d, { platformFiles: [file("0000_a"), file("0001_b")], hotelFiles: [], listHotelSchemas: async () => [] }), (e: unknown) => e instanceof MigrationError && e.code === "OUT_OF_ORDER");
  });

  test("line endings and a byte-order mark do not change a checksum", () => {
    assert.equal(checksumOf("a\r\nb\r\n"), checksumOf("a\nb\n"));
    assert.equal(checksumOf("﻿a\n"), checksumOf("a\n"));
    assert.notEqual(checksumOf("a\n"), checksumOf("b\n"));
  });
});

describe("one run at a time", () => {
  test("another run holding the advisory lock refuses this one before it touches anything", async () => {
    const c = new FakePg();
    c.lockHeldElsewhere = true;
    await assert.rejects(() => run(c), (e: unknown) => e instanceof MigrationError && e.code === "LOCKED");
    assert.deepEqual(c.log.filter((l) => !l.startsWith("SELECT pg_try_advisory_lock")), []);
  });

  test("insideTransaction (create-hotel) takes no run-wide lock and writes no BEGIN or COMMIT of its own", async () => {
    const c = new FakePg([H1]);
    await run(c, { insideTransaction: true, skipPlatform: true, listHotelSchemas: async () => [H1] });
    assert.ok(!c.log.some((l) => /advisory/.test(l) || l === "BEGIN" || l === "COMMIT"));
    assert.equal(fileLines(c).length, 1);
    await assert.rejects(
      () => run(new FakePg([H1]), { insideTransaction: true, skipPlatform: true, hotelFiles: [toMigrationFile("0001_idx.sql", `${ROLLBACK}\n-- migrate: no-transaction\nCREATE INDEX CONCURRENTLY i ON t (id)\n`)], listHotelSchemas: async () => [H1] }),
      (e: unknown) => e instanceof MigrationError && e.code === "FAILED" && e.cause instanceof MigrationError && e.cause.code === "BAD_FILE_LIST",
    );
  });

  test("skipPlatform leaves the platform schema alone", async () => {
    const c = new FakePg([H1]);
    await run(c, { skipPlatform: true, listHotelSchemas: async () => [H1] });
    assert.ok(!c.log.some((l) => l.includes('"platform"') || l === "CREATE SCHEMA IF NOT EXISTS platform"));
  });
});

describe("a failure", () => {
  test("rolls the file back, names the schema, the file and the SQLSTATE only, never a value, and stops the whole run", async () => {
    const c = new FakePg([H1, H2]);
    c.failOn.set("BAD_ROW", Object.assign(new Error('duplicate key value violates unique constraint "x"; Key (card)=(4111-1111-1111-1111) exists'), { code: "23505" }));
    const events: MigrationEvent[] = [];
    await assert.rejects(
      () => run(c, { hotelFiles: [file("0001_h", "INSERT INTO t VALUES (BAD_ROW)")], report: (e) => void events.push(e) }),
      (e: unknown) => {
        assert.ok(e instanceof MigrationError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.schema, H1);
        assert.equal(e.version, "0001_h");
        assert.match(e.message, /SQLSTATE 23505/);
        assert.ok(!e.message.includes("4111") && !e.message.includes("duplicate key"));
        return true;
      },
    );
    assert.deepEqual(c.rowsOf(H1), [], "the version was not recorded: it rolled back with the file");
    assert.ok(c.log.includes("ROLLBACK"));
    assert.deepEqual(c.rowsOf(H2), [], "the next hotel was never started");
    assert.deepEqual(events.filter((e) => e.event === "failed"), [{ event: "failed", schema: H1, version: "0001_h", sqlState: "23505" }]);
    assert.equal(c.unlocked, 1, "the lock is released even on failure");
  });

  test("a non-SQLSTATE error is reported as 'unknown', never its text", async () => {
    const c = new FakePg([H1]);
    c.failOn.set("BOOM", new Error("secret password=hunter2"));
    await assert.rejects(() => run(c, { hotelFiles: [file("0001_h", "BOOM")], listHotelSchemas: async () => [H1] }), (e: unknown) => e instanceof MigrationError && /SQLSTATE unknown/.test(e.message) && !e.message.includes("hunter2"));
  });
});

describe("the schemas the runner may touch", () => {
  test("a hotel list holding anything but hotel_<32 hex> is refused before any hotel is planned", async () => {
    for (const bad of ["platform", "public", "hotel_x", `${H1}; DROP SCHEMA platform`, "HOTEL_" + "1".repeat(32), ""]) {
      const c = new FakePg();
      await assert.rejects(() => run(c, { platformFiles: [], listHotelSchemas: async () => [bad] }), (e: unknown) => e instanceof MigrationError && e.code === "BAD_SCHEMA", JSON.stringify(bad));
      assert.equal(fileLines(c).length, 0);
    }
  });

  test("a hotel schema that does not exist is BAD_SCHEMA (create-hotel makes it)", async () => {
    await assert.rejects(() => run(new FakePg(), { listHotelSchemas: async () => [H1] }), (e: unknown) => e instanceof MigrationError && e.code === "BAD_SCHEMA" && e.schema === H1);
  });
});

describe("dry run", () => {
  test("prints the plan and changes nothing: no table is created, no file is run", async () => {
    const c = new FakePg();
    const events: MigrationEvent[] = [];
    const r = await run(c, { dryRun: true, report: (e) => void events.push(e) });
    assert.equal(r.dryRun, true);
    assert.deepEqual(r.plan, [{ schema: "platform", pending: ["0000_a", "0001_b"] }]);
    assert.deepEqual(r.applied, []);
    assert.equal(c.tables.size, 0);
    assert.equal(fileLines(c).length, 0);
    assert.ok(events.some((e) => e.event === "note"), "says why the hotels are not planned yet");
  });

  test("with the platform current, a dry run plans every hotel and still changes nothing", async () => {
    const c = new FakePg([H1, H2]);
    await run(c, { platformFiles: [file("0000_a")], hotelFiles: [], listHotelSchemas: async () => [H1, H2] });
    const before = fileLines(c).length;
    const r = await run(c, { dryRun: true, platformFiles: [file("0000_a")], hotelFiles: [file("0001_h")] });
    assert.deepEqual(r.plan, [{ schema: "platform", pending: [] }, { schema: H1, pending: ["0001_h"] }, { schema: H2, pending: ["0001_h"] }]);
    assert.equal(fileLines(c).length, before);
  });
});

describe("seeds mode", () => {
  test("applies idempotent seed files tracked in schema_seeds, with a '-- seed:' first line instead of a rollback", async () => {
    const c = new FakePg([H1]);
    const r = await run(c, { kind: "seeds", platformFiles: [seed("0001_roles")], hotelFiles: [seed("0001_defaults")], listHotelSchemas: async () => [H1] });
    assert.deepEqual(r.applied.map((a) => `${a.schema}:${a.version}`), ["platform:0001_roles", `${H1}:0001_defaults`]);
    assert.deepEqual(c.rowsOf("platform", "schema_seeds").map((x) => x.version), ["0001_roles"]);
    assert.deepEqual(c.rowsOf("platform", "schema_migrations"), []);
    await assert.rejects(() => run(new FakePg(), { kind: "seeds", platformFiles: [file("0001_roles")], hotelFiles: [], listHotelSchemas: async () => [] }), (e: unknown) => e instanceof MigrationError && e.code === "MISSING_ROLLBACK");
  });
});

describe("the file list is checked before anything runs", () => {
  const bad = async (platformFiles: MigrationFile[], code: string): Promise<void> => {
    const c = new FakePg();
    await assert.rejects(() => run(c, { platformFiles, hotelFiles: [], listHotelSchemas: async () => [] }), (e: unknown) => e instanceof MigrationError && e.code === code, code);
    assert.equal(c.log.length, 0, "nothing was sent to the database");
  };

  test("a bad name, a repeated number, files out of order", async () => {
    await bad([file("migration_one")], "BAD_FILE_LIST");
    await bad([file("0001_a"), file("0001_b")], "BAD_FILE_LIST");
    await bad([file("0002_a"), file("0001_b")], "BAD_FILE_LIST");
    await bad([file("0001_A")], "BAD_FILE_LIST");
  });

  test("a first line that is not a real rollback is refused: missing, vague, or forward-only with no reason", async () => {
    await bad([file("0001_a", "CREATE TABLE t (id int)", "-- some comment")], "MISSING_ROLLBACK");
    await bad([file("0001_a", "CREATE TABLE t (id int)", "-- rollback: undo it")], "MISSING_ROLLBACK");
    await bad([file("0001_a", "CREATE TABLE t (id int)", "-- rollback: forward-only because")], "MISSING_ROLLBACK");
    // good ones
    const c = new FakePg();
    await run(c, { platformFiles: [file("0001_a", "CREATE TABLE t (id int)", "-- rollback: forward-only because it only adds a table nobody reads yet")], hotelFiles: [], listHotelSchemas: async () => [] });
    assert.equal(fileLines(c).length, 1);
  });
});

describe("the files of this repository", () => {
  const root = path.join(__dirname, "..", "..", "..", "common", "db", "migrations");

  test("the platform and hotel migration folders pass the runner's own checks (names, order, rollback first line), seen by a dry run", async () => {
    const platform = loadMigrationFiles(path.join(root, "platform"));
    const hotel = loadMigrationFiles(path.join(root, "hotel"));
    assert.ok(platform.length > 0 && hotel.length > 0);
    const c = new FakePg();
    const r = await runMigrations({ client: c, platformFiles: platform, hotelFiles: hotel, listHotelSchemas: async () => [], dryRun: true });
    assert.deepEqual(r.plan[0], { schema: "platform", pending: platform.map((f) => f.version) });
  });

  test("the version table has the same text as platform 0000_foundation.sql would create: uuid id, unique version, a 64-hex checksum, applied_by, applied_at", () => {
    const sql = versionTableSql(H1);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "hotel_1+"\.schema_migrations/);
    assert.match(sql, /version text NOT NULL UNIQUE/);
    assert.match(sql, /checksum text NOT NULL CHECK \(checksum ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    assert.match(versionTableSql("platform", "schema_seeds"), /"platform"\.schema_seeds/);
  });
});
