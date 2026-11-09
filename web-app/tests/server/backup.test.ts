// The backup script's pure parts (db/scripts/backup.ts). The dump and the restore check themselves were run against the dev database (docs/deploy/DEPLOY-VPS.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { parsePgUrl } from "../../../common/db/scripts/backup";

describe("backup script", () => {
  test("a connection string is split into its parts, with the password decoded", () => {
    assert.deepEqual(parsePgUrl("postgresql://hms_owner:p%40ss%2Fword@db.example.in:5433/hms"), { host: "db.example.in", port: "5433", user: "hms_owner", password: "p@ss/word", database: "hms" });
    assert.equal(parsePgUrl("postgres://u:p@localhost/hms").port, "5432");
  });

  test("the password goes to the tools through the environment only, never the command line, and no secret is printed", () => {
    const source = readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "backup.ts"), "utf8");
    assert.match(source, /PGPASSWORD: p\.password/);
    assert.ok(!/["']--password["']|"-W"/.test(source), "no password argument");
    assert.ok(!/console\.|stdout\.write/.test(source), "the module prints nothing itself");
  });
});