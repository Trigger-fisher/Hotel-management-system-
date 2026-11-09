// flow-portal-accounts-cannot-be-invited (MJ, 5 Nov 2026): a hotel can now make a guest or company portal login for one of its records, linked and invited.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth, type AuthData } from "../../src/server/repos/memory/auth";
import type { UserRecord } from "../../src/server/repos/auth";
import type { CredentialService } from "../../src/server/services/auth/credentialPort";
import { createUserService, type PortalRecords } from "../../src/server/services/admin/userService";
import { AppError } from "../../src/server/errors";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GUEST_RECORD = id(900);
const COMPANY_RECORD = id(901);
const OFF_RECORD = id(902);
const meta = { ip: "10.0.0.1", traceId: "t-1", userAgent: null } as never;

let data: AuthData;
let invited: string[];
let service: ReturnType<typeof createUserService>;

const admin = makeSession({ userId: id(2), client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("users", "full")] });
const viewer = makeSession({ userId: id(4), client: "web", roleKey: "viewer", roleLevel: 1, grants: [grant("users", "view")] });

const records: PortalRecords = {
  describe: async (_s, links) => {
    const out = new Map<string, { name: string; active: boolean }>();
    for (const l of links) {
      if (l.id === GUEST_RECORD) out.set(`guest:${l.id}`, { name: "Ravi Patel", active: true });
      if (l.id === COMPANY_RECORD) out.set(`company:${l.id}`, { name: "Acme Travels", active: true });
      if (l.id === OFF_RECORD) out.set(`guest:${l.id}`, { name: "Old Guest", active: false });
    }
    return out;
  },
  options: async () => [],
};

beforeEach(() => {
  const auth = createMemoryAuth();
  data = auth.data();
  data.hotels.push({ id: HOTEL_A, name: "Hotel Pallav", group: null });
  data.roles.push({ id: id(101), hotelId: null, key: "viewer", level: 1, inherits: true }, { id: id(103), hotelId: null, key: "admin", level: 3, inherits: true });
  const u = (n: number, username: string, roleId: string, accountRole: UserRecord["accountRole"]): UserRecord => ({
    id: id(n), username, email: `${username}@pallav.example`, mobile: null, displayName: username, passwordHash: "x", roleId, accountRole, status: "active", mustChangePassword: false, passwordChangedAt: null,
    failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null,
  });
  data.users.push(u(2, "hari", id(103), "hotel_admin"), u(4, "vik", id(101), "hotel_user"), u(7, "ravi", id(101), "hotel_user"));
  for (const x of data.users) data.memberships.push({ userId: x.id, hotelId: HOTEL_A, roleId: x.roleId, status: "active", isDefault: true, subject: null });
  invited = [];
  const credentials = { issueInvite: async (userId: string) => (invited.push(userId), { queued: true }) } as unknown as CredentialService;
  service = createUserService({ platform: createMemoryAdminUsers(auth).unit, credentials, catalog, now: () => new Date("2026-11-05T10:00:00+05:30"), portalRecords: records });
});

describe("flow-portal-accounts-cannot-be-invited", () => {
  test("a guest portal login is made for the guest record, linked to it, with no staff access, and invited by email", async () => {
    const out = await service.invitePortal(admin, { kind: "guest", recordId: GUEST_RECORD, name: "Ravi Patel", email: "Ravi.Patel@mail.example", mobile: "" }, meta);
    const made = data.users.find((x) => x.email === "ravi.patel@mail.example")!;
    assert.equal(made.accountRole, "guest_user");
    assert.equal(made.status, "invited");
    assert.equal(made.username, "ravi.patel");
    assert.deepEqual(data.memberships.find((m) => m.userId === made.id)?.subject, { kind: "guest", id: GUEST_RECORD });
    assert.deepEqual(invited, [made.id]);
    assert.match(out.message, /guest portal/);
    assert.equal(out.user.portal?.linked, true);
  });
  test("a company portal login is a corporate_user linked to the company; a taken username gets a number", async () => {
    await service.invitePortal(admin, { kind: "company", recordId: COMPANY_RECORD, name: "Acme Desk", email: "ravi@acme.example", mobile: "" }, meta);
    const made = data.users.find((x) => x.email === "ravi@acme.example")!;
    assert.equal(made.accountRole, "corporate_user");
    assert.equal(made.username, "ravi2");
  });
  test("refused: a record that is switched off or missing, an email already in use, and a caller without Create on users", async () => {
    await assert.rejects(service.invitePortal(admin, { kind: "guest", recordId: OFF_RECORD, name: "Old", email: "old@mail.example", mobile: "" }, meta), (e: AppError) => e.code === "VALIDATION_FAILED");
    await assert.rejects(service.invitePortal(admin, { kind: "company", recordId: GUEST_RECORD, name: "X", email: "x@mail.example", mobile: "" }, meta), (e: AppError) => e.code === "VALIDATION_FAILED");
    await assert.rejects(service.invitePortal(admin, { kind: "guest", recordId: GUEST_RECORD, name: "Vik", email: "vik@pallav.example", mobile: "" }, meta), (e: AppError) => e.code === "VALIDATION_FAILED");
    await assert.rejects(service.invitePortal(viewer, { kind: "guest", recordId: GUEST_RECORD, name: "Ravi", email: "r@mail.example", mobile: "" }, meta), (e: AppError) => e.code === "FORBIDDEN");
    assert.deepEqual(invited, []);
  });
});
