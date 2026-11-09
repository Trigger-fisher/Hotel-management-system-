// MJ, 5 Nov 2026: the sign-in screens and the whole app open in day and never follow the phone's or computer's dark setting; night only when the person turns it on.
// Also: a temporary password past its time opens the blocked screen with its own reason (not "switched off").
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { refusalEvent } from "@shared/auth-pallav/flow";

const SRC = join(__dirname, "..", "..", "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("the app theme never follows the device", () => {
  test("no app stylesheet or theme code asks the device for dark (the mail layout, read in mail programs, is not the app)", () => {
    for (const file of ["app/globals.css", "lib/theme.ts", "app/layout.tsx", "app/global-not-found.tsx", "dashboards/pallav/theme.ts"]) {
      assert.ok(!read(file).includes("prefers-color-scheme"), `${file} follows the device`);
    }
    // every other source file and every served stylesheet too (Pallav's sheets, the area sheets, CSS modules)
    const WEB = join(__dirname, "..", "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(tsx?|css|js)$/.test(e.name) ? [join(dir, e.name)] : []));
    const following = [...walk(SRC), ...walk(join(WEB, "public"))]
      .filter((f) => !f.endsWith(join("server", "mail", "layout.ts")))
      .filter((f) => /prefers-color-scheme|colorScheme:\s*["']light dark/.test(readFileSync(f, "utf8")))
      .map((f) => relative(WEB, f));
    assert.deepEqual(following, []);
  });

  test("night values sit under <html data-theme=\"dark\">, which only the person's own choice sets; the first-paint script falls back to day", () => {
    assert.match(read("lib/theme.ts"), /:root\[data-theme="dark"\]\{\$\{block\(nightVars\)\}\}/);
    const layout = read("app/layout.tsx");
    assert.match(layout, /localStorage\.getItem\('pms-theme'\)==='dark'\?'dark':'light'/);
    assert.ok(!layout.includes("matchMedia"));
    const pallav = read("dashboards/pallav/theme.ts");
    assert.match(pallav, /browserTheme\(\) \?\? 'light'/);
    assert.match(pallav, /res\.data\.uiTheme === 'dark' \? 'dark' : 'light'/, "a person who never chose night gets day, not the last person's choice");
  });

  test("the sign-in frame puts the page back to day (after a night person signs out), the lock screen keeps the person's choice", () => {
    assert.match(read("components/auth/AuthShell.tsx"), /if \(step !== "screenLocked"\) document\.documentElement\.dataset\.theme = "light";/);
  });
});

describe("an expired temporary password on the sign-in screen", () => {
  test("ACCOUNT_DISABLED with reason temp_password_expired opens the blocked screen with that reason", () => {
    assert.deepEqual(refusalEvent({ code: "ACCOUNT_DISABLED", message: "x", details: { reason: "temp_password_expired" } as never }), { type: "BLOCKED", reason: "temp_password_expired", reasonText: null });
    assert.deepEqual(refusalEvent({ code: "ACCOUNT_DISABLED", message: "x" }), { type: "BLOCKED", reason: "disabled", reasonText: null });
  });
});
