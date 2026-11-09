// The screen registry's background preload (src/dashboards/registry.ts preloadGroupsFor): one group per idle slot, a group already loading is skipped, and the
// returned stop cancels what has not started. The chunks themselves cannot load under plain Node (they are React screens): the loader's rejection is caught by the
// registry, and only the scheduling is looked at here.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { groupsFor, preloadGroupsFor } from "../src/dashboards/registry.ts";

type Idle = { fn: () => void; handle: number };
const g = globalThis as { window?: unknown };
afterEach(() => {
  delete g.window;
});

function fakeIdle() {
  const queue: Idle[] = [];
  const cancelled: number[] = [];
  let next = 1;
  g.window = {
    requestIdleCallback: (fn: () => void) => {
      const handle = next++;
      queue.push({ fn, handle });
      return handle;
    },
    cancelIdleCallback: (h: number) => cancelled.push(h),
  };
  /** Runs the one pending idle callback (there is never more than one at a time). */
  const runIdle = () => {
    assert.equal(queue.length, 1, "one idle slot at a time");
    queue.shift()!.fn();
  };
  return { queue, cancelled, runIdle };
}

test("groupsFor: a view id names its group by prefix; payroll ids name both payroll groups", () => {
  assert.deepEqual(groupsFor("hotel.dashboard"), ["overview"]);
  assert.deepEqual(groupsFor("hotel.fo.inhouse"), ["frontOffice"]);
  assert.deepEqual(groupsFor("hotel.payroll.staff"), ["payrollCore", "payrollPay"]);
  assert.deepEqual(groupsFor("nothing.here"), []);
  // Conversations: the hotel's and the console's screens are one group, found before the platform's prefix
  for (const id of ["hotel.conversations", "hotel.conversation", "platform.conversations", "platform.conversation"]) assert.deepEqual(groupsFor(id), ["conversations"], id);
  // My mailbox is the same screens in the hotel, group and platform dashboards (platform 0179); the group's own inbox lives in the same group
  for (const id of ["hotel.myMailbox", "hotel.myMailboxThread", "platform.myMailbox", "platform.myMailboxThread", "group.myMailbox", "group.myMailboxThread"]) assert.deepEqual(groupsFor(id), ["conversations"], id);
  assert.deepEqual(groupsFor("platform.hotels"), ["platform"]);
});

test("preloadGroupsFor: the groups of the ids, each once, one per idle slot; a group already loading is left out; stop cancels the slot not yet run", async () => {
  const { queue, cancelled, runIdle } = fakeIdle();
  // the opening screen's group (overview) is loading already
  const stopFirst = preloadGroupsFor(["hotel.dashboard"]);
  assert.equal(queue.length, 1);
  runIdle();
  assert.equal(queue.length, 0, "a single group needs no further slot");
  stopFirst();
  assert.deepEqual(cancelled, [], "nothing pending to cancel");

  // the pages this person may open: overview is skipped, three other groups remain (frontOffice, billing, payrollCore + payrollPay = four), each once
  const stop = preloadGroupsFor(["hotel.dashboard", "hotel.fo.inhouse", "hotel.fo.reservations", "hotel.billing.bills", "hotel.payroll.staff"]);
  assert.equal(queue.length, 1, "the first group waits for an idle slot");
  runIdle(); // frontOffice
  assert.equal(queue.length, 1, "the next group gets its own slot");
  runIdle(); // billing
  assert.equal(queue.length, 1);
  const pending = queue[0].handle;
  stop();
  assert.deepEqual(cancelled, [pending], "the slot not yet run is cancelled");
  // the chunks cannot load here: the registry forgets the failed groups, so a retry is possible (no unhandled rejection either way)
  await new Promise((r) => setTimeout(r, 20));
});

test("preloadGroupsFor with nothing to load schedules nothing", () => {
  const { queue } = fakeIdle();
  preloadGroupsFor(["nothing.here"])();
  assert.equal(queue.length, 0);
});
