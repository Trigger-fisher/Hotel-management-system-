// check:shared: proves screens use the Shared Component set (web-app/src/dashboards/pallav/ui) and the design tokens.
// Plain Node, no library. Exit 1 and file:line for every violation under src/dashboards, src/components and src/app. Rules:
//   colour   hard-coded colours (hex, rgb/rgba/hsl, named) in TSX style props and in CSS outside the token / theme files
//   type     literal font-size / font-weight / font-family / line-height outside the type tokens
//   control  raw styled controls (button, input, select, table with page-local classes) where a Shared Component exists\n//   control-bespoke  the raw tab, remove/clear and add/reset buttons that SegTabs / IconButton / Button replace (debt, counted in the total)
//   inline   inline style objects that tokens or classes already cover (fontSize, color, background, borderRadius, boxShadow, padding)
//   import   reusable pieces imported from anywhere but the kit index
// A line (or the line above it) holding  check-shared-ignore: <reason>  is skipped (use for a data colour that comes from user data).
// Allowlist: scripts/check-shared.allow.json = [{ "file": "src/..", "rule": "colour", "reason": "short", "line": optional }]
// Usage: node scripts/check-shared.mjs [--summary] [--rule=colour]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(import.meta.dirname, '..');
const roots = ['src/dashboards', 'src/components', 'src/app'];
const summaryOnly = process.argv.includes('--summary');
const onlyRule = process.argv.find((a) => a.startsWith('--rule='))?.slice(7);

// Where colours and type are DEFINED: allowed to hold literals.
const tokenFiles = [/^src\/lib\/theme/, /^src\/app\/globals\.css$/, /^src\/dashboards\/pallav\/tokens/, /^src\/dashboards\/pallav\/ui\//, /^src\/components\/ui\/dashTheme\.ts$/, /^src\/app\/dev\/shared-component\//];
const allow = existsSync(join(root, 'scripts/check-shared.allow.json')) ? JSON.parse(readFileSync(join(root, 'scripts/check-shared.allow.json'), 'utf8').replace(/^\uFEFF/, '')) : [];
const allowed = (file, rule, line) => allow.some((a) => a.file === file && a.rule === rule && (a.line === undefined || a.line === line));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts|css)$/.test(name)) yield p;
  }
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\b(?:rgba?|hsla?)\(/;
const NAMED = /:\s*['"]?(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|teal|navy)['"]?\s*[;,}]/;
const TYPE_CSS = /\b(font-size|font-weight|font-family|line-height):(?!\s*(?:var\(|inherit|unset|initial))/;
const TYPE_TSX = /\b(fontSize|fontWeight|fontFamily|lineHeight)\s*:\s*(?!['"]?var\()/;
const INLINE = /\bstyle=\{\{[^}]*\b(fontSize|color|background|backgroundColor|borderRadius|boxShadow|padding|margin)\b/;
// Raw controls: any button, select, textarea or table whose className is page-local (not pt-, pms-, btn-, ui-) where a kit piece exists.
// The ones a kit piece replaces are counted as "control-bespoke" (tab and segment buttons -> SegTabs, remove and clear buttons -> IconButton,
// add and reset buttons -> Button); raw tables and every other raw control are "control". A widget with no kit equivalent (coin tiles, calendar
// cells, the shell's own buttons) carries a  check-shared-ignore: <reason>  comment; the allowlist is not used for these.
const CONTROL = /<(button|select|textarea|table)\b(?![^>]*\bclassName=\{?['"`][^'"`]*\b(?:pt-|pms-|btn-|ui-)[^'"`]*['"`])[^>]*\bclassName=/;
const BESPOKE = /role="tab"|\b(?:bm-tab|fb-pill)\b|(?:remove|clear)[\w-]*['"` ]|\bco-add-more\b|\bbm-reset\b/;
const KIT_NAMES = ['Button', 'Field', 'Select', 'DateField', 'Table', 'Badge', 'Tile', 'Tabs', 'Pager', 'Modal', 'Alert', 'EmptyState', 'Skeleton', 'PageHeader', 'Footer'];
const IMPORT_KIT_FILE = new RegExp(`import[^;]*\\b(${KIT_NAMES.join('|')})\\b[^;]*from\\s+['"](?:@/dashboards/pallav/ui/(?!index)|\\.{1,2}/(?:[\\w./]*/)?pallav/ui/(?!index))`);

const found = [];
const add = (file, line, rule, text, prev = '') => { if (!/check-shared-ignore:\s*\S/.test(text + prev) && !allowed(file, rule, line) && (!onlyRule || onlyRule === rule)) found.push({ file, line, rule, text: text.trim().slice(0, 110) }); };

for (const base of roots) {
  const dir = join(root, base);
  if (!existsSync(dir)) continue;
  for (const abs of walk(dir)) {
    const file = relative(root, abs).split(sep).join('/');
    const isToken = tokenFiles.some((r) => r.test(file));
    const css = file.endsWith('.css');
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      const line = i + 1;
      const prev = lines[i - 1] ?? '';
      const code = text.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!code.trim() || /^\s*(\*|\/\*)/.test(text)) return;
      if (!isToken) {
        const styled = css || /style=|Style|: ['"`]/.test(code) || /^\s*[a-zA-Z]+:\s*['"]#/.test(code);
        if (styled && (HEX.test(code) || FUNC.test(code) || (css && NAMED.test(code)))) add(file, line, 'colour', text, prev);
        if (css ? TYPE_CSS.test(code) : /style=|Style/.test(code) && TYPE_TSX.test(code)) add(file, line, 'type', text, prev);
      }
      if (!css) {
        if (INLINE.test(code) && !isToken) add(file, line, 'inline', text, prev);
        if (!file.startsWith('src/dashboards/pallav/ui/') && CONTROL.test(code)) add(file, line, /^\s*<button\b/.test(code.trim()) || /<button\b/.test(code) ? (BESPOKE.test(code) ? 'control-bespoke' : 'control') : 'control', text, prev);
        if (IMPORT_KIT_FILE.test(code)) add(file, line, 'import', text, prev);
      }
    });
  }
}

const folderOf = (f) => f.split('/').slice(0, f.startsWith('src/dashboards/groups/') ? 4 : 3).join('/');
const table = {};
for (const v of found) { const k = folderOf(v.file); (table[k] ??= {})[v.rule] = (table[k][v.rule] ?? 0) + 1; }
if (!summaryOnly) for (const v of found) console.log(`${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
console.log('\ncheck:shared summary (violations per folder)');
for (const [k, r] of Object.entries(table).sort()) console.log(`  ${k.padEnd(46)} ${Object.entries(r).map(([a, b]) => `${a} ${b}`).join(', ')}`);
console.log(`total ${found.length}`);
process.exit(found.length ? 1 : 0);
