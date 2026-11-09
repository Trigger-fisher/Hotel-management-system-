// Golden tests for the Website's content rules against REAL PHP (db/scripts/php/generate-website-content-fixtures.php, VERBATIM copies of Pallav's
// Support/Site/Sanitizer::richText, the offline parts of MapTools, and the line splitting of the content and policy screens).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { hasVisibleText, richText } from "../../src/server/services/website/sanitizer";
import { coordinatesFromUrl, kmLabel, placeIcon, pointLines, policyLines, straightLineKm } from "../../src/server/services/website/mapTools";

interface Fixture {
  rich: { in: string; out: string; again: string; blank: boolean; validUtf8: boolean }[];
  coordinates: { url: string; result: { lat: number; lng: number } | null }[];
  distances: { from: number[]; to: number[]; km: number; label: string }[];
  kmLabels: { km: number; label: string }[];
  icons: { title: string; icon: string }[];
  lines: { in: string; points: string[]; policy: string[] }[];
}
const fx = JSON.parse(readFileSync(new URL("../../../common/db/scripts/php/fixtures/website-content.json", import.meta.url), "utf8")) as Fixture;

// What the port deliberately does not copy (see sanitizer.ts): a character beyond U+FFFF (an emoji) that Pallav corrupts, and one case whose backslash-quote
// ends an attribute in a way only libxml's error recovery explains.
const astral = (s: string): boolean => /[\u{10000}-\u{10ffff}]/u.test(s);
const KNOWN = new Set(["<a href=\"http://x.example/?a='b'&q=\\\"c\\\"\">q</a>"]);

describe("the rich-text cleaner against PHP's DOM", () => {
  test("every case PHP handles cleanly gives the same text, and cleaning twice changes nothing", () => {
    let compared = 0;
    for (const c of fx.rich) {
      assert.equal(richText(richText(c.in)), richText(c.in), `not idempotent: ${JSON.stringify(c.in)}`);
      if (!c.validUtf8 || astral(c.in) || KNOWN.has(c.in)) continue;
      assert.equal(richText(c.in), c.out, `differs for ${JSON.stringify(c.in)}`);
      assert.equal(hasVisibleText(c.out), !c.blank, `visible text for ${JSON.stringify(c.in)}`);
      compared += 1;
    }
    assert.ok(compared >= 65, `only ${compared} cases compared`);
  });

  test("the libxml defect is fixed, not copied: an emoji survives", () => {
    assert.equal(richText("<p>emoji 😀 text</p>"), "<p>emoji 😀 text</p>");
  });

  test("hostile input: nothing that runs survives, whatever the nesting", () => {
    for (const evil of ['<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)" onclick="x()">x</a>', '<svg onload=alert(1)><script>alert(1)</script></svg>', '<p style="x" onmouseover="y">p</p>', "<<script>script>alert(1)<</script>/script>", '<a href="&#106;avascript:alert(1)">x</a>', '<a href="jav&#x0A;ascript:alert(1)">x</a>']) {
      const out = richText(evil);
      assert.ok(!/<script|<svg|<img|on\w+\s*=|javascript:/i.test(out), `${evil} -> ${out}`);
    }
  });
});

describe("the map helpers against PHP", () => {
  test("coordinates from a full link: the pin pair first, then @lat,lng, then q=lat,lng; nothing else", () => {
    for (const c of fx.coordinates) assert.deepEqual(coordinatesFromUrl(c.url), c.result, c.url);
  });
  test("straight-line distance and the km label (one decimal under 10 km, whole beyond; PHP's number_format rounding)", () => {
    for (const d of fx.distances) {
      assert.ok(Math.abs(straightLineKm(d.from[0], d.from[1], d.to[0], d.to[1]) - d.km) < 1e-9, JSON.stringify(d));
      assert.equal(kmLabel(straightLineKm(d.from[0], d.from[1], d.to[0], d.to[1])), d.label);
    }
    for (const k of fx.kmLabels) assert.equal(kmLabel(k.km), k.label, String(k.km));
  });
  test("the place icon is picked by a keyword in the name, a pin otherwise", () => {
    for (const i of fx.icons) assert.equal(placeIcon(i.title), i.icon, i.title);
  });
});

describe("the line lists against PHP (collect()->filter() drops every falsy line, a lone 0 included)", () => {
  test("the enquiry points and the policy lines", () => {
    for (const l of fx.lines) {
      assert.deepEqual(pointLines(l.in), l.points, JSON.stringify(l.in));
      assert.deepEqual(policyLines(l.in), l.policy, JSON.stringify(l.in));
    }
  });
});
