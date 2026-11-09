// Evidence for the official module audit (docs/sessions/audits/AUDIT-CHECKLIST.md): one line per module with what is on disk.
// It does NOT score anything: "done / partial" stays a human call, made from this evidence and the live-test records.
// Usage (from web-app/):  node scripts/audit-modules.mjs [--md]      --md prints a markdown table to paste under "The table (current)"
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const repo = join(root, '..');
const md = process.argv.includes('--md');

// One row per module of the audit table. migrations: file prefixes in db/migrations; routes: folders under src/app/api/v1;
// adapter: file in src/lib/api/adapters; screens: folders under src/dashboards/groups; live: words that a wiring doc line must hold
// next to "live" to count as a recorded live test; tests: words in tests/server file names.
const MODULES = [
  { name: 'Billing: bills and guest advances', migrations: ['hotel/0004'], routes: ['billing'], adapter: 'billing.ts', screens: ['billing'], live: ['billing', 'bills', 'advances'], tests: ['billing'] },
  { name: 'Front Office (reservations, rooms, stays)', migrations: ['hotel/0006', 'hotel/0023'], routes: ['front-office'], adapter: 'frontOffice.ts', screens: ['frontOffice'], live: ['front office', 'frontoffice'], tests: ['frontOffice'] },
  { name: 'Cash: revenue, expenses, handover', migrations: ['hotel/0003'], routes: ['cash', 'revenue', 'expense', 'handover'], adapter: 'cash.ts', screens: ['cash'], live: ['cash', 'revenue', 'expense', 'handover'], tests: ['cash', 'revenue', 'expense', 'handover'] },
  { name: 'Companies, CRM, ledger', migrations: ['hotel/0002'], routes: ['companies'], adapter: 'companies.ts', screens: ['companies'], live: ['compan', 'crm'], tests: ['companies'] },
  { name: 'Payroll core', migrations: ['hotel/0007'], routes: ['payroll'], adapter: 'payrollCore.ts', screens: ['payrollCore'], live: ['payroll core', 'attendance', 'staff'], tests: ['payrollCore'] },
  { name: 'Payroll pay', migrations: ['hotel/0008', 'hotel/0015', 'hotel/0016'], routes: ['payroll'], adapter: 'payrollPay.ts', screens: ['payrollPay'], live: ['payroll pay', 'payments', 'slips'], tests: ['payrollPay', 'payrollMeals'] },
  { name: 'Reports and dashboard, search', migrations: [], routes: ['reports', 'overview', 'search'], adapter: 'overview.ts', screens: ['overview'], live: ['report', 'dashboard', 'search'], tests: ['reports', 'overview', 'search'] },
  { name: 'Admin (masters, settings, users, roles, books, recycle, health, log)', migrations: ['hotel/0001', 'hotel/0019', 'platform/0101'], routes: ['admin', 'system', 'profile'], adapter: 'admin.ts', screens: ['admin'], live: ['admin', 'system', 'users', 'roles', 'books'], tests: ['admin', 'systemAdmin'] },
  { name: 'Website', migrations: ['hotel/0005', 'hotel/0018'], routes: ['website'], adapter: 'website.ts', screens: ['website'], live: ['website'], tests: ['website'] },
  { name: 'Guest portal and room-service menu', migrations: ['hotel/0020'], routes: ['guest'], adapter: 'guest.ts', screens: ['guest', 'portal'], live: ['guest', 'portal'], tests: ['portal.guest', 'guest'] },
  { name: 'Corporate portal', migrations: [], routes: ['corporate'], adapter: 'corporate.ts', screens: ['corporate'], live: ['corporate'], tests: ['corporate'] },
  { name: 'Sign-in and auth', migrations: ['platform/0003', 'platform/0004', 'platform/0111', 'platform/0113'], routes: ['auth'], adapter: null, screens: [], live: ['sign-in', 'auth', 'login'], tests: ['auth'] },
  { name: 'Platform and Super Admin consoles', migrations: ['platform/0102', 'platform/0103', 'platform/0104', 'platform/0105', 'platform/0106', 'platform/0107', 'platform/0108'], routes: ['platform'], adapter: 'platformConsole.ts', screens: ['platform'], live: ['platform', 'super admin'], tests: ['platform'] },
  { name: 'Group Hotel Admin console', migrations: ['platform/0103'], routes: ['group'], adapter: 'group.ts', screens: ['group'], live: ['group'], tests: ['group'] },
  { name: 'Set up your hotel', migrations: ['platform/0110'], routes: ['onboarding'], adapter: null, screens: ['platform'], live: ['set up your hotel', 'hotel_setup'], tests: ['onboarding'] },
];

