// Finds the English texts of the screens (JSX text, placeholder/title/aria-label/alt/label values, string choices inside a JSX expression) and,
// with --write, wraps each one in tr('...') so the language switch reaches it. Without --write it only lists. Texts are written to <out>.json (one list of
// the English texts) for the phrase books.
//   node scripts/i18n-wrap.mjs <folder-or-file> [more...] [--write] [--out texts.json]
// A text that sits in a sentence with a value around it ("Hello {name}, welcome") is left alone and listed as "skipped": one half of a sentence
// cannot be translated on its own. Those are done by hand with trf('Hello {0}, welcome', [name]).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const args = process.argv.slice(2);
const write = args.includes('--write');
// --halves also wraps the texts that sit beside a value ("of", "left", "ago"): right for the endings Hindi and Gujarati put after a value, to be checked by eye otherwise
const halves = args.includes('--halves');
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const targets = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const ENTITIES = { '&amp;': '&', '&nbsp;': ' ', '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&mdash;': '—', '&ndash;': '–', '&middot;': '·', '&hellip;': '…' };

function files(p, acc = []) {
  const st = fs.statSync(p);
  if (st.isFile()) return /\.tsx$/.test(p) ? [...acc, p] : acc;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) acc = files(path.join(p, e.name), acc);
  return acc;
}

const hasWords = (t) => /[A-Za-z]{2}/.test(t);
const decode = (t) => t.replace(/&#?\w+;/g, (m) => ENTITIES[m] ?? m);
const bad = (t) => /&#?\w+;/.test(decode(t));

const all = new Set();
const skipped = [];
let changed = 0;

for (const target of targets) {
  for (const f of files(target)) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/^\s*['"]use client['"]/.test(src)) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const edits = []; // { start, end, text }
    const texts = [];

    const wrapLiteral = (node) => {
      const t = node.text;
      if (!hasWords(t)) return;
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tr(${JSON.stringify(t)})` });
      texts.push(t);
    };

    const inJsxExpression = (node) => {
      // {cond ? 'A' : 'B'}, {'text'}, {a || 'text'}: the string choices shown on the screen
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return wrapLiteral(node);
      if (ts.isConditionalExpression(node)) {
        inJsxExpression(node.whenTrue);
        inJsxExpression(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) inJsxExpression(node.expression);
      else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) inJsxExpression(node.right);
    };

    (function visit(node) {
      if (ts.isJsxText(node)) {
        const raw = node.text;
        const body = raw.replace(/\s+/g, ' ').trim();
        if (hasWords(body)) {
          if (bad(body)) skipped.push(`${f}: entity ${body}`);
          else {
            const sibs = node.parent.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces));
            const i = sibs.indexOf(node);
            const prev = sibs[i - 1];
            const next = sibs[i + 1];
            const afterValue = prev && ts.isJsxExpression(prev);
            const beforeValue = next && ts.isJsxExpression(next);
            const text = decode(body);
            // half a sentence around a value: lower-case or punctuation continuing after it, or a sentence that runs on into it
            const halfAfter = afterValue && /^[a-z,.;:)!?%\-]/.test(text);
            const halfBefore = beforeValue && /^[a-z]/.test(text) && !/[:.?!–\-]$/.test(text);
            const midSentence = afterValue && beforeValue && text.split(' ').length >= 2 && !/[:]$/.test(text);
            if (!halves && (halfAfter || halfBefore || midSentence)) skipped.push(`${f}: ${body}`);
            else {
              const lead = /^\s*/.exec(raw)[0];
              const tail = /\s*$/.exec(raw)[0];
              edits.push({ start: node.getStart(sf, true) === node.pos ? node.pos : node.pos, end: node.end, text: `${lead}{tr(${JSON.stringify(text)})}${tail}` });
              texts.push(text);
            }
          }
        }
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && ATTRS.has(node.name.getText(sf))) {
        const t = node.initializer.text;
        if (hasWords(t) && !/\{|\}/.test(t)) {
          edits.push({ start: node.initializer.getStart(sf), end: node.initializer.getEnd(), text: `{tr(${JSON.stringify(t)})}` });
          texts.push(t);
        }
      } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
        inJsxExpression(node.expression);
      }
      ts.forEachChild(node, visit);
    })(sf);

    // a literal inside a conditional may sit inside text already edited: keep only edits that do not overlap
    edits.sort((a, b) => a.start - b.start);
    const kept = [];
    for (const e of edits) if (!kept.length || e.start >= kept[kept.length - 1].end) kept.push(e);
    texts.forEach((t) => all.add(t));
    if (!kept.length) continue;
    changed++;
    if (!write) continue;
    let next = src;
    for (const e of kept.slice().reverse()) next = next.slice(0, e.start) + e.text + next.slice(e.end);
    if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from '@\/lib\/i18n\/language'/.test(next)) {
      const m = /import \{([^}]*)\} from '@\/lib\/i18n\/language';/.exec(next);
      if (m) next = next.replace(m[0], `import {${m[1].replace(/\s+$/, '')}, tr } from '@/lib/i18n/language';`);
      else {
        // after the last import statement of the file
        const imports = [...next.matchAll(/^import[\s\S]*?;\s*$/gm)];
        const last = imports[imports.length - 1];
        const at = last ? last.index + last[0].length : 0;
        next = next.slice(0, at) + `\nimport { tr } from '@/lib/i18n/language';` + next.slice(at);
      }
    }
    fs.writeFileSync(f, next, { encoding: 'utf8' });
  }
}

console.log(`${write ? 'wrapped' : 'found'} ${all.size} texts in ${changed} files; ${skipped.length} left for hand work`);
if (out) fs.writeFileSync(out, JSON.stringify({ texts: [...all].sort(), skipped }, null, 1), 'utf8');
