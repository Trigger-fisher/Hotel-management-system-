// Admin, slice 4: users, roles and the signed-in person's own account (profile, devices, sign-in history), through the REAL route files and the wrapper,
// on the in-memory double bound to the sign-in data. Credentials are never touched: a FAKE CredentialService records what Admin asked of it.
// Spec: docs/specs/admin.md §7.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { DELETE as roleDelete, PUT as rolePut } from "../../src/app/api/v1/admin/roles/[id]/route";
import { PUT as rolesOrderPut } from "../../src/app/api/v1/admin/roles/order/route";
import { GET as rolesGet, POST as rolesPost } from "../../src/app/api/v1/admin/roles/route";
import { PUT as emailedCodePut } from "../../src/app/api/v1/profile/emailed-code/route";
import { PUT as passwordPut } from "../../src/app/api/v1/profile/password/route";
import { PUT as overridePut } from "../../src/app/api/v1/admin/users/[id]/override/route";
import { POST as resetPassword } from "../../src/app/api/v1/admin/users/[id]/reset-password/route";
import { DELETE as userDelete, GET as userGet, PUT as userPut } from "../../src/app/api/v1/admin/users/[id]/route";
import { POST as toggle } from "../../src/app/api/v1/admin/users/[id]/toggle/route";
import { POST as unlock } from "../../src/app/api/v1/admin/users/[id]/unlock/route";
import { GET as assignableGet } from "../../src/app/api/v1/admin/users/roles/route";
import { GET as usersGet, POST as usersPost } from "../../src/app/api/v1/admin/users/route";
import { GET as changesGet } from "../../src/app/api/v1/profile/changes/route";
import { GET as devicesGet } from "../../src/app/api/v1/profile/devices/route";
import { GET as profileGet, PUT as profilePut } from "../../src/app/api/v1/profile/route";
import { DELETE as signInDelete } from "../../src/app/api/v1/profile/sign-ins/[id]/route";
import { GET as signInsGet } from "../../src/app/api/v1/profile/sign-ins/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth, type AuthData } from "../../src/server/repos/memory/auth";
import type { UserRecord } from "../../src/server/repos/auth";
import type { CredentialService } from "../../src/server/services/auth/credentialPort";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { AppError } from "../../src/server/errors";
import { asDate, deviceLabel, EMAILED_CODE_NEEDS_EMAIL } from "../../src/server/services/admin/accountService";
import { EVERY_ROLE_ONCE_MESSAGE, SHIPPED_ORDER_MESSAGE, SHIPPED_ROLE_MESSAGE, TOP_OF_LADDER_MESSAGE } from "../../src/server/services/admin/roleService";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = { viewer: id(101), editor: id(102), admin: id(103), super: id(104), portal: id(105) };
const U = { root: id(1), adm: id(2), ed: id(3), vw: id(4), other: id(5), hotelB: id(6) };

