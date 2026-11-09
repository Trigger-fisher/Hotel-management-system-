// Conversations, the PLATFORM's hub (decision 66, A5): the platform mailbox's mail for Super Admin and Platform Admin alike (never an API key, never a hotel account), kept
// apart from every hotel's; the platform's own mail (reset codes, invitations) never listed; a verified sender linked to a platform account; the mailbox card (reading
// switch, IMAP server: a public name, port 993 or 143) and its Test connection in fixed sentences; "needs update" before platform 0139; the desks sales@ and support@ (labelled on arrival, answered from the desk).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DESK_LABELS, deskOf, type DeskLabel } from "@shared/dashboards/conversations";
import type { VerifiedSession } from "../../src/server/auth/session";
import { AppError } from "../../src/server/errors";
import { ConversationsNotReady } from "../../src/server/repos/conversations";
import { createMemoryPlatformConversations } from "../../src/server/repos/memory/conversations";
import { createPlatformConversationsService, type PlatformGatePort } from "../../src/server/services/conversations/platformConversationsService";
import { createInboundMailService } from "../../src/server/services/mail/inboundService";
import { createFakeImap, createFakeSmtp, guestMail, hotelWorld, PUBLIC_LOOKUP, rawMail, STAFF } from "./helpers/conversations";
import { makeSession } from "./helpers/session";

