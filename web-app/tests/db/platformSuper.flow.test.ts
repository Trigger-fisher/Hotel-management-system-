// The Super Admin's hotel export and permanent delete end to end on the REAL PostgreSQL instance (hms_test): the console services on the real repositories
// (hms_app) with the LOCAL provisioner (hms_owner) that the web app uses. A real hotel schema is built, archived past its grace period, exported to a file,
// deleted for good: the deletion record and audit are kept, the schema and role are gone, the accounts are closed, and health sees a live hotel.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { hotelRoleFor } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createArgon2Hasher } from "../../src/server/auth/password";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPlatformServices } from "../../src/server/compose/platform";
import { createLocalProvisioner } from "../../src/server/provisioner/local";
import { createPgPlatformConsoleUnit } from "../../src/server/repos/postgres/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { platformMeta } from "../../src/server/services/platform/access";
import { createTestHotel, dbDir, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, ownerUrl, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let exportDir: string;
let superId: string;
let platformId: string;
let services: ReturnType<typeof buildPlatformServices>;
const meta = () => platformMeta(new Request("https://hms.test/x", { headers: { "user-agent": "node-test" } }), `trace-${tag()}${tag()}`);
const session = (userId: string, accountRole: "super_admin" | "platform_admin"): VerifiedSession => ({
  userId, hotelId: "", accountRole, roleId: randomUUID(), roleKey: "admin", roleLevel: 3, permissions: {}, sessionId: randomUUID(), client: "web",
});

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 6 });
  exportDir = mkdtempSync(path.join(tmpdir(), "hms-super-"));
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  superId = randomUUID();
  platformId = randomUUID();
  for (const [id, kind] of [[superId, "super_admin"], [platformId, "platform_admin"]] as const) {
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', $3::text, 'password_hash', $4::text, 'role_id', $5::uuid, 'account_role', $6::text, 'code_required', true, 'email', $7::text)) AS id", [id, `${kind}${tag()}`, `Person ${kind}`, HASH, role, kind, `${tag()}@example.test`]);
  }
  const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
  const now = (): Date => new Date();
  services = buildPlatformServices({
    unit: createPgPlatformConsoleUnit(pool), credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: "https://hms.test",
    newToken: () => randomBytes(8).toString("hex"), hashKey: randomBytes(32),
    provisioner: createLocalProvisioner({ nodeEnv: "development", dbRoot: dbDir, ownerUrl: ownerUrl(), exportDir }),
  });
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  if (owner) await owner.query("DELETE FROM platform.logins WHERE id = ANY($1::uuid[])", [[superId, platformId]]).catch(() => undefined);
  await owner?.end();
  rmSync(exportDir, { recursive: true, force: true });
  await releaseTestLock?.();
});

describe("export and permanent delete on a real hotel schema", () => {
  test("health sees the live hotel; export writes a real file; delete drops the schema and role and keeps the record and the audit", async () => {
    const built = await createTestHotel(owner, "Flow Hotel");
    const hotelId = built.id;
    const slug = String((await owner.query("SELECT slug FROM platform.hotels WHERE id = $1", [hotelId])).rows[0].slug);
    const adminId = randomUUID();
    await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Flow Admin', 'password_hash', $3::text, 'role_id', (SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL), 'account_role', 'hotel_admin', 'code_required', true)) AS id", [adminId, `flow${tag()}`, HASH]);
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [adminId, hotelId]);

    const sa = session(superId, "super_admin");
    const health = await services.health.get(sa);
    const row = health.rows.find((r) => r.hotelId === hotelId);
    assert.ok(row, "a live hotel is in the health page");
    assert.deepEqual([row.database, row.migrationsPending, row.migrationsApplied > 0, health.latestMigration > 0], ["ok", 0, true, true]);

    // not archived: refused, nothing dropped
    await assert.rejects(() => services.archive.deletePermanently(sa, hotelId, slug, meta()), (e) => (e as { code?: string }).code === "CONFLICT");
    const exported = await services.archive.exportData(sa, hotelId, meta());
    assert.match(exported.fileName, new RegExp(`^${slug}-export-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{8}\\.ndjson\\.gz$`));
    const bytes = readFileSync(path.join(exportDir, exported.fileName));
    const text = gunzipSync(bytes).toString("utf8");
    assert.ok(text.includes('"table":"business_units"') && text.includes("Flow Admin") && !/argon2id|password_hash/.test(text));
    const stored = (await owner.query("SELECT status, file_sha256, byte_size FROM platform.hotel_exports WHERE hotel_id = $1", [hotelId])).rows[0];
    assert.deepEqual([stored.status, stored.file_sha256, Number(stored.byte_size)], ["ready", createHash("sha256").update(bytes).digest("hex"), bytes.length]);

    // archive it (the Platform console does this with the hotel service); the grace period is already over
    await owner.query("UPDATE platform.hotels SET status = 'archived', archived_at = now() - interval '100 days', archive_reason = 'Closed', restore_until = now() - interval '10 days', status_before_archive = 'active' WHERE id = $1", [hotelId]);
    const listed = (await services.archive.list(sa, {})).find((h) => h.id === hotelId);
    assert.deepEqual([listed?.canDelete, listed?.daysLeft, listed?.exportFileName], [true, 0, exported.fileName]);

    await assert.rejects(() => services.archive.deletePermanently(session(platformId, "platform_admin"), hotelId, slug, meta()), (e) => (e as { code?: string }).code === "FORBIDDEN");
    await assert.rejects(() => services.archive.deletePermanently(sa, hotelId, `${slug}-typo`, meta()), (e) => (e as { code?: string }).code === "VALIDATION_FAILED");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [built.schema])).rows.length, 1, "refusals dropped nothing");

    const gone = await services.archive.deletePermanently(sa, hotelId, slug, meta());
    assert.deepEqual([gone.hotelId, gone.name], [hotelId, "Flow Hotel"]);
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [built.schema])).rows.length, 0, "the schema is gone");
    assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [hotelRoleFor(built.id)])).rows.length, 0, "the role is gone");
    const h = (await owner.query("SELECT status, deleted_at FROM platform.hotels WHERE id = $1", [hotelId])).rows[0];
    assert.deepEqual([h.status, h.deleted_at !== null], ["deleted", true]);
    assert.equal(Number((await owner.query("SELECT COUNT(*) AS n FROM platform.hotel_deletions WHERE hotel_id = $1 AND deleted_by = $2 AND confirm_slug = $3", [hotelId, superId, slug])).rows[0].n), 1);
    assert.equal((await owner.query("SELECT deleted_at FROM platform.people WHERE id = $1", [adminId])).rows[0].deleted_at !== null, true, "the hotel's admin account is closed");
    const audit = (await owner.query("SELECT action, result, scope FROM platform.audit_log WHERE hotel_id = $1 AND action IN ('hotel_exported', 'hotel_deleted') ORDER BY at, id", [hotelId])).rows;
    assert.deepEqual(audit.map((a) => [a.action, a.result, a.scope]), [["hotel_deleted", "failed", "platform"], ["hotel_exported", "success", "platform"], ["hotel_deleted", "failed", "platform"], ["hotel_deleted", "failed", "platform"], ["hotel_deleted", "success", "platform"]]);
    assert.equal(existsSync(path.join(exportDir, exported.fileName)), true, "the export file is kept after the delete");
    assert.equal((await services.archive.list(sa, {})).some((x) => x.id === hotelId), false);
  });
});
