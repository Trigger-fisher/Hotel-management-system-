// The Backup & Restore routes of the Settings (Pallav BackupController): the status and Disconnect are real; connect, test and run answer a plain 409 until the
// Google Drive side exists. Connect, Test, Back up now and Disconnect are the platform Super Admin's only (from the Set-up centre); the hotel's own top role
// reads the status. Through the REAL route files and the in-memory hotel store.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as statusRoute } from "../../src/app/api/v1/admin/backup/route";
import { POST as connectRoute } from "../../src/app/api/v1/admin/backup/connect/route";
import { POST as disconnectRoute } from "../../src/app/api/v1/admin/backup/disconnect/route";
import { POST as runRoute } from "../../src/app/api/v1/admin/backup/run/route";
import { POST as testRoute } from "../../src/app/api/v1/admin/backup/test/route";
import { platformSetupSession } from "../../src/server/auth/secretSettings";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("super", makeSession({ userId: id(1), client: "web", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }));
sessions.set("setup", platformSetupSession(makeSession({ userId: id(1), hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }), HOTEL_A));
sessions.set("admin", makeSession({ userId: id(2), client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "full")] }));
let hotel = createMemoryHotel();

beforeEach(() => {
  hotel = createMemoryHotel();
  configureAdmin(
    buildAdminServices({
      unit: hotel.unit,
      people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async () => undefined },
      catalog,
      now: () => new Date("2026-10-05T10:00:00+05:30"),
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const call = (route: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, method: string, who: string | null) =>
  route(new Request("https://hms.test/api/v1/admin/backup", { method, headers: { host: "hms.test", origin: "https://hms.test", ...(who ? { "x-test-session": who } : {}) } }), { params: Promise.resolve({}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;
const settings = () => hotel.store.dataFor(HOTEL_A).appSettings;
const put = (key: string, value: string, secret = false) => settings().set(key, { key, value, secret });

describe("backup status and buttons", () => {
  test("not connected at first: the redirect address, no last backup", async () => {
    const res = await call(statusRoute, "GET", "super");
    assert.equal(res.status, 200);
    const d = (await json(res)).data;
    assert.deepEqual([d.connected, d.lastAt, d.lastResult], [false, null, null]);
    assert.match(d.redirectUri, /\/settings\/backup\/google\/callback$/);
  });

  test("connected when a Drive token is saved; the last result is read from the settings; the token itself is never in the answer", async () => {
    put("backup.refresh_token", "1//secret-token", true);
    put("backup.last_at", "2026-10-04T20:30:00.000Z");
    put("backup.last_result", "Backup finished.");
    const body = await json(await call(statusRoute, "GET", "super"));
    assert.deepEqual([body.data.connected, body.data.lastAt, body.data.lastResult], [true, "2026-10-04T20:30:00.000Z", "Backup finished."]);
    assert.ok(!JSON.stringify(body).includes("secret-token"));
  });

  test("Connect needs the client id and secret first; with them it says the Google link is not available yet (409, nothing changes)", async () => {
    let res = await call(connectRoute, "POST", "setup");
    assert.deepEqual([res.status, (await json(res)).error.message], [409, "Save the Google client ID and secret first, then click Connect with Google."]);
    put("backup.client_id", "id.apps.googleusercontent.com");
    put("backup.client_secret", "shh", true);
    res = await call(connectRoute, "POST", "setup");
    assert.deepEqual([res.status, (await json(res)).error.message], [409, "The Google Drive link is not available on this server yet."]);
    assert.equal(settings().has("backup.refresh_token"), false);
  });

  test("Test and Back up now: 'not connected yet' first, then the honest 'not available yet'", async () => {
    for (const route of [testRoute, runRoute]) {
      const res = await call(route, "POST", "setup");
      assert.deepEqual([res.status, (await json(res)).error.message], [409, "Google Drive is not connected yet."]);
    }
    put("backup.refresh_token", "1//t", true);
    for (const route of [testRoute, runRoute]) assert.equal((await json(await call(route, "POST", "setup"))).error.message, "The Google Drive link is not available on this server yet.");
    assert.equal(settings().get("backup.last_at"), undefined, "nothing writes a last backup that did not happen");
  });

  test("Disconnect forgets the token and the folder (the client id stays), logs it, and answers the new status; repeating it is fine", async () => {
    put("backup.refresh_token", "1//t", true);
    put("backup.folder_id", "folder-1");
    put("backup.client_id", "id.apps.googleusercontent.com");
    const res = await call(disconnectRoute, "POST", "setup");
    assert.equal(res.status, 200);
    assert.equal((await json(res)).data.connected, false);
    assert.ok(!settings().get("backup.refresh_token")?.value);
    assert.equal(settings().get("backup.client_id")?.value, "id.apps.googleusercontent.com");
    const log = hotel.store.dataFor(HOTEL_A).systemLogs.at(-1)!;
    assert.deepEqual([log.module, log.action, log.entity, log.summary], ["settings", "updated", "Backup", "Disconnected Google Drive from backups"]);
    assert.equal((await call(disconnectRoute, "POST", "setup")).status, 200);
  });

  test("the hotel's own top role reads the status but every button is the platform's: 403 with the plain sentence", async () => {
    for (const route of [connectRoute, disconnectRoute, testRoute, runRoute]) {
      const res = await call(route, "POST", "super");
      assert.deepEqual([res.status, (await json(res)).error.message], [403, "This is set up by the platform team."]);
    }
    assert.equal((await call(statusRoute, "GET", "super")).status, 200);
  });

  test("SuperAdmin only: an ordinary admin gets 403 on every route, a stranger 401", async () => {
    for (const [route, method] of [[statusRoute, "GET"], [connectRoute, "POST"], [disconnectRoute, "POST"], [testRoute, "POST"], [runRoute, "POST"]] as const) {
      assert.equal((await call(route, method, "admin")).status, 403, `${method} as admin`);
      assert.equal((await call(route, method, null)).status, 401, `${method} anonymous`);
    }
  });
});
