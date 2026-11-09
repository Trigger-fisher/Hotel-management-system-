// Speed check (docs/plans/PLAN-SPEED.md B1): N parallel users read the consoles' list and detail routes for S seconds against a running server, then
// the server time (the Server-Timing header) and the round trip per route are printed, slowest first. Reads only: nothing is changed.
//   node scripts/load.mjs <base-url> --cookies <file.json> [--users 20] [--seconds 60] [--out result.json]
// The cookie file maps a console to a signed-in session cookie, e.g. {"hotel":"__Host-hms_session=...","platform":"...","guest":"..."} (keep it out of git).
// Known kinds: hotel, hotelAdmin, platform, superadmin, group, guest, corporate. A kind missing from the file is skipped.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = (args[0] ?? "").replace(/\/$/, "");
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!base || !opt("--cookies")) {
  console.error("usage: node scripts/load.mjs <base-url> --cookies <file.json> [--users 20] [--seconds 60] [--out result.json]");
  process.exit(2);
}
const cookies = JSON.parse(readFileSync(opt("--cookies"), "utf8"));
const USERS = Number(opt("--users", "20"));
const SECONDS = Number(opt("--seconds", "60"));
const month = new Date().toISOString().slice(0, 7);

const HOTEL = [
  "/api/v1/auth/session", "/api/v1/profile", "/api/v1/overview/dashboard", "/api/v1/search?q=ra",
  "/api/v1/billing/bills", "/api/v1/billing/bills/{billId}", "/api/v1/billing/advances", "/api/v1/billing/options",
  "/api/v1/front-office/board", "/api/v1/front-office/stays", "/api/v1/front-office/stays/{stayId}", "/api/v1/front-office/reservations", "/api/v1/front-office/rooms", "/api/v1/front-office/options",
  "/api/v1/companies", "/api/v1/companies/{companyProfileId}", "/api/v1/companies/customers", "/api/v1/companies/ledger", "/api/v1/companies/crm/leads",
  "/api/v1/revenue/deposits", "/api/v1/expense/entries", "/api/v1/handover", "/api/v1/cash/lookups",
  "/api/v1/payroll/companies", "/api/v1/payroll/companies/{companyId}/dashboard", "/api/v1/payroll/companies/{companyId}/employees", "/api/v1/payroll/companies/{companyId}/staff",
  "/api/v1/payroll/companies/{companyId}/slips", "/api/v1/payroll/companies/{companyId}/attendance/{month}", "/api/v1/payroll/companies/{companyId}/payments", "/api/v1/payroll/log", "/api/v1/payroll/master",
  "/api/v1/reports/daily", "/api/v1/reports/food-plan",
  "/api/v1/admin/users", "/api/v1/admin/roles", "/api/v1/admin/masters", "/api/v1/admin/recycle", "/api/v1/admin/settings", "/api/v1/admin/menu",
  "/api/v1/system/log", "/api/v1/system/health", "/api/v1/website/overview", "/api/v1/website/enquiries", "/api/v1/website/rooms",
];
const PLATFORM = ["/api/v1/auth/session", "/api/v1/platform/overview", "/api/v1/platform/hotels", "/api/v1/platform/groups", "/api/v1/platform/invitations", "/api/v1/platform/hotel-admins", "/api/v1/platform/users", "/api/v1/platform/staff", "/api/v1/platform/audit", "/api/v1/platform/activity", "/api/v1/platform/sign-ins", "/api/v1/platform/archived-hotels"];
const ROUTES = {
  hotel: HOTEL,
  hotelAdmin: ["/api/v1/auth/session", "/api/v1/overview/dashboard", "/api/v1/billing/bills", "/api/v1/billing/advances", "/api/v1/companies", "/api/v1/revenue/deposits", "/api/v1/expense/entries"],
  platform: PLATFORM,
  superadmin: [...PLATFORM, "/api/v1/platform/settings", "/api/v1/platform/health"],
  group: ["/api/v1/auth/session", "/api/v1/group/overview", "/api/v1/group/hotels", "/api/v1/group/hotel-admins", "/api/v1/group/invitations", "/api/v1/group/activity"],
  guest: ["/api/v1/auth/session", "/api/v1/guest/overview", "/api/v1/guest/bills", "/api/v1/guest/history", "/api/v1/guest/menu", "/api/v1/guest/profile"],
  corporate: ["/api/v1/auth/session", "/api/v1/corporate/overview", "/api/v1/corporate/bills", "/api/v1/corporate/bookings", "/api/v1/corporate/dues", "/api/v1/corporate/ledger", "/api/v1/corporate/payments", "/api/v1/corporate/profile", "/api/v1/corporate/team"],
};
// how often a virtual user is of each kind: hotel staff do most of the work
const WEIGHT = { hotel: 8, hotelAdmin: 3, platform: 1, superadmin: 1, group: 1, guest: 2, corporate: 2 };

