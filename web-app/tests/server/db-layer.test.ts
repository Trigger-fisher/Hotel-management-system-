// The app's database layer without a database: the ids, the one converter for PostgreSQL's values (money, counters, decimals, moments), the error
// classifier (by SQLSTATE, never by text) and the driver's type parsers. The real behaviour runs on the instance in tests/db.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ConversionError, fromDbDateTime, istDay, paiseParam, toBigInt, toDbDate, toDbDateTime, toDecimalNumber, toSafeNumber } from "../../src/db/convert";
import { pgTypes } from "../../src/db/pool";
import { hotelSchemaOf, isUuid, newId } from "../../src/server/db/ids";
import { classifyPgError, isConnectionBroken, isRetryable } from "../../src/server/db/pgErrors";

const ID = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";

describe("ids", () => {
  test("uuidv7: dashed, lower-case, version 7, increasing, no repeats", () => {
    const ids = Array.from({ length: 5000 }, () => newId());
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), ids, "ids made by one process sort in the order they were made");
  });

  test("a clock that goes backwards still gives increasing ids", () => {
    const a = newId(2_000_000_000_000);
    const b = newId(1_000_000_000_000);
    const c = newId(1_000_000_000_000);
    assert.ok(a < b && b < c);
  });

  test("isUuid accepts only the canonical lower-case dashed form", () => {
    assert.ok(isUuid(ID));
    for (const bad of [ID.toUpperCase(), ID.replaceAll("-", ""), ` ${ID}`, `${ID}\n`, "", null, undefined, 5, {}, [ID]]) assert.equal(isUuid(bad), false, JSON.stringify(bad));
  });

  test("the hotel schema name is hotel_<32 hex> and anything else throws", () => {
    assert.equal(hotelSchemaOf(ID), "hotel_0198a3b27c4d7e5f8a9b0c1d2e3f4a5b");
    for (const bad of [ID.toUpperCase(), "platform", `${ID}; DROP SCHEMA platform`, ""]) assert.throws(() => hotelSchemaOf(bad), TypeError);
  });
});

