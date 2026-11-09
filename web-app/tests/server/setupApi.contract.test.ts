// The Set-up centre's client and server agree (MJ, 5 Nov 2026): every address choice the hotel page offers is a pattern the server accepts, and the backup and website
// saves send the server's own field names, to routes that exist with that method.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ADDRESS_PATTERNS } from "../../src/dashboards/groups/platform/setupApi";
import { hotelBackupBody, mailAddressBody, websiteGoogleKeysBody } from "../../src/server/services/platform/schemas";

const api = path.join(process.cwd(), "src", "app", "api", "v1", "platform");
const routeHas = (rel: string, method: string) => {
  const file = path.join(api, rel, "route.ts");
  return existsSync(file) && new RegExp(`export const ${method}\\b`).test(readFileSync(file, "utf8"));
};
const client = readFileSync(path.join(process.cwd(), "src", "dashboards", "groups", "platform", "setupApi.ts"), "utf8");

describe("the Set-up centre's client calls match the server", () => {
  test("every address choice is a pattern the server accepts", () => {
    assert.ok(ADDRESS_PATTERNS.length >= 2);
    for (const p of ADDRESS_PATTERNS) assert.ok(mailAddressBody.safeParse(p.body).success, p.id);
    assert.ok(mailAddressBody.safeParse({ pattern: "custom", word: "frontdesk" }).success, "Undo adds the removed address back as typed");
    assert.ok(routeHas("users/[id]/mail-addresses/preview", "POST"));
  });

  test("backup and website saves go to routes that exist, with the server's field names", () => {
    assert.ok(routeHas("setup/hotels/[id]/backup", "PUT"));
    assert.ok(routeHas("setup/hotels/[id]/website", "PATCH"));
    assert.ok(!routeHas("setup/hotels/[id]/website", "PUT"));
    assert.match(client, /patch<ServerSite>\(\s*`\$\{H\(id\)\}\/website`/);
    assert.ok(hotelBackupBody.safeParse({ clientId: "x.apps.googleusercontent.com", clientSecret: "s", keepDays: 30 }).success);
    assert.ok(websiteGoogleKeysBody.safeParse({ newGoogleMapsApiKey: "AIza", gbpOauthClientId: "x", newGbpOauthClientSecret: "s" }).success);
    assert.ok(!websiteGoogleKeysBody.safeParse({ mapsKey: "AIza" }).success, "the old client names are refused");
  });
});
