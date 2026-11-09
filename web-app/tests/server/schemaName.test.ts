import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HOTEL_PRELUDE_SQL, HOTEL_ROLE_SUFFIX, HOTEL_SCHEMA_PREFIX, SET_SEARCH_PATH_SQL, assertHotelSchemaName, canonicalHotelId, hotelRoleName, hotelSchemaName, hotelSearchPath, quoteIdentifier, searchPathOfSchema } from "../../src/db/schemaName";
import { AppError } from "../../src/server/errors";

const DASHED = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";
const BARE = "0198a3b27c4d7e5f8a9b0c1d2e3f4a5b";

describe("hotelSchemaName", () => {
  test("accepts a lowercase dashed UUID and a 32-hex id", () => {
    assert.equal(hotelSchemaName(DASHED), `hotel_${BARE}`);
    assert.equal(hotelSchemaName(BARE), `hotel_${BARE}`);
    assert.ok(hotelSchemaName(DASHED).startsWith(HOTEL_SCHEMA_PREFIX));
    assert.equal(hotelSchemaName(DASHED).length, 38);
  });

  test("rejects hostile and malformed input", () => {
    const hostile: unknown[] = [
      "",
      " ",
      `${DASHED} `,
      ` ${DASHED}`,
      `${DASHED}\n`,
      `${BARE}\n`,
      DASHED.toUpperCase(),
      BARE.toUpperCase(),
      `${DASHED}\`; DROP DATABASE platform; --`,
      `${BARE}'; --`,
      `"${BARE}"`,
      `hotel_${BARE}`,
      `${BARE}, platform`,
      `${BARE};SELECT 1`,
      "platform",
      "public",
      "pg_catalog",
      "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5",
      `${BARE}0`,
      "0198a3b27c4d7e5f8a9b0c1d2e3f4a5g",
      "0198a3b2-7c4d-7e5f-8a9b0c1d2e3f4a5b",
      "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5bb",
      "ｆ".repeat(32), // full-width characters
      "٠".repeat(32), // Arabic-Indic digits
      `${BARE.slice(0, 31)}\u0000`,
      `${BARE.slice(0, 30)}​​`,
      "a".repeat(500),
      "../../etc/passwd",
      "-- comment",
      "%00",
      null,
      undefined,
      123,
      {},
      [],
      [DASHED],
      { toString: () => DASHED },
    ];
    for (const value of hostile) {
      assert.throws(
        () => hotelSchemaName(value),
        (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
        `should reject ${JSON.stringify(value)}`,
      );
    }
  });

  test("the error never repeats the rejected value", () => {
    try {
      hotelSchemaName("evil'; DROP TABLE users; --");
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.ok(!error.message.includes("evil"));
    }
  });
});

describe("canonicalHotelId", () => {
  test("gives the dashed lower-case spelling for either accepted form and refuses the rest", () => {
    assert.equal(canonicalHotelId(BARE), DASHED);
    assert.equal(canonicalHotelId(DASHED), DASHED);
    assert.throws(() => canonicalHotelId(DASHED.toUpperCase()), AppError);
  });
});

describe("quoteIdentifier (second guard)", () => {
  test("quotes a safe name", () => {
    assert.equal(quoteIdentifier(`hotel_${BARE}`), `"hotel_${BARE}"`);
    assert.equal(quoteIdentifier("platform"), '"platform"');
  });
  test("rejects anything that could break out of the quotes", () => {
    for (const bad of ["a`b", 'a"b', "a b", "a;b", "a-b", "A", "1abc", "", "a".repeat(64), "é", "a\nb", 'x"; DROP']) {
      assert.throws(() => quoteIdentifier(bad), AppError, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe("the hotel's role and search path (PostgreSQL)", () => {
  test("the role is hotel_<32 hex>_rw, from the same strict id as the schema", () => {
    assert.equal(hotelRoleName(DASHED), `hotel_${BARE}${HOTEL_ROLE_SUFFIX}`);
    assert.equal(hotelRoleName(BARE), `hotel_${BARE}_rw`);
    assert.throws(() => hotelRoleName(DASHED.toUpperCase()), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    assert.throws(() => hotelRoleName(`${BARE}'; DROP ROLE hms_owner; --`), AppError);
  });

  test("the role and the search path reach the database as parameters of one transaction-local prelude; the search path is the hotel schema and pg_catalog, never platform or public", () => {
    assert.equal(hotelSearchPath(DASHED), `hotel_${BARE}, pg_catalog`);
    assert.ok(!hotelSearchPath(DASHED).includes("platform") && !hotelSearchPath(DASHED).includes("public"));
    assert.equal(SET_SEARCH_PATH_SQL, "SELECT set_config('search_path', $1, true)");
    assert.equal(HOTEL_PRELUDE_SQL, "SELECT set_config('role', $1, true), set_config('search_path', $2, true)");
    assert.throws(() => quoteIdentifier(`hotel_${BARE}_rw"; DROP ROLE hms_owner; --`), AppError);
  });
});

describe("readable hotel schemas (platform 0172)", () => {
  test("a schema named for the hotel is accepted; a system schema, a bad shape or an injection is not", () => {
    for (const ok of ["blue_lagoon_residency", "sunrise_group_hotel_sunrise_rajkot", "h_7_seas", "hotel", `hotel_${BARE}`, "a".repeat(63)]) assert.equal(assertHotelSchemaName(ok), ok);
    for (const bad of ["platform", "public", "information_schema", "pg_catalog", "pg_toast", "Blue_Lagoon", "blue lagoon", "blue-lagoon", "1hotel", "", "a".repeat(64), 'x"; DROP SCHEMA platform; --', "x, platform", null, 42, undefined]) {
      assert.throws(() => assertHotelSchemaName(bad), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN", String(bad));
    }
  });

  test("the search path of a schema is that schema and pg_catalog only, never platform or public", () => {
    assert.equal(searchPathOfSchema("blue_lagoon_residency"), "blue_lagoon_residency, pg_catalog");
    assert.throws(() => searchPathOfSchema("platform"), AppError);
    assert.throws(() => searchPathOfSchema("x, platform"), AppError);
  });

  test("the role and the canonical id come from the hotel's id alone: they do not depend on the schema's name", () => {
    assert.equal(hotelRoleName(DASHED), `hotel_${BARE}_rw`);
    assert.equal(canonicalHotelId(BARE), DASHED);
  });
});