// The phone's Today view of attendance (src/dashboards/groups/payrollCore/attendanceMarks.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { quickMarks, todayPeople, markAllPresent, todayCounts, saveRows } = await import("../src/dashboards/groups/payrollCore/attendanceMarks.ts");

const st = (id: string, key: string, name: string, pct: number, type: "Paid" | "Unpaid" = "Paid", isActive = true) => ({ id, shortcutKey: key, name, attendancePercentage: pct, statusType: type, color: "#000", skipsFood: false, isActive }) as never;
const STATUSES = [st("s1", "P", "Present", 100), st("s2", "HD", "Half day", 50), st("s3", "A", "Absent", 0, "Unpaid"), st("s4", "WO", "Week off", 100), st("s5", "PL", "Paid leave", 100), st("s6", "X", "Old mark", 100, "Paid", false)];
const sheet = {
  daysInMonth: 5,
  rows: [
    { employeeId: "e1", employeeName: "Anita Nair", employeeCode: "E1", designation: "Desk", days: [], keys: ["P", "P", null, null, null], overtime: [], overtimeHours: 0 },
    { employeeId: "e2", employeeName: "Ravi Solanki", employeeCode: "E2", designation: "Cook", days: [], keys: ["A", "P", "HD", null, null], overtime: [], overtimeHours: 0 },
    { employeeId: "e3", employeeName: "Meena Parmar", employeeCode: "E3", designation: "HK", days: [], keys: [null, null, null, null, null], overtime: [], overtimeHours: 0 },
  ],
} as never;

describe("attendance Today view", () => {
  test("the big buttons are the hotel's present, half day and absent; the rest go to More; inactive marks are left out", () => {
    const { quick, more, present } = quickMarks(STATUSES);
    assert.deepEqual(quick.map((s: { shortcutKey: string }) => s.shortcutKey), ["P", "HD", "A"]);
    assert.deepEqual(more.map((s: { shortcutKey: string }) => s.shortcutKey), ["PL", "WO"]);
    assert.equal((present as { shortcutKey: string }).shortcutKey, "P");
  });
  test("today's column is read from the sheet's keys", () => {
    assert.deepEqual(todayPeople(sheet, 2).map((p: { key: string }) => p.key), ["", "HD", ""]);
  });
  test("mark everyone present fills only the unmarked", () => {
    const people = todayPeople(sheet, 2);
    assert.deepEqual(markAllPresent({}, people, "p"), { e1: "P", e3: "P" });
    assert.deepEqual(markAllPresent({ e1: "A" }, people, "P"), { e1: "A", e3: "P" });
  });
  test("counts read the changed marks over the sheet", () => {
    const people = todayPeople(sheet, 2);
    assert.deepEqual(todayCounts(people, { e1: "P", e3: "WO" }, STATUSES), { present: 1, half: 1, absent: 0, other: 1, unmarked: 0 });
    assert.deepEqual(todayCounts(people, {}, STATUSES), { present: 0, half: 1, absent: 0, other: 0, unmarked: 2 });
  });
  test("the save sends only changed people, the whole month with today's key replaced", () => {
    const rows = saveRows(sheet, 2, { e1: "P", e2: "HD", e3: "" });
    assert.deepEqual(rows, [{ employeeId: "e1", days: ["P", "P", "P", null, null] }]);
    assert.deepEqual(saveRows(sheet, 2, { e2: "" }), [{ employeeId: "e2", days: ["A", "P", null, null, null] }]);
  });
});
