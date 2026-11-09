// readOnce (services/frontOffice/context.ts): the board's helpers each read the rooms and the room types (and the current stays of the same rooms) again; inside one
// read-only unit they are read ONCE and shared. What must hold: one read of each however many callers, the current stays keyed by the rooms asked for, everything
// else passes through untouched, and a second unit of work (a new readOnce) reads fresh.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FrontOfficeRepos } from "../../src/server/repos/frontOffice";
import { readOnce } from "../../src/server/services/frontOffice/context";

function fake() {
  const calls = { rooms: 0, types: 0, current: [] as string[][], other: 0 };
  const repos = {
    rooms: { all: async () => (calls.rooms++, [{ id: "r1" }, { id: "r2" }]), withStays: async () => (calls.other++, new Set<string>()) },
    roomTypes: { all: async () => (calls.types++, [{ id: "t1" }]) },
    stays: { currentByRoom: async (ids: readonly string[]) => (calls.current.push([...ids]), new Map([[ids[0] ?? "", { id: "s" }]])), inHouseCount: async () => (calls.other++, 4) },
    charges: { forStays: async () => (calls.other++, new Map()) },
  } as unknown as FrontOfficeRepos;
  return { repos, calls };
}

describe("readOnce", () => {
  test("the rooms and the room types are read once however many helpers ask; the same answer each time", async () => {
    const { repos, calls } = fake();
    const once = readOnce(repos);
    const a = await once.rooms.all();
    const b = await once.rooms.all();
    const c = await once.rooms.all();
    assert.deepEqual([a, b, c].map((x) => x.length), [2, 2, 2]);
    assert.equal(a, b);
    await once.roomTypes.all();
    await once.roomTypes.all();
    assert.deepEqual([calls.rooms, calls.types], [1, 1]);
  });

  test("the current stays are read once per set of rooms: the same set shares one read, another set reads again", async () => {
    const { repos, calls } = fake();
    const once = readOnce(repos);
    await once.stays.currentByRoom(["r1", "r2"]);
    await once.stays.currentByRoom(["r1", "r2"]);
    await once.stays.currentByRoom(["r1"]);
    assert.deepEqual(calls.current, [["r1", "r2"], ["r1"]]);
  });

  test("everything else is the repository's own (not cached), and a new unit of work reads fresh", async () => {
    const { repos, calls } = fake();
    const once = readOnce(repos);
    await once.rooms.withStays(["r1"]);
    await once.rooms.withStays(["r1"]);
    assert.equal(await once.stays.inHouseCount(), 4);
    await once.charges.forStays(["s1"]);
    assert.equal(calls.other, 4, "four calls, four reads");
    await readOnce(repos).rooms.all();
    await once.rooms.all();
    assert.equal(calls.rooms, 2, "the second readOnce did its own read");
  });
});
