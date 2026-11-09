// Unit tests for ui-shared/dashboards/access.ts: which pages a person may open, from their own session values (server redirect and the shell's menu).
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

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

const { homeOf, mayOpenRoute, menuFor, openableIds } = await import("../../common/ui-shared/dashboards/access");
const { setUserGrants } = await import("../../common/ui-shared/dashboards/features");
type Viewer = Parameters<typeof homeOf>[0];

const admin: Viewer = { kind: "hotel", role: "hotel_admin", grants: null };
const desk: Viewer = { kind: "hotel", role: "hotel_user", grants: { pms: "edit", bills: "none" } };

describe("who may open which page", () => {
  test("a hotel admin with no grants opens every hotel page, hidden ones included", () => {
    const ids = openableIds(admin);
    for (const id of ["hotel.dashboard", "hotel.billing.advances", "hotel.admin.profile", "hotel.payroll.staff"]) assert.ok(ids.has(id), id);
    assert.equal(homeOf(admin), "hotel.dashboard");
  });

  test("grants and admin-only entries limit a hotel user", () => {
    const ids = openableIds(desk);
    assert.equal(ids.has("hotel.billing.advances"), false, "bills: none");
    assert.equal(ids.has("hotel.cash.revenue"), false, "no revenue grant");
    assert.equal(ids.has("hotel.fo.inHouse"), true, "pms: edit");
    assert.equal(mayOpenRoute(desk, { viewId: "hotel.fo.stay", params: { id: "s1" } }), true, "a detail page of an allowed list");
    assert.equal(mayOpenRoute(desk, { viewId: "hotel.co.statement", params: { id: "c1" } }), false, "a detail page of a list without the grant");
    // the menu never lists what may not be opened, nor hidden pages
    const listed = menuFor(desk).flatMap((s) => s.items.map((i) => i.id));
    assert.ok(listed.every((id) => ids.has(id)));
    assert.equal(listed.includes("hotel.admin.profile"), false, "hidden from the menu");
  });

  test("Super Admin extras only for the Super Admin", () => {
    const platformAdmin: Viewer = { kind: "platform", role: "platform_admin", grants: null };
    const superAdmin: Viewer = { ...platformAdmin, role: "super_admin" };
    assert.equal(openableIds(platformAdmin).has("platform.users"), false);
    assert.equal(openableIds(superAdmin).has("platform.users"), true);
  });

  test("Conversations is the hotel's own (decision 66, C4): never for Super Admin or Platform Admin in a hotel, a visit included; the console has its own", () => {
    const visitor = (role: Viewer["role"]): Viewer => ({ kind: "hotel", role, grants: null });
    for (const role of ["super_admin", "platform_admin"] as const) {
      const ids = openableIds(visitor(role));
      assert.equal(ids.has("hotel.conversations"), false, role);
      assert.equal(ids.has("hotel.conversation"), false, role);
      assert.equal(mayOpenRoute(visitor(role), { viewId: "hotel.conversation", params: { id: "c1" } }), false, `${role} detail`);
      assert.equal(menuFor(visitor(role)).flatMap((s) => s.items).some((i) => i.id === "hotel.conversations"), false);
      // the platform console's own mailbox is open to both
      assert.equal(openableIds({ kind: "platform", role, grants: null }).has("platform.conversations"), true, `${role} console`);
    }
    assert.equal(openableIds(visitor("group_hotel_admin")).has("hotel.conversations"), true, "a Group Hotel Admin's visit reads");
    assert.equal(openableIds(admin).has("hotel.conversations"), true, "Hotel Admin");
    assert.equal(mayOpenRoute(admin, { viewId: "hotel.conversation", params: { id: "c1" } }), true, "one conversation of an allowed list");
  });

  test("ONE Email entry per console (MJ, 5 Nov 2026): every staff login sees Email, never a My mailbox entry; My mailbox opens by its old address for them alone", () => {
    const ids = { platform: "platform.myMailbox", hotel: "hotel.myMailbox", group: "group.myMailbox" } as const;
    const inMenu = (v: Viewer, id: string) => menuFor(v).flatMap((s) => s.items).some((i) => i.id === id);
    const cases: [keyof typeof ids, Viewer["role"][]][] = [
      ["platform", ["super_admin", "platform_admin"]],
      ["group", ["group_hotel_admin"]],
      ["hotel", ["hotel_admin", "hotel_user"]],
    ];
    for (const [kind, roles] of cases) {
      for (const role of roles) {
        const v: Viewer = { kind, role, grants: null };
        assert.equal(inMenu(v, `${kind}.email`), true, `${role} sees Email in the ${kind} sidebar`);
        assert.equal(inMenu(v, ids[kind]), false, `${role} has no separate My mailbox entry in ${kind}`);
        assert.equal(mayOpenRoute(v, { viewId: ids[kind], params: {} }), true, `${role} opens the old My mailbox address in ${kind}`);
        assert.equal(inMenu(v, `${kind}.myMailboxThread`), false, "the thread page is not a menu entry");
        assert.equal(mayOpenRoute(v, { viewId: `${kind}.myMailboxThread`, params: { id: "c1" } }), true, `${role} opens one conversation in ${kind}`);
      }
    }
    // a Hotel User needs NO module permission for it (it is personal, not the hotel's Conversations), whatever their grants
    assert.equal(openableIds({ kind: "hotel", role: "hotel_user", grants: { pms: "view", conversations: "none" } }).has("hotel.myMailbox"), true);
    assert.equal(openableIds({ kind: "hotel", role: "hotel_user", grants: {} }).has("hotel.myMailbox"), true);
    // and so the Email entry: a desk without the hotel inbox right still has Email (their own box only)
    assert.equal(openableIds({ kind: "hotel", role: "hotel_user", grants: { conversations: "none" } }).has("hotel.email"), true);
    assert.equal(openableIds({ kind: "hotel", role: "hotel_user", grants: { conversations: "none" } }).has("hotel.conversations"), false);
    // a guest and a company login never, in any dashboard
    for (const role of ["guest_user", "corporate_user"] as const) {
      for (const kind of ["platform", "hotel", "group", "guest", "corporate"] as const) {
        const v: Viewer = { kind, role, grants: null };
        for (const id of Object.values(ids)) {
          assert.equal(openableIds(v).has(id), false, `${role} in ${kind}`);
          assert.equal(inMenu(v, id), false, `${role} in ${kind} menu`);
        }
      }
    }
    // the platform, group and Super Admin people work from their own console: inside a hotel's dashboard (a visit) the entry is not theirs
    for (const role of ["super_admin", "platform_admin", "group_hotel_admin"] as const) assert.equal(openableIds({ kind: "hotel", role, grants: null }).has("hotel.myMailbox"), false, `${role} in a hotel`);
    // and each dashboard's entry belongs to that dashboard only
    assert.equal(openableIds({ kind: "hotel", role: "hotel_admin", grants: null }).has("platform.myMailbox"), false);
    assert.equal(openableIds({ kind: "group", role: "group_hotel_admin", grants: null }).has("hotel.myMailbox"), false);
  });
  test("a Hotel User sees Conversations only with the Conversations grant (view or edit)", () => {
    assert.equal(openableIds(desk).has("hotel.conversations"), false, "no grant");
    const viewer: Viewer = { ...desk, grants: { pms: "edit", conversations: "view" } };
    assert.equal(openableIds(viewer).has("hotel.conversations"), true, "view");
    assert.equal(openableIds({ ...desk, grants: { conversations: "none" } }).has("hotel.conversations"), false, "none");
  });

  test("the rules use only the values passed in, never the shell's module-wide copies", () => {
    setUserGrants({ pms: "none" });
    try {
      assert.equal(openableIds(admin).has("hotel.fo.inHouse"), true);
    } finally {
      setUserGrants(null);
    }
  });
});
