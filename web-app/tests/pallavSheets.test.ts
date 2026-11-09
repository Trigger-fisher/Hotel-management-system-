// Every Pallav sheet keeps its braces balanced: a lost closing brace (as the old shared append point produced on merges) silently swallows every rule after it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { AREA_SHEETS, BASE_SOURCES, LAST_SOURCES } from "../src/dashboards/pallav/assets.ts";
import { PALLAV_DIR } from "../scripts/bundle-pallav-css.mjs";

function depthProblem(css: string): string | null {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth < 0) return `a closing brace with nothing open near: ${text.slice(Math.max(0, i - 80), i + 1).trim()}`;
  }
  return depth === 0 ? null : `${depth} block(s) never closed`;
}

describe("Pallav sheets", () => {
  for (const name of [...new Set([...BASE_SOURCES, ...LAST_SOURCES])].filter((n) => !n.startsWith("vendor/") && !n.endsWith(".min.css"))) {
    test(`${name} has balanced braces`, () => {
      assert.equal(depthProblem(readFileSync(join(PALLAV_DIR, name), "utf8")), null);
    });
  }

  test("every file in areas/ is bundled, and every bundled area sheet exists", () => {
    const onDisk = readdirSync(join(PALLAV_DIR, "areas")).filter((f) => f.endsWith(".css")).map((f) => `areas/${f}`).sort();
    assert.deepEqual([...AREA_SHEETS].sort(), onDisk);
  });

  test("the area sheets load last, after the overrides and the phone sheets", () => {
    assert.deepEqual(LAST_SOURCES.slice(-AREA_SHEETS.length), [...AREA_SHEETS]);
  });
});
