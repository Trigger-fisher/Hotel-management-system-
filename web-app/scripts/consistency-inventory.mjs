// Consistency inventory of every dashboard screen (docs/plans/PRODUCT-IMPROVEMENT-PLAN-2026-10-13.md, section 2): which screens use the kit's page head
// with a sentence, the shared tiles, the shared empty state, the one list search, the server pager, the loading parts; which still write their own.
// Reads the code only. usage: node scripts/consistency-inventory.mjs [--md] (markdown table; plain counts otherwise)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'src', 'dashboards', 'groups');
const md = process.argv.includes('--md');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(name) && !/\.test\.|parts\.tsx$|Kit\.tsx$|shared\.tsx$|index\.tsx$/.test(name)) files.push(p);
  }
})(root);

// a screen file: it is named in a group index's `screens` map
const screenFiles = new Set();
for (const group of readdirSync(root)) {
  const idx = ['index.ts', 'index.tsx'].map((n) => path.join(root, group, n)).find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  if (!idx) continue;
  const text = readFileSync(idx, 'utf8');
  for (const m of text.matchAll(/import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const file = path.resolve(path.dirname(idx), m[3]);
    for (const cand of [file + '.tsx', path.join(file, 'index.tsx')]) { try { if (statSync(cand).isFile()) screenFiles.add(cand); } catch {} }
  }
}

const checks = {
  pageHead: (t) => /<PageHead\b/.test(t),
  rawHead: (t) => /className=["'`][^"'`]*\bpage-head\b/.test(t),
  sentence: (t) => /<PageHead\b[^>]*\bsub=|className=["']pms-sub["']/.test(t),
  kpi: (t) => /<Kpi\b|<KpiGrid\b/.test(t),
  rawTiles: (t) => /className=["'`][^"'`]*\b(kpi-grid|kpi|stat-card|pt-stat)\b/.test(t) && !/<Kpi\b/.test(t),
  emptyState: (t) => /<EmptyState\b|<PtEmpty\b/.test(t),
  listSearch: (t) => /<ListSearch\b|<CashSearch\b/.test(t),
  otherSearch: (t) => /<SearchField\b|<SearchBox\b/.test(t),
  pagerServer: (t) => /<Pager\b[^>]*\bserver\b/.test(t),
  pagerClient: (t) => /<Pager\b/.test(t) && !/<Pager\b[^>]*\bserver\b/.test(t),
  loading: (t) => /<PageSkeleton\b|<Skeleton\b|<Loaded\b|<LoadError\b/.test(t),
  rawButton: (t) => /<button\b/.test(t),
  rawTable: (t) => /<table\b/.test(t),
  hex: (t) => /#[0-9a-fA-F]{6}\b/.test(t.replace(/\/\/.*$/gm, '').replace(/check-shared-ignore/g, '')),
};
const rows = [];
for (const f of [...screenFiles].sort()) {
  const t = readFileSync(f, 'utf8');
  const r = Object.fromEntries(Object.entries(checks).map(([k, fn]) => [k, fn(t)]));
  rows.push({ file: path.relative(root, f), lines: t.split('\n').length, ...r });
}
const Y = (b) => (b ? 'yes' : '');
if (md) {
  console.log('| Screen file | lines | PageHead | raw head | sentence | Kpi | raw tiles | EmptyState | ListSearch | other search | Pager server | Pager client | loading parts | raw <button> | raw <table> | hex |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.file} | ${r.lines} | ${Y(r.pageHead)} | ${Y(r.rawHead)} | ${Y(r.sentence)} | ${Y(r.kpi)} | ${Y(r.rawTiles)} | ${Y(r.emptyState)} | ${Y(r.listSearch)} | ${Y(r.otherSearch)} | ${Y(r.pagerServer)} | ${Y(r.pagerClient)} | ${Y(r.loading)} | ${Y(r.rawButton)} | ${Y(r.rawTable)} | ${Y(r.hex)} |`);
}
const count = (k) => rows.filter((r) => r[k]).length;
console.log(`\n${rows.length} screens. PageHead ${count('pageHead')}, raw head ${count('rawHead')}, with a sentence ${count('sentence')}, Kpi ${count('kpi')}, raw tiles ${count('rawTiles')}, EmptyState ${count('emptyState')}, ListSearch ${count('listSearch')}, other search ${count('otherSearch')}, Pager server ${count('pagerServer')}, Pager client ${count('pagerClient')}, loading parts ${count('loading')}, raw <button> ${count('rawButton')}, raw <table> ${count('rawTable')}, hex ${count('hex')}`);