/** The first id in a list answer (data.rows / data.items / data as an array / the first array inside data). */
function firstId(data) {
  const lists = [data?.rows, data?.items, Array.isArray(data) ? data : null, ...Object.values(data ?? {}).filter(Array.isArray)];
  for (const list of lists) if (Array.isArray(list) && list[0]?.id) return String(list[0].id);
  return null;
}

const get = async (path, cookie) => {
  const started = performance.now();
  const res = await fetch(base + path, { headers: { cookie } });
  const text = await res.text();
  const client = performance.now() - started;
  const server = Number(/app;dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "")?.[1] ?? NaN);
  const auth = Number(/auth;dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "")?.[1] ?? NaN);
  return { status: res.status, client, server, auth, bytes: text.length, text };
};

// the ids the detail routes need, read once from the lists (hotel console)
const ids = { month };
if (cookies.hotel) {
  const take = async (key, path) => {
    const r = await get(path, cookies.hotel);
    try {
      ids[key] = firstId(JSON.parse(r.text).data);
    } catch {
      ids[key] = null;
    }
  };
  await take("billId", "/api/v1/billing/bills");
  await take("stayId", "/api/v1/front-office/stays?view=past");
  await take("companyProfileId", "/api/v1/companies");
  await take("companyId", "/api/v1/payroll/companies");
}
const fill = (path) => path.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? "missing");

const kinds = Object.keys(ROUTES).filter((k) => cookies[k]);
const bag = kinds.flatMap((k) => Array(WEIGHT[k]).fill(k));
const stats = new Map();
const record = (key, r) => {
  const s = stats.get(key) ?? { n: 0, server: [], auth: [], client: [], status: {}, bytes: 0 };
  s.n++;
  if (!Number.isNaN(r.server)) s.server.push(r.server);
  if (!Number.isNaN(r.auth)) s.auth.push(r.auth);
  s.client.push(r.client);
  s.status[r.status] = (s.status[r.status] ?? 0) + 1;
  s.bytes = Math.max(s.bytes, r.bytes);
  stats.set(key, s);
};

const until = Date.now() + SECONDS * 1000;
let errors = 0;
async function user() {
  while (Date.now() < until) {
    const kind = bag[Math.floor(Math.random() * bag.length)];
    const routes = ROUTES[kind];
    const path = fill(routes[Math.floor(Math.random() * routes.length)]);
    if (path.includes("missing")) continue;
    try {
      record(`${kind} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "{id}")}`, await get(path, cookies[kind]));
    } catch {
      errors++;
    }
  }
}
console.log(`${USERS} users for ${SECONDS} s on ${base} (kinds: ${kinds.join(", ")})`);
await Promise.all(Array.from({ length: USERS }, user));

const pct = (arr, p) => {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const rows = [...stats.entries()].map(([route, s]) => ({ route, n: s.n, status: s.status, serverP50: pct(s.server, 50), serverP95: pct(s.server, 95), authP50: pct(s.auth, 50), clientP50: pct(s.client, 50), clientP95: pct(s.client, 95), maxBytes: s.bytes }));
const p95 = (r) => (Number.isNaN(r.serverP95) ? r.clientP95 : r.serverP95);
rows.sort((a, b) => p95(b) - p95(a));
const total = rows.reduce((t, r) => t + r.n, 0);
const f = (x) => (Number.isNaN(x) ? "-" : x.toFixed(0).padStart(5));
console.log(`\n${total} requests (${(total / SECONDS).toFixed(0)}/s), ${errors} network errors\n`);
console.log("server p50  p95 auth50 | trip p50  p95 |     n | KB  | status | route");
for (const r of rows) console.log(`      ${f(r.serverP50)} ${f(r.serverP95)}  ${f(r.authP50)} |    ${f(r.clientP50)} ${f(r.clientP95)} | ${String(r.n).padStart(5)} | ${String(Math.round(r.maxBytes / 1024)).padStart(3)} | ${Object.entries(r.status).map(([k, v]) => `${k}:${v}`).join(" ")} | ${r.route}`);
const over = rows.filter((r) => p95(r) > 150);
console.log(`\nover the 150 ms read budget (server p95, or the round trip when the server sends no timing): ${over.length} of ${rows.length} routes`);
if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify({ base, users: USERS, seconds: SECONDS, total, errors, rows }, null, 1));
