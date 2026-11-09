#!/usr/bin/env node
// Route smoke test (R44): calls EVERY route file under src/app/api/v1 on a running dev server and checks the basics, never the business rules:
//   - no answer is a 5xx (a 503 "not set up on this server" is listed apart, it is a plain sentence by design) and none hangs;
//   - a route that needs a session answers 401 without one (and never 200);
//   - a write with an unknown field in its body is refused (422/403/404/401/409), never 2xx and never 500;
//   - the answer is the one JSON envelope ({ data } or { error: { code, message, traceId } }) unless it is a file.
// It signs in with dev accounts listed in db/.dev-login.txt (the file is read, no password is ever printed or written to the report) and tries each
// route as each role. Writes use dummy ids (all-zero UUID) and an unknown body field, so nothing real is changed; a write route with neither an id nor a
// body schema is listed as "not exercised".
// Usage (dev server on :3000, dev database): node scripts/route-smoke.mjs [--base http://localhost:3000] [--users a,b,c] [--out file.json] [--only prefix]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "src", "app", "api", "v1");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const BASE = opt("base", "http://localhost:3000");
const USERS = opt("users", "dev.superadmin,dev.platform,ui.super,ui.test,dev.corporate,dev.guest").split(",");
const OUT = opt("out", path.join(here, "..", "..", "common", "docs", "sessions", "route-smoke-report.json"));
const ONLY = opt("only", "");
const LOGIN_FILE = path.join(here, "..", "..", "common", "db", ".dev-login.txt");
const UUID = "00000000-0000-4000-8000-0000000000aa";
const TIMEOUT_MS = 120_000;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === "route.ts" ? [path.join(dir, e.name)] : []));
}

function routes() {
  const out = [];
  for (const file of walk(root)) {
    const rel = path.relative(root, path.dirname(file)).split(path.sep);
    const text = fs.readFileSync(file, "utf8");
    const urlPath = "/api/v1/" + rel.map((seg) => (seg.startsWith("[") ? (seg === "[file]" ? "smoke.jpg" : seg === "[slug]" ? "no-such-hotel" : seg === "[id]" ? UUID : "smoke") : seg)).join("/");
    const hasParams = rel.some((s) => s.startsWith("["));
    for (const m of text.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=\s*(route|publicRoute)\(\{([\s\S]*?)\n\}\);/g)) {
      const block = m[3];
      out.push({ method: m[1], url: urlPath, route: "/" + rel.join("/"), public: m[2] === "publicRoute", hasParams, hasBody: /\n\s*body:/.test(block) || /^\s*body:/.test(block), file: path.relative(root, file) });
    }
  }
  return out.filter((r) => r.route.startsWith(ONLY));
}

function passwords() {
  const map = new Map();
  let user = null;
  for (const line of fs.readFileSync(LOGIN_FILE, "utf8").split(/\r?\n/)) {
    const u = /^username:\s*(\S+)/.exec(line);
    if (u) { user = u[1]; continue; }
    const p = /^[^:]*password.*:\s*(\S+)\s*$/i.exec(line);
    if (user && p) map.set(user, p[1]);
  }
  return map;
}

async function call(method, url, { cookie, body } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, redirect: "manual" });
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let json = null;
    if (/json/.test(type)) { try { json = JSON.parse(text); } catch { json = undefined; } }
    return { status: res.status, type, json, ms: Date.now() - started, set: res.headers.getSetCookie?.() ?? [] };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timeout" : String(e.message), ms: Date.now() - started, set: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function signIn(username, password) {
  const res = await call("POST", "/api/v1/auth/sign-in", { body: { username, password, device: { platform: "web", name: "route-smoke" } } });
  if (res.status !== 200 || res.json?.data?.status !== "signed_in") return { ok: false, why: res.json?.data?.status ?? `status ${res.status}` };
  const cookie = res.set.map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-hms_session="));
  return cookie ? { ok: true, cookie } : { ok: false, why: "no cookie" };
}

const findings = [];
const note = (kind, r, who, res, extra = "") => findings.push({ kind, method: r.method, route: r.route, as: who, status: res.status, ms: res.ms, extra });

function envelopeOk(res) {
  if (res.status === 204 || res.status === 0) return true;
  if (!/json/.test(res.type)) return res.status < 400; // a file or an empty body is fine on success
  if (res.json === undefined || res.json === null) return false;
  return "data" in res.json || ("error" in res.json && typeof res.json.error?.code === "string" && typeof res.json.error?.message === "string");
}

async function check(r, who, cookie, counters) {
  const writes = r.method !== "GET" && r.method !== "OPTIONS";
  const body = writes && r.hasBody ? { __smoke: true } : undefined;
  if (writes && !r.hasBody && !r.hasParams && !r.public) { counters.skipped.add(`${r.method} ${r.route}`); return; }
  const res = await call(r.method, r.url + (r.method === "GET" && r.public === false ? "" : ""), { cookie, body });
  counters.calls += 1;
  counters.byStatus[res.status] = (counters.byStatus[res.status] ?? 0) + 1;
  if (res.status === 0) return note("no-answer", r, who, res, res.error);
  if (res.status >= 500 && res.status !== 503) return note("server-error", r, who, res, res.json?.error?.code ?? "");
  if (res.status === 503) note("503-by-design?", r, who, res, res.json?.error?.message ?? "");
  if (!envelopeOk(res)) note("not-the-envelope", r, who, res, res.type);
  if (who === "anonymous" && !r.public && res.status !== 401 && res.status !== 404 && res.status !== 429) note("auth-hole", r, who, res, "answered without a session");
  if (who !== "anonymous" && writes && res.status >= 200 && res.status < 300 && r.hasBody) note("lenient-body", r, who, res, "an unknown field was accepted");
  if (writes && who === "anonymous" && !r.public && res.status >= 200 && res.status < 300) note("auth-hole", r, who, res, "write answered 2xx without a session");
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } }));
}

const all = routes();
console.log(`${all.length} route methods in ${new Set(all.map((r) => r.route)).size} route files`);
const pw = passwords();
const sessions = [{ who: "anonymous", cookie: undefined }];
for (const u of USERS) {
  const p = pw.get(u);
  if (!p) { console.log(`no password for ${u} in db/.dev-login.txt: skipped`); continue; }
  const s = await signIn(u, p);
  console.log(`sign-in ${u}: ${s.ok ? "ok" : "not usable (" + s.why + ")"}`);
  if (s.ok) sessions.push({ who: u, cookie: s.cookie });
}
const counters = { calls: 0, byStatus: {}, skipped: new Set() };
for (const s of sessions) {
  const started = Date.now();
  await pool(all, 4, (r) => check(r, s.who, s.cookie, counters));
  console.log(`${s.who}: done in ${Math.round((Date.now() - started) / 1000)} s`);
}
const summary = {};
for (const f of findings) summary[f.kind] = (summary[f.kind] ?? 0) + 1;
const report = { base: BASE, routeMethods: all.length, calls: counters.calls, byStatus: counters.byStatus, notExercised: [...counters.skipped].sort(), summary, findings };
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ calls: counters.calls, byStatus: counters.byStatus, summary, notExercised: counters.skipped.size }));
console.log("report:", OUT);
process.exit(findings.some((f) => f.kind === "server-error" || f.kind === "auth-hole" || f.kind === "no-answer") ? 1 : 0);
