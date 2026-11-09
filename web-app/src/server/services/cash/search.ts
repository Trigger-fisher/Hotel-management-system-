import "server-only";

// The list search of the cash screens. A port of Pallav's CashLedger::search (golden-tested against the real PHP function): words are
// split on spaces, "quoted phrases" stay together, a leading - leaves matching rows out, every word must match somewhere on the row in
// any order, commas inside numbers are dropped (24,000 = 24000), other punctuation is a space, and >5000, <500 and 500-2000 compare the
// amount. Plain text only: no word is ever a pattern.
interface SearchTest {
  not: boolean;
  body: string;
  amount: boolean;
}

interface ParsedSearch {
  tests: SearchTest[];
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Lower case, commas inside numbers dropped, punctuation to spaces (CashLedger::normalise). */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[^\p{L}\p{M}\p{N}.<>-]+/gu, " ")
    .trim();
}

const AMOUNT_TEST = /^(>|<)\s*(\d+(\.\d+)?)$|^(\d+(\.\d+)?)-(\d+(\.\d+)?)$/;

/** What was typed, cut to 120 characters and tidied (CashLedger::query), then split into tests. Null when there is nothing to test. */
export function parseSearch(raw: string): ParsedSearch | null {
  const q = Array.from(raw).slice(0, 120).join("").trim();
  if (q === "") return null;
  const tests: SearchTest[] = [];
  for (const token of q.match(/-?"[^"]+"|\S+/gu) ?? []) {
    const not = token.startsWith("-") && token.length > 1;
    const body = normalise((not ? token.slice(1) : token).replace(/^"+|"+$/g, ""));
    if (body === "") continue;
    tests.push({ not, body, amount: AMOUNT_TEST.test(body.replace(/,/g, "")) });
  }
  return tests.length === 0 ? null : { tests };
}

export interface SearchRow {
  entryNo: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS */
  time: string;
  /** The kind's own text columns, in the order Pallav lists them (CashLedger::search:138-140): depositor, withdrawer, expense name and head, reason, instruction. */
  depositor?: string | null;
  withdrawer?: string | null;
  expenseName?: string | null;
  expenseHead?: string | null;
  reason?: string | null;
  instruction?: string | null;
  /** The recorder's name when it was saved. */
  fullName: string | null;
  /** The recorder's name now (with " (deleted)" for a closed account). */
  recordedByName: string | null;
  amountInWords: string | null;
  amountPaise: bigint | number;
  /** The words a row shows that are not columns: the book's name and "deposit". */
  extra: readonly string[];
}

const pad4 = (n: number): string => String(n).padStart(4, "0");

/** number_format($amount, 2, '.', '') and number_format($amount, 2) from exact paise. */
function money(paise: bigint | number): { plain: string; grouped: string } {
  const p = typeof paise === "bigint" ? paise : BigInt(paise);
  const neg = p < BigInt(0);
  const abs = neg ? -p : p;
  const whole = (abs / BigInt(100)).toString();
  const cents = (abs % BigInt(100)).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return { plain: `${neg ? "-" : ""}${whole}.${cents}`, grouped: `${neg ? "-" : ""}${grouped}.${cents}` };
}

/** The date as Pallav formats it for search: d-m-Y d M Y l Y-m-d. */
function dateText(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dd}-${mm}-${y} ${dd} ${MONTHS[m - 1]} ${y} ${day} ${y}-${mm}-${dd}`;
}

function rowText(row: SearchRow): string {
  const m = money(row.amountPaise);
  const parts: (string | null | undefined)[] = [`#${pad4(row.entryNo)}`, pad4(row.entryNo), dateText(row.date), row.time.slice(0, 5), row.depositor, row.withdrawer, row.expenseName, row.expenseHead, row.reason, row.instruction, row.fullName, row.recordedByName, row.amountInWords, m.plain, m.grouped, ...row.extra];
  return normalise(parts.filter((v): v is string => v !== null && v !== undefined && v !== "").join(" "));
}

function amountMatches(rawBody: string, rupees: number): boolean {
  const body = rawBody.replace(/,/g, "");
  let m = /^>\s*(.+)$/.exec(body);
  if (m) return rupees > parseFloat(m[1]);
  m = /^<\s*(.+)$/.exec(body);
  if (m) return rupees < parseFloat(m[1]);
  const [low, high] = body.split("-", 2).map((v) => parseFloat(v));
  return rupees >= Math.min(low, high) && rupees <= Math.max(low, high);
}

export function matchesSearch(row: SearchRow, search: ParsedSearch | null): boolean {
  if (!search) return true;
  const text = rowText(row);
  const rupees = Number(row.amountPaise) / 100;
  for (const test of search.tests) {
    const hit = test.amount ? amountMatches(test.body, rupees) : text.includes(test.body);
    if (hit === test.not) return false;
  }
  return true;
}
