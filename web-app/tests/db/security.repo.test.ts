// The security layer (platform migration 0173) on the REAL PostgreSQL instance, as hms_app: the repository's SQL (repos/postgres/security.ts) and the tables' own CHECKs
// (a kind and a severity are validated, a layer is 1 to 3, the approver of a reset is never its requester). Needs `npm run db:cli -- setup` first.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createPgSecurity } from "../../src/server/repos/postgres/security";
import type { SecurityRepo } from "../../src/server/repos/security";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let repo: SecurityRepo;
let asha: string;
let bala: string;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const MARK = `sec-${randomBytes(4).toString("hex")}`;

async function person(name: string): Promise<string> {
  const id = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', $3::text, 'password_hash', $4::text, 'role_id', $5::uuid, 'account_role', 'super_admin', 'code_required', true)) AS id", [id, `${name}${tag()}`.toLowerCase(), name, HASH, role]);
  return id;
}

before(async () => {
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  repo = createPgSecurity(pool);
  asha = await person("Asha");
  bala = await person("Bala");
});

after(async () => {
  await owner?.query("DELETE FROM platform.security_events WHERE trace_id = $1", [MARK]).catch(() => undefined);
  await owner?.query("DELETE FROM platform.security_resets WHERE requested_by = ANY($1::uuid[])", [[asha, bala]]).catch(() => undefined);
  await pool?.end();
  await app?.end();
  await owner?.end();
  await releaseTestLock?.();
});

describe("security events", () => {
  test("an event is stored, its delivery marks are updated, and the list is newest first and filterable", async () => {
    const at = new Date();
    const critical = await repo.addEvent({ severity: "critical", kind: "honeypot_hit", summary: "Decoy address requested: GET /.env", detail: { path: "/.env", n: 1, flag: true }, ip: "203.0.113.7", traceId: MARK, at });
    await repo.addEvent({ severity: "warning", kind: "failed_login_burst", summary: "locked", detail: {}, ip: null, traceId: MARK, at: new Date(at.getTime() + 1) });
    await repo.markAlerted(critical, "sent", "throttled");
    const all = (await repo.listEvents({ limit: 200 })).filter((e) => e.traceId === MARK);
    assert.deepEqual(all.map((e) => e.kind), ["failed_login_burst", "honeypot_hit"]);
    const stored = all[1]!;
    assert.deepEqual([stored.slack, stored.sms, stored.ip], ["sent", "throttled", "203.0.113.7"]);
    assert.deepEqual(stored.detail, { path: "/.env", n: 1, flag: true });
    assert.deepEqual((await repo.listEvents({ severity: "critical", limit: 200 })).filter((e) => e.traceId === MARK).map((e) => e.kind), ["honeypot_hit"]);
  });

  test("the table refuses an unknown severity, a malformed kind and a bad delivery mark", async () => {
    const base = ["warning", "ok_kind", "x", "{}", MARK] as const;
    const insert = (severity: string, kind: string) => app.query("INSERT INTO platform.security_events (severity, kind, summary, detail, trace_id) VALUES ($1, $2, $3, $4::jsonb, $5)", [severity, kind, base[2], base[3], base[4]]);
    assert.equal(await sqlStateOf(insert("info", "ok_kind")), "23514");
    assert.equal(await sqlStateOf(insert("warning", "Bad Kind!")), "23514");
    assert.equal(await sqlStateOf(app.query("UPDATE platform.security_events SET slack_status = 'maybe' WHERE trace_id = $1", [MARK])), "23514");
  });

  test("hms_app cannot delete an event", async () => {
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.security_events WHERE trace_id = $1", [MARK])), "42501");
  });
});

describe("security resets", () => {
  test("a layer 3 reset is created waiting, approved by someone else exactly once, and finished with its steps", async () => {
    const id = await repo.createReset({ layer: 3, state: "awaiting_approval", reason: "leaked credential", requestedBy: asha, requestedByName: "Asha", at: new Date() });
    assert.equal((await repo.getReset(id))?.state, "awaiting_approval");
    assert.equal(await repo.transitionReset(id, "awaiting_approval", { state: "running", approvedBy: bala, approvedByName: "Bala" }), true);
    assert.equal(await repo.transitionReset(id, "awaiting_approval", { state: "running", approvedBy: bala, approvedByName: "Bala" }), false, "the second approval loses");
    await repo.updateReset(id, { state: "healthy", steps: [{ name: "rotate", ok: true, detail: "done" }], healthOk: true, healthDetail: "RLS intact", finishedAt: new Date() });
    const row = (await repo.getReset(id))!;
    assert.deepEqual([row.state, row.approvedByName, row.healthOk, row.steps[0]?.name], ["healthy", "Bala", true, "rotate"]);
    assert.ok((await repo.listResets(200)).some((r) => r.id === id));
  });

  test("the database itself refuses an approver who is the requester, and a layer outside 1 to 3", async () => {
    const id = await repo.createReset({ layer: 3, state: "awaiting_approval", reason: "leaked credential", requestedBy: asha, requestedByName: "Asha", at: new Date() });
    assert.equal(await sqlStateOf(app.query("UPDATE platform.security_resets SET approved_by = $2 WHERE id = $1", [id, asha])), "23514");
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.security_resets (layer, state, reason, requested_by_name) VALUES (4, 'running', 'x', 'x')")), "23514");
  });
});