const files = (dir, test) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p, test));
    else if (!test || test(p)) out.push(p);
  }
  return out;
};
const read = (p) => readFileSync(p, 'utf8');

const migrationDir = join(repo, 'common/db/migrations');
const sqlFiles = files(migrationDir, (p) => p.endsWith('.sql')).map((p) => relative(migrationDir, p).replace(/\\/g, '/'));
const docs = files(join(repo, 'common/docs'), (p) => /WIRING|LIVE/i.test(p) && p.endsWith('.md')).map((p) => ({ name: relative(repo, p).replace(/\\/g, '/'), lines: read(p).split(/\r?\n/) }));
const testFiles = files(join(root, 'tests'), (p) => p.endsWith('.test.ts')).map((p) => relative(join(root, 'tests'), p).replace(/\\/g, '/'));

const rows = MODULES.map((m) => {
  const tables = sqlFiles.filter((f) => m.migrations.some((x) => f.startsWith(x))).reduce((n, f) => n + (read(join(migrationDir, f)).match(/create table/gi) ?? []).length, 0);
  const routeFiles = m.routes.reduce((n, r) => n + files(join(root, 'src/app/api/v1', r), (p) => /route\.ts$/.test(p)).length, 0);
  const adapterPath = m.adapter ? join(root, 'src/lib/api/adapters', m.adapter) : null;
  const adapterText = adapterPath && existsSync(adapterPath) ? read(adapterPath) : null;
  const notYet = adapterText ? (adapterText.match(/notYet\(/g) ?? []).length : null;
  const screens = m.screens.reduce((n, s) => n + files(join(root, 'src/dashboards/groups', s), (p) => /\.tsx$/.test(p)).length, 0);
  const tests = testFiles.filter((f) => m.tests.some((t) => f.includes(t))).length;
  const live = docs.flatMap((d) => d.lines.filter((l) => /\blive\b/i.test(l) && m.live.some((w) => l.toLowerCase().includes(w))).map((l) => `${d.name}: ${l.trim().slice(0, 90)}`));
  return { name: m.name, tables, routeFiles, adapter: m.adapter ? (adapterText ? 'yes' : 'MISSING') : '-', notYet, screens, tests, live };
});

if (md) {
  console.log('| Module | Tables | Route files | Adapter (notYet calls) | Screen files | Server test files | Live-test lines in wiring docs |\n|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${r.tables} | ${r.routeFiles} | ${r.adapter}${r.notYet ? ` (${r.notYet})` : ''} | ${r.screens} | ${r.tests} | ${r.live.length} |`);
} else {
  for (const r of rows) {
    console.log(`\n${r.name}\n  tables ${r.tables} | route files ${r.routeFiles} | adapter ${r.adapter}${r.notYet ? ` (notYet ${r.notYet})` : ''} | screen files ${r.screens} | server test files ${r.tests}`);
    console.log(r.live.length ? r.live.slice(0, 4).map((l) => `  live: ${l}`).join('\n') : '  live: NO line in the wiring docs mentions a live test');
  }
}

// Layer percentage helper for the human scoring: (done + 0.5 x partial) / modules scored. Paste your scores to see the mean.
//   node scripts/audit-modules.mjs --score "96,96,98,79"   -> mean of the four layer percentages
const s = process.argv.find((a, i) => process.argv[i - 1] === '--score');
if (s) { const v = s.split(',').map(Number); console.log(`\nProject mean: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`); }
