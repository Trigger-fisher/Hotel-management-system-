// flow-invite-mails-have-no-sign-in-link and flow-locked-mail-shows-raw-utc (MJ, 5 Nov 2026).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { istTime, renderMail, signInLink } from "../../src/server/services/auth/mail";

const link = signInLink("https://hms.example/");

describe("flow-invite-mails-have-no-sign-in-link", () => {
  for (const kind of ["temp_password", "admin_reset", "onboarding_approved"] as const) {
    test(`${kind}: a Sign in button and the address in the text`, () => {
      const m = renderMail(kind, { name: "Ravi", username: "ravi", tempPassword: "Temp#Pass9876", hotelName: "Hotel Sunrise", link });
      assert.equal(link, "https://hms.example/login");
      assert.ok(m.text.includes(link), m.text);
      assert.ok(m.html.includes(`href="${link}"`), "the HTML has the button");
    });
  }
});

describe("flow-locked-mail-shows-raw-utc", () => {
  test("the unlock time is written in IST words, never as an ISO string", () => {
    assert.equal(istTime("2026-11-05T17:15:00.000Z"), "10:45 pm, 5 Nov");
    const m = renderMail("account_locked", { name: "Anita", until: "2026-11-05T17:15:00.000Z" });
    assert.ok(m.text.includes("05 Nov 2026") && m.text.includes("10:45 pm"), m.text);
    assert.ok(!m.text.includes("2026-11-05T") && !m.html.includes("2026-11-05T"));
  });
});
