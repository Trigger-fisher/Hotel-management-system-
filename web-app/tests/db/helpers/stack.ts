// The whole backend stack on the REAL database for the flow tests: the real route files and wrapper, the auth service and session resolver on the
// PostgreSQL platform repositories, and the cash services on the PostgreSQL hotel repositories. Only the clock-free parts stay in memory
// (idempotency keys). A flow test signs in through the real sign-in routes and then calls the module routes with the session cookie.
import { randomBytes } from "node:crypto";
import { POST as verifyCode } from "../../../src/app/api/v1/auth/code/verify/route";
import { POST as signIn } from "../../../src/app/api/v1/auth/sign-in/route";
import type { Database } from "../../../src/db";
import { createCatalog } from "../../../src/server/auth/catalog";
import { PERMISSION_CATALOG } from "../../../src/server/auth/catalog.generated";
import { createArgon2Hasher } from "../../../src/server/auth/password";
import { configureAuth } from "../../../src/server/compose/auth";
import { configureCashExpenses, configureCashLookups, configureCashRevenue } from "../../../src/server/compose/cash";
import { parseHashKey } from "../../../src/server/crypto/hash";
import { createMemoryIdempotencyStore } from "../../../src/server/http/idempotency";
import { configureRoutes } from "../../../src/server/http/route";
import { createLogger } from "../../../src/server/logger";
import { createPgPlatformUnit, createPgRateLimitStore } from "../../../src/server/repos/postgres/auth";
import { createPgCashUnit } from "../../../src/server/repos/postgres/cash";
import { createPgPeopleDirectory, createPgPlatformAudit } from "../../../src/server/repos/postgres/people";
import { createAuthService } from "../../../src/server/services/auth/authService";
import { createSessionResolver } from "../../../src/server/services/auth/sessionResolver";
import { createExpenseService } from "../../../src/server/services/cash/expenseService";
import { createLookupsService } from "../../../src/server/services/cash/lookupsService";
import { createRevenueService } from "../../../src/server/services/cash/revenueService";
import type { DbClient } from "../../../../common/db/scripts/pg-db";
import { PASSWORD, WEB, cookieOf, ctx, json, req } from "../../server/helpers/authWorld";
import { tag } from "./realDb";

export const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

export function startStack(database: Database): void {
  const hashKey = parseHashKey(randomBytes(32).toString("base64"));
  const catalog = createCatalog(PERMISSION_CATALOG);
  const platform = createPgPlatformUnit(database.pool);
  const rateLimits = createPgRateLimitStore(database.pool, hashKey);
  const now = () => new Date();
  const service = createAuthService({ unit: platform, catalog, hasher, hashKey, rateLimits, now });
  const resolver = createSessionResolver({ unit: platform, catalog, now });
  configureAuth({ unit: platform, rateLimits, resolver, service });
  configureRoutes({
    resolveSession: resolver.resolveSession,
    touchSession: resolver.touchSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
    rateLimits,
    clientIp: (r) => r.headers.get("x-test-ip") ?? "10.0.0.1",
  });
  const deps = { unit: createPgCashUnit(database.withHotel), people: createPgPeopleDirectory(database.pool), audit: createPgPlatformAudit(database.pool), catalog, now };
  configureCashRevenue(createRevenueService(deps));
  configureCashExpenses(createExpenseService(deps));
  configureCashLookups(createLookupsService(deps));
}

export function stopStack(): void {
  configureAuth(null);
  configureCashRevenue(null);
  configureCashExpenses(null);
  configureCashLookups(null);
}

export interface Admin {
  id: string;
  username: string;
  email: string;
  hotelId: string;
}

/** An administrator of an EXISTING platform hotel (made by create-hotel): username, email, the built-in Admin role and the hotel as default. */
export async function makeAdmin(owner: DbClient, hotelId: string, roleKey = "admin"): Promise<Admin> {
  const username = `admin${tag()}${tag()}`;
  const email = `${username}@example.test`;
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [roleKey])).rows[0].id);
  const id = String(
    (await owner.query("SELECT platform.create_person(jsonb_build_object('username', $1::text, 'email', $2::text, 'display_name', 'Flow Admin', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'hotel_admin', 'code_required', true)) AS id", [username, email, await hasher.hash(PASSWORD), role])).rows[0].id,
  );
  await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [id, hotelId]);
  return { id, username, email, hotelId };
}

/** Signs in through the real routes (password, then the emailed code read from the queue) and returns the session cookie. */
export async function loginCookie(owner: DbClient, admin: Admin): Promise<string> {
  const first = await json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password: PASSWORD, device: WEB } }), ctx()));
  const mail = await owner.query("SELECT payload FROM platform.outbox WHERE user_id = $1 AND kind = 'login_code' ORDER BY created_at DESC, id DESC LIMIT 1", [admin.id]);
  const code = (JSON.parse(String(mail.rows[0].payload)) as { code: string }).code;
  const done = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId: first.data.challengeId, code } }), ctx());
  const cookie = cookieOf(done);
  if (!cookie) throw new Error("sign-in did not give a session cookie");
  return cookie;
}
