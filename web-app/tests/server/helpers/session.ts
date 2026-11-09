import { createCatalog } from "../../../src/server/auth/catalog";
import { PERMISSION_CATALOG } from "../../../src/server/auth/catalog.generated";
import type { Level } from "../../../src/server/auth/levels";
import { buildPermissionSnapshot, type Grant, type UserOverride } from "../../../src/server/auth/permissions";
import type { AccountRole, RecordScope, VerifiedSession } from "../../../src/server/auth/session";

export const catalog = createCatalog(PERMISSION_CATALOG);

export const HOTEL_A = "11111111-1111-4111-8111-111111111111";
export const HOTEL_B = "22222222-2222-4222-8222-222222222222";

/** A verified session for tests (the real sign-in comes later). `grants` are the role's grants; `overrides` the person's own, for this hotel. */
export function makeSession(
  options: {
    hotelId?: string;
    userId?: string;
    accountRole?: AccountRole;
    roleKey?: string;
    roleLevel?: number;
    grants?: readonly Grant[];
    overrides?: readonly UserOverride[];
    client?: "web";
    scope?: RecordScope;
  } = {},
): VerifiedSession {
  return {
    userId: options.userId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    hotelId: options.hotelId ?? HOTEL_A,
    accountRole: options.accountRole ?? "hotel_user",
    roleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roleKey: options.roleKey ?? "viewer",
    roleLevel: options.roleLevel ?? 1,
    permissions: buildPermissionSnapshot({ catalog, roleGrants: options.grants ?? [], userOverrides: options.overrides ?? [] }),
    sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    client: options.client ?? "web",
    ...(options.scope ? { scope: options.scope } : {}),
  };
}

export const grant = (key: string, level: Level): Grant => ({ key, level });
