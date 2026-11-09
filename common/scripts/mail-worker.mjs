#!/usr/bin/env node
// The HMS mail worker outside the web host (docs/MAIL-WORKER.md). On Vercel the mail queue is drained by GET /api/v1/cron/mail (each call sends for up to 40 s) when a mail is
// queued, and by the cron. A 50,000-mail campaign needs many such calls spread over hours; this small loop makes them from any machine that stays on (a VPS, a PC):
//   HMS_URL=https://your-site CRON_SECRET=... node scripts/mail-worker.mjs
// It calls the route again at once while mails are still waiting (remaining > 0), else every HMS_MAIL_EVERY seconds (default 30). It needs nothing but Node 18+ (no packages,
// no database access: the server does all the work). The secret is read from the environment and never printed; the log shows only the counts.
const base = (process.env.HMS_URL ?? "").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET ?? "";
const every = Math.max(5, Number(process.env.HMS_MAIL_EVERY ?? 30)) * 1000;
if (!/^https?:\/\//.test(base) || secret.length < 16) {
  console.error("Set HMS_URL (https://...) and CRON_SECRET (the same value as on the server) in the environment.");
  process.exit(2);
}

let stop = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stop = true));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

let failures = 0;
while (!stop) {
  let wait = every;
  try {
    const r = await fetch(`${base}/api/v1/cron/mail`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(90_000) });
    if (r.status === 401 || r.status === 404) {
      console.error(`${stamp()} the server refused the call (${r.status}): check CRON_SECRET on both sides. Stopping.`);
      process.exit(1);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { data } = await r.json();
    failures = 0;
    console.log(`${stamp()} sent ${data.sent}, failed ${data.failed}, waiting ${data.remaining}`);
    // more is waiting: go again soon (the server paces each hotel to its mail service)
    if (data.remaining > 0 && (data.sent > 0 || data.failed > 0)) wait = 2000;
  } catch (error) {
    failures += 1;
    wait = Math.min(every * 2 ** Math.min(failures, 5), 10 * 60_000);
    console.error(`${stamp()} could not reach the server (${error instanceof Error ? error.message : "error"}); trying again in ${Math.round(wait / 1000)} s`);
  }
  if (!stop) await sleep(wait);
}
console.log(`${stamp()} stopped`);
