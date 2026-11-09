// Unit tests for the Conversations mock (ui-shared/dashboards/conversations.mock.ts, decision 66): the sample the design and the dev previews run on keeps the
// server's rules: newest first, the seven tabs and their counts, the channel filter, the search, a WhatsApp reply's ticks, team-wide unread, a done thread
// reopened by a guest's message, Other, the closed 24-hour window, the platform hub kept apart, the dev switches, the access rules (A14) and the write verbs.
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { createConversationsMock, createPlatformMailboxMock } = await import("../../common/ui-shared/dashboards/conversations.mock");
const { CONV_TABS, inTab } = await import("../../common/ui-shared/dashboards/conversations");
const { WHATSAPP_NOT_CONNECTED, whatsappCopy } = await import("../../common/ui-shared/dashboards/whatsapp");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mock answers are asserted field by field
const data = async (p: Promise<{ ok: boolean }>): Promise<any> => {
  const r = (await p) as { ok: boolean; data?: unknown };
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};
const fresh = (scope: "hotel" | "platform" = "hotel") => createConversationsMock({ scope, latencyMs: 0, waDelays: { sent: 5, delivered: 10, read: 15 } });
const g = globalThis as Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete g.__convWhatsApp;
  delete g.__convMailbox;
  delete g.__convAccess;
});

describe("the Conversations mock keeps the server's list rules", () => {
  test("newest first, and each tab's count equals its own list (Done and Other included)", async () => {
    const api = fresh();
    const all = await data(api.list({ tab: "all", size: 100 }));
    const times = all.items.map((r: { lastAt: string }) => r.lastAt);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");
    for (const tab of CONV_TABS) {
      const page = await data(api.list({ tab, size: 100 }));
      assert.equal(page.total, all.counts[tab], `${tab}: count = list`);
      assert.equal(page.items.length, page.total, tab);
      for (const r of page.items) assert.ok(inTab(tab, { ...r, assignedTo: r.assignedTo?.id ?? null }, "u-me"), `${tab} holds ${r.id}`);
    }
    assert.ok(all.counts.done >= 1, "a done thread in the sample");
    assert.equal(all.counts.other, 2, "two newsletters under Other");
    assert.ok(all.counts.mine >= 1, "one assigned to the person signed in");
    assert.ok(!all.items.some((r: { box: string }) => r.box === "other"), "Other is kept out of All");
  });

  test("the channel filter and the search", async () => {
    const api = fresh();
    const wa = await data(api.list({ channel: "whatsapp", size: 100 }));
    assert.ok(wa.items.length > 0 && wa.items.every((r: { channels: string[] }) => r.channels.includes("whatsapp")));
    const mail = await data(api.list({ channel: "email", size: 100 }));
    assert.ok(mail.items.length > 0 && mail.items.every((r: { channels: string[] }) => r.channels.includes("email")));
    const both = mail.items.find((r: { id: string }) => r.id === "cv-kiran");
    assert.ok(both && wa.items.some((r: { id: string }) => r.id === "cv-kiran"), "one thread per person across both channels");
    const ravi = await data(api.list({ search: "ravi pickup" }));
    assert.deepEqual(ravi.items.map((r: { id: string }) => r.id), ["cv-ravi"], "several words must all match");
    assert.equal((await data(api.list({ search: "nobody-matches-this" }))).total, 0);
  });
});

