// Sign-in end to end on the REAL PostgreSQL instance: the real route files, the auth service, the session resolver and the PostgreSQL
// repositories (repos/postgres/auth.ts) behind them, with the real Argon2id hasher and the platform.rate_limits counters. tests/server/auth.login.test.ts
// runs the same routes against the in-memory double; this is the proof that the database version behaves the same way for the main journey.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { POST as verifyCode } from "../../src/app/api/v1/auth/code/verify/route";
import { GET as getSession } from "../../src/app/api/v1/auth/session/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { POST as signOut } from "../../src/app/api/v1/auth/sign-out/route";
import { createDatabase, type Database } from "../../src/db";
import { createCatalog } from "../../src/server/auth/catalog";
import { PERMISSION_CATALOG } from "../../src/server/auth/catalog.generated";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { configureAuth } from "../../src/server/compose/auth";
import { parseHashKey } from "../../src/server/crypto/hash";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createPgPlatformUnit, createPgRateLimitStore } from "../../src/server/repos/postgres/auth";
import { createAuthService } from "../../src/server/services/auth/authService";
import { runOutboxOnce } from "../../src/server/services/auth/mail";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { PASSWORD, WEB, cookieOf, ctx, json, req } from "../server/helpers/authWorld";
import { appUrl, connectOwner, tag, lockTestDatabase } from "./helpers/realDb";
import { randomBytes } from "node:crypto";

let owner: DbClient;
let database: Database;
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

before(async () => {
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  const hashKey = parseHashKey(randomBytes(32).toString("base64"));
  const catalog = createCatalog(PERMISSION_CATALOG);
  const unit = createPgPlatformUnit(database.pool);
  const rateLimits = createPgRateLimitStore(database.pool, hashKey);
  const now = () => new Date();
  const service = createAuthService({ unit, catalog, hasher, hashKey, rateLimits, now });
  const resolver = createSessionResolver({ unit, catalog, now });
  configureAuth({ unit, rateLimits, resolver, service });
  configureRoutes({
    resolveSession: resolver.resolveSession,
    touchSession: resolver.touchSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
    rateLimits,
    clientIp: (r) => r.headers.get("x-test-ip") ?? "10.0.0.1",
  });
});

after(async () => {
  configureAuth(null);
  await database?.close();
  await owner.end();
});

async function makeAdmin(): Promise<{ id: string; username: string; email: string; hotelId: string }> {
  const username = `admin${tag()}${tag()}`;
  const email = `${username}@example.test`;
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  const hotel = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Flow Hotel', $1) RETURNING id", [`f-${tag()}${tag()}`])).rows[0].id);
  const id = String((await owner.query("SELECT platform.create_person(jsonb_build_object('username', $1::text, 'email', $2::text, 'display_name', 'Flow Admin', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'hotel_admin', 'code_required', true)) AS id", [username, email, await hasher.hash(PASSWORD), role])).rows[0].id);
  await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [id, hotel]);
  return { id, username, email, hotelId: hotel };
}

const lastMail = async (userId: string, kind: string): Promise<{ code?: string; to: string }> => {
  const r = await owner.query("SELECT to_email, payload FROM platform.outbox WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC, id DESC LIMIT 1", [userId, kind]);
  return { ...(JSON.parse(String(r.rows[0].payload)) as { code?: string }), to: String(r.rows[0].to_email) };
};

