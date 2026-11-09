// Conversations, an email's HTML is shown only after the server's sanitiser (decision 66): no script, no event handler, no form, frame, object or media element, no style
// sheet; links only http(s), mailto and tel, opened in a new tab without the opener; remote pictures held back (and counted) until "Show images"; 1x1 tracking pixels always
// dropped; an inline picture of the email itself shown within a 2 MB budget; quoted history wrapped so the screen can fold it; a result over 1.5 MB is not sent.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEmailChannel } from "../../src/server/conversations/emailChannel";
import { splitQuotedText, previewOf } from "../../src/server/mail/mime";
import { HTML_OUT_MAX, sanitiseMailHtml } from "../../src/server/mail/sanitize";
import { createFakeImap, guestMail, MAILBOX } from "./helpers/conversations";

const clean = (html: string, showImages = false, inline: ReadonlyMap<string, string> = new Map()) => sanitiseMailHtml(html, { showImages, inline });

describe("dangerous markup", () => {
  test("scripts, handlers, forms, frames, objects, media, styles, base and meta are gone with their content; javascript: and data: links are gone", async () => {
    const r = await clean(`<p onclick="steal()">Hi <b onmouseover="x()">there</b></p><script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe>
      <form action="https://evil.example"><input name="pw"><button>Go</button></form><object data="x.swf"></object><embed src="x"><svg><script>alert(2)</script></svg><math></math>
      <video src="v.mp4"></video><audio src="a.mp3"></audio><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css">
      <a href="javascript:alert(3)">a</a><a href="data:text/html,<script>alert(4)</script>">b</a><a href="vbscript:x">c</a><a href="https://hotel.example/menu">menu</a><a href="mailto:desk@hotel.example">mail</a>`);
    for (const bad of ["onclick", "onmouseover", "<script", "alert(", "<style", "display:none", "<iframe", "<form", "<input", "<button", "<object", "<embed", "<svg", "<video", "<audio", "<base", "<meta", "<link", "javascript:", "data:text/html", "vbscript:"]) assert.ok(!r.html.includes(bad), bad);
    assert.match(r.html, /<a href="https:\/\/hotel\.example\/menu" target="_blank" rel="noopener noreferrer nofollow">menu<\/a>/);
    assert.match(r.html, /href="mailto:desk@hotel\.example"/);
  });

  test("style: a short list of properties only, never url(), expression(), @import or a backslash; no class or id", async () => {
    const r = await clean(`<p style="color: red; background-image: url(https://track.example/p.gif); width: expression(alert(1)); font-size: 14px" class="x" id="y">t</p><div style="behavior: url(x.htc)">u</div><span style="color: \\72 ed">v</span>`);
    assert.ok(r.html.includes("color:red"));
    assert.ok(r.html.includes("font-size:14px"));
    for (const bad of ["url(", "expression", "behavior", "class=", "id=", "\\72"]) assert.ok(!r.html.includes(bad), bad);
  });
});

