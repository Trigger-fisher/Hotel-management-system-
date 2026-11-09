// The themed HTML emails (mail/layout.ts + renderMail): one shared 600 px table layout for every kind, every person's text escaped, links only http(s), the hotel's brand
// in the header and footer, the HTML handed to nodemailer's own `html` field next to the text part, and no code, password or link in any log.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cachedBrandOf, escapeHtml, langOf, MAIL_THEME, renderMailHtml, renderMailText, safeUrl, type MailBrand } from "../../src/server/mail/layout";
import { MAIL_KINDS, MAIL_ROUTE, type MailKind } from "../../src/server/mail/routes";
import { createSmtpSender, type SmtpTransport } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { renderMail, runOutboxOnce, type MailMessage, type MailPayload } from "../../src/server/services/auth/mail";

const NOW = new Date("2026-10-18T10:00:00Z");
const EVIL = `<script>alert("x")</script> & 'q'`;
const LINK = "https://hms.example/onboard?invite=abc&x=1";
const UNSUB = "https://hms.example/u?t=1";
const evil: MailPayload = {
  name: EVIL, hotelName: EVIL, invitedBy: EVIL, reason: EVIL, reference: EVIL, roomName: EVIL, checkIn: EVIL, checkOut: EVIL, guestName: EVIL, guestPhone: EVIL, guestEmail: EVIL,
  message: EVIL, summary: EVIL, subject: EVIL, text: EVIL, deviceName: EVIL, until: EVIL, username: EVIL, number: EVIL, date: EVIL,
  code: "123456", minutes: 10, tempPassword: "Tmp#Pass<1>", link: LINK, validHours: 168, guests: 2, unsubscribeUrl: UNSUB,
};
const anchors = (html: string): number => (html.match(/<a /g) ?? []).length;

/** What each kind must show in its HTML: a heading or not, a big code, a button to `link`, details labels, the unsubscribe footer. */
const SHAPE: Record<MailKind, { heading?: string; code?: boolean; button?: string; labels?: string[]; unsubscribe?: boolean }> = {
  login_code: { heading: "Your sign-in code", code: true },
  reset_code: { heading: "Your password reset code", code: true },
  reset_link: { heading: "Choose a new password", button: "Choose a new password" },
  password_changed: { heading: "Your password was changed", button: "Sign in to Easy Hotel Solutions" },
  email_changed: { heading: "Your email address was changed" },
  account_locked: { heading: "Your account is locked for now", labels: ["Locked until"] },
  account_blocked: { heading: "Your account was blocked" },
  new_device: { heading: "A new phone signed in", labels: ["Phone"] },
  temp_password: { heading: "Your account is ready", labels: ["Username", "Temporary password"], button: "Sign in to Easy Hotel Solutions" },
  admin_reset: { heading: "Your password was reset", labels: ["Username", "Temporary password"], button: "Sign in to Easy Hotel Solutions" },
  invitation: { heading: "Join Easy Hotel Solutions", button: "Fill in the onboarding form", labels: ["Hotel", "Invited by"] },
  onboarding_waiting: { heading: "We received your form" },
  onboarding_approved: { heading: "You can sign in now", labels: ["Username"], button: "Sign in to Easy Hotel Solutions" },
  onboarding_rejected: { heading: "Your form was not approved", labels: ["Reason"] },
  enquiry_confirmed: { heading: "Your booking is confirmed", labels: ["Reference", "Room", "Check-in", "Check-out"] },
  enquiry_declined: { heading: "We cannot confirm your booking request", labels: ["Reference", "Room", "Check-in", "Check-out", "Reason"] },
  enquiry_new: { heading: "New enquiry from your website", labels: ["Reference", "Name", "Phone", "Email", "Room", "Check-in", "Check-out", "Guests"] },
  daily_summary: { heading: "Your hotel today" },
  campaign: { unsubscribe: true },
  notification: { heading: "We answered your payment problem", labels: ["Problem number", "Subject"] },
  bill_invoice: { heading: "Your invoice", labels: ["Invoice number"] },
  advance_receipt: { heading: "Thank you for your payment", labels: ["Receipt number"] },
};