const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("root", U.root, { accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("users", "full"), grant("access", "edit"), grant("users.password", "full"), grant("masters", "edit")] });
mk("adm", U.adm, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "edit"), grant("users.password", "view"), grant("masters", "edit")] });
mk("admFull", U.adm, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "full"), grant("access", "view"), grant("users.password", "view")] });
mk("ed", U.ed, { roleKey: "editor", roleLevel: 2, grants: [grant("users", "view")] });
mk("vw", U.vw, { roleKey: "viewer", roleLevel: 1, grants: [] });
mk("nobody", id(99), {});
mk("rootB", id(6), { hotelId: HOTEL_B, accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("access", "edit")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let auth: ReturnType<typeof createMemoryAuth>;
let data: AuthData;
const asked: string[] = [];
let emailAnswer: { ok: true; queued: boolean } | { ok: false; message: string } = { ok: true, queued: true };
let inviteQueued = true;
let passwordAnswer: AppError | null = null;

const credentials: CredentialService = {
  issueInvite: async (userId) => (asked.push(`invite:${userId}`), { queued: inviteQueued }),
  adminResetPassword: async (userId) => (asked.push(`reset:${userId}`), { queued: true }),
  changeEmail: async (userId, email) => (asked.push(`email:${userId}:${email}`), emailAnswer),
  changeMyPassword: async (s) => {
    asked.push(`password:${s.userId}`);
    if (passwordAnswer) throw passwordAnswer;
    return { changed: true, otherSessionsEnded: 0 };
  },
  setMyTwoFactor: async (s, on) => {
    asked.push(`code:${s.userId}:${on}`);
    data.users.find((u) => u.id === s.userId)!.codeRequired = on;
    return { codeRequired: on, canChange: true };
  },
};

const user = (n: number, name: string, username: string, roleId: string, accountRole: UserRecord["accountRole"], extra: Partial<UserRecord> = {}): UserRecord => ({
  id: id(n), username, email: `${username}@pallav.example`, mobile: "+919876500000", displayName: name, passwordHash: "x", roleId, accountRole, status: "active", mustChangePassword: false, passwordChangedAt: new Date("2026-09-01T10:00:00Z"),
  failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: new Date("2026-10-04T10:00:00Z"), deletedAt: null, ...extra,
});

function seed(): void {
  data.hotels.push({ id: HOTEL_A, name: "Hotel Pallav", group: null }, { id: HOTEL_B, name: "Other Hotel", group: null });
  data.roles.push(
    { id: R.viewer, hotelId: null, key: "viewer", level: 1, inherits: true },
    { id: R.editor, hotelId: null, key: "editor", level: 2, inherits: true },
    { id: R.admin, hotelId: null, key: "admin", level: 3, inherits: true },
    { id: R.super, hotelId: null, key: "super_admin", level: 4, inherits: true },
    { id: R.portal, hotelId: null, key: "guest", level: 0, inherits: false },
  );
  data.users.push(
    user(1, "Sonal Super", "sonal", R.super, "super_admin"),
    user(2, "Hari Admin", "hari", R.admin, "hotel_admin"),
    user(3, "Esha Editor", "esha", R.editor, "hotel_user"),
    user(4, "Vik Viewer", "vik", R.viewer, "hotel_user"),
    user(5, "Dev Locked", "dev", R.viewer, "hotel_user", { lockedUntil: new Date("2026-10-05T12:00:00+05:30") }),
    user(6, "Hotel B Person", "bperson", R.viewer, "hotel_user"),
  );
  for (const u of data.users) data.memberships.push({ userId: u.id, hotelId: u.id === U.hotelB ? HOTEL_B : HOTEL_A, roleId: u.roleId, status: "active", isDefault: true, subject: null });
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response): Promise<any> => (await res.clone().json()) as any;
const ok = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 200, JSON.stringify(await json(res)));
  return (await json(res)).data as T;
};
const failure = async (res: Response, status: number): Promise<{ message: string; fields: Record<string, string> }> => {
  const body = await json(res);
  assert.equal(res.status, status, JSON.stringify(body));
  return { message: body.error.message as string, fields: (body.error.details?.fields ?? {}) as Record<string, string> };
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  asked.length = 0;
  emailAnswer = { ok: true, queued: true };
  inviteQueued = true;
  passwordAnswer = null;
  auth = createMemoryAuth();
  data = auth.data();
  seed();
  const users = createMemoryAdminUsers(auth);
  configureAdmin(buildAdminServices({ catalog, now: () => clock } as never, createMemoryAdminPlatform().unit, { unit: users.unit, credentials }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const body = (over: Record<string, unknown> = {}) => ({ name: "Nila New", username: "nila", email: "nila@pallav.example", mobile: "98765 43210", roleId: R.editor, overrides: [], ...over });
const create = (who: string, b: unknown) => usersPost(req("POST", "/api/v1/admin/users", who, b), ctx());
type UserDto = { id: string; name: string; username: string; email: string; mobile: string; roleName: string; status: string; emailedCode: boolean; canManage: boolean; overrides: { module: string; level: string }[] };
type Action = { user: UserDto; message: string };

describe("the accounts list", () => {
  test("lists the hotel's own people, searches, filters by tab and counts", async () => {
    const all = await ok<{ page: { items: UserDto[]; total: number }; stats: Record<string, number> }>(await usersGet(req("GET", "/api/v1/admin/users", "adm"), ctx()));
    assert.equal(all.page.total, 5, "the other hotel's person is not listed");
    assert.deepEqual(all.stats, { all: 5, active: 4, inactive: 0, locked: 1 });
    assert.equal(all.page.items[0].roleName, "SuperAdmin", "highest rung first");
    const found = await ok<{ page: { items: UserDto[] } }>(await usersGet(req("GET", "/api/v1/admin/users?search=esha+editor", "adm"), ctx()));
    assert.deepEqual(found.page.items.map((u) => u.username), ["esha"]);
    const locked = await ok<{ page: { items: UserDto[] } }>(await usersGet(req("GET", "/api/v1/admin/users?tab=locked", "adm"), ctx()));
    assert.deepEqual(locked.page.items.map((u) => [u.username, u.status]), [["dev", "locked"]]);
  });

  test("needs the users screen; another hotel's person is not found", async () => {
    assert.equal((await usersGet(req("GET", "/api/v1/admin/users", "nobody"), ctx())).status, 403);
    assert.equal((await usersGet(req("GET", "/api/v1/admin/users", null), ctx())).status, 401);
    assert.equal((await userGet(req("GET", `/api/v1/admin/users/${U.hotelB}`, "adm"), ctx({ id: U.hotelB }))).status, 404);
  });

  test("canManage is false for yourself, the SuperAdmin and the same or a higher rung", async () => {
    const all = await ok<{ page: { items: UserDto[] } }>(await usersGet(req("GET", "/api/v1/admin/users", "adm"), ctx()));
    const can = Object.fromEntries(all.page.items.map((u) => [u.username, u.canManage]));
    assert.deepEqual(can, { sonal: false, hari: false, esha: true, vik: true, dev: true });
  });

  test("the role picker offers only the rungs below the caller's own", async () => {
    const picks = await ok<{ name: string }[]>(await assignableGet(req("GET", "/api/v1/admin/users/roles", "adm"), ctx()));
    assert.deepEqual(picks.map((r) => r.name).sort(), ["Editor", "Viewer"]);
  });
});

describe("creating an account", () => {
  test("creates it as invited, asks the credential port for the invitation, and never sets a password", async () => {
    const r = await ok<Action>(await create("adm", body()));
    assert.equal(r.user.username, "nila");
    assert.equal(r.user.status, "invited");
    assert.equal(r.user.mobile, "+919876543210");
    assert.match(r.message, /invitation has been emailed to nila@pallav.example/);
    assert.deepEqual(asked, [`invite:${r.user.id}`]);
    const stored = data.users.find((u) => u.id === r.user.id)!;
    assert.equal(stored.passwordHash, "!unusable-until-the-invite-is-used");
    assert.equal(stored.mustChangePassword, true);
  });

  test("an invitation that could not be mailed does not undo the account", async () => {
    inviteQueued = false;
    const r = await ok<Action>(await create("adm", body()));
    assert.match(r.message, /could not be sent/);
    assert.ok(data.users.some((u) => u.username === "nila"));
  });

  test("Pallav's rules, in Pallav's words", async () => {
    let f = await failure(await create("adm", body({ username: "hari" })), 422);
    assert.equal(f.fields.username, "That username is already taken.");
    f = await failure(await create("adm", body({ email: "" })), 422);
    assert.equal(f.fields.email, "An email address is needed - the sign-in invitation is sent to it.");
    f = await failure(await create("adm", body({ roleId: R.admin })), 422);
    assert.equal(f.fields.roleId, "You are not allowed to create an account with that role.");
    f = await failure(await create("adm", body({ roleId: R.super })), 422);
    assert.equal(f.fields.roleId, "You are not allowed to create an account with that role.");
    f = await failure(await create("adm", body({ mobile: "123" })), 422);
    assert.ok(f.fields.mobile);
    assert.deepEqual(asked, [], "nothing was asked of the credential side for a refused account");
    assert.equal(data.users.length, 6);
  });

  test("an e-mail already used by another account is refused", async () => {
    const f = await failure(await create("adm", body({ email: "vik@pallav.example" })), 422);
    assert.ok(f.fields.email);
  });

  test("needs create level; unknown keys and a password in the body are refused", async () => {
    assert.equal((await create("ed", body())).status, 403);
    assert.equal((await create("adm", { ...body(), password: "Secret#123" })).status, 422);
    assert.equal((await create("adm", { ...body(), status: "active" })).status, 422);
  });

  test("a screen exception at creation may not exceed what the caller holds", async () => {
    const f = await failure(await create("adm", body({ overrides: [{ module: "bills", level: "full" }] })), 422);
    assert.ok(f.fields.overrides ?? f.message);
    const good = await ok<Action>(await create("adm", body({ overrides: [{ module: "masters", level: "view" }] })));
    assert.deepEqual(good.user.overrides, [{ module: "masters", level: "view" }]);
  });
});

describe("changing and closing an account", () => {
  test("edits the details and the role", async () => {
    const r = await ok<Action>(await userPut(req("PUT", `/api/v1/admin/users/${U.ed}`, "adm", body({ name: "Esha Edited", username: "esha", email: "esha@pallav.example", roleId: R.viewer })), ctx({ id: U.ed })));
    assert.equal(r.user.name, "Esha Edited");
    assert.equal(r.user.roleName, "Viewer");
    assert.deepEqual(asked, [], "the e-mail did not change, so the credential side was not asked");
  });

  test("a new e-mail address goes through the credential port; a refusal shows on the e-mail field", async () => {
    await ok<Action>(await userPut(req("PUT", `/api/v1/admin/users/${U.ed}`, "adm", body({ username: "esha", email: "Esha.New@Pallav.example" })), ctx({ id: U.ed })));
    assert.deepEqual(asked, [`email:${U.ed}:esha.new@pallav.example`]);
    emailAnswer = { ok: false, message: "That email address is already used by another account." };
    const f = await failure(await userPut(req("PUT", `/api/v1/admin/users/${U.ed}`, "adm", body({ username: "esha", email: "taken@pallav.example" })), ctx({ id: U.ed })), 422);
    assert.equal(f.fields.email, "That email address is already used by another account.");
  });

  test("nobody may manage themselves, the SuperAdmin or an equal or higher rung", async () => {
    const own = await failure(await userPut(req("PUT", `/api/v1/admin/users/${U.adm}`, "adm", body({ username: "hari", email: "hari@pallav.example" })), ctx({ id: U.adm })), 403);
    assert.match(own.message, /not allowed/);
    const sup = await failure(await toggle(req("POST", `/api/v1/admin/users/${U.root}/toggle`, "adm"), ctx({ id: U.root })), 403);
    assert.equal(sup.message, "The SuperAdmin account can only be changed by transferring the role.");
    assert.equal((await toggle(req("POST", `/api/v1/admin/users/${U.root}/toggle`, "root"), ctx({ id: U.root }))).status, 403, "not even the SuperAdmin touches the SuperAdmin account");
  });

  test("deactivating ends the person's sessions; activating brings them back", async () => {
    data.sessions.push({ id: id(500), userId: U.ed, hotelId: HOTEL_A, client: "web", tokenHash: "h", deviceLabel: null, userAgent: null, ip: null, issuedAt: new Date("2026-10-05T09:00:00+05:30"), lastSeenAt: null, expiresAt: new Date("2026-10-06T09:00:00+05:30"), revokedAt: null, revokedReason: null });
    const off = await ok<Action>(await toggle(req("POST", `/api/v1/admin/users/${U.ed}/toggle`, "adm"), ctx({ id: U.ed })));
    assert.equal(off.user.status, "inactive");
    assert.equal(data.sessions[0].revokedReason, "admin");
    const on = await ok<Action>(await toggle(req("POST", `/api/v1/admin/users/${U.ed}/toggle`, "adm"), ctx({ id: U.ed })));
    assert.equal(on.user.status, "active");
  });

  test("unlocking clears the lock and is written to the sign-in history with who did it (MJ, 5 Nov 2026)", async () => {
    const r = await ok<Action>(await unlock(req("POST", `/api/v1/admin/users/${id(5)}/unlock`, "adm"), ctx({ id: id(5) })));
    assert.equal(r.user.status, "active");
    assert.equal(data.users.find((u) => u.id === id(5))!.lockedUntil, null);
    const event = data.events.find((e) => e.event === "account_unlocked" && e.userId === id(5));
    assert.ok(event && (event.detail as { by?: string }).by === sessions.get("adm")?.userId && event.hotelId === HOTEL_A);
  });

  test("reset password asks the credential port and needs the password ability", async () => {
    await ok<Action>(await resetPassword(req("POST", `/api/v1/admin/users/${U.ed}/reset-password`, "adm"), ctx({ id: U.ed })));
    assert.deepEqual(asked, [`reset:${U.ed}`]);
    asked.length = 0;
    mk("admNoPw", U.adm, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "edit")] });
    assert.equal((await resetPassword(req("POST", `/api/v1/admin/users/${U.ed}/reset-password`, "admNoPw"), ctx({ id: U.ed }))).status, 403);
    assert.deepEqual(asked, []);
  });

  test("deleting needs full level, removes the person from the list and writes the audit", async () => {
    assert.equal((await userDelete(req("DELETE", `/api/v1/admin/users/${U.vw}`, "adm"), ctx({ id: U.vw }))).status, 403);
    const r = await ok<{ id: string; message: string }>(await userDelete(req("DELETE", `/api/v1/admin/users/${U.vw}`, "admFull"), ctx({ id: U.vw })));
    assert.equal(r.id, U.vw);
    assert.equal((await userGet(req("GET", `/api/v1/admin/users/${U.vw}`, "adm"), ctx({ id: U.vw }))).status, 404);
    assert.ok(data.audit.some((a) => a.action === "user.deleted" || a.action === "user.closed"));
  });

  test("the SuperAdmin cannot be deleted", async () => {
    mk("rootFull", U.adm, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 5, grants: [grant("users", "full")] });
    assert.equal((await userDelete(req("DELETE", `/api/v1/admin/users/${U.root}`, "rootFull"), ctx({ id: U.root }))).status, 409);
  });
});

