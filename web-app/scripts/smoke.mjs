// Smoke test of a RUNNING HMS server, from outside, with nothing but Node (no secrets, no sign-in).  Usage:
//   node scripts/smoke.mjs https://hms.example.in            (a deployed server)
//   node scripts/smoke.mjs http://localhost:3000 --dev       (a local server: skips the https-only checks)
// It checks that the server is up and ready, that the security headers are on, that the API answers JSON errors and refuses a stranger, and that the
// sign-in refuses a wrong password the same way for any name. It exits 1 on the first failed check group and prints what failed.
const base = (process.argv[2] ?? "").replace(/\/+$/, "");
const dev = process.argv.includes("--dev");
if (!/^https?:\/\//.test(base)) {
  process.stderr.write("Usage: node scripts/smoke.mjs <server address> [--dev]\n");
  process.exit(2);
}

const failures = [];
const check = (name, ok, detail = "") => {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}\n`);
  if (!ok) failures.push(name);
};
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });

const health = await get("/api/v1/health").catch((e) => ({ status: 0, error: e }));
check("liveness: GET /api/v1/health is 200", health.status === 200, `status ${health.status}`);

const ready = await get("/api/v1/health/ready").catch(() => ({ status: 0, json: async () => ({}) }));
const readyBody = await ready.json().catch(() => ({}));
check("readiness: GET /api/v1/health/ready is 200 and ready", ready.status === 200 && readyBody?.data?.status === "ready", `status ${ready.status}`);
check("readiness: the database answers when one is configured", readyBody?.data?.db === "ok" || readyBody?.data?.db === "not configured", String(readyBody?.data?.db));

const home = await get("/");
check("the home page answers (200 or a redirect to sign-in)", [200, 301, 302, 303, 307, 308].includes(home.status), `status ${home.status}`);
const h = home.headers;
check("header: X-Content-Type-Options nosniff", h.get("x-content-type-options") === "nosniff");
check("header: X-Frame-Options DENY", h.get("x-frame-options") === "DENY");
check("header: Referrer-Policy no-referrer", h.get("referrer-policy") === "no-referrer");
check("header: no X-Powered-By", h.get("x-powered-by") === null);
if (!dev) {
  check("header: Strict-Transport-Security", /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""));
  check("header: Content-Security-Policy refuses framing and other sites", /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? "") && /default-src 'self'/.test(h.get("content-security-policy") ?? ""));
  check("the address is https", base.startsWith("https://"));
}

const session = await get("/api/v1/auth/session");
const sessionBody = await session.json().catch(() => null);
check("a stranger gets 401 from GET /api/v1/auth/session, as JSON with a trace id", session.status === 401 && typeof sessionBody?.error?.traceId === "string", `status ${session.status}`);
const strangerData = await get("/api/v1/billing/bills");
check("a stranger gets 401 from a data route", strangerData.status === 401, `status ${strangerData.status}`);

const signIn = (username) =>
  get("/api/v1/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ username, password: "Wrong#Password1", device: { platform: "web", name: "smoke test" } }),
  });
const a = await signIn("smoke.no.such.user");
const b = await signIn("smoke.another.name");
const aBody = await a.json().catch(() => null);
const bBody = await b.json().catch(() => null);
check("a wrong sign-in is 401 INVALID_CREDENTIALS, the same for any name", a.status === 401 && b.status === 401 && aBody?.error?.code === "INVALID_CREDENTIALS" && aBody?.error?.message === bBody?.error?.message, `${a.status}/${b.status}`);

const cross = await get("/api/v1/auth/sign-in", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check("a sign-in from another site is refused (403)", cross.status === 403, `status ${cross.status}`);

process.stdout.write(failures.length === 0 ? "\nSMOKE TEST PASSED\n" : `\nSMOKE TEST FAILED: ${failures.length} check(s)\n`);
process.exit(failures.length === 0 ? 0 : 1);
