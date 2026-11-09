// The login directory and the role tables (platform migration 0142, 1 Nov 2026) on the REAL database: every person of platform.people has one login (same id), one profile row in
// the table of their role and in no other, and platform.create_person and platform.change_person keep all of it in step on insert, change of role or details, delete and a username shared by two people.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { newId } from "../../src/server/db/ids";
import { connectApp, connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let owner: DbClient;
let release: (() => Promise<void>) | undefined;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const TABLES = ["super_admins", "platform_admins", "group_hotel_admins", "hotel_admins", "hotel_users", "corporate_users", "guest_users"] as const;
const TABLE_OF: Record<string, (typeof TABLES)[number]> = {
  super_admin: "super_admins", platform_admin: "platform_admins", group_hotel_admin: "group_hotel_admins", hotel_admin: "hotel_admins", hotel_user: "hotel_users", corporate_user: "corporate_users", guest_user: "guest_users",
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
});
after(async () => {
  await owner.end();
  await release?.();
});

const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);

async function makeUser(accountRole: string, over: Record<string, unknown> = {}): Promise<{ id: string; username: string }> {
  const id = newId();
  const username = `d${tag()}${tag()}`;
  const row: Record<string, unknown> = { id, username, display_name: "Directory Person", password_hash: HASH, role_id: await roleId("viewer"), account_role: accountRole, code_required: true, ...over };
  await owner.query("SELECT platform.create_person($1::jsonb)", [JSON.stringify(row)]);
  return { id, username };
}

/** The profile tables that hold this login: there must be exactly the one of its role. */
async function profilesOf(id: string): Promise<string[]> {
  const found: string[] = [];
  for (const t of TABLES) if ((await owner.query(`SELECT 1 FROM platform.${t} WHERE login_id = $1`, [id])).rows.length) found.push(t);
  return found;
}