describe("screen exceptions for one person", () => {
  const put = (who: string, userId: string, b: unknown) => overridePut(req("PUT", `/api/v1/admin/users/${userId}/override`, who, b), ctx({ id: userId }));

  test("gives, removes and clears one level; the person's next sign-in sees it", async () => {
    const given = await ok<UserDto>(await put("root", U.ed, { module: "masters", level: "edit" }));
    assert.deepEqual(given.overrides, [{ module: "masters", level: "edit" }]);
    const taken = await ok<UserDto>(await put("root", U.ed, { module: "masters", level: "none" }));
    assert.deepEqual(taken.overrides, [{ module: "masters", level: "none" }]);
    const cleared = await ok<UserDto>(await put("root", U.ed, { module: "masters", level: null }));
    assert.deepEqual(cleared.overrides, []);
  });

  test("you cannot give away what you do not have; the access screen is never given", async () => {
    const f = await failure(await put("root", U.ed, { module: "bills", level: "full" }), 422);
    assert.ok(f.message);
    const a = await failure(await put("root", U.ed, { module: "access", level: "edit" }), 422);
    assert.ok(a.message);
  });

  test("needs the access screen at edit", async () => {
    assert.equal((await put("adm", U.ed, { module: "masters", level: "view" })).status, 403);
  });
});

