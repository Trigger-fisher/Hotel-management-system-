// user.grants (the module levels the menus filter by): per module the highest level on the module or any of its parts, three words (create counts as edit),
// a module with no level left out, nothing at all for the hotel SuperAdmin (who holds everything).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moduleGrantsOf } from "../../src/server/auth/access";
import { catalog } from "./helpers/session";

describe("moduleGrantsOf", () => {
  test("the highest level over a module and its parts; create reads as edit; modules with nothing are absent", () => {
    assert.deepEqual(moduleGrantsOf({ "pms.stays": "view", "pms.rooms": "create", revenue: "full", bills: "edit" }, catalog, { roleKey: "editor" }), { pms: "edit", revenue: "full", bills: "edit" });
    assert.deepEqual(moduleGrantsOf({ dashboard: "view" }, catalog, { roleKey: "viewer" }), { dashboard: "view" });
    assert.deepEqual(moduleGrantsOf({}, catalog, { roleKey: "viewer" }), {});
  });
  test("an ability alone grants no module; the hotel SuperAdmin gets no field at all", () => {
    assert.deepEqual(moduleGrantsOf({ "system.backdate": "full" }, catalog, { roleKey: "admin" }), {});
    assert.equal(moduleGrantsOf({ revenue: "full" }, catalog, { roleKey: "super_admin" }), undefined);
  });
});