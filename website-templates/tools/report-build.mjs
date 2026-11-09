// Tells HMS how the "Create hotel site" job is going: building, then live or failed. The report is signed with the secret HMS and the workflow share
// (HMAC-SHA256 over "<unix seconds>.<build id>.<body>", headers x-hms-timestamp and x-hms-signature; the build id is the last part of CALLBACK_URL); HMS refuses anything unsigned or older than ten minutes.
// Usage:  SITE_BUILD_SECRET=... CALLBACK_URL=https://hms.example/api/v1/public/site-builds/<id> node report-build.mjs --status building|live|failed [--message "..."] [--run-url https://...] [--site-url https://...]
// Optional: SITE_URL_PATTERN (like https://{hotel}.yourhms.in) with HOTEL fills the site address of a `live` report. Retries three times on a network error or a 5xx.
import { createHmac } from 'node:crypto';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const secret = process.env.SITE_BUILD_SECRET ?? '';
const callback = process.env.CALLBACK_URL ?? '';
const status = args.status ?? '';

if (secret.length < 32) fail('SITE_BUILD_SECRET is not set (at least 32 characters).');
if (!['building', 'live', 'failed'].includes(status)) fail('--status must be building, live or failed.');
// only HMS's own report address: https (or this machine, for tests), the fixed path, and a build id
if (!/^https:\/\/[^/\s]+\/api\/v1\/public\/site-builds\/[0-9a-f-]{36}$/.test(callback) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/v1\/public\/site-builds\/[0-9a-f-]{36}$/.test(callback)) fail('CALLBACK_URL is not an HMS site-builds address.');
// the build id is signed with the body, so this report cannot be replayed against another build
const buildId = callback.slice(callback.lastIndexOf('/') + 1).toLowerCase();

const clip = (v, n) => (v ? String(v).slice(0, n) : undefined);
const httpsOnly = (v) => (v && /^https:\/\/\S+$/.test(v) ? v.slice(0, 500) : undefined);
let siteUrl = httpsOnly(args['site-url']);
if (!siteUrl && status === 'live' && process.env.SITE_URL_PATTERN && process.env.HOTEL) siteUrl = httpsOnly(process.env.SITE_URL_PATTERN.replace('{hotel}', process.env.HOTEL));
const body = JSON.stringify({
  status,
  ...(clip(args.message, 500) ? { message: clip(args.message, 500).replace(/[\u0000-\u001f\u007f]/g, ' ') } : {}),
  ...(httpsOnly(args['run-url']) ? { runUrl: httpsOnly(args['run-url']) } : {}),
  ...(siteUrl ? { siteUrl } : {}),
});

let last = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac('sha256', secret).update(`${ts}.${buildId}.${body}`).digest('hex')}`;
  try {
    const res = await fetch(callback, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hms-timestamp': String(ts), 'x-hms-signature': signature }, body, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      console.log(`Reported ${status} to HMS.`);
      process.exit(0);
    }
    last = `HMS answered ${res.status}`;
    if (res.status < 500) break; // a 4xx will not get better by asking again
  } catch (e) {
    last = `could not reach HMS (${e?.name ?? 'error'})`;
  }
  await new Promise((r) => setTimeout(r, attempt * 2000));
}
fail(`Could not report ${status}: ${last}.`);
