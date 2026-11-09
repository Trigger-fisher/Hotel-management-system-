import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../../src/server/errors";
import { LEVELS, type Level } from "../../src/server/auth/levels";
import { assertGrantableKey, buildPermissionSnapshot, can, effectiveLevel, isPortalAccount, overridesForHotel, recordScopeOf, requirePermission } from "../../src/server/auth/permissions";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const ALL: readonly Level[] = LEVELS;
const forbidden = (e: unknown): boolean => e instanceof AppError && e.code === "FORBIDDEN";

describe("the four levels on one part", () => {
  for (const level of ALL) {
    test(`a role with ${level} on revenue.hotel may do exactly the levels up to ${level}`, () => {
      const s = makeSession({ grants: [grant("revenue.hotel", level)] });
      for (const need of ALL) assert.equal(can(s, catalog, "revenue.hotel", need), ALL.indexOf(need) <= ALL.indexOf(level), `${level} vs ${need}`);
    });
  }
  test("no permission at all: nothing is allowed, and requirePermission throws FORBIDDEN", () => {
    const s = makeSession();
    for (const need of ALL) assert.equal(can(s, catalog, "revenue.hotel", need), false);
    assert.throws(() => requirePermission(s, catalog, "revenue.hotel", "view"), forbidden);
  });
  test("an unknown key is never allowed, even if a session somehow carried it", () => {
    assert.equal(can({ permissions: { "made.up": "full" as Level } }, catalog, "made.up", "view"), false);
  });
  test("a stale grant on a key the catalog does not know is ignored when the snapshot is built", () => {
    assert.deepEqual(buildPermissionSnapshot({ catalog, roleGrants: [grant("made.up", "full")], userOverrides: [] }), {});
  });
});

describe("module and part inheritance (Pallav expand)", () => {
  test("a module grant stands for all of its parts", () => {
    const s = makeSession({ grants: [grant("revenue", "edit")] });
    assert.equal(effectiveLevel(s, "revenue"), "edit");
    assert.equal(effectiveLevel(s, "revenue.hotel"), "edit");
    assert.equal(effectiveLevel(s, "revenue.food"), "edit");
    assert.equal(effectiveLevel(s, "expense.misc"), null);
  });
  test("a part grant does not give the module or its sibling parts", () => {
    const s = makeSession({ grants: [grant("revenue.hotel", "create")] });
    assert.equal(effectiveLevel(s, "revenue.hotel"), "create");
    assert.equal(effectiveLevel(s, "revenue"), null);
    assert.equal(effectiveLevel(s, "revenue.food"), null);
  });
  test("a part can be higher than the module it sits in (module view, part full)", () => {
    const s = makeSession({ grants: [grant("revenue", "view"), grant("revenue.hotel", "full")] });
    assert.equal(effectiveLevel(s, "revenue.hotel"), "full");
    assert.equal(effectiveLevel(s, "revenue.food"), "view");
  });
  test("the effective level on a part is capped by the highest level it offers", () => {
    // payroll.attendance offers View and Edit only; payroll.salary-slip offers View only
    const s = makeSession({ grants: [grant("payroll", "full")] });
    assert.equal(effectiveLevel(s, "payroll"), "full");
    assert.equal(effectiveLevel(s, "payroll.attendance"), "edit");
    assert.equal(effectiveLevel(s, "payroll.salary-slip"), "view");
    assert.equal(effectiveLevel(s, "payroll.deduction"), "full");
  });
  test("asking for full on a part that offers less means everything it offers (Pallav: full = every action)", () => {
    const s = makeSession({ grants: [grant("payroll", "full")] });
    assert.equal(can(s, catalog, "payroll.salary-slip", "full"), true);
    assert.equal(can(s, catalog, "payroll.attendance", "full"), true);
  });
  test("a lower grant is still lower: view on payroll does not reach edit on payroll.attendance", () => {
    const s = makeSession({ grants: [grant("payroll", "view")] });
    assert.equal(can(s, catalog, "payroll.attendance", "view"), true);
    assert.equal(can(s, catalog, "payroll.attendance", "edit"), false);
    assert.equal(can(s, catalog, "payroll.attendance", "full"), false);
  });
});

