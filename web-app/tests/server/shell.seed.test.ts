// The shell seed (server/shell/seed.ts) is read on EVERY signed-in page load: it must stay small. It may not pull the admin or overview composition roots
// (sharp, pdfkit and the whole admin graph would then load with every page function), and it reads nothing for the header any more (the browser reads the bell
// and the books itself). In the style of tests/server/layers.test.ts: the source file is read, so the rule holds whatever the imports' types say.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const file = path.join(__dirname, "..", "..", "src", "server", "shell", "seed.ts");
const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const imports = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("the shell seed stays light", () => {
  test("it imports neither compose/admin nor compose/overview (nor any compose root but auth)", () => {
    for (const spec of imports) {
      assert.ok(!/compose\/(admin|overview)/.test(spec), `seed.ts imports ${spec}`);
      assert.ok(!/compose\//.test(spec) || spec.endsWith("compose/auth"), `seed.ts imports ${spec}`);
    }
    assert.ok(imports.some((s) => s.endsWith("compose/auth")), "it still verifies the session through compose/auth");
  });

  test("no header reads race the page: the header carries only the time the page was drawn, and the session answer reuses the resolver's access record", () => {
    assert.ok(!/HEADER_READ_MS|headerRead|Promise\.race/.test(code), "no timed header read");
    assert.ok(!/AttentionFeed|BooksOverview|dashboards\/overview/.test(code), "the bell's and the books' types are not part of the seed any more");
    assert.match(code, /header: \{ at: Date\.now\(\) \}/);
    assert.match(code, /getSession\(verified, resolver\.accessOf\(verified\)\)/);
  });
});
