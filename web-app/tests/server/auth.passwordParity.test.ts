import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newPasswordChecks, validateNewPassword } from "../../../common/ui-shared/auth/validation";
import { passesPasswordRegex } from "../../src/server/services/auth/policy";

const SAMPLES = [
  "Fresh#Start2026",
  "Sunrise Hotel1!",
  "Sunrise₹2026a",
  "Sunriseé2026",
  "Sunriseé2026!",
  "Tab\tHotel2026!",
  "Hotel2026~a",
  "Hotel2026`a",
  "Hotel2026\\a",
  "Hotel2026§a",
  "Hotel2026—a",
  "Short1!",
  "nocaps#2026",
  "NOLOWER#2026",
  "NoDigits#here",
  "NoSpecial2026",
  "Aa1!".repeat(32),
];

describe("new-password rule: browser and server agree", () => {
  test("the checklist is all green exactly when the server accepts the password", () => {
    for (const pw of SAMPLES) {
      const client = validateNewPassword(pw, pw).password === null && newPasswordChecks(pw).every((c) => c.ok);
      assert.equal(client, passesPasswordRegex(pw), JSON.stringify(pw));
    }
  });

  test("a space is shown as its own unmet rule, not only as a missing special character", () => {
    const failing = newPasswordChecks("Sunrise Hotel1!").filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failing, ["no_invisible"]);
  });
});
