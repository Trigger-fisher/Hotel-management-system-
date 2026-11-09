// "Set up your group" (MJ, 5 Nov 2026): the checklist states from the group overview, the same rule for the server and the screen.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { groupSetupDone, groupSetupSteps, type GroupOverview } from "../../../common/ui-shared/dashboards/groupConsole";

function overview(over: Partial<GroupOverview> = {}, group: Partial<GroupOverview["group"]> = {}, tiles: Partial<GroupOverview["tiles"]> = {}): GroupOverview {
  return {
    group: { id: "g1", name: "Pallav Group", status: "active", createdAt: "2026-10-01T10:00:00.000Z", legalName: "Pallav Hotels Pvt Ltd", gstin: null, city: "Rajkot", state: "Gujarat", phone: "+91 98250 00000", email: "group@pallav.in", maxHotels: null, isPrimaryAdmin: true, ...group } as GroupOverview["group"],
    tiles: { hotels: 2, hotelsActive: 2, hotelsSuspended: 0, invitationsOpen: 0, hotelAdmins: 2, lockedAccounts: 0, hotelsCounted: 2, ...tiles },
    recentHotels: [],
    recentActivity: [],
    ...over,
  };
}
const state = (o: GroupOverview, fallback: number | null = null) => Object.fromEntries(groupSetupSteps(o, fallback).map((s) => [s.id, s.state]));

describe("group set-up checklist", () => {
  test("a new group: details missing, no hotel, admins wait for a hotel, services unknown", () => {
    const o = overview({}, { legalName: null, phone: "" }, { hotels: 0, hotelsActive: 0, hotelAdmins: 0, hotelsCounted: 0 });
    const steps = groupSetupSteps(o);
    assert.deepEqual(steps.find((s) => s.id === "details")?.missing, ["legalName", "phone"]);
    assert.deepEqual(state(o), { details: "todo", firstHotel: "todo", admins: "todo", mail: "unknown", payments: "unknown" });
    assert.equal(groupSetupDone(steps), false);
  });

  test("an open invitation counts as the first hotel", () => {
    assert.equal(state(overview({}, {}, { hotels: 0, hotelsActive: 0, hotelsCounted: 1 })).firstHotel, "done");
  });

  test("admins: the server's count wins, the screen's count is the fallback, unknown without either", () => {
    const setup = { hotelsWithoutAdmin: 1, mail: { state: "working" as const, reason: null }, payments: { ready: 2, of: 2 } };
    assert.equal(state(overview({ setup }), 0).admins, "todo");
    assert.equal(state(overview(), 0).admins, "done");
    assert.equal(state(overview(), 1).admins, "todo");
    assert.equal(state(overview(), null).admins, "unknown");
  });

  test("everything done hides the checklist; a service not set up keeps it", () => {
    const working = overview({ setup: { hotelsWithoutAdmin: 0, mail: { state: "working", reason: null }, payments: { ready: 2, of: 2 } } });
    assert.equal(groupSetupDone(groupSetupSteps(working)), true);
    const noMail = overview({ setup: { hotelsWithoutAdmin: 0, mail: { state: "not_set_up", reason: null }, payments: { ready: 1, of: 2 } } });
    assert.deepEqual(state(noMail), { details: "done", firstHotel: "done", admins: "done", mail: "platform", payments: "platform" });
    const broken = overview({ setup: { hotelsWithoutAdmin: 0, mail: { state: "needs_attention", reason: "The sending address was refused." }, payments: { ready: 2, of: 2 } } });
    assert.equal(state(broken).mail, "attention");
  });
});
