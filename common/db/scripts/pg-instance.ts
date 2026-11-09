// HMS's OWN PostgreSQL 18 instance, run as a normal user process (no Windows service, no administrator needed). MJ's final decision: PostgreSQL
// (Backend Review/08-POSTGRES-FINAL.md).
//
//   npm run db:pg -- ensure   first time: initdb, start, set up; later: start if not running
//   npm run db:pg -- start | stop | status
//
// HARD RULES (checked by `assertHmsPaths` before anything is touched):
//   * The PostgreSQL that is installed as a Windows service on this PC, and its postgres password, are NEVER started, stopped, connected to, reset
//     or read. This script only ever touches %LOCALAPPDATA%\HMS\pg and port 5433, and refuses any other data directory or port.
//   * Listens on 127.0.0.1 only; every login needs a password (scram-sha-256), there is no trust rule anywhere.
//   * The superuser (hms_super) password is generated here, written to db\.env.local as PGSUPERUSER_URL BEFORE initdb runs, handed to initdb
//     through a pwfile (mode 0600, deleted right after), and never printed, logged or put in a message.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createEnvStore } from "./env-store";
import { connectPg, pgUrl } from "./pg-db";

export const PG_PORT = 5433;
export const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
export const PG_SUPERUSER = "hms_super";
/** The folder of the other PostgreSQL install (the Windows service): never to be used. */
const OTHER_MARKERS = ["program files\\postgresql", "programdata\\postgresql", "\\postgresql\\18\\data"];

export function pgHome(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA;
  if (!base) throw new Error("LOCALAPPDATA is not set");
  return path.join(base, "HMS", "pg");
}

export interface PgPaths {
  home: string;
  data: string;
  log: string;
  pwfile: string;
  secured: string;
}

export function pgPathsFor(home: string): PgPaths {
  return { home, data: path.join(home, "data"), log: path.join(home, "postgres.log"), pwfile: path.join(home, "initdb.pw"), secured: path.join(home, "initialised") };
}

