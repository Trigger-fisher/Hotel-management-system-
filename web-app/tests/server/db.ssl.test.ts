// A hosted database is reached encrypted (3 Nov 2026: Supabase began refusing hms_app without SSL and every sign-in failed with ESSLREQUIRED); a local one stays plain.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/db.ssl.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sslOptionFor } from "../../src/db/pool";

describe("the connection to the database is encrypted when the database is not on this machine", () => {
  test("a hosted address is encrypted without chain checking, unless told to verify or to stay plain", () => {
    const url = "postgresql://hms_app.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    assert.deepEqual(sslOptionFor(url, undefined), { rejectUnauthorized: false });
    assert.equal(sslOptionFor(url, "verify"), true);
    assert.equal(sslOptionFor(url, "off"), undefined);
  });

  test("a local database stays plain", () => {
    for (const host of ["127.0.0.1:5433", "localhost:5432", "[::1]:5432"]) assert.equal(sslOptionFor(`postgresql://hms_app:pw@${host}/hms`, undefined), undefined, host);
  });

  test("an address that already says what it wants (sslmode) is left to the driver; a text that is not an address gives nothing", () => {
    assert.equal(sslOptionFor("postgresql://u:p@db.example.com:5432/x?sslmode=disable", undefined), undefined);
    assert.equal(sslOptionFor("postgresql://u:p@db.example.com:5432/x?application_name=a&sslmode=require", undefined), undefined);
    assert.equal(sslOptionFor("not a url", undefined), undefined);
  });
});
