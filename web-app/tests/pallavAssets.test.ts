import { test } from "node:test";
import assert from "node:assert/strict";

import { pallavHeadSheets } from "../src/dashboards/pallav/assets.ts";

test("the server-written sheets name each sheet once, the base bundle first and the last bundle last", () => {
  const names = pallavHeadSheets(["pms-dash.css", "portal.css", "portal.css"]).map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ["pallav-base.css", "portal.css", "pallav-last.css"]);
});

test("a page sheet the base bundle already holds is not linked again (it would move in the cascade)", () => {
  const names = pallavHeadSheets(["shift-handover.css", "pms-payroll.css", "pms-dark.css", "hms-overrides.css"]).map((s) => s.name);
  assert.deepEqual(names, ["pallav-base.css", "shift-handover.css", "pallav-last.css"]);
});
