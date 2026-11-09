// The two scripts the "Create hotel site" job runs (website-templates/tools): create-site.mjs copies a template into a hotel's own folder, report-build.mjs sends HMS the
// signed report. Run for real in a temporary folder and against a local server that checks the signature with the same function HMS's route uses.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { verifySiteBuild } from "../../src/server/sitebuild/signature";

const TOOLS = path.join(__dirname, "..", "..", "..", "website-templates", "tools");
const SECRET = "site-build-secret-0123456789abcdef0123";
const BUILD = "00000000-0000-4000-8000-000000000042";

describe("create-site.mjs", () => {
  let root: string;
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "hms-sites-"));
    mkdirSync(path.join(root, "templates", "template-3", "assets"), { recursive: true });
    writeFileSync(path.join(root, "templates", "template-3", "index.php"), "<?php echo 'three';");
    writeFileSync(path.join(root, "templates", "template-3", "assets", "style.css"), "body{}");
    mkdirSync(path.join(root, "templates", "template-9"), { recursive: true });
    writeFileSync(path.join(root, "templates", "template-9", "README.md"), "no page yet");
    writeFileSync(path.join(root, "outside.txt"), "must stay");
  });
  after(() => rmSync(root, { recursive: true, force: true }));
  const run = (hotel: string, template: string) => spawnSync(process.execPath, [path.join(TOOLS, "create-site.mjs"), "--hotel", hotel, "--template", template, "--root", root], { encoding: "utf8" });

  test("copies the template with its assets, adds site.json and CUSTOM.md, and replaces an older copy of that hotel only", () => {
    const first = run("sunrise-rajkot", "template-3");
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), { ok: true, hotel: "sunrise-rajkot", template: "template-3", folder: "sites/sunrise-rajkot" });
    const dir = path.join(root, "sites", "sunrise-rajkot");
    assert.equal(readFileSync(path.join(dir, "index.php"), "utf8"), "<?php echo 'three';");
    assert.equal(readFileSync(path.join(dir, "assets", "style.css"), "utf8"), "body{}");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "site.json"), "utf8")), { hotel: "sunrise-rajkot", template: "template-3", createdBy: "create-site.mjs" });
    assert.match(readFileSync(path.join(dir, "CUSTOM.md"), "utf8"), /Copied from template-3/);
    // another hotel's folder and an old file of this one
    assert.equal(run("sea-view", "template-3").status, 0);
    writeFileSync(path.join(dir, "old-custom-page.php"), "gone after a new pick");
    assert.equal(run("sunrise-rajkot", "template-3").status, 0);
    assert.equal(existsSync(path.join(dir, "old-custom-page.php")), false, "the folder is replaced");
    assert.equal(existsSync(path.join(root, "sites", "sea-view", "index.php")), true, "the other hotel is untouched");
  });

  test("a name that could reach another folder, an unknown template and a template with no page yet are refused and nothing is written", () => {
    for (const [hotel, template, words] of [
      ["../escape", "template-3", /hotel name must be a slug/],
      ["a/b", "template-3", /hotel name must be a slug/],
      ["Sunrise", "template-3", /hotel name must be a slug/],
      ["", "template-3", /hotel name must be a slug/],
      ["ok-hotel", "../templates/template-3", /folder name like template-3/],
      ["ok-hotel", "Template-3", /folder name like template-3/],
      ["ok-hotel", "template-77", /no template called template-77/],
      ["ok-hotel", "template-9", /no index\.php yet/],
    ] as const) {
      const r = run(hotel, template);
      assert.equal(r.status, 1, `${hotel} ${template}`);
      assert.match(r.stderr, words, `${hotel} ${template}`);
    }
    assert.equal(existsSync(path.join(root, "sites", "ok-hotel")), false);
    assert.equal(readFileSync(path.join(root, "outside.txt"), "utf8"), "must stay");
  });
});

describe("report-build.mjs", () => {
  interface Seen { url: string; headers: IncomingMessage["headers"]; body: string }
  let server: Server;
  let base: string;
  let seen: Seen[] = [];
  let answers: number[] = [];
  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", headers: req.headers, body });
        res.statusCode = answers.shift() ?? 200;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/public/site-builds/${BUILD}`;
  });
  after(() => server.close());

  const report = (args: string[], env: Record<string, string> = {}) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      seen = [];
      const child = spawn(process.execPath, [path.join(TOOLS, "report-build.mjs"), ...args], { env: { ...process.env, SITE_URL_PATTERN: "", HOTEL: "", SITE_BUILD_SECRET: SECRET, CALLBACK_URL: base, ...env } });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });

  test("sends a body HMS's own check accepts: signed with the shared secret, fresh, and carrying only the allowed fields", async () => {
    answers = [];
    const r = await report(["--status", "live", "--message", "Built.", "--run-url", "https://github.com/acme/hms-sites/actions/runs/7"], { SITE_URL_PATTERN: "https://{hotel}.yourhms.in", HOTEL: "sunrise-rajkot" });
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `/api/v1/public/site-builds/${BUILD}`);
    assert.deepEqual(JSON.parse(seen[0].body), { status: "live", message: "Built.", runUrl: "https://github.com/acme/hms-sites/actions/runs/7", siteUrl: "https://sunrise-rajkot.yourhms.in" });
    assert.equal(verifySiteBuild(SECRET, BUILD, String(seen[0].headers["x-hms-timestamp"]), String(seen[0].headers["x-hms-signature"]), seen[0].body, new Date()), true);
    assert.equal(verifySiteBuild("another-secret-0123456789abcdef012345", BUILD, String(seen[0].headers["x-hms-timestamp"]), String(seen[0].headers["x-hms-signature"]), seen[0].body, new Date()), false);
  });

  test("a plain http address, a control character and an over-long sentence are cleaned or dropped before sending", async () => {
    answers = [];
    const r = await report(["--status", "failed", "--message", `bad\u0007${"x".repeat(600)}`, "--run-url", "http://plain.example/run", "--site-url", "javascript:alert(1)"]);
    assert.equal(r.code, 0, r.out);
    const sent = JSON.parse(seen[0].body);
    assert.deepEqual(Object.keys(sent).sort(), ["message", "status"]);
    assert.equal(sent.message.length, 500);
    assert.ok(!/[\u0000-\u001f]/.test(sent.message));
  });

  test("a 5xx is tried again and then succeeds; a 4xx is not repeated and fails", { timeout: 20_000 }, async () => {
    answers = [500, 200];
    const ok = await report(["--status", "building"]);
    assert.equal(ok.code, 0, ok.out);
    assert.equal(seen.length, 2);
    answers = [403];
    const bad = await report(["--status", "building"]);
    assert.equal(bad.code, 1);
    assert.equal(seen.length, 1, "a refusal is not asked again");
    assert.match(bad.out, /HMS answered 403/);
  });

  test("a missing secret, a bad status and a callback address that is not HMS's site-builds route are refused before anything is sent", async () => {
    answers = [];
    assert.equal((await report(["--status", "live"], { SITE_BUILD_SECRET: "short" })).code, 1);
    assert.equal((await report(["--status", "done"])).code, 1);
    for (const callback of ["https://evil.example/anything", `https://hms.example/api/v1/public/site-builds/../../x`, "http://evil.example/api/v1/public/site-builds/" + BUILD]) {
      const r = await report(["--status", "live"], { CALLBACK_URL: callback });
      assert.equal(r.code, 1, callback);
      assert.match(r.out, /not an HMS site-builds address/);
    }
    assert.equal(seen.length, 0);
  });
});
