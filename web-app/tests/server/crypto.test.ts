import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { ConfigError, loadConfig, resetConfigCache } from "../../src/server/config/env";
import { getHashKey, resetKeyCache } from "../../src/server/crypto";
import { CryptoError } from "../../src/server/crypto/errors";
import { hashAuthCode, hashIdentifier, hmacHex, normaliseIdentifier, parseHashKey, safeEqualHex, sha256Hex } from "../../src/server/crypto/hash";

// The keyed hashes of the platform (one-time codes, sign-in identifiers, tokens) and the key's configuration. Sealed personal numbers (decision 74)
// and their blind index are tested in fieldSeal.test.ts.
const b64 = (bytes: Buffer): string => bytes.toString("base64");
const key32 = (): Buffer => randomBytes(32);
const USER = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER_USER = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5c";

function throwsCrypto(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof CryptoError && error.code === code, `expected CryptoError ${code}`);
}

describe("keyed hashes (X1)", () => {
  const key = key32();

  test("same input, same hash: 64 hex", () => {
    const h = hashAuthCode(key, "login", USER, "123456");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashAuthCode(key, "login", USER, "123456"));
  });

  test("a different key, purpose, user or code gives a different hash", () => {
    const base = hashAuthCode(key, "login", USER, "123456");
    assert.notEqual(base, hashAuthCode(key32(), "login", USER, "123456"));
    assert.notEqual(base, hashAuthCode(key, "reset", USER, "123456"));
    assert.notEqual(base, hashAuthCode(key, "login", OTHER_USER, "123456"));
    assert.notEqual(base, hashAuthCode(key, "login", USER, "123457"));
  });

  test("it is a keyed hash, not a bare SHA-256: knowing every 6-digit code does not let you rebuild the table", () => {
    const stored = hashAuthCode(key, "login", USER, "123456");
    for (const guess of ["123456", `login|${USER}|123456`, `login${USER}123456`]) assert.notEqual(sha256Hex(guess), stored);
    // brute force without the key finds nothing
    let found = false;
    for (let code = 0; code < 1000 && !found; code++) found = sha256Hex(String(code).padStart(6, "0")) === stored;
    assert.equal(found, false);
  });

  test("parts cannot be shifted to collide (length-prefixed)", () => {
    assert.notEqual(hmacHex(key, "d", ["ab", "c"]), hmacHex(key, "d", ["a", "bc"]));
    assert.notEqual(hmacHex(key, "d", ["a", "b"]), hmacHex(key, "d", ["ab"]));
    assert.notEqual(hmacHex(key, "d1", ["x"]), hmacHex(key, "d2", ["x"]));
  });

  test("a code hash and an identifier hash can never be equal for the same text (domain separation)", () => {
    assert.notEqual(hashIdentifier(key, "123456"), hashAuthCode(key, "login", USER, "123456"));
  });

  test("identifiers are normalised first: case, spaces, full-width forms and invisible characters", () => {
    const base = hashIdentifier(key, "asha.patel");
    for (const same of ["Asha.Patel", "  asha.patel ", "ASHA.PATEL", "asha​.patel", "ａｓｈａ.ｐａｔｅｌ", "﻿asha.patel"]) {
      assert.equal(hashIdentifier(key, same), base, JSON.stringify(same));
    }
    assert.notEqual(hashIdentifier(key, "asha.patel2"), base);
    assert.equal(normaliseIdentifier("  A​b "), "ab");
  });

  test("bad input is refused", () => {
    throwsCrypto(() => hashAuthCode(key, "login", "not-a-uuid", "1"), "BAD_INPUT");
    throwsCrypto(() => hashAuthCode(key, "login", USER, ""), "BAD_INPUT");
    throwsCrypto(() => hashAuthCode(key, "admin" as never, USER, "1"), "BAD_INPUT");
    throwsCrypto(() => hashIdentifier(key, " ​ "), "BAD_INPUT");
    throwsCrypto(() => hashIdentifier(randomBytes(8), "x"), "BAD_KEY");
    throwsCrypto(() => hmacHex(key, "d", ["x".repeat(600)]), "BAD_INPUT");
  });

  test("plain SHA-256 is for high-entropy tokens only and rejects empty or huge input", () => {
    assert.match(sha256Hex("a-long-random-token"), /^[0-9a-f]{64}$/);
    throwsCrypto(() => sha256Hex(""), "BAD_INPUT");
    throwsCrypto(() => sha256Hex("x".repeat(5000)), "BAD_INPUT");
  });

  test("the key must be base64 of at least 32 bytes", () => {
    assert.equal(parseHashKey(b64(randomBytes(32))).length, 32);
    assert.equal(parseHashKey(b64(randomBytes(64))).length, 64);
    for (const bad of ["", "short", b64(randomBytes(16)), "not base64!!!!"]) throwsCrypto(() => parseHashKey(bad), "BAD_KEY");
  });
});

describe("safeEqualHex (timing-safe)", () => {
  const a = sha256Hex("one");
  test("equal and unequal hashes", () => {
    assert.equal(safeEqualHex(a, a), true);
    assert.equal(safeEqualHex(a, sha256Hex("two")), false);
  });
  test("never throws: wrong length, non-hex, upper case, empty", () => {
    for (const bad of ["", "abc", `${a}0`, a.slice(1), a.toUpperCase(), `${"g".repeat(64)}`]) {
      assert.equal(safeEqualHex(a, bad), false);
      assert.equal(safeEqualHex(bad, a), false);
    }
  });
});

describe("configuration of the key", () => {
  const good = { HMS_HASH_KEY: b64(key32()) };

  test("a valid key loads; it is optional until used", () => {
    assert.equal(loadConfig(good).HMS_HASH_KEY, good.HMS_HASH_KEY);
    assert.equal(loadConfig({}).HMS_HASH_KEY, undefined);
  });

  test("a bad key fails fast naming the variable, never the value", () => {
    const bad = { HMS_HASH_KEY: "tooshortSECRET" };
    assert.throws(
      () => loadConfig(bad),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.deepEqual(error.problems.map((p) => p.split(":")[0]), ["HMS_HASH_KEY"]);
        assert.ok(!`${error.message} ${error.problems.join(" ")}`.includes("tooshortSECRET"));
        return true;
      },
    );
  });

  test("the getter fails with a ConfigError when the key is missing, and works when it is set", () => {
    const saved = { ...process.env };
    try {
      delete process.env.HMS_HASH_KEY;
      resetConfigCache();
      resetKeyCache();
      assert.throws(() => getHashKey(), ConfigError);
      Object.assign(process.env, good);
      resetConfigCache();
      resetKeyCache();
      assert.equal(getHashKey().length, 32);
    } finally {
      process.env = saved;
      resetConfigCache();
      resetKeyCache();
    }
  });
});
