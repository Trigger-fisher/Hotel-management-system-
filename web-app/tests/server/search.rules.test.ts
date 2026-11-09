// The shared page-search rules (decision 51) and the restaurant-hours rules (decision 52), as plain functions: no database, no routes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { matchWords, SEARCH_MAX, searchParam, searchWords } from "../../src/server/validation/listQuery";
import { checkHours, hoursFromSettings, hoursToSettings, isOpenAt, OPEN_ALL_DAY } from "../../src/server/services/menu/hours";

describe("page search: words, all of them, any case", () => {
  const rows = [{ name: "Gujarati Thali", note: "With sweet", price: 320 }, { name: "Tea / Coffee (2 cups)", note: null, price: 80 }, { name: "Shirt", note: "Laundry", price: 40 }];
  const text = (r: (typeof rows)[number]) => [r.name, r.note, r.price];
  test("no text, or only spaces, keeps every row (a copy)", () => {
    assert.equal(matchWords(rows, undefined, text).length, 3);
    assert.equal(matchWords(rows, "   ", text).length, 3);
    assert.notEqual(matchWords(rows, "", text), rows);
  });
  test("every word must appear, in any column, in any case; a missing value is skipped", () => {
    assert.deepEqual(matchWords(rows, "thali SWEET", text).map((r) => r.name), ["Gujarati Thali"]);
    assert.deepEqual(matchWords(rows, "  tea   cups ", text).map((r) => r.name), ["Tea / Coffee (2 cups)"]);
    assert.deepEqual(matchWords(rows, "thali shirt", text), [], "two words that no single row holds");
    assert.deepEqual(matchWords(rows, "80", text).map((r) => r.name), ["Tea / Coffee (2 cups)"], "a number column is text too");
    assert.deepEqual(matchWords(rows, "null", text), [], "null is not the word null");
  });
  test("the words of a text", () => {
    assert.deepEqual(searchWords("  Hello   WORLD "), ["hello", "world"]);
    assert.deepEqual(searchWords(undefined), []);
  });
  test("one limit for every search parameter: trimmed, 200 characters, no control characters", () => {
    assert.equal(SEARCH_MAX, 200);
    assert.equal(searchParam.parse("  abc  "), "abc");
    assert.equal(searchParam.parse("a".repeat(200)), "a".repeat(200));
    assert.throws(() => searchParam.parse("a".repeat(201)));
    assert.throws(() => searchParam.parse("a\u0000b"));
    assert.equal(z.strictObject({ search: searchParam }).parse({}).search, undefined);
  });
});

describe("restaurant hours", () => {
  const day = (over: Partial<{ closed: boolean; opens: string; closes: string }> = {}) => ({ closed: false, opens: "09:00", closes: "22:00", ...over });
  const input = (days = Array.from({ length: 7 }, (_, d) => ({ day: d, ...day() })), accepting = true) => ({ accepting, days });

  test("never set, or damaged, reads as accepting and open all day", () => {
    assert.deepEqual(hoursFromSettings(null, null), OPEN_ALL_DAY);
    assert.deepEqual(hoursFromSettings(undefined, "not json"), OPEN_ALL_DAY);
    assert.deepEqual(hoursFromSettings("1", JSON.stringify([day()])), OPEN_ALL_DAY, "not seven days");
    assert.deepEqual(hoursFromSettings("0", JSON.stringify(Array.from({ length: 7 }, () => day({ opens: "23:00", closes: "08:00" })))).days, OPEN_ALL_DAY.days, "opens after closes");
    assert.equal(hoursFromSettings("0", null).accepting, false);
  });

  test("checkHours wants seven days once each, HH:MM, opens before closes; a closed day needs no times", () => {
    const good = checkHours(input());
    assert.ok(good.ok);
    assert.deepEqual(hoursFromSettings(hoursToSettings(good.ok ? good.hours : OPEN_ALL_DAY).accepting, hoursToSettings(good.ok ? good.hours : OPEN_ALL_DAY).hours), good.ok ? good.hours : null, "what is stored reads back the same");
    const closed = checkHours(input(Array.from({ length: 7 }, (_, d) => ({ day: d, ...(d === 6 ? { closed: true, opens: "", closes: "" } : day()) }))));
    assert.ok(closed.ok && closed.hours.days[6].closed);
    const bad = (days: ReturnType<typeof input>["days"]) => {
      const r = checkHours({ accepting: true, days });
      assert.ok(!r.ok && r.message.length > 10);
    };
    bad(input().days.slice(0, 6));
    bad(input().days.map((d, i) => (i === 0 ? { ...d, day: 1 } : d)));
    bad(input().days.map((d, i) => (i === 2 ? { ...d, opens: "9:00" } : d)));
    bad(input().days.map((d, i) => (i === 3 ? { ...d, opens: "22:00", closes: "09:00" } : d)));
    bad(input().days.map((d, i) => (i === 4 ? { ...d, opens: "09:00", closes: "09:00" } : d)));
    bad(input().days.map((d, i) => (i === 5 ? { ...d, closes: "24:00" } : d)));
  });

  test("openNow is the IST weekday and minute (Monday = 0); the switch off closes everything", () => {
    const checked = checkHours(input(Array.from({ length: 7 }, (_, d) => ({ day: d, ...(d === 0 ? day({ opens: "11:00", closes: "22:00" }) : d === 1 ? { closed: true, opens: "", closes: "" } : day()) }))));
    assert.ok(checked.ok);
    const hours = checked.ok ? checked.hours : OPEN_ALL_DAY;
    assert.equal(isOpenAt(hours, new Date("2026-10-05T10:59:00+05:30")), false, "Monday before 11:00");
    assert.equal(isOpenAt(hours, new Date("2026-10-05T11:00:00+05:30")), true, "the opening minute counts");
    assert.equal(isOpenAt(hours, new Date("2026-10-05T21:59:00+05:30")), true);
    assert.equal(isOpenAt(hours, new Date("2026-10-05T22:00:00+05:30")), false, "the closing minute does not");
    assert.equal(isOpenAt(hours, new Date("2026-10-06T12:00:00+05:30")), false, "Tuesday is closed");
    assert.equal(isOpenAt(hours, new Date("2026-10-04T20:00:00Z")), false, "20:00 UTC on Sunday is 01:30 IST on Monday: before the opening");
    assert.equal(isOpenAt({ ...hours, accepting: false }, new Date("2026-10-07T12:00:00+05:30")), false);
  });
});
