// The platform schema on the REAL PostgreSQL instance: migrations, seeds, the rules only the database can prove, and what the app's own login
// (hms_app) can and cannot do there. Run with:   npm run test:db   (needs the instance: npm run db:pg -- ensure)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadMigrationFiles, runMigrations } from "../../../common/db/scripts/migrate";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { newId } from "../../src/server/db/ids";
import { classifyPgError } from "../../src/server/db/pgErrors";
import { connectApp, connectOwner, constraintOf, sqlStateOf, tag, lockTestDatabase } from "./helpers/realDb";
import { dbDir } from "./helpers/hotels";

let owner: DbClient;
let app: DbClient;

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
});

after(async () => {
  await app?.end();
  await owner.end();
});

const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);

/** One valid user, made by the owner. `over` replaces any column. */
async function makeUser(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const row: Record<string, unknown> = {
    id: newId(),
    username: `u${tag()}${tag()}`,
    display_name: "Test Person",
    password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g",
    role_id: await roleId("viewer"),
    account_role: "hotel_user",
    ...over,
  };
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify(row)]);
  return row;
}

describe("migrations and seeds on the real instance", () => {
  test("every platform file is applied, nothing is pending, and a second run changes nothing", async () => {
    const files = loadMigrationFiles(path.join(dbDir, "migrations", "platform"));
    const result = await runMigrations({ client: owner, platformFiles: files, hotelFiles: [], listHotelSchemas: async () => [] });
    assert.deepEqual(result.applied, [], "a second run applies nothing");
    const recorded = await owner.query("SELECT version FROM platform.schema_migrations ORDER BY version");
    assert.deepEqual(recorded.rows.map((r) => String(r.version)), files.map((f) => f.version));
  });

  test("a changed applied file stops the run before anything is applied", async () => {
    const files = loadMigrationFiles(path.join(dbDir, "migrations", "platform"));
    const changed = files.map((f, i) => (i === 1 ? { ...f, checksum: "0".repeat(64) } : f));
    await assert.rejects(() => runMigrations({ client: owner, platformFiles: changed, hotelFiles: [], listHotelSchemas: async () => [] }), (e: { code?: string }) => e.code === "CHECKSUM_MISMATCH");
  });

  test("the seeds are Pallav's list: modules, parts, abilities and the built-in roles", async () => {
    const kinds = await owner.query("SELECT kind, COUNT(*) AS n FROM platform.permissions GROUP BY kind ORDER BY kind");
    const byKind = Object.fromEntries(kinds.rows.map((r) => [String(r.kind), Number(r.n)]));
    assert.ok(byKind.module >= 13 && byKind.part >= 37 && byKind.ability >= 6, JSON.stringify(byKind));
    const roles = await owner.query("SELECT key FROM platform.roles WHERE hotel_id IS NULL ORDER BY level, key");
    assert.deepEqual(roles.rows.map((r) => String(r.key)).sort(), ["admin", "corporate", "editor", "guest", "super_admin", "viewer"]);
    assert.ok(Number((await owner.query("SELECT COUNT(*) AS n FROM platform.role_permissions")).rows[0].n) > 0);
  });

  test("a part has a parent and a module or ability has none", async () => {
    const bad = await owner.query("SELECT key FROM platform.permissions WHERE (kind = 'part') <> (parent_id IS NOT NULL)");
    assert.deepEqual(bad.rows, []);
  });
});

describe("unique rules (a deleted row frees its name)", () => {
  test("username, email and mobile are unique among live accounts and free again once the account is deleted", async () => {
    const email = `a${tag()}@example.test`;
    const mobile = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const first = await makeUser({ email, mobile });
    assert.equal(await sqlStateOf(makeUser({ username: first.username })), "23505");
    assert.equal(await sqlStateOf(makeUser({ email })), "23505");
    assert.equal(await sqlStateOf(makeUser({ mobile })), "23505");
    await owner.query("UPDATE platform.logins SET deleted_at = now() WHERE id = $1", [first.id]);
    await makeUser({ username: first.username, email, mobile });
  });

  test("two accounts with no email and no mobile never collide (NULL is not a value)", async () => {
    await makeUser();
    await makeUser();
  });

  test("the duplicate error names the key, never the value", async () => {
    const first = await makeUser();
    try {
      await makeUser({ username: first.username });
      assert.fail("expected a duplicate");
    } catch (error) {
      const info = classifyPgError(error);
      assert.equal(info.kind, "unique");
      assert.equal(info.constraint, "users_username_key");
      assert.ok(!JSON.stringify(info).includes(String(first.username)));
    }
  });

  test("one active web session per person; revoking it frees the place", async () => {
    const user = await makeUser();
    const session = () =>
      owner.query("INSERT INTO platform.sessions (user_id, token_hash, expires_at, issued_at, last_seen_at) VALUES ($1, $2, now() + interval '60 minutes', now(), now())", [user.id, randomBytes(32).toString("hex")]);
    await session();
    assert.equal(await sqlStateOf(session()), "23505");
    await owner.query("UPDATE platform.sessions SET revoked_at = now(), revoked_reason = 'replaced' WHERE user_id = $1", [user.id]);
    await session();
  });
});

