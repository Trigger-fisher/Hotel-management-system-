// Sign-in words that every user kind reads (MJ, 5 Nov 2026): ease-role-neutral-wording, flow-blocked-and-locked-copy-wrong-audience,
// flow-change-password-copy-contradicts-result / ease-change-password-copy-says-sign-in-again, ease-inconsistent-auth-words.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pallavCopy } from "../../../common/ui-shared/auth-pallav/copy";
import { pallavCopyByLanguage } from "../../../common/ui-shared/auth-pallav/copy.lang";
import { copy, errorText } from "../../../common/ui-shared/auth/copy";
import { authWordsCopyByLanguage } from "../../../common/ui-shared/auth/copy.lang";

describe("sign-in words for every user kind", () => {
  test("the blocked, disabled and locked words never send a guest, a company or a console user to 'your hotel admin' or call them staff", () => {
    const shared = [pallavCopy.blocked.body, pallavCopy.locked.shareHint, pallavCopy.blockedReason.disabled.body, errorText.ACCOUNT_BLOCKED, errorText.ACCOUNT_DISABLED, copy.banner.pages.blocked.line];
    for (const s of shared) assert.doesNotMatch(s, /hotel admin|staff member/i, s);
  });
  test("the first-password screen names what its button does (it signs you straight in)", () => {
    for (const lang of ["en", "hi", "gu"] as const) assert.ok(pallavCopyByLanguage[lang]?.changePassword.submit);
    assert.equal(pallavCopy.changePassword.submit, "Save and continue");
    assert.doesNotMatch(pallavCopy.changePassword.fine, /sign in again/i);
  });
  test("one set of words: the empty sign-in name asks for a username or email, codes are '6-digit' everywhere", () => {
    assert.equal(pallavCopy.requiredByField.username, "Enter your username or email");
    assert.match(pallavCopy.emailCode.subtitle, /6-digit code/);
    assert.equal(pallavCopy.emailCode.codeLabel, "6-digit code");
    assert.ok(authWordsCopyByLanguage.hi?.errorText.SCREEN_LOCKED && authWordsCopyByLanguage.gu?.errorText.SCREEN_LOCKED);
    assert.ok(authWordsCopyByLanguage.gu?.screenLocked.title !== copy.screenLocked.title, "the lock card is translated");
  });
});
