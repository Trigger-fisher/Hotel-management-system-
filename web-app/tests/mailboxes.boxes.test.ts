// The boxes of the Email page (MJ, 5 Nov 2026: "superadmin will only have his email, no others"): the Super Admin has only their own mailbox (no platform, hotel or group
// inbox, so no switch); the Platform Admin keeps the platform's shared inbox and their own; hotel staff keep the hotel's inbox when their Email right allows it. And the menu:
// My vault is the Super Admin's only, under Account.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";

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

const { emailBoxesOf } = await import("../../common/ui-shared/dashboards/mailboxAccess");
const { nav } = await import("../../common/ui-shared/dashboards/nav");

test("the Super Admin's Email page has only their own mailbox, in every console", () => {
  for (const home of ["platform", "group", "hotel"] as const) {
    const boxes = emailBoxesOf(home, "super_admin", true);
    assert.ok(!boxes.includes("shared"), `no shared inbox on the ${home} Email page`);
  }
  assert.deepEqual(emailBoxesOf("platform", "super_admin", true), ["mine"], "one box: no switch is drawn");
});

test("the Platform Admin keeps the platform's shared inbox and their own mailbox", () => {
  assert.deepEqual(emailBoxesOf("platform", "platform_admin", false), ["shared", "mine"]);
  assert.deepEqual(emailBoxesOf("hotel", "platform_admin", true), [], "never a hotel's inbox on a visit");
});

test("hotel and group staff are unchanged", () => {
  assert.deepEqual(emailBoxesOf("hotel", "hotel_user", true), ["shared", "mine"]);
  assert.deepEqual(emailBoxesOf("hotel", "hotel_user", false), ["mine"]);
  assert.deepEqual(emailBoxesOf("group", "group_hotel_admin", false), ["shared", "mine"]);
});

test("My vault is in the Super Admin's Account section only; there is no hotel vault picker in the menu", () => {
  const sections = nav.platform;
  const account = sections.find((s) => s.title === "Account");
  const item = account?.items.find((i) => i.id === "platform.vault");
  assert.equal(item?.label, "My vault");
  assert.equal(item?.superOnly, true);
  assert.ok(!item?.hidden);
  const vaults = sections.flatMap((s) => s.items).filter((i) => i.id === "platform.vault");
  assert.equal(vaults.length, 1);
});