describe("roles", () => {
  type RoleDto = { id: string; name: string; builtIn: boolean; usersCount: number; levels: Record<string, string> };
  const post = (who: string, b: unknown) => rolesPost(req("POST", "/api/v1/admin/roles", who, b), ctx());
  const put = (who: string, roleId: string, b: unknown) => rolePut(req("PUT", `/api/v1/admin/roles/${roleId}`, who, b), ctx({ id: roleId }));
  const del = (who: string, roleId: string) => roleDelete(req("DELETE", `/api/v1/admin/roles/${roleId}`, who), ctx({ id: roleId }));

  test("lists the ladder with how many people hold each rung (portal roles are not part of it)", async () => {
    const list = await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()));
    assert.deepEqual(list.map((r) => [r.name, r.usersCount]), [["SuperAdmin", 1], ["Admin", 1], ["Editor", 1], ["Viewer", 2]]);
    assert.ok(list.every((r) => r.builtIn));
  });

  test("a new rung nobody holds and with nothing ticked lists with usersCount 0 and empty levels (the ladder is two batched reads, not two per role)", async () => {
    const made = await ok<RoleDto>(await post("root", { name: "Night audit", levels: {} }));
    const list = await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()));
    const mine = list.find((r) => r.id === made.id)!;
    assert.deepEqual([mine.usersCount, mine.levels, mine.builtIn], [0, {}, false]);
    assert.deepEqual(list.filter((r) => r.builtIn).map((r) => [r.name, r.usersCount]), [["SuperAdmin", 1], ["Admin", 1], ["Editor", 1], ["Viewer", 2]]);
  });

  test("creates a rung under the caller's own, with only what the caller holds", async () => {
    const r = await ok<RoleDto>(await post("root", { name: "Front desk", description: "Reception", levels: { masters: "view" } }));
    assert.equal(r.name, "Front desk");
    assert.equal(r.builtIn, false);
    assert.deepEqual(r.levels, { masters: "view" });
    const dup = await failure(await post("root", { name: "front desk", levels: {} }), 422);
    assert.equal(dup.fields.name, "The name has already been taken.");
    const over = await failure(await post("root", { name: "Greedy", levels: { bills: "full" } }), 422);
    assert.equal(over.message, "You cannot give away a permission you do not have.");
  });

  test("changing roles stays with the SuperAdmin; anyone else needs the access screen at edit", async () => {
    assert.equal((await post("adm", { name: "X", levels: {} })).status, 403);
    assert.equal((await rolesGet(req("GET", "/api/v1/admin/roles", "nobody"), ctx())).status, 403);
    const list = await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "admFull"), ctx()));
    assert.equal(list.length, 4, "view of the access screen is enough to read");
  });

  test("the access screen is never ticked above view on another role", async () => {
    const custom = await ok<RoleDto>(await post("root", { name: "Manager", levels: {} }));
    const f = await failure(await put("root", custom.id, { name: "Manager", levels: { access: "edit" } }), 422);
    assert.match(f.message, /Only SuperAdmin can change roles and permissions/);
  });

  test("the SuperAdmin keeps the keys to the access screen (the shipped row itself is never written)", async () => {
    data.rolePermissions.push({ roleId: R.super, key: "access", level: "edit" });
    const f = await failure(await put("root", R.super, { name: "SuperAdmin", levels: {} }), 409);
    assert.equal(f.message, SHIPPED_ROLE_MESSAGE);
    assert.ok(data.rolePermissions.some((p) => p.roleId === R.super && p.key === "access" && p.level === "edit"));
  });

  test("updates a custom role (name and ticks); the shipped roles keep their names", async () => {
    const custom = await ok<RoleDto>(await post("root", { name: "Manager", levels: { masters: "view" } }));
    const edited = await ok<RoleDto>(await put("root", custom.id, { name: "Duty manager", levels: { masters: "edit" } }));
    assert.equal(edited.name, "Duty manager");
    assert.deepEqual(edited.levels, { masters: "edit" });
    const shipped = await failure(await put("root", R.editor, { name: "Renamed", levels: {} }), 409);
    assert.equal(shipped.message, SHIPPED_ROLE_MESSAGE);
    assert.equal((await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()))).find((r) => r.id === R.editor)!.name, "Editor");
  });

  test("a shipped role is one row every hotel shares: a hotel's SuperAdmin cannot change any field of it; the same values change nothing", async () => {
    data.rolePermissions.push({ roleId: R.editor, key: "masters", level: "view" });
    const same = { name: "Editor", levels: { masters: "view" } };
    const unchanged = await ok<RoleDto>(await put("root", R.editor, same));
    assert.deepEqual([unchanged.name, unchanged.levels], ["Editor", { masters: "view" }]);
    const attempts: [string, Record<string, unknown>][] = [
      ["name", { name: "Senior editor" }],
      ["description", { description: "Edits for everybody" }],
      ["icon", { icon: "bi-star" }],
      ["accent", { accent: "#112233" }],
      ["inherits", { inherits: false }],
      ["level", { level: 3 }],
      ["levels", { levels: { masters: "edit" } }],
      ["levels", { levels: {} }],
      ["levels", { levels: { masters: "view", users: "view" } }],
    ];
    for (const [field, change] of attempts) {
      for (const who of ["root", "rootB"]) {
        const f = await failure(await put(who, R.editor, { ...same, ...change }), 409);
        assert.equal(f.message, SHIPPED_ROLE_MESSAGE, `${who} ${field}`);
        assert.ok(f.fields[field], `${who} ${field} is named`);
      }
    }
    assert.deepEqual(data.rolePermissions.filter((p) => p.roleId === R.editor), [{ roleId: R.editor, key: "masters", level: "view" }], "the shared grants are untouched");
    const shipped = (await ok<(RoleDto & { level: number; inherits: boolean; icon?: string })[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "rootB"), ctx()))).find((r) => r.id === R.editor)!;
    assert.deepEqual([shipped.name, shipped.level, shipped.inherits, shipped.icon], ["Editor", 2, true, undefined], "hotel B still sees the shipped role as it was");
    assert.ok(!auth.data().audit.some((a) => a.action.startsWith("role.") && a.entityId === R.editor), "nothing was written, so nothing is audited");
  });

  test("a custom role belongs to its hotel: another hotel's SuperAdmin gets 404 on update and delete, and it is not on their ladder", async () => {
    const mine = await ok<RoleDto>(await post("root", { name: "Night desk", levels: { masters: "view" } }));
    assert.equal((await put("rootB", mine.id, { name: "Taken over", levels: {} })).status, 404);
    assert.equal((await del("rootB", mine.id)).status, 404);
    assert.ok(!(await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "rootB"), ctx()))).some((r) => r.id === mine.id));
    const still = (await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()))).find((r) => r.id === mine.id)!;
    assert.deepEqual([still.name, still.levels], ["Night desk", { masters: "view" }]);
  });

  test("deleting: the shipped roles stay and a role in use must be emptied first", async () => {
    assert.equal((await failure(await del("root", R.editor), 409)).message, "The four roles the system ships with cannot be deleted.");
    const custom = await ok<RoleDto>(await post("root", { name: "Manager", levels: {} }));
    await ok<Action>(await create("root", body({ roleId: custom.id })).then(() => create("root", body({ username: "nila2", email: "nila2@pallav.example", roleId: custom.id }))));
    const inUse = await failure(await del("root", custom.id), 409);
    assert.match(inUse.message, /still use Manager. Move them first./);
  });

  test("a role that nobody holds is deleted", async () => {
    const custom = await ok<RoleDto>(await post("root", { name: "Temp", levels: {} }));
    const r = await ok<{ id: string; message: string }>(await del("root", custom.id));
    assert.equal(r.id, custom.id);
    assert.equal((await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()))).length, 4);
  });
});