describe("the WhatsApp shared desk (MJ, 5 Nov 2026)", () => {
  test("a WhatsApp list shows a chat marked done (old data) in All, and counts it", async () => {
    const api = fresh();
    await data(api.setStatus("cv-kiran", "done"));
    const wa = await data(api.list({ channel: "whatsapp", tab: "all", size: 100 }));
    assert.ok(wa.items.some((r: { id: string }) => r.id === "cv-kiran"), "still listed on WhatsApp");
    assert.equal(wa.counts.all, wa.total);
    const mail = await data(api.list({ channel: "email", tab: "all", size: 100 }));
    assert.ok(!mail.items.some((r: { id: string }) => r.id === "cv-kiran"), "Email keeps its done state");
  });

  test("the sample's chat marked done before the shared desk (Meera Iyer) is listed in All on WhatsApp", async () => {
    const wa = await data(fresh().list({ channel: "whatsapp", tab: "all", size: 100 }));
    assert.equal(wa.items.find((r: { id: string }) => r.id === "cv-meera")?.status, "done");
  });

  test("a chat of WhatsApp only is never assigned or marked done; an email conversation still is", async () => {
    const api = fresh();
    const rows = (await data(api.list({ channel: "whatsapp", size: 100 }))).items as { id: string; channels: string[] }[];
    const chat = rows.find((r) => r.channels.length === 1);
    assert.ok(chat, "a WhatsApp-only chat in the sample");
    for (const r of [await api.setAssignee(chat.id, "u-me"), await api.setStatus(chat.id, "done")]) {
      assert.equal(r.ok, false);
      if (!r.ok) assert.deepEqual([r.error.code, r.error.message], ["VALIDATION_FAILED", "WhatsApp chats are shared by the whole team; they are not assigned or closed."]);
    }
    assert.equal((await data(api.setStatus("cv-ravi", "done"))).status, "done");
    assert.equal((await data(api.bulk!([chat.id], "done"))).changed, 0, "bulk Done skips it too");
  });
});

describe("the Conversations mock's actions", () => {
  test("a WhatsApp reply goes pending, then sent, delivered and read; an email reply is sent with Re:", async () => {
    const api = fresh();
    const m = await data(api.sendReply("cv-kiran", { channel: "whatsapp", text: "See you on Monday." }));
    assert.equal(m.status, "pending");
    let t = await data(api.getThread("cv-kiran"));
    assert.equal(t.messages.at(-1).id, m.id, "appended at the end");
    await sleep(40);
    t = await data(api.getThread("cv-kiran"));
    assert.equal(t.messages.find((x: { id: string }) => x.id === m.id).status, "read");
    const e = await data(api.sendReply("cv-ravi", { channel: "email", text: "Pickup confirmed for 6 pm." }));
    assert.deepEqual([e.status, e.kind, e.subject.startsWith("Re: "), e.subject.startsWith("Re: Re:")], ["sent", "email", true, false]);
    assert.deepEqual(e.to, ["ravi.shah@shahexports.in"], "to the sender's From");
  });

  test("Reply-To is used only on purpose, and a bill goes only to the linked guest's own address", async () => {
    const api = fresh();
    const t = await data(api.getThread("cv-spoof"));
    assert.deepEqual(t.replyTo, { address: "accounts@shahexports-in.com", differsFrom: "payments.shahexports@protonmail.com" });
    const bad = await api.sendReply("cv-spoof", { channel: "email", text: "Hello", to: "someone@else.com" });
    assert.equal(bad.ok, false);
    const bill = await api.sendReply("cv-spoof", { channel: "email", text: "Bill", billId: "b-1042" });
    assert.equal(bill.ok, false, "not linked: no bill");
  });

  test("reading a thread lowers the team's unread count; marking it unread raises it again", async () => {
    const api = fresh();
    const before = (await data(api.getSummary())).unread;
    await data(api.markRead("cv-asha"));
    assert.equal((await data(api.getSummary())).unread, before - 1);
    await data(api.markUnread("cv-asha"));
    assert.equal((await data(api.getSummary())).unread, before);
  });

  test("a guest's new message reopens a done conversation and counts as unread", async () => {
    const api = fresh();
    await data(api.setStatus("cv-ravi", "done"));
    assert.ok((await data(api.list({ tab: "done", size: 100 }))).items.some((r: { id: string }) => r.id === "cv-ravi"));
    const was = (await data(api.getThread("cv-ravi"))).unread;
    api.simulateInbound("cv-ravi", { channel: "email", text: "One more question." });
    const t = await data(api.getThread("cv-ravi"));
    assert.deepEqual([t.status, t.unread], ["open", was + 1]);
  });

  test("moving to Other, always moving a sender there, and back", async () => {
    const api = fresh();
    await data(api.setBox("cv-pooja", "other"));
    assert.ok((await data(api.list({ tab: "other", size: 100 }))).items.some((r: { id: string }) => r.id === "cv-pooja"));
    assert.ok(!(await data(api.list({ tab: "all", size: 100 }))).items.some((r: { id: string }) => r.id === "cv-pooja"));
    const muted = await data(api.setMuted("cv-rahul", true));
    assert.deepEqual([muted.box, muted.contact.muted], ["other", true]);
    const back = await data(api.setBox("cv-rahul", "main"));
    assert.deepEqual([back.box, back.contact.muted], ["main", false]);
  });

  test("a closed WhatsApp window refuses free text (the screen keeps the draft) and takes an approved message", async () => {
    const api = fresh();
    const t = await data(api.getThread("cv-unknown"));
    assert.equal(t.window.open, false);
    const refused = await api.sendReply("cv-unknown", { channel: "whatsapp", text: "Yes, two rooms are free." });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? "" : refused.error.message, whatsappCopy.window.closed);
    const sent = await data(api.sendReply("cv-unknown", { channel: "whatsapp", templateId: "wt-followup", variables: ["Guest", "Hotel Sunrise", "rooms this weekend"] }));
    assert.deepEqual([sent.type, sent.template.text.includes("Hotel Sunrise")], ["template", true]);
    const pending = await api.sendReply("cv-unknown", { channel: "whatsapp", templateId: "wt-offer", variables: ["Hotel Sunrise"] });
    assert.equal(pending.ok, false, "a template still waiting for Meta is not offered");
  });

  test("the window is closing soon for Asha Rao (less than 2 hours left)", async () => {
    const t = await data(fresh().getThread("cv-asha"));
    assert.deepEqual([t.window.open, t.window.closingSoon], [true, true]);
  });
});

