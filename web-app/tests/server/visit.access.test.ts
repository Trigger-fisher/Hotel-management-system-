// Enter hotel access levels (platform 0135): the route wrapper's verdict for a write inside a visit (src/server/http/visitAccess.ts), and an inventory of
// EVERY hotel route file, so a route added later in a sensitive family (money, saved secrets, backups, exports, salary, letters) cannot slip past the deny list.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { tokenCallVerdict } from "../../src/server/auth/apiTokens";
import { SECRET_SETTING_GROUPS } from "../../src/server/auth/secretSettings";
import { isHotelWrite, visitWriteVerdict } from "../../src/server/http/visitAccess";
import { labelVisitor, visitorLabel } from "../../src/server/repos/visitLabel";
import { SETTING_GROUPS } from "../../src/server/services/admin/settingsDefs";

const visit = (access: "view" | "full") => ({ id: "v1", hotelId: "h1", hotelName: "Hotel Sunrise", expiresAt: new Date(), access, by: "super_admin" as const });
const sa = (access: "view" | "full") => ({ visit: visit(access), accountRole: "super_admin" as const });
const pa = (access: "view" | "full") => ({ visit: { ...visit(access), by: "platform_admin" as const }, accountRole: "platform_admin" as const });
const gadm = () => ({ visit: { ...visit("view"), by: "group_hotel_admin" as const }, accountRole: "group_hotel_admin" as const });
const allowed = (s: Parameters<typeof visitWriteVerdict>[0], method: string, p: string): boolean => visitWriteVerdict(s, method, p).allowed;

describe("the verdict for a call inside a visit", () => {
  test("outside a visit, reads, and the console/auth/profile always pass", () => {
    assert.ok(allowed({ visit: undefined, accountRole: "hotel_admin" }, "POST", "/api/v1/admin/razorpay"));
    for (const s of [sa("view"), pa("view"), gadm(), pa("full")]) {
      assert.ok(allowed(s, "GET", "/api/v1/revenue/deposits"));
      for (const p of ["/api/v1/platform/hotels/x/exit", "/api/v1/group/hotels/x/extend", "/api/v1/auth/sign-out", "/api/v1/profile/preferences"]) assert.ok(allowed(s, "POST", p), p);
    }
  });

  test("a view visit writes nothing in the hotel, with the same sentence as before", () => {
    const v = visitWriteVerdict(pa("view"), "POST", "/api/v1/revenue/deposits");
    assert.deepEqual(v, { allowed: false, why: "You are viewing Hotel Sunrise as platform staff. This is read-only." });
    assert.deepEqual(visitWriteVerdict(gadm(), "DELETE", "/api/v1/revenue/deposits/1"), { allowed: false, why: "You are viewing Hotel Sunrise as the Group Hotel Admin. This is read-only." });
    assert.equal(allowed(sa("view"), "PATCH", "/api/v1/front-office/stays/1"), false);
  });

  test("a full visit writes, except the deny list (both roles); a platform admin's also never touches accounts or roles", () => {
    for (const s of [sa("full"), pa("full")]) {
      assert.ok(allowed(s, "POST", "/api/v1/revenue/deposits"));
      assert.ok(allowed(s, "PUT", "/api/v1/admin/settings/general"));
      for (const p of [
        "/api/v1/admin/backup/run", "/api/v1/admin/backup/connect", "/api/v1/admin/settings/email",
        "/api/v1/admin/settings/email/test", "/api/v1/website/google/connect", "/api/v1/payroll/companies/c1/salary-periods/p1",
        "/api/v1/payroll/companies/c1/slips", "/api/v1/payroll/companies/c1/payments", "/api/v1/payroll/companies/c1/employees/e1/offer-letter", "/api/v1/payroll/companies/c1/letters",
        "/api/v1/payroll/companies/c1/separations/s1/experience-letter",
        // My mailbox (platform 0179) belongs to the person's own login: not in a visit, from any dashboard
        "/api/v1/my-mailbox/mail/compose", "/api/v1/my-mailbox/mail/c1/reply", "/api/v1/my-mailbox/mail/files",
      ]) assert.equal(allowed(s, "POST", p), false, `${s.accountRole} ${p}`);
    }
    for (const s of [sa("view"), pa("view"), gadm()]) assert.equal(allowed(s, "POST", "/api/v1/my-mailbox/mail/compose"), false, `a view visit writes nothing: ${s.accountRole}`);
    // online payments: the platform owner's full visit may work Razorpay (its services refuse Live Mode and non-test keys in a visit); a platform admin may not
    for (const p of ["/api/v1/admin/razorpay", "/api/v1/admin/razorpay/payment-links", "/api/v1/admin/razorpay/payments/hotel/pay_1/refund", "/api/v1/admin/settings/razorpay_hotel", "/api/v1/admin/settings/razorpay_food"]) {
      assert.ok(allowed(sa("full"), p.includes("settings") ? "PATCH" : "POST", p), `owner ${p}`);
      assert.equal(allowed(pa("full"), p.includes("settings") ? "PATCH" : "POST", p), false, `platform admin ${p}`);
    }
    assert.equal(allowed(sa("view"), "POST", "/api/v1/admin/razorpay/payment-links"), false, "a view visit writes nothing");
    assert.equal(allowed(sa("full"), "POST", "/api/v1/admin/settings/razorpay_hotel/test"), false, "only the group's own save, not its sub-routes");
    for (const p of ["/api/v1/admin/users", "/api/v1/admin/users/u1/toggle", "/api/v1/admin/users/u1/reset-password", "/api/v1/admin/roles/r1", "/api/v1/admin/roles/order"]) {
      assert.ok(allowed(sa("full"), "POST", p), `Super Admin ${p} (the services keep the owner account and role out of reach)`);
      assert.deepEqual(visitWriteVerdict(pa("full"), "POST", p), { allowed: false, why: "Accounts and roles cannot be changed by platform staff during a visit." });
    }
  });
});