const PLATFORM_BOX = "hello@easyhotel.example";
const superAdmin = makeSession({ userId: STAFF.admin, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
const platformAdmin = makeSession({ userId: STAFF.neha, hotelId: "", accountRole: "platform_admin", roleKey: "platform_admin", roleLevel: 4 });
const hotelAdmin = makeSession({ userId: STAFF.viewer, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const keyed: VerifiedSession = { ...superAdmin, client: "token", token: { id: "k", name: "Key", level: "full", scope: "platform", testMode: false, callsPerMinute: 60, ip: null, newIp: false } };
const META = { traceId: "trace-1", ip: null, userAgent: null };
const forbidden = (e: unknown) => (e as { code?: string }).code === "FORBIDDEN";

function platformWorld(o: { provider?: "gmail" | "smtp" | "ses"; notReady?: boolean; box?: string; deskDomain?: string | null } = {}) {
  const box = o.box ?? PLATFORM_BOX;
  const memory = createMemoryPlatformConversations();
  const imap = createFakeImap();
  const smtp = createFakeSmtp({ fileInto: imap });
  const audits: string[] = [];
  const gate: PlatformGatePort = {
    read(session) {
      if (session.accountRole !== "super_admin" && session.accountRole !== "platform_admin") throw new AppError("FORBIDDEN");
    },
    async write(session) {
      if (session.accountRole !== "super_admin" && session.accountRole !== "platform_admin") throw new AppError("FORBIDDEN");
    },
    superRead(session) {
      if (session.accountRole !== "super_admin") throw new AppError("FORBIDDEN");
    },
    async superWrite(session) {
      if (session.accountRole !== "super_admin") throw new AppError("FORBIDDEN");
    },
    async audit(_session, _meta, reason) {
      audits.push(reason);
    },
  };
  const provider = o.provider ?? "gmail";
  const host = provider === "gmail" ? "smtp.gmail.com" : provider === "ses" ? "email-smtp.ap-south-1.amazonaws.com" : "smtp.easyhotel.example";
  const clock = { now: new Date("2026-10-24T10:00:00Z") };
  const unit = o.notReady ? { run: async () => Promise.reject(new ConversationsNotReady()) } : memory.unit;
  const service = createPlatformConversationsService({
    unit: unit as typeof memory.unit,
    gate,
    people: { get: async () => new Map() },
    now: () => clock.now,
    imap: imap.factory,
    createTransport: smtp.factory,
    lookup: PUBLIC_LOOKUP,
    sleep: async () => undefined,
    smtp: async () => ({ config: { host, port: 587, security: "starttls", user: provider === "gmail" ? box : "AKIA", pass: "platform-app-password", from: `EasyHotelSolutions <${box}>` }, passwordUnreadable: false }),
    staff: async () => [{ id: STAFF.admin, name: "Sonal Super" }, { id: STAFF.neha, name: "Neha Platform" }],
    ...(o.deskDomain !== undefined ? { deskDomain: async () => o.deskDomain ?? null } : {}),
  });
  return { memory, imap, smtp, audits, service, clock };
}

describe("who may open the platform hub", () => {
  test("the platform's shared inbox is the Platform Admin's; the Super Admin has only their own mailbox (MJ, 5 Nov 2026), keeps the WhatsApp chats; never a hotel account, never an API key", async () => {
    const w = platformWorld();
    const q = { tab: "all", channel: "all", page: 1, size: 25 } as const;
    assert.equal((await w.service.list(platformAdmin, q)).total, 0);
    for (const channel of ["all", "email"] as const) await assert.rejects(w.service.list(superAdmin, { ...q, channel }), forbidden);
    await assert.rejects(w.service.sync(superAdmin, {}), forbidden);
    await assert.rejects(w.service.sentMail(superAdmin, { page: 1, size: 25 } as never), forbidden);
    assert.equal((await w.service.list(superAdmin, { ...q, channel: "whatsapp" })).total, 0);
    await assert.rejects(w.service.list(hotelAdmin, q), forbidden);
    await assert.rejects(w.service.list(keyed, q), forbidden);
    await assert.rejects(w.service.setMailbox(keyed, { reading: true }, META), forbidden);
  });

  test("the mailbox set-up and its test are the Super Admin's only (MJ, 5 Nov 2026)", async () => {
    const w = platformWorld();
    await assert.rejects(w.service.mailbox(platformAdmin), forbidden);
    await assert.rejects(w.service.setMailbox(platformAdmin, { reading: true }, META), forbidden);
    await assert.rejects(w.service.startMailboxTest(platformAdmin, META), forbidden);
    await assert.rejects(w.service.whatsappHotels(platformAdmin), forbidden);
    await assert.rejects(w.service.mailbox(hotelAdmin), forbidden);
    assert.equal((await w.service.mailbox(superAdmin)).reading, false);
  });
});

describe("the platform mailbox", () => {
  test("reading on (Gmail: the IMAP server is fixed); the platform's own mail is never listed; a verified owner is linked to their account; replies go out and are audited in fixed words", async () => {
    const w = platformWorld();
    const card = await w.service.mailbox(superAdmin);
    assert.deepEqual([card.reading, card.canRead, card.provider, card.imapFixed, card.imapHost, card.address, card.state.state], [false, true, "gmail", true, "imap.gmail.com", PLATFORM_BOX, "off"]);
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.memory.data().users.push({ id: STAFF.viewer, name: "Ravi Owner", email: "owner@sunrise.in" });
    w.imap.deliver("sent", rawMail({ from: PLATFORM_BOX, to: ["owner@sunrise.in"], subject: "Your sign-in code", date: w.clock.now, text: "Code 551199", headers: { "X-HMS-Kind": "login_code" } }), w.clock.now);
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: [PLATFORM_BOX], subject: "Invoice question" }), new Date("2026-10-24T09:59:00Z"));
    // a person's own answer to a reset-link mail quotes the live link: never listed on the platform mailbox
    const HMS = "<hms.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b@mail.hms>";
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: [PLATFORM_BOX], subject: "Re: Reset your password", inReplyTo: HMS, references: [HMS], text: "I didn't ask for this.\n\n> https://hms.example/?reset=tok-77aa" }), new Date("2026-10-24T09:59:30Z"));
    const r = await w.service.sync(platformAdmin, {});
    assert.deepEqual([r.checked, r.added], [true, 1]);
    assert.ok(!JSON.stringify(w.memory.data()).includes("551199"));
    assert.ok(!JSON.stringify(w.memory.data()).includes("tok-77aa") && !JSON.stringify(w.memory.data()).includes("Reset your password"), "the answer to a reset link is not listed");
    assert.deepEqual(w.memory.data().convContacts[0].link, { kind: "user", id: STAFF.viewer, source: "auto" });
    const conv = w.memory.data().convConversations[0];
    await w.service.reply(platformAdmin, conv.id, { channel: "email", text: "We will check." }, META);
    assert.deepEqual(w.smtp.sent[0].envelope, { from: PLATFORM_BOX, to: ["owner@sunrise.in"] });
    await w.service.addNote(platformAdmin, conv.id, "Owner of Sunrise", META);
    assert.deepEqual(w.audits, ["Conversations mailbox settings saved", "Reply sent", "Note added"]);
  });

  test("another mail server: the IMAP server must be a public name and the port 993 or 143; a service that only sends cannot read", async () => {
    const w = platformWorld({ provider: "smtp" });
    const fields = async (input: { reading: boolean; imapHost?: string; imapPort?: number }) => (await w.service.setMailbox(superAdmin, input, META).then(() => null, (e: unknown) => e as AppError))?.details;
    assert.deepEqual(Object.keys((await fields({ reading: true, imapHost: "localhost" }))?.fields ?? {}), ["imapHost"]);
    assert.deepEqual(Object.keys((await fields({ reading: true, imapHost: "169.254.169.254" }))?.fields ?? {}), ["imapHost"]);
    assert.deepEqual(Object.keys((await fields({ reading: true, imapHost: "imap.easyhotel.example", imapPort: 25 }))?.fields ?? {}), ["imapPort"]);
    assert.deepEqual(Object.keys((await fields({ reading: true }))?.fields ?? {}), ["imapHost"]);
    const saved = await w.service.setMailbox(superAdmin, { reading: true, imapHost: "IMAP.EasyHotel.example", imapPort: 143 }, META);
    assert.deepEqual([saved.reading, saved.imapHost, saved.imapPort, saved.imapFixed], [true, "imap.easyhotel.example", 143, false]);
    const ses = platformWorld({ provider: "ses" });
    await assert.rejects(ses.service.setMailbox(superAdmin, { reading: true }, META), (e: unknown) => (e as AppError).code === "CONFLICT");
  });

  test("Test connection: fixed sentences only (no password, login or server words), nothing kept", async () => {
    const w = platformWorld();
    w.imap.failConnect(Object.assign(new Error("[ALERT] Application-specific password required: hello@easyhotel.example platform-app-password"), { responseText: "[ALERT] Application-specific password required" }));
    const r = await w.service.startMailboxTest(superAdmin, META);
    assert.deepEqual([r.imap.ok, r.imap.code, r.smtp.ok], [false, "APP_PASSWORD_BLOCKED", true]);
    const text = JSON.stringify(r);
    for (const s of ["platform-app-password", "hello@easyhotel.example", "Application-specific password required"]) assert.ok(!text.includes(s), s);
    assert.equal((await w.service.mailbox(superAdmin)).lastTest, null);
  });

  test("kept apart from the hotels: a hotel's thread never shows here and the platform's never in a hotel; before platform 0139 the summary says 'needs update'", async () => {
    const hotel = hotelWorld();
    hotel.imap.deliver("inbox", guestMail({ from: "guest@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await hotel.service.sync(makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }), {});
    const w = platformWorld();
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: [PLATFORM_BOX] }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(platformAdmin, {});
    const handles = (await w.service.list(platformAdmin, { tab: "all", channel: "all", page: 1, size: 25 })).items.map((i) => i.handle);
    assert.deepEqual(handles, ["owner@sunrise.in"]);
    assert.ok(!JSON.stringify(hotel.data().convHandles).includes("owner@sunrise.in"));
    const late = platformWorld({ notReady: true });
    const s = await late.service.summary(superAdmin);
    assert.deepEqual([s.mailbox.state, s.mailbox.reason], ["not_available", "needs_update"]);
    assert.equal(await late.service.readingLine(), null);
  });
});