describe("a role's look and its place on the ladder", () => {
  type RoleDto = { id: string; name: string; level: number; icon?: string; accent?: string; inherits: boolean; builtIn: boolean };
  const post = (who: string, b: unknown) => rolesPost(req("POST", "/api/v1/admin/roles", who, b), ctx());
  const put = (who: string, roleId: string, b: unknown) => rolePut(req("PUT", `/api/v1/admin/roles/${roleId}`, who, b), ctx({ id: roleId }));
  const order = (who: string | null, ids: unknown) => rolesOrderPut(req("PUT", "/api/v1/admin/roles/order", who, { order: ids }), ctx());
  const errorCode = async (res: Response): Promise<string> => (await json(res)).error.code as string;

  test("icon and colour are checked in Laravel's words; Pallav's look is the default; the level asked for stays under the creator's rung", async () => {
    const bad = await failure(await post("root", { name: "Look", levels: {}, icon: "x".repeat(41), accent: "red" }), 422);
    assert.equal(bad.fields.icon, "The icon field must not be greater than 40 characters.");
    assert.equal(bad.fields.accent, "The accent field format is invalid.");
    const plain = await ok<RoleDto>(await post("root", { name: "Plain", levels: {} }));
    assert.deepEqual([plain.icon, plain.accent, plain.inherits, plain.level], ["bi-person", "#111114", true, 3]);
    const low = await ok<RoleDto>(await post("root", { name: "Low", levels: {}, level: 1, icon: "bi-star", accent: "#10b981", inherits: false }));
    assert.deepEqual([low.icon, low.accent, low.inherits, low.level], ["bi-star", "#10b981", false, 1]);
    const high = await ok<RoleDto>(await post("root", { name: "High", levels: {}, level: 9 }));
    assert.equal(high.level, 3, "never at or above the creator's own rung (4)");
    assert.equal((await post("root", { name: "Zero", levels: {}, level: 0 })).status, 422, "the schema refuses a level under 1");
    const list = await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()));
    assert.ok(list.every((r) => typeof r.inherits === "boolean"));
  });

  test("an update changes the look and inherits only when they are sent; the level is not moved here; SuperAdmin always inherits", async () => {
    const r = await ok<RoleDto>(await post("root", { name: "Desk", levels: {}, icon: "bi-star", accent: "#112233" }));
    const same = await ok<RoleDto>(await put("root", r.id, { name: "Desk", levels: {} }));
    assert.deepEqual([same.icon, same.accent, same.inherits], ["bi-star", "#112233", true], "absent = unchanged");
    const changed = await ok<RoleDto>(await put("root", r.id, { name: "Desk", levels: {}, icon: "bi-door-open", accent: "#AABBCC", inherits: false, level: 1 }));
    assert.deepEqual([changed.icon, changed.accent, changed.inherits, changed.level], ["bi-door-open", "#AABBCC", false, 3]);
    const bad = await failure(await put("root", r.id, { name: "Desk", levels: {}, accent: "#12345" }), 422);
    assert.equal(bad.fields.accent, "The accent field format is invalid.");
    const sup = await failure(await put("root", R.super, { name: "SuperAdmin", levels: {}, inherits: false, icon: "bi-shield" }), 409);
    assert.deepEqual(Object.keys(sup.fields).sort(), ["icon", "inherits"], "the shipped SuperAdmin row is shared: its look is not changed from a hotel");
    assert.ok(auth.data().audit.some((a) => a.action === "role.updated" && a.entityId === r.id));
  });

  test("reorder: a custom role takes the level of the shipped rung just below it; custom roles on one rung are listed by name (HMS deviation)", async () => {
    const cashier = await ok<RoleDto>(await post("root", { name: "Cashier", levels: {} }));
    const apprentice = await ok<RoleDto>(await post("root", { name: "Apprentice", levels: {}, level: 1 }));
    const list = await ok<RoleDto[]>(await order("root", [R.super, apprentice.id, R.admin, cashier.id, R.editor, R.viewer]));
    assert.deepEqual(list.map((r) => [r.name, r.level]), [["SuperAdmin", 4], ["Admin", 3], ["Apprentice", 3], ["Cashier", 2], ["Editor", 2], ["Viewer", 1]]);
    const bottom = await ok<RoleDto[]>(await order("root", [R.super, R.admin, R.editor, R.viewer, cashier.id, apprentice.id]));
    assert.deepEqual(bottom.filter((r) => !r.builtIn).map((r) => r.level), [1, 1], "below the bottom rung = the bottom rung's level");
    assert.equal(auth.data().audit.filter((a) => a.action === "role.reordered").length, 2);
  });

  test("reorder refuses: a role missing, named twice or not this hotel's; SuperAdmin not first; the shipped rungs out of order; nothing is changed", async () => {
    const custom = await ok<RoleDto>(await post("root", { name: "Night", levels: {} }));
    const other = await ok<RoleDto>(await post("rootB", { name: "Other hotel role", levels: {} }));
    const all = [R.super, R.admin, custom.id, R.editor, R.viewer];
    for (const ids of [[R.super, R.admin, R.editor, R.viewer], [...all, custom.id], [...all, other.id], [R.super, R.admin, other.id, R.editor, R.viewer]]) {
      const f = await failure(await order("root", ids), 422);
      assert.equal(f.fields.order, EVERY_ROLE_ONCE_MESSAGE, JSON.stringify(ids));
    }
    assert.equal((await failure(await order("root", [R.admin, R.super, custom.id, R.editor, R.viewer]), 422)).message, TOP_OF_LADDER_MESSAGE);
    assert.equal((await failure(await order("root", [R.super, R.editor, custom.id, R.admin, R.viewer]), 422)).message, SHIPPED_ORDER_MESSAGE);
    assert.equal(await errorCode(await order("root", ["not-a-uuid"])), "VALIDATION_FAILED");
    assert.equal((await order("adm", all)).status, 403);
    assert.equal((await order(null, all)).status, 401);
    const list = await ok<RoleDto[]>(await rolesGet(req("GET", "/api/v1/admin/roles", "root"), ctx()));
    assert.equal(list.find((r) => r.id === custom.id)!.level, 3, "a refused order changed nothing");
    assert.ok(!list.some((r) => r.id === other.id), "another hotel's role is not on this ladder");
  });
});

