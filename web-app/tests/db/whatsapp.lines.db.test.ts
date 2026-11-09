// The Console's list of WhatsApp numbers on the REAL PostgreSQL, throwaway hms_test only. It once asked for the name of the person who connected a number from platform.users, a table migration 0155 had
// retired, so the list answered 500 on the live site. The list and the single read must work against the real tables and show that person's name from the profile list. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { randomBytes } from "node:crypto";
import { createDatabase, type Database } from "../../src/db";
import { createPgLineAdminStore } from "../../src/server/repos/postgres/whatsappLines";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { sealToken } from "../../src/server/whatsapp/seal";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

const ENV = { WHATSAPP_APP_SECRET: "db-app-secret", WHATSAPP_VERIFY_TOKEN: "db-verify", HMS_HASH_KEY: randomBytes(32).toString("base64") };
const PHONE_ID = "1055550003333";
let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let lineId = "";
let person: { id: string; name: string } | null = null;
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await q("DELETE FROM platform.whatsapp_lines");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  const p = (await q("SELECT login_id, display_name FROM platform.login_profiles WHERE display_name IS NOT NULL LIMIT 1")).rows[0];
  person = p ? { id: String(p.login_id), name: String(p.display_name) } : null;
  lineId = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret, connected_by) VALUES ('shared', $2, '2055550003333', 'test', $3, $1) RETURNING id", [person?.id ?? null, PHONE_ID, sealToken(whatsappConfig(ENV)!.sealKey, "EAAG-test", PHONE_ID)])).rows[0].id);
});
after(async () => {
  await database?.close();
  if (owner) await q("DELETE FROM platform.whatsapp_lines").catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("the WhatsApp numbers list on PostgreSQL", () => {
  test("the list and one read work, and the person who connected the number is named from the profile list", async () => {
    const store = createPgLineAdminStore(database.pool);
    const lines = await store.list();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, lineId);
    const one = await store.get(lineId);
    assert.equal(one?.connectedByName ?? null, person?.name ?? null);
  });
});
