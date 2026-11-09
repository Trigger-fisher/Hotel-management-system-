// The two Pallav bundles in public/pallav (pallav-base.css, pallav-last.css) are the source sheets of assets.ts concatenated by scripts/bundle-pallav-css.mjs.
// A source sheet edited without `npm run pallav:css` would ship stale styles: the bundles are built again here, in memory, and must equal the committed files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { BASE_SOURCES, LAST_SOURCES, PALLAV_BUNDLES, PALLAV_BASE_URLS, VERSION } from "../src/dashboards/pallav/assets.ts";
import { PALLAV_DIR, bundle, rewriteUrls } from "../scripts/bundle-pallav-css.mjs";

// the checkout may hold CRLF (core.autocrlf): compared as LF, as the bundler writes
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const read = (name: string) => readFileSync(join(PALLAV_DIR, name), "utf8");

describe("the committed bundles are current", () => {
  for (const [out, sources] of Object.entries(PALLAV_BUNDLES)) {
    test(`${out} equals its ${sources.length} sources concatenated in order (else run npm run pallav:css)`, () => {
      assert.equal(lf(read(out)), lf(bundle(sources, read)), `${out} is stale: run npm run pallav:css and bump VERSION in assets.ts`);
    });
  }

  test("the bundles are what the dashboard links first, and only them", () => {
    assert.deepEqual(Object.keys(PALLAV_BUNDLES), ["pallav-base.css", "pallav-last.css"]);
    assert.deepEqual(PALLAV_BUNDLES["pallav-base.css"], BASE_SOURCES);
    assert.deepEqual(PALLAV_BUNDLES["pallav-last.css"], LAST_SOURCES);
    assert.deepEqual([...PALLAV_BASE_URLS], [`/pallav/pallav-base.css?v=${VERSION}`, `/pallav/pallav-last.css?v=${VERSION}`]);
  });
});

describe("bundle()", () => {
  test("each part is preceded by one comment line naming its source, in the given order, and ends with a newline", () => {
    const text = bundle(["a.css", "b.css"], (n: string) => (n === "a.css" ? ".a{x:1}" : ".b{y:2}\n"));
    assert.equal(text, "/* a.css */\n.a{x:1}\n/* b.css */\n.b{y:2}\n");
  });

  test("a leading @charset counts once, at the top; CRLF and a BOM in a source do not reach the bundle", () => {
    const text = bundle(["a.css", "b.css"], (n: string) => (n === "a.css" ? '@charset "UTF-8";.a{x:1}\r\n' : "﻿.b{y:2}"));
    assert.equal(text, '@charset "UTF-8";\n/* a.css */\n.a{x:1}\n/* b.css */\n.b{y:2}\n');
  });

  test("a sheet in a sub-folder has its relative urls pointed into that folder; data:, scheme, root and fragment urls stay", () => {
    const css = `a{background:url(img/x.png)}b{background:url("y.svg")}c{src:url('../z.woff2')}d{x:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E")}e{x:url(https://h/p.png)}f{x:url(/abs.png)}g{x:url(#id)}`;
    const text = bundle(["vendor/v.css"], () => css);
    assert.equal(
      text,
      `/* vendor/v.css */\na{background:url(vendor/img/x.png)}b{background:url("vendor/y.svg")}c{src:url('vendor/../z.woff2')}d{x:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E")}e{x:url(https://h/p.png)}f{x:url(/abs.png)}g{x:url(#id)}\n`,
    );
    // a root-level sheet is left alone (the bundle sits in the same folder)
    assert.equal(bundle(["r.css"], () => "a{x:url(fonts/f.woff2)}"), "/* r.css */\na{x:url(fonts/f.woff2)}\n");
  });

  test("a url( the script cannot read in a sub-folder sheet stops the build", () => {
    assert.throws(() => rewriteUrls('a{x:url("x.png)}', "vendor/"), /1 url\( reference/);
    assert.throws(() => bundle(["vendor/v.css"], () => "a{x:url(a b.png)}"), /could not be read/);
  });

  test("the real vendor sheets hold only data: urls today, so the rewrite changes nothing in them (the rule still guards a future vendor file)", () => {
    for (const name of BASE_SOURCES.filter((n) => n.startsWith("vendor/"))) {
      const css = lf(read(name));
      assert.equal(rewriteUrls(css, "vendor/"), css, name);
    }
  });
});