describe("my password and my emailed code (through the credential port)", () => {
  const pw = (who: string | null, b: unknown) => passwordPut(req("PUT", "/api/v1/profile/password", who, b), ctx());
  const code = (who: string | null, b: unknown) => emailedCodePut(req("PUT", "/api/v1/profile/emailed-code", who, b), ctx());
  const good = { current: "Old#Pass2026", next: "New#Pass2026x", confirm: "New#Pass2026x" };
  const errorCode = async (res: Response): Promise<string> => (await json(res)).error.code as string;

  test("the three fields are asked for and the two new ones must match before the credential side is asked; nothing else may be sent", async () => {
    const f = await failure(await pw("ed", { current: "", next: "", confirm: "" }), 422);
    assert.deepEqual(f.fields, { current: "The current password field is required.", next: "The password field is required." });
    const m = await failure(await pw("ed", { ...good, confirm: "New#Pass2026y" }), 422);
    assert.deepEqual(m.fields, { confirm: "The password field confirmation does not match." });
    assert.equal((await pw("ed", { ...good, userId: U.adm })).status, 422, "no id of anyone else");
    assert.equal((await pw(null, good)).status, 401);
    assert.deepEqual(asked, []);
  });

  test("the credential side's refusals land on the right field; a wrong current password is 422 (never a 401 that would sign the person out)", async () => {
    passwordAnswer = new AppError("INVALID_CREDENTIALS", "Your current password is incorrect.");
    let res = await pw("ed", good);
    assert.deepEqual((await failure(res, 422)).fields, { current: "Your current password is incorrect." });
    assert.equal(await errorCode(res), "VALIDATION_FAILED");
    passwordAnswer = new AppError("PASSWORD_REUSED", "The new password must be different from the current one.");
    res = await pw("ed", good);
    assert.deepEqual((await failure(res, 422)).fields, { next: "The new password must be different from the current one." });
    assert.equal(await errorCode(res), "PASSWORD_REUSED");
    passwordAnswer = new AppError("PASSWORD_TOO_WEAK", "weak");
    res = await pw("ed", good);
    assert.equal(await errorCode(res), "PASSWORD_TOO_WEAK");
    assert.deepEqual((await failure(res, 422)).fields, { next: "weak" });
    passwordAnswer = null;
    const done = await ok<{ changedAt: string; message: string }>(await pw("ed", good));
    assert.equal(done.message, "Password changed.");
    assert.ok(!Number.isNaN(Date.parse(done.changedAt)));
    assert.deepEqual(asked, [`password:${U.ed}`, `password:${U.ed}`, `password:${U.ed}`, `password:${U.ed}`]);
  });

  test("ten tries a minute per person: the 11th is 429 with Retry-After and never reaches the credential side; someone else is not held up", async () => {
    passwordAnswer = new AppError("INVALID_CREDENTIALS", "Your current password is incorrect.");
    for (let i = 0; i < 10; i++) assert.equal((await pw("ed", good)).status, 422, `try ${i + 1}`);
    const res = await pw("ed", good);
    assert.equal(res.status, 429);
    assert.equal(await errorCode(res), "RATE_LIMITED");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    assert.equal(asked.filter((a) => a === `password:${U.ed}`).length, 10);
    assert.equal((await pw("vw", good)).status, 422, "another person still gets through");
  });

  test("the emailed code: a person who is not an administrator SETs it; an administrator is refused; turning it on needs an address", async () => {
    type Profile = { emailedCode: boolean; canSwitchEmailedCode: boolean };
    const on = await ok<Profile>(await code("ed", { on: true }));
    assert.deepEqual([on.emailedCode, on.canSwitchEmailedCode], [true, true]);
    await ok<Profile>(await code("ed", { on: true }));
    assert.deepEqual(asked, [`code:${U.ed}:true`], "a SET that changes nothing asks nothing");
    assert.equal((await ok<Profile>(await code("ed", { on: false }))).emailedCode, false);
    // decision 46: an administrator is no different; the switch is everyone's own (here the fake credential side takes the turn on)
    assert.equal((await ok<Profile>(await code("adm", { on: true }))).emailedCode, true);
    data.users.find((u) => u.id === U.vw)!.email = null;
    const noMail = await failure(await code("vw", { on: true }), 422);
    assert.equal(noMail.fields.email, EMAILED_CODE_NEEDS_EMAIL);
    assert.equal((await code("ed", { on: "yes" })).status, 422);
    assert.equal((await code("ed", { on: true, userId: U.vw })).status, 422);
    assert.equal((await code(null, { on: true })).status, 401);
    assert.deepEqual(asked, [`code:${U.ed}:true`, `code:${U.ed}:false`, `code:${U.adm}:true`]);
  });
});

