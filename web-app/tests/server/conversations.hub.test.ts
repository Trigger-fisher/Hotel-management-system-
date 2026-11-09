// Conversations, the hub's rules (decision 66) on the in-memory repository (the reference the PostgreSQL one follows, tests/db/conversations.db.test.ts): one thread per
// person across channels, newest first, the seven tabs and their counts (Done and Other included), the channel filter and search, read/unread, the unread count counting only
// rows really added, the newest message deciding last_* (an older one never moves them back), a guest's message reopening a done thread, bulk/muted to Other and a linked
// sender back to the main list, assignment, notes, quick replies, the 12-month purge, and the WhatsApp 24-hour window.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONV_TABS, inTab } from "@shared/dashboards/conversations";
import { windowOf } from "@shared/dashboards/whatsapp";
import type { InboundEntry } from "../../src/server/conversations/channel";
import type { LinkMatcher } from "../../src/server/repos/conversations";
import { bindConversations, emptyConversationsData } from "../../src/server/repos/memory/conversations";
import { RepoError } from "../../src/server/repos/types";

const T0 = new Date("2026-10-24T08:00:00Z");
const at = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const ME = "00000000-0000-4000-8000-0000000000a1";
const NOBODY: LinkMatcher = { byEmail: async () => null, byPhone: async () => null, search: async () => [], details: async () => null, exists: async () => null };
const GUEST: LinkMatcher = { ...NOBODY, byEmail: async (e) => (e === "known@guest.in" ? { kind: "customer", id: "00000000-0000-4000-8000-00000000c001", label: "Known Guest" } : null) };

let n = 0;
function email(o: Partial<InboundEntry> & { person: string }): InboundEntry {
  n += 1;
  const out = o.direction === "out";
  return {
    channel: "email", direction: "in", externalId: `<e${n}@x.in>`, fallbackId: `uid:inbox:1:${n}`, sentAt: at(n), personName: null, from: out ? "desk@gmail.com" : o.person, replyTo: null, to: out ? [o.person] : ["desk@gmail.com"], cc: [], subject: `Subject ${n}`,
    preview: `preview ${n}`, hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: out ? "mailbox" : "contact", status: out ? "sent" : "received",
    mail: { folder: out ? "sent" : "inbox", uid: n, uidValidity: 1, mailbox: "desk@gmail.com" }, ...o,
  };
}
const whatsapp = (o: Partial<InboundEntry> & { person: string }): InboundEntry => ({ ...email(o), channel: "whatsapp", externalId: `wamid.${n}`, fallbackId: undefined, mail: undefined, subject: null, whatsapp: { type: "text", text: "hi", sentFrom: "contact", status: "received" } });

function hub() {
  const data = emptyConversationsData();
  return { data, repo: bindConversations(data) };
}

