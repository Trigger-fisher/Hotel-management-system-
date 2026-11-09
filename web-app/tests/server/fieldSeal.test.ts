import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { loadConfig } from "../../src/server/config/env";
import { CryptoError } from "../../src/server/crypto/errors";
import { cleanForIndex, createFieldSeal, isSealed, maskNumber, parseDataKey } from "../../src/server/crypto/fieldSeal";

// Sealed personal numbers (decision 74): the round trip, the binding to hotel and field, the search index, the mask and the key's configuration.
const HOTEL_A = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";
const HOTEL_B = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5c";
const FIELD = "customer.id_proof_number";
const AADHAAR = "1234 5678 9012";
const crypt = (): ReturnType<typeof createFieldSeal> => createFieldSeal(randomBytes(32));
const throwsCrypto = (fn: () => unknown): void => assert.throws(fn, (e: unknown) => e instanceof CryptoError);

describe("seal and open", () => {
  const s = crypt();
  test("a number comes back as typed (trimmed) and is not readable in the stored text", () => {
    const sealed = s.seal(HOTEL_A, FIELD, ` ${AADHAAR} `);
    assert.ok(sealed && isSealed(sealed));
    assert.ok(!sealed.includes("1234") && !sealed.includes("9012"));
    assert.equal(s.open(HOTEL_A, FIELD, sealed), AADHAAR);
  });
  test("sealing twice gives different text (a fresh IV), both open", () => {
    const a = s.seal(HOTEL_A, FIELD, AADHAAR), b = s.seal(HOTEL_A, FIELD, AADHAAR);
    assert.notEqual(a, b);
    assert.equal(s.open(HOTEL_A, FIELD, b), AADHAAR);
  });
  test("blank in, null out; null opens to null", () => {
    for (const v of [null, undefined, "", "   "]) assert.equal(s.seal(HOTEL_A, FIELD, v), null);
    assert.equal(s.open(HOTEL_A, FIELD, null), null);
    assert.equal(s.open(HOTEL_A, FIELD, ""), null);
  });
  test("a sealed value does not open in another hotel, another field, under another key or after a change", () => {
    const sealed = s.seal(HOTEL_A, FIELD, AADHAAR)!;
    throwsCrypto(() => s.open(HOTEL_B, FIELD, sealed));
    throwsCrypto(() => s.open(HOTEL_A, "employee.id_proof_number", sealed));
    throwsCrypto(() => crypt().open(HOTEL_A, FIELD, sealed));
    const parts = sealed.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    throwsCrypto(() => s.open(HOTEL_A, FIELD, parts.join(".")));
  });
  test("a plain (not yet sealed) value is refused, never passed on as a number", () => {
    throwsCrypto(() => s.open(HOTEL_A, FIELD, AADHAAR));
    assert.equal(isSealed(AADHAAR), false);
  });
  test("a bad hotel id, field name or an over-long number is refused; no message holds the value", () => {
    throwsCrypto(() => s.seal("not-a-uuid", FIELD, AADHAAR));
    throwsCrypto(() => s.seal(HOTEL_A, "Bad Field!", AADHAAR));
    assert.throws(() => s.seal(HOTEL_A, FIELD, "9".repeat(500)), (e: unknown) => e instanceof CryptoError && !String((e as Error).message).includes("999"));
    assert.throws(() => s.open(HOTEL_A, FIELD, AADHAAR), (e: unknown) => !String((e as Error).message).includes("1234"));
  });
});

describe("blind index", () => {
  const s = crypt();
  test("same number = same index; spaces, dashes and case do not matter", () => {
    const base = s.blindIndex(HOTEL_A, FIELD, "ABCDE1234F")!;
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(s.blindIndex(HOTEL_A, FIELD, " abcde-1234 f "), base);
    assert.equal(s.blindIndex(HOTEL_A, FIELD, AADHAAR), s.blindIndex(HOTEL_A, FIELD, "123456789012"));
  });
  test("different number, hotel, field or key = different index", () => {
    const base = s.blindIndex(HOTEL_A, FIELD, AADHAAR);
    assert.notEqual(base, s.blindIndex(HOTEL_A, FIELD, "1234 5678 9013"));
    assert.notEqual(base, s.blindIndex(HOTEL_B, FIELD, AADHAAR));
    assert.notEqual(base, s.blindIndex(HOTEL_A, "employee.id_proof_number", AADHAAR));
    assert.notEqual(base, crypt().blindIndex(HOTEL_A, FIELD, AADHAAR));
  });
  test("the index is not the sealing key's output and not a bare hash of the number", () => {
    assert.ok(!s.blindIndex(HOTEL_A, FIELD, AADHAAR)!.includes("123456789012"));
    assert.equal(s.blindIndex(HOTEL_A, FIELD, ""), null);
    assert.equal(s.blindIndex(HOTEL_A, FIELD, null), null);
  });
  test("cleaning", () => assert.equal(cleanForIndex(" ab-12.3/4 "), "AB1234"));
});

describe("mask", () => {
  test("only the last 4 show", () => {
    assert.equal(maskNumber(AADHAAR), "••••9012");
    assert.equal(maskNumber("AB12"), "••••");
    assert.equal(maskNumber(""), "");
    assert.equal(maskNumber(null), "");
  });
});

describe("the key", () => {
  test("exactly 32 bytes of base64; the error names the variable and not the value", () => {
    assert.equal(parseDataKey(randomBytes(32).toString("base64")).length, 32);
    for (const bad of ["", "abc", randomBytes(16).toString("base64"), randomBytes(33).toString("base64")]) {
      assert.throws(() => parseDataKey(bad), (e: unknown) => e instanceof CryptoError && /HMS_DATA_KEY/.test(e.message) && (bad === "" || !e.message.includes(bad)));
    }
    throwsCrypto(() => createFieldSeal(randomBytes(16)));
  });
  test("the configuration accepts a good key, refuses a bad one by name, and does not need it yet", () => {
    assert.equal(loadConfig({ HMS_DATA_KEY: randomBytes(32).toString("base64") }).HMS_DATA_KEY?.length, 44);
    assert.throws(() => loadConfig({ HMS_DATA_KEY: "short" }), /HMS_DATA_KEY/);
    assert.equal(loadConfig({}).HMS_DATA_KEY, undefined);
  });
});