describe("one converter for PostgreSQL's values (money, counters, decimals, moments)", () => {
  test("bigint text becomes an exact bigint, at and beyond 2^53", () => {
    assert.equal(toBigInt("9007199254740993"), BigInt("9007199254740993"));
    assert.equal(toBigInt("-5"), BigInt(-5));
    assert.equal(toBigInt(BigInt(7)), BigInt(7));
    assert.equal(toBigInt(12), BigInt(12));
    for (const bad of ["1.5", "1e3", " 1", "", "abc", 1.5, Number.MAX_SAFE_INTEGER + 2, null, undefined, {}]) assert.throws(() => toBigInt(bad), ConversionError, JSON.stringify(bad));
  });

  test("toSafeNumber returns Number.MAX_SAFE_INTEGER exactly and FAILS LOUDLY one past it, in both directions", () => {
    assert.equal(toSafeNumber(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
    assert.equal(toSafeNumber(String(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
    assert.throws(() => toSafeNumber("9007199254740992"), ConversionError);
    assert.throws(() => toSafeNumber("-9007199254740992"), ConversionError);
  });

  test("paiseParam writes a whole number as exact text, and refuses a fraction, an exponent or an unsafe number", () => {
    assert.equal(paiseParam(12345), "12345");
    assert.equal(paiseParam(BigInt("900719925474099300")), "900719925474099300");
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21, Number.MAX_SAFE_INTEGER + 2]) assert.throws(() => paiseParam(bad), ConversionError, String(bad));
  });

  test("numeric text becomes a number only when a double holds it exactly (15 digits at most)", () => {
    assert.equal(toDecimalNumber("12.50"), 12.5);
    assert.equal(toDecimalNumber("-0.25"), -0.25);
    assert.equal(toDecimalNumber("100"), 100);
    assert.equal(toDecimalNumber("123456789012345"), 123456789012345);
    assert.throws(() => toDecimalNumber("1234567890123456"), ConversionError);
    assert.throws(() => toDecimalNumber("0.1234567890123456"), ConversionError);
    for (const bad of ["1e3", "abc", "", "1,5", null, undefined]) assert.throws(() => toDecimalNumber(bad), ConversionError, JSON.stringify(bad));
  });

  test("timestamptz is a Date; text is read as UTC and truncated (never rounded up) to the millisecond; a bad one is refused", () => {
    const d = new Date("2026-03-04T05:06:07.123Z");
    assert.equal(fromDbDateTime(d), d);
    assert.equal(fromDbDateTime("2026-03-04 05:06:07.123999+00").toISOString(), "2026-03-04T05:06:07.123Z");
    assert.equal(fromDbDateTime("2026-03-04T05:06:07Z").toISOString(), "2026-03-04T05:06:07.000Z");
    assert.equal(fromDbDateTime("2026-03-04 05:06:07.5").getUTCMilliseconds(), 500);
    for (const bad of ["2026-02-30 00:00:00", "2026-13-01 00:00:00", "yesterday", "", new Date("x"), 5, null]) assert.throws(() => fromDbDateTime(bad), ConversionError, String(bad));
  });

  test("a Date goes out as ISO-8601 UTC text, so the driver's own zone logic never runs", () => {
    assert.equal(toDbDateTime(new Date("2026-03-04T05:06:07.123Z")), "2026-03-04T05:06:07.123Z");
    assert.throws(() => toDbDateTime(new Date("x")), ConversionError);
    assert.throws(() => toDbDateTime("2026-03-04" as unknown as Date), ConversionError);
  });

  test("the machine's own time zone never matters: moments round-trip identically whatever TZ is set", () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        const out = toDbDateTime(fromDbDateTime("2026-10-25 01:30:00.250+00"));
        assert.equal(out, "2026-10-25T01:30:00.250Z", tz);
        assert.equal(istDay(new Date("2026-10-25T20:00:00Z")), "2026-10-26", tz);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  test("the IST day: 18:29:59.999 UTC is still today in India, 18:30:00.000 UTC is the next day", () => {
    assert.equal(istDay(new Date("2026-03-31T18:29:59.999Z")), "2026-03-31");
    assert.equal(istDay(new Date("2026-03-31T18:30:00.000Z")), "2026-04-01");
  });

  test("a DATE is text and stays text", () => {
    assert.equal(toDbDate("2026-03-31"), "2026-03-31");
    for (const bad of ["2026-3-31", "2026-03-31T00:00:00", new Date(), null, 5]) assert.throws(() => toDbDate(bad), ConversionError);
  });
});

describe("the driver's type parsers (db/pool.ts)", () => {
  test("a DATE and a TIME stay text; everything else keeps the driver's default (bigint and numeric are text, timestamptz a Date)", () => {
    assert.equal(pgTypes.getTypeParser(1082)("2026-03-31"), "2026-03-31");
    assert.equal(pgTypes.getTypeParser(1083)("18:30:00"), "18:30:00");
    assert.ok(pgTypes.getTypeParser(1184)("2026-03-04 05:06:07.123+00") instanceof Date);
    assert.equal(pgTypes.getTypeParser(20)("9007199254740993"), "9007199254740993");
    assert.equal(pgTypes.getTypeParser(1700)("12.50"), "12.50");
  });
});

describe("classifyPgError (by SQLSTATE, never by text)", () => {
  const err = (code: string, extra: Record<string, unknown> = {}): Error => Object.assign(new Error("some text with a row value 4111-1111"), { code, ...extra });

  test("the kinds the repositories react to", () => {
    const kinds: Record<string, string> = { "23505": "unique", "23503": "foreign_key", "23001": "foreign_key", "23514": "check", "23502": "not_null", "22001": "data_too_long", "22003": "data_too_long", "22P02": "data_too_long", "55P03": "lock_timeout", "40P01": "deadlock", "40001": "serialization", "42501": "forbidden", "08006": "connection_lost", "57P01": "connection_lost", "53300": "connection_lost", "XX000": "unknown" };
    for (const [code, kind] of Object.entries(kinds)) assert.equal(classifyPgError(err(code)).kind, kind, code);
    for (const code of ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"]) assert.equal(classifyPgError(err(code)).kind, "connection_lost", code);
  });

  test("a text that looks like a message never decides: only the code does", () => {
    assert.equal(classifyPgError(new Error("duplicate key value violates unique constraint")).kind, "unknown");
    assert.equal(classifyPgError(null).kind, "unknown");
    assert.equal(classifyPgError("23505").kind, "unknown");
    assert.equal(classifyPgError(err("not a code")).sqlState, null);
  });

  test("the named constraint comes back, the value never does", () => {
    const info = classifyPgError(err("23505", { constraint: "employees_code_key", detail: "Key (code)=(E-1) already exists." }));
    assert.equal(info.constraint, "employees_code_key");
    assert.ok(!JSON.stringify(info).includes("E-1") && !JSON.stringify(info).includes("4111"));
    assert.equal(classifyPgError(err("23505")).constraint, null);
  });

  test("only a deadlock, a serialization victim or a lock wait is retryable; only a lost connection is broken", () => {
    for (const code of ["40P01", "40001", "55P03"]) assert.equal(isRetryable(err(code)), true, code);
    for (const code of ["23505", "23503", "42501", "08006", "XX000"]) assert.equal(isRetryable(err(code)), false, code);
    for (const code of ["08006", "57P01", "ECONNRESET"]) assert.equal(isConnectionBroken(err(code)), true, code);
    for (const code of ["23505", "40P01", "55P03"]) assert.equal(isConnectionBroken(err(code)), false, code);
  });
});
