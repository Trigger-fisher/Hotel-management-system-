// Golden tests for the staff-meals bill: expected values were produced by REAL PHP running verbatim copies of Pallav's Support/FoodCharges.php
// (db/scripts/php/generate-payroll-meals-fixtures.php → fixtures/payroll-meals.json): the days charged, each at the price in force that day as a
// share of the month, the days left out for their status, the note, and the prices of the month.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { mealRow, pricesIn, rateOn } from "../../src/server/services/payrollPay/mealsMath";

interface Case {
  name: string;
  year: number;
  month: number;
  joined: string | null;
  left: string | null;
  until: string | null;
  skipped: number[];
  rates: [string, string][];
  periods: [string, string | null][] | null;
  php: { days: number; counted: number[]; leftOut: number; amount: number; note: string | null; prices: { from: string; amount: number }[]; rateAtEnd: number | null };
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "payroll-meals.json"), "utf8")) as { php: string; cases: Case[] };

describe(`staff meals golden (real PHP ${fx.php})`, () => {
  test(`all ${fx.cases.length} people-months: days, amount, days left out, the note and the month's prices`, () => {
    for (const c of fx.cases) {
      const rates = c.rates.map(([effectiveFrom, amount]) => ({ effectiveFrom, amount: Number(amount) }));
      const periods = c.periods === null ? null : c.periods.map(([startsOn, endsOn]) => ({ startsOn, endsOn }));
      const got = mealRow({ year: c.year, month: c.month, joined: c.joined, left: c.left, skipped: c.skipped, periods, until: c.until, rates });
      assert.deepEqual({ days: got.days, counted: got.counted, leftOut: got.leftOut, amount: got.amount, note: got.note }, { days: c.php.days, counted: c.php.counted, leftOut: c.php.leftOut, amount: c.php.amount, note: c.php.note }, c.name);
      assert.deepEqual(pricesIn(c.year, c.month, rates), c.php.prices, c.name);
      const last = new Date(Date.UTC(c.year, c.month, 0)).toISOString().slice(0, 10);
      assert.equal(rateOn(last, rates), c.php.rateAtEnd, c.name);
    }
  });
});
