// The WhatsApp permission on the REAL PostgreSQL (platform 0186), throwaway hms_test only: WhatsApp is a module of its own beside Conversations, and no role that had Conversations lost WhatsApp when it
// was split off (the built-in roles and a hotel's own role alike hold the same level of both). Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
});
after(async () => {
  await owner?.end();
  await release?.();
});

describe("the WhatsApp permission", () => {
  test("it is a module of the Front Office group, listed next to Conversations", async () => {
    const r = await owner.query("SELECT kind, label, group_name FROM platform.permissions WHERE key = 'whatsapp'");
    assert.deepEqual(r.rows[0], { kind: "module", label: "WhatsApp", group_name: "Front Office" });
  });

  test("every role with Conversations holds WhatsApp at the same level", async () => {
    const missing = await owner.query(
      `SELECT rp.role_id FROM platform.role_permissions rp
         JOIN platform.permissions c ON c.id = rp.permission_id AND c.key = 'conversations'
        WHERE NOT EXISTS (SELECT 1 FROM platform.role_permissions x JOIN platform.permissions w ON w.id = x.permission_id AND w.key = 'whatsapp' WHERE x.role_id = rp.role_id AND x.level = rp.level)`,
    );
    assert.equal(missing.rows.length, 0);
  });

  test("a role set up with Email only (no WhatsApp grant) stays that way: the back-fill never adds to a role without Conversations", async () => {
    const stray = await owner.query(
      `SELECT x.role_id FROM platform.role_permissions x JOIN platform.permissions w ON w.id = x.permission_id AND w.key = 'whatsapp'
        WHERE NOT EXISTS (SELECT 1 FROM platform.role_permissions rp JOIN platform.permissions c ON c.id = rp.permission_id AND c.key = 'conversations' WHERE rp.role_id = x.role_id)`,
    );
    assert.equal(stray.rows.length, 0);
  });
});
