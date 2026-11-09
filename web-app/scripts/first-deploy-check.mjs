// First-deploy check of a hosted HMS (Vercel or a VPS), from outside, with nothing but Node.  Usage:
//   node scripts/first-deploy-check.mjs https://hms.example.in
//   CRON_SECRET=... node scripts/first-deploy-check.mjs https://hms.example.in     (also calls the mail cron route once with the secret)
// Checks: liveness and readiness (with the database), the security headers, the cron route refuses a caller without the secret (401; 404 = CRON_SECRET
// is not set on the host), and, when CRON_SECRET is in this shell's environment, that the route accepts it and answers {sent, failed, remaining}.
// It never prints a secret, a header value it sent, or a response body beyond the fields named here. Exits 1 when a check fails.
const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) {
  process.stderr.write("Usage: node scripts/first-deploy-check.mjs https://<the deployed address>\n");
  process.exit(2);
}
const secret = (process.env.CRON_SECRET ?? "").trim();

const failures = [];
const check = (name, ok, detail = "") => {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}\n`);
  if (!ok) failures.push(name);
};
const get = (path, headers = {}) => fetch(base + path, { redirect: "manual", headers }).catch(() => ({ status: 0, headers: new Headers(), json: async () => null }));

const started = Date.now();
const health = await get("/api/v1/health");
const healthBody = await health.json().catch(() => null);
check("GET /api/v1/health is 200 {status: ok}", health.status === 200 && healthBody?.data?.status === "ok", `status ${health.status}`);
process.stdout.write(`     first answer took ${Date.now() - started} ms (a cold function and a suspended database make the first one slow)\n`);

// a suspended Neon database can take longer to wake than readiness waits (2 s): one 503 is retried once after 3 s
let ready = await get("/api/v1/health/ready");
if (ready.status === 503) {
  process.stdout.write("     readiness answered 503 (database waking up?), trying again in 3 s\n");
  await new Promise((r) => setTimeout(r, 3000));
  ready = await get("/api/v1/health/ready");
}
const readyBody = await ready.json().catch(() => null);
check("GET /api/v1/health/ready is 200 and ready", ready.status === 200 && readyBody?.data?.status === "ready", `status ${ready.status}`);
check("the database answers (db: ok)", readyBody?.data?.db === "ok", String(readyBody?.data?.db ?? "no answer"));

const home = await get("/");
const h = home.headers;
check("header: Strict-Transport-Security", /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""));
check("header: Content-Security-Policy with frame-ancestors 'none'", /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? ""));
check("header: X-Content-Type-Options nosniff", h.get("x-content-type-options") === "nosniff");
check("header: X-Frame-Options DENY", h.get("x-frame-options") === "DENY");
check("header: Referrer-Policy no-referrer", h.get("referrer-policy") === "no-referrer");
check("header: no X-Powered-By", h.get("x-powered-by") === null);
const api = await get("/api/v1/health");
check("API answers carry cache-control: no-store", (api.headers.get("cache-control") ?? "").includes("no-store"));

const cronNone = await get("/api/v1/cron/mail");
if (cronNone.status === 404) check("cron route: CRON_SECRET is set on the host (404 means it is not, and no mail is sent with HMS_MAIL_WORKER=cron)", false, "404");
else check("cron route: 401 without the secret", cronNone.status === 401, `status ${cronNone.status}`);
const cronWrong = await get("/api/v1/cron/mail", { authorization: "Bearer not-the-secret-not-the-secret-0000" });
check("cron route: 401 with a wrong secret", cronWrong.status === 401 || cronWrong.status === 404, `status ${cronWrong.status}`);

if (secret) {
  const cron = await get("/api/v1/cron/mail", { authorization: `Bearer ${secret}` });
  const body = await cron.json().catch(() => null);
  const d = body?.data;
  check("cron route: 200 {sent, failed, remaining} with the secret from this shell", cron.status === 200 && [d?.sent, d?.failed, d?.remaining].every((n) => Number.isInteger(n)), `status ${cron.status}`);
  if (cron.status === 200) process.stdout.write(`     mail pass: sent ${d.sent}, failed ${d.failed}, still waiting ${d.remaining}\n`);
} else {
  process.stdout.write("     (CRON_SECRET not in this shell: the accepted-secret check was skipped)\n");
}

process.stdout.write(failures.length === 0 ? "\nFIRST-DEPLOY CHECK PASSED. Now run: node scripts/smoke.mjs " + base + "\n" : `\nFIRST-DEPLOY CHECK FAILED: ${failures.length} check(s)\n`);
process.exit(failures.length === 0 ? 0 : 1);
