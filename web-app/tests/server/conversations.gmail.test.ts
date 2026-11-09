// The Email page built the way Gmail works, on the server (hotel 0052, MJ 1 Nov 2026): Compose makes or finds the person's conversation; a conversation can be starred, labelled, snoozed
// (out of the Inbox until then), hold a draft (in Drafts, not the Inbox) and go to the Trash (in no folder and no count). The folders follow the demo's rules (ui-shared conversations.mock).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bindConversations, emptyConversationsData } from "../../src/server/repos/memory/conversations";

const ME = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const page = { page: 1, pageSize: 25, tab: "all" as const, channel: "all" as const, me: ME };

describe("the Email page's folders on the server", () => {
  test("Compose finds or makes the person's conversation (one per address, any case)", async () => {
    const repo = bindConversations(emptyConversationsData());
    const a = await repo.conversationForAddress("Guest@Hotel.test", new Date());
    const b = await repo.conversationForAddress("guest@hotel.test", new Date());
    assert.equal(a, b);
  });

  test("star, labels, draft, snooze and Trash put a conversation in the right folders", async () => {
    const repo = bindConversations(emptyConversationsData());
    const starred = await repo.conversationForAddress("a@hotel.test", new Date());
    const drafted = await repo.conversationForAddress("b@hotel.test", new Date());
    const snoozed = await repo.conversationForAddress("c@hotel.test", new Date());
    const trashed = await repo.conversationForAddress("d@hotel.test", new Date());
    await repo.setExtras(starred, { starred: true, labels: ["VIP"] });
    await repo.setExtras(drafted, { draft: { to: "b@hotel.test", cc: [], subject: "Hi", text: "", at: new Date().toISOString() } });
    await repo.setExtras(snoozed, { snoozedUntil: new Date(Date.now() + 3_600_000) });
    await repo.setExtras(trashed, { trashed: true });
    const ids = async (folder: "inbox" | "starred" | "drafts" | "snoozed", label?: string) => (await repo.list({ ...page, folder, ...(label ? { label } : {}) })).rows.map((r) => r.id).sort();
    assert.deepEqual(await ids("inbox"), [starred]);
    assert.deepEqual(await ids("starred"), [starred]);
    assert.deepEqual(await ids("drafts"), [drafted]);
    assert.deepEqual(await ids("snoozed"), [snoozed]);
    assert.deepEqual(await ids("inbox", "VIP"), [starred]);
    assert.deepEqual(await ids("inbox", "Billing"), []);
    const counts = await repo.folderCounts({ channel: "all", me: ME });
    assert.deepEqual([counts.inbox, counts.starred, counts.drafts, counts.snoozed], [1, 1, 1, 1]);
    const r = await repo.get(starred);
    assert.deepEqual([r?.starred, r?.labels], [true, ["VIP"]]);
  });

  test("writing to a person again brings the conversation back from the Trash", async () => {
    const repo = bindConversations(emptyConversationsData());
    const id = await repo.conversationForAddress("e@hotel.test", new Date());
    await repo.setExtras(id, { trashed: true });
    assert.equal((await repo.list({ ...page, folder: "inbox" })).rows.length, 0);
    assert.equal(await repo.conversationForAddress("e@hotel.test", new Date()), id);
    assert.equal((await repo.list({ ...page, folder: "inbox" })).rows.length, 1);
  });
});
