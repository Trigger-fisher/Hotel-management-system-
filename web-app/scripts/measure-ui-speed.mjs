// Page-change and search timing in a real browser. Reads only: it clicks menu entries and types in the search box, nothing is saved.
//
//   node web-app/scripts/measure-ui-speed.mjs --url http://localhost:3020 --cookie "<name>=<value>" [--chrome <path>] [--port 9444] [--idle 8000]
//
// The cookie is the signed-in session cookie of a test login (copy it from the browser's Application tab; never commit it, never paste it in chat).
// Run it on a production build (`npm run build`, `npm start`), not on `npm run dev`. It starts its own headless Chrome with a throw-away profile.
//
// What it prints (milliseconds, one table):
//   - for Bills, Revenue and Customers: first open and second open (after visiting the dashboard in between),
//     "ready" = the page title changed and no [aria-busy] (skeleton) is left in #dash-content; and whether a skeleton was ever seen.
//   - search: the time until the first "Screens" row (from the menu, no request) and until the first server group appears.
// Run it twice (before a change and after) and compare the two tables. The pause before the first click (--idle, default 8 s) is the time the
// background preload of the screen groups gets; use --idle 0 to see the cost without it.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url');
const cookie = arg('cookie');
const port = Number(arg('port', '9444'));
const idleMs = Number(arg('idle', '8000'));
const chrome = arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
if (!url || !cookie) {
  console.error('usage: node measure-ui-speed.mjs --url <https://host> --cookie "<name>=<value>" [--chrome <path>] [--port 9444] [--idle 8000]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'hms-speed-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { await sleep(250); }
}
if (!ready) { proc.kill(); console.error('Chrome did not start'); process.exit(1); }

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
  return r.result?.result?.value;
};

const [cname, ...cvalue] = cookie.split('=');
await send('Network.enable');
await send('Network.setCookie', { name: cname, value: cvalue.join('='), url, httpOnly: true });
await send('Page.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('#sidebar')`)); i++) await sleep(500);
if (!(await ev(`!!document.querySelector('#sidebar')`))) { console.error('Not signed in: the cookie was not accepted (expired?).'); proc.kill(); process.exit(1); }
await sleep(idleMs);

// Click a menu entry by its label; resolve with the time until the title changed and no skeleton is left.
const go = (label) => ev(`new Promise((resolve) => {
  const link = [...document.querySelectorAll('#sidebar a, #sidebar button')].find((e) => e.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)});
  if (!link) { resolve({ err: 'no menu entry ' + ${JSON.stringify(label)} }); return; }
  const t0 = performance.now(); const from = document.title; let skeleton = false;
  link.click();
  const tick = () => {
    const busy = !!document.querySelector('#dash-content [aria-busy="true"]');
    if (busy) skeleton = true;
    if (document.title !== from && !busy) { resolve({ ms: Math.round(performance.now() - t0), skeleton }); return; }
    if (performance.now() - t0 > 10000) { resolve({ err: 'timeout', skeleton }); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`);

const rows = [];
for (const label of ['Bills', 'Revenue', 'Customers']) {
  const first = await go(label); await sleep(1200);
  await go('Dashboard'); await sleep(1200);
  const second = await go(label); await sleep(1200);
  rows.push({ screen: label, 'first open ms': first.ms ?? first.err, 'first skeleton': first.skeleton ?? '', 'second open ms': second.ms ?? second.err, 'second skeleton': second.skeleton ?? '' });
}
console.table(rows);

// Search: type 2+ letters and time the first Screens row and the first server group.
const search = await ev(`new Promise(async (resolve) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.gs-btn')?.click(); await wait(250);
  const input = document.querySelector('.gs-panel input');
  if (!input) { resolve({ err: 'no search box' }); return; }
  const t0 = performance.now();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'cus');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  let screensAt = null, serverAt = null;
  while (performance.now() - t0 < 5000) {
    const heads = [...document.querySelectorAll('.pp-head span')].map((x) => x.textContent);
    if (heads.includes('Screens') && screensAt === null) screensAt = Math.round(performance.now() - t0);
    if (heads.some((h) => h !== 'Screens') && serverAt === null) { serverAt = Math.round(performance.now() - t0); break; }
    await wait(10);
  }
  resolve({ 'first Screens row ms': screensAt, 'first server group ms': serverAt });
})`);
console.table([search]);

ws.close();
proc.kill();
