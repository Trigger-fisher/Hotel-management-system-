// Write speed check (docs/plans/PLAN-SPEED.md): N parallel users create bills and advances, mark salary payments, save attendance and check guests
// in and out for S seconds against a running server, then the server time per kind of write is printed. THIS CHANGES DATA: run it only on a
// throwaway hotel (the PERF-Test Hotel of `db:cli perf-hotel create`), never on a real one.
//   node scripts/load-writes.mjs <base-url> --cookie <file.json> [--users 10] [--seconds 60] [--today YYYY-MM-DD] [--out result.json]
// The cookie file is {"hotel": "__Host-hms_session=..."} for a Hotel Admin of the throwaway hotel. Every 5th bill is sent with an Idempotency-Key and sent
// again: the second answer must be the replay of the first (same id).
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = (args[0] ?? "").replace(/\/$/, "");
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!base || !opt("--cookie")) {
  console.error("usage: node scripts/load-writes.mjs <base-url> --cookie <file.json> [--users 10] [--seconds 60] [--today YYYY-MM-DD] [--out result.json]");
  process.exit(2);
}
const cookie = JSON.parse(readFileSync(opt("--cookie"), "utf8")).hotel;
const USERS = Number(opt("--users", "10"));
const SECONDS = Number(opt("--seconds", "60"));
const today = opt("--today", new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const run = Date.now().toString(36).slice(-5).toUpperCase();
let counter = 0;
const next = () => `${run}${++counter}`;

async function call(method, path, body, headers = {}) {
  const started = performance.now();
  const res = await fetch(base + path, { method, headers: { cookie, origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, ms: performance.now() - started, server: Number(/app;dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "")?.[1] ?? NaN), json, replayed: res.headers.get("idempotent-replayed") === "true" };
}

const stats = new Map();
const firstError = new Map();
function record(kind, r) {
  const s = stats.get(kind) ?? { n: 0, server: [], status: {} };
  s.n++;
  if (!Number.isNaN(r.server)) s.server.push(r.server);
  s.status[r.status] = (s.status[r.status] ?? 0) + 1;
  stats.set(kind, s);
  if (r.status >= 400 && r.status !== 409 && !firstError.has(`${kind} ${r.status}`)) firstError.set(`${kind} ${r.status}`, JSON.stringify(r.json?.error ?? r.json).slice(0, 300));
}

// ---- set-up: the payroll company, September's payments, a few staff for attendance, load-test rooms ----
const companies = (await call("GET", "/api/v1/payroll/companies")).json?.data;
const companyList = Array.isArray(companies) ? companies : (companies?.rows ?? companies?.items ?? Object.values(companies ?? {}).find(Array.isArray) ?? []);
const companyId = companyList.find((c) => c.code === "HP01")?.id ?? companyList[0]?.id;
const sept = (await call("GET", `/api/v1/payroll/companies/${companyId}/payments?period=2026-09&page=1&pageSize=100`)).json?.data;
const payments = (sept?.rows ?? []).map((r) => ({ id: r.id, version: r.version, status: r.paymentStatus }));
const staff = (await call("GET", `/api/v1/payroll/companies/${companyId}/employees?page=1&pageSize=50`)).json?.data?.items ?? [];
const month = today.slice(0, 7);
await call("GET", `/api/v1/payroll/companies/${companyId}/attendance/${month}`);
const elapsed = Number(today.slice(8, 10));
const rooms = [];
for (let i = 1; i <= 30; i++) {
  const r = await call("POST", "/api/v1/front-office/rooms", { number: `L${700 + i}`, floor: "7", roomTypeId: "", notes: "load test" });
  if (r.status === 201) rooms.push(r.json.data.id);
}
if (rooms.length < 30) {
  const listed = (await call("GET", "/api/v1/front-office/rooms")).json?.data;
  const all = Array.isArray(listed) ? listed : (listed?.rows ?? listed?.items ?? Object.values(listed ?? {}).find(Array.isArray) ?? []);
  for (const r of all) if (String(r.number).startsWith("L7") && !rooms.includes(r.id)) rooms.push(r.id);
}
const freeRooms = [...rooms];
console.log(`set-up: company ${companyId ? "found" : "MISSING"}, ${payments.length} September payments, ${staff.length} staff, ${rooms.length} load-test rooms, today ${today}`);

// ---- the writes ----
const bill = () => ({
  billNo: next(), billDate: today, grNo: "", advanceId: null, guestName: "PERF Load Guest", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null, roomNo: "204", persons: 2,
  arrivalAt: `${today}T06:30:00Z`, departureAt: `${today}T08:30:00Z`,
  hotel: { plan: "CP", roomPaise: 400000, planPaise: 50000, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 22500, mode: "Cash" },
  food: { foodPaise: 120000, planPaise: 0, laundryPaise: 0, gstPaise: 6000, mode: "Cash" },
  stay: [{ from: today, to: tomorrow, plan: "CP", persons: 2 }], referenceName: "", referenceMobile: "", instruction: "",
});
const advance = () => ({ receiptNo: next(), paymentDate: today, guestName: "PERF Load Guest", mobile: "9876543210", companyId: null, roomNo: "204", covers: "hotel", hotelPaise: 500000, foodPaise: null, hotelMode: "UPI", foodMode: null, referenceName: "", referenceMobile: "", instruction: "" });
let replayOk = 0;
let replayBad = 0;
let billNo = 0;

const ops = {
  async billCreate() {
    billNo++;
    if (billNo % 5 === 0) {
      const key = randomUUID();
      const body = bill();
      const a = await call("POST", "/api/v1/billing/bills", body, { "idempotency-key": key });
      record("bill create (with key)", a);
      const b = await call("POST", "/api/v1/billing/bills", body, { "idempotency-key": key });
      record("bill create (same key again)", b);
      if (a.status === 201 && b.status === 201 && b.replayed && a.json?.data?.id === b.json?.data?.id) replayOk++;
      else if (a.status === 201) replayBad++;
      return;
    }
    record("bill create", await call("POST", "/api/v1/billing/bills", bill()));
  },
  async advanceCreate() {
    record("advance create", await call("POST", "/api/v1/billing/advances", advance()));
  },
  async paymentMark() {
    if (payments.length === 0) return;
    const p = payments[Math.floor(Math.random() * payments.length)];
    const status = p.status === "Paid" ? "Processing" : "Paid";
    const r = await call("PATCH", `/api/v1/payroll/companies/${companyId}/payments/${p.id}`, { status, paidPaise: null, paidOn: status === "Paid" ? today : "", reference: "", remarks: "", version: p.version });
    record("payment mark", r);
    if (r.status === 200) {
      p.version = r.json.data.version;
      p.status = r.json.data.paymentStatus;
    } else if (r.status === 409 && r.json?.error?.details?.currentVersion) p.version = r.json.error.details.currentVersion;
  },
  async attendanceSave() {
    if (staff.length === 0) return;
    const picked = Array.from({ length: 5 }, () => staff[Math.floor(Math.random() * staff.length)]);
    const rows = [...new Map(picked.map((e) => [e.id, e])).values()].map((e) => ({ employeeId: e.id, days: Array.from({ length: elapsed }, (_, d) => ((d + e.employeeCode.length) % 9 === 0 ? "H" : "P")) }));
    record("attendance save (5 staff)", await call("PUT", `/api/v1/payroll/companies/${companyId}/attendance/${month}`, { rows }));
  },
  async checkInOut() {
    const roomId = freeRooms.shift();
    if (!roomId) return;
    try {
      const inRes = await call("POST", "/api/v1/front-office/stays", {
        reservationId: "", roomId, expectedCheckOut: tomorrow, grNumber: `GR-${next()}`, adults: 2, children: 0, plan: "CP", ratePaise: 250000, guestName: "PERF Load Guest", mobile: "+91 98765 43210",
        email: "", address: "1 Ring Road", city: "Rajkot", nationality: "Indian", idProofType: "Aadhaar", idProofNumber: "1234 5678 9012", companyId: "", guestGstin: "", notes: "",
      });
      record("check-in", inRes);
      if (inRes.status !== 201) return;
      const stay = inRes.json.data;
      const outRes = await call("POST", `/api/v1/front-office/stays/${stay.id}/checkout`, { billNumber: next(), billDate: today, hotelGstPercent: 12, foodGstPercent: 5, hotelMode: "Cash", foodMode: "UPI", instruction: "", version: stay.version });
      record("check-out (with bill)", outRes);
    } finally {
      freeRooms.push(roomId);
    }
  },
};
const names = Object.keys(ops);
const until = Date.now() + SECONDS * 1000;
let networkErrors = 0;
async function user() {
  while (Date.now() < until) {
    try {
      await ops[names[Math.floor(Math.random() * names.length)]]();
    } catch {
      networkErrors++;
    }
  }
}
console.log(`${USERS} users for ${SECONDS} s on ${base}`);
await Promise.all(Array.from({ length: USERS }, user));

const pct = (arr, p) => {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const rows = [...stats.entries()].map(([kind, s]) => ({ kind, n: s.n, p50: pct(s.server, 50), p95: pct(s.server, 95), max: pct(s.server, 100), status: s.status }));
rows.sort((a, b) => b.p95 - a.p95);
const f = (x) => (Number.isNaN(x) ? "    -" : x.toFixed(0).padStart(5));
console.log(`\nnetwork errors ${networkErrors}; idempotent replays right ${replayOk}, wrong ${replayBad}\n`);
console.log("server p50   p95   max |     n | status | write");
for (const r of rows) console.log(`      ${f(r.p50)} ${f(r.p95)} ${f(r.max)} | ${String(r.n).padStart(5)} | ${Object.entries(r.status).map(([k, v]) => `${k}:${v}`).join(" ")} | ${r.kind}`);
for (const [k, v] of firstError) console.log(`first ${k}: ${v}`);
const over = rows.filter((r) => r.p95 > 300);
console.log(`\nover the 300 ms write budget (server p95): ${over.length} of ${rows.length}`);
if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify({ base, users: USERS, seconds: SECONDS, networkErrors, replayOk, replayBad, rows, errors: Object.fromEntries(firstError) }, null, 1));
