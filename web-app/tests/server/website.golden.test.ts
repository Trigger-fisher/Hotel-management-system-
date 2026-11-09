// Golden tests for the website's availability: expected values produced by REAL PHP running verbatim copies of Pallav's Support/Site/Availability.php
// (db/scripts/php/generate-website-fixtures.php → fixtures/website.json): the nights of a stay (the 60-night cap), capacity / sold / free / blocked per
// night, the rolling open window (addMonthsNoOverflow edges), the first full night, the blocked stretches and the calendar's inventory refusals.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { displayPhone, fiscalYearOf, guestsLabel, normalizePhone, referenceText } from "../../src/server/services/website/rules";
import { addMonthsNoOverflow, blockedRanges, firstFullNight, freeForStay, inventoryRule, roomNights, stayNights, type NightState } from "../../src/server/services/website/availability";

interface Case {
  name: string;
  today: string;
  capacity: number;
  overrides: Record<string, [number, number]> | [];
  stays: [string, string][];
  held: Record<string, number> | [];
  checkIn: string;
  checkOut: string;
  respect: boolean;
  nights: string[];
  state: Record<string, NightState> | [];
  freeForStay: number;
  unavailableNight: string | null;
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "website.json"), "utf8")) as {
  php: string;
  cases: Case[];
  blocked: { name: string; today: string; rows: [string, string, string][]; ranges: { room_id: string; room_name: string; start: string; end: string }[] }[];
  rules: { left: number; sold: number; total: number; name: string; message: string | null }[];
  windows: [string, string][];
  phones: { raw: string; normalized: string; display: string; displayRaw: string }[];
  guests: { total: number; children: number | null; label: string }[];
  references: { date: string; serial: number; fiscalYear: number; reference: string }[];
};
// PHP encodes an empty array as []
const obj = <T>(v: Record<string, T> | []): Record<string, T> => (Array.isArray(v) ? {} : v);

describe(`website availability golden (real PHP ${fx.php})`, () => {
  test("the open window: Carbon's addMonthsNoOverflow (3 months) over month-end and leap-year edges", () => {
    for (const [from, to] of fx.windows) assert.equal(addMonthsNoOverflow(from, 3), to, from);
  });

  test(`all ${fx.cases.length} stays: nights, per-night state, free for the stay and the first full night equal PHP`, () => {
    for (const c of fx.cases) {
      const nights = stayNights(c.checkIn, c.checkOut);
      assert.deepEqual(nights, c.nights, c.name);
      const input = {
        today: c.today,
        defaultCapacity: c.capacity,
        overrides: new Map(Object.entries(obj(c.overrides)).map(([d, [left, blocked]]) => [d, { roomsLeft: left, blocked: blocked === 1 }])),
        stays: c.stays.map(([checkIn, checkOut]) => ({ checkIn, checkOut })),
        held: new Map(Object.entries(obj(c.held))),
        nights,
      };
      const state = roomNights({ ...input, respectOpenWindow: c.respect });
      assert.deepEqual(state, obj(c.state), c.name);
      assert.equal(freeForStay(state), c.freeForStay, c.name);
      // the confirm gate looks at the stay with no window at all
      assert.equal(firstFullNight(roomNights({ ...input, respectOpenWindow: false })), c.unavailableNight, c.name);
    }
  });

  test("blocked stretches: a week closed is one row per room; yesterday still shows; month and year ends join", () => {
    for (const b of fx.blocked) {
      const got = blockedRanges(b.rows.map(([roomId, date, roomName]) => ({ roomId, roomName, date })), b.today).map((r) => ({ room_id: r.roomId, room_name: r.roomName, start: r.start, end: r.end }));
      assert.deepEqual(got, b.ranges, b.name);
    }
  });

  test("the inventory rule's refusals read as Pallav's", () => {
    for (const r of fx.rules) assert.equal(inventoryRule(r.left, r.sold, r.total, r.name), r.message, JSON.stringify(r));
  });

  test(`phones: normalize and display agree with PHP on all ${fx.phones.length} numbers`, () => {
    for (const p of fx.phones) {
      assert.equal(normalizePhone(p.raw), p.normalized, JSON.stringify(p.raw));
      assert.equal(displayPhone(p.normalized), p.display, JSON.stringify(p.raw));
      assert.equal(displayPhone(p.raw), p.displayRaw, JSON.stringify(p.raw));
    }
  });

  test("guests wording and the enquiry reference (fiscal year from 1 April, five-digit serial)", () => {
    for (const g of fx.guests) assert.equal(guestsLabel(g.total, g.children), g.label, JSON.stringify(g));
    for (const r of fx.references) {
      assert.equal(fiscalYearOf(r.date), r.fiscalYear, r.date);
      assert.equal(referenceText("HP", r.date, r.serial), r.reference, `${r.date} ${r.serial}`);
    }
  });
});
