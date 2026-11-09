// The key that seals the mail password (mail/key.ts): nothing extra to set up. Derived from HMS_HASH_KEY with HKDF (SHA-256, empty salt, info "hms-smtp-v1", 32 bytes); SMTP_SECRET_KEY,
// when present, wins; a password sealed under another key does not open (it is reported as unreadable and the sender falls back).
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { loadConfig } from "../../src/server/config/env";
import { deriveSmtpKey, smtpSecretKeyOf, SMTP_KEY_INFO } from "../../src/server/mail/key";
import { readSmtpPassword, sealSmtpSecret } from "../../src/server/mail/smtp";

const HASH = randomBytes(32);
const HASH_B64 = HASH.toString("base64");
const OVERRIDE = randomBytes(32);

/** RFC 5869 HKDF-SHA256 written out by hand, so the test does not trust the library call it checks. */
function hkdf(ikm: Buffer, info: string, length: number): Buffer {
  const prk = createHmac("sha256", Buffer.alloc(32)).update(ikm).digest();
  const out: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(out).length < length; i += 1) {
    previous = createHmac("sha256", prk).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([i])])).digest();
    out.push(previous);
  }
  return Buffer.concat(out).subarray(0, length);
}

describe("the derived mail key", () => {
  test("HKDF-SHA256 of HMS_HASH_KEY with the fixed info string, 32 bytes, the same every time, and not the hash key itself", () => {
    assert.equal(SMTP_KEY_INFO, "hms-smtp-v1");
    const key = deriveSmtpKey(HASH);
    assert.equal(key.length, 32);
    assert.deepEqual(key, hkdf(HASH, "hms-smtp-v1", 32));
    assert.deepEqual(deriveSmtpKey(HASH), key);
    assert.notDeepEqual(key, HASH);
    assert.notDeepEqual(deriveSmtpKey(randomBytes(32)), key);
  });

  test("with only HMS_HASH_KEY the key is derived; SMTP_SECRET_KEY, when present, wins; with neither there is no key", () => {
    assert.deepEqual(smtpSecretKeyOf({ HMS_HASH_KEY: HASH_B64 }), deriveSmtpKey(HASH));
    assert.deepEqual(smtpSecretKeyOf({ HMS_HASH_KEY: HASH_B64, SMTP_SECRET_KEY: OVERRIDE.toString("base64") }), OVERRIDE);
    assert.deepEqual(smtpSecretKeyOf({ SMTP_SECRET_KEY: OVERRIDE.toString("base64") }), OVERRIDE);
    assert.equal(smtpSecretKeyOf({}), null);
  });

  test("it works from the real configuration: the app config with only HMS_HASH_KEY gives a key, and SMTP_SECRET_KEY is optional in production", () => {
    const cfg = loadConfig({ HMS_HASH_KEY: HASH_B64 });
    assert.deepEqual(smtpSecretKeyOf(cfg), deriveSmtpKey(HASH));
    assert.equal(cfg.SMTP_SECRET_KEY, undefined);
    assert.throws(() => loadConfig({ SMTP_SECRET_KEY: "short" }));
  });

  test("a password sealed under the derived key opens with it; under another key (a changed HMS_HASH_KEY, or the override) it is unreadable, never an exception", () => {
    const sealed = sealSmtpSecret(deriveSmtpKey(HASH), "abcdefghijklmnop", "platform");
    assert.deepEqual(readSmtpPassword(sealed, smtpSecretKeyOf({ HMS_HASH_KEY: HASH_B64 }), "platform"), { pass: "abcdefghijklmnop", unreadable: false });
    assert.deepEqual(readSmtpPassword(sealed, smtpSecretKeyOf({ HMS_HASH_KEY: randomBytes(32).toString("base64") }), "platform"), { pass: null, unreadable: true });
    assert.deepEqual(readSmtpPassword(sealed, smtpSecretKeyOf({ HMS_HASH_KEY: HASH_B64, SMTP_SECRET_KEY: OVERRIDE.toString("base64") }), "platform"), { pass: null, unreadable: true }, "adding the override later makes the old one unreadable");
    assert.deepEqual(readSmtpPassword(sealed, smtpSecretKeyOf({ HMS_HASH_KEY: HASH_B64 }), "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b"), { pass: null, unreadable: true }, "another owner");
  });
});