describe("a person's own grants and revokes (user_permissions, one hotel)", () => {
  test("a grant adds what the role does not have", () => {
    const s = makeSession({ grants: [grant("revenue", "view")], overrides: [{ key: "expense.misc", level: "create", granted: true }] });
    assert.equal(effectiveLevel(s, "expense.misc"), "create");
    assert.equal(can(s, catalog, "expense.misc", "edit"), false);
  });
  test("a grant never lowers: the higher of the role's level and the grant wins", () => {
    const s = makeSession({ grants: [grant("revenue.hotel", "full")], overrides: [{ key: "revenue.hotel", level: "view", granted: true }] });
    assert.equal(effectiveLevel(s, "revenue.hotel"), "full");
  });
  test("revoking a part takes it away even though its module is still held", () => {
    const s = makeSession({ grants: [grant("revenue", "full")], overrides: [{ key: "revenue.food", level: "full", granted: false }] });
    assert.equal(effectiveLevel(s, "revenue.food"), null);
    assert.equal(effectiveLevel(s, "revenue.hotel"), "full");
    assert.equal(can(s, catalog, "revenue.food", "view"), false);
  });
  test("revoking a module takes away what it would have spread to, but not a part granted by name", () => {
    const s = makeSession({
      grants: [grant("revenue", "full"), grant("revenue.hotel", "edit")],
      overrides: [{ key: "revenue", level: "full", granted: false }],
    });
    assert.equal(effectiveLevel(s, "revenue"), null);
    assert.equal(effectiveLevel(s, "revenue.food"), null);
    assert.equal(effectiveLevel(s, "revenue.hotel"), "edit");
  });
  test("a revoke wins over the role's grant on the same key (taken away stays taken away)", () => {
    const s = makeSession({ grants: [grant("bills", "edit")], overrides: [{ key: "bills", level: "edit", granted: false }] });
    assert.equal(effectiveLevel(s, "bills"), null);
  });
  test("only the rows of the signed-in hotel count: a revoke made in hotel B does not touch hotel A", () => {
    const rows = [
      { hotelId: HOTEL_B, key: "revenue", level: "full" as Level, granted: false },
      { hotelId: HOTEL_A, key: "expense", level: "view" as Level, granted: true },
    ];
    const inA = makeSession({ hotelId: HOTEL_A, grants: [grant("revenue", "edit")], overrides: overridesForHotel(rows, HOTEL_A) });
    const inB = makeSession({ hotelId: HOTEL_B, grants: [grant("revenue", "edit")], overrides: overridesForHotel(rows, HOTEL_B) });
    assert.equal(effectiveLevel(inA, "revenue"), "edit");
    assert.equal(effectiveLevel(inA, "expense"), "view");
    assert.equal(effectiveLevel(inB, "revenue"), null);
    assert.equal(effectiveLevel(inB, "expense"), null);
  });
});

describe("guest and corporate accounts: no module rows, their own records only", () => {
  const subject = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  test("with no grants they can do nothing on any module or part", () => {
    for (const accountRole of ["guest_user", "corporate_user"] as const) {
      const s = makeSession({ accountRole, scope: { kind: accountRole === "guest_user" ? "guest" : "company", id: subject } });
      for (const entry of catalog.entries) for (const need of ALL) assert.equal(can(s, catalog, entry.key, need), false, entry.key);
    }
  });
  test("the record scope is the company or guest the account points at; staff are not scoped", () => {
    const scope = { kind: "company" as const, id: subject };
    assert.deepEqual(recordScopeOf(makeSession({ accountRole: "corporate_user", scope })), scope);
    assert.equal(recordScopeOf(makeSession({ accountRole: "hotel_admin" })), null);
  });
  test("a guest or corporate account with no subject is told so (409 PORTAL_NOT_LINKED, decision 47); staff are never a portal account", () => {
    assert.throws(() => recordScopeOf(makeSession({ accountRole: "guest_user" })), (e: unknown) => e instanceof AppError && e.code === "PORTAL_NOT_LINKED");
    assert.throws(() => recordScopeOf(makeSession({ accountRole: "corporate_user" })), (e: unknown) => e instanceof AppError && e.code === "PORTAL_NOT_LINKED");
    assert.equal(isPortalAccount(makeSession({ accountRole: "guest_user" })), true);
    assert.equal(isPortalAccount(makeSession({ accountRole: "hotel_admin" })), false);
  });
});