describe("sign-in on the real database", () => {
  test("password, emailed code, session cookie, who-am-I, sign-out; the code is only in the queue, the cookie only as a hash", async () => {
    const admin = await makeAdmin();
    const first = await json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password: PASSWORD, device: WEB } }), ctx()));
    assert.equal(first.data.status, "code_required", JSON.stringify(first));
    const mail = await lastMail(admin.id, "login_code");
    assert.equal(mail.to, admin.email);
    assert.match(String(mail.code), /^\d{6}$/);
    const challengeId = String(first.data.challengeId);
    const wrong = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId, code: mail.code === "000000" ? "111111" : "000000" } }), ctx());
    assert.ok(wrong.status >= 400 && wrong.status < 500);
    const ok = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId, code: mail.code } }), ctx());
    const body = await json(ok);
    assert.equal(body.data.status, "signed_in", JSON.stringify(body));
    const cookie = cookieOf(ok);
    assert.ok(cookie);
    const stored = await owner.query("SELECT token_hash, hotel_id::text AS hotel, client FROM platform.sessions WHERE user_id = $1 AND revoked_at IS NULL", [admin.id]);
    assert.equal(stored.rows.length, 1);
    assert.match(String(stored.rows[0].token_hash), /^[0-9a-f]{64}$/);
    assert.notEqual(stored.rows[0].token_hash, cookie, "the token itself is never stored");
    const me = await json(await getSession(req("GET", "/api/v1/auth/session", { cookie: cookie as string }), ctx()));
    assert.deepEqual([me.data.user.username, me.data.user.role, me.data.user.hotel.id], [admin.username, "hotel_admin", admin.hotelId]);
    const out = await signOut(req("POST", "/api/v1/auth/sign-out", { cookie: cookie as string }), ctx());
    assert.equal(out.status, 200);
    const gone = await getSession(req("GET", "/api/v1/auth/session", { cookie: cookie as string }), ctx());
    assert.equal(gone.status, 401);
    const events = await owner.query("SELECT event FROM platform.auth_events WHERE user_id = $1 ORDER BY at", [admin.id]);
    assert.ok(events.rows.some((e) => e.event === "login_success"));
    assert.ok(events.rows.some((e) => e.event === "logout"));
  });

  test("decision 46: an account whose emailed code is off (the default, administrators too) signs in with the password alone, and asking for the code later is the person's own switch", async () => {
    const admin = await makeAdmin();
    await owner.query("UPDATE platform.logins SET code_required = false WHERE id = $1", [admin.id]);
    const res = await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password: PASSWORD, device: WEB } }), ctx());
    const body = await json(res);
    assert.equal(body.data.status, "signed_in", JSON.stringify(body));
    assert.ok(cookieOf(res));
    const mails = await owner.query("SELECT count(*) AS n FROM platform.outbox WHERE user_id = $1 AND kind = 'login_code'", [admin.id]);
    assert.equal(Number(mails.rows[0].n), 0, "no code was mailed");
    const column = await owner.query("SELECT column_default FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'logins' AND column_name = 'code_required'");
    assert.equal(String(column.rows[0].column_default), "false", "new accounts default to no code");
  });

  test("five wrong passwords lock the account for 15 minutes, in the database, and the lock mail is queued; even the right password is refused", async () => {
    const admin = await makeAdmin();
    const attempt = async (password: string) => json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password, device: WEB }, ip: `10.9.${Math.floor(Math.random() * 200)}.1` }), ctx()));
    for (let i = 0; i < 4; i++) assert.equal((await attempt("Wrong#Pass1")).error?.code, "INVALID_CREDENTIALS");
    const fifth = await attempt("Wrong#Pass1");
    assert.ok(fifth.error, JSON.stringify(fifth));
    const user = await owner.query("SELECT failed_attempts, lock_level, locked_until FROM platform.people WHERE id = $1", [admin.id]);
    assert.equal(Number(user.rows[0].lock_level), 1);
    assert.ok(user.rows[0].locked_until instanceof Date && (user.rows[0].locked_until as Date).getTime() > Date.now());
    const refused = await attempt(PASSWORD);
    assert.ok(refused.error, "while locked even the right password is refused");
    assert.equal((await lastMail(admin.id, "account_locked")).to, admin.email);
  });

  test("a second sign-in replaces the first web session (one active web session per person, revoked as 'replaced')", async () => {
    const admin = await makeAdmin();
    const login = async (): Promise<string> => {
      const first = await json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password: PASSWORD, device: WEB } }), ctx()));
      const code = (await lastMail(admin.id, "login_code")).code;
      const done = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId: first.data.challengeId, code } }), ctx());
      return cookieOf(done) as string;
    };
    const one = await login();
    const two = await login();
    assert.notEqual(one, two);
    assert.equal((await getSession(req("GET", "/api/v1/auth/session", { cookie: one }), ctx())).status, 401);
    assert.equal((await getSession(req("GET", "/api/v1/auth/session", { cookie: two }), ctx())).status, 200);
    const rows = await owner.query("SELECT revoked_reason FROM platform.sessions WHERE user_id = $1 ORDER BY issued_at", [admin.id]);
    assert.deepEqual(rows.rows.map((r) => r.revoked_reason), ["replaced", null]);
  });
});

describe("the mail worker on the real database", () => {
  test("it sends the queued sign-in code through the sender, marks the row sent and removes the payload", async () => {
    const admin = await makeAdmin();
    const first = await json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: admin.username, password: PASSWORD, device: WEB } }), ctx()));
    assert.equal(first.data.status, "code_required");
    const code = (await lastMail(admin.id, "login_code")).code;
    const sent: { to: string; subject: string; text: string }[] = [];
    const count = await runOutboxOnce({ unit: createPgPlatformUnit(database.pool), sender: { send: async (m) => void sent.push(m) }, now: () => new Date() });
    assert.ok(count >= 1);
    const mine = sent.find((m) => m.to === admin.email);
    assert.ok(mine && mine.text.includes(String(code)), "the code is in the mail that went out");
    const row = await owner.query("SELECT status, payload, sent_at FROM platform.outbox WHERE user_id = $1 AND kind = 'login_code'", [admin.id]);
    assert.deepEqual([row.rows[0].status, row.rows[0].payload], ["sent", null]);
    assert.ok(row.rows[0].sent_at instanceof Date);
  });
});

after(async () => {
  await releaseTestLock?.();
});
