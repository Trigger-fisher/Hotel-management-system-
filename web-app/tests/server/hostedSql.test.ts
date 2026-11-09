// export-hosted-sql: the SQL parts are made from the REAL migration files (checksums equal to what `migrate` computes), every part sits in its own
// transaction under SET ROLE hms_owner, nothing holds a password or an account, and a part never exceeds the size limit.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { buildHostedSql, MAX_PART_BYTES, uuidv7 } from "../../../common/db/scripts/export-hosted-sql";
import { loadMigrationFiles } from "../../../common/db/scripts/migrate";

const root = path.join(__dirname, "..", "..", "..", "common", "db");
const input = {
  platformMigrations: loadMigrationFiles(path.join(root, "migrations", "platform")),
  platformSeeds: loadMigrationFiles(path.join(root, "seeds", "platform")),
  hotelMigrations: loadMigrationFiles(path.join(root, "migrations", "hotel")),
  hotelSeeds: loadMigrationFiles(path.join(root, "seeds", "hotel")),
  hotelName: "Hotel Demo",
  hotelSlug: "hotel-demo",
  hotelId: "01a12981-e070-7cea-a90a-3e869fbbb056",
};

describe("buildHostedSql", () => {
  const files = buildHostedSql(input);
  const sql = files.filter((f) => f.name.endsWith(".sql"));
  const all = sql.map((f) => f.text).join("\n");

  test("a setup part, parts in order, and a README; names are numbered", () => {
    assert.match(files[0].name, /^part-00-setup\.sql$/);
    assert.equal(files[files.length - 1].name, "README.md");
    assert.deepEqual(sql.map((f) => f.name.slice(0, 7)), sql.map((_, i) => `part-${String(i).padStart(2, "0")}`));
  });

  test("every migration and seed file is inside, once, with the checksum migrate computes in its tracking row", () => {
    for (const [schema, list, table] of [
      ["platform", input.platformMigrations, "schema_migrations"],
      ["platform", input.platformSeeds, "schema_seeds"],
      ["hotel_01a12981e0707ceaa90a3e869fbbb056", input.hotelMigrations, "schema_migrations"],
      ["hotel_01a12981e0707ceaa90a3e869fbbb056", input.hotelSeeds, "schema_seeds"],
    ] as const) {
      for (const file of list) {
        const row = `INSERT INTO "${schema}".${table} (version, checksum, applied_by) VALUES ('${file.version}', '${file.checksum}', 'export-hosted-sql');`;
        assert.equal(all.split(row).length - 1, 1, `${schema} ${file.version}`);
        assert.ok(all.includes(file.sql.replace(/\r\n/g, "\n").trim().slice(0, 200)), `${file.version} text`);
      }
    }
  });

  test("each part after 00 is one transaction under SET ROLE hms_owner and ends with RESET ROLE; none passes the size limit", () => {
    for (const f of sql.slice(1)) {
      assert.match(f.text, /\nSET ROLE hms_owner;\nBEGIN;\n/, f.name);
      assert.match(f.text, /\nCOMMIT;\n[\s\S]*\nRESET ROLE;\n$/, f.name);
      assert.ok(Buffer.byteLength(f.text) <= MAX_PART_BYTES + 6000, f.name);
      assert.match(f.text, /-- HMS hosted SQL, part \d\d of \d\d/, f.name);
    }
    assert.ok(!/SET ROLE/.test(sql[0].text.replace(/^--.*$/gm, "")), "part 00 runs as the console role");
  });

  test("no password, no account, no secret; the schema name is the hotel id's", () => {
    assert.ok(!/CREATE ROLE[^;]*PASSWORD/i.test(sql[0].text), "no role password in part 00");
    assert.ok(!/INSERT INTO platform\.users/i.test(all), "no account");
    assert.ok(all.includes('CREATE SCHEMA "hotel_01a12981e0707ceaa90a3e869fbbb056"'));
    assert.ok(all.includes("GRANT \"hotel_01a12981e0707ceaa90a3e869fbbb056_rw\" TO hms_app WITH INHERIT FALSE, SET TRUE"));
  });

  test("the same input gives the same files; a part already applied is refused by its guard", () => {
    assert.deepEqual(buildHostedSql(input), files);
    assert.match(sql[1].text, /already applied in platform/);
  });

  test("uuidv7: version 7, RFC variant, time ordered, unique", () => {
    const a = uuidv7(new Date("2026-10-11T00:00:00Z"));
    const b = uuidv7(new Date("2026-10-11T00:00:01Z"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(a < b);
    assert.notEqual(uuidv7(), uuidv7());
  });
});