describe("my password and my emailed code with the REAL credential side", () => {
  const PW = "Old#Pass2026";
  const CURRENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
  const pw = (b: unknown) => passwordPut(req("PUT", "/api/v1/profile/password", "ed", b), ctx());
  const errorCode = async (res: Response): Promise<string> => (await json(res)).error.code as string;
  const session = (sid: string) => ({ id: sid, userId: U.ed, hotelId: HOTEL_A, client: "web" as const, tokenHash: sid, deviceLabel: null, userAgent: null, ip: null, issuedAt: clock, lastSeenAt: null, expiresAt: new Date(clock.getTime() + 3_600_000), revokedAt: null, revokedReason: null });

  beforeEach(async () => {
    const real = createCredentialService({ unit: auth.unit, hasher, now: () => clock });
    configureAdmin(buildAdminServices({ catalog, now: () => clock } as never, createMemoryAdminPlatform().unit, { unit: createMemoryAdminUsers(auth).unit, credentials: real }));
    data.users.find((u) => u.id === U.ed)!.passwordHash = await hasher.hash(PW);
    data.sessions.push(session(CURRENT), session(id(801)));
  });

  test("checks the current password (counting nothing), keeps the rule and reuse, ends only my OTHER sessions, mails me and lists the change", async () => {
    let res = await pw({ current: "Wrong#Pass1", next: "New#Pass2026x", confirm: "New#Pass2026x" });
    assert.equal((await failure(res, 422)).fields.current, "Your current password is incorrect.");
    assert.equal(auth.data().users.find((u) => u.id === U.ed)!.failedAttempts, 0);
    res = await pw({ current: PW, next: "weakweak", confirm: "weakweak" });
    assert.equal(await errorCode(res), "PASSWORD_TOO_WEAK");
    res = await pw({ current: PW, next: PW, confirm: PW });
    assert.equal(await errorCode(res), "PASSWORD_REUSED");
    assert.equal(auth.data().sessions.filter((s) => s.revokedAt !== null).length, 0, "a refusal ends nothing");

    await ok<{ changedAt: string }>(await pw({ current: PW, next: "New#Pass2026x", confirm: "New#Pass2026x" }));
    const me = auth.data().users.find((u) => u.id === U.ed)!;
    assert.equal(await hasher.verify(me.passwordHash, "New#Pass2026x"), true);
    assert.deepEqual(auth.data().sessions.filter((s) => s.userId === U.ed).map((s) => [s.id, s.revokedReason]), [[CURRENT, null], [id(801), "password_changed"]]);
    assert.ok(auth.data().outbox.some((o) => o.userId === U.ed && o.kind === "password_changed"));
    const changes = await ok<{ summary: string }[]>(await changesGet(req("GET", "/api/v1/profile/changes", "ed"), ctx()));
    assert.deepEqual(changes.map((c) => c.summary), ["Password changed"]);
    assert.ok(!JSON.stringify({ audit: auth.data().audit, events: auth.data().events }).includes("New#Pass2026x"), "no password in the trail");
  });

  test("the emailed code is written by the credential side; an administrator is no different", async () => {
    await ok<unknown>(await emailedCodePut(req("PUT", "/api/v1/profile/emailed-code", "ed", { on: true }), ctx()));
    assert.equal(auth.data().users.find((u) => u.id === U.ed)!.codeRequired, true);
    assert.ok(auth.data().audit.some((a) => a.action === "user.two_factor_enabled" && a.entityId === U.ed));
    // an administrator is no different (decision 46): ON works, OFF through this old shape has no password field, so it is refused as a wrong password
    await ok<unknown>(await emailedCodePut(req("PUT", "/api/v1/profile/emailed-code", "adm", { on: true }), ctx()));
    assert.equal(auth.data().users.find((u) => u.id === U.adm)!.codeRequired, true);
    assert.equal((await emailedCodePut(req("PUT", "/api/v1/profile/emailed-code", "adm", { on: false }), ctx())).status, 401);
    assert.equal(auth.data().users.find((u) => u.id === U.adm)!.codeRequired, true);
  });
});

