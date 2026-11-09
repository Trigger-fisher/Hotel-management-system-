// Golden tests for the login backend: expected values made by REAL PHP running Pallav's PasswordPolicy and AuthController::maskEmail
// (db/scripts/php/generate-auth-fixtures.php -> fixtures/auth-pallav.json). Regenerate with:
//   php db/scripts/php/generate-auth-fixtures.php <pallav repo> > "web-app/tests/server/fixtures/auth-pallav.json"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { LOCK_STEPS, MAX_ATTEMPTS, MAX_LOCK_MINUTES, PASSWORD_MESSAGE, lockLabel, lockMinutes, maskEmail, passesPasswordRegex, passwordProblem } from "../../src/server/services/auth/policy";

interface Fixture {
  constants: { maxAttempts: number; lockSteps: number[]; maxLockMinutes: number; message: string };
  lockMinutes: { level: number; minutes: number }[];
  lockLabels: { minutes: number; label: string }[];
  passwords: { password: string; ok: boolean }[];
  generated: { length: number; actual: number; ok: boolean; lookalike: boolean }[];
  masked: { email: string | null; masked: string }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "auth-pallav.json"), "utf8")) as Fixture;

describe("the lock schedule and constants (PasswordPolicy, real PHP)", () => {
  test("constants", () => {
    assert.equal(MAX_ATTEMPTS, fx.constants.maxAttempts);
    assert.deepEqual([...LOCK_STEPS], fx.constants.lockSteps);
    assert.equal(MAX_LOCK_MINUTES, fx.constants.maxLockMinutes);
    assert.equal(PASSWORD_MESSAGE, fx.constants.message);
  });
  test("lockMinutes for every level, including below zero and far above the last step", () => {
    for (const { level, minutes } of fx.lockMinutes) assert.equal(lockMinutes(level), minutes, `level ${level}`);
  });
  test("lockLabel, including Pallav's '1 minutes'", () => {
    for (const { minutes, label } of fx.lockLabels) assert.equal(lockLabel(minutes), label, `${minutes} min`);
  });
});

describe("the password rule (PasswordPolicy::REGEX, real PHP)", () => {
  test(`all ${fx.passwords.length} candidates: same verdict as PCRE (bytes, \\S ASCII only, $ before a final newline)`, () => {
    for (const { password, ok } of fx.passwords) assert.equal(passesPasswordRegex(password), ok, JSON.stringify(password));
  });
  test("the candidates really include passes and failures, multibyte and newline cases", () => {
    assert.ok(fx.passwords.filter((p) => p.ok).length > 50 && fx.passwords.filter((p) => !p.ok).length > 50);
    assert.ok(fx.passwords.some((p) => p.password.includes("\n")) && fx.passwords.some((p) => /[^\x00-\x7f]/.test(p.password)));
  });
  test("passwordProblem adds the 128-character limit and gives Pallav's message", () => {
    assert.equal(passwordProblem("Abcdef1!"), null);
    assert.equal(passwordProblem("abc"), PASSWORD_MESSAGE);
    assert.equal(passwordProblem(`Abcdef1!${"x".repeat(120)}`), null, "128 characters is allowed");
    assert.equal(passwordProblem(`Abcdef1!${"x".repeat(121)}`), "The password field must not be greater than 128 characters.");
  });
  test("PHP's generated passwords all pass our rule too (and avoid look-alike characters)", () => {
    for (const g of fx.generated) assert.ok(g.ok && !g.lookalike && g.actual >= Math.max(g.length, 8));
  });
});

describe("masking the email on the code screen (AuthController::maskEmail, real PHP)", () => {
  test(`all ${fx.masked.length} examples`, () => {
    for (const { email, masked } of fx.masked) assert.equal(maskEmail(email), masked, String(email));
  });
});
