// Checks that the app reaches the hosted database (Supabase) over a VERIFIED TLS connection (security plan 2026-11-01, section 6).  Usage, on the server:
//   DATABASE_URL=... node scripts/check-db-tls.mjs            (reads the same variable the app reads; or give it in the shell)
// 1. The address itself: a host that is not this machine must say sslmode=verify-full and name a root certificate file that exists (sslrootcert=...), otherwise the connection is encrypted
//    but the server's identity is not checked and a man in the middle would pass.
// 2. A real connection: the database itself says whether THIS connection is encrypted (pg_stat_ssl).
// It prints names and yes/no only, never the address, the user or the password. Exits 1 when a check fails.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The findings for an address, without touching the network: [{ name, ok, detail }]. Never includes a value from the address. */
export function checkDatabaseUrl(raw, fileExists = existsSync) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return [{ name: "DATABASE_URL is an address", ok: false, detail: "it could not be read" }];
  }
  if (LOCAL.has(url.hostname)) return [{ name: "database is on this machine", ok: true, detail: "TLS is not required on a local connection" }];
  const mode = url.searchParams.get("sslmode");
  const root = url.searchParams.get("sslrootcert");
  return [
    { name: "sslmode=verify-full", ok: mode === "verify-full", detail: mode === null ? "sslmode is missing: the connection may be plain" : `sslmode is ${mode}` },
    { name: "sslrootcert names a file that exists", ok: root !== null && root !== "" && fileExists(root), detail: root ? "the file was not found" : "sslrootcert is missing: download the database's CA certificate and name it" },
  ];
}

async function main() {
  const raw = (process.env.DATABASE_URL ?? "").trim();
  if (raw === "") {
    process.stderr.write("DATABASE_URL is not set\n");
    process.exit(2);
  }
  const failures = [];
  const show = (f) => {
    process.stdout.write(`${f.ok ? "ok  " : "FAIL"} ${f.name}${!f.ok && f.detail ? ` (${f.detail})` : ""}\n`);
    if (!f.ok) failures.push(f.name);
  };
  const findings = checkDatabaseUrl(raw);
  findings.forEach(show);
  if (findings.every((f) => f.ok)) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      const r = await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
      show({ name: "this connection is encrypted (pg_stat_ssl)", ok: r.rows[0]?.ssl === true, detail: "the database says it is not" });
    } catch (error) {
      show({ name: "can connect with the verified settings", ok: false, detail: error instanceof Error ? error.code ?? error.name : "error" });
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} check(s) failed\n`);
    process.exit(1);
  }
  process.stdout.write("\nall checks passed\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("the check could not run\n");
    process.exit(2);
  });
}
