// The English texts a person can SEE in the staff and portal screens that are not asked for with tr(): JSX text, the text attributes, and the strings of the shared copy
// objects (common/ui-shared/dashboards/*.ts), with a text built from values written as a pattern ("{0} of {1} rooms in service"). The screen translator
// (src/lib/i18n/screenTranslator.ts) turns these into the chosen language IF the phrase books hold them; tests/server/i18n.coverage.test.ts fails when one is missing.
// Used by that test and by whoever extends the books: `npx tsx --import ./src/server/lib/node-hooks/register.ts scripts/visibleTexts.ts` prints the missing ones.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");

export interface VisibleText {
  kind: "jsx" | "attr" | "copy";
  text: string;
  files: string[];
}

const walkFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "mocks"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|lang|mock|fixtures?)\./.test(name) && !/(phrases|\.d\.ts)/.test(p)) out.push(p);
  }
  return out;
};

const ENTITIES: Record<string, string> = { rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", apos: "'", quot: '"', amp: "&", nbsp: " ", rarr: "\u2192", larr: "\u2190", rsaquo: "\u203a", lsaquo: "\u2039", middot: "\u00b7", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", bull: "\u2022", times: "\u00d7", copy: "\u00a9" };
/** The text as the page shows it: character references written in the source (&rsquo;) become the character (what the browser holds in the text node). */
export const decodeEntities = (s: string): string => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, name: string) => (name[0] === "#" ? String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? all)));

const hasWords = (s: string): boolean => /[A-Za-z]{2,}/.test(s) && /[a-z]/.test(s);
const TEXT_ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label", "aria-description"]);
const ASKED_WITH = new Set(["tr", "trf", "tn", "trn", "phrase", "phraseWith", "useCopy", "pickCopy"]);
/** A property whose value is a name or a code, not words a person reads. */
const CODE_NAMES = /^(id|key|icon|tone|href|route|view|to|kind|type|status|class|className|color|colour|name|slug|code|path|field|api|method|url|permission|ability|group|section|module|part|level|scope|mode|channel|provider|event|action|entity|source|format|font|variant|size|align|role|lang|language|currency|unit|token|selector|query|header|env|prefix|suffix|pattern|regex|mime|accept|target|rel|format|locale)$/;

/** Props that hold a name, a style or a code, never words a person reads. */
const CODE_ATTRS = /^(className|class|id|key|ref|type|name|href|src|to|htmlFor|for|role|style|lang|target|rel|icon|variant|tone|size|color|colour|value|defaultValue|kind|view|step|min|max|pattern|autoComplete|inputMode|method|action|accept|as|mode|level|scope|status|tab|theme|align|side|anchor|placement|position|width|height|viewBox|d|fill|stroke|xmlns|loading|decoding|sizes|srcSet|media|tabIndex|dir|translate|slot|form|list|locale|currency|format|unit|field|path|route|permission|ability|group|section|module|channel|provider|event|entity|source|font|selector|query|token|code|slug|prefix|suffix|accessKey|autoCapitalize|enterKeyHint|crossOrigin|referrerPolicy|sandbox|allow|nonce|integrity|charSet|httpEquiv|content|property|itemProp|is|dateTime)$/;

