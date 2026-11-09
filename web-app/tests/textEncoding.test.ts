// No double-encoded text in the screens: an editor that saves a UTF-8 file as Latin-1 and back turns "·" into "Â·" and "–" into "â€“", which staff then see on screen
// (it happened once on a Pathik line). tsc, eslint and the other tests do not notice it, so this scans every source file of the app and the shared code.
// Run with `node --test tests/*.test.ts`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

// U+00C2 / U+00C3 followed by a Latin-1 symbol, or U+00E2 U+20AC: the shapes UTF-8 bytes take when they are read as Latin-1 (or Windows-1252) and saved again.
const mojibake = /[ÂÃ][\u0080-¿]|â€/;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.split(path.sep).includes("node_modules"))
    .map((f) => path.join(dir, f));
}

describe("text encoding", () => {
  test("no source file of web-app/src or ui-shared holds double-encoded UTF-8", () => {
    const files = [...sources(path.join(process.cwd(), "src")), ...sources(path.join(process.cwd(), "..", "common", "ui-shared"))];
    assert.ok(files.length > 100, "the scan found the sources");
    const bad = files.filter((f) => mojibake.test(readFileSync(f, "utf8"))).map((f) => path.relative(process.cwd(), f));
    assert.deepEqual(bad, []);
  });
});
