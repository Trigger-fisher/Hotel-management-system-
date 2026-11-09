// The demo hotels' sample data (common/db/scripts/demo-hotels.ts): the perf-hotel statements cut down, with the references that depend on the counts kept in step, and no PERF name left.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEMO_GROUPS, DEMO_HOTELS, demoDataStatements } from "../../../common/db/scripts/demo-hotels";
import { perfDataStatements } from "../../../common/db/scripts/perf-hotel";

const USER = "11111111-1111-4111-8111-111111111111";

describe("demo hotels", () => {
  test("the sample data has the same statements as the perf hotel, with small counts and demo names", () => {
    const demo = demoDataStatements(USER, 1);
    assert.equal(demo.length, perfDataStatements(USER).length);
    const text = demo.join("\n");
    assert.doesNotMatch(text, /PERF/);
    assert.match(text, /DEMO Guest/);
    for (const big of ["generate_series(1, 800)", "generate_series(1, 1500)", "generate_series(1, 2000)", "generate_series(1, 1000)", "generate_series(1, 600)", "generate_series(1, 400)"]) assert.ok(!text.includes(big), big);
  });

  test("the references follow the counts: bills and advances point at the cut-down number of companies and guests", () => {
    const one = demoDataStatements(USER, 1).join("\n");
    const two = demoDataStatements(USER, 2).join("\n");
    assert.match(one, /k = n % 6\b/);
    assert.match(one, /n % 40 \+ 1/);
    assert.match(two, /k = n % 12\b/);
    assert.match(two, /n % 80 \+ 1/);
  });

  test("two real groups with a Group Hotel Admin each, two individual hotels, every slug different and marked demo", () => {
    assert.equal(DEMO_GROUPS.length, 2);
    assert.equal(DEMO_HOTELS.filter((h) => h.group === undefined).length, 2);
    for (const h of DEMO_HOTELS) if (h.group) assert.ok(DEMO_GROUPS.some((g) => g.slug === h.group), h.slug);
    const slugs = [...DEMO_GROUPS.map((g) => g.slug), ...DEMO_HOTELS.map((h) => h.slug)];
    assert.equal(new Set(slugs).size, slugs.length);
    for (const s of slugs) assert.match(s, /^demo-/);
  });
});
