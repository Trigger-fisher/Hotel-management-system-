// Golden tests for Payroll core: every expected value was produced by REAL PHP 8.4 (db/scripts/php/generate-payroll-core-fixtures.php ->
// fixtures/payroll-core.json): Pallav's Support/PhoneCountries.php required verbatim (split, normalise, check, message, pattern, format over
// every country's sample and its edges), the attendance save's cell rule (AttendanceController::save), the dashboard's progress percent (PHP
// round) and AttendanceMonth::isComplete / daysInMonth with the days expected so far.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { AttendanceStatusRecord } from "../../src/server/repos/payrollCore";
import { cells, daysExpected, daysInMonth, isComplete, progressPercent } from "../../src/server/services/payrollCore/attendanceService";
import * as phone from "../../src/server/services/payrollCore/phone";

interface Fixture {
  php: string;
  phones: { raw: string; selected: string | null; split: [string, string] | null; dial: string; national: string; error: string | null; format: string }[];
  countries: { iso: string; name: string; dial: string; min: number; max: number; lead: string | null; sample: string; message: string; pattern: string }[];
  fallback: { message: string; pattern: string; format: string };
  saves: {
    attendance: Record<string, Record<string, string | null>>;
    overtime: Record<string, Record<string, string>>;
    days: number;
    result: { error: string } | { writes: ({ employee: string; day: number; clear: true } | { employee: string; day: number; clear: false; status: string | null; shortcut_key: string | null; attendance_percentage: number; skips_food: boolean; overtime_hours: number })[] };
  }[];
  progress: { filled: number; expected: number; percent: number }[];
  months: { year: number; month: number; today: string; daysInMonth: number; isComplete: boolean; daysExpected: number }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "payroll-core.json"), "utf8")) as Fixture;

describe("payroll core golden (real PHP " + fx.php + ")", () => {
  test("the country list is Pallav's, India first, every dial and iso unique (PhoneNumberTest)", () => {
    const ours = phone.all();
    assert.equal(ours.length, 41);
    assert.deepEqual(
      ours.map((c) => ({ ...c })),
      fx.countries.map((c) => ({ iso: c.iso, name: c.name, dial: c.dial, min: c.min, max: c.max, lead: c.lead, sample: c.sample })),
    );
    assert.equal(ours[0].iso, "IN");
    assert.equal(new Set(ours.map((c) => c.dial)).size, ours.length);
    for (const c of fx.countries) {
      assert.equal(phone.message(c.dial), c.message, `message ${c.iso}`);
      assert.equal(phone.pattern(c.dial), c.pattern, `pattern ${c.iso}`);
    }
    assert.equal(phone.message("999"), fx.fallback.message);
    assert.equal(phone.pattern(null), fx.fallback.pattern);
    assert.equal(phone.format("999", "12345"), fx.fallback.format);
    assert.deepEqual(
      phone.phoneCountries().map((c) => [c.dial, c.pattern, c.message]),
      fx.countries.map((c) => [c.dial, c.pattern, c.message]),
    );
  });

  test(`split, normalise, check and format agree with PHP on all ${fx.phones.length} numbers`, () => {
    for (const c of fx.phones) {
      const label = JSON.stringify([c.raw, c.selected]);
      assert.deepEqual(phone.split(c.raw), c.split, `split ${label}`);
      assert.deepEqual(phone.normalise(c.raw, c.selected), [c.dial, c.national], `normalise ${label}`);
      assert.equal(phone.check(c.dial, c.national), c.error, `check ${label}`);
      assert.equal(phone.format(c.dial, c.national), c.format, `format ${label}`);
    }
  });

  const statuses: AttendanceStatusRecord[] = [
    { id: "s1", payrollCompanyId: "c", name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid", skipsFood: false, isActive: true, createdAt: new Date(0) },
    { id: "s2", payrollCompanyId: "c", name: "Half day", shortcutKey: "hd", color: "#F59E0B", attendancePercentage: 50, statusType: "Paid", skipsFood: false, isActive: true, createdAt: new Date(0) },
    { id: "s3", payrollCompanyId: "c", name: "Absent", shortcutKey: "A", color: "#EF4444", attendancePercentage: 0, statusType: "Unpaid", skipsFood: true, isActive: true, createdAt: new Date(0) },
    { id: "s4", payrollCompanyId: "c", name: "Leave", shortcutKey: "L", color: "#3B82F6", attendancePercentage: 100, statusType: "Paid", skipsFood: true, isActive: false, createdAt: new Date(0) },
  ];

  test("the attendance save's cells match AttendanceController::save for every case", () => {
    fx.saves.forEach((c, n) => {
      // PHP's form arrays are keyed by day; the apps send one entry per day of the month (index 0 = day 1)
      const rows = Object.entries(c.attendance).map(([employeeId, byDay]) => {
        const last = Math.max(0, ...Object.keys(byDay).map(Number));
        const days: (string | null)[] = Array.from({ length: last }, () => null);
        const overtime: (number | null)[] = Array.from({ length: last }, () => null);
        const present: boolean[] = Array.from({ length: last }, () => false);
        for (const [day, key] of Object.entries(byDay)) {
          if (Number(day) < 1) continue;
          days[Number(day) - 1] = key;
          present[Number(day) - 1] = true;
          const hours = c.overtime[employeeId]?.[day];
          // (float) "abc" is 0 in PHP
          overtime[Number(day) - 1] = hours === undefined ? null : Number.isFinite(Number(hours)) ? Number(hours) : 0;
        }
        return { employeeId, days, overtime, present };
      });
      const out = cells(rows, statuses, c.days);
      if ("error" in c.result) {
        assert.deepEqual(out, { error: c.result.error }, `case ${n}`);
        return;
      }
      assert.ok(!("error" in out), `case ${n}`);
      // compare only the days PHP saw (the apps' array fills the gaps with null, which PHP never posted)
      const seen = new Set(rows.flatMap((r) => r.present.flatMap((p, i) => (p ? [`${r.employeeId}|${i + 1}`] : []))));
      const ours = [
        ...out.clear.map((x) => ({ employee: x.employeeId, day: x.day, clear: true as const })),
        ...out.upsert.map((x) => ({ employee: x.employeeId, day: x.day, clear: false as const, status: x.attendanceStatusId, shortcut_key: x.shortcutKey, attendance_percentage: x.attendancePercentage, skips_food: x.skipsFood, overtime_hours: Number(x.overtimeHours) })),
      ].filter((x) => seen.has(`${x.employee}|${x.day}`));
      const key = (x: { employee: string; day: number }) => `${x.employee}|${String(x.day).padStart(2, "0")}`;
      assert.deepEqual(ours.sort((a, b) => key(a).localeCompare(key(b))), [...c.result.writes].sort((a, b) => key(a).localeCompare(key(b))), `case ${n}`);
    });
  });

  test("progress percent is PHP's min(100, round(filled / expected * 100))", () => {
    for (const c of fx.progress) assert.equal(progressPercent(c.filled, c.expected), c.percent, `${c.filled}/${c.expected}`);
  });

  test("days in the month, completeness (its last day counts) and days expected so far", () => {
    for (const c of fx.months) {
      const label = `${c.year}-${c.month} on ${c.today}`;
      assert.equal(daysInMonth(c.year, c.month), c.daysInMonth, label);
      assert.equal(isComplete(c, c.today), c.isComplete, label);
      assert.equal(daysExpected(c, c.today), c.daysExpected, label);
    }
  });
});