/** A JSX string that sits inside an expression container ({...}), not in an attribute value or a plain attribute. */
function inJsxExpression(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isJsxExpression(p)) return !(p.parent && ts.isJsxAttribute(p.parent) && CODE_ATTRS.test(p.parent.name.getText()));
    if (ts.isJsxAttribute(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** A string that reads like a text for people: words with a space, or a capitalised word; not an id, a path, a url or a CONSTANT. */
function looksLikeText(t: string): boolean {
  if (!hasWords(t) || t.length < 2 || t.length > 400) return false;
  if (/^[a-z][a-z0-9_.:-]*$/.test(t)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(t)) return false;
  if (/^[#./@]|^https?:|^\d|^[a-z]+:[a-z]|\.(png|jpg|svg|webp|css|js|json)$/i.test(t)) return false;
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(t)) return false;
  return /\s/.test(t) || /^[A-Z][a-z]+/.test(t);
}

/** A template with values as a pattern: `${a} of ${b} rooms` -> "{0} of {1} rooms". null when it has no words of its own. */
function patternOf(n: ts.TemplateExpression): string | null {
  let i = 0;
  const text = n.head.text + n.templateSpans.map((s) => `{${i++}}${s.literal.text}`).join("");
  return hasWords(text.replace(/\{\d+\}/g, " ")) ? text : null;
}

function insideAsked(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ASKED_WITH.has(p.expression.text)) return true;
  return false;
}
function inTypeOrImport(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (ts.isTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
  return false;
}

export function scanVisibleTexts(): VisibleText[] {
  const found = new Map<string, Set<string>>();
  const add = (kind: VisibleText["kind"], text: string, file: string): void => {
    const t = decodeEntities(text).replace(/\s+/g, " ").trim();
    if (!hasWords(t.replace(/\{\d+\}/g, " ")) || t.length > 400 || t.includes("{{")) return;
    const key = `${kind}|${t}`;
    if (!found.has(key)) found.set(key, new Set());
    found.get(key)!.add(relative(REPO, file).replace(/\\/g, "/"));
  };
  const roots = [join(REPO, "web-app/src/dashboards"), join(REPO, "web-app/src/components"), join(REPO, "common/ui-shared/dashboards")];
  for (const root of roots) {
    for (const file of walkFiles(root)) {
      const code = readFileSync(file, "utf8");
      // a file that holds its own translations (copyByLanguage) shows them itself; format.ts holds the month and weekday names the date formatter translates
      if (code.includes("copyByLanguage(") || /[\\/]format\.ts$/.test(file)) continue;
      const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const shared = file.includes("common/ui-shared");
      const visit = (n: ts.Node, inCopy: boolean): void => {
        if (ts.isJsxText(n)) add("jsx", n.getText(), file);
        else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && (TEXT_ATTRS.has(n.name.getText()) || (!CODE_ATTRS.test(n.name.getText()) && !/^(data|aria)-/.test(n.name.getText()) && looksLikeText(n.initializer.text)))) add("attr", n.initializer.text, file);
        // a string in a JSX expression of a screen: {ok ? 'Saved' : 'Saving…'}, {label || 'None'}
        else if (!shared && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !insideAsked(n) && !inTypeOrImport(n) && n.parent && ts.isJsxExpression(n.parent) === false && inJsxExpression(n) && looksLikeText(n.text) && /\s/.test(n.text)) add("jsx", n.text, file);
        else if (shared && !inTypeOrImport(n) && !insideAsked(n)) {
          // the values of an object's properties and of what its functions return are the texts of a copy object
          if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) inCopy = true;
          const name = n.parent && ts.isPropertyAssignment(n.parent) && n.parent.initializer === n ? n.parent.name.getText() : "";
          if (inCopy && !ts.isPropertyAssignment(n) && !(ts.isCaseClause(n.parent) || (ts.isBinaryExpression(n.parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.parent.operatorToken.kind)))) {
            if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !(name && CODE_NAMES.test(name) && !/\s/.test(n.text)) && looksLikeText(n.text)) add("copy", n.text, file);
            else if (ts.isTemplateExpression(n)) {
              const pat = patternOf(n);
              if (pat && looksLikeText(pat.replace(/\{\d+\}/g, "x"))) add("copy", pat, file);
            }
          }
        }
        ts.forEachChild(n, (c) => visit(c, inCopy));
      };
      visit(src, false);
    }
  }
  return [...found.entries()].map(([k, files]) => ({ kind: k.split("|")[0] as VisibleText["kind"], text: k.slice(k.indexOf("|") + 1), files: [...files] }));
}
