// Golden tests for the letters' text rules: the experience letter's {DURATION} (EmployeeSeparation::tenureLabel) over 274 date pairs and the
// placeholders (renderFor), expected values from REAL PHP (db/scripts/php/generate-payroll-letters-fixtures.php → fixtures/payroll-letters.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { dateDiff, experienceValues, joiningValues, strtr, tenureLabel } from "../../src/server/services/payrollPay/letterText";

const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "payroll-letters.json"), "utf8")) as {
  php: string;
  tenures: { from: string; to: string; y: number; m: number; d: number; invert: number; label: string }[];
  joining: { text: string; out: string };
  experience: { text: string; out: string };
};

describe(`letters golden (real PHP ${fx.php})`, () => {
  test(`the interval and Carbon's wording agree with PHP on all ${fx.tenures.length} date pairs`, () => {
    for (const t of fx.tenures) {
      assert.deepEqual(dateDiff(t.from, t.to), { y: t.y, m: t.m, d: t.d }, `${t.from} → ${t.to}`);
      assert.equal(tenureLabel(t.from, t.to), t.label, `${t.from} → ${t.to}`);
    }
  });

  test("a person with no joining date has no tenure (-)", () => {
    assert.equal(tenureLabel(null, "2026-10-27"), "-");
  });

  test("placeholders: one pass over the exact set, a replaced value is never scanned again, dates as Pallav prints them", () => {
    const joined = strtr(fx.joining.text, joiningValues({ name: "Asha Patel", designation: "Chef", department: null, responsibilities: "Run the kitchen. {DESIGNATION} duties", joiningDate: "2026-09-08" }, "2026-10-05"));
    assert.equal(joined, fx.joining.out);
    const exp = strtr(fx.experience.text, experienceValues({ name: "Asha Patel", designation: "Chef", department: "", joiningDate: "2025-01-10" }, "2026-10-27", "2026-10-05"));
    assert.equal(exp, fx.experience.out);
  });
});
