// Conversations email and the size of the server functions (decision 66; speed is MJ's priority): imapflow and mailparser (with what they need, a few MB) ship only with the
// functions that read or test a mailbox. They are loaded in one place each, with turbopackIgnore (so the build traces them into no function), and next.config.ts adds
// them to the routes MAIL_FUNCTIONS names. A route that can reach the mail code must be named there, or it would fail on Vercel with "Cannot find module".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
// the same matcher Next uses for outputFileTracingIncludes keys
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require("next/dist/compiled/picomatch") as (glob: string, o: { dot: boolean; contains: boolean }) => (s: string) => boolean;

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
const MAIL_FUNCTIONS = /export const MAIL_FUNCTIONS = "([^"]+)";/.exec(config)?.[1] ?? "";

/** The route of an app route file, as Next names it (app/api/v1/x/[id]/route.ts -> /api/v1/x/[id]). */
const routeOf = (file: string): string => `/${path.relative(path.join(SRC, "app"), path.dirname(file)).replace(/\\/g, "/")}`;

describe("imapflow and mailparser ship with the email functions only", () => {
  test("they are loaded in one module each, on first use, with turbopackIgnore", () => {
    const runtime = filesUnder(SRC).flatMap((f) => {
      const text = fs.readFileSync(f, "utf8");
      const out: { file: string; line: string }[] = [];
      for (const line of text.split("\n")) {
        if (/^\s*import\s+type\b/.test(line)) continue;
        if (/["'](imapflow|mailparser)["']/.test(line) && /\bimport\b|\brequire\(/.test(line)) out.push({ file: path.relative(SRC, f).replace(/\\/g, "/"), line: line.trim() });
      }
      return out;
    });
    assert.deepEqual(runtime.map((r) => r.file).sort(), ["server/mail/imap.ts", "server/mail/mime.ts"]);
    for (const r of runtime) assert.match(r.line, /import\(\/\* turbopackIgnore: true \*\/ "(imapflow|mailparser)"\)/, `${r.file}: ${r.line}`);
  });

  test("the real IMAP adapter and MIME parser still load them (a native import at run time)", async () => {
    const { createImapClientFactory } = await import("../../src/server/mail/imap");
    const { previewOf } = await import("../../src/server/mail/mime");
    // a public test address (TEST-NET-3, never answers): imapflow is loaded, then the connection ends within the budget; never "Cannot find module"
    const imap = createImapClientFactory({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] });
    await assert.rejects(imap({ host: "imap.hotel.example", port: 993, user: "u", pass: "p" }, { budgetMs: 300 }), (error: unknown) => {
      assert.doesNotMatch(String((error as Error)?.message ?? error), /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/);
      return true;
    });
    assert.equal(await previewOf(Buffer.from("From: a@b.in\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\nPaid, see attached.\r\n")), "Paid, see attached.");
  });

  test("next.config.ts adds them to MAIL_FUNCTIONS, and every route that can reach the mail code is one of those", () => {
    assert.notEqual(MAIL_FUNCTIONS, "");
    assert.match(config, /\[MAIL_FUNCTIONS\]: packageClosure\(\["imapflow", "mailparser"\]\)/);
    const isMail = picomatch(MAIL_FUNCTIONS, { dot: true, contains: true });
    const routes = filesUnder(path.join(SRC, "app")).filter((f) => /[\\/]route\.ts$/.test(f));
    // reaching the mail code: the Conversations composition root, the connection test of Settings > Email, the cron pass
    const reaches = routes.filter((f) => /compose\/conversations"|testMailConnection|getCron\(\)\.conversations\(/.test(fs.readFileSync(f, "utf8")));
    assert.ok(reaches.length >= 40, `found ${reaches.length}`);
    for (const f of reaches) assert.equal(isMail(routeOf(f)), true, `${routeOf(f)} reads mail but is not in MAIL_FUNCTIONS`);
    // and not the others: the website, sign-in, the health check, the other cron jobs, Settings > Email itself
    for (const r of ["/", "/login", "/api/v1/health", "/api/v1/cron/mail", "/api/v1/cron/daily-summary", "/api/v1/admin/settings/email", "/api/v1/admin/settings"]) assert.equal(isMail(r), false, r);
  });
});
