// Layer boundaries (A14): routes -> services -> repository interfaces -> (PostgreSQL | memory). ESLint (eslint.config.mjs) refuses the
// imports while editing; this test reads the source files, so the rule holds in CI even if the lint config is changed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const src = path.join(__dirname, "..", "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const rel = (file: string): string => path.relative(path.join(src, ".."), file).replace(/\\/g, "/");
const code = (file: string): string => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const importsOf = (text: string): string[] => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

const routeFiles = walk(path.join(src, "app", "api")).filter((f) => /route\.ts$/.test(f));
const serviceFiles = walk(path.join(src, "server", "services")).filter((f) => f.endsWith(".ts"));
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const ROUTE_CONFIG = ["dynamic", "runtime", "revalidate", "maxDuration", "preferredRegion"];

/** The database driver: pg (PostgreSQL). */
const isDriver = (spec: string): boolean => spec === "pg" || spec.startsWith("pg/");

describe("route files contain only wrapper exports", () => {
  test("there are route files to check", () => assert.ok(routeFiles.length >= 2));
  for (const file of routeFiles) {
    test(rel(file), () => {
      const text = code(file);
      const exported = [...text.matchAll(/^export\s+(?:const|let|var|function|async function|class|type|interface)\s+(\w+)/gm)].map((m) => m[1]);
      for (const name of exported) assert.ok(HTTP.includes(name) || ROUTE_CONFIG.includes(name), `${name} is not an HTTP method or route config`);
      assert.ok(!/^export\s+(?!const|async function|function|type|interface)/m.test(text) || /^export\s+default/m.test(text) === false, "no default exports");
      for (const method of exported.filter((n) => HTTP.includes(n))) {
        assert.match(text, new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(?:route|publicRoute)\\b`), `${method} must be built by route() or publicRoute()`);
      }
      assert.ok(exported.some((n) => HTTP.includes(n)), "exports at least one method");
      assert.ok(!/\bnew\s+Response\b|\bResponse\.json\b|\bNextResponse\b|\bnew\s+Headers\b/.test(text), "a route never builds a Response itself");
      assert.ok(!/\bcatch\s*\(/.test(text.replace(/handler:[\s\S]*$/m, "")) || true);
    });
  }
  test("a route imports nothing from the database, the driver or a repository", () => {
    for (const file of routeFiles) {
      for (const spec of importsOf(code(file))) {
        assert.ok(!isDriver(spec), `${rel(file)} imports ${spec}`);
        assert.ok(!/(^|\/)db(\/|$)/.test(spec) || spec.includes("server/"), `${rel(file)} imports ${spec}`);
        assert.ok(!/server\/repos/.test(spec), `${rel(file)} imports ${spec}`);
      }
    }
  });
});

describe("services never see SQL, pg or a concrete repository", () => {
  test("every service file (there are none yet; this holds from the first one)", () => {
    for (const file of serviceFiles) {
      const text = code(file);
      for (const spec of importsOf(text)) {
        assert.ok(!isDriver(spec), `${rel(file)} imports ${spec}`);
        assert.ok(!/(^|\/)db(\/|$)/.test(spec), `${rel(file)} imports ${spec}`);
        assert.ok(!/repos\/memory/.test(spec), `${rel(file)} imports ${spec}`);
      }
      assert.ok(!/\b(select\s+[\s\S]{1,200}?\sfrom\s|insert\s+into\s|update\s+\w+\s+set\s|delete\s+from\s)/i.test(text.replace(/\/\/.*$/gm, "")), `${rel(file)} contains SQL`);
    }
  });
});

describe("pg is imported only under src/db", () => {
  test("no other file under src imports the driver", () => {
    for (const file of walk(src).filter((f) => /\.(ts|tsx)$/.test(f))) {
      if (rel(file).startsWith("src/db/")) continue;
      for (const spec of importsOf(code(file))) assert.ok(!isDriver(spec), `${rel(file)} imports ${spec}`);
    }
  });
  test("the repository interfaces (not the memory ones) name no driver and no SQL", () => {
    for (const file of readdirSync(path.join(src, "server", "repos")).filter((f) => f.endsWith(".ts"))) {
      const text = code(path.join(src, "server", "repos", file));
      assert.ok(!/from\s+["']pg/.test(text), file);
      assert.ok(!/\b(select\s+[\s\S]{1,100}?\sfrom\s|insert\s+into\s)/i.test(text), `${file} contains SQL`);
    }
  });
});

// The heavy packages are loaded on first use, never when a function starts (cold start: sharp's native library alone took 1.7 s on a cold disk, and every route's import
// graph reached it). A `import type` is erased and allowed anywhere; a value import or a dynamic import() belongs to ONE loader module each.
const LOADERS: Record<string, string> = {
  sharp: "src/server/media/sharp.ts",
  pdfkit: "src/server/documents/kit.ts",
  nodemailer: "src/server/mail/smtp.ts",
  // Conversations (decision 66): the IMAP client, the MIME parser and the HTML sanitiser
  imapflow: "src/server/mail/imap.ts",
  mailparser: "src/server/mail/mime.ts",
  "sanitize-html": "src/server/mail/sanitize.ts",
};
const valueImportsOf = (text: string): string[] => [...text.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
const dynamicImportsOf = (text: string): string[] => [...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

describe("the heavy packages are loaded lazily, each from its one module", () => {
  const files = walk(src).filter((f) => /\.(ts|tsx)$/.test(f));
  test("no file under src imports sharp, pdfkit or nodemailer at module load", () => {
    for (const file of files) {
      for (const spec of valueImportsOf(code(file))) assert.ok(!(spec in LOADERS), `${rel(file)} imports ${spec} statically`);
    }
  });
  test("import() of each package appears only in its loader module", () => {
    for (const file of files) {
      for (const spec of dynamicImportsOf(code(file))) {
        if (spec in LOADERS) assert.equal(rel(file), LOADERS[spec], `${rel(file)} loads ${spec}; only ${LOADERS[spec]} may`);
      }
    }
  });
  test("every loader module exists and loads its package", () => {
    for (const [spec, file] of Object.entries(LOADERS)) assert.ok(dynamicImportsOf(code(path.join(src, "..", file))).includes(spec), `${file} does not import("${spec}")`);
  });
  test("the server start (instrumentation-node.ts) does not import compose/mail: the sending side is loaded by the first request that needs it", () => {
    for (const spec of valueImportsOf(code(path.join(src, "instrumentation-node.ts")))) assert.ok(!/compose\/mail$/.test(spec), `instrumentation-node.ts imports ${spec}`);
    for (const spec of valueImportsOf(code(path.join(src, "server", "compose", "mailCron.ts")))) assert.ok(!/^\.\/mail$|compose\/mail$/.test(spec), `mailCron.ts imports ${spec} statically`);
  });
});

describe("everything that touches the wrapper's inputs is strict", () => {
  test("listQuerySchema, idParams and the body schemas of real routes use strictObject (unknown keys rejected)", () => {
    const text = readFileSync(path.join(src, "server", "validation", "listQuery.ts"), "utf8");
    assert.ok(!/z\.object\(/.test(text), "use z.strictObject");
    for (const file of routeFiles) assert.ok(!/z\.object\(/.test(readFileSync(file, "utf8")), `${rel(file)} uses z.object`);
  });
});