describe("Pallav's own roles, mapped to levels (the seed), give the expected reach", () => {
  test("Viewer = view, Editor = create and edit, Admin = full on revenue; users.set-password is an on/off ability", () => {
    const viewer = makeSession({ grants: [grant("revenue", "view")] });
    const editor = makeSession({ grants: [grant("revenue", "edit")] });
    const admin = makeSession({ grants: [grant("revenue", "full"), grant("users.set-password", "full")] });
    assert.deepEqual([can(viewer, catalog, "revenue.hotel", "view"), can(viewer, catalog, "revenue.hotel", "create")], [true, false]);
    assert.deepEqual([can(editor, catalog, "revenue.hotel", "edit"), can(editor, catalog, "revenue.hotel", "full")], [true, false]);
    assert.deepEqual([can(admin, catalog, "revenue.hotel", "full"), can(admin, catalog, "users.set-password", "view")], [true, true]);
  });
});

describe("the generated catalog", () => {
  test("catalog.generated.ts is what the generator makes from Pallav's permission list and HMS's own (13 Pallav modules + 2 HMS modules, 37 parts, 6 abilities)", async () => {
    const { expectedCatalogText, CATALOG_FILE } = await import("../../../common/db/scripts/generate-permission-catalog");
    const { readFileSync } = await import("node:fs");
    assert.equal(readFileSync(CATALOG_FILE, "utf8").replace(/\r\n/g, "\n"), expectedCatalogText());
    const kinds = catalog.entries.map((e) => e.kind);
    assert.deepEqual([kinds.filter((k) => k === "module").length, kinds.filter((k) => k === "part").length, kinds.filter((k) => k === "ability").length], [15, 37, 6]);
  });
  test("WhatsApp (MJ, 4 Nov 2026) is its own module beside Conversations: view and edit, grantable, so a hotel can give Email without it", () => {
    assert.deepEqual(catalog.get("whatsapp"), { key: "whatsapp", kind: "module", parent: null, offers: "edit" });
    assert.doesNotThrow(() => assertGrantableKey(catalog, "whatsapp"));
    const emailOnly = makeSession({ grants: [grant("conversations", "edit")] });
    assert.deepEqual([can(emailOnly, catalog, "conversations", "edit"), can(emailOnly, catalog, "whatsapp", "view")], [true, false]);
  });
  test("Conversations (decision 66) is HMS's own module: view and edit, grantable; a key in both source lists stops the generator", async () => {
    assert.deepEqual(catalog.get("conversations"), { key: "conversations", kind: "module", parent: null, offers: "edit" });
    assert.doesNotThrow(() => assertGrantableKey(catalog, "conversations"));
    const { mergeSources } = await import("../../../common/db/scripts/generate-permission-catalog");
    const one = { modules: [{ key: "conversations", label: "Conversations", actions: ["view", "edit"], parts: [] }], abilities: [] };
    assert.throws(() => mergeSources(one as never, one as never), /in both/);
  });
  test("every part names a module that exists, and no key repeats", () => {
    const keys = new Set(catalog.entries.map((e) => e.key));
    assert.equal(keys.size, catalog.entries.length);
    for (const e of catalog.entries.filter((x) => x.kind === "part")) assert.ok(e.parent && catalog.get(e.parent)?.kind === "module", e.key);
  });
});