describe("the desks sales@ and support@ (Google aliases of the platform mailbox)", () => {
  const Q = { tab: "all", channel: "all", page: 1, size: 25 } as const;
  const handlesOf = async (w: ReturnType<typeof platformWorld>, label: string) => (await w.service.list(platformAdmin, { ...Q, label })).items.map((i) => i.handle).sort();

  test("a mail check labels mail to sales@ Sales and to support@ Support (the sending domain and the mailbox's own); other mail gets none", async () => {
    const w = platformWorld({ deskDomain: "EasyHotelSolutions.in" });
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.imap.deliver("inbox", guestMail({ from: "lead@kochiinn.com", to: ["Sales@easyhotelsolutions.in"], subject: "Pricing" }), new Date("2026-10-24T09:50:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: ["someone@else.in"], cc: ["support@easyhotelsolutions.in"], subject: "Login trouble" }), new Date("2026-10-24T09:51:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "anita@lakeview.in", to: ["support@easyhotel.example"], subject: "GST report" }), new Date("2026-10-24T09:52:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "friend@other.in", to: [PLATFORM_BOX], subject: "Hello" }), new Date("2026-10-24T09:53:00Z"));
    const r = await w.service.sync(platformAdmin, {});
    assert.deepEqual([r.checked, r.added], [true, 4]);
    assert.deepEqual(await handlesOf(w, "Sales"), ["lead@kochiinn.com"]);
    assert.deepEqual(await handlesOf(w, "Support"), ["anita@lakeview.in", "owner@sunrise.in"]);
    const plain = w.memory.data().convConversations.filter((c) => (c.labels ?? []).length === 0);
    assert.equal(plain.length, 1, "the mailbox's own address is no desk");
  });

  test("a mailbox on a public service (gmail.com) never makes desks of gmail.com", async () => {
    const w = platformWorld({ box: "easyhotel.desk@gmail.com", deskDomain: null });
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.imap.deliver("inbox", guestMail({ from: "lead@kochiinn.com", to: ["sales@gmail.com", "easyhotel.desk@gmail.com"], subject: "Pricing" }), new Date("2026-10-24T09:50:00Z"));
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: ["support@gmail.com"], subject: "Help" }), new Date("2026-10-24T09:51:00Z"));
    assert.equal((await w.service.sync(platformAdmin, {})).added, 2);
    assert.ok(w.memory.data().convConversations.every((c) => (c.labels ?? []).length === 0));
  });

  test("a reply in a Sales conversation goes out from sales@ under the platform's name, and is recorded from it", async () => {
    const w = platformWorld({ deskDomain: "easyhotelsolutions.in" });
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.imap.deliver("inbox", guestMail({ from: "lead@kochiinn.com", to: ["sales@easyhotelsolutions.in"], subject: "Pricing" }), new Date("2026-10-24T09:50:00Z"));
    await w.service.sync(platformAdmin, {});
    const conv = w.memory.data().convConversations[0];
    assert.deepEqual(conv.labels, ["Sales"]);
    await w.service.reply(platformAdmin, conv.id, { channel: "email", text: "Our plans start at..." }, META);
    const raw = w.smtp.sent[0].raw.toString("utf8");
    assert.match(raw, /^From: "?EasyHotelSolutions Sales"? <sales@easyhotelsolutions\.in>/m);
    assert.deepEqual(w.smtp.sent[0].envelope.to, ["lead@kochiinn.com"]);
    const out = w.memory.data().convMessages.find((m) => m.direction === "out");
    assert.equal(out?.fromAddr, "sales@easyhotelsolutions.in");
    // the next check reads the Sent copy: still one reply, never a second row
    w.clock.now = new Date("2026-10-24T10:10:00Z");
    await w.service.syncForWorker({ budgetMs: 10_000 });
    assert.equal(w.memory.data().convMessages.filter((m) => m.direction === "out").length, 1);
  });

  test("labels can be changed on the platform (audited); stars and snooze stay the hotels'", async () => {
    const w = platformWorld();
    await w.service.setMailbox(superAdmin, { reading: true }, META);
    w.imap.deliver("inbox", guestMail({ from: "owner@sunrise.in", to: [PLATFORM_BOX] }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(platformAdmin, {});
    const id = w.memory.data().convConversations[0].id;
    const t = await w.service.patch(platformAdmin, id, { labels: ["Support", "Support", "Billing"] }, META);
    assert.deepEqual(t.labels, ["Support", "Billing"]);
    assert.deepEqual(await handlesOf(w, "Support"), ["owner@sunrise.in"]);
    assert.deepEqual(w.audits, ["Conversations mailbox settings saved", "Labels changed"]);
    const refused = (e: unknown) => (e as AppError).code === "VALIDATION_FAILED";
    await assert.rejects(w.service.patch(platformAdmin, id, { starred: true } as never, META), refused);
    await assert.rejects(w.service.patch(platformAdmin, id, { snoozedUntil: "2026-10-25T09:00:00Z" } as never, META), refused);
    await assert.rejects(w.service.patch(keyed, id, { labels: ["Sales"] }, META), forbidden);
  });
});