describe("the hotel's own System Log names a full visitor as such", () => {
  const written: string[] = [];
  const repos = { systemLogs: { write: async (e: { userName: string }) => void written.push(e.userName) }, other: 1 };
  const visit = (access: "view" | "full", by: "super_admin" | "platform_admin") => ({ id: "v1", hotelId: "h1", hotelName: "Hotel Sunrise", expiresAt: new Date(), access, by });

  test("a full visit writes 'Super Admin <name> (visiting)' or 'Platform Admin <name> (visiting)'; once, not again if already labelled", async () => {
    written.length = 0;
    await labelVisitor(repos, visit("full", "super_admin")).systemLogs.write({ userName: "Sonal" });
    await labelVisitor(repos, visit("full", "platform_admin")).systemLogs.write({ userName: "Priya" });
    await labelVisitor(repos, visit("full", "super_admin")).systemLogs.write({ userName: "Sonal Super (visiting)" });
    assert.deepEqual(written, ["Super Admin Sonal (visiting)", "Platform Admin Priya (visiting)", "Sonal Super (visiting)"]);
    assert.equal(visitorLabel("super_admin", "Sonal"), "Super Admin Sonal (visiting)");
  });

  test("nothing else changes: no visit, a view visit or repos without a System Log come back as they are", () => {
    assert.equal(labelVisitor(repos, undefined), repos);
    assert.equal(labelVisitor(repos, visit("view", "platform_admin")), repos);
    const bare = { rooms: 1 };
    assert.equal(labelVisitor(bare, visit("full", "super_admin")), bare);
    assert.equal(labelVisitor(labelVisitor(repos, visit("full", "super_admin")), visit("full", "super_admin")).other, 1, "the other repositories are kept");
  });
});

describe("the settings groups that hold a secret (security review round 3, R3-1)", () => {
  // they are all saved through ONE route chosen by a group name, so the lists must name the groups; the list in auth/secretSettings.ts is checked against the real groups here
  const secretGroups = Object.entries(SETTING_GROUPS).filter(([, g]) => Object.values(g.fields).some((f) => f.secret)).map(([k]) => k);

  test("auth/secretSettings.ts names exactly the groups that have a secret field (a new such group fails here until it is added)", () => {
    assert.deepEqual([...SECRET_SETTING_GROUPS].sort(), secretGroups.sort());
    assert.ok(secretGroups.length >= 4, "email, both Razorpay accounts and the backup");
  });

  test("every such group is refused to a full visit (Super Admin and platform admin) and to every API key, also written another way", () => {
    const key = { level: "full" as const, scope: "all" as const, testMode: false };
    for (const g of SECRET_SETTING_GROUPS) {
      for (const p of [`/api/v1/admin/settings/${g}`, `/api/v1/admin/settings/${g.toUpperCase()}`, `/api/v1/admin/settings/${g.replace(/^./, (c) => `%${c.charCodeAt(0).toString(16)}`)}`, `/api/v1/admin/settings/${g}/test`, `/api/v1/admin/%73ettings/${g}`]) {
        assert.equal(allowed(pa("full"), "PATCH", p), false, `visit platform_admin ${p}`);
        // the platform owner's full visit may save the two Razorpay groups themselves (Test Mode only, checked by the settings service); the mail server, the backup and every sub-route stay refused
        const ownerMay = g.startsWith("razorpay_") && (p === `/api/v1/admin/settings/${g}` || p === `/api/v1/admin/settings/${g.toUpperCase()}`);
        assert.equal(allowed(sa("full"), "PATCH", p), ownerMay, `visit super_admin ${p}`);
        assert.equal(tokenCallVerdict(key, "PATCH", p).allowed, false, `key PATCH ${p}`);
        assert.equal(tokenCallVerdict(key, "GET", p).allowed, false, `key GET ${p}`);
      }
    }
    // the groups without a secret are not caught
    assert.ok(allowed(sa("full"), "PATCH", "/api/v1/admin/settings/general"));
    assert.equal(tokenCallVerdict(key, "PATCH", "/api/v1/admin/settings/general").allowed, true);
  });

  test("an encoded or differently written path cannot slip into a console family or out of a deny list", () => {
    assert.equal(allowed(pa("view"), "POST", "/api/v1/revenue/%64eposits"), false, "a view visit still writes nothing in the hotel");
    assert.equal(allowed(pa("view"), "POST", "/api/v1/platform/..%2Frevenue/deposits"), false, "an encoded way out of the console is a hotel write");
    assert.equal(tokenCallVerdict({ level: "full", scope: "hotel", testMode: false }, "GET", "/api/v1/%70latform/hotels").allowed, false, "a hotel key does not reach the console written another way");
    assert.equal(tokenCallVerdict({ level: "full", scope: "platform", testMode: false }, "GET", "/api/v1/revenue/%64eposits").allowed, false, "a console key does not reach a hotel route written another way");
    assert.equal(tokenCallVerdict({ level: "full", scope: "all", testMode: false }, "POST", "/api/v1/admin/%75sers").allowed, false, "the encoded users route");
  });
});

