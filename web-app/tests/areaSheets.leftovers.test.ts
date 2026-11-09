// Design leftovers: rules in the area sheets that must stay narrow. Run with `node --test tests/areaSheets.leftovers.test.ts`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sheet = (name: string) => readFileSync(new URL(`../public/pallav/${name}`, import.meta.url), "utf8");

describe("area sheets", () => {
  test("text boxes grow to their text only in Hotel settings, so message boxes keep their rows", () => {
    const css = sheet("areas/hotel-admin.css");
    for (const rule of css.match(/[^{}]*\{[^}]*field-sizing[^}]*\}/g) ?? []) {
      assert.match(rule.split("{")[0] ?? "", /textarea\.st-fit/, `field-sizing must be scoped to .st-fit: ${rule.trim()}`);
    }
    const settings = readFileSync(new URL("../src/dashboards/groups/admin/Settings.tsx", import.meta.url), "utf8");
    assert.match(settings, /<Textarea[^>]*className="st-fit"/);
  });

  test("text on an ink fill has a day and a night value", () => {
    const kit = sheet("areas/kit.css");
    assert.match(kit, /:root\s*\{\s*--on-ink:/);
    assert.match(kit, /:root\[data-theme="dark"\]\s*\{\s*--on-ink:/);
    const dots = sheet("hms-overrides.css").match(/[^}]*\.wz-dot\s*\{[^}]*\}/g) ?? [];
    assert.ok(dots.some((r) => r.includes("var(--on-ink)")));
    for (const r of dots) assert.ok(!r.includes("var(--cream)"), r.trim());
  });

  test("the dead WhatsApp desk classes are gone", () => {
    const all = sheet("hms-overrides.css") + sheet("conversations.css");
    for (const cls of ["wa-row-done", "wa-head-wide", "wa-head-narrow", "cv-panel-assignee"]) assert.ok(!all.includes(cls), cls);
  });
});