describe("pictures", () => {
  test("remote pictures are held back and counted until 'Show images'; tracking pixels are always dropped; a data: picture the email brought itself is never shown", async () => {
    const html = `<img src="https://cdn.example/a.png" alt="a"><img src="http://cdn.example/b.png"><img src="https://track.example/p.gif" width="1" height="1"><img src="https://t.example/q.gif" style="display:none"><img src="data:image/png;base64,AAAA">`;
    const hidden = await clean(html);
    assert.equal(hidden.remoteImages, 2);
    assert.ok(!hidden.html.includes("<img"), hidden.html);
    const shown = await clean(html, true);
    assert.equal((shown.html.match(/<img/g) ?? []).length, 2);
    assert.ok(!shown.html.includes("track.example") && !shown.html.includes("t.example/q") && !shown.html.includes("data:image"));
  });

  test("inline (cid:) pictures within the budget: each at most 1 MB, 2 MB in all; the rest is counted as dropped (5 pictures of 900 KB give an answer under 3 MB)", async () => {
    const big = `data:image/png;base64,${Buffer.alloc(900 * 1024, 7).toString("base64")}`;
    const inline = new Map(Array.from({ length: 5 }, (_, i) => [`img${i}@mail`, big]));
    const r = await clean(Array.from({ length: 5 }, (_, i) => `<img src="cid:img${i}@mail">`).join(""), false, inline);
    assert.ok(Buffer.byteLength(r.html) < 3 * 1024 * 1024, `${Buffer.byteLength(r.html)} bytes`);
    assert.equal((r.html.match(/<img/g) ?? []).length + r.droppedInline, 5);
    assert.ok(r.droppedInline >= 3);
    const unknown = await clean(`<img src="cid:nope@mail"><img src="cid:svg@mail">`, false, new Map([["svg@mail", "data:image/svg+xml;base64,PHN2Zz4="]]));
    assert.deepEqual([unknown.droppedInline, unknown.html.includes("<img")], [2, false]);
  });
});

describe("quoted history", () => {
  test("Gmail, Apple Mail, Yahoo and Outlook history is wrapped in data-hms-quote (and nothing else may set it); plain text splits off its quoted part", async () => {
    const r = await clean(`<p>Yes, that works.</p><div class="gmail_quote">On Mon, Asha wrote:<blockquote>old</blockquote></div><blockquote type="cite">older</blockquote><div class="yahoo_quoted">y</div>`);
    assert.equal(r.hasQuoted, true);
    assert.equal((r.html.match(/data-hms-quote="1"/g) ?? []).length, 3);
    const outlook = await clean(`<html><body><p>Thanks</p><div id="divRplyFwdMsg"><b>From:</b> Asha</div><div>old text</div></body></html>`);
    assert.equal(outlook.hasQuoted, true);
    assert.match(outlook.html, /^<p>Thanks<\/p><div data-hms-quote="1">/);
    assert.equal((await clean(`<div data-hms-quote="1" class="plain">mine</div>`)).html.includes("data-hms-quote"), false, "an email cannot mark itself");
    const split = splitQuotedText("Sure, see you then.\n\nOn Mon, 20 Oct 2026, Asha Rao <asha@guest.in> wrote:\n> Can we come early?\n> Thanks");
    assert.deepEqual([split.main, split.quoted.startsWith("On Mon")], ["Sure, see you then.", true]);
    assert.equal(splitQuotedText("Hi\n-----Original Message-----\nFrom: x").main, "Hi");
    assert.equal(await previewOf(guestMail({ from: "a@b.in", text: "New line\n\nOn Tue, Bob wrote:\n> old" })), "New line");
  });
});

describe("too large to open here", () => {
  test("a sanitised HTML over 1.5 MB is not sent: the answer says too large (the mailbox has it)", async () => {
    const imap = createFakeImap();
    const html = `<p>${"x".repeat(1_700_000)}</p>`;
    imap.deliver("inbox", guestMail({ from: "asha@guest.in", messageId: "<big@guest.in>", html }), new Date("2026-10-24T09:00:00Z"));
    const channel = createEmailChannel({ imap: imap.factory, now: () => new Date("2026-10-24T10:00:00Z") });
    const cfg = { address: MAILBOX, gmail: true, smtp: { host: "smtp.gmail.com", port: 587, security: "starttls" as const, from: MAILBOX }, imap: { host: "imap.gmail.com", port: 993 as const, user: MAILBOX, pass: "p" } };
    const body = await channel.openBody(cfg, { mailbox: MAILBOX, folder: "inbox", uid: 1, uidValidity: imap.inbox.uidValidity, messageId: "<big@guest.in>", from: "asha@guest.in", sentAt: new Date("2026-10-24T09:00:00Z") }, { canSeeBills: false, showImages: false });
    assert.ok(body.tooLarge && body.tooLarge.size > HTML_OUT_MAX);
    assert.equal(body.html, null);
  });
});
