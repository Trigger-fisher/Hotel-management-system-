// Which hotel migrations are pending (Platform health): the SET of migration files against the SET of applied versions, never "last file number minus row count".
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { compareMigrations } from "../../src/server/provisioner/migrationState";

describe("compareMigrations", () => {
  const files = ["0036_pathik_approval", "0037_pathik_active_minimal", "0039_notifications", "0041_x", "0042_y"];

  test("gaps in the numbering (0038, 0040 never written) are not pending: every file applied = nothing pending", () => {
    assert.deepEqual(compareMigrations(files, [...files]), { applied: 5, pending: [], unknown: [] });
  });

  test("a file with no row is pending, in file order", () => {
    assert.deepEqual(compareMigrations(files, ["0036_pathik_approval", "0039_notifications", "0041_x"]), { applied: 3, pending: ["0037_pathik_active_minimal", "0042_y"], unknown: [] });
  });

  test("a row with no file is unknown (a newer server applied it, or a file was removed); it is not counted as pending", () => {
    assert.deepEqual(compareMigrations(files, [...files, "0043_newer"]), { applied: 6, pending: [], unknown: ["0043_newer"] });
  });

  test("the real hotel migration folder: applying every file leaves nothing pending, whatever gaps the numbering has", () => {
    const real = readdirSync(path.join(process.cwd(), "..", "common", "db", "migrations", "hotel")).filter((f) => f.endsWith(".sql")).sort().map((f) => f.replace(/\.sql$/, ""));
    assert.ok(real.length > 30);
    assert.deepEqual(compareMigrations(real, real).pending, []);
  });
});