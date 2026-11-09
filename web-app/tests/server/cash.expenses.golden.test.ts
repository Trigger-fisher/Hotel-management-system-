// Golden tests for the expense slice: expected values made by REAL PHP (db/scripts/php/generate-cash-fixtures.php -> fixtures/cash-revenue.json):
// the line arithmetic copied verbatim from ExpenseController::resolveLines, the summary from ::summary, and Pallav's own CashLedger::search run over
// withdrawal and miscellaneous rows with the extra words of ExpenseController::index.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { toPaise } from "../../src/server/money/paise";
import { priceLine, roundQuantity, summarize } from "../../src/server/services/cash/expenseLines";
import { matchesSearch, parseSearch, type SearchRow } from "../../src/server/services/cash/search";

interface LineCase {
  pricing: "listed" | "custom";
  quantity: string;
  pricePaise?: number;
  amountPaise?: number;
  outQuantityMilli: number;
  outPricePaise: number;
  outTotalPaise: number;
}
interface Fixture {
  lineMath: LineCase[];
  summaries: { lines: { item: string; category: string }[]; summary: { expense_name: string; expense_head: string } }[];
  expenseRows: { entry_no: number; book: "hotel" | "food"; kind: "withdrawal" | "misc"; date: string; time: string; withdrawer?: string; expense_name?: string; expense_head?: string; instruction: string | null; full_name: string; user: string; amount: number; amount_in_words: string; lines: [string, string][] }[];
  expenseSearches: { q: string; entries: string[] }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "cash-revenue.json"), "utf8")) as Fixture;

describe("expense line arithmetic (ExpenseController::resolveLines, real PHP)", () => {
  test(`all ${fx.lineMath.length} cases: quantity rounded to 3 places, listed price x quantity, custom price = total / quantity`, () => {
    // Pallav's round() of a float: PHP 8.3 rounds an exact decimal tie UP (pre-rounding, what production runs and what HMS does); PHP 8.4, which made
    // these fixtures, rounds the float below the tie DOWN. A difference is accepted ONLY on an exact tie where HMS rounded half away from zero.
    const tieUp = (c: LineCase, got: number[]): boolean => {
      if (c.pricing !== "listed" || c.pricePaise === undefined) return false;
      const product = BigInt(got[0]) * BigInt(c.pricePaise); // quantity in thousandths x price in paise
      return product % BigInt(1000) === BigInt(500) && BigInt(got[2]) === product / BigInt(1000) + BigInt(1) && BigInt(c.outTotalPaise) === product / BigInt(1000);
    };
    const misses: string[] = [];
    let ties = 0;
    for (const c of fx.lineMath) {
      const priced = priceLine({ quantity: c.quantity, pricing: c.pricing, listedPrice: toPaise(c.pricePaise ?? 0), amountPaise: c.amountPaise === undefined ? null : toPaise(c.amountPaise) });
      const got = [Math.round(Number(priced.quantity) * 1000), Number(priced.pricePaise), Number(priced.totalPaise)];
      const want = [c.outQuantityMilli, c.outPricePaise, c.outTotalPaise];
      if (got.join() !== want.join() && tieUp(c, got) && got[0] === want[0] && got[1] === want[1]) ties += 1;
      else if (got.join() !== want.join()) misses.push(`${c.pricing} q=${c.quantity} price=${c.pricePaise ?? "-"} amount=${c.amountPaise ?? "-"}: got ${got.join("/")} want ${want.join("/")}`);
    }
    assert.deepEqual(misses, []);
    assert.ok(ties <= 10, `only the rare PHP 8.4 ties are tolerated (${ties})`);
  });
  test("the fixture covers both pricings, fractions, ties and the extremes", () => {
    assert.ok(fx.lineMath.some((c) => c.pricing === "custom") && fx.lineMath.some((c) => c.pricing === "listed"));
    for (const q of ["0.001", "0.0005", "1.0005", "999999.999", "1000000", "2.675"]) assert.ok(fx.lineMath.some((c) => c.quantity === q), q);
  });
  test("roundQuantity: half away from zero at three places", () => {
    for (const [text, want] of [["1", "1.000"], ["2.5", "2.500"], ["0.0005", "0.001"], ["0.0004", "0.000"], ["1.2345", "1.235"], ["1.0005", "1.001"], ["  7 ", "7.000"], ["1e2", "100.000"], [".5", "0.500"], ["1.", "1.000"]] as const) {
      assert.equal(roundQuantity(text), want, text);
    }
  });
  test("a custom line with a zero quantity has price 0 (Pallav :367)", () => {
    assert.equal(priceLine({ quantity: "0.0004", pricing: "custom", listedPrice: toPaise(0), amountPaise: toPaise(500) }).pricePaise, BigInt(0));
  });
});

describe("the short names built from the lines (ExpenseController::summary, real PHP)", () => {
  test(`all ${fx.summaries.length} cases, including multibyte and the 100 and 60 character cuts`, () => {
    for (const { lines, summary } of fx.summaries) {
      assert.deepEqual(summarize(lines), { expenseName: summary.expense_name, expenseHead: summary.expense_head });
    }
  });
});

describe("the list search over withdrawals and miscellaneous expenses (CashLedger::search, real PHP)", () => {
  const BOOK = { hotel: "Hotel Pallav", food: "Pallav Food" };
  const KIND = { withdrawal: "Cash Withdrawal", misc: "Miscellaneous Expense" };
  const rows = fx.expenseRows.map((r): SearchRow & { key: string } => ({
    key: `${r.book}:${r.entry_no}`,
    entryNo: r.entry_no,
    date: r.date,
    time: r.time,
    withdrawer: r.withdrawer ?? null,
    expenseName: r.expense_name ?? null,
    expenseHead: r.expense_head ?? null,
    instruction: r.instruction,
    fullName: r.full_name,
    recordedByName: r.user,
    amountInWords: r.amount_in_words,
    amountPaise: Math.round(r.amount * 100),
    extra: [BOOK[r.book], KIND[r.kind], ...r.lines.flat()],
  }));
  test(`the ${fx.expenseSearches.length} queries each pick the same entries as PHP`, () => {
    for (const { q, entries } of fx.expenseSearches) {
      const found = rows.filter((r) => matchesSearch(r, parseSearch(q))).map((r) => r.key);
      assert.deepEqual(found, entries, `search ${JSON.stringify(q)}`);
    }
  });
});