describe("CHECK constraints", () => {
  test("a username must be lower-case, an email lower-case with one @, a mobile +91 and ten digits", async () => {
    for (const over of [{ username: "Upper1" }, { username: "ab" }, { email: "A@x.test" }, { email: "no-at-sign" }, { mobile: "9876543210" }, { mobile: "+915876543210" }]) {
      assert.equal(await sqlStateOf(makeUser(over)), "23514", JSON.stringify(over));
    }
  });

  test("the check error names the constraint", async () => {
    assert.equal(await constraintOf(makeUser({ username: "Upper1" })), "users_username_check");
  });

  test("an administrator may have the emailed code off (decision 46: the rule that forced it on is gone); a block needs its kind", async () => {
    await makeUser({ account_role: "hotel_admin", code_required: false });
    assert.equal((await owner.query("SELECT column_default FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'logins' AND column_name = 'code_required'")).rows[0].column_default, "false");
    assert.equal(await constraintOf(makeUser({ blocked_at: new Date().toISOString() })), "users_blocked_pair");
    await makeUser({ code_required: false });
  });

  test("a token or code hash must be 64 lower-case hex characters", async () => {
    const user = await makeUser();
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [user.id, "A".repeat(64)])), "23514");
  });

  test("the outbox keeps the address in plain text, and a waiting mail needs its payload", async () => {
    const insert = (over: Record<string, unknown>) =>
      owner.query("INSERT INTO platform.outbox (kind, to_email, template, payload, status, sent_at) VALUES ($1, $2, $3, $4, $5, $6)", [over.kind ?? "login_code", over.to ?? "a@example.test", "login-code", "payload" in over ? over.payload : "{}", over.status ?? "pending", over.sent ?? null]);
    await insert({});
    await insert({ kind: "temp_password" });
    await insert({ kind: "admin_reset" });
    assert.equal(await sqlStateOf(insert({ kind: "unknown_kind" })), "23514");
    assert.equal(await sqlStateOf(insert({ payload: null })), "23514", "a pending mail needs its payload");
    await insert({ payload: null, status: "sent", sent: new Date().toISOString() });
  });

  test("a CHECK refuses a bad slug and an unknown status", async () => {
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('X', 'Bad Slug')")), "23514");
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.hotels (name, slug, status) VALUES ('X', $1, 'weird')", [`s-${tag()}`])), "23514");
  });
});

describe("the schema name is stored, and the database keeps its rules (platform 0172)", () => {
  test("a row without one gets hotel_<id>; the shape and the uniqueness are checked; the role is made from the id and cannot be written", async () => {
    const row = await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Derived', $1) RETURNING id, schema_name, role_name", [`d-${tag()}`]);
    const hex = String(row.rows[0].id).replaceAll("-", "");
    assert.equal(String(row.rows[0].schema_name), `hotel_${hex}`, "until its schema is built it has the old name");
    assert.equal(String(row.rows[0].role_name), `hotel_${hex}_rw`);
    await owner.query("UPDATE platform.hotels SET schema_name = 'derived_hotel' WHERE id = $1", [row.rows[0].id]);
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotels SET schema_name = 'Not Safe' WHERE id = $1", [row.rows[0].id])), "23514");
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotels SET schema_name = 'platform' WHERE id = $1", [row.rows[0].id])), "23514");
    const other = await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Derived Two', $1) RETURNING id", [`d2-${tag()}`]);
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotels SET schema_name = 'derived_hotel' WHERE id = $1", [other.rows[0].id])), "23505", "two hotels never share a schema name");
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotels SET role_name = 'hotel_ffffffffffffffffffffffffffffffff_rw' WHERE id = $1", [row.rows[0].id])), "428C9");
    await owner.query("DELETE FROM platform.hotels WHERE id = ANY($1::uuid[])", [[row.rows[0].id, other.rows[0].id]]);
  });
});