describe("threads, tabs and the list", () => {
  test("one thread per person across email and WhatsApp; newest first; the tab rules and counts (Done and Other included); the channel filter; search", async () => {
    const { repo, data } = hub();
    await repo.ingest([email({ person: "asha@guest.in", sentAt: at(1) }), email({ person: "ravi@guest.in", sentAt: at(5), subject: "Airport pickup" }), email({ person: "news@offers.in", sentAt: at(3), box: "other" })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    // the same person on WhatsApp joins Asha's thread (her contact gets the number by hand here; the Meta adapter will match it)
    const asha = data.convContacts.find((c) => data.convHandles.some((h) => h.contactId === c.id && h.value === "asha@guest.in"))!;
    data.convHandles.push({ id: "h-wa", contactId: asha.id, kind: "phone", value: "919825012345" });
    await repo.ingest([whatsapp({ person: "+91 98250 12345", sentAt: at(10) })], { mailbox: null }, NOBODY, T0);
    assert.equal(data.convConversations.length, 3);
    const list = await repo.list({ tab: "all", channel: "all", me: ME, page: 1, pageSize: 25 });
    assert.deepEqual(list.rows.map((r) => r.contact.handles[0].value), ["asha@guest.in", "ravi@guest.in"], "newest first; Other is not in All");
    assert.deepEqual(list.rows[0].channels, ["email", "whatsapp"]);
    await repo.setStatus(list.rows[1].id, "done");
    await repo.setAssignee(list.rows[0].id, ME, ME, T0);
    const counts = await repo.counts({ channel: "all", me: ME });
    assert.deepEqual(counts, { all: 1, unread: 2, mine: 1, unassigned: 0, waiting: 1, done: 1, other: 1 });
    for (const tab of CONV_TABS) assert.equal((await repo.list({ tab, channel: "all", me: ME, page: 1, pageSize: 25 })).total, counts[tab], tab);
    assert.equal((await repo.list({ tab: "all", channel: "whatsapp", me: ME, page: 1, pageSize: 25 })).total, 1);
    assert.equal((await repo.list({ tab: "done", channel: "all", me: ME, words: ["airport"], page: 1, pageSize: 25 })).total, 1, "search reads the subjects too");
    assert.equal((await repo.list({ tab: "done", channel: "all", me: ME, words: ["nothing-like-this"], page: 1, pageSize: 25 })).total, 0);
    assert.equal(inTab("waiting", { box: "main", status: "open", unread: 0, assignedTo: null, lastDirection: "out" }, ME), false);
  });

  test("unread counts only rows really added: the same batch again changes nothing; read and unread are shared; the badge counts the main list only", async () => {
    const { repo, data } = hub();
    const batch = [email({ person: "asha@guest.in" }), email({ person: "asha@guest.in" }), email({ person: "news@offers.in", box: "other" })];
    assert.equal((await repo.ingest(batch, { mailbox: "desk@gmail.com" }, NOBODY, T0)).added, 3);
    assert.equal((await repo.ingest(batch, { mailbox: "desk@gmail.com" }, NOBODY, T0)).added, 0);
    const asha = data.convConversations.find((c) => c.box === "main")!;
    assert.equal(asha.unreadCount, 2);
    assert.equal(await repo.unreadTotal(), 1);
    await repo.markRead(asha.id);
    assert.equal((await repo.get(asha.id))?.unreadCount, 0);
    await repo.markUnread(asha.id);
    assert.equal((await repo.get(asha.id))?.unreadCount, 1);
  });

  test("an older message found later never moves last_message_at back or changes last_direction; a guest's new message reopens a done thread", async () => {
    const { repo, data } = hub();
    await repo.ingest([email({ person: "asha@guest.in", sentAt: at(30) })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    const c = data.convConversations[0];
    await repo.ingest([email({ person: "asha@guest.in", direction: "out", sentAt: at(10) })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    assert.deepEqual([c.lastMessageAt.toISOString(), c.lastDirection], [at(30).toISOString(), "in"]);
    await repo.setStatus(c.id, "done");
    await repo.ingest([email({ person: "asha@guest.in", sentAt: at(40) })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    assert.deepEqual([c.status, c.lastMessageAt.toISOString(), c.lastInboundAt?.toISOString()], ["open", at(40).toISOString(), at(40).toISOString()]);
  });

  test("bulk mail goes to Other; a muted sender stays in Other; a sender linked to a guest comes back to the main list (overriding bulk); only a verified sender is linked automatically", async () => {
    const { repo, data } = hub();
    await repo.ingest([email({ person: "news@offers.in", box: "other" }), email({ person: "known@guest.in", box: "other" }), email({ person: "known2@guest.in", senderVerified: false })], { mailbox: "desk@gmail.com" }, GUEST, T0);
    const of = (h: string) => data.convConversations.find((c) => data.convHandles.some((x) => x.contactId === c.contactId && x.value === h))!;
    assert.equal(of("news@offers.in").box, "other");
    // known@guest.in was verified and matches a guest: linked automatically
    assert.deepEqual(data.convContacts.find((c) => c.id === of("known@guest.in").contactId)?.link, { kind: "customer", id: "00000000-0000-4000-8000-00000000c001", source: "auto" });
    await repo.ingest([email({ person: "known@guest.in", box: "other" })], { mailbox: "desk@gmail.com" }, GUEST, T0);
    assert.equal(of("known@guest.in").box, "main", "a linked sender is a guest, whatever the headers say");
    await repo.setMuted(of("news@offers.in").contactId, true);
    await repo.ingest([email({ person: "news@offers.in", box: "main" })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    assert.equal(of("news@offers.in").box, "other", "muted stays in Other");
    await repo.setBox(of("news@offers.in").id, "main");
    assert.equal(of("news@offers.in").box, "main");
  });
});

describe("assignment, notes, quick replies, purge", () => {
  test("assign and clear; notes in order; a quick reply title is used once in any case", async () => {
    const { repo, data } = hub();
    await repo.ingest([email({ person: "asha@guest.in" })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    const id = data.convConversations[0].id;
    await repo.setAssignee(id, ME, ME, T0);
    assert.equal((await repo.get(id))?.assignedTo, ME);
    await repo.setAssignee(id, null, ME, T0);
    assert.equal((await repo.get(id))?.assignedBy, null);
    const a = await repo.addNote(id, ME, "Called her back", at(1));
    await repo.addNote(id, ME, "Wants a late check-out", at(2));
    assert.deepEqual((await repo.notes(id)).map((x) => x.body), ["Called her back", "Wants a late check-out"]);
    assert.equal(await repo.removeNote(id, a.id), true);
    await assert.rejects(repo.addNote(id, ME, "   ", at(3)), RepoError);
    await repo.addQuickReply({ title: "Directions", body: "We are near the station.", channel: "any", sortOrder: 0 }, ME);
    await assert.rejects(repo.addQuickReply({ title: "DIRECTIONS", body: "x", channel: "any", sortOrder: 0 }, ME), (e: unknown) => e instanceof RepoError && e.kind === "unique");
  });

  test("the purge removes messages older than the cut, then the conversations and contacts left empty (their notes with them)", async () => {
    const { repo, data } = hub();
    await repo.ingest([email({ person: "old@guest.in", sentAt: new Date("2025-09-01T00:00:00Z") }), email({ person: "new@guest.in", sentAt: at(1) })], { mailbox: "desk@gmail.com" }, NOBODY, T0);
    const old = data.convConversations.find((c) => c.lastMessageAt.getFullYear() === 2025)!;
    await repo.addNote(old.id, ME, "old note", T0);
    assert.equal(await repo.purge(new Date(T0.getTime() - 365 * 86_400_000)), 1);
    assert.deepEqual([data.convConversations.length, data.convContacts.length, data.convHandles.length, data.convNotes.length, data.convMessages.length], [1, 1, 1, 0, 1]);
  });
});

describe("the WhatsApp 24-hour window (windowOf)", () => {
  test("open, closing soon under 2 hours, closed at 24 hours, never written", () => {
    const last = new Date("2026-10-24T10:00:00Z");
    const plus = (h: number) => new Date(last.getTime() + h * 3_600_000);
    assert.deepEqual(windowOf(last, plus(1)), { open: true, closesAt: plus(24).toISOString(), minutesLeft: 23 * 60, closingSoon: false });
    assert.equal(windowOf(last, plus(22)).closingSoon, false, "exactly 2 hours left");
    assert.equal(windowOf(last, new Date(plus(22).getTime() + 60_000)).closingSoon, true);
    assert.deepEqual(windowOf(last, plus(24)), { open: false, closesAt: plus(24).toISOString(), minutesLeft: 0, closingSoon: false });
    assert.deepEqual(windowOf(null, plus(1)), { open: false, closesAt: null, minutesLeft: null, closingSoon: false });
    assert.equal(windowOf(last.toISOString(), plus(23.5)).minutesLeft, 30);
  });
});