describe("the login directory", () => {
  test("a new person gets one login (the same id) and one profile row in the table of their role only", async () => {
    for (const role of Object.keys(TABLE_OF)) {
      const u = await makeUser(role);
      const login = (await owner.query("SELECT id, username, role_type, status FROM platform.logins WHERE id = $1", [u.id])).rows[0];
      assert.deepEqual([login?.id, login?.username, login?.role_type, login?.status], [u.id, u.username, role, "active"], role);
      assert.deepEqual(await profilesOf(u.id), [TABLE_OF[role]], `${role}: only its own table`);
    }
  });

  test("the role table holds the name; the login holds the email and mobile, once", async () => {
    const u = await makeUser("hotel_admin", { display_name: "Anita Shah", email: `a${tag()}@hotel.in`, mobile: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` });
    const p = { ...(await owner.query("SELECT display_name FROM platform.hotel_admins WHERE login_id = $1", [u.id])).rows[0], ...(await owner.query("SELECT email, mobile FROM platform.logins WHERE id = $1", [u.id])).rows[0] };
    const src = (await owner.query("SELECT display_name, email, mobile FROM platform.people WHERE id = $1", [u.id])).rows[0];
    assert.deepEqual(p, src);
    assert.equal(p.display_name, "Anita Shah");
  });

  test("a change of details, password, lock or block on the person is followed by the login and the profile", async () => {
    const u = await makeUser("guest_user");
    await owner.query("SELECT platform.change_person($1::uuid, jsonb_build_object('display_name', 'New Name', 'failed_attempts', 3, 'lock_level', 1, 'locked_until', now() + interval '15 minutes', 'last_login_at', now()))", [u.id]);
    const login = (await owner.query("SELECT failed_attempts, lock_level, locked_until, last_login_at FROM platform.logins WHERE id = $1", [u.id])).rows[0];
    assert.equal(login.failed_attempts, 3);
    assert.equal(login.lock_level, 1);
    assert.ok(login.locked_until && login.last_login_at);
    assert.equal((await owner.query("SELECT display_name FROM platform.guest_users WHERE login_id = $1", [u.id])).rows[0].display_name, "New Name");
    await owner.query("UPDATE platform.logins SET blocked_at = now(), blocked_kind = 'admin', status = 'disabled' WHERE id = $1", [u.id]);
    const blocked = (await owner.query("SELECT blocked_kind, status FROM platform.logins WHERE id = $1", [u.id])).rows[0];
    assert.deepEqual([blocked.blocked_kind, blocked.status], ["admin", "disabled"]);
  });

  test("a person whose role changes moves to the new role's table and leaves the old one", async () => {
    const u = await makeUser("hotel_user");
    assert.deepEqual(await profilesOf(u.id), ["hotel_users"]);
    await owner.query("SELECT platform.change_person($1::uuid, '{\"account_role\": \"hotel_admin\"}'::jsonb)", [u.id]);
    assert.deepEqual(await profilesOf(u.id), ["hotel_admins"]);
    assert.equal((await owner.query("SELECT role_type FROM platform.logins WHERE id = $1", [u.id])).rows[0].role_type, "hotel_admin");
  });

  test("deleting the person removes the login and the profile", async () => {
    const u = await makeUser("corporate_user");
    await owner.query("DELETE FROM platform.logins WHERE id = $1", [u.id]);
    assert.equal((await owner.query("SELECT 1 FROM platform.logins WHERE id = $1", [u.id])).rows.length, 0);
    assert.deepEqual(await profilesOf(u.id), []);
  });

  test("the username is unique across every role in the login directory", async () => {
    const a = await makeUser("hotel_admin");
    const dup = { id: newId(), username: a.username };
    // platform.create_person refuses a second live person with the same username; the login table itself must hold the same line
    await assert.rejects(
      owner.query("INSERT INTO platform.logins (id, username, role_type, role_id, password_hash) VALUES ($1, $2, 'guest_user', (SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL), $3)", [dup.id, dup.username, HASH]),
      (e: unknown) => /logins_username_key|duplicate key|foreign key/i.test(String((e as Error).message)),
    );
  });

  test("every existing person has exactly one login and one profile (the copy of the migration is complete)", async () => {
    const missing = (await owner.query("SELECT count(*)::int AS n FROM platform.people u WHERE u.account_role <> 'employee_user' AND NOT EXISTS (SELECT 1 FROM platform.logins l WHERE l.id = u.id)")).rows[0].n;
    assert.equal(missing, 0);
    const profiles = (
      await owner.query(
        `SELECT (SELECT count(*) FROM platform.super_admins) + (SELECT count(*) FROM platform.platform_admins) + (SELECT count(*) FROM platform.group_hotel_admins)
              + (SELECT count(*) FROM platform.hotel_admins) + (SELECT count(*) FROM platform.hotel_users) + (SELECT count(*) FROM platform.corporate_users) + (SELECT count(*) FROM platform.guest_users) AS n`,
      )
    ).rows[0].n;
    const logins = (await owner.query("SELECT count(*) AS n FROM platform.logins")).rows[0].n;
    assert.equal(String(profiles), String(logins), "one profile row per login");
  });
});

describe("what the web app may do with the directory (migrations 0143 and 0144)", () => {
  test("hms_app can read the directory and write only the sign-in fields, never the username, the role or the deleted flag", async () => {
    const u = await makeUser("guest_user");
    const app = await connectApp();
    try {
      const found = (await app.query("SELECT id FROM platform.logins WHERE username = $1 AND deleted_at IS NULL", [u.username])).rows[0];
      assert.equal(String(found?.id), u.id);
      await app.query("UPDATE platform.logins SET failed_attempts = 2, lock_level = 1 WHERE id = $1", [u.id]);
      const copied = (await owner.query("SELECT failed_attempts, lock_level FROM platform.people WHERE id = $1", [u.id])).rows[0];
            assert.deepEqual([copied.failed_attempts, copied.lock_level], [2, 1], "a sign-in change is what platform.people shows");
            await assert.rejects(app.query("UPDATE platform.logins SET username = 'someone-else' WHERE id = $1", [u.id]), /permission denied/i);
            await assert.rejects(app.query("UPDATE platform.logins SET role_type = 'super_admin' WHERE id = $1", [u.id]), /permission denied/i);
            await assert.rejects(app.query("UPDATE platform.logins SET deleted_at = now() WHERE id = $1", [u.id]), /permission denied/i);
      await assert.rejects(app.query("DELETE FROM platform.logins WHERE id = $1", [u.id]), /permission denied/i);
      await assert.rejects(app.query("SELECT 1 FROM platform.guest_users"), /permission denied/i, "the role tables stay closed to the app for now");
    } finally {
      await app.end();
    }
  });
});