describe("the desks through Amazon SES receiving (the domain's MX is SES: no mailbox reads this mail)", () => {
  const DOMAIN = "easyhotelsolutions.in";
  const desksMap: Record<string, DeskLabel> = Object.fromEntries(DESK_LABELS.map((l) => [`${l.toLowerCase()}@${DOMAIN}`, l]));
  const sesNotice = (to: string, o: { messageId: string; subject: string; from?: string }) => ({
    notificationType: "Received",
    mail: { timestamp: "2026-10-24T09:59:30.000Z", messageId: `ses${o.messageId.replace(/\W/g, "")}`, destination: [to] },
    receipt: { recipients: [to], spamVerdict: { status: "PASS" }, virusVerdict: { status: "PASS" }, spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" } },
    content: [`From: Priya Menon <${o.from ?? "priya@kochiinn.com"}>`, `To: ${to}`, `Subject: ${o.subject}`, `Message-ID: ${o.messageId}`, "Date: Sat, 24 Oct 2026 09:59:00 +0000", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", "We run a 24-room hotel in Kochi. What does HMS cost?"].join("\r\n"),
  });
  const world = () => {
    // reading is off: the platform has no mailbox HMS reads; replies go out through the platform's own mail (Amazon SES)
    const w = platformWorld({ provider: "ses", box: `support@${DOMAIN}`, deskDomain: DOMAIN });
    const inbound = createInboundMailService({
      ports: {
        hotelsOf: async () => [],
        deliver: async () => ({ added: 0 }),
        deskOf: async (r) => deskOf(r, desksMap),
        deliverPlatform: (entries, sources, desk) => w.service.receiveForWorker(entries, sources, desk),
      },
      now: () => w.clock.now,
    });
    return { ...w, inbound };
  };
  const Q = { tab: "all", channel: "all", page: 1, size: 25 } as const;

  test("sales@ lands in the platform inbox labelled Sales, support@ labelled Support, info@ is still dropped; a repeat adds nothing", async () => {
    const w = world();
    assert.deepEqual([(await w.inbound.receive(sesNotice(`sales@${DOMAIN}`, { messageId: "<lead1@kochiinn.com>", subject: "Pricing" }))).platform, w.memory.data().convConversations.length], [1, 1]);
    await w.inbound.receive(sesNotice(`Support@${DOMAIN}`, { messageId: "<help1@sunrise.in>", subject: "Login trouble", from: "owner@sunrise.in" }));
    const info = await w.inbound.receive(sesNotice(`info@${DOMAIN}`, { messageId: "<x1@other.in>", subject: "Hello", from: "x@other.in" }));
    assert.deepEqual([info.platform, info.noHotel], [0, true]);
    assert.equal((await w.inbound.receive(sesNotice(`sales@${DOMAIN}`, { messageId: "<lead1@kochiinn.com>", subject: "Pricing" }))).added, 0, "SNS sends at least once");
    assert.deepEqual((await w.service.list(platformAdmin, { ...Q, label: "Sales" })).items.map((i) => i.handle), ["priya@kochiinn.com"]);
    assert.deepEqual((await w.service.list(platformAdmin, { ...Q, label: "Support" })).items.map((i) => i.handle), ["owner@sunrise.in"]);
    assert.equal(w.memory.data().convConversations.length, 2);
    assert.equal(w.imap.stats.opened, 0, "no mailbox was opened");
  });

  test("the body opens from the stored email with no mailbox; the reply goes out through SMTP From the desk and is kept whole", async () => {
    const w = world();
    await w.inbound.receive(sesNotice(`sales@${DOMAIN}`, { messageId: "<lead2@kochiinn.com>", subject: "Pricing" }));
    const conv = w.memory.data().convConversations[0];
    const thread = await w.service.thread(platformAdmin, conv.id);
    assert.deepEqual(thread.labels, ["Sales"]);
    assert.deepEqual(thread.replyChannels.find((r) => r.channel === "email"), { channel: "email", available: true }, "a reply can be written with no mailbox");
    const body = await w.service.emailBody(platformAdmin, conv.id, thread.messages[0].id, { images: false });
    assert.match(JSON.stringify(body), /24-room hotel in Kochi/);
    const sa = makeSession({ userId: STAFF.admin, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
    await assert.rejects(w.service.thread(sa, conv.id), (e: unknown) => (e as AppError).code === "NOT_FOUND", "the Super Admin never opens the platform's shared mail");
    await assert.rejects(w.service.emailBody(sa, conv.id, thread.messages[0].id, { images: false }), (e: unknown) => (e as AppError).code === "FORBIDDEN");
    await assert.rejects(w.service.reply(sa, conv.id, { channel: "email", text: "x" }, META), (e: unknown) => (e as AppError).code === "FORBIDDEN");
    await w.service.reply(platformAdmin, conv.id, { channel: "email", text: "Our plans start at..." }, META);
    assert.equal(w.smtp.sent.length, 1);
    const raw = w.smtp.sent[0].raw.toString("utf8");
    assert.match(raw, /^From: "?EasyHotelSolutions Sales"? <sales@easyhotelsolutions\.in>/m);
    assert.match(raw, /^In-Reply-To: <lead2@kochiinn\.com>/m);
    assert.deepEqual(w.smtp.sent[0].envelope.to, ["priya@kochiinn.com"]);
    const out = w.memory.data().convMessages.find((m) => m.direction === "out");
    assert.equal(out?.fromAddr, `sales@${DOMAIN}`);
    assert.ok((w.memory.data().convMailSources ?? []).some((s) => s.messageId === out?.id), "the reply is kept whole (no Sent folder holds it)");
    assert.deepEqual(w.audits, ["Reply sent"]);
    assert.equal(w.imap.stats.opened, 0, "no mailbox was opened");
  });
});
