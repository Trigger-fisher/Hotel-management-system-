// Guards for secrets hygiene: .env* files stay out of git (except the names-only examples), the examples hold no values, the
// two env files keep their names apart, and server-only code is marked server-only.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ConfigError, SCRIPT_ONLY_NAMES, loadConfig } from "../../src/server/config/env";

const root = path.join(__dirname, "..", "..");
const hms = path.join(root, "..");
const read = (name: string): string => readFileSync(path.join(root, name), "utf8");
const readHms = (name: string): string => readFileSync(path.join(hms, name), "utf8");
const names = (example: string): string[] =>
  example.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#")).map((l) => l.split("=")[0]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe(".env handling", () => {
  test("both .gitignore files ignore .env* and re-include only .env.example, in that order", () => {
    for (const text of [read(".gitignore"), readHms(".gitignore")]) {
      const lines = text.split(/\r?\n/).map((l) => l.trim());
      const ignore = lines.indexOf(".env*");
      const keep = lines.indexOf("!.env.example");
      assert.ok(ignore >= 0, ".env* must be ignored");
      assert.ok(keep > ignore, "!.env.example must come after .env*");
      assert.deepEqual(lines.filter((l) => l.startsWith("!.env")), ["!.env.example"]);
    }
  });

  test("both .env.example files list names only: no value after any =", () => {
    for (const text of [read(".env.example"), readHms("common/db/.env.example")]) {
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t === "" || t.startsWith("#")) continue;
        assert.match(t, /^[A-Z][A-Z0-9_]*=$/, `"${t.split("=")[0]}" must have no value`);
      }
    }
  });

  test("web-app/.env.example holds only what the app reads; db/.env.example holds the script-only secrets; no name is in both", () => {
    const app = names(read(".env.example"));
    const script = names(readHms("common/db/.env.example"));
    assert.deepEqual(app.sort(), ["DATABASE_URL", "DB_POOL_MAX", "GITHUB_SITES_REPO", "GITHUB_SITES_TOKEN", "GST_LOOKUP_API_KEY", "GST_LOOKUP_PROVIDER", "HMS_DATA_KEY", "HMS_HASH_KEY", "HMS_INBOUND_SNS_TOPIC_ARN", "HMS_MEDIA_DIR", "HMS_PROXY_HOPS", "HMS_PUBLIC_URL", "LOG_LEVEL", "MAIL_DRIVER", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NODE_ENV", "SITE_BUILD_SECRET", "SMTP_FROM", "SMTP_HOST", "SMTP_PASS", "SMTP_PORT", "SMTP_SECRET_KEY", "SMTP_SECURE", "SMTP_USER", "TURNSTILE_SECRET_KEY"]);
    assert.deepEqual(script.sort(), [...SCRIPT_ONLY_NAMES].sort());
    for (const n of script) assert.ok(!app.includes(n), `${n} must not be in web-app/.env.example`);
  });

  test("the app config never reads a script-only name, except to refuse it in production", () => {
    const source = read("src/server/config/env.ts");
    const code = source
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**") && !l.includes("SCRIPT_ONLY_NAMES ="))
      .join("\n");
    for (const name of SCRIPT_ONLY_NAMES) assert.ok(!code.includes(name), `${name} must only appear through SCRIPT_ONLY_NAMES`);
  });
});

describe("the boot check: script-only secrets in the app's environment (A3)", () => {
  test("production refuses to start when any script-only name is present, naming the name and never the value", () => {
    for (const name of SCRIPT_ONLY_NAMES) {
      assert.throws(
        () => loadConfig({ NODE_ENV: "production", [name]: "postgresql://u:SecretValue12345@h/x" }),
        (error: unknown) => {
          assert.ok(error instanceof ConfigError);
          assert.ok(error.problems.some((p) => p.startsWith(`${name}:`)));
          assert.ok(!`${error.message} ${error.problems.join(" ")}`.includes("SecretValue12345"));
          return true;
        },
        name,
      );
    }
  });

  test("every offending name is listed at once", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "production", PGSUPERUSER_URL: "x", PG_OWNER_URL: "y" }),
      (e: unknown) => e instanceof ConfigError && e.problems.length === 2,
    );
  });

  test("a blank value does not count as present; development and test only ignore them", () => {
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: "production", PGSUPERUSER_URL: "  " }, { build: true }));
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: "development", PGSUPERUSER_URL: "postgresql://x" }));
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: "test", PG_OWNER_URL: "postgresql://x" }));
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgresql://hms_app:p@h/x" }, { build: true }));
  });

  test("the config object never carries a script-only value even in development", () => {
    const config = loadConfig({ NODE_ENV: "development", PGSUPERUSER_URL: "postgresql://x" }) as Record<string, unknown>;
    for (const name of SCRIPT_ONLY_NAMES) assert.ok(!(name in config));
  });
});

describe("server-only (A2)", () => {
  test('every file under src/server and src/db starts with import "server-only" (the node hook is the one exception)', () => {
    const files = [...walk(path.join(root, "src", "server")), ...walk(path.join(root, "src", "db"))].filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length >= 20);
    const without = files.filter((f) => !read(path.relative(root, f)).startsWith('import "server-only";')).map((f) => path.relative(root, f).replaceAll("\\", "/"));
    assert.deepEqual(without, ["src/server/lib/node-hooks/register.ts"]);
  });

  test("the scripts under db/scripts never import it (they run without Next.js)", () => {
    for (const f of walk(path.join(hms, "common", "db", "scripts")).filter((x) => x.endsWith(".ts"))) assert.doesNotMatch(readFileSync(f, "utf8"), /server-only/, f);
  });

  test("route files and UI code do not import server-only modules by accident of path: nothing under src/components or src/dashboards imports src/server or src/db", () => {
    for (const dir of ["src/components", "src/dashboards", "src/lib"]) {
      const full = path.join(root, dir);
      try {
        for (const f of walk(full).filter((x) => /\.(ts|tsx)$/.test(x))) assert.doesNotMatch(readFileSync(f, "utf8"), /from ["'](@\/server|@\/db|\.\.\/(\.\.\/)*(server|db))\//, f);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  });
});

describe("tsconfig.json (the web app's own settings)", () => {
  test("include never names a .next- build folder, and exclude keeps them out", () => {
    const text = readFileSync(path.join(__dirname, "..", "..", "tsconfig.json"), "utf8");
    const config = JSON.parse(text.replace(/,(\s*[\]}])/g, "$1")) as { include: string[]; exclude?: string[] };
    for (const entry of config.include) assert.ok(!/\.next-/.test(entry), `include has ${entry}`);
    assert.ok((config.exclude ?? []).includes(".next-*/**"));
  });
});
