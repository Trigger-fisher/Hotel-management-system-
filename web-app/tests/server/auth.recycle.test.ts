// The recycle-bin ability (system.recycle) is DERIVED from the hotel role, never granted: one predicate for the UI hint and the server.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ABILITY } from "@shared/dashboards/common";
import { RECYCLE_ABILITY, abilitiesOf, canUseRecycleBin, isDerivedAbility, isHotelSuperAdmin } from "../../src/server/auth/access";
import { PERMISSION_CATALOG } from "../../src/server/auth/catalog.generated";
import { createCatalog } from "../../src/server/auth/catalog";
import { assertGrantableKey, buildPermissionSnapshot } from "../../src/server/auth/permissions";
import { AppError } from "../../src/server/errors";

const catalog = createCatalog(PERMISSION_CATALOG);

describe("system.recycle is derived, not a catalog row", () => {
  test("the name is the one the apps read", () => {
    assert.equal(RECYCLE_ABILITY, ABILITY.recycleBin);
    assert.equal(RECYCLE_ABILITY, "system.recycle");
  });

  test("the generated catalog (Pallav's permission list) has no such key, as an ability, a module or a part", () => {
    assert.equal(catalog.get(RECYCLE_ABILITY), undefined);
    assert.ok(!catalog.entries.some((e) => e.key === RECYCLE_ABILITY || e.key.startsWith("system.recycle")));
    assert.ok(isDerivedAbility(RECYCLE_ABILITY) && !isDerivedAbility("system.force"));
  });

  test("an override or a role grant naming it is rejected, and so is an unknown key; a real one passes", () => {
    for (const bad of [RECYCLE_ABILITY, "system.nonsense", "", "system.recycle "]) {
      assert.throws(() => assertGrantableKey(catalog, bad), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED" && !String(e.message).includes(bad || "x"), JSON.stringify(bad));
    }
    assert.doesNotThrow(() => assertGrantableKey(catalog, "system.force"));
    assert.doesNotThrow(() => assertGrantableKey(catalog, "revenue"));
  });

  test("even if a stored row named it, the snapshot ignores it and abilitiesOf never reads it from the snapshot", () => {
    const snapshot = buildPermissionSnapshot({ catalog, roleGrants: [{ key: RECYCLE_ABILITY, level: "full" }], userOverrides: [{ key: RECYCLE_ABILITY, level: "full", granted: true }] });
    assert.ok(!(RECYCLE_ABILITY in snapshot));
    assert.deepEqual(abilitiesOf({ ...snapshot, [RECYCLE_ABILITY]: "full" }, catalog), [], "a forged snapshot key adds nothing");
    assert.deepEqual(abilitiesOf({ ...snapshot, [RECYCLE_ABILITY]: "full" }, catalog, { roleKey: "admin" }), []);
  });
});

describe("canUseRecycleBin: one predicate", () => {
  test("only the hotel's SuperAdmin ROLE (roleKey) passes: not an admin, not a viewer, not a custom role named like it", () => {
    assert.equal(canUseRecycleBin({ roleKey: "super_admin" }), true);
    for (const roleKey of ["admin", "editor", "viewer", "guest", "corporate", "Super_Admin", "super-admin", "super_admin ", "custom-super", ""]) assert.equal(canUseRecycleBin({ roleKey }), false, roleKey);
    assert.equal(isHotelSuperAdmin({ roleKey: "super_admin" }), canUseRecycleBin({ roleKey: "super_admin" }));
  });

  test("the account role never decides it: a platform owner whose hotel role is admin does not pass, and a hotel_admin with the super_admin role does", () => {
    const owner = { accountRole: "super_admin", roleKey: "admin" };
    const hotelAdminWithSuperRole = { accountRole: "hotel_admin", roleKey: "super_admin" };
    assert.equal(canUseRecycleBin(owner), false);
    assert.equal(canUseRecycleBin(hotelAdminWithSuperRole), true);
  });

  test("abilitiesOf adds it once, sorted among the others, only for that role", () => {
    const snapshot = { "system.force": "full", "users.set-password": "full", revenue: "edit" } as const;
    assert.deepEqual(abilitiesOf(snapshot, catalog, { roleKey: "super_admin" }), ["system.force", "system.recycle", "users.set-password"]);
    assert.deepEqual(abilitiesOf(snapshot, catalog, { roleKey: "admin" }), ["system.force", "users.set-password"]);
    assert.deepEqual(abilitiesOf(snapshot, catalog), ["system.force", "users.set-password"]);
  });
});
