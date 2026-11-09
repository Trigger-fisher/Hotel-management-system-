// Invitations, the onboarding form and the provisioner on the REAL PostgreSQL instance (hms_test): the repositories of repos/postgres/platformInvitations.ts
// as hms_app, and provisionHotel (db/scripts/create-hotel.ts) as hms_owner: builds the schema of a hotel that waited for approval, all or nothing.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import { CreateHotelError, hotelRoleFor, provisionHotel } from "../../../common/db/scripts/create-hotel";
import { listHotelSchemas } from "../../../common/db/scripts/hotel-schemas";
import { toMigrationFile } from "../../../common/db/scripts/migrate";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createLocalProvisioner } from "../../src/server/provisioner/local";
import { ProvisionError } from "../../src/server/provisioner/port";
import type { PlatformConsoleRepos, PlatformConsoleUnit } from "../../src/server/repos/platformConsole";
import { createPgPlatformConsoleUnit } from "../../src/server/repos/postgres/platformConsole";
import { RepoError } from "../../src/server/repos/types";
import { hotelMigrations, hotelSeeds, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, ownerUrl, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let unit: PlatformConsoleUnit;
let actor: string;
const run = <T>(work: (r: PlatformConsoleRepos) => Promise<T>): Promise<T> => unit.run(work);
const NOW = new Date("2026-10-05T10:00:00.000Z");
const LATER = new Date(NOW.getTime() + 168 * 3_600_000);
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const tokenHash = (): string => createHash("sha256").update(randomUUID()).digest("hex");
const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);
const mobile = (): string => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const newInvite = (over: Partial<{ type: "individual" | "group" | "member_hotel"; hotelName: string; email: string; groupId: string | null; invitedByRole: "platform_admin" | "group_hotel_admin" }> = {}) => ({
  type: over.type ?? ("individual" as const), hotelName: over.hotelName ?? `Hotel ${tag()}`, contactName: "Pat Person", email: over.email ?? `${tag()}@example.test`, groupId: over.groupId ?? null,
  invitedBy: actor, invitedByRole: over.invitedByRole ?? ("platform_admin" as const),
});
const admin = () => {
  const t = tag() + tag();
  return { username: `u${t}`, email: `${t}@example.test`, mobile: mobile(), displayName: `Person ${t}`, passwordHash: HASH };
};
const hotelForm = (name: string) => ({ name, slug: `s-${tag()}${tag()}`, address: "1 Main Road", city: "Rajkot", state: "Gujarat", pin: "360001", gstin: "24ABCDE1234F1Z5", phone: "0281 2456789", email: "info@example.test", logoName: null });

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  unit = createPgPlatformConsoleUnit(pool);
  actor = randomUUID();
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Actor Platform', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'platform_admin', 'code_required', true)) AS id", [actor, `act${tag()}`, HASH, await roleId("admin")]);
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("invitations", () => {
  test("create, list, get, token lookup by hash only, opened once, clashes, resend, cancel, expiry sweep", async () => {
    const hash = tokenHash();
    const f = newInvite({ hotelName: "Invite Hotel", email: `inv${tag()}@example.test` });
    const id = await run((r) => r.invitations.create(f, hash, LATER, NOW));
    const got = await run((r) => r.invitations.get(id));
    assert.deepEqual([got?.status, got?.type, got?.invitedByName, got?.invitedByRole, got?.resendCount, got?.openedAt, got?.groupId], ["pending", "individual", "Actor Platform", "platform_admin", 0, null, null]);
    assert.equal(got?.expiresAt.toISOString(), LATER.toISOString());
    assert.ok((await run((r) => r.invitations.list())).some((x) => x.id === id));
    // the lookup is by the keyed hash; a different hash finds nothing; no row returned carries the hash
    const found = await run((r) => r.invitations.byTokenHash(hash));
    assert.equal(found?.invitation.id, id);
    assert.ok(!JSON.stringify(found).includes(hash), "no hash comes back");
    assert.equal(await run((r) => r.invitations.byTokenHash(tokenHash())), null);
    assert.equal(await run((r) => r.invitations.markOpened(id, NOW)), true);
    assert.equal(await run((r) => r.invitations.markOpened(id, NOW)), false, "opened once");
    // one pending invitation per e-mail and per name (per kind and group)
    assert.deepEqual(await run((r) => r.invitations.clashes({ type: "individual", groupId: null, hotelName: "  invite HOTEL ", email: "other@example.test", exceptId: null })), { email: false, name: true });
    assert.deepEqual(await run((r) => r.invitations.clashes({ type: "individual", groupId: null, hotelName: "Other", email: f.email, exceptId: null })), { email: true, name: false });
    assert.deepEqual(await run((r) => r.invitations.clashes({ type: "individual", groupId: null, hotelName: "Invite Hotel", email: f.email, exceptId: id })), { email: false, name: false });
    await assert.rejects(() => run((r) => r.invitations.create(newInvite({ email: f.email }), tokenHash(), LATER, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    await assert.rejects(() => run((r) => r.invitations.create(newInvite({ hotelName: "INVITE hotel" }), tokenHash(), LATER, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    // resend: the old link is revoked 'resent', the new one works, the count goes up
    const hash2 = tokenHash();
    await run((r) => r.invitations.reissue(id, hash2, LATER, actor, NOW));
    assert.equal((await run((r) => r.invitations.byTokenHash(hash)))?.link.revokeReason, "resent");
    assert.equal((await run((r) => r.invitations.byTokenHash(hash2)))?.link.revokedAt, null);
    assert.equal((await run((r) => r.invitations.get(id)))?.resendCount, 1);
    assert.equal((await owner.query("SELECT COUNT(*) AS n FROM platform.invitation_links WHERE invitation_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [id])).rows[0].n, "1", "one live link at a time");
    // cancel
    await run((r) => r.invitations.revoke(id, actor, NOW));
    assert.deepEqual([(await run((r) => r.invitations.get(id)))?.status, (await run((r) => r.invitations.byTokenHash(hash2)))?.link.revokeReason], ["revoked", "cancelled"]);
    await assert.rejects(() => run((r) => r.invitations.revoke(id, actor, NOW)), (e) => e instanceof RepoError);
    await assert.rejects(() => run((r) => r.invitations.reissue(id, tokenHash(), LATER, actor, NOW)), (e) => e instanceof RepoError);
    // the expiry sweep turns a pending invitation past its link's expiry into 'expired' and frees its name
    const hash3 = tokenHash();
    const old = await run((r) => r.invitations.create(newInvite({ hotelName: "Old Hotel", email: `old${tag()}@example.test` }), hash3, new Date(NOW.getTime() + 3_600_000), NOW));
    assert.equal(await run((r) => r.invitations.expireDue(NOW)), 0);
    assert.equal(await run((r) => r.invitations.expireDue(new Date(NOW.getTime() + 2 * 3_600_000))), 1);
    assert.deepEqual([(await run((r) => r.invitations.get(old)))?.status, (await run((r) => r.invitations.byTokenHash(hash3)))?.link.revokeReason], ["expired", "expired"]);
    assert.equal((await run((r) => r.invitations.clashes({ type: "individual", groupId: null, hotelName: "Old Hotel", email: "x@example.test", exceptId: null }))).name, false);
  });

  test("the database rules: a member hotel needs a group and a group admin sender; an individual has no group; links are single-use", async () => {
    assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.invitations (type, hotel_name, contact_name, email, invited_by, invited_by_role) VALUES ('member_hotel', 'X', 'Y', 'a@example.test', $1, 'group_hotel_admin')", [actor])), null, "member_hotel without a group");
    assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.invitations (type, hotel_name, contact_name, email, invited_by, invited_by_role) VALUES ('individual', 'X', 'Y', 'b@example.test', $1, 'group_hotel_admin')", [actor])), null, "type must match the sender");
    assert.notEqual(await sqlStateOf(app.query("DELETE FROM platform.invitations")), null, "no DELETE for the app");
    assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.invitation_links (invitation_id, token_hash, issued_by, expires_at) SELECT id, 'not-hex', $1, now() + interval '1 day' FROM platform.invitations LIMIT 1", [actor])), null, "token_hash must be 64 hex");
  });
});

describe("onboarding and the provisioner", () => {
  async function pendingHotel(name: string) {
    const hash = tokenHash();
    const invitationId = await run((r) => r.invitations.create(newInvite({ hotelName: name }), hash, LATER, NOW));
    const found = await run((r) => r.invitations.byTokenHash(hash));
    assert.ok(found);
    const a = admin();
    const made = await run((r) => r.onboarding.submitHotel({ invitationId, linkId: found.link.id, hotel: hotelForm(name), admin: a, payload: { contactName: "Pat", hotel: { name }, admin: { name: a.displayName } }, groupId: null, ip: "10.0.0.5", userAgent: "node-test", at: NOW }));
    return { ...made, invitationId, linkId: found.link.id, hash, admin: a, name };
  }

  test("submitHotel makes a pending hotel (no schema) and a pending account; the link is used; a second submit is refused; the schema list leaves it out", async () => {
    const p = await pendingHotel(`Pending ${tag()}`);
    const hotel = (await owner.query("SELECT status, provisioned_at, address, pin, gstin FROM platform.hotels WHERE id = $1", [p.hotelId])).rows[0];
    assert.deepEqual([hotel.status, hotel.provisioned_at, hotel.address, hotel.pin, hotel.gstin], ["pending_approval", null, "1 Main Road", "360001", "24ABCDE1234F1Z5"]);
    const user = (await owner.query("SELECT status, account_role, code_required FROM platform.people WHERE id = $1", [p.userId])).rows[0];
    assert.deepEqual([user.status, user.account_role, user.code_required], ["pending_approval", "hotel_admin", false]);
    assert.equal((await owner.query("SELECT 1 FROM platform.user_hotels WHERE user_id = $1 AND hotel_id = $2", [p.userId, p.hotelId])).rows.length, 1);
    const inv = await run((r) => r.invitations.get(p.invitationId));
    assert.deepEqual([inv?.status, inv?.hotelId], ["accepted", p.hotelId]);
    const link = await run((r) => r.invitations.byTokenHash(p.hash));
    assert.ok(link?.link.usedAt);
    await assert.rejects(() => run((r) => r.onboarding.submitHotel({ invitationId: p.invitationId, linkId: p.linkId, hotel: hotelForm("Again"), admin: admin(), payload: {}, groupId: null, ip: null, userAgent: null, at: NOW })), (e) => e instanceof RepoError && e.kind === "unique");
    assert.deepEqual(await run((r) => r.onboarding.pendingAccounts({ hotelId: p.hotelId })), [p.userId]);
    // the stored form can never hold a password (a CHECK at any depth)
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.onboarding_submissions SET payload = '{\"a\":{\"password\":\"x\"}}'::jsonb WHERE invitation_id = $1", [p.invitationId])), null);
    // a pending account has no session (the trigger backstop)
    assert.notEqual(await sqlStateOf(app.query("INSERT INTO platform.sessions (user_id, hotel_id, client, token_hash, expires_at) VALUES ($1, $2, 'web', $3, now() + interval '1 hour')", [p.userId, p.hotelId, tokenHash()])), null);
    // migrate and seed walk only hotels that have a schema
    const schemas = await listHotelSchemas(owner);
    const own = String((await owner.query("SELECT schema_name FROM platform.hotels WHERE id = $1", [p.hotelId])).rows[0].schema_name);
    assert.ok(!schemas.includes(own), "a hotel waiting for approval has no schema to migrate");
    await run((r) => r.onboarding.decide({ hotelId: p.hotelId }, "rejected", actor, "Not a real hotel", NOW));
    await assert.rejects(() => run((r) => r.onboarding.decide({ hotelId: p.hotelId }, "approved", actor, null, NOW)), (e) => e instanceof RepoError, "decided once");
  });

  test("provisionHotel builds the schema once and moves the row to active; a second call is NOT_PENDING; a failed build leaves nothing", async () => {
    const good = await pendingHotel(`Build ${tag()}`);
    const built = await provisionHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds() }, good.hotelId);
    // readable schemas (platform 0172): an individual hotel's schema is named for the hotel and the hotel's row holds it; the role stays hotel_<id>_rw
    assert.match(built.schema, /^build_[a-z0-9_]+$/);
    assert.equal((await owner.query("SELECT schema_name FROM platform.hotels WHERE id = $1", [good.hotelId])).rows[0].schema_name, built.schema);
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [built.schema])).rows.length, 1);
    assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [hotelRoleFor(good.hotelId)])).rows.length, 1);
    const row = (await owner.query("SELECT status, provisioned_at FROM platform.hotels WHERE id = $1", [good.hotelId])).rows[0];
    assert.equal(row.status, "active");
    assert.ok(row.provisioned_at);
    assert.ok((await listHotelSchemas(owner)).includes(built.schema));
    // the hotel's tables and seeds exist (the template ran)
    assert.ok(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${built.schema}".business_units`)).rows[0].n) >= 1);
    await assert.rejects(() => provisionHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds() }, good.hotelId), (e) => e instanceof CreateHotelError && e.code === "NOT_PENDING");

    const bad = await pendingHotel(`Broken ${tag()}`);
    // the name the failed build would have given its schema (a rolled-back build keeps the old name on the row)
    const badSchema = String((await owner.query("SELECT platform.hotel_schema_name_for($1::uuid) AS n", [bad.hotelId])).rows[0].n);
    assert.match(badSchema, /^broken_[a-z0-9_]+$/);
    const boom = toMigrationFile("0095_broken", "-- rollback: DROP TABLE IF EXISTS never;\nCREATE TABLE half_done (id int);\nSELECT 1 / 0;\n");
    await assert.rejects(() => provisionHotel({ owner, hotelMigrations: [...hotelMigrations(), boom], hotelSeeds: hotelSeeds() }, bad.hotelId), (e) => e instanceof CreateHotelError && e.code === "MIGRATION_FAILED");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [badSchema])).rows.length, 0, "no schema left behind");
    assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [hotelRoleFor(bad.hotelId)])).rows.length, 0, "no role left behind");
    const still = (await owner.query("SELECT status, provisioned_at FROM platform.hotels WHERE id = $1", [bad.hotelId])).rows[0];
    assert.deepEqual([still.status, still.provisioned_at], ["pending_approval", null]);
    // and the retry with the good template works
    assert.equal((await provisionHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds() }, bad.hotelId)).schema, badSchema);
    await assert.rejects(() => provisionHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds() }, randomUUID()), (e) => e instanceof CreateHotelError);
  });

  test("the LOCAL provisioner the web app uses: provision from another working directory, inspect, export (gzip, no password hash), drop; production refuses", async () => {
    const dbRoot = path.join(process.cwd(), "..", "common", "db");
    const exportDir = mkdtempSync(path.join(tmpdir(), "hms-export-"));
    const prov = createLocalProvisioner({ nodeEnv: "development", dbRoot, ownerUrl: ownerUrl(), exportDir });
    const here = process.cwd();
    try {
      const p = await pendingHotel(`Local ${tag()}`);
      // the Next server's working directory is web-app; a script may start anywhere: the pg package must load either way
      process.chdir(tmpdir());
      const built = await prov.provision({ hotelId: p.hotelId });
      process.chdir(here);
      assert.match(built.schema, /^local_[a-z0-9_]+$/);
      assert.equal((await owner.query("SELECT status FROM platform.hotels WHERE id = $1", [p.hotelId])).rows[0].status, "active");
      await assert.rejects(() => prov.provision({ hotelId: p.hotelId }), (e) => e instanceof ProvisionError && e.failure === "NOT_PENDING");

      const seen = await prov.inspect({ hotelIds: [p.hotelId, randomUUID()] });
      assert.ok(seen.latestMigration > 0);
      assert.ok(seen.hotels[p.hotelId].migrationsApplied > 0 && seen.hotels[p.hotelId].databaseMs !== null);
      assert.equal(Object.values(seen.hotels).filter((h) => h.databaseMs === null).length, 1, "an unknown hotel is reported down, not thrown");

      const slug = String((await owner.query("SELECT slug FROM platform.hotels WHERE id = $1", [p.hotelId])).rows[0].slug);
      const exported = await prov.exportHotel({ hotelId: p.hotelId, slug, at: NOW });
      assert.match(exported.fileName, new RegExp(`^${slug}-export-2026-10-05-[0-9a-f]{8}\\.ndjson\\.gz$`));
      assert.ok(existsSync(path.join(exportDir, exported.fileName)));
      const bytes = readFileSync(path.join(exportDir, exported.fileName));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), exported.sha256);
      assert.equal(bytes.length, exported.byteSize);
      const text = gunzipSync(bytes).toString("utf8");
      assert.ok(text.includes('"kind":"hotel"') && text.includes('"kind":"table"') && text.includes('"table":"business_units"'));
      assert.ok(!/password_hash|argon2id/.test(text), "no password hash in an export");

      await prov.dropHotel({ hotelId: p.hotelId, schema: built.schema });
      assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [built.schema])).rows.length, 0);
      assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [hotelRoleFor(p.hotelId)])).rows.length, 0);
      await prov.dropHotel({ hotelId: p.hotelId, schema: built.schema }); // again: nothing left, no error
      await assert.rejects(() => prov.dropHotel({ hotelId: p.hotelId, schema: "public" }), (e) => e instanceof ProvisionError && e.failure === "FAILED");
      const prod = createLocalProvisioner({ nodeEnv: "production", dbRoot, ownerUrl: ownerUrl(), exportDir });
      for (const call of [() => prod.provision({ hotelId: p.hotelId }), () => prod.inspect({ hotelIds: [] }), () => prod.exportHotel({ hotelId: p.hotelId, slug, at: NOW }), () => prod.dropHotel({ hotelId: p.hotelId, schema: built.schema })]) {
        await assert.rejects(call, (e) => e instanceof ProvisionError && e.failure === "NOT_CONFIGURED");
      }
    } finally {
      process.chdir(here);
      rmSync(exportDir, { recursive: true, force: true });
    }
  });

  test("submitGroup makes a pending group with a pending Group Hotel Admin; setLifecycle approves it; the decision is recorded once", async () => {
    const hash = tokenHash();
    const name = `Group ${tag()}`;
    const invitationId = await run((r) => r.invitations.create(newInvite({ type: "group", hotelName: name }), hash, LATER, NOW));
    const link = (await run((r) => r.invitations.byTokenHash(hash)))!.link;
    const a = admin();
    const made = await run((r) =>
      r.onboarding.submitGroup({
        invitationId, linkId: link.id, admin: a, payload: { contactName: "Pat", group: { name }, admin: { name: a.displayName } }, ip: null, userAgent: null, at: NOW,
        group: { name, slug: `g-${tag()}${tag()}`, legalName: "Group Pvt Ltd", gstin: "24ABCDE1234F1Z5", address: "1 Ring Road", city: "Rajkot", state: "Gujarat", pin: "360001", phone: "02812456789", email: "office@example.test" },
      }),
    );
    const g = await run((r) => r.groups.get(made.groupId));
    assert.deepEqual([g?.status, g?.admin?.id, g?.admin?.accountRole, g?.legalName], ["pending_approval", made.userId, "group_hotel_admin", "Group Pvt Ltd"]);
    const inv = await run((r) => r.invitations.get(invitationId));
    assert.deepEqual([inv?.status, inv?.madeGroupId, inv?.groupId], ["accepted", made.groupId, made.groupId]);
    assert.deepEqual(await run((r) => r.onboarding.pendingAccounts({ groupId: made.groupId })), [made.userId]);
    await run(async (r) => {
      await r.groups.setLifecycle(made.groupId, { status: "active", approvedAt: NOW });
      await r.accounts.setStatus(made.userId, "active", null);
      await r.onboarding.decide({ groupId: made.groupId }, "approved", actor, null, NOW);
    });
    const after = await run((r) => r.groups.get(made.groupId));
    assert.deepEqual([after?.status, after?.approvedAt?.toISOString()], ["active", NOW.toISOString()]);
    assert.equal((await run((r) => r.accounts.get(made.userId)))?.status, "active");
    await assert.rejects(() => run((r) => r.onboarding.decide({ groupId: made.groupId }, "rejected", actor, "late", NOW)), (e) => e instanceof RepoError);
    // a rejected group needs its reason
    await assert.rejects(() => run((r) => r.groups.setLifecycle(made.groupId, { status: "rejected", rejectedAt: NOW })), (e) => e instanceof RepoError);
  });
});
