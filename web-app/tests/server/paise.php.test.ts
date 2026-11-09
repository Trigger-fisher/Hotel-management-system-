// Compares the paise module with REAL PHP: every row in fixtures/php-round.json was produced by
// db/scripts/php/generate-round-fixtures.php running Pallav's own float expressions (round($x, 2) and friends).
// Regenerate with the command at the top of that script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { atLeastZero, divRound, fromRupees, mulDecimal, ratioDecimal, sub, sum, toPaise } from "../../src/server/money/paise";

interface Row {
  op: string;
  in: Record<string, string | number | string[]>;
  php_native_paise: number;
  php83_paise: number;
}
interface Fixture {
  phpVersion: string;
  rows: Row[];
}

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "php-round.json"), "utf8")) as Fixture;

const str = (value: string | number | string[] | undefined): string => String(value);

function compute(row: Row): bigint {
  const i = row.in;
  switch (row.op) {
    case "room_charge":
      return mulDecimal(fromRupees(str(i.rate)), str(i.nights));
    case "qty_price":
      return mulDecimal(fromRupees(str(i.unit_price)), str(i.quantity));
    case "expense_line":
      return mulDecimal(fromRupees(str(i.price)), str(i.quantity));
    case "expense_price_from_total":
      return ratioDecimal(fromRupees(str(i.total)), "1", str(i.quantity));
    case "overtime":
      return ratioDecimal(fromRupees(str(i.salary)), str(i.overtime), str(i.hours), BigInt(str(i.days)));
    case "outstanding":
      return atLeastZero(sub(fromRupees(str(i.net)), fromRupees(str(i.paid))));
    case "bill_sum":
      return sum((i.amounts as string[]).map(fromRupees));
    case "import_round":
      return fromRupees(str(i.x));
    case "occupancy":
      return divRound(BigInt(str(i.occupied)) * BigInt(100), BigInt(str(i.in_service)));
    default:
      throw new Error(`unknown op ${row.op}`);
  }
}

const key = (row: Row): string => `${row.op} ${JSON.stringify(row.in)}`;

// Pallav's live server runs PHP 8.3 (its DEPLOYMENT.md). PHP 8.4 dropped the "pre-round to 15 significant digits" step, so on
// exact ties whose float sits just below the tie it rounds down where 8.3 (and exact decimal maths) round up. These are
// the only rows where the PHP the fixture was generated on (8.4) differs from 8.3, found by the generator's line-by-line
// port of 8.3's round(). A new row here means the paise module or the generator changed.
const NATIVE_8_4_DIFFERS_FROM_8_3 = [
  'qty_price {"quantity":"2.50","unit_price":"33.33"}', // 2.5 x 33.33 = 83.325: 8.3 -> 83.33, 8.4 -> 83.32
  'overtime {"salary":"30000.00","days":28,"hours":"8.00","overtime":"12.25"}', // = 1640.625: 8.3 -> 1640.63, 8.4 -> 1640.62
];

describe(`paise module vs PHP (fixture generated on PHP ${fixture.phpVersion})`, () => {
  test("the fixture is big enough and covers every operation", () => {
    assert.ok(fixture.rows.length >= 300);
    const ops = new Set(fixture.rows.map((r) => r.op));
    for (const op of ["room_charge", "qty_price", "expense_line", "expense_price_from_total", "overtime", "outstanding", "bill_sum", "import_round", "occupancy"]) {
      assert.ok(ops.has(op), `missing ${op}`);
    }
  });

  test("equals PHP 8.3 (Pallav's live server) on every row", () => {
    const wrong = fixture.rows.filter((row) => compute(row) !== toPaise(row.php83_paise)).map((row) => `${key(row)} php83=${row.php83_paise} paise=${compute(row)}`);
    assert.deepEqual(wrong, []);
  });

  test("differs from native PHP 8.4 only on the documented rows", () => {
    const differing = fixture.rows.filter((row) => compute(row) !== toPaise(row.php_native_paise)).map(key);
    assert.deepEqual(differing, NATIVE_8_4_DIFFERS_FROM_8_3);
  });

  test("the generator's PHP 8.3 port agrees with native PHP wherever the two versions agree", () => {
    const disagree = fixture.rows.filter((row) => row.php_native_paise !== row.php83_paise).map(key);
    assert.deepEqual(disagree, NATIVE_8_4_DIFFERS_FROM_8_3);
  });
});
