// ease-no-ui-tests-for-sign-in-screens (part): dashboardForRole is the ONLY place a role picks its dashboard (MJ, 5 Nov 2026: user kinds never mixed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardForRole, dashboardKindFor } from "../../../common/ui-shared/dashboards/nav";

test("each user kind lands on its own dashboard, whatever the mode or the username", () => {
  const expected = { super_admin: "platform", platform_admin: "platform", group_hotel_admin: "group", hotel_admin: "hotel", hotel_user: "hotel", corporate_user: "corporate", guest_user: "guest" } as const;
  assert.deepEqual({ ...dashboardForRole }, expected);
  for (const [role, kind] of Object.entries(expected)) {
    for (const mock of [true, false]) for (const name of ["mihir", "anita", "group", null]) assert.equal(dashboardKindFor(role as keyof typeof expected, mock, name), kind, `${role} ${mock} ${name}`);
  }
});
