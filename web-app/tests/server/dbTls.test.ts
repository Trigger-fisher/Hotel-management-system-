// The database TLS check (scripts/check-db-tls.mjs): what it says about an address, without a network.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkDatabaseUrl } from "../../scripts/check-db-tls.mjs";

type Finding = { name: string; ok: boolean; detail: string };
const check = (url: string, exists = true): Finding[] => checkDatabaseUrl(url, () => exists);
const ok = (f: Finding[]): boolean => f.every((x) => x.ok);

describe("check-db-tls: the address", () => {
  test("a hosted database needs verify-full AND a root certificate file", () => {
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/supabase.crt")), true);
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=require")), false, "require encrypts but does not check who answers");
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=verify-ca&sslrootcert=/x")), false);
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres")), false, "no sslmode at all");
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=verify-full")), false, "no certificate named");
    assert.equal(ok(check("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/missing.crt", false)), false, "the file does not exist");
  });
  test("a database on this machine is not asked for TLS; garbage is refused", () => {
    assert.equal(ok(check("postgresql://u:p@127.0.0.1:5432/hms")), true);
    assert.equal(ok(check("postgresql://u:p@localhost/hms")), true);
    assert.equal(ok(check("not an address")), false);
  });
  test("a finding never repeats the user, the password or the host", () => {
    const text = JSON.stringify(check("postgresql://secretuser:SecretPass9@secret-host.example:5432/db?sslmode=disable"));
    for (const word of ["secretuser", "SecretPass9", "secret-host"]) assert.ok(!text.includes(word), word);
  });
});
