// The four figures on top of the Email and WhatsApp pages (src/dashboards/groups/conversations/inboxFigures.ts): what each counts and which rows its list keeps.
// Run with `node --test tests/conversations.inboxFigures.test.ts`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { closingSoon, inKpi, kpiCounts, kpiTab } = await import("../src/dashboards/groups/conversations/inboxFigures.ts");

const ME = "u-me";
const row = (over: Record<string, unknown> = {}) =>
  ({ id: "1", name: "Rahul", status: "open", box: "main", unread: 0, lastDirection: "out", assignedTo: null, windowMinutes: null, ...over }) as never;

describe("inbox figures", () => {
  test("the Email figures are the server's tab counts", () => {
    assert.deepEqual(kpiCounts("mail", { all: 9, unread: 3, waiting: 2, mine: 1, unassigned: 4 }, null), { unread: 3, waiting: 2, mine: 1, unassigned: 4 });
    assert.deepEqual(kpiCounts("mail", undefined, null), { unread: null, waiting: null, mine: null, unassigned: null });
  });

  test("WhatsApp (one shared desk) shows All, Unread, Waiting and closing windows, never owners; a chat once marked done still counts", () => {
    const chats = [row({ windowMinutes: 30 }), row({ windowMinutes: 120 }), row({ windowMinutes: 121 }), row({ windowMinutes: 0 }), row({ windowMinutes: 45, status: "done" })];
    assert.deepEqual(kpiCounts("chat", { all: 5, unread: 2, waiting: 1, mine: 3, unassigned: 2, done: 4 }, chats), { all: 5, unread: 2, waiting: 1, closing: 3 });
    assert.equal(kpiCounts("chat", { all: 5 }, null).closing, null);
  });

  test("closing soon is an open window with 2 hours or less left", () => {
    assert.equal(closingSoon(row({ windowMinutes: 1 })), true);
    assert.equal(closingSoon(row({ windowMinutes: 120 })), true);
    assert.equal(closingSoon(row({ windowMinutes: 121 })), false);
    assert.equal(closingSoon(row({ windowMinutes: 0 })), false);
    assert.equal(closingSoon(row({ windowMinutes: undefined })), false);
  });

  test("each figure's list keeps exactly the rows it counted", () => {
    assert.equal(inKpi("mail", "unread", row({ unread: 2 }), ME), true);
    assert.equal(inKpi("mail", "unread", row({ unread: 2, box: "other" }), ME), false);
    assert.equal(inKpi("mail", "waiting", row({ lastDirection: "in" }), ME), true);
    assert.equal(inKpi("mail", "waiting", row({ lastDirection: "in", status: "done" }), ME), false);
    assert.equal(inKpi("mail", "mine", row({ assignedTo: { id: ME, name: "Me" } }), ME), true);
    assert.equal(inKpi("mail", "mine", row({ assignedTo: { id: "x", name: "X" } }), ME), false);
    assert.equal(inKpi("mail", "unassigned", row(), ME), true);
    assert.equal(inKpi("mail", "unassigned", row({ status: "done" }), ME), false);
    assert.equal(inKpi("chat", "all", row(), ME), true);
    assert.equal(inKpi("chat", "all", row({ status: "done" }), ME), true, "a chat is never closed");
    assert.equal(inKpi("chat", "all", row({ box: "other" }), ME), false);
    assert.equal(inKpi("chat", "waiting", row({ lastDirection: "in", status: "done" }), ME), true);
    assert.equal(inKpi("chat", "unread", row({ unread: 1 }), ME), true);
    assert.equal(inKpi("chat", "closing", row({ windowMinutes: 60 }), ME), true);
    assert.equal(inKpi("chat", "closing", row({ windowMinutes: 600 }), ME), false);
  });

  test("closing reads the open chats; every other figure asks the server for its own tab", () => {
    assert.deepEqual([kpiTab("closing"), kpiTab("waiting"), kpiTab("unread"), kpiTab("all")], ["all", "waiting", "unread", "all"]);
  });
});