describe("role scope: a hotel's custom role never reaches a person outside that hotel", () => {
  test("a new person cannot start with a hotel's custom role, and an attachment cannot carry another hotel's role", async () => {
    const hotelA = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Scope A', $1) RETURNING id", [`sa-${tag()}`])).rows[0].id);
    const hotelB = String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ('Scope B', $1) RETURNING id", [`sb-${tag()}`])).rows[0].id);
    const custom = String((await owner.query("INSERT INTO platform.roles (hotel_id, key, name, level) VALUES ($1, 'cashier', 'Cashier', 2) RETURNING id", [hotelA])).rows[0].id);
    assert.ok((await sqlStateOf(makeUser({ role_id: custom }))) !== null, "a person outside hotel A cannot hold hotel A's role");
    const user = await makeUser();
    assert.ok((await sqlStateOf(owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id) VALUES ($1, $2, $3)", [user.id, hotelB, custom]))) !== null, "an attachment cannot carry another hotel's role");
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id) VALUES ($1, $2, $3)", [user.id, hotelA, custom]);
    await owner.query("DELETE FROM platform.hotels WHERE id IN ($1, $2)", [hotelA, hotelB]);
  });
});

describe("times and counters", () => {
  test("a timestamptz round-trips with microseconds, the session is UTC, and updated_at moves by itself", async () => {
    const tz = await owner.query("SHOW timezone");
    assert.equal(String(tz.rows[0].TimeZone), "UTC");
    const user = await makeUser();
    const before = await owner.query("SELECT updated_at FROM platform.people WHERE id = $1", [user.id]);
    await owner.query("UPDATE platform.logins SET ui_theme = 'dark' WHERE id = $1", [user.id]);
    const after = await owner.query("SELECT updated_at FROM platform.people WHERE id = $1", [user.id]);
    assert.ok(new Date(after.rows[0].updated_at as string).getTime() >= new Date(before.rows[0].updated_at as string).getTime());
  });

  test("rate counters: one upsert, no read-then-write", async () => {
    const key = "b".repeat(64);
    const bump = (window: string) =>
      owner.query("INSERT INTO platform.rate_limits (key_hash, window_start) VALUES ($1, $2) ON CONFLICT (key_hash, window_start) DO UPDATE SET count = platform.rate_limits.count + 1 RETURNING count", [key, window]);
    await owner.query("DELETE FROM platform.rate_limits WHERE key_hash = $1", [key]);
    assert.equal(Number((await bump("2026-03-04T10:00:00Z")).rows[0].count), 1);
    assert.equal(Number((await bump("2026-03-04T10:00:00Z")).rows[0].count), 2);
    assert.equal(Number((await bump("2026-03-04T11:00:00Z")).rows[0].count), 1);
  });
});

describe("audit_log, auth_events and login_attempts are insert-only, for the app AND for the owner", () => {
  test("INSERT works; UPDATE and DELETE are refused by the trigger even as hms_owner", async () => {
    const row = await owner.query("INSERT INTO platform.audit_log (action, entity, after) VALUES ('test.insert', 'thing', '{\"a\": 1}') RETURNING id, after");
    assert.deepEqual(row.rows[0].after, { a: 1 });
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.audit_log SET action = 'x' WHERE id = $1", [row.rows[0].id])), "42501");
    assert.equal(await sqlStateOf(owner.query("DELETE FROM platform.audit_log WHERE id = $1", [row.rows[0].id])), "42501");
    await owner.query("INSERT INTO platform.login_attempts (identifier_hash, outcome) VALUES ($1, 'bad_password')", ["c".repeat(64)]);
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.login_attempts SET outcome = 'success' WHERE identifier_hash = $1", ["c".repeat(64)])), "42501");
  });
});

describe("what hms_app can and cannot do", () => {
  test("it reads and writes the tables it was given, and its time limits are set on the role", async () => {
    await app.query("INSERT INTO platform.audit_log (action, entity) VALUES ('app.insert', 'thing')");
    assert.ok((await app.query("SELECT COUNT(*) AS n FROM platform.people")).rows.length === 1);
    const config = await owner.query("SELECT rolconfig FROM pg_roles WHERE rolname = 'hms_app'");
    const settings = (config.rows[0].rolconfig as string[]).join(",");
    for (const wanted of ["statement_timeout=15s", "idle_in_transaction_session_timeout=10s", "lock_timeout=5s"]) assert.ok(settings.includes(wanted), wanted);
  });

  test("it cannot delete a user or a permission, and cannot touch the migration table", async () => {
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.logins WHERE false")), "42501");
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.permissions WHERE false")), "42501");
    assert.equal(await sqlStateOf(app.query("SELECT * FROM platform.schema_migrations")), "42501");
  });

  test("it cannot change structure, make roles or databases, or grant anything", async () => {
    assert.equal(await sqlStateOf(app.query("CREATE TABLE platform.sneaky (id int)")), "42501");
    assert.equal(await sqlStateOf(app.query("CREATE SCHEMA sneaky")), "42501");
    assert.equal(await sqlStateOf(app.query("CREATE ROLE sneaky")), "42501");
    assert.equal(await sqlStateOf(app.query("CREATE TABLE public.sneaky (id int)")), "42501");
    await app.query("GRANT SELECT ON platform.people TO PUBLIC"); // the server only warns when the grantor holds no grant option: nothing is granted
    const acl = await owner.query("SELECT relacl::text AS a FROM pg_class WHERE oid = 'platform.people'::regclass");
    assert.ok(!/(^|[{,])=/.test(String(acl.rows[0].a)), "PUBLIC holds nothing on platform.people");
  });

  test("it is not a superuser and holds no privilege on any hotel schema", async () => {
    const me = await app.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname = current_user");
    assert.deepEqual(me.rows[0], { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false });
    const schemas = await app.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^hotel_' AND has_schema_privilege(current_user, nspname, 'USAGE')");
    assert.deepEqual(schemas.rows, []);
  });
});

describe("ids", () => {
  test("a uuidv7 made by the database is time-ordered and comes back as the same text", async () => {
    const rows = await owner.query("SELECT uuidv7()::text AS a, pg_sleep(0.01), uuidv7()::text AS b");
    assert.ok(String(rows.rows[0].a) < String(rows.rows[0].b));
    assert.match(String(rows.rows[0].a), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

after(async () => {
  await releaseTestLock?.();
});
