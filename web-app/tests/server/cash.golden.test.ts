// Golden tests for the Daily Cash revenue slice: every expected value was produced by REAL PHP running Pallav's own functions
// (db/scripts/php/generate-cash-fixtures.php -> fixtures/cash-revenue.json). Regenerate with:
//   php db/scripts/php/generate-cash-fixtures.php <pallav repo> > "web-app/tests/server/fixtures/cash-revenue.json"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { amountInWords } from "../../src/server/money/words";
import { istMoment, monthRange } from "../../src/server/services/cash/ist";
import { parseSearch, matchesSearch, type SearchRow } from "../../src/server/services/cash/search";
import { cashLedgerStamp } from "../../src/server/services/cash/stamp";

interface Fixture {
  words: { paise: number; words: string }[];
  entryNumbers: { n: number; text: string }[];
  searchRows: { entry_no: number; book: "hotel" | "food"; date: string; time: string; depositor: string; reason: string | null; full_name: string; user: string; amount: number; amount_in_words: string }[];
  searches: { q: string; entries: number[] }[];
  stamps: { nowIst: string; chosenByHand: boolean; editing: boolean; input: { date: string; time: string }; result: { date?: string; time?: string } }[];
  istRanges: { instant: string; today: string; monthStart: string; monthEnd: string }[];
  totals: { rupees: number[]; sum: string; paise: number }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "cash-revenue.json"), "utf8")) as Fixture;

describe("amount in words (NumberToWords::convert, real PHP)", () => {
  test(`all ${fx.words.length} fixture amounts match, Lakh and Crore included`, () => {
    for (const row of fx.words) assert.equal(amountInWords(row.paise), row.words, `${row.paise} paise`);
  });
  test("the fixture really covers the interesting ground", () => {
    const has = (re: RegExp): boolean => fx.words.some((w) => re.test(w.words));
    assert.ok(has(/Crore/) && has(/Lakh/) && has(/Thousand/) && has(/ Paise Only$/) && has(/^Zero Rupees Only$/) && has(/^One Rupee Only$/) && has(/^[\d.]+$/));
  });
  test("spot checks written by hand", () => {
    assert.equal(amountInWords(12345600), "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only");
    assert.equal(amountInWords(1250050), "Twelve Thousand Five Hundred Rupees and Fifty Paise Only");
    assert.equal(amountInWords(BigInt(100)), "One Rupee Only");
    assert.equal(amountInWords(0), "Zero Rupees Only");
  });
  test("outside zero to 100,000,000,000 paise the plain number comes back, as in PHP; a non-integer is refused", () => {
    assert.equal(amountInWords(100000000001), "1000000000.01");
    assert.equal(amountInWords(-150), "-1.5");
    assert.throws(() => amountInWords(1.5), RangeError);
  });
});

describe("entry numbers shown as four digits (str_pad)", () => {
  test("every fixture", () => {
    for (const { n, text } of fx.entryNumbers) assert.equal(String(n).padStart(4, "0"), text);
  });
});

describe("the list search (CashLedger::search, real PHP)", () => {
  const labels = { hotel: "Hotel Pallav", food: "Pallav Food" };
  const rows: (SearchRow & { entryNo: number })[] = fx.searchRows.map((r) => ({
    entryNo: r.entry_no,
    date: r.date,
    time: r.time,
    depositor: r.depositor,
    reason: r.reason,
    fullName: r.full_name,
    recordedByName: r.user,
    amountInWords: r.amount_in_words,
    amountPaise: Math.round(r.amount * 100),
    extra: [labels[r.book], "deposit"],
  }));
  test(`the ${fx.searches.length} queries each pick the same entries as PHP`, () => {
    for (const { q, entries } of fx.searches) {
      const found = rows.filter((r) => matchesSearch(r, parseSearch(q))).map((r) => r.entryNo);
      assert.deepEqual(found, entries, `search ${JSON.stringify(q)}`);
    }
  });
  test("the fixture includes empty, negated, quoted, amount and non-ASCII queries", () => {
    const qs = fx.searches.map((s) => s.q);
    for (const needle of ["", "-asha", '"walk-in guests"', ">5000", "500-2000", "ही"]) assert.ok(qs.includes(needle), needle);
  });
  test("a query is cut to 120 characters like Pallav, and an empty one matches everything", () => {
    assert.equal(parseSearch("   "), null);
    const long = parseSearch(`asha ${"x".repeat(200)}`);
    assert.ok(long && long.tests[1].body.length <= 120);
    assert.ok(rows.every((r) => matchesSearch(r, null)));
  });
});

describe("the date and time stamp (CashLedger::stamp, real PHP)", () => {
  test(`all ${fx.stamps.length} combinations of hand-picked, new/edit and time shapes`, () => {
    for (const c of fx.stamps) {
      const [date, time] = c.nowIst.split(" ");
      const result = cashLedgerStamp(c.input, c.chosenByHand, c.editing, { date, time });
      // PHP writes an empty array as [] in JSON
      assert.deepEqual(result, Array.isArray(c.result) ? {} : c.result, JSON.stringify(c));
    }
  });
});

describe("today and this month in IST (the boundaries)", () => {
  test("each instant lands on the IST date, and its month range, that PHP computes", () => {
    for (const c of fx.istRanges) {
      const moment = istMoment(new Date(c.instant));
      assert.equal(moment.date, c.today, c.instant);
      assert.deepEqual(monthRange(moment.date), { from: c.monthStart, to: c.monthEnd }, c.instant);
    }
  });
  test("one second before and after IST midnight", () => {
    assert.equal(istMoment(new Date("2026-10-05T18:29:59Z")).date, "2026-10-05");
    assert.equal(istMoment(new Date("2026-10-05T18:30:00Z")).date, "2026-10-06");
    assert.equal(istMoment(new Date("2026-10-05T18:29:59Z")).time, "23:59:59");
  });
});

describe("totals: integer paise equal PHP's float sums", () => {
  test("each fixture list sums to the same figure", () => {
    for (const t of fx.totals) {
      const paise = t.rupees.reduce((sum, r) => sum + Math.round(r * 100), 0);
      assert.equal(paise, t.paise, JSON.stringify(t.rupees));
      assert.equal((paise / 100).toFixed(2), t.sum);
    }
  });
});