describe("every kind in the shared layout", () => {
  for (const kind of MAIL_KINDS) {
    test(`${kind}: the 600 px layout, its own structure, all person's text escaped`, () => {
      const m = renderMail(kind, evil);
      const { html } = m;
      assert.ok(html.startsWith("<!DOCTYPE html>"));
      assert.match(html, /<meta name="color-scheme" content="light dark">/);
      assert.match(html, /<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"/);
      assert.match(html, /border-top:4px solid #C9A227/);
      assert.ok(!/<script/i.test(html), "no markup from a person's text");
      assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;"), "the text is shown, escaped");
      assert.ok(!m.text.includes("<table"), "the text part has no HTML");
      const s = SHAPE[kind];
      if (s.heading) assert.ok(html.includes(`<h1 class="hms-ink"`) && html.includes(`${s.heading}</h1>`), "its heading");
      else assert.ok(!html.includes("<h1"), "no heading");
      assert.equal(html.includes("letter-spacing:8px"), s.code === true, "the big code");
      if (s.code) assert.ok(html.includes(">123456</td>"));
      if (s.button) {
        assert.ok(html.includes(`<a class="hms-btn" href="${escapeHtml(LINK)}"`) && html.includes(`>${s.button}</a>`), "one primary button to the link");
        assert.ok(html.includes(`copy this address into your browser: ${escapeHtml(LINK)}`), "the link as text too");
      }
      for (const label of s.labels ?? []) assert.ok(html.includes(`>${label}</td>`), `details row ${label}`);
      if (kind === "temp_password" || kind === "admin_reset") assert.ok(html.includes("Tmp#Pass&lt;1&gt;"));
      assert.equal(anchors(html), (s.button ? 1 : 0) + (s.unsubscribe ? 1 : 0), "only the links it means");
      if (s.unsubscribe) assert.ok(html.includes(`<a class="hms-link" href="${escapeHtml(UNSUB)}"`) && html.includes(">Unsubscribe</a>"));
      // the brand: system mail is the platform's, hotel mail shows its hotel
      assert.ok(html.includes(MAIL_ROUTE[kind] === "hotel" ? `>${escapeHtml(EVIL)}</span>` : ">Easy</span> <span class=\"hms-gold\""));
      assert.equal(html.includes(">Sent with Easy Hotel Solutions</p>"), MAIL_ROUTE[kind] === "hotel", "a hotel mail says it was sent with the product");
    });
  }

  test("a link that is not http(s) makes no button and no link; a campaign without an unsubscribe address shows the line without a link", () => {
    for (const link of ["javascript:alert(1)", "data:text/html,x", 'https://x.example/"onmouseover="a', "not a link"]) {
      const html = renderMail("invitation", { ...evil, link }).html;
      assert.equal(anchors(html), 0, link);
      assert.ok(!/href="(javascript|data):/i.test(html));
    }
    assert.equal(safeUrl("https://ok.example/a?b=1"), "https://ok.example/a?b=1");
    const c = renderMail("campaign", { name: "A", text: "Hello\n\nSecond paragraph", unsubscribeUrl: "javascript:x" }).html;
    assert.equal(anchors(c), 0);
    assert.match(c, /You get this email because you stayed with us/);
    assert.equal((c.match(/<p class="hms-text"/g) ?? []).length, 2, "the campaign's paragraphs");
  });

  test("the sign-in code: its subject and a text part that reads on its own", () => {
    const m = renderMail("login_code", { name: "Asha", code: "123456", minutes: 10 });
    assert.equal(m.subject, "Your Easy Hotel Solutions sign-in code");
    assert.equal(m.text, "Hello Asha,\n\nEnter this code on the sign-in screen. It works for 10 minutes.\n\n    123456\n\nNobody from Easy Hotel Solutions or your hotel will ever ask you for this code.\n\nIf you did not try to sign in, change your password now.\n\n--\nEasy Hotel Solutions\n\nYou get this email because you have an Easy Hotel Solutions account.");
  });
});

describe("the brand", () => {
  const brand: MailBrand = { name: "Hotel <Sunrise>", address: "5 MI Road, Jaipur", phone: "0141 2345678", email: "desk@sunrise.example", logoUrl: "https://hms.example/logo.png" };
  test("a hotel mail shows the hotel's logo (https only) and its contact in the footer; system mail always shows Easy Hotel Solutions", () => {
    const html = renderMail("enquiry_confirmed", { name: "A", reference: "R1" }, brand).html;
    assert.ok(html.includes('<img class="hms-logo-day" src="https://hms.example/logo.png" alt="Hotel &lt;Sunrise&gt;"'));
    assert.ok(html.includes("5 MI Road, Jaipur &middot; 0141 2345678 &middot; desk@sunrise.example"));
    assert.ok(!renderMail("enquiry_confirmed", { name: "A" }, { ...brand, logoUrl: "http://localhost:3000/logo.png" }).html.includes("<img"), "no logo a mail program cannot reach");
    const system = renderMail("login_code", { name: "A", code: "1" }, brand).html;
    assert.ok(system.includes(">Easy</span> <span class=\"hms-gold\"") && !system.includes("Sunrise") && !system.includes("Sent with"));
  });

  test("system mail shows the platform's logo from the app's own https address, with the night logo for dark mode; never from http", () => {
    const html = renderMail("login_code", { name: "A", code: "1" }, null, { publicUrl: "https://app.example.in/" }).html;
    assert.ok(html.includes('<img class="hms-logo-day" src="https://app.example.in/brand/mail-logo-day.png" alt="Easy Hotel Solutions" width="200"'));
    assert.ok(html.includes('<img class="hms-logo-night" src="https://app.example.in/brand/mail-logo-night.png"'));
    assert.ok(html.includes(".hms-logo-day{display:none !important;}"), "dark mode swaps the logos");
    assert.ok(!renderMail("login_code", { name: "A", code: "1" }, null, { publicUrl: "http://localhost:3000" }).html.includes("<img"), "no logo a mail program cannot reach");
    const hotel = renderMail("enquiry_confirmed", { name: "A", hotelName: "Hotel Sunrise" }, null, { publicUrl: "https://app.example.in" }).html;
    assert.ok(!hotel.includes("mail-logo") && hotel.includes(">Hotel Sunrise</span>"), "a hotel's mail never carries the platform's logo");
  });

  test("dark-safe colours, print colours, full-width phone button, monospace code, tabular numbers, 16 px text, 48 px button, the link again as text", () => {
    const campaign = renderMail("campaign", { name: "A", text: "Hello", unsubscribeUrl: UNSUB }, brand).html;
    assert.ok(!/<p style=/.test(campaign), "every paragraph, the footer's too, carries a class the dark rules can reach");
    assert.equal((campaign.match(/<p class="hms-muted"/g) ?? []).length >= 4, true, "name, contact, unsubscribe line and 'Sent with'");
    assert.ok(campaign.includes('<a class="hms-link" href="') && campaign.includes(".hms-link{color:#E3C766 !important;}"));
    assert.ok(campaign.includes('<img class="hms-logo-day" src="https://hms.example/logo.png"'), "the hotel's own logo");
    const reset = renderMail("reset_link", { name: "A", link: LINK, minutes: 15 }).html;
    assert.equal((reset.match(/-webkit-print-color-adjust:exact;print-color-adjust:exact;/g) ?? []).length, 1, "the button cell keeps its colour when printed");
    assert.ok(reset.includes('<a class="hms-btn" ') && reset.includes(".hms-btn{display:block !important;text-align:center !important;}") && reset.includes(".hms-btnwrap{width:100% !important;}"), "full width on phones");
    assert.ok(reset.includes("padding:14px 28px;") && reset.includes("font-size:16px;line-height:20px;font-weight:600;"), "a 48 px button");
    assert.ok(reset.includes(`Or copy this address into your browser: ${escapeHtml(LINK)}`));
    assert.ok(renderMail("login_code", { name: "A", code: "0O1l" }).html.includes("font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:32px"), "0/O and 1/l differ in the code");
    assert.ok(renderMail("account_locked", { name: "A", until: "10:30" }).html.includes("font-variant-numeric:tabular-nums"));
    assert.ok(reset.includes("font-size:16px;line-height:26px"), "16 px body text");
    assert.equal(MAIL_THEME.gold, "#C9A227");
  });

  test("the preheader is hidden and padded; a Hindi or Gujarati campaign says its language", () => {
    const html = renderMailHtml({ brand: { name: "H" }, preheader: "Arrive after 2:00 pm", blocks: [] });
    assert.ok(html.includes("Arrive after 2:00 pm&#847;&zwnj;&nbsp;") && html.includes("mso-hide:all"));
    assert.equal(langOf("दिवाली पर छूट"), "hi");
    assert.equal(langOf("દિવાળી ઓફર"), "gu");
    assert.equal(langOf("Diwali"), "en");
    assert.ok(renderMailHtml({ brand: { name: "H" }, blocks: [], lang: "hi" }).includes('<html lang="hi"'));
    assert.ok(renderMailHtml({ brand: { name: "H" }, blocks: [], lang: '"><x' }).includes('<html lang="en"'));
  });

  test("the text part is made from the same pieces and reads on its own", () => {
    const text = renderMailText({ brand: { name: "Hotel Sunrise", phone: "0141 1" }, greeting: "Hello A,", blocks: [{ kind: "code", text: "123456" }, { kind: "steps", items: ["One", "Two"] }, { kind: "quote", text: "a\nb" }], details: [{ label: "Room", value: "Deluxe" }], button: { label: "Pay now", url: LINK }, after: [{ kind: "note", text: "Note" }], unsubscribe: { why: "Why", url: UNSUB }, sentWith: true });
    assert.equal(text, `Hello A,\n\n    123456\n\n1. One\n2. Two\n\n> a\n> b\n\nRoom: Deluxe\n\nPay now:\n${LINK}\n\nNote\n\n--\nHotel Sunrise\n0141 1\n\nWhy\nTo stop these emails, open: ${UNSUB}\n\nSent with Easy Hotel Solutions`);
    assert.ok(!renderMailText({ brand: { name: "H" }, blocks: [], button: { label: "Go", url: "javascript:x" } }).includes("javascript"));
  });

  test("cachedBrandOf: read once a minute per hotel; a failure is 'none' and is not remembered", async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const of = cachedBrandOf(async () => {
      calls += 1;
      if (fail) throw new Error("down");
      return brand;
    }, 60_000, () => t);
    assert.equal(await of("h1"), brand);
    t = 59_000;
    await of("h1");
    assert.equal(calls, 1);
    t = 61_000;
    fail = true;
    assert.equal(await of("h1"), null);
    fail = false;
    assert.equal(await of("h1"), brand);
    assert.equal(calls, 3);
  });

  test("the layout escapes a brand and a details row too", () => {
    const html = renderMailHtml({ brand: { name: '"><b>x' }, blocks: [], details: [{ label: "<i>L", value: "a\n<b>" }] });
    assert.ok(!/<b>|<i>/.test(html));
    assert.ok(html.includes("a<br>&lt;b&gt;"), "line breaks kept");
  });
});

describe("sending", () => {
  test("the worker hands the HTML with the text to the sender, the hotel's brand read through brandOf; a failing brandOf never fails the mail", async () => {
    const auth = createMemoryAuth();
    const queue = (hotelId: string) => auth.unit.run((r) => r.outbox.enqueue({ userId: null, hotelId, kind: "enquiry_confirmed", toEmail: "g@example.com", template: "enquiry-confirmed", payload: JSON.stringify({ name: "Asha", hotelName: "Payload Hotel", reference: "R1" }) }, NOW));
    await queue("h1");
    await queue("h2");
    const sent: MailMessage[] = [];
    const asked: string[] = [];
    const n = await runOutboxOnce({
      unit: auth.unit,
      sender: { send: async (m) => void sent.push(m) },
      now: () => NOW,
      brandOf: async (id) => {
        asked.push(id);
        if (id === "h2") throw new Error("down");
        return { name: "Brand Hotel", phone: "0141 1" };
      },
    });
    assert.equal(n, 2);
    assert.deepEqual(asked.sort(), ["h1", "h2"]);
    const [a, b] = [sent.find((m) => m.hotelId === "h1")!, sent.find((m) => m.hotelId === "h2")!];
    assert.ok(a.html?.includes(">Brand Hotel</span>") && a.html.includes("0141 1"));
    assert.ok(b.html?.includes(">Payload Hotel</span>"), "no brand: the payload's hotel name");
    assert.match(a.text, /Payload Hotel has confirmed your booking\./);
  });

  test("smtp.ts passes the HTML in nodemailer's own `html` field next to the text (and none when there is none)", async () => {
    const got: Record<string, unknown>[] = [];
    const createTransport = (): SmtpTransport => ({ async sendMail(m) { got.push(m); return {}; } });
    const sender = createSmtpSender({ host: "smtp.example.com", port: 587, security: "starttls", from: "noreply@hotel.in" }, { createTransport });
    await sender.send({ to: "a@example.com", subject: "S", text: "T", html: "<p>H</p>" });
    await sender.send({ to: "a@example.com", subject: "S", text: "T" });
    assert.deepEqual([got[0].text, got[0].html], ["T", "<p>H</p>"]);
    assert.ok(!("html" in got[1]));
  });

  test("no code, password or link reaches any log while mail is made and sent, or fails", async () => {
    const auth = createMemoryAuth();
    const secrets = ["987654", "Tmp#Secret9", "https://hms.example/reset?t=SECRETTOKEN"];
    const payloads: [MailKind, MailPayload][] = [
      ["login_code", { name: "A", code: secrets[0] }],
      ["temp_password", { name: "A", username: "a", tempPassword: secrets[1] }],
      ["reset_link", { name: "A", link: secrets[2] }],
    ];
    for (const [kind, p] of payloads) await auth.unit.run((r) => r.outbox.enqueue({ userId: null, kind, toEmail: "a@example.com", template: kind.replace(/_/g, "-"), payload: JSON.stringify(p) }, NOW));
    const out: string[] = [];
    const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
    const grab = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    Object.assign(console, { log: grab, info: grab, warn: grab, error: grab, debug: grab });
    // stdout and stderr are RECORDED and still written: under `node --test` each file reports to the runner through its stdout, and a swallowed chunk breaks that stream
    // (the whole run then waits for a file that never ends)
    process.stdout.write = ((...a: Parameters<typeof process.stdout.write>) => (out.push(String(a[0])), keep.out(...a))) as typeof process.stdout.write;
    process.stderr.write = ((...a: Parameters<typeof process.stderr.write>) => (out.push(String(a[0])), keep.err(...a))) as typeof process.stderr.write;
    try {
      await runOutboxOnce({ unit: auth.unit, sender: { send: async () => { throw new Error(`refused ${secrets.join(" ")}`); } }, now: () => NOW });
      await runOutboxOnce({ unit: auth.unit, sender: { send: async () => undefined }, now: () => new Date(NOW.getTime() + 10 * 60_000) });
    } finally {
      Object.assign(console, { log: keep.log, info: keep.info, warn: keep.warn, error: keep.error, debug: keep.debug });
      process.stdout.write = keep.out;
      process.stderr.write = keep.err;
    }
    for (const s of secrets) assert.ok(!out.some((line) => line.includes(s)), "a secret was logged");
    for (const row of auth.data().outbox) assert.ok(!(row.lastError ?? "").includes("SECRET") && !(row.lastError ?? "").includes("987654"), "nor kept as the error");
  });
});