describe("hubs, switches and access", () => {
  test("the platform's hub is apart from the hotel's", async () => {
    const hotel = await data(fresh("hotel").list({ size: 100 }));
    const platform = await data(fresh("platform").list({ size: 100 }));
    const ids = new Set(hotel.items.map((r: { id: string }) => r.id));
    assert.ok(platform.items.length > 0);
    assert.ok(platform.items.every((r: { id: string }) => !ids.has(r.id)));
    const t = await data(fresh("platform").getThread("pv-lakeview"));
    assert.deepEqual(t.links.map((l: { kind: string }) => l.kind), ["hotel"]);
    assert.ok(t.access.canLink.every((k: string) => k === "user" || k === "hotel"));
  });

  test("__convWhatsApp = 'off' answers like the live site: not connected, and a WhatsApp reply is refused", async () => {
    g.__convWhatsApp = "off";
    const api = fresh();
    assert.deepEqual(await data(api.getWhatsAppSettings()), WHATSAPP_NOT_CONNECTED);
    const list = await data(api.list({}));
    assert.equal(list.whatsapp.connected, false);
    const t = await data(api.getThread("cv-kiran"));
    assert.equal(t.window, null);
    assert.equal(t.replyChannels.find((r: { channel: string }) => r.channel === "whatsapp").available, false);
    assert.equal((await api.sendReply("cv-kiran", { channel: "whatsapp", text: "Hi" })).ok, false);
  });

  test("__convMailbox = 'off' is a hotel that has not started: the setup state", async () => {
    g.__convMailbox = "off";
    const list = await data(fresh().list({}));
    assert.deepEqual([list.total, list.mailbox.state, list.whatsapp.connected], [0, "off", false]);
    g.__convMailbox = "needs_update";
    const s = await data(fresh().getSummary());
    assert.deepEqual([s.mailbox.state, s.mailbox.reason], ["not_available", "needs_update"]);
    g.__convMailbox = "error";
    assert.equal((await data(fresh().list({}))).mailbox.state, "error");
  });

  test("view only and a visit read but do not write; A14 leaves out the room and the bill without those rights", async () => {
    g.__convAccess = "view_only";
    const api = fresh();
    const t = await data(api.getThread("cv-asha"));
    assert.deepEqual([t.access.canEdit, t.access.readOnlyReason, t.access.canLink], [false, "view_only", []]);
    assert.equal((await api.addNote("cv-asha", "x")).ok, false);
    g.__convAccess = "visit";
    assert.equal((await data(api.getThread("cv-asha"))).access.readOnlyReason, "visit");
    assert.equal((await api.markRead("cv-asha")).ok, false, "a visit never marks read");
    delete g.__convAccess;
    api.setActor({ id: "u-ravi", name: "Ravi Kumar", role: "hotel_user", grants: { conversations: "edit", pms: "none", bills: "none", companies: "view" } });
    const limited = await data(api.getThread("cv-asha"));
    assert.deepEqual([limited.access.canSeeStay, limited.access.canSeeBills], [false, false]);
    assert.equal(limited.links[0].detail?.room, undefined);
    assert.equal(limited.links[0].detail?.billNo, undefined);
    assert.deepEqual(limited.access.canLink, ["customer", "company"]);
    assert.deepEqual((await data(api.listLinkCandidates(""))).map((x: { kind: string }) => x.kind).filter((k: string) => k === "stay" || k === "reservation"), []);
    assert.equal((await api.setLink("cv-asha", { kind: "stay", targetId: "st-204" })).ok, false);
  });

  test("the platform mailbox card: reading on and off, the IMAP server only for its own mail server, Test connection with fixed sentences", async () => {
    const box = createPlatformMailboxMock({ latencyMs: 0 });
    const card = await data(box.getMailbox());
    assert.deepEqual([card.provider, card.imapFixed, card.imapPort], ["gmail", true, 993]);
    assert.equal((await data(box.setMailbox({ reading: false }))).reading, false);
    const test1 = await data(box.startMailboxTest());
    assert.deepEqual([test1.imap.ok, test1.smtp.ok], [true, true]);
    g.__convProvider = "smtp";
    try {
      assert.equal((await box.setMailbox({ reading: true, imapHost: "localhost", imapPort: 993 })).ok, false);
      assert.equal((await box.setMailbox({ reading: true, imapHost: "mail.example.com", imapPort: 25 as 993 })).ok, false);
      assert.equal((await data(box.setMailbox({ reading: true, imapHost: "mail.example.com", imapPort: 143 }))).imapPort, 143);
    } finally {
      delete g.__convProvider;
    }
  });

  test("every write method's name starts with a write verb, so a visit's read-only view refuses it (lib/api/mode.ts)", () => {
    const src = readFileSync(new URL("../src/lib/api/mode.ts", import.meta.url), "utf8");
    const pattern = src.match(/const WRITE_METHOD =\s*\/(.+)\/;/)?.[1];
    assert.ok(pattern, "WRITE_METHOD found");
    const write = new RegExp(pattern);
    const writes = ["syncMail", "sendReply", "setAssignee", "setStatus", "setBox", "setMuted", "markRead", "markUnread", "addNote", "deleteNote", "setLink", "deleteLink", "setStarred", "setPinned", "setLabels", "sendNewEmail", "addEmailFile", "startWhatsAppChat", "bulk", "setMessageStarred", "setSnoozed", "setReaction", "addQuickReply", "updateQuickReply", "deleteQuickReply", "setWhatsAppAutomatic", "setMailbox", "startMailboxTest"];
    const reads = ["list", "getSummary", "getThread", "getEmailBody", "attachmentHref", "listLinkCandidates", "listStaff", "listQuickReplies", "getWhatsAppSettings", "getMailbox", "listWhatsAppHotels"];
    for (const n of writes) assert.ok(write.test(n), `${n} is a write`);
    for (const n of reads) assert.ok(!write.test(n), `${n} is a read`);
    const api = fresh();
    const box = createPlatformMailboxMock({ latencyMs: 0 });
    const names = [...Object.keys(api), ...Object.keys(box)].filter((n) => n !== "setActor" && n !== "simulateInbound");
    assert.deepEqual(names.filter((n) => !writes.includes(n) && !reads.includes(n)), [], "every method is listed above");
  });
});