describe("the signed-in person's own account", () => {
  type Profile = { name: string; username: string; email: string; mobile: string; roleName: string; hotelName: string; emailedCode: boolean; canEditUsername: boolean; canSwitchEmailedCode: boolean };
  const getProfile = (who: string) => profileGet(req("GET", "/api/v1/profile", who), ctx());
  const putProfile = (who: string, b: unknown) => profilePut(req("PUT", "/api/v1/profile", who, b), ctx());

  test("shows their own details; only an administrator may rename the username", async () => {
    const admin = await ok<Profile>(await getProfile("adm"));
    assert.deepEqual([admin.name, admin.username, admin.roleName, admin.hotelName, admin.emailedCode, admin.canEditUsername, admin.canSwitchEmailedCode], ["Hari Admin", "hari", "Admin", "Hotel Pallav", false, true, true]);
    const staff = await ok<Profile>(await getProfile("ed"));
    assert.deepEqual([staff.canEditUsername, staff.canSwitchEmailedCode], [false, true]);
    assert.equal((await getProfile("nobody")).status, 404, "a session without an account has no profile");
  });

  test("updates name and phone; no change says so; the audit shows the change", async () => {
    const r = await ok<{ profile: Profile; message: string }>(await putProfile("ed", { name: "Esha E.", email: "esha@pallav.example", mobile: "9876543211" }));
    assert.equal(r.message, "Profile updated.");
    assert.equal(r.profile.name, "Esha E.");
    assert.equal(r.profile.mobile, "+919876543211");
    const again = await ok<{ message: string }>(await putProfile("ed", { name: "Esha E.", email: "esha@pallav.example", mobile: "9876543211" }));
    assert.equal(again.message, "No changes to save.");
    const changes = await ok<{ summary: string }[]>(await changesGet(req("GET", "/api/v1/profile/changes", "ed"), ctx()));
    assert.deepEqual(changes.map((c) => c.summary), ["Profile updated"]);
  });

  test("a changed e-mail goes through the credential port", async () => {
    await ok<unknown>(await putProfile("ed", { name: "Esha Editor", email: "esha.two@pallav.example", mobile: "+919876500000" }));
    assert.deepEqual(asked, [`email:${U.ed}:esha.two@pallav.example`]);
    emailAnswer = { ok: false, message: "That email address is already used by another account." };
    const f = await failure(await putProfile("ed", { name: "Esha Editor", email: "dup@pallav.example", mobile: "+919876500000" }), 422);
    assert.equal(f.fields.email, "That email address is already used by another account.");
  });

  test("every detail is required and the username only reaches an administrator", async () => {
    const f = await failure(await putProfile("ed", { name: "", email: "", mobile: "" }), 422);
    assert.ok(f.fields.name && f.fields.email && f.fields.mobile);
    const taken = await failure(await putProfile("adm", { name: "Hari", email: "hari@pallav.example", mobile: "9876543210", username: "sonal" }), 422);
    assert.equal(taken.fields.username, "That username is already taken.");
    const missing = await failure(await putProfile("adm", { name: "Hari", email: "hari@pallav.example", mobile: "9876543210" }), 422);
    assert.ok(missing.fields.username);
    const staffName = await ok<{ profile: Profile }>(await putProfile("ed", { name: "Esha", email: "esha@pallav.example", mobile: "9876543210", username: "hacker" }));
    assert.equal(staffName.profile.username, "esha", "a username sent by someone who may not change it is ignored");
  });

  test("the device list shows where the person is signed in, this one first", async () => {
    const at = (n: number) => new Date(clock.getTime() - n * 3_600_000);
    data.sessions.push(
      { id: id(601), userId: U.ed, hotelId: HOTEL_A, client: "web", tokenHash: "a", deviceLabel: null, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36", ip: "1.1.1.1", issuedAt: at(5), lastSeenAt: at(1), expiresAt: new Date(clock.getTime() + 3_600_000), revokedAt: null, revokedReason: null },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", userId: U.ed, hotelId: HOTEL_A, client: "web", tokenHash: "b", deviceLabel: null, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121.0", ip: "2.2.2.2", issuedAt: at(2), lastSeenAt: at(0), expiresAt: new Date(clock.getTime() + 3_600_000), revokedAt: null, revokedReason: null },
      { id: id(603), userId: U.ed, hotelId: HOTEL_A, client: "web", tokenHash: "c", deviceLabel: null, userAgent: null, ip: null, issuedAt: at(9), lastSeenAt: null, expiresAt: new Date(clock.getTime() + 3_600_000), revokedAt: clock, revokedReason: "logout" },
    );
    const list = await ok<{ device: string; current: boolean; ip: string }[]>(await devicesGet(req("GET", "/api/v1/profile/devices", "ed"), ctx()));
    assert.deepEqual(list.map((d) => [d.device, d.current, d.ip]), [["Firefox on macOS", true, "2.2.2.2"], ["Chrome on Windows", false, "1.1.1.1"]]);
  });
});

describe("sign-in history", () => {
  type SignIns = { page: { items: { id: string; ip: string; device: string; result: string; ended: boolean; at: string }[]; total: number }; totals: { all: number; success: number; failed: number }; places: { place: string; count: number }[] };
  const ev = (userId: string, event: "login_success" | "login_failed", ip: string, ua: string, at: string) => data.events.push({ userId, hotelId: HOTEL_A, event, ip, userAgent: ua, detail: null, at: new Date(at) });
  const CHROME = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36";
  const FOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121.0";
  const list = (who: string, q = "") => signInsGet(req("GET", `/api/v1/profile/sign-ins${q}`, who), ctx());

  beforeEach(() => {
    ev(U.ed, "login_success", "1.1.1.1", CHROME, "2026-09-27T05:00:00Z");
    ev(U.ed, "login_failed", "9.9.9.9", FOX, "2026-09-28T05:00:00Z");
    ev(U.ed, "login_success", "1.1.1.1", FOX, "2026-10-01T05:00:00Z");
    ev(U.ed, "login_success", "2.2.2.2", CHROME, "2026-10-05T03:00:00Z");
    ev(U.vw, "login_success", "3.3.3.3", CHROME, "2026-10-02T05:00:00Z");
    data.sessions.push({ id: id(700), userId: U.ed, hotelId: HOTEL_A, client: "web", tokenHash: "t", deviceLabel: null, userAgent: CHROME, ip: "2.2.2.2", issuedAt: new Date("2026-10-05T03:00:00Z"), lastSeenAt: null, expiresAt: new Date("2026-10-06T03:00:00Z"), revokedAt: null, revokedReason: null });
  });

  test("lists only the person's own, newest first, with totals and places by count", async () => {
    const r = await ok<SignIns>(await list("ed"));
    assert.equal(r.page.total, 4);
    assert.deepEqual(r.page.items.map((x) => x.ip), ["2.2.2.2", "1.1.1.1", "9.9.9.9", "1.1.1.1"]);
    assert.deepEqual(r.totals, { all: 4, success: 3, failed: 1 });
    assert.deepEqual(r.places[0], { place: "1.1.1.1", count: 2 });
    assert.deepEqual(r.page.items.map((x) => x.ended), [false, true, true, true], "only the session in progress is not ended");
  });

  test("filters by address, and searches by address, browser or a day in any of Pallav's writings", async () => {
    assert.equal((await ok<SignIns>(await list("ed", "?ip=1.1.1.1"))).page.total, 2);
    assert.equal((await ok<SignIns>(await list("ed", "?search=firefox"))).page.total, 2);
    assert.equal((await ok<SignIns>(await list("ed", "?search=27-09-2026"))).page.total, 1);
    assert.equal((await ok<SignIns>(await list("ed", "?search=27/09/2026"))).page.total, 1);
    assert.equal((await ok<SignIns>(await list("ed", "?search=2026-09-27"))).page.total, 1);
    assert.equal((await ok<SignIns>(await list("ed", "?search=firefox+1.1.1.1"))).page.total, 1, "every word has to match");
    assert.equal((await ok<SignIns>(await list("ed", "?search=nothing"))).page.total, 0);
  });

  test("pages by 10, 25, 50 or 100 and refuses other sizes", async () => {
    const r = await ok<SignIns>(await list("ed", "?pageSize=10&page=2"));
    assert.equal(r.page.items.length, 0);
    assert.equal(r.page.total, 4);
    assert.equal((await list("ed", "?pageSize=7")).status, 422);
  });

  test("removes an ended sign-in from the person's own history and audits it; never the one in progress, never another person's", async () => {
    const all = await ok<SignIns>(await list("ed"));
    const live = all.page.items[0].id;
    const ended = all.page.items[1].id;
    const rm = (who: string, rid: string) => signInDelete(req("DELETE", `/api/v1/profile/sign-ins/${rid}`, who), ctx({ id: rid }));
    assert.equal((await failure(await rm("ed", live), 409)).message, "That is the session you are in. It can be removed once it has ended.");
    await ok<unknown>(await rm("ed", ended));
    assert.equal((await ok<SignIns>(await list("ed"))).page.total, 3);
    assert.equal((await rm("vw", ended)).status, 404, "another account's record is not reachable");
    assert.ok(auth.data().audit.some((a) => a.action === "signin.deleted" && a.actorUserId === U.ed));
    const changes = await ok<unknown[]>(await changesGet(req("GET", "/api/v1/profile/changes", "ed"), ctx()));
    assert.equal(changes.length, 0, "the removal is audited but sign-in rows are not 'changes to the account'");
  });
});

describe("helpers", () => {
  test("deviceLabel reads the browser and system and keeps nothing else", () => {
    assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36"), "Chrome on Windows");
    assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0"), "Edge on Windows");
    assert.equal(deviceLabel(null), "A browser");
  });
  test("asDate reads the three writings and refuses impossible days", () => {
    assert.equal(asDate("27-09-2026"), "2026-09-27");
    assert.equal(asDate("27/09/2026"), "2026-09-27");
    assert.equal(asDate("2026-09-27"), "2026-09-27");
    assert.equal(asDate("31-02-2026"), null);
    assert.equal(asDate("firefox"), null);
  });
});