describe("every hotel route against the full-visit deny list (inventory)", () => {
  const root = path.join(process.cwd(), "src", "app", "api", "v1");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") files.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
    }
  };
  walk(root);
  const writes = files
    .filter((rel) => /export const (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(path.join(root, rel), "utf8")))
    .map((rel) => `/api/v1/${rel.replace(/\/?route\.ts$/, "").replace(/\[(\w+)\]/g, "$1-x")}`)
    .filter((p) => isHotelWrite("POST", p));
  // routes a full visit reaches that sound sensitive but are not: each one with its reason
  const NOT_SENSITIVE: Record<string, string> = {
    "/api/v1/admin/users/id-x/reset-password": "a staff member's password reset by the Super Admin (platform admins: refused with every account write; the owner: refused by userService)",
    "/api/v1/admin/users/id-x/portal-link": "a guest/company portal sign-in link (platform admins: refused with every account write)",
    "/api/v1/admin/users/id-x/portal-link/options": "the same link's choices",
    "/api/v1/guest/password": "the guest portal's own route: a visiting session is not a guest and is refused by the route itself",
    "/api/v1/guest/razorpay/problems": "the guest portal's own route (a problem with the guest's own payment): a visiting session is not a guest and is refused by the route itself",
    "/api/v1/guest/razorpay/problems/id-x/withdraw": "the same guest route, taking a problem back",
    "/api/v1/corporate/razorpay/problems": "the company portal's own route: a visiting session is not a company login and is refused by the route itself",
    "/api/v1/corporate/razorpay/problems/id-x/withdraw": "the same company route, taking a problem back",
    "/api/v1/webhooks/razorpay/hotelId-x/business-x": "Razorpay's own call: no person or visit is behind it, and it is signed with the business's webhook secret",
    "/api/v1/companies/customers/id-x/reset-login":"a company portal login reset by the Super Admin (platform admins: refused with every account write)",
  };
  const SENSITIVE = /id-number|razorpay|backup|credential|secret|smtp|salary|slips?(\/|$)|letter|export|google|password|reset|portal-link|\/payments(\/|$)|settings\/email/;

  test("the walk found the hotel routes", () => {
    assert.ok(writes.length >= 150, `found ${writes.length} hotel write routes`);
  });

  test("every hotel write route in a sensitive family is refused to a full visit (or listed above with its reason)", () => {
    // the platform owner's own full visit may work the hotel's Razorpay in Test Mode (the services refuse Live Mode in a visit), so those routes are checked against a platform admin
    const missed = writes.filter((p) => SENSITIVE.test(p) && !NOT_SENSITIVE[p] && allowed(/^\/api\/v1\/admin\/razorpay(\/|$)/.test(p) ? pa("full") : sa("full"), "POST", p));
    assert.deepEqual(missed, [], "add each to FULL_VISIT_DENIED (src/server/http/visitAccess.ts), or to NOT_SENSITIVE here with the reason");
  });

  test("every account and role route is refused to a platform admin's full visit", () => {
    const accountRoutes = writes.filter((p) => /^\/api\/v1\/admin\/(users|roles)(\/|$)|reset-login|reset-password|portal-link/.test(p) && !p.startsWith("/api/v1/guest/"));
    assert.ok(accountRoutes.length >= 8);
    for (const p of accountRoutes) assert.equal(allowed(pa("full"), "POST", p), false, p);
  });
});
