// A paused hotel or group (Platform > Hotel and group mail; MJ, 1 Nov 2026). What must hold: the router sends nothing for a paused hotel and answers with the reason PAUSED (the queue
// keeps such a mail without using up a try); a mail with no hotel (sign-in codes) is never paused; the pause is looked at again after the settings time, so resuming works within a minute;
// a check that fails never stops a hotel's mail; and the failure code PAUSED is not permanent.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failureCodeOf, isPermanentFailure, MAIL_FAILURE_TEXT } from "../../src/server/mail/failure";
import { createHotelMailRouter } from "../../src/server/mail/hotelSmtp";
import type { MailMessage, MailSender } from "../../src/server/services/auth/mail";

const H = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const msg = (over: Partial<MailMessage> = {}): MailMessage => ({ to: "guest@example.com", subject: "Hello", text: "Hi", hotelId: H, ...over }) as MailMessage;

function setup(pausedOf: (hotelId: string) => Promise<boolean>) {
  const platformSent: MailMessage[] = [];
  const platform: MailSender = { send: async (m) => void platformSent.push(m) };
  let clock = 1_000_000;
  const router = createHotelMailRouter({ platform, now: () => clock, pausedOf, settingsOf: async () => ({ rows: [], hotelName: "Hotel Sunrise", slug: "sunrise" }) });
  return { router, platformSent, advance: (ms: number) => void (clock += ms) };
}

describe("a paused hotel", () => {
  test("its mail is not sent and the answer carries the reason PAUSED; the platform sender is not used", async () => {
    const t = setup(async () => true);
    const err = await t.router.send(msg()).then(() => null, (e: unknown) => e);
    assert.ok(err);
    assert.equal(failureCodeOf(err), "PAUSED");
    assert.equal(t.platformSent.length, 0);
  });

  test("PAUSED is not permanent (the queue keeps the mail) and has a plain sentence", () => {
    assert.equal(isPermanentFailure("PAUSED"), false);
    assert.match(MAIL_FAILURE_TEXT.PAUSED, /paused/i);
  });

  test("a mail with no hotel (a sign-in code) is never paused", async () => {
    const t = setup(async () => true);
    await t.router.send(msg({ hotelId: null }));
    assert.equal(t.platformSent.length, 1);
  });

  test("a hotel that is not paused sends as before", async () => {
    const t = setup(async () => false);
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 1);
  });

  test("the pause is read again after the settings time: resuming works within a minute, and pausing too", async () => {
    let paused = true;
    const t = setup(async () => paused);
    await assert.rejects(() => t.router.send(msg()));
    paused = false;
    await assert.rejects(() => t.router.send(msg()), "still the remembered answer inside the minute");
    t.advance(60_001);
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 1);
    paused = true;
    t.advance(60_001);
    await assert.rejects(() => t.router.send(msg()));
  });

  test("a check that fails never stops a hotel's mail", async () => {
    const t = setup(async () => {
      throw new Error("database down");
    });
    await t.router.send(msg());
    assert.equal(t.platformSent.length, 1);
  });
});