/** Refuses to act on anything that is not the HMS folder and port (and above all never the PostgreSQL service install). */
export function assertHmsPgPaths(p: PgPaths, port: number, env: NodeJS.ProcessEnv = process.env): void {
  const expected = path.resolve(pgHome(env)).toLowerCase();
  if (path.resolve(p.home).toLowerCase() !== expected) throw new Error("Refusing: the PostgreSQL folder is not the HMS one");
  for (const value of [p.data, p.log, p.pwfile, p.secured]) {
    const resolved = path.resolve(value).toLowerCase();
    if (!resolved.startsWith(expected + path.sep)) throw new Error("Refusing: a path is outside the HMS PostgreSQL folder");
    if (OTHER_MARKERS.some((m) => resolved.includes(m))) throw new Error("Refusing: that path belongs to the other PostgreSQL install");
  }
  if (port !== PG_PORT) throw new Error("Refusing: the HMS PostgreSQL instance uses port 5433 only");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1000 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

/** Does something answer on the HMS port with the superuser password? (never prints it) */
async function superLogin(url: string): Promise<boolean> {
  try {
    const db = await connectPg(url, { connectionTimeoutMillis: 2000 });
    await db.end();
    return true;
  } catch {
    return false;
  }
}

function run(exe: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(PG_BIN, exe), args, { stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export interface PgInstanceDeps {
  env: { get(name: string): string | undefined; append(entries: readonly (readonly [string, string])[]): void };
  say: (message: string) => void;
}

/** The options the server always runs with (nothing is written into postgresql.conf: they are on the command line). */
export function serverOptions(): string {
  return [`-p ${PG_PORT}`, "-c listen_addresses=127.0.0.1", "-c max_connections=100", "-c password_encryption=scram-sha-256", "-c log_connections=off", "-c timezone=UTC", "-c log_timezone=UTC"].join(" ");
}

export async function startPg(deps: PgInstanceDeps, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const p = pgPathsFor(pgHome(environment));
  assertHmsPgPaths(p, PG_PORT, environment);
  mkdirSync(p.home, { recursive: true });
  let url = deps.env.get("PGSUPERUSER_URL");
  if (url && (await superLogin(url))) {
    deps.say("The HMS PostgreSQL instance is already running.");
    return;
  }
  if (await portInUse(PG_PORT)) throw new Error("Port 5433 is already in use by something that is not accepting the HMS superuser login");

  const initialised = existsSync(path.join(p.data, "PG_VERSION"));
  if (!initialised) {
    if (existsSync(p.data) && readdirSync(p.data).length > 0) throw new Error("The HMS PostgreSQL data folder exists but is not a valid cluster; remove it or fix it by hand");
    deps.say("Initialising the HMS PostgreSQL data directory (first run)...");
    if (!url) {
      const password = randomBytes(24).toString("base64url");
      deps.env.append([["PGSUPERUSER_URL", pgUrl({ user: PG_SUPERUSER, password, database: "postgres" })]]);
      url = deps.env.get("PGSUPERUSER_URL");
    }
    if (!url) throw new Error("PGSUPERUSER_URL could not be saved");
    writeFileSync(p.pwfile, decodeURIComponent(new URL(url).password), { encoding: "utf8", mode: 0o600 });
    try {
      const code = await run("initdb.exe", [`--pgdata=${p.data}`, `--username=${PG_SUPERUSER}`, "--auth=scram-sha-256", `--pwfile=${p.pwfile}`, "--encoding=UTF8", "--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--locale=C"]);
      if (code !== 0) throw new Error(`initdb failed (exit ${code})`);
    } finally {
      rmSync(p.pwfile, { force: true });
    }
  }
  if (!url) throw new Error("PGSUPERUSER_URL is missing from db/.env.local and the cluster already exists: restore it, or delete the HMS PostgreSQL folder to start over");

  deps.say("Starting the HMS PostgreSQL instance on 127.0.0.1:5433...");
  const code = await run("pg_ctl.exe", ["start", "-D", p.data, "-l", p.log, "-o", serverOptions(), "-w", "-t", "60"]);
  if (code !== 0) throw new Error(`pg_ctl start failed (exit ${code}); see ${p.log}`);
  for (let i = 0; i < 40 && !(await superLogin(url)); i++) await sleep(500);
  if (!(await superLogin(url))) throw new Error("The HMS PostgreSQL instance did not accept the superuser login");
  writeFileSync(p.secured, "cluster initialised with a password; scram-sha-256 only\n", "utf8");
  deps.say("The HMS PostgreSQL instance is up.");
}

export async function stopPg(deps: PgInstanceDeps, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const p = pgPathsFor(pgHome(environment));
  assertHmsPgPaths(p, PG_PORT, environment);
  if (!existsSync(path.join(p.data, "postmaster.pid"))) {
    deps.say("The HMS PostgreSQL instance is not running.");
    return;
  }
  const code = await run("pg_ctl.exe", ["stop", "-D", p.data, "-m", "fast", "-w", "-t", "60"]);
  if (code !== 0) throw new Error(`pg_ctl stop failed (exit ${code})`);
  deps.say("The HMS PostgreSQL instance is stopped.");
}

export async function statusPg(deps: PgInstanceDeps): Promise<"running" | "port-busy" | "stopped"> {
  const url = deps.env.get("PGSUPERUSER_URL");
  if (url && (await superLogin(url))) return "running";
  return (await portInUse(PG_PORT)) ? "port-busy" : "stopped";
}

if (require.main === module) {
  const command = process.argv[2];
  const deps: PgInstanceDeps = { env: createEnvStore(path.join(__dirname, "..", ".env.local")), say: (m) => process.stdout.write(`${m}\n`) };
  (async () => {
    if (command === "start" || command === "ensure") await startPg(deps);
    else if (command === "stop") await stopPg(deps);
    else if (command === "status") deps.say(`HMS PostgreSQL: ${await statusPg(deps)}`);
    else throw new Error("Usage: pg-instance.ts ensure | start | stop | status");
  })().catch((error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : "failed"}\n`);
    process.exit(1);
  });
}
