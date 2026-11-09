// The staff form's prefilled ID (src/dashboards/groups/payrollCore/staffCode.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

const { nextStaffCode } = await import("../src/dashboards/groups/payrollCore/staffCode.ts");

test("follows the highest numbered ID and keeps its padding", () => {
  assert.equal(nextStaffCode(["EMP001", "EMP009", "EMP003"]), "EMP010");
  assert.equal(nextStaffCode(["PH-99"]), "PH-100");
  assert.equal(nextStaffCode(["7"]), "8");
});

test("ignores IDs that do not end in a number", () => {
  assert.equal(nextStaffCode(["A009", "OWNER", "A010"]), "A011");
});

test("nothing to follow gives an empty ID", () => {
  assert.equal(nextStaffCode([]), "");
  assert.equal(nextStaffCode(["MANAGER", " "]), "");
});
